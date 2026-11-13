// LOCAL-ONLY Arc testnet finalized log-range indexer engine.
//
// Trust model (explicit, surfaced in health):
// - Old finalized ranges are scanned with ADDRESS-FILTERED eth_getLogs in
//   inclusive batches of at most 10,000 blocks. No per-block headers, no
//   eth_getBlockReceipts, no logsBloom recomputation.
// - Completeness of a range therefore TRUSTS the provider's eth_getLogs answer
//   for a block range the provider itself reports as finalized. This is NOT the
//   default core receipt/bloom proof (web/lib/v2/server/indexer.mjs), which is
//   left unchanged.
// - Header hash/parent verification happens only at range boundaries, at every
//   event-containing block, and densely in the last 32 blocks below the
//   finalized head. Parent continuity is asserted ONLY between adjacent
//   observed heights; unobserved intermediate headers are never fabricated.
import { setTimeout as delay } from 'node:timers/promises';
import { ARC_TESTNET_PROFILE, assertV2Profile } from '../lib/v2/chain-profile.mjs';
import { decodeIndexerLog } from '../lib/v2/indexer-events.mjs';
import { createV2ChainReader } from '../lib/v2/server/chain-reader.mjs';
import { snapshotTransactionHashes } from '../lib/v2/server/indexer.mjs';
import { createV2IndexerProjector, prepareV2Projection } from '../lib/v2/server/indexer-projection.mjs';

export const LOCAL_ARC_FINALIZED_ENGINE = 'local-arc-finalized-log-range';
export const LOCAL_ARC_FINALIZED_VERIFICATION_MODE = 'finalized-log-range-address-filtered';
export const MAX_FINALIZED_LOG_RANGE = 10_000;
export const HEAD_REORG_WINDOW = 32;
export const MAX_EVENT_BLOCKS_PER_RANGE = 900; // + 2 boundaries + 32 tail stays below the store's 1000-header cap
const MAX_EVENTS_PER_RANGE = 10_000;
const ARC_CHAIN_HEX = '0x4cef52';
export const FINALIZED_RANGE_ALLOWED_RPC = Object.freeze(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_getCode', 'eth_getStorageAt', 'eth_call']);
const ALLOWED = new Set(FINALIZED_RANGE_ALLOWED_RPC);
const FINALITY_TRUST = Object.freeze({ finalized: 'provider-finalized-tag', safe: 'provider-safe-tag', confirmations: 'confirmation-depth-heuristic' });
export const FINALIZED_EVIDENCE = Object.freeze({
  historicalCompleteness: 'address-filtered-eth_getLogs-trusted-for-provider-finalized-range',
  perBlockReceipts: false,
  logsBloomProof: false,
  headerBinding: 'range-boundaries+event-blocks+dense-head-tail',
  parentContinuity: 'adjacent-observed-heights-only',
  headReorgWindow: HEAD_REORG_WINDOW,
});

const hexQty = (n) => `0x${BigInt(n).toString(16)}`;
const QTY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

class FinalizedIndexerError extends Error {
  constructor(code, reason, extra = {}) { super(reason); this.code = code; this.reason = reason; Object.assign(this, extra); }
}
const invalid = (reason, code = 'INDEXER_VALIDATION_FAILED') => new FinalizedIndexerError(code, reason);
const parseQty = (value, label) => { if (typeof value !== 'string' || !QTY.test(value)) throw invalid(`invalid ${label}`); return BigInt(value); };
const parseHash = (value, label) => { if (typeof value !== 'string' || !HASH.test(value)) throw invalid(`invalid ${label}`); return value.toLowerCase(); };
function ownData(value, key) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
  try { const d = Object.getOwnPropertyDescriptor(value, key); return d && 'value' in d ? d.value : undefined; } catch { return undefined; }
}
const safeInt = (value) => (Number.isSafeInteger(value) ? value : undefined);

