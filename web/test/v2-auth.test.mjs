import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createWalletSessionService, sessionCookie, verifySessionCookie } from '../lib/v2/server/wallet-session.mjs';

const ORIGIN = 'https://app.example.test';
const DOMAIN = 'app.example.test';
const CHAIN_ID = 5042002n;
const MARKET = '0xFA156B7A5205B123c8a22A807ba98405e36130f1';
const scratch = process.env.TMPDIR ?? join(process.cwd(), '.hermes-scratch');
async function fixture() { const dir = await mkdtemp(join(scratch, 'v2-auth-')); const db = await createPgliteDb({ dataDir: dir }); await migrate(db); return { db, dir }; }
async function dispose(x) { await x.db.close(); await rm(x.dir, { recursive: true, force: true }); }

 test('real viem signature authenticates a canonical challenge, stores no raw token, and one-use is atomic', async () => {
  const f = await fixture(); const account = privateKeyToAccount(generatePrivateKey()); let now = Date.parse('2026-01-01T00:00:00.000Z');
  try {
    const auth = createWalletSessionService({ db: f.db, origin: ORIGIN, chainId: CHAIN_ID, marketplace: MARKET, now: () => now, verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }) });
    const challenge = await auth.issueChallenge({ wallet: account.address, requestOrigin: ORIGIN, chainId: CHAIN_ID });
    assert.match(challenge.message, /AlphaBoard V2 wallet login/); assert.match(challenge.message, /Not an EIP-712 application or transaction/);
    const signature = await account.signMessage({ message: challenge.message });
    const results = await Promise.allSettled([auth.verifyChallenge({ challengeId: challenge.challengeId, wallet: account.address, signature, requestOrigin: ORIGIN, chainId: CHAIN_ID }), auth.verifyChallenge({ challengeId: challenge.challengeId, wallet: account.address, signature, requestOrigin: ORIGIN, chainId: CHAIN_ID })]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1); const session = results.find((result) => result.status === 'fulfilled').value;
    const row = (await f.db.query('SELECT message, consumed_at, token_hash FROM v2_auth_challenges c JOIN v2_sessions s ON s.wallet=c.wallet WHERE c.id=$1', [challenge.challengeId])).rows[0];
    assert.equal(row.message, challenge.message); assert.notEqual(row.token_hash, session.rawToken); assert.equal(session.wallet, account.address);
  } finally { await dispose(f); }
});

test('challenge expiry is rechecked when a queued transaction begins', async () => {
  const f = await fixture(); const account = privateKeyToAccount(generatePrivateKey()); let now = Date.parse('2026-01-01T00:00:00.000Z'); let verifierResolved = false;
  const db = {
    query: (...args) => f.db.query(...args),
    transaction: (callback) => f.db.transaction(async (tx) => { assert.equal(verifierResolved, true); now += 10 * 60 * 1000; return callback(tx); })
  };
  try {
    const auth = createWalletSessionService({ db, origin: ORIGIN, chainId: CHAIN_ID, marketplace: MARKET, now: () => now, verifyWalletSignature: async ({ message, signature, wallet }) => { const valid = await verifyMessage({ address: wallet, message, signature }); verifierResolved = true; return valid; } });
    const challenge = await auth.issueChallenge({ wallet: account.address, requestOrigin: ORIGIN, chainId: CHAIN_ID });
    const signature = await account.signMessage({ message: challenge.message });
    await assert.rejects(auth.verifyChallenge({ challengeId: challenge.challengeId, wallet: account.address, signature, requestOrigin: ORIGIN, chainId: CHAIN_ID }), (e) => e.code === 'CHALLENGE_EXPIRED');
    assert.equal(verifierResolved, true);
    assert.equal((await f.db.query('SELECT consumed_at FROM v2_auth_challenges WHERE id=$1', [challenge.challengeId])).rows[0].consumed_at, null);
    assert.equal((await f.db.query('SELECT count(*)::int AS count FROM v2_sessions')).rows[0].count, 0);
  } finally { await dispose(f); }
});

test('bindings, expiry, invalid signatures, cookies, CSRF and logout fail closed', async () => {
  const f = await fixture(); const account = privateKeyToAccount(generatePrivateKey()); let now = Date.parse('2026-01-01T00:00:00.000Z');
  try {
    const auth = createWalletSessionService({ db: f.db, origin: ORIGIN, chainId: CHAIN_ID, marketplace: MARKET, now: () => now, verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }) });
    const c = await auth.issueChallenge({ wallet: account.address, requestOrigin: ORIGIN, chainId: CHAIN_ID });
    const sig = await account.signMessage({ message: c.message });
    await assert.rejects(auth.verifyChallenge({ challengeId: c.challengeId, wallet: account.address, signature: sig, requestOrigin: 'https://evil.example' }), (e) => e.code === 'ORIGIN_MISMATCH');
    await assert.rejects(auth.verifyChallenge({ challengeId: c.challengeId, wallet: account.address, signature: '0x00', requestOrigin: ORIGIN, chainId: CHAIN_ID }), (e) => e.code === 'INVALID_SIGNATURE');
    now += 10 * 60 * 1000; await assert.rejects(auth.verifyChallenge({ challengeId: c.challengeId, wallet: account.address, signature: sig, requestOrigin: ORIGIN, chainId: CHAIN_ID }), (e) => e.code === 'CHALLENGE_EXPIRED');
    const fresh = await auth.issueChallenge({ wallet: account.address, requestOrigin: ORIGIN, chainId: CHAIN_ID }); const freshSig = await account.signMessage({ message: fresh.message }); const session = await auth.verifyChallenge({ challengeId: fresh.challengeId, wallet: account.address, signature: freshSig, requestOrigin: ORIGIN, chainId: CHAIN_ID });
    const cookie = sessionCookie(session.rawToken, { secure: true }); assert.match(cookie, /^__Host-ab_v2_session=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.equal(verifySessionCookie(cookie), session.rawToken);
    const csrf = auth.csrfToken(session.rawToken); assert.equal(auth.verifyCsrf({ rawToken: session.rawToken, requestOrigin: ORIGIN, csrfToken: csrf }), true); assert.equal(auth.verifyCsrf({ rawToken: session.rawToken, requestOrigin: ORIGIN, csrfToken: 'bad' }), false);
    assert.equal((await auth.lookupSession(session.rawToken, ORIGIN, CHAIN_ID)).wallet, account.address); await auth.logout(session.rawToken, ORIGIN, CHAIN_ID); assert.equal(await auth.lookupSession(session.rawToken, ORIGIN, CHAIN_ID), null);
  } finally { await dispose(f); }
});

