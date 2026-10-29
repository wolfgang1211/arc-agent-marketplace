import { ARC_TESTNET_PROFILE, assertV2Profile } from '../chain-profile.mjs';
import { createWalletSessionService, sessionCookie, verifySessionCookie, WalletAuthError } from './wallet-session.mjs';

const MAX_BODY_BYTES = 16 * 1024;
const CHAIN_ID = '5042002';
const SESSION_COOKIE_SECURE = '__Host-ab_v2_session';
const SESSION_COOKIE_LOCAL = 'ab_v2_local_session';
const ALLOWED_ERRORS = new Set([
  'INVALID_WALLET', 'INVALID_ORIGIN', 'ORIGIN_MISMATCH', 'CHAIN_MISMATCH',
  'INVALID_CHALLENGE', 'CHALLENGE_BINDING', 'CHALLENGE_EXPIRED', 'CHALLENGE_USED',
  'INVALID_SIGNATURE', 'INVALID_SESSION', 'CSRF_INVALID', 'BAD_JSON', 'BAD_BODY',
  'BAD_QUERY', 'METHOD_NOT_ALLOWED', 'NOT_FOUND',
]);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      Vary: 'Cookie',
      ...extra,
    },
  });
}
function error(code, status = 400, extra = {}) { return json({ error: code }, status, extra); }
function ownData(obj, key) {
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function safeErrorCode(thrown) {
  try {
    const code = ownData(thrown, 'code');
    return typeof code === 'string' && ALLOWED_ERRORS.has(code) ? code : null;
  } catch { return null; }
}
function statusFor(code) {
  if (code === 'METHOD_NOT_ALLOWED') return 405;
  if (code === 'NOT_FOUND') return 404;
  if (code === 'ORIGIN_MISMATCH' || code === 'CSRF_INVALID') return 403;
  if (code === 'INVALID_SESSION') return 401;
  if (code === 'CHALLENGE_USED' || code === 'CHALLENGE_EXPIRED') return 409;
  return 400;
}
function fixedPath(url) {
  if (url.pathname.endsWith('/') || url.pathname.includes('//')) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  return parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'auth' && parts.length === 4 ? parts[3] : null;
}
function noQuery(url) { return [...url.searchParams].length === 0; }
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
async function readBody(request, required) {
  const contentType = request.headers.get('content-type');
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) throw new WalletAuthError('BAD_BODY');
  if (!required && !contentType) return null;
  if (contentType !== 'application/json') throw new WalletAuthError('BAD_BODY');
  if (!request.body) {
    if (required) throw new WalletAuthError('BAD_BODY');
    return null;
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) throw new WalletAuthError('BAD_BODY');
      chunks.push(part.value);
    }
  } finally { try { reader.releaseLock(); } catch {} }
  if (size === 0) { if (required) throw new WalletAuthError('BAD_BODY'); return null; }
  try { return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))); } catch { throw new WalletAuthError('BAD_JSON'); }
}
function cookieToken(request, secure) {
  const raw = request.headers.get('cookie');
  if (raw === null || raw.length > 8192) return null;
  const expected = secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_LOCAL;
  const values = [];
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === expected) values.push(value);
  }
  if (values.length !== 1) return null;
  return verifySessionCookie(`${expected}=${values[0]}`);
}
function requireFixedOrigin(request, configuredOrigin) {
  const url = new URL(request.url);
  if (url.origin !== configuredOrigin || request.headers.get('origin') !== configuredOrigin) throw new WalletAuthError('ORIGIN_MISMATCH');
  return url;
}
function allowBrowserSessionGet(request, configuredOrigin) {
  const url = new URL(request.url);
  if (url.origin !== configuredOrigin) throw new WalletAuthError('ORIGIN_MISMATCH');
  const requestOrigin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (requestOrigin !== null && requestOrigin !== configuredOrigin) throw new WalletAuthError('ORIGIN_MISMATCH');
  if (fetchSite !== null && !['same-origin', 'none'].includes(fetchSite)) throw new WalletAuthError('ORIGIN_MISMATCH');
  return url;
}

