import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  IntakeError,
  fetchEligibleSource,
  isPublicAddress,
} from "../src/safe-fetch.mjs";

const html = `<html><head><title>Clean source</title></head><body><main>${"Useful public article sentence. ".repeat(30)}</main></body></html>`;
const resolver = async (hostname) => [{ address: hostname === "next.example" ? "1.1.1.1" : "93.184.216.34", family: 4 }];
const response = (statusCode, headers, body) => ({ statusCode, headers, body: Buffer.from(body) });

test("public address classifier rejects private, metadata, reserved, and non-unicast IPs", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.2", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "2001:db8::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["93.184.216.34", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
});

test("pins the HTTPS connection to a validated DNS answer and returns normalized source", async () => {
  const calls = [];
  const result = await fetchEligibleSource("https://example.com/article", {
    resolveHost: resolver,
    request: async (target) => {
      calls.push(target);
      return response(200, { "content-type": "text/html; charset=utf-8" }, html);
    },
  });
  assert.equal(calls[0].address, "93.184.216.34");
  assert.equal(calls[0].url.hostname, "example.com");
  assert.equal(result.title, "Clean source");
  assert.equal(result.text.length >= 500, true);
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
});

test("revalidates every redirect and caps the chain at three", async () => {
  let count = 0;
  const result = await fetchEligibleSource("https://example.com/start", {
    resolveHost: resolver,
    request: async () => {
      count += 1;
      if (count === 1) return response(302, { location: "https://next.example/final" }, "");
      return response(200, { "content-type": "text/plain" }, "Readable source. ".repeat(40));
    },
  });
  assert.equal(result.finalUrl, "https://next.example/final");
  assert.equal(count, 2);

  await assert.rejects(() => fetchEligibleSource("https://example.com/start", {
    resolveHost: resolver,
    request: async () => response(302, { location: "https://example.com/again" }, ""),
  }), (error) => error instanceof IntakeError && error.code === "too_many_redirects");
});

test("rejects an unsafe DNS answer before request and blocks mixed safe/private answers", async () => {
  let requested = false;
  for (const answers of [
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.2", family: 4 }],
  ]) {
    await assert.rejects(() => fetchEligibleSource("https://example.com", {
      resolveHost: async () => answers,
      request: async () => { requested = true; return response(200, { "content-type": "text/plain" }, "x".repeat(600)); },
    }), (error) => error.code === "unsafe_dns_answer");
  }
  assert.equal(requested, false);
});

test("rejects HTTP errors, auth/paywall signals, MIME, size, and text bounds", async () => {
  const run = (res) => fetchEligibleSource("https://example.com", { resolveHost: resolver, request: async () => res });
  const cases = [
    [response(404, { "content-type": "text/html" }, html), "http_status"],
    [response(200, { "content-type": "application/pdf" }, "x".repeat(600)), "unsupported_content_type"],
    [response(200, { "content-type": "text/plain", "content-length": "2097153" }, "x"), "response_too_large"],
    [response(200, { "content-type": "text/plain" }, "short"), "text_too_short"],
    [response(200, { "content-type": "text/html" }, `<form action="/login"><input type="password"></form>${"x".repeat(600)}`), "authentication_required"],
    [response(200, { "content-type": "text/html" }, `<main>Subscribe to continue reading. ${"x".repeat(600)}</main>`), "paywall_or_access_denied"],
  ];
  for (const [res, code] of cases) await assert.rejects(() => run(res), (error) => error.code === code, code);
});

test("caps decompressed output to block compression bombs", async () => {
  const compressed = gzipSync(Buffer.from("x".repeat((2 * 1024 * 1024) + 1)));
  await assert.rejects(() => fetchEligibleSource("https://example.com", {
    resolveHost: resolver,
    request: async () => response(200, { "content-type": "text/plain", "content-encoding": "gzip" }, compressed),
  }), (error) => error.code === "invalid_content_encoding");
});
