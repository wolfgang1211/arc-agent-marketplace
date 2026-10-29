import { createHash, randomUUID } from 'node:crypto';
import { ARC_TESTNET_PROFILE, assertV2Profile } from '../chain-profile.mjs';
import { encodeFunctionData, keccak256, stringToHex, getAddress } from 'viem';
import { canonicalTermsHash } from '../terms.mjs';
import { V2_TERMS_SCHEMA } from '../terms.mjs';
import { buildApplication, applicationDomain, validateApplication, recoverApplicationEOASigner, hashApplication, validateApplicationERC1271 } from '../applications.mjs';
import actionManifest from '../action-manifest.json' with { type: 'json' };

const CHAIN_ID = 5042002n;
const MARKETPLACE = getAddress('0xfa156b7a5205b123c8a22a807ba98405e36130f1');
const VAULT = getAddress('0xd5b271b7bf4696d662b2bcB1a94b408887c6C423');
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MAX_BODY = 128 * 1024;
const SAFE = new Set(['BAD_BODY','BAD_JSON','BODY_TOO_LARGE','INVALID_SESSION','ORIGIN_MISMATCH','CSRF_INVALID','NOT_FOUND','METHOD_NOT_ALLOWED','FORBIDDEN','STALE_DATA','READER_UNAVAILABLE','INVALID_STATUS','UNSUPPORTED_ACTION','INVALID_IDEMPOTENCY_KEY','IDEMPOTENCY_CONFLICT','INTERNAL_ERROR','INVALID_TERMS','INVALID_DOCUMENT','DRAFT_NOT_PUBLIC','INVALID_DRAFT_HASH','INVALID_APPLICATION']);
const FULL_SIGNATURES = Object.freeze({
  postJob: 'postJob(uint256,uint64,uint64,uint64,uint64,uint8,bool,bytes32,bytes32,bool)',
  awardJob: 'awardJob(uint256,(uint256,address,bytes32,uint64,uint64,uint256,uint256),bytes)',
  submitDelivery: 'submitDelivery(uint256,bytes32,uint256)',
  approve: 'approve(uint256,uint256)',
  requestRevision: 'requestRevision(uint256,bytes32,bytes32,uint64)',
  openDispute: 'openDispute(uint256,uint256)',
  resolveDispute: 'resolveDispute(uint256,uint256,bool,bytes32,bytes32,uint256)',
  proposeMutual: 'proposeMutual(uint256,uint256,uint256,uint64,uint256)',
  acceptMutual: 'acceptMutual(uint256,uint256,uint256)',
  rejectMutual: 'rejectMutual(uint256,uint256)',
  revokeMutual: 'revokeMutual(uint256,uint256)',
  claimOpenJobTimeout: 'claimOpenJobTimeout(uint256,uint256)',
  claimDeliveryTimeout: 'claimDeliveryTimeout(uint256,uint256)',
  withdrawStake: 'withdrawStake(uint256)',
  withdrawCredit: 'withdrawCredit()',
  registerOperator: 'registerOperator()',
  depositStake: 'depositStake(uint256)',
});
const ABI_ITEMS = new Map([
  ...actionManifest.contracts.marketplace.abi.map((item) => [`marketplace:${item.name}`, item]),
  ...actionManifest.contracts.vault.abi.map((item) => [`vault:${item.name}`, item]),
]);
const SUPPORTED = new Set(Object.keys(FULL_SIGNATURES));
const POLICY = Object.freeze({ maxExtensionTotal: BigInt(actionManifest.policy.maxExtensionTotal), stakeFloor: BigInt(actionManifest.policy.stakeFloor), stakeRound: BigInt(actionManifest.policy.stakeRound), collateralBps: BigInt(actionManifest.policy.collateralBps) });
function abiSignature(item) { return `${item.name}(${item.inputs.map((x) => x.type === 'tuple' ? `(${x.components.map((c) => c.type).join(',')})` : x.type).join(',')})`; }
function selectedAbi(name, contract) { const item = ABI_ITEMS.get(`${contract}:${name}`); if (!item || abiSignature(item) !== FULL_SIGNATURES[name]) fail('UNSUPPORTED_ACTION', 409); return item; }

