#!/usr/bin/env node
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pool } from 'pg';
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';
import { createV2ChainReader } from '../lib/v2/server/chain-reader.mjs';
import { createPgDb } from '../lib/v2/server/db.mjs';
import { verifyLocalArcMigrations } from '../lib/v2/server/local-arc-runtime.mjs';
import { createV2Indexer } from '../lib/v2/server/indexer.mjs';
import { createV2IndexerStore } from '../lib/v2/server/indexer-store.mjs';
import { createLocalArcPrefetchTransport } from './local-arc-prefetch-transport.mjs';
import { createLocalArcFinalizedIndexer, FINALIZED_EVIDENCE, LOCAL_ARC_FINALIZED_ENGINE, LOCAL_ARC_FINALIZED_VERIFICATION_MODE, MAX_FINALIZED_LOG_RANGE } from './local-arc-finalized-indexer.mjs';

const HOST = '127.0.0.1';
const PORT = 3103;
const MAX_HEALTH_AGE_MS = 30_000;
const ARC_RPC_URL = 'https://rpc.testnet.arc.io';
const ADAPTIVE_MIN_BATCH = 1;
const ADAPTIVE_MAX_BATCH = 1000;
const ADAPTIVE_MIN_LOG_RANGE = 1000;
const ADAPTIVE_MAX_LOG_RANGE = 10000;

const safeInteger = (value) => Number.isSafeInteger(value) ? value : undefined;
export function classifyLocalArcRpcFailure({ method, fromBlock = null, toBlock = null, error } = {}) {
  const code = safeInteger(error?.jsonrpcCode ?? error?.code);
  const httpStatus = safeInteger(error?.httpStatus ?? (code >= 100 && code <= 599 ? code : undefined));
  const timeout = error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT';
  const kind = timeout ? 'timeout' : (httpStatus === 429 || code === 429 || code === -32005 ? 'rate_limited' : (code === -32012 || code === -32602 ? 'range_too_large' : 'transport'));
  return Object.freeze({ code: 'INDEXER_RPC_FAILED', method: typeof method === 'string' ? method : 'unknown', blockRange: fromBlock == null || toBlock == null ? null : { from: String(fromBlock), to: String(toBlock) }, httpStatus, jsonrpcCode: code, retryAfterMs: safeInteger(error?.retryAfterMs), kind, safeMessage: kind === 'rate_limited' ? 'RPC rate limited' : kind === 'timeout' ? 'RPC timeout' : kind === 'range_too_large' ? 'RPC log range too large' : 'RPC request failed' });
}

export function adaptiveLogRangeAfter({ range, outcome, minRange = ADAPTIVE_MIN_LOG_RANGE, maxRange = ADAPTIVE_MAX_LOG_RANGE } = {}) {
  if (!Number.isSafeInteger(range) || range < minRange || range > maxRange) throw new TypeError('invalid adaptive log range');
  if (outcome === 'success') return Math.min(maxRange, range * 2);
  if (outcome === 'range_too_large' || outcome === 'rate_limited' || outcome === 'timeout') return Math.max(minRange, Math.floor(range / 2));
  throw new TypeError('invalid adaptive log outcome');
}

