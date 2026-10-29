import path from 'node:path';
import os from 'node:os';
import { mkdir } from 'node:fs/promises';
import { loadV2ChainProfile } from './chain-profile-runtime.mjs';
import { keccak256 } from 'viem';
import { createPgliteDb, migrate } from './db.mjs';
import { ARC_TESTNET_PROFILE, resolveV2ChainProfile, toPublicV2Profile, assertV2Profile } from '../chain-profile.mjs';
import { createV2ReadApi } from './api-read.mjs';
import { createV2AuthApi } from './api-auth.mjs';
import { createV2PrivateApi } from './api-private.mjs';
import { createV2ActionsApi } from './api-actions.mjs';
import { createV2ChainReader } from './chain-reader.mjs';
import { createV2SignatureVerifier } from './api-signatures.mjs';
import { createV2Indexer } from './indexer.mjs';
import { createV2IndexerStore } from './indexer-store.mjs';
import { INDEXER_EVENT_SOURCES } from '../indexer-events.mjs';

export const V2_LOCAL_ORIGIN = process.env.V2_CHAIN_PROFILE === 'local-hardhat' ? 'http://127.0.0.1:3104' : 'http://127.0.0.1:3102';
const RPC_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_getBlockReceipts', 'eth_getTransactionReceipt', 'eth_getCode', 'eth_getStorageAt', 'eth_call', 'eth_getTransactionByHash']);
const unavailable = () => ({ status: 'unavailable', stale: true, gap: null, code: 'READER_UNAVAILABLE', reason: 'reader unavailable' });
let nextRpcId = 0;

// Server transports are structurally incapable of broadcasting or signing.
export function createReadOnlyV2Transport({ profile = ARC_TESTNET_PROFILE } = {}) {
  assertV2Profile(profile);
  async function read(method, params) {
    const id = ++nextRpcId;
    const response = await fetch(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!response.ok) throw new Error('V2_RPC_UNAVAILABLE');
    const payload = await response.json();
    if (payload.jsonrpc !== '2.0' || payload.id !== id || payload.error || !Object.hasOwn(payload, 'result')) throw new Error('V2_RPC_UNAVAILABLE');
    if (payload.result === null && !['eth_getTransactionReceipt', 'eth_getTransactionByHash'].includes(method)) throw new Error('V2_RPC_UNAVAILABLE');
    return payload.result;
  }
  return async function readOnlyV2Transport(method, params = []) {
    if (!RPC_METHODS.has(method) || /(?:send|sign|personal_sign|wallet_)/i.test(method)) throw new Error('V2_RPC_METHOD_DENIED');
    // Re-check the actual endpoint before every data request; never trust a
    // configured/static network or leak profile-external reads before this gate.
    const chain = await read('eth_chainId', []);
    if (typeof chain !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(chain) || BigInt(chain) !== profile.canonicalChainId) throw new Error('V2_RPC_CHAIN_MISMATCH');
    if (method === 'eth_getBlockReceipts' && profile.name === 'local-hardhat') {
      // Hardhat does not implement this bulk method. Read every actual receipt
      // from its exact ordered header transaction list; never fabricate empty logs.
      if (params.length !== 1 || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(params[0])) throw new Error('V2_RPC_UNAVAILABLE');
      const header = await read('eth_getBlockByNumber', [params[0], false]);
      if (!header || !Array.isArray(header.transactions) || header.transactions.length > 10000) throw new Error('V2_RPC_UNAVAILABLE');
      const receipts = [];
      for (let index = 0; index < header.transactions.length; index += 1) {
        const hash = header.transactions[index];
        if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('V2_RPC_UNAVAILABLE');
        const receipt = await read('eth_getTransactionReceipt', [hash]);
        if (!receipt || receipt.transactionHash !== hash || receipt.blockHash !== header.hash || BigInt(receipt.blockNumber) !== BigInt(header.number) || BigInt(receipt.transactionIndex) !== BigInt(index)) throw new Error('V2_RPC_UNAVAILABLE');
        receipts.push(receipt);
      }
      const after = await read('eth_getBlockByNumber', [params[0], false]);
      if (after?.hash !== header.hash) throw new Error('V2_RPC_UNAVAILABLE');
      return receipts;
    }
    return method === 'eth_chainId' ? chain : read(method, params);
  };
}
export const readOnlyV2Transport = createReadOnlyV2Transport();

export function defaultV2ReaderFactory({ toBlockTag, profile = ARC_TESTNET_PROFILE } = {}) {
  assertV2Profile(profile);
  if (toBlockTag !== undefined && (typeof toBlockTag !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(toBlockTag))) throw new TypeError('invalid pinned block');
  const base = createReadOnlyV2Transport({ profile });
  const transport = (method, params) => method === 'eth_blockNumber' && toBlockTag !== undefined ? Promise.resolve(toBlockTag) : base(method, params);
  return createV2ChainReader({ transport, profile, chainId: profile.canonicalChainId, marketplace: profile.marketplace, vault: profile.vault });
}

