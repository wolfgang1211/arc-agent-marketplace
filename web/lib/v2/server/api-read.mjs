import { getAddress, decodeEventLog } from 'viem';
import manifest from '../action-manifest.json' with { type: 'json' };
import { ARC_TESTNET_PROFILE, assertV2Profile, toPublicV2Profile } from '../chain-profile.mjs';
import { INDEXER_CHAIN_ID, INDEXER_EVENT_SOURCES } from '../indexer-events.mjs';

const CHAIN_ID = Number(INDEXER_CHAIN_ID);
const MARKETPLACE = getAddress(INDEXER_EVENT_SOURCES.marketplace);
const VERSION = 'v2';
const BASE_PATH = '/api/v2';
const UINT256_MAX = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const QUERY_KEYS = new Set(['limit', 'cursor']);
const MAX_URL_LENGTH = 4096;
const MAX_TOKEN_LENGTH = 256;
const JOB_COLUMNS = Object.freeze(['chain_id', 'marketplace', 'job_id', 'reward', 'status', 'state_version', 'terms_hash', 'client', 'operator', 'resolver', 'source_block', 'source_hash', 'data']);
const HEALTH_CODES = new Set(['READER_UNAVAILABLE', 'STALE_READER', 'INDEXER_GAP', 'DATABASE_UNAVAILABLE']);
class ReadApiError extends Error { constructor(code) { super(); this.code = code; } }
const fail = (code) => { throw new ReadApiError(code); };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
function error(code, status) { return json({ error: code }, status); }
function envelope(data) { return { source: { chainId: CHAIN_ID, marketplace: MARKETPLACE, version: VERSION }, data }; }
function text(value, fallback = null) { return value == null ? fallback : String(value); }
function own(value, key) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined; } catch { return undefined; }
}
function boundedString(value, max = 512) { return typeof value === 'string' && value.length <= max ? value : undefined; }
function uintString(value) { return typeof value === 'string' && DECIMAL.test(value) && value.length <= 78 && BigInt(value) <= UINT256_MAX ? value : undefined; }
function hashString(value) { return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : undefined; }
function publicData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const key of ['createdAt', 'applyBy', 'deliveryDuration', 'deliveryDeadline', 'reviewDeadline', 'correctionDeadline']) { const v = uintString(own(value, key)); if (v !== undefined) out[key] = v; }
  for (const key of ['criteriaHash', 'descriptionHash']) { const v = hashString(own(value, key)); if (v !== undefined) out[key] = v; }
  for (const key of ['testJob', 'house']) { const v = own(value, key); if (typeof v === 'boolean') out[key] = v; }
  return out;
}
function publicDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const key of ['title', 'summary', 'description', 'category']) { const v = boundedString(own(value, key)); if (v !== undefined) out[key] = v; }
  const criteria = own(value, 'criteria');
  if (criteria !== undefined) {
    if (!Array.isArray(criteria) || criteria.length > 32 || criteria.some((v) => boundedString(v, 1024) === undefined)) return null;
    out.criteria = criteria.map((v) => v);
  }
  return Object.keys(out).length ? out : null;
}
function job(row, document = null) {
  const out = {
    chainId: text(row.chain_id), marketplace: text(row.marketplace), jobId: text(row.job_id),
    reward: text(row.reward), status: text(row.status), stateVersion: text(row.state_version),
    termsHash: text(row.terms_hash), client: text(row.client), operator: text(row.operator), resolver: text(row.resolver),
    sourceBlock: text(row.source_block), sourceHash: text(row.source_hash), data: publicData(row.data),
  };
  if (document) out.document = document;
  return out;
}
function parseQuery(url) {
  const seen = new Set();
  for (const [key] of url.searchParams) {
    if (!QUERY_KEYS.has(key) || seen.has(key)) fail('BAD_QUERY');
    seen.add(key);
  }
  let limit = DEFAULT_LIMIT;
  if (seen.has('limit')) {
    const raw = url.searchParams.get('limit');
    if (typeof raw !== 'string' || raw.length > MAX_TOKEN_LENGTH || !/^(?:[1-9][0-9]*)$/.test(raw) || Number(raw) > MAX_LIMIT) fail('BAD_QUERY');
    limit = Number(raw);
  }
  let cursor = null;
  if (seen.has('cursor')) {
    const raw = url.searchParams.get('cursor');
    if (typeof raw !== 'string' || raw.length > 78 || !DECIMAL.test(raw)) fail('BAD_QUERY');
    cursor = BigInt(raw);
    if (cursor < 1n || cursor > UINT256_MAX) fail('BAD_QUERY');
  }
  return { limit, cursor };
}
function parseId(raw) {
  if (typeof raw !== 'string' || raw.length > 78 || !DECIMAL.test(raw)) fail('BAD_ID');
  const id = BigInt(raw);
  if (id < 1n || id > UINT256_MAX) fail('BAD_ID');
  return raw;
}
function fixedContext(db, profile = ARC_TESTNET_PROFILE) {
  return [Number(profile.canonicalChainId), profile.marketplace];
}
async function publicDocumentFor(db, jobId, profile = ARC_TESTNET_PROFILE) {
  const result = await db.query('SELECT content, visibility FROM v2_job_documents WHERE chain_id = $1 AND marketplace = $2 AND job_id = $3 AND visibility = $4 ORDER BY version DESC LIMIT 1', [...fixedContext(db, profile), jobId, 'public']);
  if (!result.rows.length) return null;
  return publicDocument(result.rows[0].content);
}
function safeHealth(input) {
  const value = input && typeof input === 'object' ? input : {};
  const statusValue = own(value, 'status');
  const status = statusValue === 'healthy' || statusValue === 'degraded' || statusValue === 'unavailable' ? statusValue : 'unavailable';
  const gapValue = own(value, 'gap');
  const gap = gapValue == null ? null : Number.isSafeInteger(gapValue) && gapValue >= 0 ? gapValue : typeof gapValue === 'object' && uintString(own(gapValue, 'from')) && (own(gapValue, 'to') === null || uintString(own(gapValue, 'to'))) ? { from: own(gapValue, 'from'), to: own(gapValue, 'to'), reason: 'pending_verified_range' } : 0;
  const staleValue = own(value, 'stale');
  const stale = typeof staleValue === 'boolean' ? staleValue : true;
  const readerValue = own(value, 'reader');
  const reader = readerValue === 'available' || readerValue === 'stale' || readerValue === 'unavailable' ? readerValue : 'unavailable';
  const codeValue = own(value, 'code');
  const code = typeof codeValue === 'string' && HEALTH_CODES.has(codeValue) ? codeValue : null;
  return { status, gap, stale, reader, code };
}
function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
function expectedState(intent, actual) {
  const expected = intent.expected;
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return null;
  const state = { ...expected };
  if (expected.action === 'postJob') {
    if (!actual || !actual.jobId || !same(actual.client, expected.client) || !same(actual.criteriaHash, expected.criteriaHash) || !same(actual.descriptionHash, expected.descriptionHash) || !same(actual.canonicalTermsHash, expected.termsHash)) return null;
    return { action: 'postJob', jobId: String(actual.jobId), client: String(actual.client).toLowerCase(), criteriaHash: String(actual.criteriaHash).toLowerCase(), descriptionHash: String(actual.descriptionHash).toLowerCase(), termsHash: String(actual.canonicalTermsHash).toLowerCase() };
  }
  if (expected.jobId !== undefined) {
    if (!actual || String(actual.jobId) !== String(expected.jobId) || String(actual.stateVersion) !== String(expected.stateVersion) || Number(actual.status) !== Number(expected.status)) return null;
    for (const role of ['client', 'operator', 'resolver']) if (expected[role] !== null && expected[role] !== undefined && !same(actual[role], expected[role])) return null;
    return { action: expected.action, jobId: String(actual.jobId), stateVersion: String(actual.stateVersion), status: Number(actual.status), ...(actual.client ? { client: String(actual.client).toLowerCase() } : {}), ...(actual.operator ? { operator: String(actual.operator).toLowerCase() } : {}), ...(actual.resolver ? { resolver: String(actual.resolver).toLowerCase() } : {}) };
  }
  if (!actual || typeof actual !== 'object') return null;
  for (const key of Object.keys(expected)) if (key !== 'action' && key !== 'wallet' && actual[key] !== undefined && String(actual[key]).toLowerCase() !== String(expected[key]).toLowerCase()) return null;
  for (const key of Object.keys(expected)) if (key !== 'action' && key !== 'wallet' && actual[key] === undefined && !['walletTokenIncrease', 'liabilityDecrease', 'stakeLiabilityDelta'].includes(key)) return null;
  return { ...expected, ...(actual.freeStake !== undefined ? { freeStake: String(actual.freeStake) } : {}), ...(actual.reservedStake !== undefined ? { reservedStake: String(actual.reservedStake) } : {}), ...(actual.credits !== undefined ? { credits: String(actual.credits) } : {}) };
}

