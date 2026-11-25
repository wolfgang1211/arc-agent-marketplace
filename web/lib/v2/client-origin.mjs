// The local V2 API accepts exactly one origin (http://127.0.0.1:<port>). A
// localhost URL signs in but private reads fail with ORIGIN_MISMATCH, so the UI
// moves to the canonical loopback host. Non-localhost hosts are left untouched.
export function canonicalLoopbackUrl(href) {
  try { const u = new URL(href); if (u.hostname !== 'localhost') return null; u.hostname = '127.0.0.1'; return u.toString(); }
  catch { return null; }
}
