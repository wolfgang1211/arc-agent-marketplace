import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2AuthApi } from '../lib/v2/server/api-auth.mjs';

const ORIGIN = 'https://app.example.test';
const LOCAL_ORIGIN = 'http://127.0.0.1';
const CHAIN_ID = '5042002';
const MARKETPLACE = '0xFA156B7A5205B123c8a22A807ba98405e36130f1';
const scratch = process.env.TMPDIR ?? path.join(process.cwd(), '.hermes-scratch');
async function fixture(origin = ORIGIN) {
  const dir = await mkdtemp(path.join(scratch, 'v2-api-auth-'));
  const db = await createPgliteDb({ dataDir: dir }); await migrate(db);
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const account = privateKeyToAccount(generatePrivateKey());
  const api = createV2AuthApi({ db, origin, now: () => now, verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }) });
  return { db, dir, api, origin, account, advance(ms) { now += ms; } };
}
async function close(f) { await f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
function request(f, pathname, init = {}) { return new Request(`${f.origin}${pathname}`, { ...init, headers: { origin: f.origin, ...(init.headers ?? {}) } }); }
async function call(f, pathname, init = {}) { const response = await f.api(request(f, pathname, init)); let body = null; try { body = await response.json(); } catch {} return { response, body }; }
function jsonInit(body, headers = {}) { return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }; }
async function login(f) {
  const challenge = await call(f, '/api/v2/auth/challenge', jsonInit({ wallet: f.account.address, chainId: CHAIN_ID }));
  assert.equal(challenge.response.status, 200);
  const signature = await f.account.signMessage({ message: challenge.body.message });
  const verified = await call(f, '/api/v2/auth/verify', jsonInit({ challengeId: challenge.body.challengeId, wallet: f.account.address, chainId: CHAIN_ID, signature }));
  assert.equal(verified.response.status, 200);
  return { challenge: challenge.body, verified: verified.body, cookie: verified.response.headers.get('set-cookie') };
}

test('nonzero millisecond challenge timestamps round-trip through real PGlite', async () => {
  const f = await fixture();
  try {
    f.advance(123);
    const logged = await login(f);
    assert.match(logged.challenge.expiresAt, /\.123Z$/);
    const result = await call(f, '/api/v2/auth/session', { headers: { cookie: logged.cookie } });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.authenticated, true);
  } finally { await close(f); }
});

test('real EOA challenge, verify, HttpOnly session, CSRF and logout are a complete HTTP flow', async () => {
  const f = await fixture();
  try {
    const logged = await login(f); assert.match(logged.cookie, /^__Host-ab_v2_session=/); assert.match(logged.cookie, /HttpOnly/); assert.match(logged.cookie, /SameSite=Strict/); assert.match(logged.cookie, /Secure/);
    assert.equal(logged.verified.wallet, f.account.address); assert.equal(JSON.stringify(logged.verified).includes('rawToken'), false);
    const session = await call(f, '/api/v2/auth/session', { headers: { cookie: logged.cookie } });
    assert.deepEqual(session.body, { authenticated: true, wallet: f.account.address, expiresAt: logged.verified.expiresAt, csrf: logged.verified.csrf });
    const out = await call(f, '/api/v2/auth/logout', { ...jsonInit(null), body: undefined, headers: { cookie: logged.cookie, 'x-v2-csrf': logged.verified.csrf } });
    assert.equal(out.response.status, 200); assert.match(out.response.headers.get('set-cookie'), /Max-Age=0/);
    assert.deepEqual((await call(f, '/api/v2/auth/session', { headers: { cookie: logged.cookie } })).body, { authenticated: false });
  } finally { await close(f); }
});