class ActionError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }
const fail = (code, status) => { throw new ActionError(code, status); };
const own = (v, k) => { try { const d = v && Object.getOwnPropertyDescriptor(v, k); return d && 'value' in d ? d.value : undefined; } catch { return undefined; } };
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', Vary: 'Cookie' } }); }
function canonical(v) { if (v === null || typeof v !== 'object') { if (typeof v === 'number' && !Number.isFinite(v)) fail('INVALID_DOCUMENT'); return JSON.stringify(v); } if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`; return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`; }
function requestHash(action, value) { return `0x${createHash('sha256').update(`${action}:${canonical(value)}`).digest('hex')}`; }
function hashContent(value) { return keccak256(stringToHex(canonical(value))); }
function address(v) { if (typeof v !== 'string' || !ADDRESS.test(v)) fail('BAD_BODY'); try { return getAddress(v); } catch { fail('BAD_BODY'); } }
function hash(v, code = 'BAD_BODY') { if (typeof v !== 'string' || !HASH.test(v)) fail(code); return v.toLowerCase(); }
function uint(v, code = 'BAD_BODY') { if (typeof v !== 'string' || v.length > 78 || !DECIMAL.test(v)) fail(code); try { const n = BigInt(v); if (n < 0n || n >= (1n << 256n)) fail(code); return n; } catch { fail(code); } }
function exact(value, keys, required = keys) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const actual = Object.keys(value); return actual.every((k) => keys.includes(k)) && required.every((k) => Object.prototype.hasOwnProperty.call(value, k)); }
async function readBody(request) { const ct = request.headers.get('content-type'); const len = request.headers.get('content-length'); if (ct !== 'application/json') fail('BAD_BODY'); if (len !== null && (!/^\d+$/.test(len) || Number(len) > MAX_BODY)) fail('BODY_TOO_LARGE', 413); if (!request.body) fail('BAD_BODY'); const reader = request.body.getReader(); const chunks = []; let size = 0; try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BODY) fail('BODY_TOO_LARGE', 413); chunks.push(part.value); } } finally { try { reader.releaseLock(); } catch {} } try { const value = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))); if (!value || typeof value !== 'object' || Array.isArray(value)) fail('BAD_BODY'); return value; } catch (e) { if (e instanceof ActionError) throw e; fail('BAD_JSON'); } }
function originGuard(request, configured, mutation = true) { const url = new URL(request.url); if (url.origin !== configured || (mutation && request.headers.get('origin') !== configured) || (!mutation && request.headers.get('origin') !== null && request.headers.get('origin') !== configured)) fail('ORIGIN_MISMATCH', 403); if (url.search) fail('NOT_FOUND', 404); return url; }
async function authMutation(auth, request) { if (!auth || typeof auth.authorizeMutation !== 'function') fail('INVALID_SESSION', 401); try { const result = await auth.authorizeMutation(request); return address(result?.wallet); } catch (e) { if (e?.code === 'CSRF_INVALID') fail('CSRF_INVALID', 403); fail('INVALID_SESSION', 401); } }
async function healthy(getHealth) { let h; try { h = await getHealth(); } catch { fail('STALE_DATA', 503); } if (!h || h.status !== 'healthy' || h.stale !== false || h.gap != null) fail('STALE_DATA', 503); return h; }
function tx(to, data, chainId = CHAIN_ID) { return { to: to.toLowerCase(), value: '0', data, chainId: chainId.toString() }; }
function encode(name, args, contract = 'marketplace') { const item = selectedAbi(name, contract); try { return encodeFunctionData({ abi: [item], functionName: name, args }); } catch { fail('BAD_BODY'); } }
function immutableDraft(wallet, terms, document, termsHash, draftHash, data, isPublic) { return { draftHash, termsHash, owner: wallet, document, terms, public: isPublic === true, transaction: tx(MARKETPLACE, data), onchainStatus: 'not_submitted' }; }
function canonicalAddress(value, code = 'READER_UNAVAILABLE') { try { return getAddress(String(value)).toLowerCase(); } catch { fail(code, 503); } }
function canonicalHash(value, code = 'READER_UNAVAILABLE') { if (typeof value !== 'string' || !HASH.test(value)) fail(code, 503); return value.toLowerCase(); }
function canonicalDecimal(value, code = 'READER_UNAVAILABLE') { try { return uint(String(value), code).toString(); } catch (e) { if (e instanceof ActionError) fail(code, 503); fail(code, 503); } }
function canonicalBlockTag(value) { if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) fail('READER_UNAVAILABLE', 503); return value.toLowerCase(); }
function intentFor({ wallet, profile, action, transaction, snapshot, expected, readback, now = () => Date.now() }) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) fail('INTERNAL_ERROR', 500);
  const expiryISOorEpochMillis = new Date(now() + 10 * 60 * 1000).toISOString();
  const intentId = randomUUID();
  const boundTransaction = { from: wallet, to: transaction.to.toLowerCase(), data: transaction.data.toLowerCase(), value: String(transaction.value ?? '0'), chainId: profile.canonicalChainId.toString() };
  const intent = { id: intentId, intentId, wallet, profile: profile.name, chainId: boundTransaction.chainId, action, expiryISOorEpochMillis, expiry: expiryISOorEpochMillis, expected, transaction: boundTransaction, to: boundTransaction.to, value: boundTransaction.value, data: boundTransaction.data, calldataHash: keccak256(`0x${boundTransaction.data.slice(2)}`), snapshot, readback };
  return { action, intentId, expiryISOorEpochMillis, expected, transaction: boundTransaction, intent };
}
async function persistIntent(db, wallet, value) {
  await db.query('INSERT INTO v2_audit_events(id,actor_wallet,event_type,entity_type,entity_id,payload) VALUES($1,$2,$3,$4,$5,$6)', [value.intentId, wallet, 'transaction.intent.prepared', 'transaction-intent', value.intentId, value.intent]);
  return value;
}