export function createV2Api({ db, origin = V2_LOCAL_ORIGIN, profile = ARC_TESTNET_PROFILE, readerFactory = (options = {}) => defaultV2ReaderFactory({ ...options, profile }), getHealth = unavailable, verifyWalletSignature, readSignature, now, privateHandler = null } = {}) {
  assertV2Profile(profile);
  if (!db || typeof db.query !== 'function') throw new TypeError('V2 database is required');
  const auth = createV2AuthApi({ db, origin, profile, verifyWalletSignature, now });
  const read = createV2ReadApi({ db, auth, getHealth, profile, readerFactory, transport: createReadOnlyV2Transport({ profile }) });
  const privateApi = privateHandler ?? createV2PrivateApi({ db, auth, readerFactory, getHealth, readSignature, origin, now, profile });
  const actions = createV2ActionsApi({ db, auth, readerFactory, getHealth, readSignature, origin, now, profile });
  const handle = async (request) => {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin) return Response.json({ error: 'ORIGIN_MISMATCH' }, { status: 403, headers: { 'cache-control': 'no-store' } });
      if (url.pathname === '/api/v2/profile' && request.method === 'GET') return Response.json({ profile: toPublicV2Profile(profile) }, { headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } });
      if (url.pathname.startsWith('/api/v2/auth/')) return await auth(request);
      if ((request.method === 'POST' && url.pathname === '/api/v2/jobs') || url.pathname === '/api/v2/draft-context' || /^\/api\/v2\/jobs\/[^/]+\/preflight$/.test(url.pathname) || url.pathname.startsWith('/api/v2/drafts/') || url.pathname === '/api/v2/accounts/preflight') return await actions(request);
      if (/^\/api\/v2\/jobs\/[^/]+\/(applications|deliveries)$/.test(url.pathname) || url.pathname === '/api/v2/resolver') return await privateApi(request);
      return await read(request);
    } catch {
      return Response.json({ error: 'V2_API_UNAVAILABLE' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  };
  return Object.freeze({ handle, auth, read, db, readerFactory, getHealth, verifyWalletSignature, readSignature, origin });
}

let runtimePromise;
async function loadRuntimeProfile() {
  const profile = await loadV2ChainProfile();
  if (profile.name !== 'local-hardhat') return profile;
  const transport = createReadOnlyV2Transport({ profile });
  await transport('eth_chainId', []);
  const proof = await transport('eth_getBlockByNumber', ['0x' + BigInt(profile.proofAnchor.blockNumber).toString(16), false]);
  if (proof?.hash?.toLowerCase() !== profile.proofAnchor.blockHash) throw new Error('V2_LOCAL_WITNESS_MISMATCH');
  for (const kind of ['marketplace', 'vault']) {
    const code = await transport('eth_getCode', [profile[kind], proof.number]);
    if (keccak256(code) !== profile.runtime[kind].rawHash) throw new Error('V2_LOCAL_RUNTIME_MISMATCH');
  }
  return profile;
}
export function getV2LocalRuntime() {
  if (!runtimePromise) runtimePromise = (async () => {
    const profile = await loadRuntimeProfile();
    // Separate from prior development databases; never opens a V1 database.
    const dataRoot = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'state', 'alphaboard-v2');
    const dataDir = profile.name === 'local-hardhat' ? path.join(dataRoot, 'local-hardhat', profile.marketplace.toLowerCase(), 'pglite-api') : path.join(dataRoot, 'pglite-api');
    await mkdir(dataDir, { recursive: true });
    const db = await createPgliteDb({ dataDir });
    try {
      await migrate(db);
      const transport = createReadOnlyV2Transport({ profile });
      const readerFactory = (options = {}) => defaultV2ReaderFactory({ ...options, profile });
      const store = createV2IndexerStore({ db, profile, chainId: Number(profile.canonicalChainId), marketplace: profile.marketplace, vault: profile.vault });
      const initialAnchor = profile.name === 'local-hardhat' ? await transport('eth_getBlockByNumber', ['0x0', false]).then((block) => ({ blockNumber: '0', blockHash: block.hash })) : null;
      const indexer = createV2Indexer({ db, profile, initialAnchor, transport, store, readerFactory, chainId: Number(profile.canonicalChainId), marketplace: profile.marketplace, vault: profile.vault, confirmations: profile.name === 'local-hardhat' ? 0 : 32 });
      const verifier = createV2SignatureVerifier({ transport, readerFactory });
      const getHealth = () => {
        const state = indexer.health();
        const age = Date.now() - Date.parse(state.lastSyncedAt ?? '');
        const fresh = state.status === 'healthy' && state.stale === false && state.gap == null && Number.isFinite(age) && age >= 0 && age <= 30000;
        return { ...state, ...(state.status === 'healthy' && !fresh ? { status: 'degraded', stale: true, code: 'STALE_READER' } : {}), reader: fresh ? 'available' : state.cursor ? 'stale' : 'unavailable' };
      };
      const api = createV2Api({ db, profile, readerFactory, getHealth, verifyWalletSignature: verifier.verifyWalletSignature, readSignature: verifier.readSignature });
      let syncPromise = null;
      const syncOnce = () => {
        if (!syncPromise) syncPromise = indexer.syncOnce().finally(() => { syncPromise = null; });
        return syncPromise;
      };
      if (profile.name === 'local-hardhat') await syncOnce();
      // Read-only synchronization is serialized and request-driven. This never
      // retries, signs, or broadcasts a wallet transaction.
      const handle = async (request) => {
        if (profile.name === 'local-hardhat') await syncOnce();
        return api.handle(request);
      };
      return Object.freeze({ ...api, handle, profile, indexer, syncOnce });
    } catch (cause) {
      await db.close();
      throw new Error('V2_RUNTIME_UNAVAILABLE', { cause });
    }
  })().catch((cause) => { runtimePromise = undefined; throw new Error('V2_RUNTIME_UNAVAILABLE', { cause }); });
  return runtimePromise;
}
