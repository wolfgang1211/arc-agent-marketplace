import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex } from "viem";
import { parseVerifierReport, validateVerifierReport, reportTypedData, REPORT_LIMIT } from "../lib/verifier-report.mjs";

// Public deterministic local test key only. Never a funded wallet.
const verifier = privateKeyToAccount(`0x${"01".repeat(32)}`);
const hash = (text) => keccak256(stringToHex(text));
const context = {
  chainId: "5042002", marketplace: `0x${"11".repeat(20)}`, jobId: "1",
  client: `0x${"22".repeat(20)}`, producer: `0x${"33".repeat(20)}`,
  requestHash: hash("request"), artifactURI: "https://example.com/result.json",
  artifactSha256: `0x${"44".repeat(32)}`, criteriaHash: hash("criteria"), verifier: verifier.address,
};
async function fixture(overrides = {}) {
  const report = { schemaVersion: "verifier-report-v1", ...context,
    verdict: "checks_passed", signatureScheme: "eip712-eoa-preview-v1", ...overrides };
  report.signature = await verifier.signTypedData(reportTypedData(report));
  return report;
}
const inspect = (report, expected = context) => validateVerifierReport(JSON.stringify(report), expected);

test("valid signed report returns isolated advisory evidence", async () => {
  const report = await fixture();
  const result = await inspect(report);
  assert.equal(result.ok, true);
  assert.deepEqual(result.report, report);
  assert.equal(result.authority, "advisory_only");
  assert.ok(Object.isFrozen(result.report));
});

test("all supported verdicts remain advisory", async () => {
  for (const verdict of ["checks_passed", "checks_failed", "inconclusive"]) {
    const result = await inspect(await fixture({ verdict }));
    assert.equal(result.ok, true);
    assert.equal(result.authority, "advisory_only");
  }
});

test("rejects missing, extra, mistyped and unsupported fields", async () => {
  const valid = await fixture();
  for (const key of Object.keys(valid)) {
    const missing = { ...valid }; delete missing[key];
    assert.equal((await inspect(missing)).ok, false, `missing ${key}`);
    assert.equal((await inspect({ ...valid, [key]: 1 })).ok, false, `numeric ${key}`);
  }
  for (const patch of [{ unknown: "x" }, { schemaVersion: "2" }, { verdict: "approved" }, { signatureScheme: "personal_sign" }]) {
    assert.equal((await inspect({ ...valid, ...patch })).ok, false);
  }
});

test("strict flat JSON rejects duplicate and escaped duplicate keys, nesting and overflow", async () => {
  const json = JSON.stringify(await fixture());
  for (const input of [null, {}, "[]", "null", "{", json + "x", "\u00a0" + json, json + "\u00a0", json.replace('{', '{"jobId":"2",'),
    json.replace('{', '{"job\\u0049d":"2",'), json.replace('"jobId":"1"', '"jobId":{}'),
    json.replace('"jobId":"1"', '"jobId":["1"]'), " ".repeat(REPORT_LIMIT + 1),
    json.replace('{', '{"__proto__":"x",'), json.replace('{', '{"constructor":"x",')]) {
    assert.equal(parseVerifierReport(input).ok, false);
  }
  assert.equal(parseVerifierReport(` \n${json}\t`).ok, true);
});

test("canonical uint256, hex hashes, HTTPS URI and signature bounds fail closed", async () => {
  const valid = await fixture();
  const cases = {
    jobId: ["01", "-1", "1.0", "1e2", " 1", (1n << 256n).toString()],
    chainId: ["0", "01"], artifactURI: ["javascript:alert(1)", "http://example.com", "https://u:p@example.com", " https://example.com", "https://example.com/#fragment", "https://example.com/" + "a".repeat(2048)],
    artifactSha256: ["0x12", "44".repeat(32), `0x${"00".repeat(32)}`], criteriaHash: ["0xxyz"],
    verifier: [`0x${"00".repeat(20)}`, "not-an-address", context.client, context.producer],
    signature: ["0x12", `0x${"00".repeat(65)}`, `0x${"11".repeat(32)}${"ff".repeat(32)}1b`],
  };
  for (const [key, values] of Object.entries(cases)) for (const value of values) {
    assert.equal((await inspect({ ...valid, [key]: value })).ok, false, `${key}: ${value}`);
  }
});

test("rejects replay across every expected binding, including selected verifier", async () => {
  const report = await fixture();
  for (const key of Object.keys(context)) {
    const value = key === "artifactURI" ? "https://example.com/other" : key === "jobId" ? "2" : key === "chainId" ? "1" : key.endsWith("Hash") || key === "artifactSha256" ? hash("other") : `0x${"55".repeat(20)}`;
    assert.equal((await inspect(report, { ...context, [key]: value })).ok, false, key);
  }
});

test("signature authenticates every payload field, not merely the URI", async () => {
  const report = await fixture();
  for (const key of Object.keys(context)) {
    const value = key === "artifactURI" ? "https://example.com/other" : key === "jobId" ? "2" : key === "chainId" ? "1" : key.endsWith("Hash") || key === "artifactSha256" ? hash("other") : `0x${"55".repeat(20)}`;
    assert.equal((await inspect({ ...report, [key]: value }, { ...context, [key]: value })).ok, false, key);
  }
  assert.equal((await inspect({ ...report, verdict: "checks_failed" })).ok, false);
});

test("hostile or absent expected bindings cannot run getters or leak exceptions", async () => {
  const report = await fixture(); let reads = 0;
  const hostile = { ...context };
  Object.defineProperty(hostile, "jobId", { get() { reads++; throw new Error("secret"); } });
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  for (const input of [undefined, null, {}, hostile, proxy, { ...context, secret: "x" }]) {
    const result = await inspect(report, input === undefined ? null : input);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  }
  assert.equal(reads, 0);
});

test("wrong typed domain or record kind cannot be substituted", async () => {
  const report = await fixture();
  for (const patch of [{ name: "Other verifier" }, { version: "1" }]) {
    const typed = reportTypedData(report);
    const signature = await verifier.signTypedData({ ...typed, domain: { ...typed.domain, ...patch } });
    assert.equal((await inspect({ ...report, signature })).ok, false);
  }
  const typed = reportTypedData(report);
  const signature = await verifier.signTypedData({ ...typed, primaryType: "OtherRecord", types: { OtherRecord: typed.types.VerifierReportPreview } });
  assert.equal((await inspect({ ...report, signature })).ok, false);
});

test("signature malleation is rejected and expected data is snapshotted before awaiting", async () => {
  const report = await fixture();
  const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = (order - BigInt(`0x${report.signature.slice(66, 130)}`)).toString(16).padStart(64, "0");
  const v = report.signature.slice(130) === "1b" ? "1c" : "1b";
  assert.equal((await inspect({ ...report, signature: report.signature.slice(0, 66) + highS + v })).ok, false);
  const expected = { ...context };
  const pending = inspect(report, expected);
  expected.jobId = "99";
  assert.equal((await pending).ok, true);
  assert.equal((await inspect(report, expected)).ok, false);
});