export function createV2ActionsApi({ db, auth, readerFactory, getHealth, origin, now = () => Date.now(), readSignature, profile = ARC_TESTNET_PROFILE } = {}) {
  assertV2Profile(profile);
  const CHAIN_ID = profile.canonicalChainId;
  const MARKETPLACE = profile.marketplace;
  const VAULT = profile.vault;
  const txForProfile = (to, data) => tx(to, data, profile.canonicalChainId);
  if (!db?.query || !db?.transaction || !auth || typeof readerFactory !== 'function' || typeof getHealth !== 'function' || typeof origin !== 'string') throw new TypeError('db, auth, readerFactory, getHealth and origin are required');
  async function readCanonicalDraftPolicy(wallet, snap) {
    if (!snap || BigInt(snap.chainId) !== profile.canonicalChainId || typeof snap.readClientPolicy !== 'function') fail('READER_UNAVAILABLE', 503);
    let policy;
    try { policy = await snap.readClientPolicy(wallet); } catch { fail('READER_UNAVAILABLE', 503); }
    const getters = snap.getters;
    if (!getters || policy?.resolvedResolver == null || getters.usdc == null || getters.collateralVault == null || getters.treasury == null || getters.feeBps == null || getters.minReward == null) fail('READER_UNAVAILABLE', 503);
    return {
      token: canonicalAddress(getters.usdc), vault: canonicalAddress(getters.collateralVault), treasury: canonicalAddress(getters.treasury),
      resolver: canonicalAddress(policy.resolvedResolver), minReward: canonicalDecimal(getters.minReward), feeBps: canonicalDecimal(getters.feeBps), schema: V2_TERMS_SCHEMA,
      maxExtensionTotal: POLICY.maxExtensionTotal.toString(), stakeFloor: POLICY.stakeFloor.toString(), stakeRound: POLICY.stakeRound.toString(), collateralBps: POLICY.collateralBps.toString(),
      eligibility: Object.fromEntries(['listedHouse', 'testClient'].filter((key) => typeof policy[key] === 'boolean').map((key) => [key, policy[key]])),
    };
  }
  async function readDraftContext(request) {
    if (request.method !== 'GET' || new URL(request.url).search) fail('NOT_FOUND', 404);
    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite !== null && !['same-origin', 'none'].includes(fetchSite)) fail('ORIGIN_MISMATCH', 403);
    if (!auth || typeof auth.authenticateRequest !== 'function') fail('INVALID_SESSION', 401);
    let session; try { session = await auth.authenticateRequest(request); } catch { fail('INVALID_SESSION', 401); }
    const wallet = session?.session?.wallet ?? session?.wallet;
    if (!wallet || !ADDRESS.test(String(wallet))) fail('INVALID_SESSION', 401);
    const normalizedWallet = address(wallet);
    await healthy(getHealth);
    let snap; try { snap = await readerFactory().read(); } catch { fail('READER_UNAVAILABLE', 503); }
    const policy = await readCanonicalDraftPolicy(normalizedWallet, snap);
    const source = { chainId: canonicalDecimal(snap.chainId), marketplace: canonicalAddress(MARKETPLACE), blockTag: canonicalBlockTag(snap.blockTag), blockHash: canonicalHash(snap.blockHash) };
    const body = { policy: { token: policy.token, vault: policy.vault, treasury: policy.treasury, resolver: policy.resolver, minReward: policy.minReward, feeBps: policy.feeBps, schema: policy.schema, maxExtensionTotal: policy.maxExtensionTotal, stakeFloor: policy.stakeFloor, stakeRound: policy.stakeRound, collateralBps: policy.collateralBps }, source, client: normalizedWallet };
    if (Object.keys(policy.eligibility).length) body.eligibility = policy.eligibility;
    return json(body);
  }
  async function createDraft(request, wallet) {
    await healthy(getHealth); const value = await readBody(request); const key = request.headers.get('idempotency-key'); if (!key || key.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(key)) fail('INVALID_IDEMPOTENCY_KEY');
    if (!exact(value, ['terms','document','public'], ['terms','document'])) fail('BAD_BODY');
    let normalizedTerms; let termsHash; let snap; try {
      if (!exact(value.terms, ['token','vault','resolver','reward','feeBps','treasury','minReward','deliveryDuration','reviewDuration','revisionDuration','maxExtensionTotal','stakeFloor','stakeRound','collateralBps','schema','revisionLimit','unlimitedRevisions','applyBy','criteriaHash','descriptionHash','testJob'])) fail('INVALID_TERMS');
      if ('public' in value && typeof value.public !== 'boolean') fail('INVALID_TERMS');
      normalizedTerms = { ...value.terms };
      for (const field of ['reward','feeBps','minReward','deliveryDuration','reviewDuration','revisionDuration','maxExtensionTotal','stakeFloor','stakeRound','collateralBps','revisionLimit','applyBy']) normalizedTerms[field] = uint(normalizedTerms[field], 'INVALID_TERMS').toString();
      if (BigInt(normalizedTerms.reward) < BigInt(normalizedTerms.minReward)) fail('INVALID_TERMS');
      const reader = readerFactory(); snap = await reader.read(); const policy = await readCanonicalDraftPolicy(wallet, snap);
      const expected = { token: policy.token, vault: policy.vault, resolver: policy.resolver, feeBps: policy.feeBps, treasury: policy.treasury, minReward: policy.minReward, schema: policy.schema };
      for (const field of Object.keys(expected)) if (String(normalizedTerms[field]).toLowerCase() !== String(expected[field]).toLowerCase()) fail('INVALID_TERMS');
      for (const field of ['maxExtensionTotal', 'stakeFloor', 'stakeRound', 'collateralBps']) if (BigInt(normalizedTerms[field]) !== BigInt(policy[field])) fail('INVALID_TERMS');
      termsHash = canonicalTermsHash(Object.fromEntries(Object.entries(normalizedTerms).map(([k, v]) => ['reward','feeBps','minReward','deliveryDuration','reviewDuration','revisionDuration','maxExtensionTotal','stakeFloor','stakeRound','collateralBps','revisionLimit','applyBy'].includes(k) ? [k, BigInt(v)] : [k, v])));
    } catch (e) { if (e instanceof ActionError) throw e; fail('INVALID_TERMS'); }
    let document; try { if (!exact(value.document, ['title','description','criteria'], ['description','criteria'])) fail('INVALID_DOCUMENT'); canonical(value.document); document = JSON.parse(canonical(value.document)); const criteriaHash = hashContent(document.criteria); const descriptionHash = hashContent(document.description); if (normalizedTerms.criteriaHash.toLowerCase() !== criteriaHash.toLowerCase() || normalizedTerms.descriptionHash.toLowerCase() !== descriptionHash.toLowerCase()) fail('INVALID_DOCUMENT'); } catch (e) { if (e instanceof ActionError) throw e; fail('INVALID_DOCUMENT'); }
    const publicValue = value.public === true; const draftHash = hashContent({ owner: wallet, terms: normalizedTerms, document, public: publicValue }); const reqHash = requestHash('job-draft', { owner: wallet, terms: normalizedTerms, document, public: publicValue });
    const data = encode('postJob', [BigInt(normalizedTerms.reward), BigInt(normalizedTerms.applyBy), BigInt(normalizedTerms.deliveryDuration), BigInt(normalizedTerms.reviewDuration), BigInt(normalizedTerms.revisionDuration), Number(normalizedTerms.revisionLimit), normalizedTerms.unlimitedRevisions, normalizedTerms.criteriaHash, normalizedTerms.descriptionHash, normalizedTerms.testJob]);
    const expected = { action: 'postJob', client: wallet, criteriaHash: normalizedTerms.criteriaHash.toLowerCase(), descriptionHash: normalizedTerms.descriptionHash.toLowerCase(), termsHash: termsHash.toLowerCase() };
    const prepared = intentFor({ wallet, profile, action: 'postJob', transaction: { ...txForProfile(MARKETPLACE, data), from: wallet }, snapshot: { blockTag: snap.blockTag, blockHash: snap.blockHash }, expected, now, readback: { kind: 'receipt-and-job-transition', action: 'postJob', to: MARKETPLACE.toLowerCase() } });
    const response = { ...immutableDraft(wallet, normalizedTerms, document, termsHash, draftHash, data, publicValue), action: prepared.action, intentId: prepared.intentId, intent: prepared.intent, expected: prepared.expected, expiry: prepared.expiryISOorEpochMillis, expiryISOorEpochMillis: prepared.expiryISOorEpochMillis, readback: prepared.intent.readback, transaction: prepared.transaction, allowance: { token: profile.usdc, spender: MARKETPLACE, requiredAmount: normalizedTerms.reward } };
    const scope = `job-draft:${wallet}`;
    const result = await db.transaction(async (txh) => {
      const prior = await txh.query('SELECT request_hash,response FROM v2_idempotency_keys WHERE scope=$1 AND idempotency_key=$2 FOR UPDATE', [scope, key]);
      if (prior.rows.length) { if (prior.rows[0].request_hash !== reqHash) fail('IDEMPOTENCY_CONFLICT', 409); return { replay: true, response: prior.rows[0].response }; }
      const existing = await txh.query('SELECT payload FROM v2_audit_events WHERE entity_type=$1 AND entity_id=$2 LIMIT 1', ['job-draft', draftHash]);
      const stored = existing.rows.length ? { status: 201, body: existing.rows[0].payload } : { status: 201, body: response };
      if (!existing.rows.length) await txh.query('INSERT INTO v2_audit_events(id,actor_wallet,event_type,entity_type,entity_id,payload) VALUES($1,$2,$3,$4,$5,$6)', [`${draftHash}:created`, wallet, 'job.draft.created', 'job-draft', draftHash, response]);
      await txh.query('INSERT INTO v2_idempotency_keys(scope,idempotency_key,request_hash,response) VALUES($1,$2,$3,$4)', [scope, key, reqHash, stored]);
      return { replay: existing.rows.length > 0, response: stored };
    });
    return json(result.response.body, result.replay ? 200 : 201);
  }
  async function loadJob(jobId) { const row = (await db.query('SELECT chain_id,marketplace,job_id,status,state_version,terms_hash,client,operator,resolver,source_block,source_hash,data FROM v2_jobs WHERE chain_id=$1 AND LOWER(marketplace)=LOWER($2) AND job_id=$3', [CHAIN_ID.toString(), MARKETPLACE.toLowerCase(), jobId.toString()])).rows[0]; if (!row) fail('NOT_FOUND', 404); if (String(row.chain_id) !== CHAIN_ID.toString() || String(row.marketplace).toLowerCase() !== MARKETPLACE.toLowerCase()) fail('STALE_DATA', 503); if (row.source_block == null || row.source_hash == null) fail('STALE_DATA', 503); let snap; try { snap = await readerFactory({ toBlockTag: `0x${BigInt(row.source_block).toString(16)}` }).read(); } catch { fail('READER_UNAVAILABLE', 503); } if (BigInt(snap.chainId) !== CHAIN_ID || BigInt(snap.blockTag) !== BigInt(row.source_block) || String(snap.blockHash).toLowerCase() !== String(row.source_hash).toLowerCase()) fail('STALE_DATA', 503); let chainJob; try { chainJob = await snap.readJob(jobId); } catch { fail('READER_UNAVAILABLE', 503); } const dbStatus = ({ open: 0, inprogress: 1, submitted: 2, revisionpending: 3, accessrecovery: 4, disputed: 5, completed: 6, refunded: 7, cancelled: 8 })[String(row.status).toLowerCase()] ?? Number(row.status); if (String(chainJob.stateVersion) !== String(row.state_version) || String(chainJob.canonicalTermsHash).toLowerCase() !== String(row.terms_hash).toLowerCase() || Number(chainJob.status) !== dbStatus) fail('STALE_DATA', 503); return { row, snap, chainJob }; }
  function role(wallet, job) { const same = (x) => x && String(x).toLowerCase() === wallet.toLowerCase(); if (same(job.client)) return 'client'; if (same(job.operator)) return 'operator'; if (same(job.resolver)) return 'resolver'; return null; }
  function accountFields(account) {
    if (!account || typeof account !== 'object' || typeof account.registered !== 'boolean') fail('READER_UNAVAILABLE', 503);
    const fields = ['maxActiveJobs','activeJobs','credits','nonceEpoch','freeStake','reservedStake'];
    const out = { registered: account.registered }; for (const field of fields) { if (!(field in account)) fail('READER_UNAVAILABLE', 503); out[field] = uint(String(account[field]), 'READER_UNAVAILABLE'); }
    if (typeof account.applicationNonce !== 'function') fail('READER_UNAVAILABLE', 503); out.applicationNonce = account.applicationNonce.bind(account); return out;
  }
  function requiredStake(reward) {
    const proportional = reward / 10n + (reward % 10n === 0n ? 0n : 1n);
    const base = proportional > POLICY.stakeFloor ? proportional : POLICY.stakeFloor;
    return ((base + POLICY.stakeRound - 1n) / POLICY.stakeRound) * POLICY.stakeRound;
  }
  async function accountPreflight(request, wallet) {
    await healthy(getHealth); const value = await readBody(request); if (!exact(value, ['action','params'], ['action','params']) || !SUPPORTED.has(value.action)) fail('UNSUPPORTED_ACTION', 409);
    if (!['registerOperator','depositStake','withdrawCredit'].includes(value.action)) fail('UNSUPPORTED_ACTION', 409);
    let snap; try { snap = await readerFactory().read(); } catch { fail('READER_UNAVAILABLE', 503); } const account = accountFields(await snap.readAccount(wallet));
    let args; let to = MARKETPLACE; let expected;
    if (value.action === 'registerOperator') { if (account.registered) fail('FORBIDDEN', 403); args = []; expected = { action: value.action, wallet, registered: true }; }
    else if (value.action === 'depositStake') { to = VAULT; const amount = uint(value.params?.amount, 'BAD_BODY'); if (amount === 0n) fail('BAD_BODY'); args = [amount]; expected = { action: value.action, wallet, freeStake: (account.freeStake + amount).toString(), reservedStake: account.reservedStake.toString(), stakeLiabilityDelta: amount.toString() }; }
    else { if (account.credits === 0n) fail('FORBIDDEN', 403); args = []; expected = { action: value.action, wallet, credits: '0', walletTokenIncrease: account.credits.toString(), liabilityDecrease: account.credits.toString() }; }
    const data = encode(value.action, args, value.action === 'depositStake' ? 'vault' : 'marketplace');
    const transaction = txForProfile(to, data); const prepared = await persistIntent(db, wallet, intentFor({ wallet, profile, action: value.action, transaction, snapshot: { blockTag: snap.blockTag ?? null, blockHash: snap.blockHash ?? null }, expected, now, readback: { kind: 'receipt-and-action', action: value.action, to: transaction.to } }));
    return json({ action: value.action, role: 'account', transaction: prepared.transaction, intentId: prepared.intentId, expected: prepared.expected, expiry: prepared.expiryISOorEpochMillis, expiryISOorEpochMillis: prepared.expiryISOorEpochMillis, readback: prepared.intent.readback, chainId: profile.canonicalChainId.toString(), onchainStatus: 'not_submitted' });
  }
  async function preflight(request, wallet, jobId) {
    await healthy(getHealth); const value = await readBody(request); if (!exact(value, ['action','params','application','signature'], ['action','params'])) fail('BAD_BODY'); if (typeof value.action !== 'string' || !SUPPORTED.has(value.action) || ['registerOperator','depositStake','withdrawCredit'].includes(value.action)) fail('UNSUPPORTED_ACTION', 409); const { row, snap, chainJob } = await loadJob(jobId); const r = role(wallet, chainJob); if (!r) fail('FORBIDDEN', 403); const params = value.params;
    let args; let to = MARKETPLACE; let expected;
    const beforeVersion = BigInt(row.state_version);
    const transition = (status) => ({ action: value.action, jobId: jobId.toString(), stateVersion: (beforeVersion + 1n).toString(), status, client: String(chainJob.client).toLowerCase(), operator: chainJob.operator ? String(chainJob.operator).toLowerCase() : null, resolver: chainJob.resolver ? String(chainJob.resolver).toLowerCase() : null });
    try {
      const id = jobId;
      if (value.action === 'awardJob') {
        if (r !== 'client' || Number(chainJob.status) !== 0 || !value.application || typeof value.signature !== 'string') fail('FORBIDDEN', 403);
        const raw = value.application; const app = buildApplication({ ...raw, jobId: uint(raw?.jobId, 'INVALID_APPLICATION'), validAfter: uint(raw?.validAfter, 'INVALID_APPLICATION'), validBefore: uint(raw?.validBefore, 'INVALID_APPLICATION'), nonceEpoch: uint(raw?.nonceEpoch, 'INVALID_APPLICATION'), operatorNonce: uint(raw?.operatorNonce, 'INVALID_APPLICATION') }); if (app.operator.toLowerCase() === wallet.toLowerCase()) fail('INVALID_APPLICATION');
        const account = accountFields(await snap.readAccount(app.operator)); if (!account.registered || (account.maxActiveJobs !== 0n && account.activeJobs >= account.maxActiveJobs)) fail('FORBIDDEN', 403);
        const reward = uint(String(chainJob.reward ?? row.reward), 'READER_UNAVAILABLE'); const need = requiredStake(reward); if (account.freeStake < need) fail('FORBIDDEN', 403);
        const checked = validateApplication(app, { expectedJobId: id, expectedOperator: app.operator, currentTermsHash: chainJob.canonicalTermsHash, now: BigInt(Math.floor(now() / 1000)), applyBy: BigInt(chainJob.applyBy), currentNonceEpoch: account.nonceEpoch, currentOperatorNonce: BigInt(await account.applicationNonce(id)) });
        const digest = hashApplication(checked, applicationDomain(CHAIN_ID, MARKETPLACE)); let valid = false; if (typeof readSignature === 'function') { try { valid = await validateApplicationERC1271(app.operator, digest, value.signature, (...args) => readSignature(...args, snap.blockTag)); } catch {} }
        if (!valid) { const signer = (await recoverApplicationEOASigner(checked, applicationDomain(CHAIN_ID, MARKETPLACE), value.signature)).toLowerCase(); valid = signer === app.operator.toLowerCase(); }
        if (!valid) fail('INVALID_APPLICATION'); args = [id, checked, value.signature]; expected = transition(1);
      } else if (value.action === 'submitDelivery') { if (r !== 'operator' || Number(chainJob.status) !== 1) fail('FORBIDDEN', 403); args = [id, hash(params?.blobHash), uint(params?.expected)]; expected = transition(2);
      } else if (value.action === 'approve') { if (r !== 'client' || ![2, 3].includes(Number(chainJob.status))) fail('FORBIDDEN', 403); args = [id, uint(params?.expected)]; expected = transition(6);
      } else if (value.action === 'requestRevision') { if (r !== 'client' || Number(chainJob.status) !== 2) fail('FORBIDDEN', 403); args = [id, hash(params?.criterionHash), hash(params?.referenceHash), uint(params?.expected ?? String(chainJob.reviewDeadline))]; expected = transition(3);
      } else if (value.action === 'openDispute') { if (!['client','operator'].includes(r) || ![1, 2, 3, 4].includes(Number(chainJob.status))) fail('FORBIDDEN', 403); args = [id, uint(params?.expected)]; expected = transition(5);
      } else if (value.action === 'resolveDispute') { if (typeof params?.operatorFault !== 'boolean') fail('BAD_BODY'); if (r !== 'resolver' || Number(chainJob.status) !== 5) fail('FORBIDDEN', 403); const grossPayout = uint(params?.grossPayout); if (grossPayout > uint(String(chainJob.reward ?? row.reward), 'READER_UNAVAILABLE')) fail('BAD_BODY'); args = [id, grossPayout, params.operatorFault, hash(params?.reasonHash), hash(params?.evidenceHash), uint(params?.expected)]; expected = transition(params.operatorFault ? 7 : 6);
      } else if (value.action === 'proposeMutual') { if (!['client','operator'].includes(r) || Number(chainJob.status) >= 6) fail('FORBIDDEN', 403); const refund = uint(params?.refund); const grossPayout = uint(params?.grossPayout); if (refund + grossPayout !== uint(String(chainJob.reward ?? row.reward), 'READER_UNAVAILABLE')) fail('BAD_BODY'); args = [id, refund, grossPayout, uint(params?.expiry), uint(params?.expected)]; expected = transition(Number(chainJob.status));
      } else if (value.action === 'acceptMutual') { if (!['client','operator'].includes(r)) fail('FORBIDDEN', 403); args = [id, uint(params?.expected), uint(params?.expectedRequestVersion)]; expected = transition(6);
      } else if (value.action === 'rejectMutual' || value.action === 'revokeMutual') { if (!['client','operator'].includes(r)) fail('FORBIDDEN', 403); args = [id, uint(params?.expected)]; expected = transition(Number(chainJob.status));
      } else if (value.action === 'claimOpenJobTimeout') { if (Number(chainJob.status) !== 0 || !['client','resolver'].includes(r)) fail('FORBIDDEN', 403); args = [id, uint(params?.expected)]; expected = transition(7);
      } else if (value.action === 'claimDeliveryTimeout') { if (Number(chainJob.status) !== 1 || r !== 'operator') fail('FORBIDDEN', 403); args = [id, uint(params?.expected)]; expected = transition(4);
      } else if (value.action === 'withdrawStake') { if (r !== 'operator') fail('FORBIDDEN', 403); const amount = uint(params?.amount); if (amount === 0n) fail('BAD_BODY'); to = VAULT; args = [amount]; expected = { action: value.action, wallet, freeStake: (await snap.readAccount(wallet)).freeStake.toString(), reservedStake: (await snap.readAccount(wallet)).reservedStake.toString(), stakeLiabilityDelta: `-${amount}` };
      } else if (value.action === 'withdrawCredit') { fail('UNSUPPORTED_ACTION', 409);
      } else fail('UNSUPPORTED_ACTION', 409);
      const data = encode(value.action, args, to === VAULT ? 'vault' : 'marketplace'); const transaction = txForProfile(to, data); const prepared = await persistIntent(db, wallet, intentFor({ wallet, profile, action: value.action, transaction, snapshot: { blockTag: snap.blockTag, blockHash: snap.blockHash, jobId: jobId.toString() }, expected, now, readback: { kind: 'receipt-and-job-transition', action: value.action, jobId: jobId.toString(), to: transaction.to } }));
      return json({ action: value.action, role: r, transaction: prepared.transaction, intentId: prepared.intentId, expected: prepared.expected, expiry: prepared.expiryISOorEpochMillis, expiryISOorEpochMillis: prepared.expiryISOorEpochMillis, readback: prepared.intent.readback, chainId: profile.canonicalChainId.toString(), stateVersion: String(row.state_version), onchainStatus: 'not_submitted' });
    } catch (e) { if (e instanceof ActionError) throw e; fail('INVALID_APPLICATION'); }
  }
  async function readDraft(request, draftHash, wallet) { if (!HASH.test(draftHash)) fail('INVALID_DRAFT_HASH'); const row = (await db.query('SELECT actor_wallet,payload FROM v2_audit_events WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at DESC LIMIT 1', ['job-draft', draftHash.toLowerCase()])).rows[0]; if (!row) fail('NOT_FOUND', 404); const payload = row.payload; if (payload.public !== true && (!wallet || String(row.actor_wallet).toLowerCase() !== wallet.toLowerCase())) fail('DRAFT_NOT_PUBLIC', 403); if (payload.public === true) return json({ draftHash: payload.draftHash, termsHash: payload.termsHash, document: payload.document, terms: payload.terms, public: true }); return json(payload);
  }
  return async function handle(request) { try { const url = originGuard(request, origin, request.method !== 'GET'); const parts = url.pathname.split('/').filter(Boolean); if (parts[0] !== 'api' || parts[1] !== 'v2') fail('NOT_FOUND', 404); if (request.method === 'POST' && parts.length === 3 && parts[2] === 'jobs') { const wallet = await authMutation(auth, request); return await createDraft(request, wallet); } if (request.method === 'POST' && parts.length === 4 && parts[2] === 'accounts' && parts[3] === 'preflight') { const wallet = await authMutation(auth, request); return await accountPreflight(request, wallet); } if (request.method === 'POST' && parts.length === 5 && parts[2] === 'jobs' && parts[4] === 'preflight') { const wallet = await authMutation(auth, request); const id = uint(parts[3], 'BAD_BODY'); if (id === 0n) fail('BAD_BODY'); return await preflight(request, wallet, id); }    if (request.method === 'GET' && url.pathname === '/api/v2/draft-context') return await readDraftContext(request);
    if (request.method === 'GET' && parts.length === 4 && parts[2] === 'drafts') { let wallet = null; if (auth?.authenticateRequest) { try { const session = await auth.authenticateRequest(request); wallet = session?.session?.wallet ?? session?.wallet ?? null; } catch {} } return await readDraft(request, parts[3], wallet); } fail('NOT_FOUND', 404); } catch (e) { if (e instanceof ActionError) return json({ error: e.code }, e.status); return json({ error: SAFE.has(e?.code) ? e.code : 'INTERNAL_ERROR' }, 500); } };
}

export { CHAIN_ID, MARKETPLACE, VAULT, SUPPORTED };