export function createAdaptiveLogTransport({ transport, initialRange = 10_000, minRange = ADAPTIVE_MIN_LOG_RANGE, maxRange = ADAPTIVE_MAX_LOG_RANGE, sleep = (ms, signal) => delay(ms, undefined, { signal }), onFailure = () => {}, onRange = () => {} } = {}) {
  if (typeof transport !== 'function') throw new TypeError('log transport is required');
  if (!Number.isSafeInteger(initialRange) || initialRange < minRange || initialRange > maxRange) throw new TypeError('invalid initial log range');
  let range = initialRange; let rateLimitAttempts = 0;
  const call = async (params, signal) => {
    const filter = params?.[0];
    if (!filter || filter.fromBlock == null || filter.toBlock == null) return transport('eth_getLogs', params, signal);
    const from = BigInt(filter.fromBlock); const to = BigInt(filter.toBlock); const all = [];
    for (let start = from; start <= to;) {
      let end = start + BigInt(range) - 1n; if (end > to) end = to;
      try {
        const result = await transport('eth_getLogs', [{ ...filter, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }], signal);
        if (!Array.isArray(result)) throw new Error('invalid RPC logs result');
        all.push(...result); rateLimitAttempts = 0; onRange({ from: String(start), to: String(end), range, outcome: 'success' });
        range = adaptiveLogRangeAfter({ range, outcome: 'success', minRange, maxRange }); start = end + 1n;
      } catch (error) {
        const failure = classifyLocalArcRpcFailure({ method: 'eth_getLogs', fromBlock: start, toBlock: end, error });
        onFailure(failure);
        if (failure.kind === 'rate_limited') { rateLimitAttempts += 1; if (rateLimitAttempts > 3) throw error; range = adaptiveLogRangeAfter({ range, outcome: 'rate_limited', minRange, maxRange }); await sleep(failure.retryAfterMs ?? (250 * (2 ** (rateLimitAttempts - 1))), signal); continue; }
        if (failure.kind === 'range_too_large' && start < end && range > minRange) { range = adaptiveLogRangeAfter({ range, outcome: failure.kind, minRange, maxRange }); continue; }
        if (failure.kind === 'timeout' && start < end && range > minRange) { range = adaptiveLogRangeAfter({ range, outcome: failure.kind, minRange, maxRange }); continue; }
        throw error;
      }
    }
    return all;
  };
  const wrapped = (method, params = [], signal) => method === 'eth_getLogs' ? call(params, signal) : transport(method, params, signal);
  Object.defineProperty(wrapped, 'range', { get: () => range });
  return wrapped;
}

export function adaptiveBatchSizeAfter({ batchSize, outcome, minBatchSize = ADAPTIVE_MIN_BATCH, maxBatchSize = ADAPTIVE_MAX_BATCH } = {}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < minBatchSize || batchSize > maxBatchSize) throw new TypeError('invalid adaptive batch size');
  if (outcome === 'success') return Math.min(maxBatchSize, Math.max(minBatchSize, batchSize * 2));
  if (outcome === 'degraded') return Math.max(minBatchSize, Math.floor(batchSize / 2));
  throw new TypeError('invalid adaptive outcome');
}

export async function createAdaptiveLocalArcSync({ initialBatchSize = 25, maxBatchSize = ADAPTIVE_MAX_BATCH, maxAttempts = 1, totalBudgetMs = 60_000, makeIndexer, now = Date.now, onAttempt = () => {} } = {}) {
  if (typeof makeIndexer !== 'function') throw new TypeError('adaptive indexer factory is required');
  if (!Number.isSafeInteger(initialBatchSize) || initialBatchSize < ADAPTIVE_MIN_BATCH || initialBatchSize > maxBatchSize) throw new TypeError('invalid initial adaptive batch size');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new TypeError('invalid adaptive attempt count');
  const started = now();
  let batchSize = initialBatchSize;
  let last = { status: 'degraded', cursor: null, error: new Error('adaptive sync did not run') };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const remaining = totalBudgetMs - (now() - started);
    if (remaining <= 0) break;
    const indexer = makeIndexer({ batchSize, totalBudgetMs: remaining });
    const before = typeof indexer.cursor === 'function' ? await indexer.cursor() : null;
    const result = await indexer.syncOnce();
    last = result;
    const after = result?.cursor ?? (typeof indexer.health === 'function' ? indexer.health()?.cursor : null);
    const advanced = Boolean(after && (!before || String(after.blockNumber) !== String(before.blockNumber) || String(after.blockHash).toLowerCase() !== String(before.blockHash).toLowerCase()));
    const verifiedSuccess = (result?.status === 'healthy' || result?.status === 'catching_up') && (Number(result?.headers) > 0 || advanced);
    const outcome = verifiedSuccess ? 'success' : 'degraded';
    await onAttempt({ attempt: attempt + 1, batchSize, result, outcome });
    if (verifiedSuccess && result.status === 'healthy') break;
    batchSize = adaptiveBatchSizeAfter({ batchSize, outcome, maxBatchSize });
  }
  return { ...last, adaptiveBatchSize: batchSize };
}

