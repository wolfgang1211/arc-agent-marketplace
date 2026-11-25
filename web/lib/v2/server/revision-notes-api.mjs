import { getAddress, keccak256, stringToHex } from 'viem';
import { documentHash } from '../ui-actions.mjs';
import { ARC_TESTNET_PROFILE, assertV2Profile } from '../chain-profile.mjs';

const ZERO = '0x0000000000000000000000000000000000000000';
const UINT256_MAX = (1n << 256n) - 1n;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const METHODS = new Set(['GET', 'POST']);
const MAX_BODY = 64 * 1024;
const MAX_CRITERION = 1024;
const MAX_NOTE = 10000;
const SAFE_ERRORS = new Set(['BAD_BODY', 'BAD_JSON', 'BODY_TOO_LARGE', 'CSRF_INVALID', 'FORBIDDEN', 'INTERNAL_ERROR', 'INVALID_JOB_ID', 'INVALID_SESSION', 'METHOD_NOT_ALLOWED', 'NOT_FOUND', 'ORIGIN_MISMATCH', 'READER_UNAVAILABLE', 'STALE_DATA', 'INVALID_STATUS']);
class RevisionNotesError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }
const fail = (code, status) => { throw new RevisionNotesError(code, status); };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', Vary: 'Cookie' } });
const address = value => { if (typeof value !== 'string' || !ADDRESS.test(value)) return null; try { return getAddress(value).toLowerCase(); } catch { return null; } };
const decimal = (value, code = 'BAD_BODY') => { if (typeof value !== 'string' || value.length > 78 || !DECIMAL.test(value)) fail(code, 400); const n = BigInt(value); if (n > UINT256_MAX) fail(code, 400); return n.toString(); };
const hash = value => typeof value === 'string' && HASH.test(value) ? value.toLowerCase() : null;
const healthy = value => value && value.status === 'healthy' && value.stale === false && value.gap == null;
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const contentHash = value => documentHash(value);
function asDecimal(value, fallback = null) { if (typeof value === 'bigint' && value >= 0n && value <= UINT256_MAX) return value.toString(); if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value); if (typeof value === 'string' && DECIMAL.test(value) && BigInt(value) <= UINT256_MAX) return BigInt(value).toString(); return fallback; }
async function readBody(request) { if (request.headers.get('content-type') !== 'application/json') fail('BAD_BODY', 400); const length = request.headers.get('content-length'); if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) fail('BODY_TOO_LARGE', 413); const reader = request.body?.getReader(); if (!reader) fail('BAD_BODY', 400); const chunks = []; let total = 0; try { while (true) { const item = await reader.read(); if (item.done) break; total += item.value.byteLength; if (total > MAX_BODY) fail('BODY_TOO_LARGE', 413); chunks.push(item.value); } } finally { try { reader.releaseLock(); } catch {} } let value; try { value = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))); } catch { fail('BAD_JSON', 400); } if (!value || typeof value !== 'object' || Array.isArray(value)) fail('BAD_BODY', 400); return value; }
function exactBody(value) { const keys = Object.keys(value); return keys.length === 4 && ['expectedStateVersion', 'deliveryVersion', 'criterionReference', 'note'].every(key => Object.prototype.hasOwnProperty.call(value, key)); }
async function session(auth, request, mutation) { const fn = mutation ? auth?.authorizeMutation : auth?.authenticateRequest; if (typeof fn !== 'function') fail('INVALID_SESSION', 401); let result; try { result = await fn(request); } catch (error) { if (error?.code === 'CSRF_INVALID') fail('CSRF_INVALID', 403); fail('INVALID_SESSION', 401); } const wallet = address(result?.wallet ?? result?.session?.wallet); if (!wallet) fail('INVALID_SESSION', 401); return wallet; }
async function pinnedSnapshot(readerFactory, row) { if (row.source_block == null || !hash(row.source_hash)) fail('READER_UNAVAILABLE', 503); try { const tag = `0x${BigInt(row.source_block).toString(16)}`; const reader = readerFactory({ toBlockTag: tag }); const snapshot = await reader.read(); const job = await snapshot.readJob(BigInt(row.job_id)); if (BigInt(snapshot.chainId) !== BigInt(row.chain_id) || String(snapshot.blockTag).toLowerCase() !== tag.toLowerCase() || snapshot.blockHash?.toLowerCase() !== row.source_hash.toLowerCase()) fail('STALE_DATA', 503); return { snapshot, job }; } catch (error) { if (error instanceof RevisionNotesError) throw error; fail('READER_UNAVAILABLE', 503); } }
function canonicalJob(row, job, profile) {
  const client = address(job?.client); const operator = job?.operator == null || address(job.operator) === ZERO ? null : address(job.operator); const resolver = job?.resolver == null || address(job.resolver) === ZERO ? null : address(job.resolver);
  const stateVersion = asDecimal(job?.stateVersion); const deliveryVersion = asDecimal(job?.deliveryVersion); const requestStateVersion = Number(job?.status) === 3 ? stateVersion : null;
  const correctionDeadline = asDecimal(job?.correctionDeadline); const revisionLimit = asDecimal(job?.revisionLimit); const revisionsUsed = asDecimal(job?.revisionsUsed);
  const termsHash = hash(job?.canonicalTermsHash); const indexedTermsHash = hash(row.terms_hash);
  const status = Number(job?.status);
  if (String(row.chain_id) !== profile.canonicalChainId.toString() || address(row.marketplace) !== profile.marketplace.toLowerCase() || !client || !operator || !resolver || !Number.isInteger(status) || status < 0 || status > 8 || !termsHash || !indexedTermsHash || termsHash !== indexedTermsHash || stateVersion === null || deliveryVersion === null || correctionDeadline === null || revisionLimit === null || revisionsUsed === null || typeof job?.unlimitedRevisions !== 'boolean' || (status === 3 && requestStateVersion === null)) fail('STALE_DATA', 503);
  if (client !== address(row.client) || operator !== address(row.operator) || resolver !== address(row.resolver) || stateVersion !== String(row.state_version) || status !== Number(row.status)) fail('STALE_DATA', 503);
  const criterion = hash(job.revisionCriterionHash); const reference = hash(job.revisionReferenceHash); if (!criterion || !reference) fail('READER_UNAVAILABLE', 503);
  return { chainId: profile.canonicalChainId.toString(), marketplace: profile.marketplace.toLowerCase(), jobId: String(row.job_id), client, operator, resolver, status: Number(job.status), stateVersion, requestStateVersion, deliveryVersion, correctionDeadline, revisionLimit, revisionsUsed, unlimitedRevisions: job.unlimitedRevisions, canonicalTermsHash: termsHash, revisionCriterionHash: criterion, revisionReferenceHash: reference };
}
function noteFromPayload(payload) { return { id: String(payload.id), jobId: String(payload.jobId), expectedStateVersion: String(payload.expectedStateVersion), requestStateVersion: String(payload.requestStateVersion), deliveryVersion: String(payload.deliveryVersion), criterionReference: payload.criterionReference, note: payload.note, criterionHash: payload.criterionHash, referenceHash: payload.referenceHash }; }

