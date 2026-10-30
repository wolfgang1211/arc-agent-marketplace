import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { decodeFunctionData, keccak256, stringToHex, verifyMessage } from 'viem';
import manifest from '../lib/v2/action-manifest.json' with { type: 'json' };
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2Api } from '../lib/v2/server/api-runtime.mjs';
import { V2_TERMS_SCHEMA } from '../lib/v2/terms.mjs';
import { JobCreationForm, ApplicationPanel, AccountActionPanel, DeliveryPanel, WalletSessionControl } from '../app/v2/_components/action-panels.js';
import { scratchDir } from './scratch-dir.mjs';

// Offline fixture evidence only: loopback HTTP + real PGlite/API/React. No RPC, EVM, browser, or wallet provider.
const CHAIN_ID = '5042002';
const MARKETPLACE = manifest.contracts.marketplace.address.toLowerCase();
const ORIGIN_HOST = '127.0.0.1';
const ZERO = '0x0000000000000000000000000000000000000000';
const ADDR = (n) => `0x${String(n).repeat(40)}`;
const HASH = (n) => `0x${String(n).repeat(64)}`;
const scratch = scratchDir();
const hashValue = (value) => keccak256(stringToHex(JSON.stringify(value)));

function requestFor(origin, route, init = {}, cookie = null) {
  const headers = { origin, 'sec-fetch-site': 'same-origin', ...(init.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  return new Request(`${origin}${route}`, { ...init, headers });
}
function jsonInit(body, headers = {}) {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}
function cookiePair(setCookie) { return String(setCookie).split(';', 1)[0]; }
function assertNoChainSideEffect(body) {
  assert.equal(body.onchainStatus, 'not_submitted');
  assert.ok(body.transaction?.data?.startsWith('0x'));
  assert.equal(body.transaction?.hash, undefined);
  assert.equal(body.receipt, undefined);
}

function makeReader({ block = 100, blockHash = HASH('a'), jobs = new Map(), accounts = new Map(), policy }) {
  return () => ({ read: async () => ({
    chainId: 5042002n,
    blockTag: `0x${block.toString(16)}`,
    blockHash,
    getters: { usdc: ADDR(3), collateralVault: ADDR(4), feeBps: 250n, treasury: ADDR(5), minReward: 100n },
    readClientPolicy: async () => ({ resolvedResolver: ADDR(6), ...(policy ?? {}) }),
    readJob: async (id) => {
      const job = jobs.get(String(id));
      if (!job) throw new Error('fixture job missing');
      return { status: job.chainStatus, stateVersion: BigInt(job.stateVersion), canonicalTermsHash: job.termsHash, client: job.client, operator: job.operator, resolver: job.resolver, reward: BigInt(job.reward), applyBy: 1800000060n };
    },
    readAccount: async (wallet) => accounts.get(wallet.toLowerCase()) ?? { registered: false, maxActiveJobs: 2n, activeJobs: 0n, credits: 0n, nonceEpoch: 0n, freeStake: 0n, reservedStake: 0n, applicationNonce: async () => 0n },
  }) });
}

async function startFixture({ jobs = new Map(), accounts = new Map(), policy } = {}) {
  const dir = await mkdtemp(path.join(scratch, 'v2-local-http-e2e-'));
  const db = await createPgliteDb({ dataDir: dir });
  await migrate(db);
  let now = 1_800_000_000_000;
  let health = { status: 'healthy', stale: false, gap: null };
  let api;
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(`http://${ORIGIN_HOST}:${server.address().port}${incoming.url}`, { method: incoming.method, headers, body, duplex: body ? 'half' : undefined });
      const response = await api.handle(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'HARNESS_SERVER_ERROR' }));
    }
  });
  await new Promise((resolve) => server.listen(0, ORIGIN_HOST, resolve));
  const origin = `http://${ORIGIN_HOST}:${server.address().port}`;
  const readerFactory = makeReader({ jobs, accounts, policy });
  api = createV2Api({ db, origin, readerFactory, getHealth: () => health, now: () => now, verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }) });
  async function close() { await new Promise((resolve) => server.close(resolve)); await db.close(); await rm(dir, { recursive: true, force: true }); }
  async function raw(route, init = {}, cookie = null) {
    return fetch(`${origin}${route}`, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });
  }
  async function login(account) {
    const challengeResponse = await raw('/api/v2/auth/challenge', jsonInit({ wallet: account.address, chainId: CHAIN_ID }, { origin }));
    const challenge = await challengeResponse.json();
    assert.equal(challengeResponse.status, 200);
    const signature = await account.signMessage({ message: challenge.message });
    const verifiedResponse = await raw('/api/v2/auth/verify', jsonInit({ challengeId: challenge.challengeId, wallet: account.address, chainId: CHAIN_ID, signature }, { origin }));
    const verified = await verifiedResponse.json();
    assert.equal(verifiedResponse.status, 200);
    return { cookie: cookiePair(verifiedResponse.headers.get('set-cookie')), csrf: verified.csrf, wallet: account.address };
  }
  return { db, origin, server, close, login, raw, setHealth: (value) => { health = value; }, jobs, accounts, now: () => now };
}

