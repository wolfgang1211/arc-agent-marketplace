import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createSourcePreflightHandler } from "../lib/server/source-preflight.mjs";
import { withSourcePreflight } from "../lib/source-preflight.mjs";

const sourceUrl = "https://example.com/article";
const request = (value = { sourceUrl }) => new Request("https://market.example/api/source-preflight", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
});
const resolveHost = async () => [{ address: "93.184.216.34", family: 4 }];
const response = (body = "x".repeat(500), headers = {}, statusCode = 200) => ({ statusCode, headers: { "content-type": "text/plain", ...headers }, body: Buffer.from(body) });
const run = async (options, input) => {
  const res = await createSourcePreflightHandler({ resolveHost, ...options })(input || request());
  assert.equal(res.headers.get("cache-control"), "no-store");
  return res.json();
};

test("server uses a byte-identical worker fetch policy", () => {
  assert.equal(fs.readFileSync(new URL("../lib/server/safe-fetch.mjs", import.meta.url), "utf8"), fs.readFileSync(new URL("../../bot/src/safe-fetch.mjs", import.meta.url), "utf8"));
});
test("preflight returns no fetched text, URL, headers or hash", async () => {
  assert.deepEqual(await run({ request: async () => response() }), { ok: true });
});
test("source rules reject unsafe, inaccessible and oversized sources", async () => {
  for (const [res, reason] of [
    [response("", {}, 404), "http_status"],
    [response("", {}, 401), "http_status"],
    [response("", {}, 403), "http_status"],
    [response("x".repeat(500), { "content-type": "application/pdf" }), "unsupported_content_type"],
    [response("x", { "content-length": "2097153" }), "response_too_large"],
    [response("x".repeat(2097153)), "response_too_large"],
    [response("x".repeat(499)), "text_too_short"],
    [response("x".repeat(100001)), "text_too_long"],
    [response('Subscribe to continue reading ' + 'x'.repeat(500)), "paywall_or_access_denied"],
    [response('<input type="password">' + 'x'.repeat(500), { "content-type": "text/html" }), "authentication_required"],
    [response("", { location: "http://example.com" }, 302), "unsafe_url"],
    [response("", { location: "https://example.com" }, 302), "too_many_redirects"],
  ]) assert.deepEqual(await run({ request: async () => res }), { ok: false, reason, retryable: false });
});
test("DNS failures are safe/retryable and mixed private answers never reach HTTP", async () => {
  assert.deepEqual(await run({ resolveHost: async () => { throw Error("secret https://private.example/token"); } }), { ok: false, reason: "dns_error", retryable: true });
  assert.deepEqual(await run({ resolveHost: async () => [] }), { ok: false, reason: "dns_no_answers", retryable: true });
  assert.deepEqual(await run({ resolveHost: async () => [...await resolveHost(), { address: "127.0.0.1", family: 4 }], request: () => assert.fail("unsafe HTTP") }), { ok: false, reason: "unsafe_dns_answer", retryable: false });
});
test("redirects resolve again and cannot reach metadata addresses", async () => {
  let calls = 0;
  assert.deepEqual(await run({ resolveHost: async (host) => host === "example.com" ? resolveHost() : [{ address: "169.254.169.254", family: 4 }], request: async () => { calls++; return response("", { location: "https://metadata.example" }, 302); } }), { ok: false, reason: "unsafe_dns_answer", retryable: false });
  assert.equal(calls, 1);
});
test("exact text bounds succeed", async () => {
  for (const length of [500, 100000]) assert.deepEqual(await run({ request: async () => response("x".repeat(length)) }), { ok: true });
});
test("request validation runs before any DNS and bounds body bytes", async () => {
  const options = { resolveHost: () => assert.fail("unexpected DNS") };
  for (const value of [{}, { sourceUrl, extra: true }, { sourceUrl: 42 }, { sourceUrl: "x".repeat(8193) }]) {
    assert.equal((await run(options, request(value))).ok, false);
  }
  assert.equal((await run(options, new Request("https://market.example/api", { method: "POST", body: "x".repeat(9000), headers: { "content-type": "application/json" } }))).reason, "invalid_request");
});
test("total deadline bounds DNS and emits safe timeout", async () => {
  assert.deepEqual(await run({ resolveHost: () => new Promise(() => {}), timeoutMs: 10 }), { ok: false, reason: "fetch_timeout", retryable: true });
});
test("unknown failures cannot leak exception messages", async () => {
  assert.deepEqual(await run({ request: async () => { throw Error("private token"); } }), { ok: false, reason: "fetch_failed", retryable: true });
});
test("wallet continuation is blocked on negative, malformed, unavailable preflight", async () => {
  for (const fetchImpl of [async () => Response.json({ ok: false, reason: "http_status", retryable: false }), async () => Response.json({}), async () => Response.json({ ok: true }, { status: 500 }), async () => { throw Error("offline"); }]) {
    let writes = 0;
    await assert.rejects(withSourcePreflight("url-summary-v1", JSON.stringify({ sourceUrl }), () => { writes++; }, fetchImpl));
    assert.equal(writes, 0);
  }
});
test("successful preflight precedes wallet action and custom jobs skip it", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push("preflight"); assert.equal(url, "/api/source-preflight"); assert.deepEqual(JSON.parse(init.body), { sourceUrl }); return Response.json({ ok: true }); };
  await withSourcePreflight("url-summary-v1", JSON.stringify({ sourceUrl }), () => calls.push("approve"), fetchImpl);
  assert.deepEqual(calls, ["preflight", "approve"]);
  await withSourcePreflight("other", "custom", () => calls.push("custom"), () => assert.fail("unexpected preflight"));
  assert.equal(calls.at(-1), "custom");
});
test("posting wraps approval and escrow in mandatory preflight continuation", () => {
  const page = fs.readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
  assert.match(page, /return withSourcePreflight\(category, desc, async \(\) => \{[\s\S]*?functionName: "approve"[\s\S]*?return write\("postJob"/);
});

test("encoded content uses the worker decompression cap", async () => {
  assert.deepEqual(await run({ request: async () => response(gzipSync(Buffer.from("x".repeat(2097153))), { "content-encoding": "gzip" }) }), { ok: false, reason: "invalid_content_encoding", retryable: false });
  assert.deepEqual(await run({ request: async () => response(gzipSync(Buffer.from("x".repeat(500))), { "content-encoding": "gzip" }) }), { ok: true });
});
test("total deadline aborts active HTTP and late DNS never triggers HTTP", async () => {
  let signal;
  assert.deepEqual(await run({ timeoutMs: 10, request: async (target) => { signal = target.signal; return new Promise(() => {}); } }), { ok: false, reason: "fetch_timeout", retryable: true });
  assert.equal(signal.aborted, true);
  let resolve;
  const result = await run({ timeoutMs: 10, resolveHost: () => new Promise((done) => { resolve = done; }), request: () => assert.fail("HTTP after expired DNS") });
  assert.equal(result.reason, "fetch_timeout");
  resolve(await resolveHost());
  await new Promise((done) => setImmediate(done));
});
test("concurrency is bounded and the slot is reusable after completion", async () => {
  const releases = [];
  const handler = createSourcePreflightHandler({ resolveHost, request: () => new Promise((done) => releases.push(done)) });
  const pending = Array.from({ length: 4 }, () => handler(request()));
  const busy = await handler(request());
  assert.equal(busy.status, 503);
  assert.deepEqual(await busy.json(), { ok: false, reason: "preflight_busy", retryable: true });
  await new Promise((done) => setImmediate(done));
  assert.equal(releases.length, 4);
  releases.splice(0).forEach((done) => done(response()));
  await Promise.all(pending);
  const next = handler(request());
  await new Promise((done) => setImmediate(done));
  assert.equal(releases.length, 1);
  releases[0](response());
  assert.deepEqual(await (await next).json(), { ok: true });
});
test("source is checked anew for each submitted description", async () => {
  const checked = [];
  const fetchImpl = async (_, init) => { checked.push(JSON.parse(init.body).sourceUrl); return Response.json({ ok: true }); };
  for (const url of [sourceUrl, "https://example.com/changed", sourceUrl]) {
    await withSourcePreflight("url-summary-v1", JSON.stringify({ sourceUrl: url }), () => {}, fetchImpl);
  }
  assert.deepEqual(checked, [sourceUrl, "https://example.com/changed", sourceUrl]);
});
test("untrusted server/transport text is not displayed", async () => {
  for (const fetchImpl of [async () => Response.json({ ok: false, reason: "secret-token", message: "private" }), async () => { throw Error("Source check failed (secret-token)"); }]) {
    await assert.rejects(withSourcePreflight("url-summary-v1", JSON.stringify({ sourceUrl }), () => assert.fail("wallet write"), fetchImpl), (error) => !/secret-token|private/.test(error.message));
  }
});
