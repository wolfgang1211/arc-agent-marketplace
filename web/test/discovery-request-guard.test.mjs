import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.js", import.meta.url), "utf8");

test("only the latest indexer request may publish data or clear loading state", () => {
  assert.match(page, /useRef\(0\)/);
  assert.match(page, /const requestId = \+\+discoveryRequestId\.current/g);
  assert.match(page, /requestId !== discoveryRequestId\.current/);
  assert.match(page, /requestId === discoveryRequestId\.current/);
});