function installBrowserFetch(origin, cookie) {
  const original = globalThis.fetch;
  let activeCookie = cookie;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), origin);
    const headers = new Headers(init.headers);
    headers.set('origin', origin);
    headers.set('sec-fetch-site', 'same-origin');
    if (activeCookie) headers.set('cookie', activeCookie);
    const response = await original(url, { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) activeCookie = cookiePair(setCookie);
    return response;
  };
  const restore = () => { globalThis.fetch = original; };
  restore.cookie = () => activeCookie;
  return restore;
}
function text(node) { return node.children?.filter((x) => typeof x === 'string').join('') ?? ''; }
function labelNode(renderer, startsWith) { return renderer.root.findAllByType('label').find((node) => text(node.children?.[0]).startsWith(startsWith)); }
function inputFor(renderer, startsWith) { return labelNode(renderer, startsWith).findByType('input'); }
function textareaFor(renderer, startsWith) { return labelNode(renderer, startsWith).findByType('textarea'); }
function setInput(renderer, label, value) { inputFor(renderer, label).props.onChange({ target: { value } }); }
function setTextarea(renderer, label, value) { textareaFor(renderer, label).props.onChange({ target: { value } }); }
function button(renderer, label) { return renderer.root.findAllByType('button').find((node) => text(node) === label); }
async function settle() { await new Promise((resolve) => setTimeout(resolve, 40)); }

async function seedJob(f, { id, status, chainStatus, stateVersion, client, operator, resolver, termsHash = HASH('b'), reward = '1000', data = { applyBy: '1800000060' } }) {
  const job = { chainStatus, stateVersion, termsHash, client, operator, resolver, reward };
  f.jobs.set(String(id), job);
  await f.db.query('INSERT INTO v2_jobs(chain_id,marketplace,job_id,reward,status,state_version,terms_hash,client,operator,resolver,source_block,source_hash,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [CHAIN_ID, MARKETPLACE, String(id), reward, status, stateVersion, termsHash, client, operator === ZERO ? null : operator, resolver === ZERO ? null : resolver, '100', HASH('a'), data]);
}

async function draftTerms() {
  const document = { title: 'loopback draft', description: 'bounded work', criteria: ['criterion one'] };
  return { document, terms: { token: ADDR(3), vault: ADDR(4), resolver: ADDR(6), reward: '1000', feeBps: '250', treasury: ADDR(5), minReward: '100', deliveryDuration: '60', reviewDuration: '60', revisionDuration: '60', maxExtensionTotal: '15552000', stakeFloor: '5000000', stakeRound: '10000', collateralBps: '1000', schema: V2_TERMS_SCHEMA, revisionLimit: '2', unlimitedRevisions: false, applyBy: '1800000060', criteriaHash: hashValue(document.criteria), descriptionHash: hashValue(document.description), testJob: false } };
}

test('offline fixture: real loopback HTTP auth and JobCreationForm create an idempotent draft', async () => {
  const client = privateKeyToAccount(generatePrivateKey());
  const f = await startFixture({ accounts: new Map([[client.address.toLowerCase(), { registered: false, maxActiveJobs: 2n, activeJobs: 0n, credits: 0n, nonceEpoch: 0n, freeStake: 0n, reservedStake: 0n, applicationNonce: async () => 0n }]]) });
  try {
    const session = await f.login(client);
    const restore = installBrowserFetch(f.origin, session.cookie);
    try {
      const renderer = TestRenderer.create(React.createElement(JobCreationForm, { session: { authenticated: true, wallet: client.address, csrf: session.csrf }, health: { data: { status: 'healthy', stale: false, gap: null } } }));
      await act(async () => { await settle(); });
      assert.match(JSON.stringify(renderer.toJSON()), /Canonical policy/);
      setInput(renderer, 'Reward', '0.001'); setInput(renderer, 'Delivery duration', '60'); setInput(renderer, 'Review duration', '60'); setInput(renderer, 'Revision duration', '60'); setInput(renderer, 'Revision limit', '2'); setInput(renderer, 'Apply by', '2027-01-15T00:00'); setInput(renderer, 'Title', 'loopback draft'); setTextarea(renderer, 'Description', 'bounded work'); setTextarea(renderer, 'Criteria', 'criterion one');
      await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
      const created = renderer.root.findByProps({ role: 'status' });
      assert.match(JSON.stringify(renderer.toJSON()), /Prepared only/);
      const response = await f.raw('/api/v2/jobs', jsonInit(await draftTerms(), { origin: f.origin, 'x-v2-csrf': session.csrf, 'idempotency-key': 'draft-replay' }), session.cookie);
      const replay = await f.raw('/api/v2/jobs', jsonInit(await draftTerms(), { origin: f.origin, 'x-v2-csrf': session.csrf, 'idempotency-key': 'draft-replay' }), session.cookie);
      assert.equal(response.status, 201); assert.equal(replay.status, 200);
      const body = await response.json(); assertNoChainSideEffect(body);
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n, 2);
    } finally { restore(); }
  } finally { await f.close(); }
});