export function createLocalArcTransport({ profile = ARC_TESTNET_PROFILE, fetchImpl = fetch, timeoutMs = 5000, onFailure = () => {} } = {}) {
  if (profile?.rpcUrl !== ARC_RPC_URL) throw new Error('local Arc transport requires the canonical public RPC');
  let id = 0;
  let retryAt = 0; let consecutiveRateLimits = 0;
  const allowed = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_getBlockReceipts', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getCode', 'eth_getStorageAt', 'eth_call']);
  const request = async (method, params, signal) => {
    // Share provider cooldown across all methods, not just log retrieval.
    // Wait in bounded chunks; an outer indexer budget can abort the wait.
    while (retryAt > Date.now()) await delay(Math.min(30000, retryAt - Date.now()), undefined, { signal });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const requestId = ++id;
    try {
      const response = await fetchImpl(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, cache: 'no-store' });
      let payload = null; try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok || payload?.error || payload?.jsonrpc !== '2.0' || payload?.id !== requestId || !Object.hasOwn(payload ?? {}, 'result') || (payload.result === null && !['eth_getTransactionReceipt', 'eth_getTransactionByHash'].includes(method))) {
        const error = new Error('V2_RPC_UNAVAILABLE'); error.code = payload?.error?.code ?? response.status; error.jsonrpcCode = payload?.error?.code; error.httpStatus = response.status;
        const retryAfter = response.headers?.get?.('retry-after');
        if (/^[0-9]+$/.test(String(retryAfter)) && Number.isSafeInteger(Number(retryAfter) * 1000)) error.retryAfterMs = Number(retryAfter) * 1000;
        throw error;
      }
      consecutiveRateLimits = 0;
      return payload.result;
    } catch (error) {
      const singleBlock = method === 'eth_getBlockByNumber' || method === 'eth_getBlockReceipts' ? params?.[0] : null;
      const failure = classifyLocalArcRpcFailure({ method, fromBlock: params?.[0]?.fromBlock ?? singleBlock, toBlock: params?.[0]?.toBlock ?? singleBlock, error });
      if (failure.kind === 'rate_limited') {
        consecutiveRateLimits += 1;
        retryAt = Date.now() + (failure.retryAfterMs ?? Math.min(30000, 1000 * (2 ** Math.min(consecutiveRateLimits - 1, 5))));
      }
      onFailure(failure);
      throw error;
    } finally { clearTimeout(timer); }
  };
  const transport = async (method, params = [], signal) => {
    if (!allowed.has(method) || /(?:send|sign|personal_sign|wallet_)/i.test(method)) throw new Error('V2_RPC_METHOD_DENIED');
    const chain = method === 'eth_chainId' ? await request(method, params, signal) : await request('eth_chainId', [], signal);
    if (typeof chain !== 'string' || chain !== '0x4cef52') throw new Error('V2_RPC_CHAIN_MISMATCH');
    return method === 'eth_chainId' ? chain : request(method, params, signal);
  };
  Object.defineProperty(transport, 'batch', { value: async (requests, signal) => {
    if (!Array.isArray(requests) || requests.length < 1 || requests.length > 40) throw new TypeError('invalid RPC batch');
    if (requests.some((entry) => !allowed.has(entry?.method) || /(?:send|sign|personal_sign|wallet_)/i.test(entry?.method ?? ''))) throw new Error('V2_RPC_METHOD_DENIED');
    const chainRequest = { jsonrpc: '2.0', id: ++id, method: 'eth_chainId', params: [] };
    const payload = [chainRequest, ...requests.map((entry) => ({ jsonrpc: '2.0', id: ++id, method: entry.method, params: entry.params ?? [] }))];
    // A batch is one atomic transport response: validate every response before
    // exposing any result so callers cannot cache a partial historical window.
    while (retryAt > Date.now()) await delay(Math.min(30000, retryAt - Date.now()), undefined, { signal });
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' }, body: JSON.stringify(payload), signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, cache: 'no-store' });
      let body = null; try { body = await response.json(); } catch { body = null; }
      const rows = Array.isArray(body) ? body : null;
      const byId = new Map(rows?.map((row) => [row?.id, row]) ?? []);
      const expected = payload.map((entry) => entry.id);
      if (!response.ok || !rows || rows.length !== expected.length || new Set(expected).size !== expected.length || byId.size !== expected.length || expected.some((requestId) => !byId.has(requestId)) || rows.some((row) => row?.jsonrpc !== '2.0' || row?.error || !Object.hasOwn(row ?? {}, 'result')) || byId.get(chainRequest.id)?.result !== '0x4cef52') {
        const error = new Error('V2_RPC_UNAVAILABLE'); error.code = rows?.find((row) => row?.error)?.error?.code ?? response.status; error.jsonrpcCode = rows?.find((row) => row?.error)?.error?.code; error.httpStatus = response.status;
        const retryAfter = response.headers?.get?.('retry-after'); if (/^[0-9]+$/.test(String(retryAfter)) && Number.isSafeInteger(Number(retryAfter) * 1000)) error.retryAfterMs = Number(retryAfter) * 1000;
        throw error;
      }
      consecutiveRateLimits = 0;
      return requests.map((entry, index) => byId.get(payload[index + 1].id).result);
    } catch (error) {
      const failure = classifyLocalArcRpcFailure({ method: 'batch', error });
      if (failure.kind === 'rate_limited') { consecutiveRateLimits += 1; retryAt = Date.now() + (failure.retryAfterMs ?? Math.min(30000, 1000 * (2 ** Math.min(consecutiveRateLimits - 1, 5)))); }
      onFailure(failure); throw error;
    } finally { clearTimeout(timer); }
  } });
  return transport;
}

