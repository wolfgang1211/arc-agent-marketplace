import { ARC_TESTNET_PROFILE, assertV2Profile } from '../chain-profile.mjs';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAddress, verifyMessage } from 'viem';

const DEFAULT_CHAIN_ID = 5042002n;
const FIXED_MARKETPLACE = '0xFA156B7A5205B123c8a22A807ba98405e36130f1';
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const CSRF_LABEL = 'alphaboard-v2-csrf-v1';
const RAW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const ORIGIN_RE = /^(https?):\/\/([^/?#]+)$/;

export class WalletAuthError extends Error { constructor(code) { super(code); this.name = 'WalletAuthError'; this.code = code; } }
const fail = (code) => { throw new WalletAuthError(code); };
function string(value, code, max = 512) { if (typeof value !== 'string' || value.length === 0 || value.length > max) fail(code); return value; }
function address(value, code = 'INVALID_WALLET') { string(value, code, 42); try { return getAddress(value); } catch { fail(code); } }
function origin(value, code = 'ORIGIN_MISMATCH') { string(value, code, 256); const match = ORIGIN_RE.exec(value); if (!match || match[1] !== 'https' && !/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/.test(match[2])) fail(code); return value; }
function iso(ms) { return new Date(ms).toISOString(); }
function digest(token) { return createHash('sha256').update(token, 'utf8').digest('hex'); }
function rawToken() { return randomBytes(32).toString('base64url'); }
function canonicalMessage({ domain, requestOrigin, wallet, chainId, marketplace, nonce, issuedAt, expiresAt, requestId }) {
  return `AlphaBoard V2 wallet login\n\nDomain: ${domain}\nOrigin: ${requestOrigin}\nURI: ${requestOrigin}/auth/wallet\nAddress: ${wallet}\nChain ID: ${chainId}\nMarketplace: ${marketplace}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}\nRequest ID: ${requestId}\n\nSign this message to log in. Not an EIP-712 application or transaction.`;
}
function checkFixedOrigin(configured, requested) { if (typeof requested !== 'string' || requested !== configured) fail('ORIGIN_MISMATCH'); }
function checkChain(expected, provided) { if (typeof provided !== 'bigint' || provided !== expected) fail('CHAIN_MISMATCH'); }

export function createWalletSessionService({ db, origin: configuredOrigin, profile = ARC_TESTNET_PROFILE, chainId = profile.canonicalChainId, marketplace = profile.marketplace, now = () => Date.now(), verifyWalletSignature } = {}) {
  assertV2Profile(profile);
  if (!db || typeof db.query !== 'function' || typeof db.transaction !== 'function') throw new TypeError('db is required');
  const requestOrigin = origin(configuredOrigin, 'INVALID_ORIGIN');
  const parsed = new URL(requestOrigin); const domain = profile.authDomain;
  if (parsed.protocol === 'http:' && !/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(parsed.hostname)) fail('INVALID_ORIGIN');
  if (typeof chainId !== 'bigint' || chainId !== profile.canonicalChainId) fail('CHAIN_MISMATCH');
  const fixedChain = chainId; const fixedMarket = address(marketplace, 'INVALID_MARKETPLACE'); if (fixedMarket.toLowerCase() !== profile.marketplace.toLowerCase()) fail('INVALID_MARKETPLACE');
  if (typeof verifyWalletSignature !== 'function') throw new TypeError('verifyWalletSignature is required');
  const clock = () => { const value = now(); if (!Number.isFinite(value)) throw new Error('clock'); return value; };

  async function issueChallenge(input = {}) {
    const wallet = address(input.wallet); checkFixedOrigin(requestOrigin, input.requestOrigin); checkChain(fixedChain, input.chainId);
    const issued = clock(); const expires = issued + CHALLENGE_TTL_MS; const nonce = randomBytes(32).toString('hex'); const challengeId = randomUUID();
    const issuedAt = iso(issued); const expiresAt = iso(expires); const message = canonicalMessage({ domain, requestOrigin, wallet, chainId: fixedChain.toString(), marketplace: fixedMarket, nonce, issuedAt, expiresAt, requestId: challengeId });
    await db.query('INSERT INTO v2_auth_challenges (id,wallet,chain_id,domain,origin,message,nonce,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [challengeId, wallet, fixedChain.toString(), domain, requestOrigin, message, nonce, expiresAt]);
    return Object.freeze({ challengeId, wallet, chainId: fixedChain.toString(), domain, origin: requestOrigin, message, expiresAt });
  }

  async function verifyChallenge(input = {}) {
    const challengeId = string(input.challengeId, 'INVALID_CHALLENGE', 128); const wallet = address(input.wallet); checkFixedOrigin(requestOrigin, input.requestOrigin); checkChain(fixedChain, input.chainId); const signature = string(input.signature, 'INVALID_SIGNATURE', 2048);
    const found = await db.query('SELECT id,wallet,chain_id,domain,origin,message,nonce,expires_at,consumed_at FROM v2_auth_challenges WHERE id=$1', [challengeId]); const row = found.rows[0]; if (!row) fail('INVALID_CHALLENGE');
    if (row.wallet !== wallet || String(row.chain_id) !== fixedChain.toString() || row.origin !== requestOrigin || row.domain !== domain || !row.message.includes(`\nMarketplace: ${fixedMarket}\n`)) fail('CHALLENGE_BINDING');
    // PGlite/pg return TIMESTAMPTZ as Date objects. Date.parse(Date) coerces
    // through toString(), dropping milliseconds and breaking the signed message.
    const expiresMs = row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(row.expires_at); if (!Number.isFinite(expiresMs) || clock() >= expiresMs) fail('CHALLENGE_EXPIRED');
    const expectedMessage = canonicalMessage({ domain: row.domain, requestOrigin: row.origin, wallet: row.wallet, chainId: String(row.chain_id), marketplace: fixedMarket, nonce: row.nonce, issuedAt: iso(expiresMs - CHALLENGE_TTL_MS), expiresAt: iso(expiresMs), requestId: row.id });
    if (row.message !== expectedMessage) fail('CHALLENGE_BINDING');
    let valid = false; try { valid = await verifyWalletSignature({ wallet, message: row.message, signature, challenge: row }); } catch { valid = false; }
    if (valid !== true) fail('INVALID_SIGNATURE');
    const token = rawToken(); const sessionId = randomUUID();
    const result = await db.transaction(async (tx) => {
      const transactionNow = clock(); if (transactionNow >= expiresMs) fail('CHALLENGE_EXPIRED');
      const sessionExpires = iso(Math.min(transactionNow + SESSION_TTL_MS, transactionNow + MAX_SESSION_TTL_MS));
      const consumed = await tx.query('UPDATE v2_auth_challenges SET consumed_at=$2 WHERE id=$1 AND consumed_at IS NULL AND expires_at>$2 RETURNING id', [challengeId, iso(transactionNow)]);
      if (consumed.rows.length !== 1) fail('CHALLENGE_USED');
      await tx.query('INSERT INTO v2_sessions (id,wallet,token_hash,expires_at,origin,chain_id) VALUES ($1,$2,$3,$4,$5,$6)', [sessionId, wallet, digest(token), sessionExpires, requestOrigin, fixedChain.toString()]);
      return { sessionId, wallet, expiresAt: sessionExpires, rawToken: token };
    });
    return Object.freeze(result);
  }

  async function lookupSession(token, requestedOrigin = requestOrigin, requestedChain = fixedChain) {
    if (typeof token !== 'string' || !RAW_TOKEN_RE.test(token)) return null; checkFixedOrigin(requestOrigin, requestedOrigin); checkChain(fixedChain, requestedChain);
    const rows = await db.query('SELECT id,wallet,expires_at FROM v2_sessions WHERE token_hash=$1 AND origin=$2 AND chain_id=$3 AND revoked_at IS NULL AND expires_at>$4', [digest(token), requestOrigin, fixedChain.toString(), iso(clock())]);
    if (!rows.rows[0]) return null; return Object.freeze({ sessionId: rows.rows[0].id, wallet: rows.rows[0].wallet, expiresAt: rows.rows[0].expires_at });
  }
  async function logout(token, requestedOrigin = requestOrigin, requestedChain = fixedChain) { if (await lookupSession(token, requestedOrigin, requestedChain) === null) return false; const r = await db.query('UPDATE v2_sessions SET revoked_at=$2 WHERE token_hash=$1 AND origin=$3 AND chain_id=$4 AND revoked_at IS NULL', [digest(token), iso(clock()), requestOrigin, fixedChain.toString()]); return r.rowCount === 1; }
  function csrfToken(token) { if (typeof token !== 'string' || !RAW_TOKEN_RE.test(token)) fail('INVALID_SESSION'); return createHmac('sha256', token).update(CSRF_LABEL).digest('base64url'); }
  function verifyCsrf({ rawToken: token, requestOrigin: requestedOrigin = requestOrigin, csrfToken: supplied } = {}) { try { checkFixedOrigin(requestOrigin, requestedOrigin); if (typeof supplied !== 'string') return false; const a = Buffer.from(csrfToken(token)); const b = Buffer.from(supplied); return a.length === b.length && timingSafeEqual(a, b); } catch { return false; } }
  return Object.freeze({ issueChallenge, verifyChallenge, lookupSession, logout, csrfToken, verifyCsrf, origin: requestOrigin, chainId: fixedChain.toString(), marketplace: fixedMarket });
}

export function sessionCookie(token, { secure = true, maxAge = 3600 } = {}) { if (typeof token !== 'string' || !RAW_TOKEN_RE.test(token)) throw new TypeError('token'); if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > SESSION_TTL_MS / 1000) throw new TypeError('maxAge'); const name = secure ? '__Host-ab_v2_session' : 'ab_v2_local_session'; return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${maxAge}`; }
export function verifySessionCookie(cookie) { if (typeof cookie !== 'string') return null; const match = /(?:^|;\s*)(?:__Host-ab_v2_session|ab_v2_local_session)=([^;]+)/.exec(cookie); return match && RAW_TOKEN_RE.test(match[1]) ? match[1] : null; }
export { canonicalMessage };