test('forged signature, wrong origin, wrong chain, reuse and expiry are rejected', async () => {
  const f = await fixture();
  try {
    const c = await call(f, '/api/v2/auth/challenge', jsonInit({ wallet: f.account.address, chainId: CHAIN_ID }));
    assert.equal((await call(f, '/api/v2/auth/verify', jsonInit({ challengeId: c.body.challengeId, wallet: f.account.address, chainId: CHAIN_ID, signature: '0x00' }))).response.status, 400);
    assert.equal((await call(f, '/api/v2/auth/challenge', { ...jsonInit({ wallet: f.account.address, chainId: CHAIN_ID }), headers: { origin: 'https://evil.example' } })).body.error, 'ORIGIN_MISMATCH');
    assert.equal((await call(f, '/api/v2/auth/challenge', jsonInit({ wallet: f.account.address, chainId: '1' }))).body.error, 'BAD_BODY');
    const sig = await f.account.signMessage({ message: c.body.message });
    const verified = await call(f, '/api/v2/auth/verify', jsonInit({ challengeId: c.body.challengeId, wallet: f.account.address, chainId: CHAIN_ID, signature: sig }));
    assert.equal(verified.response.status, 200);
    assert.equal((await call(f, '/api/v2/auth/verify', jsonInit({ challengeId: c.body.challengeId, wallet: f.account.address, chainId: CHAIN_ID, signature: sig }))).body.error, 'CHALLENGE_USED');
    const expired = await call(f, '/api/v2/auth/challenge', jsonInit({ wallet: f.account.address, chainId: CHAIN_ID })); f.advance(10 * 60 * 1000);
    const expiredSig = await f.account.signMessage({ message: expired.body.message });
    assert.equal((await call(f, '/api/v2/auth/verify', jsonInit({ challengeId: expired.body.challengeId, wallet: f.account.address, chainId: CHAIN_ID, signature: expiredSig }))).body.error, 'CHALLENGE_EXPIRED');
  } finally { await close(f); }
});