export function classifyFinalizedRpcError(method, error) {
  const name = ownData(error, 'name');
  const code = safeInt(ownData(error, 'jsonrpcCode')) ?? safeInt(ownData(error, 'code'));
  const httpStatus = safeInt(ownData(error, 'httpStatus'));
  if (name === 'AbortError' || name === 'TimeoutError' || ownData(error, 'code') === 'ETIMEDOUT') return 'timeout';
  if (code === -32005 || code === 429 || httpStatus === 429) return 'rate_limited';
  if (code === -32012 || code === 413 || httpStatus === 413 || (method === 'eth_getLogs' && code === -32602)) return 'range_too_large';
  if (code === -32602 || code === -32000 || code === -32601) return 'unsupported';
  return 'transport';
}

// Counting + allowlisting wrapper. Receipt methods are structurally impossible
// through this path, so no legacy prefetch/receipt optimisation can leak in.
export function createFinalizedRangeTransport({ transport } = {}) {
  if (typeof transport !== 'function') throw new TypeError('transport is required');
  const counts = Object.create(null);
  const wrapped = async (method, params = [], signal) => {
    if (!ALLOWED.has(method) || /(?:send|sign|wallet_|receipt|personal_)/i.test(method)) throw new FinalizedIndexerError('INDEXER_RPC_DENIED', 'RPC method denied in finalized log-range mode');
    counts[method] = (counts[method] ?? 0) + 1;
    return transport(method, params, signal);
  };
  Object.defineProperty(wrapped, 'counts', { value: () => ({ ...counts }) });
  return wrapped;
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length); let next = 0; let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { out[index] = await fn(items[index]); } catch (error) { failed = true; throw error; }
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return out;
}

