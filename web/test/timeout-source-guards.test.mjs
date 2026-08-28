import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pagePath = fileURLToPath(new URL("../app/page.js", import.meta.url));
const contractPath = fileURLToPath(new URL("../lib/contract.js", import.meta.url));
const timeoutPath = fileURLToPath(new URL("../lib/timeout-recovery.mjs", import.meta.url));
const evidenceFixturePath = fileURLToPath(new URL("./fixtures/timeout-recovery-evidence.html", import.meta.url));
const buildRoots = [
  fileURLToPath(new URL("../.next/server/app", import.meta.url)),
  fileURLToPath(new URL("../.next/static/chunks/app", import.meta.url)),
];

async function javascriptFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await javascriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

test("page source and ABI use only bounded job reads", async () => {
  const [page, contract] = await Promise.all([readFile(pagePath, "utf8"), readFile(contractPath, "utf8")]);
  assert.match(page, /functionName:\s*"getJobsPaged"/);
  assert.match(page, /args:\s*\[pageOffset, JOB_PAGE_SIZE\]/);
  assert.match(page, /totalJobs\.toString\(\)/);
  assert.doesNotMatch(page, /getAllJobs/);
  assert.doesNotMatch(contract, /getAllJobs/);
});

test("timeout eligibility source never reads the browser wall clock", async () => {
  const [page, timeout] = await Promise.all([readFile(pagePath, "utf8"), readFile(timeoutPath, "utf8")]);
  assert.doesNotMatch(`${page}\n${timeout}`, /Date\.now\s*\(/);
  assert.match(page, /getBlock\(/);
  assert.match(page, /blockTag:\s*"latest"/);
  assert.match(page, /blockNumber:\s*block\.number/);
  assert.match(page, /setInterval\(syncChainTime, 8000\)/);
});

test("compiled app cannot reintroduce an unbounded getAllJobs call", async () => {
  const files = (await Promise.all(buildRoots.map(javascriptFiles))).flat();
  assert.ok(files.length > 0, "app build artifacts missing; run npm run build before npm test");
  const compiled = (await Promise.all(files.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(compiled, /getAllJobs/);
});

test("dispute is a blocking confirmation with the authoritative no-arbiter copy", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /Disputing does not get your money back\./);
  assert.match(page, /No one reviews a dispute — there is no arbiter, no appeal, and no support team\./);
  assert.match(page, /Disputing only changes how the escrow is split when the dispute window closes\./);
  assert.match(page, /That split is fixed and cannot be changed\./);
  assert.match(page, />Dispute and accept the split</);
  assert.match(page, />Go back</);
  assert.doesNotMatch(page, /window\.confirm/);
});

test("rendered timeout sources exclude every forbidden phrase from the copy deck", async () => {
  const [page, timeout] = await Promise.all([readFile(pagePath, "utf8"), readFile(timeoutPath, "utf8")]);
  const renderedSources = `${page}\n${timeout}`;
  for (const forbidden of [
    /Claim your refund/i,
    /Report a problem/i,
    /Raise a ticket/i,
    /Resolve dispute/i,
    /\bPenalty\b/i,
    /\bfine\b/i,
    /\bInstant\b/i,
    /\bguaranteed\b/i,
    /arbitration|adjudicat|under review|reviewer/i,
  ]) {
    assert.doesNotMatch(renderedSources, forbidden);
  }
});

test("source exposes permissionless settlement and explicit receipt status checks", async () => {
  const [page, timeout] = await Promise.all([readFile(pagePath, "utf8"), readFile(timeoutPath, "utf8")]);
  assert.match(timeout, /Anyone can settle an expired job\. You pay only the network fee\./);
  assert.match(page, /"Settle job"/);
  assert.match(page, /assertSuccessfulReceipt\(receipt\)/);
  assert.match(page, /await refreshAll\(\)/);
  assert.match(timeout, /receipt\.status !== "success"/);
});

test("six-decimal settlement amounts stay on the bigint path", async () => {
  const [page, timeout] = await Promise.all([readFile(pagePath, "utf8"), readFile(timeoutPath, "utf8")]);
  const settlementSources = `${page}\n${timeout}`;
  assert.doesNotMatch(settlementSources, /parseFloat\s*\(/);
  assert.doesNotMatch(timeout, /Math\.(?:round|ceil)\s*\(/);
  assert.match(timeout, /BigInt\(reward\)/);
  assert.match(timeout, /\/ DISPUTE_BPS_SCALE/);
});

test("deterministic evidence fixture covers required states without shipping a debug mode", async () => {
  const [page, fixture] = await Promise.all([readFile(pagePath, "utf8"), readFile(evidenceFixturePath, "utf8")]);
  assert.match(fixture, /Deadline reached/);
  assert.match(fixture, /Awaiting client approval for 9m 59s/);
  assert.match(fixture, /Expired split/);
  assert.match(fixture, /there is no arbiter, no appeal, and no support team/);
  assert.match(fixture, /Dispute and accept the split/);
  assert.doesNotMatch(page, /timeout-recovery-evidence|Deterministic local evidence/);
});
