#!/usr/bin/env node
// FIXTURE-BASED request-count probe. It never touches the network: a
// deterministic in-process JSON-RPC fixture replaces fetch behind the real
// local scalar transport (allowlist + per-method eth_chainId guard). Counts are
// logical (indexer -> transport calls) and wire (fixture fetch requests). They
// are NOT live Arc measurements.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2Indexer } from '../lib/v2/server/indexer.mjs';
import { createV2IndexerStore } from '../lib/v2/server/indexer-store.mjs';
import { createLocalArcFinalizedIndexer } from './local-arc-finalized-indexer.mjs';
import { createLocalArcTransport } from './v2-local-arc-indexer.mjs';

const ANCHOR = ARC_TESTNET_PROFILE.initialAnchor.blockNumber;
const ZERO_BLOOM = `0x${'00'.repeat(256)}`;
const qty = (n) => `0x${BigInt(n).toString(16)}`;
export const probeHash = (n) => `0x${'ab'}${BigInt(n).toString(16).padStart(62, '0')}`;
const ADDRESS = (n) => `0x${BigInt(n).toString(16).padStart(40, '0')}`;

function emptyBlock(n) { return { number: qty(n), hash: probeHash(n), parentHash: probeHash(BigInt(n) - 1n), timestamp: '0x1', transactions: [], logsBloom: ZERO_BLOOM }; }

export function createEmptyChainFetch({ finalized }) {
  const wire = { requests: 0, byMethod: Object.create(null) };
  const answer = (method, params) => {
    switch (method) {
      case 'eth_chainId': return '0x4cef52';
      case 'eth_blockNumber': return qty(finalized);
      case 'eth_getBlockByNumber': {
        const tag = params?.[0];
        if (tag === 'finalized' || tag === 'safe' || tag === 'latest') return emptyBlock(finalized);
        const n = BigInt(tag);
        return n <= BigInt(finalized) ? emptyBlock(n) : null;
      }
      case 'eth_getLogs': return [];
      case 'eth_getBlockReceipts': return [];
      default: return undefined;
    }
  };
  const fetchImpl = async (_url, init) => {
    wire.requests += 1;
    const body = JSON.parse(init.body);
    const rows = (Array.isArray(body) ? body : [body]).map((entry) => {
      wire.byMethod[entry.method] = (wire.byMethod[entry.method] ?? 0) + 1;
      const result = answer(entry.method, entry.params);
      return result === undefined ? { jsonrpc: '2.0', id: entry.id, error: { code: -32601, message: 'fixture: method not served' } } : { jsonrpc: '2.0', id: entry.id, result };
    });
    const payload = Array.isArray(body) ? rows : rows[0];
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => payload };
  };
  return { fetchImpl, wire };
}

function countingTransport(base) {
  const logical = Object.create(null);
  const transport = (method, params, signal) => { logical[method] = (logical[method] ?? 0) + 1; return base(method, params, signal); };
  return { transport, logical };
}

// Stub reader: binds the snapshot to the fixture block through the transport
// (2 logical calls). A real createV2ChainReader additionally performs
// eth_getCode/eth_getStorageAt/eth_call reads; those are excluded here.
function stubReaderFactory() {
  return async ({ transport }) => ({
    read: async () => {
      const blockTag = await transport('eth_blockNumber', []);
      const block = await transport('eth_getBlockByNumber', [blockTag, false]);
      const refuse = async () => { throw new Error('fixture reader has no contract state'); };
      return { chainId: ARC_TESTNET_PROFILE.canonicalChainId, blockTag, blockHash: block.hash, hashes: { marketplaceNormalized: probeHash(101), vaultNormalized: probeHash(102) }, getters: { owner: ADDRESS(0x21), treasury: ADDRESS(0x22), minReward: '100', feeBps: '250' }, readJob: refuse, readMutual: refuse, readAccount: refuse, readClientPolicy: refuse };
    },
  });
}

const sum = (counts) => Object.values(counts).reduce((total, value) => total + value, 0);

async function withScratchStore(scratchRoot, prefix, fn) {
  const dir = await mkdtemp(path.join(scratchRoot, prefix));
  const db = await createPgliteDb({ dataDir: path.join(dir, 'pg') });
  try { await migrate(db); return await fn({ db, store: createV2IndexerStore({ db, profile: ARC_TESTNET_PROFILE }) }); }
  finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
}

export async function runRpcCountProbe({ blocks = 1000, scratchRoot = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'cache', 'scratch') } = {}) {
  if (!Number.isSafeInteger(blocks) || blocks < 1 || blocks > 1000) throw new TypeError('blocks must be 1..1000 (legacy batch cap)');
  const finalized = ANCHOR + blocks;
  const run = async (label, makeIndexer) => withScratchStore(scratchRoot, `v2-arc-count-${label}-`, async ({ db, store }) => {
    const chain = createEmptyChainFetch({ finalized });
    const { transport, logical } = countingTransport(createLocalArcTransport({ profile: ARC_TESTNET_PROFILE, fetchImpl: chain.fetchImpl, timeoutMs: 5000 }));
    const indexer = makeIndexer({ db, store, transport });
    const result = await indexer.syncOnce();
    const cursor = await store.cursor();
    const blockRows = (await db.query("SELECT count(*)::int AS n FROM v2_indexer_blocks_fork WHERE stream='marketplace'")).rows[0].n;
    return { status: result.status, cursor, storedBlockRows: blockRows, logical: { ...logical }, logicalTotal: sum(logical), wire: { requests: chain.wire.requests, byMethod: { ...chain.wire.byMethod } }, receiptCalls: logical.eth_getBlockReceipts ?? 0, numericHeaderCallsUpperBound: logical.eth_getBlockByNumber ?? 0 };
  });
  const legacy = await run('legacy', ({ db, store, transport }) => createV2Indexer({ db, profile: ARC_TESTNET_PROFILE, transport, store, readerFactory: stubReaderFactory(), projector: async () => {}, batchSize: 1000, maxBatches: 1, confirmations: 0, retries: 0, timeoutMs: 5000, totalBudgetMs: 60000 }));
  const finalizedRange = await run('finalized', ({ db, store, transport }) => createLocalArcFinalizedIndexer({ db, profile: ARC_TESTNET_PROFILE, transport, store, readerFactory: stubReaderFactory(), projector: async () => {}, logRange: 10_000, maxRanges: 1, sleep: async () => {} }));
  return {
    fixtureBased: true,
    liveMeasurement: false,
    blocks,
    range: { from: String(ANCHOR + 1), to: String(finalized) },
    legacyReceiptBloom: legacy,
    finalizedLogRange: finalizedRange,
    notes: [
      'Empty fixture blocks (0 transactions, zero bloom): legacy issues no eth_getBlockReceipts here; on real blocks with transactions it adds one receipts call per such block.',
      'Wire counts include the scalar transport per-method eth_chainId guard (wire = 2*logical - logical eth_chainId).',
      'Reader is a stub (2 logical calls per attestation); a real createV2ChainReader adds contract reads per attestation for both engines.',
      'Finalized engine reads the 32-block dense head tail because the fixture range ends at the finalized head; an old range far below head reads only 2 boundary headers + event blocks.',
    ],
  };
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  runRpcCountProbe().then((result) => { console.log(JSON.stringify(result, null, 2)); }).catch((error) => { console.error(error?.message ?? 'probe failed'); process.exitCode = 1; });
}