test('strict JSON boundary rejects unknown fields, queries, wrong content type and streamed oversized bodies', async () => {
  const f = await fixture();
  try {
    for (const [pathname, init] of [
      ['/api/v2/auth/challenge?x=1', jsonInit({ wallet: f.account.address, chainId: CHAIN_ID })],
      ['/api/v2/auth/challenge', jsonInit({ wallet: f.account.address, chainId: CHAIN_ID, extra: true })],
      ['/api/v2/auth/challenge', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body: '{}' }],
      ['/api/v2/auth/challenge', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'content-length': '1' }, body: JSON.stringify({ wallet: f.account.address, chainId: CHAIN_ID }) + 'x'.repeat(17_000) }],
    ]) assert.equal((await call(f, pathname, init)).response.status, 400);
    assert.equal((await call(f, '/api/v2/auth/challenge', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{' })).body.error, 'BAD_JSON');
  } finally { await close(f); }
});

test('CSRF failures do not revoke sessions and raw token/hash never enter JSON', async () => {
  const f = await fixture();
  try {
    const logged = await login(f); const cookieValue = logged.cookie.match(/=([^;]+)/)[1];
    for (const headers of [{ cookie: logged.cookie }, { cookie: logged.cookie, 'x-v2-csrf': 'wrong' }, { cookie: logged.cookie, 'x-v2-csrf': logged.verified.csrf, origin: 'https://evil.example' }]) {
      const result = await call(f, '/api/v2/auth/logout', { ...jsonInit(null), body: undefined, headers }); assert.equal(result.response.status, 403);
    }
    const still = await call(f, '/api/v2/auth/session', { headers: { cookie: logged.cookie } }); assert.equal(still.body.authenticated, true);
    assert.equal(JSON.stringify(still.body).includes(cookieValue), false);
    const row = (await f.db.query('SELECT token_hash FROM v2_sessions')).rows[0]; assert.notEqual(row.token_hash, cookieValue);
  } finally { await close(f); }
});

test('HTTP localhost uses only the local non-Secure cookie; wrong and duplicate cookies stay anonymous', async () => {
  const f = await fixture(LOCAL_ORIGIN);
  try {
    const logged = await login(f);
    assert.match(logged.cookie, /^ab_v2_local_session=/); assert.doesNotMatch(logged.cookie, /Secure/);
    assert.equal((await call(f, '/api/v2/auth/session', { headers: { cookie: logged.cookie } })).body.authenticated, true);
    assert.equal((await call(f, '/api/v2/auth/session', { headers: { cookie: `__Host-ab_v2_session=${logged.cookie.match(/=([^;]+)/)[1]}` } })).body.authenticated, false);
    assert.equal((await call(f, '/api/v2/auth/session', { headers: { cookie: `${logged.cookie}; ${logged.cookie}` } })).body.authenticated, false);
  } finally { await close(f); }
});

test('browser-shaped session GET accepts omitted Origin only for same-origin fetch context', async () => {
  const f = await fixture();
  try {
    const logged = await login(f);
    const browserRequest = (headers = {}) => new Request(`${f.origin}/api/v2/auth/session`, { method: 'GET', headers: { cookie: logged.cookie, ...headers } });
    const sameOrigin = await f.api(browserRequest({ 'sec-fetch-site': 'same-origin' }));
    assert.equal(sameOrigin.status, 200);
    assert.equal((await sameOrigin.json()).authenticated, true);
    const noFetchMetadata = await f.api(browserRequest());
    assert.equal(noFetchMetadata.status, 200);
    assert.equal((await noFetchMetadata.json()).authenticated, true);
    for (const headers of [
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
    ]) assert.equal((await f.api(browserRequest(headers))).status, 403);
    const wrongUrl = await f.api(new Request('https://evil.example/api/v2/auth/session', { headers: { cookie: logged.cookie } }));
    assert.equal(wrongUrl.status, 403);
  } finally { await close(f); }
});

test('authorizeMutation returns only trusted session identity after strict origin, cookie and CSRF checks', async () => {
  const f = await fixture();
  try {
    const logged = await login(f);
    const mutation = new Request(`${f.origin}/api/v2/private`, { method: 'POST', headers: { origin: f.origin, cookie: logged.cookie, 'x-v2-csrf': logged.verified.csrf } });
    const trusted = await f.api.authorizeMutation(mutation);
    const authenticated = await f.api.authenticateRequest(mutation);
    assert.deepEqual(trusted, { wallet: f.account.address, sessionId: authenticated.session.sessionId, expiresAt: authenticated.session.expiresAt });
    await assert.rejects(() => f.api.authorizeMutation(new Request(`${f.origin}/api/v2/private`, { method: 'POST', headers: { origin: f.origin, cookie: logged.cookie } })), (error) => error.code === 'CSRF_INVALID');
    await assert.rejects(() => f.api.authorizeMutation(new Request(`${f.origin}/api/v2/private`, { method: 'POST', headers: { origin: f.origin, cookie: `${logged.cookie}; ${logged.cookie}`, 'x-v2-csrf': logged.verified.csrf } })), (error) => error.code === 'INVALID_SESSION');
    await assert.rejects(() => f.api.authorizeMutation(new Request(`${f.origin}/api/v2/private`, { method: 'POST', headers: { origin: 'https://evil.example', cookie: logged.cookie, 'x-v2-csrf': logged.verified.csrf } })), (error) => error.code === 'ORIGIN_MISMATCH');
    await assert.rejects(() => f.api.authorizeMutation(new Request(`${f.origin}/api/v2/private`, { method: 'POST', headers: { origin: f.origin, cookie: `${logged.cookie}; x=${'a'.repeat(8200)}`, 'x-v2-csrf': logged.verified.csrf } })), (error) => error.code === 'INVALID_SESSION');
  } finally { await close(f); }
});
test('unexpected database errors and hostile error getters become a constant redacted 500', async () => {
  const f = await fixture();
  try {
    const hostile = Object.defineProperty(new Error('database-secret'), 'code', { get() { throw new Error('getter-secret'); } });
    const api = createV2AuthApi({ origin: ORIGIN, verifyWalletSignature: () => true, db: { query: async () => { throw hostile; }, transaction: async () => { throw hostile; } } });
    const result = await call({ ...f, api }, '/api/v2/auth/challenge', jsonInit({ wallet: f.account.address, chainId: CHAIN_ID }));
    assert.equal(result.response.status, 500); assert.deepEqual(result.body, { error: 'INTERNAL_ERROR' });
    assert.equal(JSON.stringify(result.body).includes('database-secret'), false); assert.equal(JSON.stringify(result.body).includes('getter-secret'), false);
  } finally { await close(f); }
});