test('production verifier is explicit and local cookie is not secure', () => { assert.throws(() => createWalletSessionService({ db: { query() {}, transaction() {} }, origin: ORIGIN, chainId: CHAIN_ID, marketplace: MARKET }), /verifyWalletSignature/); assert.match(sessionCookie('a'.repeat(43), { secure: false }), /^ab_v2_local_session=/); });

test('factory and request chain binding are fixed and reject malformed coercions', async () => {
  const db = { query() {}, transaction() {} }; const verifyWalletSignature = () => true;
  assert.throws(() => createWalletSessionService({ db, origin: ORIGIN, chainId: 1n, marketplace: MARKET, verifyWalletSignature }), /CHAIN_MISMATCH/);
  assert.throws(() => createWalletSessionService({ db, origin: ORIGIN, chainId: '5042002', marketplace: MARKET, verifyWalletSignature }), /CHAIN_MISMATCH/);
  assert.throws(() => createWalletSessionService({ db, origin: ORIGIN, chainId: CHAIN_ID, marketplace: '0x1111111111111111111111111111111111111111', verifyWalletSignature }), /INVALID_MARKETPLACE/);
  const f = await fixture(); const account = privateKeyToAccount(generatePrivateKey());
  try {
    const auth = createWalletSessionService({ db: f.db, origin: ORIGIN, chainId: CHAIN_ID, marketplace: MARKET, verifyWalletSignature });
    await assert.rejects(auth.issueChallenge({ wallet: account.address, requestOrigin: ORIGIN, chainId: 1n }), (e) => e.code === 'CHAIN_MISMATCH');
    await assert.rejects(auth.issueChallenge({ wallet: account.address, requestOrigin: ORIGIN, chainId: NaN }), (e) => e.code === 'CHAIN_MISMATCH');
    await assert.rejects(auth.issueChallenge({ wallet: account.address, requestOrigin: ORIGIN, chainId: { valueOf: () => CHAIN_ID } }), (e) => e.code === 'CHAIN_MISMATCH');
    const challenge = await auth.issueChallenge({ wallet: account.address, requestOrigin: ORIGIN, chainId: CHAIN_ID }); assert.equal(challenge.chainId, String(CHAIN_ID));
  } finally { await dispose(f); }
});

test('stored challenge message must equal the canonical reconstruction before verification', async () => {
  const f = await fixture(); const account = privateKeyToAccount(generatePrivateKey()); let now = Date.parse('2026-01-01T00:00:00.000Z'); let verifierCalls = 0;
  try {
    const auth = createWalletSessionService({ db: f.db, origin: ORIGIN, chainId: CHAIN_ID, marketplace: MARKET, now: () => now, verifyWalletSignature: () => { verifierCalls += 1; return true; } });
    const cases = [
      ['Address', account.address, '0x1111111111111111111111111111111111111111'],
      ['Origin', ORIGIN, 'https://evil.example'],
      ['Chain ID', String(CHAIN_ID), '1'],
      ['Nonce', null, 'attacker-nonce'],
      ['Expiration Time', null, '2026-01-01T00:00:01.000Z'],
      ['Request ID', null, 'attacker-controlled-id']
    ];
    for (const [field, original, replacement] of cases) {
      const challenge = await auth.issueChallenge({ wallet: account.address, requestOrigin: ORIGIN, chainId: CHAIN_ID });
      const expected = original ?? (field === 'Nonce' ? challenge.message.match(/Nonce: ([^\n]+)/)[1] : field === 'Expiration Time' ? challenge.message.match(/Expiration Time: ([^\n]+)/)[1] : challenge.challengeId);
      const tampered = challenge.message.replace(`${field}: ${expected}`, `${field}: ${replacement}`);
      assert.match(tampered, /\nMarketplace: 0xFA156B7A5205B123c8a22A807ba98405e36130f1\n/);
      await f.db.query('UPDATE v2_auth_challenges SET message=$2 WHERE id=$1', [challenge.challengeId, tampered]);
      await assert.rejects(auth.verifyChallenge({ challengeId: challenge.challengeId, wallet: account.address, signature: 'attacker-signature', requestOrigin: ORIGIN, chainId: CHAIN_ID }), (e) => e.code === 'CHALLENGE_BINDING');
    }
    assert.equal(verifierCalls, 0);
    assert.equal((await f.db.query('SELECT count(*)::int AS count FROM v2_sessions')).rows[0].count, 0);
  } finally { await dispose(f); }
});

test('session cookie maxAge is a bounded finite integer and permits explicit zero logout', () => {
  const token = 'a'.repeat(43);
  assert.match(sessionCookie(token, { maxAge: 0 }), /Max-Age=0$/);
  for (const value of [NaN, Infinity, -1, 1.5, '3600', Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => sessionCookie(token, { maxAge: value }), /maxAge/);
  }
});
