import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Local Phase 1a keeps PGlite WASM and accepted SQL URLs native to Node.
// This avoids modifying the shared V1 build configuration.
let runtimeModule;
async function loadRuntime() {
  const url = pathToFileURL(path.join(process.cwd(), 'lib', 'v2', 'server', 'api-runtime.mjs')).href;
  runtimeModule ??= import(/* webpackIgnore: true */ url);
  return runtimeModule;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function handle(request) {
  try {
    const { getV2LocalRuntime, V2_LOCAL_ORIGIN } = await loadRuntime();
    // Next may normalize Request.url to its internal hostname. Only accept the
    // exact local Host, then preserve path, headers and body on the fixed origin.
    if (request.headers.get('host') !== new URL(V2_LOCAL_ORIGIN).host) return Response.json({ error: 'ORIGIN_MISMATCH' }, { status: 403, headers: { 'cache-control': 'no-store' } });
    const incoming = new URL(request.url);
    const canonicalUrl = new URL(incoming.pathname + incoming.search, V2_LOCAL_ORIGIN);
    const options = { method: request.method, headers: request.headers };
    if (request.method !== 'GET' && request.method !== 'HEAD') Object.assign(options, { body: request.body, duplex: 'half' });
    const canonicalRequest = new Request(canonicalUrl, options);
    const api = await getV2LocalRuntime();
    return await api.handle(canonicalRequest);
  } catch {
    return Response.json({ error: 'V2_API_UNAVAILABLE' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS, handle as HEAD };