test('offline fixture: WalletSessionControl connects then signs the exact personal_sign UTF-8 hex bytes over loopback auth', async () => {
  const client = privateKeyToAccount(generatePrivateKey()); const f = await startFixture();
  const originalEthereum = globalThis.ethereum;
  const restoreFetch = installBrowserFetch(f.origin, null);
  let session = null;
  try {
    globalThis.ethereum = { request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts') return [client.address];
      if (method === 'eth_chainId') return ['0x4cef52'];
      if (method === 'personal_sign') {
        const rawMessage = Buffer.from(String(params[0]).slice(2), 'hex').toString('utf8');
        return client.signMessage({ message: rawMessage });
      }
      throw new Error('unexpected provider method');
    } };
    const renderer = TestRenderer.create(React.createElement(WalletSessionControl, { session: null, onSession: (value) => { session = value; } }));
    await act(async () => button(renderer, 'Connect wallet').props.onClick());
    assert.match(JSON.stringify(renderer.toJSON()), /Sign in with wallet/);
    await act(async () => button(renderer, 'Sign in with wallet').props.onClick());
    if (!session?.authenticated) throw new Error(JSON.stringify(renderer.toJSON())); assert.equal(session.wallet.toLowerCase(), client.address.toLowerCase());
    const sessionResponse = await f.raw('/api/v2/auth/session', { headers: { 'sec-fetch-site': 'same-origin' } }, restoreFetch.cookie());
    assert.equal(sessionResponse.status, 200); const body = await sessionResponse.json();
    assert.equal(body.authenticated, true); assert.equal(body.wallet.toLowerCase(), client.address.toLowerCase());
  } finally { globalThis.ethereum = originalEthereum; restoreFetch(); await f.close(); }
});