export function createV2ReadApi({ db, getHealth, profile = ARC_TESTNET_PROFILE, transport, auth, readerFactory } = {}) {
  assertV2Profile(profile);
  const envelope = (data) => ({ source: { chainId: Number(profile.canonicalChainId), marketplace: profile.marketplace, version: VERSION }, data });
  if (!db || typeof db.query !== 'function') throw new TypeError('db with query() is required');
  if (getHealth !== undefined && typeof getHealth !== 'function') throw new TypeError('getHealth must be a function');
  return async function handle(request) {
    try {
      if (typeof request?.url !== 'string' || request.url.length > MAX_URL_LENGTH) return error('INVALID_QUERY', 400);
      const url = new URL(request.url);
      const parts = url.pathname.split('/').slice(1);
      if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 405);
      if (url.pathname.endsWith('/') || url.pathname.includes('//') || url.pathname.includes('%') || parts.some((part) => part === '') || parts[0] !== 'api' || parts[1] !== 'v2') return error('NOT_FOUND', 404);
      if (parts.length === 3 && parts[2] === 'profile') return url.search ? error('INVALID_QUERY', 400) : json({ profile: toPublicV2Profile(profile) });
      if (parts.length === 4 && parts[2] === 'transactions') {
        if ([...url.searchParams.keys()].some((key) => key !== 'intent') || url.searchParams.getAll('intent').length !== 1) return error('INVALID_QUERY', 400);
        const txHash = parts[3]; const intentId = url.searchParams.get('intent');
        if (!/^0x[0-9a-fA-F]{64}$/.test(txHash) || !intentId || !/^[0-9a-f-]{36}$/i.test(intentId)) return error('INVALID_QUERY', 400);
        let found = await db.query('SELECT payload,actor_wallet FROM v2_audit_events WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at DESC LIMIT 1', ['transaction-intent', intentId]);
        let intent = found.rows[0]?.payload;
        if (!intent) { found = await db.query("SELECT payload,actor_wallet FROM v2_audit_events WHERE entity_type='job-draft' ORDER BY created_at DESC"); const match = found.rows.find((row) => row.payload?.intent?.intentId === intentId || row.payload?.intent?.id === intentId); intent = match?.payload?.intent; }
        if (!intent || (intent.intentId ?? intent.id) !== intentId || intent.profile !== profile.name || String(intent.chainId) !== profile.canonicalChainId.toString()) return error('NOT_FOUND', 404);
        if (!auth || typeof auth.authenticateRequest !== 'function') return error('INVALID_SESSION', 401);
        let session; try { session = await auth.authenticateRequest(request); } catch { return error('INVALID_SESSION', 401); }
        const owner = session?.session?.wallet ?? session?.wallet;
        if (!owner || !same(owner, intent.wallet)) return error('FORBIDDEN', 403);
        if (typeof transport !== 'function' || typeof readerFactory !== 'function') return error('READER_UNAVAILABLE', 503);
        let receipt; let transaction;
        try { [receipt, transaction] = await Promise.all([transport('eth_getTransactionReceipt', [txHash]), transport('eth_getTransactionByHash', [txHash])]); } catch { return error('READER_UNAVAILABLE', 503); }
        if (!receipt || !transaction) return json({ status: 'pending', intentId, profile: profile.name }, 200);
        const bound = intent.transaction ?? intent;
        if (String(transaction.from).toLowerCase() !== String(bound.from ?? intent.wallet).toLowerCase() || String(transaction.to).toLowerCase() !== String(bound.to ?? intent.to).toLowerCase() || BigInt(transaction.value ?? '0x0') !== BigInt(bound.value ?? '0') || String(transaction.input ?? transaction.data).toLowerCase() !== String(bound.data ?? intent.data).toLowerCase()) return error('INTENT_MISMATCH', 409);
        if (String(transaction.chainId ?? `0x${profile.canonicalChainId.toString(16)}`).toLowerCase() !== `0x${profile.canonicalChainId.toString(16)}` && BigInt(transaction.chainId) !== profile.canonicalChainId) return error('INTENT_MISMATCH', 409);
        if (String(receipt.to).toLowerCase() !== String(bound.to ?? intent.to).toLowerCase() || String(receipt.from).toLowerCase() !== String(bound.from ?? intent.wallet).toLowerCase() || String(receipt.transactionHash).toLowerCase() !== txHash.toLowerCase() || String(receipt.blockHash).length !== 66) return error('INTENT_MISMATCH', 409);
        if (String(receipt.status).toLowerCase() !== '0x1' && String(receipt.status).toLowerCase() !== 'success') return json({ status: 'reverted', intentId }, 200);
        const h = safeHealth(await (getHealth ? getHealth() : {}));
        if (h.status !== 'healthy' || h.stale !== false || h.gap !== null) return error('INDEXER_UNAVAILABLE', 503);
        const canonical = await db.query("SELECT block_hash FROM v2_indexer_blocks_fork WHERE chain_id=$1 AND stream='marketplace' AND block_number=$2 AND block_hash=$3 AND canonical=TRUE", [profile.canonicalChainId.toString(), BigInt(receipt.blockNumber), String(receipt.blockHash).toLowerCase()]);
        const cursor = await db.query('SELECT cursor FROM v2_indexer_cursors WHERE chain_id=$1 AND marketplace=$2', [profile.canonicalChainId.toString(), profile.marketplace]);
        let indexedCursor = cursor.rows[0]?.cursor;
        if (typeof indexedCursor === 'string') { try { indexedCursor = JSON.parse(indexedCursor); } catch { return error('INDEXER_UNAVAILABLE', 503); } }
        const cursorBlock = indexedCursor?.blockNumber ?? indexedCursor?.block_number;
        if (!canonical.rows.length || cursorBlock == null || BigInt(cursorBlock) < BigInt(receipt.blockNumber)) return error('INDEXER_UNAVAILABLE', 503);
        const snap = await readerFactory({ toBlockTag: `0x${BigInt(receipt.blockNumber).toString(16)}` }).read();
        if (BigInt(snap.chainId) !== profile.canonicalChainId || String(snap.blockHash).toLowerCase() !== String(receipt.blockHash).toLowerCase()) return error('READER_MISMATCH', 503);
        let actual;
        if (intent.action === 'postJob') {
          const item = (receipt.logs ?? []).find((log) => String(log.address).toLowerCase() === profile.marketplace.toLowerCase());
          if (!item) return error('READBACK_MISMATCH', 409);
          try { const decoded = decodeEventLog({ abi: [...manifest.contracts.marketplace.abi, ...(manifest.contracts.marketplace.events ?? [])], data: item.data, topics: item.topics }); const a = decoded.args ?? {}; actual = { jobId: a.id ?? a.jobId, client: a.client ?? a.owner ?? intent.wallet, criteriaHash: a.criteriaHash, descriptionHash: a.descriptionHash }; } catch { return error('READBACK_MISMATCH', 409); }
          if (!actual.jobId || typeof snap.readJob !== 'function') return error('READBACK_MISMATCH', 409);
          const job = await snap.readJob(BigInt(actual.jobId)); actual = { ...actual, ...job, jobId: String(actual.jobId) };
        } else if (intent.expected?.jobId !== undefined) { if (typeof snap.readJob !== 'function') return error('READER_UNAVAILABLE', 503); actual = { ...(await snap.readJob(BigInt(intent.expected.jobId))), jobId: String(intent.expected.jobId) }; }
        else if (typeof snap.readAccount === 'function') actual = await snap.readAccount(intent.wallet);
        else return error('READER_UNAVAILABLE', 503);
        const state = expectedState(intent, actual);
        if (!state) return error('READBACK_MISMATCH', 409);
        return json({ ok: true, intentId, confirmed: true, hash: txHash.toLowerCase(), profileId: profile.name, chainId: profile.canonicalChainId.toString(), wallet: intent.wallet, action: intent.action, expected: intent.expected, state });
      }
      const query = parseQuery(url);
      const ctx = fixedContext(db, profile);
      if (parts.length === 3 && parts[2] === 'health') {
        let health = {};
        try { health = getHealth ? await getHealth() : {}; } catch { health = {}; }
        return json(envelope(safeHealth(health)));
      }
      if (parts.length === 3 && parts[2] === 'jobs') {
        const { limit, cursor } = query;
        const params = [...ctx];
        let where = 'chain_id = $1 AND marketplace = $2';
        if (cursor !== null) { params.push(cursor.toString()); where += ` AND job_id > $${params.length}`; }
        params.push(limit + 1);
        const result = await db.query(`SELECT ${JOB_COLUMNS.join(', ')} FROM v2_jobs WHERE ${where} ORDER BY job_id ASC LIMIT $${params.length}`, params);
        const hasMore = result.rows.length > limit;
        const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
        const items = [];
        for (const row of rows) items.push(job(row, await publicDocumentFor(db, text(row.job_id), profile)));
        return json(envelope({ items, nextCursor: hasMore ? text(rows.at(-1)?.job_id) : null, count: items.length }));
      }
      if (parts.length === 4 && parts[2] === 'jobs') {
        const id = parseId(parts[3]);
        const result = await db.query(`SELECT ${JOB_COLUMNS.join(', ')} FROM v2_jobs WHERE chain_id = $1 AND marketplace = $2 AND job_id = $3`, [...ctx, id]);
        if (!result.rows.length) return error('NOT_FOUND', 404);
        return json(envelope(job(result.rows[0], await publicDocumentFor(db, id, profile))));
      }
      if (parts.length === 4 && parts[2] === 'accounts') {
        if (typeof parts[3] !== 'string' || parts[3].length !== 42 || !ADDRESS.test(parts[3])) fail('BAD_ADDRESS');
        let address;
        try { address = getAddress(parts[3]); } catch { fail('BAD_ADDRESS'); }
        const [operator, credit] = await Promise.all([
          db.query('SELECT data, state_version FROM v2_operator_projection WHERE chain_id = $1 AND marketplace = $2 AND operator = $3', [...ctx, address]),
          db.query('SELECT balance, data, state_version FROM v2_credit_projection WHERE chain_id = $1 AND marketplace = $2 AND wallet = $3', [...ctx, address]),
        ]);
        const op = operator.rows[0] ?? null;
        const cr = credit.rows[0] ?? null;
        const od = op?.data && typeof op.data === 'object' && !Array.isArray(op.data) ? op.data : {};
        const cd = cr?.data && typeof cr.data === 'object' && !Array.isArray(cr.data) ? cr.data : {};
        const value = {
          address, operator: op ? { stateVersion: text(op.state_version), registered: typeof od.registered === 'boolean' ? od.registered : null, maxActiveJobs: text(od.maxActiveJobs), activeJobs: text(od.activeJobs) } : null,
          credits: cr ? { balance: text(cr.balance), free: text(cd.freeStake), reserved: text(cd.reservedStake), stateVersion: text(cr.state_version) } : null,
          source: cr || op ? { block: null, hash: null } : null,
        };
        return json(envelope(value));
      }
      return error('NOT_FOUND', 404);
    } catch (e) {
      const code = own(e, 'code');
      if (code === 'BAD_QUERY') return error('INVALID_QUERY', 400);
      if (code === 'BAD_ID') return error('INVALID_JOB_ID', 400);
      if (code === 'BAD_ADDRESS') return error('INVALID_ADDRESS', 400);
      return error('INTERNAL_ERROR', 500);
    }
  };
}

export { CHAIN_ID, MARKETPLACE, UINT256_MAX };