function bounded(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${name} must be between ${min} and ${max}`);
  return value;
}

export function createLocalArcFinalizedIndexer({
  db, transport, store, readerFactory, projector, profile = ARC_TESTNET_PROFILE, initialAnchor = null,
  logRange = MAX_FINALIZED_LOG_RANGE, maxRanges = 16, concurrency = 1, maxRateLimitRetries = 5,
  baseBackoffMs = 500, maxBackoffMs = 30_000, totalBudgetMs = 60_000, minRangeBudgetMs = 10_000,
  attestationMaxAgeMs = 60_000, allowConfirmationFallback = false, confirmations = 32, combinedAddressFilter = true,
  sleep = (ms, signal) => delay(ms, undefined, { signal }), now = Date.now,
} = {}) {
  if (!db || typeof db.query !== 'function' || typeof transport !== 'function' || !store || typeof store.applyFinalizedLogRange !== 'function') throw new TypeError('finalized indexer requires db, transport, and a store with applyFinalizedLogRange');
  assertV2Profile(profile);
  if (profile.name !== 'arc-testnet' || profile.canonicalChainId !== 5042002n || profile.rpcUrl !== 'https://rpc.testnet.arc.io') throw new TypeError('finalized log-range engine is pinned to Arc testnet chain 5042002 public RPC');
  bounded(logRange, 'logRange', 1, MAX_FINALIZED_LOG_RANGE); bounded(maxRanges, 'maxRanges', 1, 64); bounded(concurrency, 'concurrency', 1, 2);
  bounded(maxRateLimitRetries, 'maxRateLimitRetries', 0, 8); bounded(totalBudgetMs, 'totalBudgetMs', 1, 60_000); bounded(confirmations, 'confirmations', 0, 1_000_000);
  const chainId = Number(profile.canonicalChainId);
  const marketplace = profile.marketplace; const vault = profile.vault;
  const pair = new Set([marketplace.toLowerCase(), vault.toLowerCase()]);
  const rpcTransport = createFinalizedRangeTransport({ transport });
  const project = projector ?? createV2IndexerProjector({ profile, chainId, marketplace });
  let currentLogRange = logRange;
  let signal = null;
  let lastAttestation = null;
  let inFlightRange = null;
  const metrics = { syncs: 0, ranges: 0, blocksScanned: 0, eventsCommitted: 0, headerReads: 0, logQueries: 0, rangeShrinks: 0, rateLimited: 0, backoffMs: 0, attestations: 0, reorgsHandled: 0, lastRange: null };
  let health = { status: 'starting', engine: LOCAL_ARC_FINALIZED_ENGINE, verificationMode: LOCAL_ARC_FINALIZED_VERIFICATION_MODE, finalityTrust: null, finalityTag: null, evidence: FINALIZED_EVIDENCE, cursor: null, indexedBlock: null, indexedHash: null, head: null, safeHead: null, safeHash: null, lag: null, lastSyncedAt: null, stale: true, gap: null, code: null, reason: null, reorg: null };

  async function rpc(method, params = []) {
    let attempt = 0;
    for (;;) {
      if (signal?.aborted) throw new FinalizedIndexerError('INDEXER_BUDGET_EXHAUSTED', 'sync budget exhausted');
      try {
        const result = await rpcTransport(method, params, signal ?? undefined);
        if (result === undefined || result === null) throw new FinalizedIndexerError('INDEXER_RPC_FAILED', `RPC returned no result for ${method}`, { kind: 'null_result', method });
        return result;
      } catch (error) {
        if (error instanceof FinalizedIndexerError) throw error;
        if (signal?.aborted) throw new FinalizedIndexerError('INDEXER_BUDGET_EXHAUSTED', 'sync budget exhausted');
        const kind = classifyFinalizedRpcError(method, error);
        if (kind === 'rate_limited' && attempt < maxRateLimitRetries) {
          const retryAfter = safeInt(ownData(error, 'retryAfterMs'));
          const wait = retryAfter ?? Math.min(maxBackoffMs, baseBackoffMs * (2 ** attempt));
          metrics.rateLimited += 1; metrics.backoffMs += wait; attempt += 1;
          try { await sleep(wait, signal ?? undefined); } catch { throw new FinalizedIndexerError('INDEXER_BUDGET_EXHAUSTED', 'sync budget exhausted during backoff'); }
          continue;
        }
        if (kind === 'rate_limited') metrics.rateLimited += 1;
        throw new FinalizedIndexerError(kind === 'rate_limited' ? 'INDEXER_RATE_LIMITED' : 'INDEXER_RPC_FAILED', `RPC ${method} failed (${kind})`, { kind, method, rpcCode: safeInt(ownData(error, 'jsonrpcCode')) ?? safeInt(ownData(error, 'code')) ?? null });
      }
    }
  }

  async function finalityEvidence() {
    let head = parseQty(await rpc('eth_blockNumber'), 'head');
    for (const tag of ['finalized', 'safe']) {
      try {
        const block = await rpc('eth_getBlockByNumber', [tag, false]);
        const number = parseQty(block.number, `${tag} number`);
        if (number > head) head = parseQty(await rpc('eth_blockNumber'), 'refreshed head');
        if (number > head) {
          const latest = await rpc('eth_getBlockByNumber', ['latest', false]);
          const latestNumber = parseQty(latest.number, 'latest head');
          parseHash(latest.hash, 'latest head hash');
          if (latestNumber > head) head = latestNumber;
        }
        if (number > head) throw invalid(`${tag} block is above head`);
        return { tag, number, hash: parseHash(block.hash, `${tag} hash`), head, trust: FINALITY_TRUST[tag] };
      } catch (error) {
        if (error?.kind !== 'unsupported' && error?.kind !== 'null_result') throw error;
      }
    }
    if (!allowConfirmationFallback) throw new FinalizedIndexerError('INDEXER_FINALITY_UNAVAILABLE', 'provider exposes no finalized/safe tag; log-only mode refuses to guess finality');
    const number = head > BigInt(confirmations) ? head - BigInt(confirmations) : 0n;
    const block = await rpc('eth_getBlockByNumber', [hexQty(number), false]);
    return { tag: 'confirmations', number, hash: parseHash(block.hash, 'confirmation block hash'), head, trust: FINALITY_TRUST.confirmations };
  }

  async function readHeader(n) {
    const block = await rpc('eth_getBlockByNumber', [hexQty(n), false]);
    metrics.headerReads += 1;
    if (parseQty(block.number, 'block number') !== n) throw invalid('RPC returned inconsistent block');
    let transactions;
    try { transactions = snapshotTransactionHashes(block.transactions); } catch { throw invalid('invalid block transactions'); }
    const timestamp = typeof block.timestamp === 'string' && QTY.test(block.timestamp) ? block.timestamp.toLowerCase() : null;
    return { blockNumber: n.toString(), blockHash: parseHash(block.hash, 'block hash'), parentHash: parseHash(block.parentHash, 'parent hash'), transactionCount: transactions.length, header: { timestamp, verificationMode: LOCAL_ARC_FINALIZED_VERIFICATION_MODE, transactionHashes: transactions.map(hash => hash.toLowerCase()) } };
  }

  async function getLogsBounded(from, to) {
    let end = to;
    for (;;) {
      try {
        const filters = combinedAddressFilter ? [[marketplace, vault]] : [[marketplace], [vault]];
        const all = [];
        for (const address of filters) {
          const logs = await rpc('eth_getLogs', [{ address: address.length === 1 ? address[0] : address, fromBlock: hexQty(from), toBlock: hexQty(end) }]);
          if (!Array.isArray(logs)) throw invalid('RPC returned invalid logs');
          metrics.logQueries += 1; all.push(...logs);
        }
        return { to: end, logs: all };
      } catch (error) {
        if ((error?.kind === 'range_too_large' || error?.kind === 'timeout') && end > from) {
          end = from + ((end - from) / 2n); metrics.rangeShrinks += 1;
          currentLogRange = Math.max(1, Number(end - from + 1n));
          continue;
        }
        throw error;
      }
    }
  }

  function normalizeLogs(rawLogs, from, to) {
    const seen = new Map(); const blockHashes = new Map(); const positions = new Map(); const events = [];
    for (const raw of rawLogs) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('malformed log');
      if (ownData(raw, 'removed') !== false) throw invalid('removed or unflagged log in finalized range');
      const emitter = ownData(raw, 'address');
      if (typeof emitter !== 'string' || !pair.has(emitter.toLowerCase())) throw invalid('log emitter outside pinned marketplace/vault');
      const normalized = { address: emitter, blockNumber: parseQty(ownData(raw, 'blockNumber'), 'log block').toString(), blockHash: parseHash(ownData(raw, 'blockHash'), 'log block hash'), transactionHash: parseHash(ownData(raw, 'transactionHash'), 'log transaction hash'), transactionIndex: parseQty(ownData(raw, 'transactionIndex'), 'log transaction index').toString(), logIndex: parseQty(ownData(raw, 'logIndex'), 'log index').toString(), removed: false, topics: ownData(raw, 'topics'), data: ownData(raw, 'data') };
      const n = BigInt(normalized.blockNumber);
      if (n < from || n > to) throw invalid('log outside requested range');
      let decoded;
      try { decoded = decodeIndexerLog(normalized, { chainId: profile.canonicalChainId, profile }); } catch { throw invalid('log rejected by pinned ABI decoder'); }
      const priorHash = blockHashes.get(decoded.blockNumber);
      if (priorHash && priorHash !== decoded.blockHash) throw invalid('logs disagree on block hash');
      blockHashes.set(decoded.blockNumber, decoded.blockHash);
      const event = { stream: decoded.source, emitter: decoded.address, blockNumber: decoded.blockNumber, blockHash: decoded.blockHash, transactionHash: decoded.transactionHash, transactionIndex: Number(decoded.transactionIndex), logIndex: Number(decoded.logIndex), topics: normalized.topics.map((topic) => topic.toLowerCase()), data: normalized.data.toLowerCase(), decoded: { args: decoded.args }, eventName: decoded.event };
      if (!Number.isSafeInteger(event.transactionIndex) || !Number.isSafeInteger(event.logIndex)) throw invalid('log index out of range');
      const key = `${event.emitter}:${event.blockHash}:${event.transactionHash}:${event.logIndex}`;
      const fingerprint = JSON.stringify([event.blockNumber, event.transactionIndex, event.topics, event.data, event.eventName]);
      if (seen.has(key)) { if (seen.get(key) !== fingerprint) throw invalid('conflicting log identity'); continue; }
      const position = `${event.blockNumber}:${event.logIndex}`;
      if (positions.has(position) && positions.get(position) !== key) throw invalid('duplicate log index within block');
      seen.set(key, fingerprint); positions.set(position, key); events.push(event);
    }
    events.sort((a, b) => (BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? 1 : (a.transactionIndex - b.transactionIndex) || (a.logIndex - b.logIndex)));
    return events;
  }

  // Shrink the range end (never the start) so one commit fits store caps. The
  // already-fetched logs remain complete for the shorter inclusive range.
  function capRange(events, end) {
    const blocks = []; let count = 0; let cappedEnd = end; let index = 0;
    while (index < events.length) {
      const block = events[index].blockNumber; let size = 0;
      while (index + size < events.length && events[index + size].blockNumber === block) size += 1;
      if (blocks.length + 1 > MAX_EVENT_BLOCKS_PER_RANGE || count + size > MAX_EVENTS_PER_RANGE) {
        if (!blocks.length) throw invalid('single block exceeds the per-range event cap');
        cappedEnd = BigInt(blocks.at(-1)); break;
      }
      blocks.push(block); count += size; index += size;
    }
    return { end: cappedEnd, events: events.filter((event) => BigInt(event.blockNumber) <= cappedEnd) };
  }

  function observedHeights(from, end, events, final) {
    const heights = new Set([from, end]);
    for (const event of events) heights.add(BigInt(event.blockNumber));
    const tailStart = final.head >= BigInt(HEAD_REORG_WINDOW - 1) ? final.head - BigInt(HEAD_REORG_WINDOW - 1) : 0n;
    for (let n = from > tailStart ? from : tailStart; n <= end; n += 1n) heights.add(n);
    return [...heights].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  function verifyObserved(headers, events, base, end, final) {
    const byNumber = new Map(headers.map((header) => [header.blockNumber, header]));
    for (const event of events) {
      const header = byNumber.get(event.blockNumber);
      if (header?.blockHash !== event.blockHash) throw invalid('log block hash does not match canonical header');
      if (header.header.transactionHashes[event.transactionIndex] !== event.transactionHash) throw invalid('log transaction does not match canonical header position');
    }
    for (let i = 1; i < headers.length; i += 1) if (BigInt(headers[i].blockNumber) === BigInt(headers[i - 1].blockNumber) + 1n && headers[i].parentHash !== headers[i - 1].blockHash) throw invalid('header parent continuity mismatch');
    if (BigInt(headers[0].blockNumber) !== BigInt(base.blockNumber) + 1n || headers[0].parentHash !== base.blockHash) throw invalid('range start does not continue the verified cursor');
    if (end === final.number && headers.at(-1).blockHash !== final.hash) throw invalid('range end does not match provider finality evidence', 'INDEXER_SOURCE_CHANGED');
  }

  async function attest(blockNumber) {
    const factory = readerFactory ?? ((options) => createV2ChainReader(options));
    const tag = hexQty(blockNumber);
    const pinned = async (method, params, sig) => { const value = await rpcTransport(method, method === 'eth_blockNumber' ? [] : params, sig ?? signal ?? undefined); return method === 'eth_blockNumber' ? tag : value; };
    const reader = await factory({ transport: pinned, profile, chainId: profile.canonicalChainId, marketplace, vault, toBlockTag: tag });
    if (!reader || typeof reader.read !== 'function' || reader.verify === true || typeof reader.attest === 'function') throw invalid('indexer reader attestation failed');
    const snapshot = await reader.read();
    if (!snapshot || snapshot.chainId !== profile.canonicalChainId || typeof snapshot.blockTag !== 'string' || !QTY.test(snapshot.blockTag) || BigInt(snapshot.blockTag) !== blockNumber || !HASH.test(snapshot.blockHash ?? '') || !HASH.test(snapshot.hashes?.marketplaceNormalized ?? '') || !HASH.test(snapshot.hashes?.vaultNormalized ?? '')) throw invalid('indexer reader attestation failed');
    metrics.attestations += 1;
    return snapshot;
  }
  const attestationStale = () => !lastAttestation || now() - lastAttestation.at > attestationMaxAgeMs;

  async function canonicalHistoryThrough(ancestor) {
    return (await store.rawEvents()).filter((e) => e.canonical !== false && BigInt(e.block_number) <= BigInt(ancestor.blockNumber)).map((e) => ({ stream: e.stream, emitter: e.emitter, blockNumber: String(e.block_number), blockHash: String(e.block_hash), transactionHash: String(e.transaction_hash), transactionIndex: Number(e.transaction_index), logIndex: Number(e.log_index), topics: e.topics, data: e.data, decoded: e.decoded, eventName: e.event_name }));
  }

  async function findReorgAncestor(cursor, final) {
    const block = await rpc('eth_getBlockByNumber', [hexQty(BigInt(cursor.blockNumber)), false]);
    if (parseHash(block.hash, 'cursor block hash') === cursor.blockHash) return null;
    const headFloor = final.head > BigInt(HEAD_REORG_WINDOW) ? final.head - BigInt(HEAD_REORG_WINDOW) : 0n;
    if (BigInt(cursor.blockNumber) < headFloor) throw new FinalizedIndexerError('INDEXER_DEEP_REORG', 'historical finalized boundary changed outside the head reorg window; manual replay required');
    const cursorFloor = BigInt(cursor.blockNumber) > BigInt(HEAD_REORG_WINDOW) ? BigInt(cursor.blockNumber) - BigInt(HEAD_REORG_WINDOW) : 0n;
    const floor = cursorFloor > headFloor ? cursorFloor : headFloor;
    const rows = await db.query("SELECT block_number, block_hash FROM v2_indexer_blocks_fork WHERE chain_id=$1 AND stream='marketplace' AND canonical AND block_number<$2 AND block_number>=$3 ORDER BY block_number DESC", [chainId, cursor.blockNumber, floor.toString()]);
    for (const row of rows.rows) {
      const n = BigInt(row.block_number);
      const candidate = await rpc('eth_getBlockByNumber', [hexQty(n), false]);
      if (parseHash(candidate.hash, 'ancestor hash') === String(row.block_hash).toLowerCase()) return { blockNumber: n.toString(), blockHash: String(row.block_hash).toLowerCase(), depth: Number(BigInt(cursor.blockNumber) - n) };
    }
    throw new FinalizedIndexerError('INDEXER_DEEP_REORG', `cursor hash changed and no observed canonical ancestor within ${HEAD_REORG_WINDOW} blocks; manual deep replay required`);
  }

  async function resolveInitialAnchor(final) {
    const configured = profile.initialAnchor?.blockNumber ?? 0;
    if (initialAnchor && String(initialAnchor.blockNumber) !== String(configured)) throw invalid('initial anchor mismatch');
    if (BigInt(configured) > final.number) throw invalid('initial anchor is not yet finalized');
    const block = await rpc('eth_getBlockByNumber', [hexQty(configured), false]);
    const anchorHash = parseHash(block.hash, 'initial anchor hash');
    if (initialAnchor && anchorHash !== parseHash(initialAnchor.blockHash, 'initial anchor hash')) throw invalid('initial anchor mismatch');
    return { blockNumber: String(configured), blockHash: anchorHash };
  }

  async function processRange({ from, to, base, final, expectedCursor, reorgAncestor, initialVerifiedAnchor }) {
    const started = now();
    inFlightRange = { from: from.toString(), to: to.toString() };
    const queried = await getLogsBounded(from, to);
    const capped = capRange(normalizeLogs(queried.logs, from, queried.to), queried.to);
    const end = capped.end; const events = capped.events;
    const headers = await mapLimited(observedHeights(from, end, events, final), concurrency, readHeader);
    verifyObserved(headers, events, base, end, final);
    let projectorForRange = null; let attested = null;
    if (events.length || reorgAncestor || attestationStale()) {
      attested = await attest(end);
      if (parseHash(attested.blockHash, 'snapshot block hash') !== headers.at(-1).blockHash) throw invalid('projection source block mismatch', 'INDEXER_SOURCE_CHANGED');
      const prepared = await prepareV2Projection({ snapshot: attested, events, profile, canonicalHistory: reorgAncestor ? await canonicalHistoryThrough(reorgAncestor) : null, chainId, marketplace, trustedFixedConfig: { chainId, marketplace } });
      projectorForRange = (tx, context) => project(tx, { ...context, prepared, rebuild: Boolean(reorgAncestor) });
    }
    // Re-read the end boundary immediately before the atomic commit.
    const recheck = await rpc('eth_getBlockByNumber', [hexQty(end), false]);
    if (parseHash(recheck.hash, 'end boundary hash') !== headers.at(-1).blockHash) throw invalid('range end boundary changed before commit', 'INDEXER_SOURCE_CHANGED');
    let committed;
    try {
      committed = await store.applyFinalizedLogRange({ range: { from: from.toString(), to: end.toString() }, headers, events, expectedCursor, reorgAncestor: reorgAncestor ? { blockNumber: reorgAncestor.blockNumber, blockHash: reorgAncestor.blockHash } : undefined, initialVerifiedAnchor, projector: projectorForRange });
    } catch (error) {
      throw new FinalizedIndexerError('INDEXER_STORE_REJECTED', 'store rejected finalized range', { detail: error instanceof TypeError ? error.message : null });
    }
    if (attested) lastAttestation = { blockNumber: end.toString(), blockHash: headers.at(-1).blockHash, at: now() };
    metrics.ranges += 1; metrics.blocksScanned += Number(end - from + 1n); metrics.eventsCommitted += events.length;
    metrics.lastRange = { from: from.toString(), to: end.toString(), blocks: Number(end - from + 1n), events: events.length, headers: headers.length, attested: Boolean(attested), ms: now() - started };
    if (end === queried.to && currentLogRange < logRange) currentLogRange = Math.min(logRange, currentLogRange * 2);
    return committed.cursor;
  }

  function settle(status, cursor, final, extra = {}) {
    const catchingUp = status !== 'healthy';
    health = { ...health, ...extra, status, cursor, indexedBlock: cursor?.blockNumber ?? null, indexedHash: cursor?.blockHash ?? null, head: final.head.toString(), safeHead: final.number.toString(), safeHash: final.hash, finalityTag: final.tag, finalityTrust: final.trust, lag: cursor ? Number(final.number - BigInt(cursor.blockNumber)) : null, lastSyncedAt: new Date(now()).toISOString(), stale: catchingUp, code: null, reason: extra.reason ?? null, lastAttestation, logRange: currentLogRange };
    return { status, cursor, finality: { tag: final.tag, number: final.number.toString(), hash: final.hash }, ranges: metrics.ranges };
  }

  async function syncOnce() {
    metrics.syncs += 1;
    const controller = new AbortController(); signal = controller.signal;
    const budgetStart = now(); const timer = setTimeout(() => controller.abort(), totalBudgetMs);
    inFlightRange = null;
    let before = null;
    try {
      before = await store.cursor();
      if (await rpc('eth_chainId') !== ARC_CHAIN_HEX) throw invalid('chain mismatch');
      const final = await finalityEvidence();
      const cursor = await store.cursor();
      const ancestor = cursor ? await findReorgAncestor(cursor, final) : null;
      if (ancestor && BigInt(ancestor.blockNumber) >= final.number) throw invalid('reorg ancestor is not below finalized head');
      const anchor = cursor ? null : await resolveInitialAnchor(final);
      let base = ancestor ?? cursor ?? anchor;
      if (ancestor) metrics.reorgsHandled += 1;
      const reorg = ancestor ? { detectedAt: cursor, ancestor: { blockNumber: ancestor.blockNumber, blockHash: ancestor.blockHash }, depth: ancestor.depth } : health.reorg;
      if (!ancestor && BigInt(base.blockNumber) >= final.number) {
        if (cursor && BigInt(cursor.blockNumber) === final.number) {
          if (cursor.blockHash !== final.hash) throw invalid('cursor differs from finalized block at same height', 'INDEXER_SOURCE_CHANGED');
          if (attestationStale()) { const snapshot = await attest(final.number); if (parseHash(snapshot.blockHash, 'snapshot block hash') !== final.hash) throw invalid('attestation source mismatch', 'INDEXER_SOURCE_CHANGED'); lastAttestation = { blockNumber: final.number.toString(), blockHash: final.hash, at: now() }; }
          health = { ...health, gap: null };
          return settle('healthy', cursor, final, { reorg });
        }
        health = { ...health, gap: null };
        return settle('catching_up', cursor, final, { reorg, reason: cursor ? 'provider finalized head is behind cursor' : 'initial anchor at finalized head' });
      }
      let from = BigInt(base.blockNumber) + 1n; let expectedCursor = cursor; let ranges = 0;
      while (from <= final.number && ranges < maxRanges) {
        if (ranges > 0 && totalBudgetMs - (now() - budgetStart) < minRangeBudgetMs) break;
        const to = from + BigInt(currentLogRange) - 1n > final.number ? final.number : from + BigInt(currentLogRange) - 1n;
        const next = await processRange({ from, to, base, final, expectedCursor, reorgAncestor: ranges === 0 ? ancestor : null, initialVerifiedAnchor: ranges === 0 && !cursor ? anchor : undefined });
        base = next; expectedCursor = next; from = BigInt(next.blockNumber) + 1n; ranges += 1;
      }
      const after = await store.cursor();
      const caughtUp = from > final.number;
      health = { ...health, gap: caughtUp ? null : { from: from.toString(), to: final.number.toString(), reason: 'pending_finalized_log_range' } };
      return settle(caughtUp ? 'healthy' : 'catching_up', after, final, { reorg });
    } catch (error) {
      const code = error instanceof FinalizedIndexerError ? error.code : 'INDEXER_VALIDATION_FAILED';
      const reason = error instanceof FinalizedIndexerError ? error.reason : 'indexer sync failed';
      const failedFrom = before ? (BigInt(before.blockNumber) + 1n).toString() : null;
      const current = await store.cursor().catch(() => before);
      health = { ...health, status: 'degraded', stale: true, code, reason, detail: error?.detail ?? null, cursor: current, indexedBlock: current?.blockNumber ?? null, indexedHash: current?.blockHash ?? null, gap: { from: current ? (BigInt(current.blockNumber) + 1n).toString() : failedFrom, to: null, reason: 'failed_finalized_log_range' }, lastFailedRange: inFlightRange, logRange: currentLogRange };
      return { status: 'degraded', cursor: current, error: { code, reason } };
    } finally { clearTimeout(timer); signal = null; }
  }

  return Object.freeze({
    syncOnce,
    cursor: () => store.cursor(),
    health: () => ({ ...health, metrics: { ...metrics, logicalCalls: rpcTransport.counts() } }),
    metrics: () => ({ ...metrics, logicalCalls: rpcTransport.counts() }),
  });
}
