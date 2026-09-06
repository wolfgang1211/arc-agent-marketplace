import test from "node:test";
import assert from "node:assert/strict";
import { checkPinataCredential, checkSummaryCredential } from "../src/preflight.mjs";

const config = {
  summaryApiKey: "summary-secret",
  summaryApiUrl: "https://provider.example/chat/completions",
  summaryModel: "test-model",
};

test("credential preflight validates model and Pinata without uploads", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if (String(url).includes("testAuthentication")) return { ok: true, status: 200 };
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: JSON.stringify({ summary: "Grounded preflight summary.", keyPoints: ["Credentials work"], limitations: [] }) } }] };
      },
    };
  };

  assert.equal(await checkSummaryCredential(config, fetchImpl), true);
  assert.equal(await checkPinataCredential("pinata-secret", fetchImpl), true);
  assert.deepEqual(calls.map(({ method }) => method), ["POST", "GET"]);
  assert.equal(calls.some(({ url }) => String(url).includes("pinFileToIPFS")), false);
});

test("Pinata credential failure is reported without response content", async () => {
  await assert.rejects(
    () => checkPinataCredential("bad", async () => ({ ok: false, status: 401 })),
    /pinata_auth_http_401/,
  );
});
