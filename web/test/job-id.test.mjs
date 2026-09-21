import assert from "node:assert/strict";
import test from "node:test";
import { parseJobId } from "../lib/job-id.mjs";

const MAX_UINT256 = (1n << 256n) - 1n;

test("job IDs accept only canonical positive uint256 values", () => {
  assert.equal(parseJobId("1"), 1n);
  assert.equal(parseJobId(MAX_UINT256.toString()), MAX_UINT256);
});

test("invalid and oversized job IDs fail closed before ABI encoding", () => {
  for (const value of [undefined, null, "", "0", "01", "-1", "1.5", "abc", "1e3", "9".repeat(1000), (MAX_UINT256 + 1n).toString()]) {
    assert.equal(parseJobId(value), null, String(value));
  }
});
