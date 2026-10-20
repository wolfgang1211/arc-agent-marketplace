import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  classifyRoute,
  compositeJobIdentity,
  isV2ApiRoute,
  isV2Route,
} from "../lib/v2/route-scope.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const v1Snapshot = {
  "app/jobs/[id]/page.js": "92ba88785004fee049b1ee0c66da2b59cc495d1fb9085e8a828a5be704d6b2b8",
  "app/api/delivery-preview/route.js": "778784ee53c01da2eef41a67ec4a762aee555d48197cda9728dce2164f7b6a35",
  "app/api/source-preflight/route.js": "c9d4f627ec0263bff1b9d5c4f187e43576330526b9173d93c000dbe5aaf347a2",
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("V2 route namespace is exact and cannot accept malicious prefixes", () => {
  assert.equal(isV2Route("/v2/jobs/job-7"), true);
  assert.equal(isV2Route("/v2/jobs"), true);
  assert.equal(isV2Route("/v2"), true);
  assert.equal(isV2Route("/v2/"), true);
  assert.equal(isV2Route("/v20/jobs/job-7"), false);
  assert.equal(isV2Route("/jobs/job-7"), false);
  assert.equal(isV2ApiRoute("/api/v2/jobs/job-7"), true);
  assert.equal(isV2ApiRoute("/api/v2"), true);
  assert.equal(isV2ApiRoute("/api/v2/"), true);
  assert.equal(isV2ApiRoute("/api/v20/jobs/job-7"), false);
  assert.equal(isV2ApiRoute("/api/v2x/jobs/job-7"), false);
});

test("V2 route guards reject malformed raw pathnames without normalization", () => {
  const malformed = [
    null,
    undefined,
    42,
    "v2/jobs/job-7",
    "/v2/jobs\n/job-7",
    "/v2/jobs\u0080/job-7",
    "/v2/jobs\u009f/job-7",
    "/v2/jobs\u0085/job-7",
    "/v2/jobs\u2028/job-7",
    "/v2/jobs\u2029/job-7",
    "/api/v2/jobs\u0080/job-7",
    "/api/v2/jobs\u009f/job-7",
    "/api/v2/jobs\u0085/job-7",
    "/api/v2/jobs\u2028/job-7",
    "/api/v2/jobs\u2029/job-7",
    "/v2\\jobs/job-7",
    "/v2/jobs/job-7?view=full",
    "/v2/jobs/job-7#details",
    "/v2//jobs/job-7",
    "/v2/jobs//job-7",
    "/v2/./jobs/job-7",
    "/v2/jobs/../job-7",
    "/v2/jobs/%2Fjob-7",
    "/v2/jobs/%2ejob-7",
    "/v2/jobs/%252Fjob-7",
  ];

  for (const pathname of malformed) {
    assert.equal(isV2Route(pathname), false, `V2 accepted malformed path ${String(pathname)}`);
    assert.equal(isV2ApiRoute(pathname), false, `V2 API accepted malformed path ${String(pathname)}`);
    assert.equal(classifyRoute(pathname).version, "unknown");
  }
});

test("V1 and V2 route scopes remain distinct even when job IDs match", () => {
  assert.deepEqual(classifyRoute("/jobs/same-id"), { version: "v1", namespace: "" });
  assert.deepEqual(classifyRoute("/v2/jobs/same-id"), { version: "v2", namespace: "v2" });
  assert.deepEqual(classifyRoute("/api/v2/jobs/same-id"), { version: "v2", namespace: "api/v2" });
  assert.equal(compositeJobIdentity({ chainId: 1, marketId: "market-a", jobId: "same-id" }), "1:market-a:same-id");
  assert.notEqual(
    compositeJobIdentity({ chainId: 1, marketId: "market-a", jobId: "same-id" }),
    compositeJobIdentity({ chainId: 137, marketId: "market-a", jobId: "same-id" }),
  );
  assert.notEqual(
    compositeJobIdentity({ chainId: 1, marketId: "market-a", jobId: "same-id" }),
    compositeJobIdentity({ chainId: 1, marketId: "market-b", jobId: "same-id" }),
  );
});

test("V2 job route cannot shadow the existing V1 dynamic job route", async () => {
  const v1Route = await readFile(resolve(root, "app/jobs/[id]/page.js"), "utf8");
  assert.match(v1Route, /params\?\.id/);
  assert.equal(classifyRoute("/jobs/42").version, "v1");
  assert.equal(classifyRoute("/v2/jobs/42").version, "v2");
});

test("V1 route source files remain unchanged from the snapshot", async () => {
  for (const [relativePath, expected] of Object.entries(v1Snapshot)) {
    const source = await readFile(resolve(root, relativePath));
    assert.equal(sha256(source), expected, `${relativePath} changed outside this isolated task`);
  }
});
