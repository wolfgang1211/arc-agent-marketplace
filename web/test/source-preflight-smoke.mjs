// Run after npm run build. Starts only a loopback server, never a browser/wallet.
import assert from "node:assert/strict";
import http from "node:http";
import next from "next";

const app = next({ dev: false, hostname: "127.0.0.1" });
await app.prepare();
const server = http.createServer(app.getRequestHandler());
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const [sourceUrl, reason] of [
    ["http://example.com", "unsafe_url"],
    ["https://127.0.0.1", "unsafe_dns_answer"],
    ["https://source-preflight.invalid", "dns_error"],
  ]) {
    const response = await fetch(`${origin}/api/source-preflight`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceUrl }), signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    console.log(JSON.stringify({ route: "/api/source-preflight", status: response.status, result }));
  }
  const get = await fetch(`${origin}/api/source-preflight`);
  assert.equal(get.status, 405);
  console.log("GET rejected: 405");
  const page = await fetch(origin);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /URL-summary sources are checked for public access before USDC approval/);
  assert.match(html, /Connect wallet to post a job/);
  console.log("Production homepage: 200; read-only preflight and walletless copy verified");
  if (process.argv.includes("--live")) {
    const response = await fetch(`${origin}/api/source-preflight`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceUrl: "https://www.iana.org/help/example-domains" }), signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    console.log(JSON.stringify({ probe: "public IANA source (read-only)", status: response.status, result }));
    assert.deepEqual(result, { ok: true });
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await app.close();
}