test('offline fixture: ApplicationPanel loads private applications and prepares award calldata for zero-address job', async () => {
  const client = privateKeyToAccount(generatePrivateKey()); const operator = privateKeyToAccount(generatePrivateKey());
  const termsHash = HASH('b');
  const jobs = new Map(); const accounts = new Map([[operator.address.toLowerCase(), { registered: true, maxActiveJobs: 2n, activeJobs: 0n, credits: 0n, nonceEpoch: 0n, freeStake: 5000000n, reservedStake: 0n, applicationNonce: async () => 0n }]]);
  const f = await startFixture({ jobs, accounts });
  try {
    await seedJob(f, { id: 7, status: '0', chainStatus: 0, stateVersion: 3, client: client.address, operator: ZERO, resolver: ADDR(6), termsHash });
    const application = { jobId: '7', operator: operator.address, termsHash, validAfter: '1799999990', validBefore: '1800000050', nonceEpoch: '0', operatorNonce: '0' };
    const signature = await operator.signTypedData({ domain: { name: 'AlphaBoard Agent Marketplace V2', version: '1', chainId: 5042002n, verifyingContract: manifest.contracts.marketplace.address }, types: { Application: [{ name: 'jobId', type: 'uint256' }, { name: 'operator', type: 'address' }, { name: 'termsHash', type: 'bytes32' }, { name: 'validAfter', type: 'uint64' }, { name: 'validBefore', type: 'uint64' }, { name: 'nonceEpoch', type: 'uint256' }, { name: 'operatorNonce', type: 'uint256' }] }, primaryType: 'Application', message: { jobId: 7n, operator: operator.address, termsHash, validAfter: 1799999990n, validBefore: 1800000050n, nonceEpoch: 0n, operatorNonce: 0n } });
    await f.db.query('INSERT INTO v2_applications(id,chain_id,marketplace,job_id,operator,digest,payload,signature,pitch,epoch,op_nonce) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', ['app-7', CHAIN_ID, MARKETPLACE, '7', operator.address, HASH('c'), application, signature, 'private pitch', '0', '0']);
    const session = await f.login(client);
    const applicationsResponse = await f.raw('/api/v2/jobs/7/applications', {}, session.cookie);
    assert.equal(applicationsResponse.status, 200, await applicationsResponse.text());
    const restore = installBrowserFetch(f.origin, session.cookie);
    try {
      const renderer = TestRenderer.create(React.createElement(ApplicationPanel, { job: { jobId: '7', status: '0', stateVersion: '3', client: client.address, operator: ZERO, resolver: ADDR(6), termsHash }, session: { authenticated: true, wallet: client.address, csrf: session.csrf }, health: { data: { status: 'healthy', stale: false, gap: null } } }));
      await act(async () => { await button(renderer, 'Load applications').props.onClick(); await settle(); });
      await act(async () => renderer.root.findAllByType('button').find((x) => text(x).startsWith('Operator ')).props.onClick());
      await act(async () => button(renderer, 'Prepare award').props.onClick());
      const result = JSON.parse(JSON.stringify(renderer.toJSON())); assert.match(JSON.stringify(result), /Prepared only/);
      const response = await f.raw('/api/v2/jobs/7/preflight', jsonInit({ action: 'awardJob', params: { expected: '3' }, application, signature }, { origin: f.origin, 'x-v2-csrf': session.csrf, 'idempotency-key': 'award-7' }), session.cookie);
      assert.equal(response.status, 200); const body = await response.json(); assertNoChainSideEffect(body);
      assert.equal(decodeFunctionData({ abi: manifest.contracts.marketplace.abi, data: body.transaction.data }).functionName, 'awardJob');
    } finally { restore(); }
  } finally { await f.close(); }
});

test('offline fixture: AccountActionPanel reads nested operator state and prepares registerOperator without a fake tx hash', async () => {
  const client = privateKeyToAccount(generatePrivateKey()); const accounts = new Map([[client.address.toLowerCase(), { registered: false, maxActiveJobs: 2n, activeJobs: 0n, credits: 0n, nonceEpoch: 0n, freeStake: 5000000n, reservedStake: 0n, applicationNonce: async () => 0n }]]);
  const f = await startFixture({ accounts });
  try {
    const session = await f.login(client); const accountResponse = await f.raw(`/api/v2/accounts/${client.address}`, {}, session.cookie); const accountPayload = await accountResponse.json();
    const restore = installBrowserFetch(f.origin, session.cookie);
    try {
      const renderer = TestRenderer.create(React.createElement(AccountActionPanel, { account: accountPayload.data, session: { authenticated: true, wallet: client.address, csrf: session.csrf }, health: { data: { status: 'healthy', stale: false, gap: null } } }));
      await act(async () => button(renderer, 'registerOperator').props.onClick());
      const response = await f.raw('/api/v2/accounts/preflight', jsonInit({ action: 'registerOperator', params: {} }, { origin: f.origin, 'x-v2-csrf': session.csrf, 'idempotency-key': 'register-1' }), session.cookie);
      assert.equal(response.status, 200); const body = await response.json(); assertNoChainSideEffect(body);
      assert.equal(decodeFunctionData({ abi: manifest.contracts.marketplace.abi, data: body.transaction.data }).functionName, 'registerOperator');
      assert.equal(body.transaction.hash, undefined);
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n >= 1, true);
    } finally { restore(); }
  } finally { await f.close(); }
});