export function createV2RevisionNotesApi({ db, auth, readerFactory, getHealth, origin, profile = ARC_TESTNET_PROFILE } = {}) {
  assertV2Profile(profile);
  if (!db?.query || !db?.transaction || typeof readerFactory !== 'function' || typeof getHealth !== 'function' || typeof origin !== 'string') throw new TypeError('db, auth, readerFactory, getHealth and origin are required');
  const context = [profile.canonicalChainId.toString(), profile.marketplace.toLowerCase()];
  async function load(jobId, wallet) {
    let health; try { health = await getHealth(); } catch { health = null; } if (!healthy(health)) fail('STALE_DATA', 503);
    const found = await db.query('SELECT chain_id,marketplace,job_id,state_version,terms_hash,client,operator,resolver,status,source_block,source_hash,data FROM v2_jobs WHERE chain_id=$1 AND LOWER(marketplace)=LOWER($2) AND job_id=$3', [...context, jobId]);
    const row = found.rows[0]; if (!row) fail('NOT_FOUND', 404);
    const { snapshot, job } = await pinnedSnapshot(readerFactory, row); let afterHealth; try { afterHealth = await getHealth(); } catch { afterHealth = null; } if (!healthy(afterHealth)) fail('STALE_DATA', 503);
    const canonicalJobValue = canonicalJob(row, job, profile);
    if (![canonicalJobValue.client, canonicalJobValue.operator, canonicalJobValue.resolver].includes(wallet)) fail('FORBIDDEN', 403);
    return { row, snapshot, job: canonicalJobValue };
  }
  async function post(jobId, request, wallet) {
    const { row, job } = await load(jobId, wallet); if (job.status !== 2 || wallet !== job.client) fail('INVALID_STATUS', 409);
    const value = await readBody(request); if (!exactBody(value)) fail('BAD_BODY', 400);
    const expected = decimal(value.expectedStateVersion); const delivery = decimal(value.deliveryVersion);
    if (expected !== job.stateVersion || delivery !== job.deliveryVersion) fail('STALE_DATA', 503);
    if (typeof value.criterionReference !== 'string' || value.criterionReference.trim().length === 0 || value.criterionReference.length > MAX_CRITERION || typeof value.note !== 'string' || value.note.trim().length === 0 || value.note.length > MAX_NOTE) fail('BAD_BODY', 400);
    const criterionHash = contentHash(value.criterionReference); const referenceHash = contentHash(value.note); const requestStateVersion = (BigInt(expected) + 1n).toString();
    const id = `revision-note:${context[0]}:${context[1]}:${jobId}:${expected}:${delivery}:${criterionHash}:${referenceHash}`;
    const payload = { id, chain: context[0], market: context[1], job: jobId, jobId, canonicalTermsHash: job.canonicalTermsHash, expectedStateVersion: expected, requestStateVersion, deliveryVersion: delivery, criterionReference: value.criterionReference, note: value.note, criterionHash, referenceHash, sourceBlock: String(row.source_block), sourceHash: row.source_hash.toLowerCase() };
    return db.transaction(async tx => {
      const locked = await tx.query('SELECT chain_id,marketplace,job_id,state_version,status,terms_hash,client,operator,resolver,source_block,source_hash FROM v2_jobs WHERE chain_id=$1 AND LOWER(marketplace)=LOWER($2) AND job_id=$3 FOR UPDATE', [...context, jobId]);
      const current = locked.rows[0];
      if (!current || String(current.chain_id) !== job.chainId || String(current.marketplace).toLowerCase() !== job.marketplace || String(current.job_id) !== job.jobId || String(current.state_version) !== job.stateVersion || Number(current.status) !== job.status || String(current.terms_hash).toLowerCase() !== job.canonicalTermsHash || address(current.client) !== job.client || address(current.operator) !== job.operator || address(current.resolver) !== job.resolver || String(current.source_block) !== String(row.source_block) || String(current.source_hash).toLowerCase() !== String(row.source_hash).toLowerCase()) fail('STALE_DATA', 503);
      const inserted = await tx.query('INSERT INTO v2_audit_events(id,actor_wallet,event_type,entity_type,entity_id,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id', [id, wallet, 'revision.note.created', 'job', jobId, payload]);
      const exact = await tx.query('SELECT payload FROM v2_audit_events WHERE id=$1', [id]);
      if (!exact.rows.length) fail('INTERNAL_ERROR', 500);
      return { status: inserted.rows.length ? 201 : 200, body: { note: noteFromPayload(exact.rows[0].payload) } };
    });
  }
  async function get(jobId, wallet) {
    const { row, job } = await load(jobId, wallet); const result = await db.query("SELECT payload FROM v2_audit_events WHERE event_type='revision.note.created' AND entity_type='job' AND entity_id=$1 AND payload->>'chain'=$2 AND LOWER(payload->>'market')=LOWER($3) AND payload->>'job'=$4 ORDER BY created_at ASC, id ASC", [jobId, job.chainId, job.marketplace, jobId]);
    // A fulfilled request no longer sits in the job's active revision slot. Bind it
    // to the canonical, indexed RevisionRequested event instead of the live slot.
    let requested = [];
    try { const ev = await db.query("SELECT decoded FROM v2_indexer_events_fork WHERE chain_id=$1 AND LOWER(emitter)=LOWER($2) AND canonical=true AND event_name='RevisionRequested' AND decoded->'args'->>'jobId'=$3", [Number(profile.canonicalChainId), profile.marketplace, jobId]); requested = ev.rows.map(r => r.decoded?.args ?? {}); } catch { requested = []; }
    const notes = result.rows.map(rowValue => {
      const payload=rowValue.payload;
      const contentMatches=typeof payload?.criterionReference==='string'&&typeof payload?.note==='string'&&payload.criterionHash===contentHash(payload.criterionReference)&&payload.referenceHash===contentHash(payload.note);
      const identityMatches=payload?.chain===job.chainId&&String(payload?.market??'').toLowerCase()===job.marketplace&&String(payload?.job)===job.jobId&&hash(payload?.canonicalTermsHash)===job.canonicalTermsHash;
      const sourceHash=hash(payload?.sourceHash),sourceValid=sourceHash!==null&&sourceHash!==`0x${'00'.repeat(32)}`;
      const deliveryMatches=String(payload?.deliveryVersion)===job.deliveryVersion;
      const requestMatches=job.requestStateVersion!==null&&String(payload?.requestStateVersion)===job.requestStateVersion;
      const chainMatches=payload?.criterionHash===job.revisionCriterionHash&&payload?.referenceHash===job.revisionReferenceHash;
      const beforeBroadcast=job.status===2&&String(payload?.expectedStateVersion)===job.stateVersion&&deliveryMatches;
      const verified=sourceValid&&identityMatches&&contentMatches&&chainMatches&&job.status===3&&requestMatches&&deliveryMatches;
      const pending=sourceValid&&identityMatches&&contentMatches&&beforeBroadcast;
      let laterDelivery=false; try { laterDelivery=BigInt(job.deliveryVersion)>BigInt(payload?.deliveryVersion); } catch {}
      const onChainEvent=requested.some(a=>hash(a.criterionHash)===hash(payload?.criterionHash)&&hash(a.referenceHash)===hash(payload?.referenceHash));
      const fulfilled=!verified&&!pending&&sourceValid&&identityMatches&&contentMatches&&laterDelivery&&onChainEvent;
      const mismatch=!verified&&!pending&&!fulfilled;
      return { ...noteFromPayload(payload), verification: verified ? 'verified' : fulfilled ? 'fulfilled' : mismatch ? 'mismatch' : 'pending' };
    });
    return json({ context: { jobId: job.jobId, stateVersion: job.stateVersion, deliveryVersion: job.deliveryVersion, correctionDeadline: job.correctionDeadline, revisionLimit: job.revisionLimit, revisionsUsed: job.revisionsUsed, unlimitedRevisions: job.unlimitedRevisions, status: job.status, revisionCriterionHash: job.revisionCriterionHash, revisionReferenceHash: job.revisionReferenceHash }, notes });
  }
  return async function handle(request) { try { const url = new URL(request.url); if (url.origin !== origin || ((request.method !== 'GET' || request.headers.get('origin') !== null) && request.headers.get('origin') !== origin)) fail('ORIGIN_MISMATCH', 403); if (!METHODS.has(request.method)) fail('METHOD_NOT_ALLOWED', 405); if (url.pathname.endsWith('/') || [...url.searchParams].length) fail('NOT_FOUND', 404); const parts = url.pathname.split('/').slice(1); if (parts.length !== 5 || parts[0] !== 'api' || parts[1] !== 'v2' || parts[2] !== 'jobs' || parts[4] !== 'revision-notes') fail('NOT_FOUND', 404); const jobId = decimal(parts[3], 'INVALID_JOB_ID'); if (jobId === '0') fail('INVALID_JOB_ID', 400); const wallet = await session(auth, request, request.method === 'POST'); if (request.method === 'GET') return await get(jobId, wallet); const result = await post(jobId, request, wallet); return json(result.body, result.status); } catch (error) { const code = error instanceof RevisionNotesError && SAFE_ERRORS.has(error.code) ? error.code : 'INTERNAL_ERROR'; return json({ error: code }, error instanceof RevisionNotesError && SAFE_ERRORS.has(error.code) ? error.status : 500); } };
}