export function createV2AuthApi({ db, origin, profile = ARC_TESTNET_PROFILE, verifyWalletSignature, now } = {}) {
  assertV2Profile(profile);
  const CHAIN_ID = profile.canonicalChainId.toString();
  const service = createWalletSessionService({ db, origin, profile, chainId: profile.canonicalChainId, marketplace: profile.marketplace, verifyWalletSignature, now });
  const configuredOrigin = service.origin;
  const secure = new URL(configuredOrigin).protocol === 'https:';
  const cookieName = secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_LOCAL;
  const authenticateRequest = async (request) => {
    const token = cookieToken(request, secure);
    if (!token) return null;
    return { token, session: await service.lookupSession(token, configuredOrigin) };
  };
  const authorizeMutation = async (request) => {
    requireFixedOrigin(request, configuredOrigin);
    const token = cookieToken(request, secure);
    if (!token) throw new WalletAuthError('INVALID_SESSION');
    const session = await service.lookupSession(token, configuredOrigin);
    if (!session) throw new WalletAuthError('INVALID_SESSION');
    if (!service.verifyCsrf({ rawToken: token, requestOrigin: configuredOrigin, csrfToken: request.headers.get('x-v2-csrf') })) throw new WalletAuthError('CSRF_INVALID');
    return Object.freeze({ wallet: session.wallet, sessionId: session.sessionId, expiresAt: session.expiresAt });
  };
  async function handle(request) {
    try {
      const url = new URL(request.url);
      const route = fixedPath(url);
      if (!route) return error('NOT_FOUND', 404);
      const isSessionGet = route === 'session' && request.method === 'GET';
      if (isSessionGet) allowBrowserSessionGet(request, configuredOrigin);
      else requireFixedOrigin(request, configuredOrigin);
      const requestOrigin = request.headers.get('origin');
      if (route === 'challenge') {
        if (request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 405);
        if (!noQuery(url)) throw new WalletAuthError('BAD_QUERY');
        const body = await readBody(request, true);
        if (!exactKeys(body, ['wallet', 'chainId']) || body.chainId !== CHAIN_ID || !ADDRESS_RE.test(body.wallet)) throw new WalletAuthError('BAD_BODY');
        const challenge = await service.issueChallenge({ wallet: body.wallet, chainId: BigInt(CHAIN_ID), requestOrigin });
        return json({ challengeId: challenge.challengeId, wallet: challenge.wallet, chainId: challenge.chainId, domain: challenge.domain, origin: challenge.origin, message: challenge.message, expiresAt: challenge.expiresAt });
      }
      if (route === 'verify') {
        if (request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 405);
        if (!noQuery(url)) throw new WalletAuthError('BAD_QUERY');
        const body = await readBody(request, true);
        if (!exactKeys(body, ['challengeId', 'wallet', 'chainId', 'signature']) || body.chainId !== CHAIN_ID || !ADDRESS_RE.test(body.wallet) || typeof body.challengeId !== 'string' || typeof body.signature !== 'string') throw new WalletAuthError('BAD_BODY');
        const session = await service.verifyChallenge({ ...body, chainId: BigInt(CHAIN_ID), requestOrigin });
        const maxAge = Math.max(0, Math.ceil((Date.parse(session.expiresAt) - (now ? now() : Date.now())) / 1000));
        return json({ authenticated: true, wallet: session.wallet, expiresAt: session.expiresAt, csrf: service.csrfToken(session.rawToken) }, 200, { 'set-cookie': sessionCookie(session.rawToken, { secure, maxAge }) });
      }
      if (route === 'session') {
        if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 405);
        if (!noQuery(url)) throw new WalletAuthError('BAD_QUERY');
        const auth = await authenticateRequest(request);
        if (!auth?.session) return json({ authenticated: false });
        return json({ authenticated: true, wallet: auth.session.wallet, expiresAt: auth.session.expiresAt, csrf: service.csrfToken(auth.token) });
      }
      if (route === 'logout') {
        if (request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 405);
        if (!noQuery(url)) throw new WalletAuthError('BAD_QUERY');
        await readBody(request, false);
        const auth = await authenticateRequest(request);
        if (!auth?.session) return error('INVALID_SESSION', 401);
        if (!service.verifyCsrf({ rawToken: auth.token, requestOrigin, csrfToken: request.headers.get('x-v2-csrf') })) throw new WalletAuthError('CSRF_INVALID');
        const revoked = await service.logout(auth.token, configuredOrigin);
        if (!revoked) return error('INVALID_SESSION', 401);
        return json({ authenticated: false }, 200, { 'set-cookie': `${cookieName}=; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=0` });
      }
      return error('NOT_FOUND', 404);
    } catch (thrown) {
      const code = safeErrorCode(thrown);
      if (code) return error(code, statusFor(code));
      return error('INTERNAL_ERROR', 500);
    }
  }
  Object.defineProperties(handle, { handle: { value: handle }, authenticateRequest: { value: authenticateRequest }, authorizeMutation: { value: authorizeMutation } });
  return handle;
}