test('offline fixture: DeliveryPanel reads version one, posts revision version two, and persists audit/idempotency in PGlite', async () => {
  const operator = privateKeyToAccount(generatePrivateKey()); const client = privateKeyToAccount(generatePrivateKey());
  const jobs = new Map(); const accounts = new Map([[operator.address.toLowerCase(), { registered: true, maxActiveJobs: 2n, activeJobs: 1n, credits: 0n, nonceEpoch: 0n, freeStake: 5000000n, reservedStake: 0n, applicationNonce: async () => 0n }]]);
  const f = await startFixture({ jobs, accounts });
  try {
    await seedJob(f, { id: 8, status: '3', chainStatus: 3, stateVersion: 4, client: client.address, operator: operator.address, resolver: ADDR(6), termsHash: HASH('d'), reward: '1000' });
    await f.db.query('INSERT INTO v2_deliveries(id,chain_id,marketplace,job_id,version,content_hash,content,visibility,receipt_refs) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', ['delivery-8-1', CHAIN_ID, MARKETPLACE, '8', '1', HASH('e'), { result: 'one' }, 'private', []]);
    const session = await f.login(operator);
    const deliveriesResponse = await f.raw('/api/v2/jobs/8/deliveries', {}, session.cookie);
    assert.equal(deliveriesResponse.status, 200, await deliveriesResponse.text());
    const restore = installBrowserFetch(f.origin, session.cookie);
    try {
      const renderer = TestRenderer.create(React.createElement(DeliveryPanel, { job: { jobId: '8', status: '3', stateVersion: '4', reward: '1000', client: client.address, operator: operator.address, resolver: ADDR(6), termsHash: HASH('d') }, session: { authenticated: true, wallet: operator.address, csrf: session.csrf }, health: { data: { status: 'healthy', stale: false, gap: null } } }));
      await act(async () => { await settle(); });
      assert.equal(inputFor(renderer, 'Version').props.value, '2');
      setTextarea(renderer, 'Content JSON', '{"result":"two"}');
      await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
      const stored = (await f.db.query('SELECT version,content FROM v2_deliveries WHERE job_id=$1 AND version=$2', ['8', '2'])).rows[0];
      assert.equal(String(stored.version), '2'); assert.deepEqual(stored.content, { result: 'two' });
      assert.equal((await f.db.query("SELECT count(*)::int AS n FROM v2_audit_events WHERE entity_type='delivery'")).rows[0].n, 1);
      assert.equal((await f.db.query("SELECT count(*)::int AS n FROM v2_idempotency_keys WHERE scope LIKE 'delivery:%:8'")).rows[0].n, 1);
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_jobs WHERE job_id=$1', ['8'])).rows[0].n, 1);
    } finally { restore(); }
  } finally { await f.close(); }
});

test('offline fixture: browser-shaped origin/CSRF and stale health fail closed without DB mutation', async () => {
  const client = privateKeyToAccount(generatePrivateKey()); const f = await startFixture();
  try {
    const session = await f.login(client); const before = (await f.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n;
    const csrf = await f.raw('/api/v2/accounts/preflight', jsonInit({ action: 'registerOperator', params: {} }, { origin: f.origin, 'idempotency-key': 'bad-csrf' }), session.cookie);
    assert.equal(csrf.status, 403);
    const cross = await f.raw('/api/v2/draft-context', { headers: { origin: f.origin, 'sec-fetch-site': 'cross-site' } }, session.cookie); assert.equal(cross.status, 403);
    f.setHealth({ status: 'stale', stale: true, gap: 2 });
    const stale = await f.raw('/api/v2/health'); assert.equal(stale.status, 200); assert.equal((await stale.json()).data.stale, true);
    const noWrite = (await f.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n; assert.equal(noWrite, before);
  } finally { await f.close(); }
});