export { createLocalArcPrefetchTransport };

function boundedInteger(value, name, min, max) {
  if (!/^[0-9]+$/.test(String(value))) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} is out of bounds`);
  return parsed;
}
export const LOCAL_ARC_ENGINES = Object.freeze(['finalized-log-range', 'legacy-receipt-bloom']);
function engineName(value) {
  if (!LOCAL_ARC_ENGINES.includes(value)) throw new Error('engine must be finalized-log-range or legacy-receipt-bloom');
  return value;
}
export function options(argv = process.argv.slice(2), env = process.env) {
  const values = {
    // Production local runner default: explicit log-only finalized-range engine.
    // legacy-receipt-bloom keeps the unchanged dense core path selectable.
    engine: engineName(env.V2_LOCAL_ARC_ENGINE ?? 'finalized-log-range'),
    logRange: boundedInteger(env.V2_LOCAL_ARC_LOG_RANGE ?? MAX_FINALIZED_LOG_RANGE, 'log range', 1, MAX_FINALIZED_LOG_RANGE),
    maxRanges: boundedInteger(env.V2_LOCAL_ARC_MAX_RANGES ?? 16, 'max ranges', 1, 64),
    concurrency: boundedInteger(env.V2_LOCAL_ARC_CONCURRENCY ?? 1, 'concurrency', 1, 2),
    // Arc is already millions of blocks past deployment. Keep each committed
    // range small enough to fit the indexer's bounded 60s RPC budget; callers
    // can raise this only explicitly after measuring their endpoint.
    batchSize: boundedInteger(env.V2_LOCAL_ARC_BATCH_SIZE ?? 25, 'batch size', 1, 1000),
    maxBatches: boundedInteger(env.V2_LOCAL_ARC_MAX_BATCHES ?? 1, 'max batches', 1, 8),
    confirmations: boundedInteger(env.V2_LOCAL_ARC_CONFIRMATIONS ?? 32, 'confirmations', 0, Number.MAX_SAFE_INTEGER),
    retries: boundedInteger(env.V2_LOCAL_ARC_RETRIES ?? 2, 'retries', 0, 5),
    timeoutMs: boundedInteger(env.V2_LOCAL_ARC_RPC_TIMEOUT_MS ?? 5000, 'RPC timeout', 1, 5000),
    totalBudgetMs: boundedInteger(env.V2_LOCAL_ARC_TOTAL_BUDGET_MS ?? 60000, 'RPC budget', 1, 60000),
    intervalMs: boundedInteger(env.V2_LOCAL_ARC_INTERVAL_MS ?? 1000, 'interval', 100, 3_600_000),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const engineMatch = String(argv[i]).match(/^--engine=(.+)$/);
    if (engineMatch) { values.engine = engineName(engineMatch[1]); continue; }
    const rangeMatch = String(argv[i]).match(/^--(log-range|max-ranges|concurrency)=(.+)$/);
    if (rangeMatch) {
      const key = { 'log-range': 'logRange', 'max-ranges': 'maxRanges', concurrency: 'concurrency' }[rangeMatch[1]];
      const bounds = { logRange: [1, MAX_FINALIZED_LOG_RANGE], maxRanges: [1, 64], concurrency: [1, 2] }[key];
      values[key] = boundedInteger(rangeMatch[2], key, ...bounds);
      continue;
    }
    const match = String(argv[i]).match(/^--(batch-size|max-batches|confirmations|retries|rpc-timeout-ms|total-budget-ms|interval-ms)=(.+)$/);
    if (!match) { if (argv[i] === '--help') return { help: true }; if (argv[i]) throw new Error(`unknown option: ${argv[i]}`); continue; }
    const key = { 'batch-size': 'batchSize', 'max-batches': 'maxBatches', confirmations: 'confirmations', retries: 'retries', 'rpc-timeout-ms': 'timeoutMs', 'total-budget-ms': 'totalBudgetMs', 'interval-ms': 'intervalMs' }[match[1]];
    const bounds = { batchSize: [1, 1000], maxBatches: [1, 8], confirmations: [0, Number.MAX_SAFE_INTEGER], retries: [0, 5], timeoutMs: [1, 5000], totalBudgetMs: [1, 60000], intervalMs: [100, 3_600_000] }[key];
    values[key] = boundedInteger(match[2], key, ...bounds);
  }
  return values;
}

function health(indexer) {
  const raw = indexer.health();
  const timestamp = typeof raw.lastSyncedAt === 'string' ? Date.parse(raw.lastSyncedAt) : NaN;
  const fresh = raw.status === 'healthy' && raw.stale === false && raw.gap == null && Number.isFinite(timestamp) && Date.now() - timestamp >= 0 && Date.now() - timestamp <= MAX_HEALTH_AGE_MS;
  const originalStatus = raw.status === 'healthy' || raw.status === 'catching_up' || raw.status === 'degraded' ? raw.status : 'unavailable';
  const status = fresh ? 'healthy' : (originalStatus === 'unavailable' ? 'unavailable' : 'degraded');
  return { ...raw, status, freshStatus: status, originalStatus, stale: !fresh, cursor: raw.cursor ?? null };
}


function json(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }

async function startFinalizedEngine({ config, pool, db, store, baseTransport, wire, lastFailure, env }) {
  // Prefetch/receipt batching is superseded and never wired into this engine:
  // its transport wrapper structurally denies receipt methods.
  const readerFactory = ({ transport: readerTransport = baseTransport, ...readerOptions } = {}) => createV2ChainReader({ ...readerOptions, transport: readerTransport, profile: ARC_TESTNET_PROFILE, chainId: ARC_TESTNET_PROFILE.canonicalChainId, marketplace: ARC_TESTNET_PROFILE.marketplace, vault: ARC_TESTNET_PROFILE.vault });
  const indexer = createLocalArcFinalizedIndexer({ db, transport: baseTransport, store, readerFactory, profile: ARC_TESTNET_PROFILE, logRange: config.logRange, maxRanges: config.maxRanges, concurrency: config.concurrency, totalBudgetMs: config.totalBudgetMs, confirmations: config.confirmations, allowConfirmationFallback: false });
  let reportedHealth = indexer.health();
  let stopped = false; let syncPromise = null;
  const sync = () => {
    if (!syncPromise) syncPromise = indexer.syncOnce().finally(() => { reportedHealth = { ...indexer.health(), lastRPCFailure: lastFailure() }; syncPromise = null; });
    return syncPromise;
  };
  const server = http.createServer((request, response) => {
    if (request.url === '/health' && request.method === 'GET') return json(response, 200, { ...health({ health: () => reportedHealth }), engine: LOCAL_ARC_FINALIZED_ENGINE, verificationMode: LOCAL_ARC_FINALIZED_VERIFICATION_MODE, finalityTrust: reportedHealth.finalityTrust ?? null, evidence: FINALIZED_EVIDENCE, transportMode: 'scalar', prefetch: env.V2_LOCAL_ARC_PREFETCH === '1' ? 'ignored-superseded' : 'off', wire: { requests: wire.requests, byMethod: { ...wire.byMethod } } });
    return json(response, 404, { error: 'NOT_FOUND' });
  });
  let timer = null;
  const stop = async () => { if (stopped) return; stopped = true; clearInterval(timer); await syncPromise?.catch(() => {}); await new Promise((resolve) => server.close(resolve)); await pool.end(); };
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, HOST, resolve); });
  timer = setInterval(() => { if (!stopped) void sync().catch(() => {}); }, config.intervalMs);
  await sync().catch(() => {});
  return Object.freeze({ server, pool, db, indexer, sync, stop, config });
}

export async function startLocalArcIndexer({ env = process.env, argv = process.argv.slice(2) } = {}) {
  if (env.V2_LOCAL_ARC !== '1' || env.V2_CHAIN_PROFILE !== 'arc-testnet' || env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) throw new Error('local Arc indexer requires V2_LOCAL_ARC=1, V2_CHAIN_PROFILE=arc-testnet, and no Vercel environment');
  const config = options(argv, env);
  if (config.help) return null;
  const pool = new Pool({ host: HOST, port: 54329, user: 'postgres', database: 'postgres', ssl: false, max: 1 });
  const db = createPgDb({ pool });
  try {
    await verifyLocalArcMigrations(db);
    // The public endpoint requires a browser-like User-Agent. Keep this
    // transport local to this bounded runner; canonical transport/core stays
    // unchanged and all indexer validation remains in createV2Indexer.
    let lastRPCFailure = null;
    // Wire-level counter: every HTTP POST to the public RPC (including the
    // per-method eth_chainId guard). Exposed in /health for runtime benchmarks.
    const wire = { requests: 0, byMethod: Object.create(null) };
    const countingFetch = (url, init) => {
      wire.requests += 1;
      try { const body = JSON.parse(init?.body ?? 'null'); for (const entry of Array.isArray(body) ? body : [body]) if (typeof entry?.method === 'string') wire.byMethod[entry.method] = (wire.byMethod[entry.method] ?? 0) + 1; } catch { /* count request only */ }
      return fetch(url, init);
    };
    const baseTransport = createLocalArcTransport({ profile: ARC_TESTNET_PROFILE, fetchImpl: countingFetch, timeoutMs: config.timeoutMs, onFailure: (failure) => { lastRPCFailure = failure; } });
    const store = createV2IndexerStore({ db, profile: ARC_TESTNET_PROFILE, chainId: Number(ARC_TESTNET_PROFILE.canonicalChainId), marketplace: ARC_TESTNET_PROFILE.marketplace, vault: ARC_TESTNET_PROFILE.vault });
    if (config.engine === 'finalized-log-range') return await startFinalizedEngine({ config, pool, db, store, baseTransport, wire, lastFailure: () => lastRPCFailure, env });
    const sparseHistory = await db.query("SELECT 1 FROM v2_indexer_blocks_fork WHERE chain_id=$1 AND stream='marketplace' AND canonical AND header->>'verificationMode'=$2 LIMIT 1", [Number(ARC_TESTNET_PROFILE.canonicalChainId), LOCAL_ARC_FINALIZED_VERIFICATION_MODE]);
    if (sparseHistory.rows.length) throw new Error('LEGACY_RECEIPT_BLOOM_REQUIRES_FULL_HISTORY_REPLAY');
    const logTransport = createAdaptiveLogTransport({ transport: baseTransport, initialRange: 10_000, onFailure: (failure) => { lastRPCFailure = failure; }, onRange: () => {} });
    const prefetchEnabled = env.V2_LOCAL_ARC_PREFETCH === '1';
    const transport = prefetchEnabled ? createLocalArcPrefetchTransport({ transport: logTransport, batchTransport: baseTransport.batch }) : Object.assign(logTransport, { clear() {} });
    const runtimeMaxBatch = prefetchEnabled ? 100 : ADAPTIVE_MAX_BATCH;
    const readerFactory = ({ transport: readerTransport = transport, ...readerOptions } = {}) => createV2ChainReader({ ...readerOptions, transport: readerTransport, profile: ARC_TESTNET_PROFILE, chainId: ARC_TESTNET_PROFILE.canonicalChainId, marketplace: ARC_TESTNET_PROFILE.marketplace, vault: ARC_TESTNET_PROFILE.vault });
    let currentIndexer = null;
    let reportedHealth = { status: 'starting', stale: true, gap: null, cursor: null };
    let adaptiveBatchSize = Math.min(config.batchSize, runtimeMaxBatch);
    let stopped = false;
    let syncPromise = null;
    const sync = () => {
      if (!syncPromise) syncPromise = createAdaptiveLocalArcSync({
        initialBatchSize: adaptiveBatchSize,
        maxBatchSize: runtimeMaxBatch,
        maxAttempts: config.maxBatches,
        totalBudgetMs: config.totalBudgetMs,
        makeIndexer: ({ batchSize, totalBudgetMs }) => {
          transport.clear();
          currentIndexer = createV2Indexer({ db, profile: ARC_TESTNET_PROFILE, transport, store, readerFactory, batchSize, maxBatches: 1, confirmations: config.confirmations, retries: config.retries, timeoutMs: config.timeoutMs, totalBudgetMs });
          return currentIndexer;
        },
        onAttempt: ({ result }) => { if (result?.status === 'degraded') transport.clear(); if (currentIndexer) reportedHealth = { ...currentIndexer.health(), lastRPCFailure }; },
      }).then((result) => { adaptiveBatchSize = result.adaptiveBatchSize; reportedHealth = { ...(currentIndexer?.health() ?? reportedHealth), lastRPCFailure }; return result; }).catch((error) => { transport.clear(); throw error; }).finally(() => { syncPromise = null; });
      return syncPromise;
    };
    const server = http.createServer(async (request, response) => {
      if (request.url === '/health' && request.method === 'GET') return json(response, 200, { ...health({ health: () => reportedHealth }), engine: 'legacy-receipt-bloom', verificationMode: 'dense-headers+receipts+logs-bloom', finalityTrust: reportedHealth.finalityMode ?? null, transportMode: prefetchEnabled ? 'prefetch20' : 'scalar', headerBatchLimit: runtimeMaxBatch, wire: { requests: wire.requests, byMethod: { ...wire.byMethod } } });

      return json(response, 404, { error: 'NOT_FOUND' });
    });
    const stop = async () => { if (stopped) return; stopped = true; clearInterval(timer); await syncPromise?.catch(() => {}); await new Promise((resolve) => server.close(resolve)); await pool.end(); };
    const timer = setInterval(() => { if (!stopped) void sync().catch(() => {}); }, config.intervalMs);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, HOST, resolve); });
    await sync();
    return Object.freeze({ server, pool, db, indexer: currentIndexer, sync, stop, config });
  } catch (cause) {
    await pool.end().catch(() => {});
    throw cause;
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--help')) { console.log('v2-local-arc-indexer.mjs [--engine=finalized-log-range|legacy-receipt-bloom] [--log-range=N<=10000] [--max-ranges=N] [--concurrency=1|2] [--batch-size=N] [--max-batches=N] [--confirmations=N] [--interval-ms=N]'); process.exit(0); }
  let runtime;
  let shutdownRequested = false;
  const shutdown = () => {
    shutdownRequested = true;
    if (runtime) void runtime.stop().finally(() => { process.exitCode = 0; });
  };
  startLocalArcIndexer().then((value) => {
    runtime = value;
    if (shutdownRequested) void runtime.stop().finally(() => { process.exitCode = 0; });
  }).catch((error) => { console.error(error?.message ?? 'local Arc indexer failed'); process.exitCode = 1; });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.on('message', message => { if (message === 'shutdown') shutdown(); });
}
