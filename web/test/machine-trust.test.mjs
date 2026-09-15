import assert from "node:assert/strict";
import test from "node:test";
import { machineTrust } from "../lib/machine-trust.mjs";

const snapshot = (logs = [], reputation = [2n, 9n, 4n, 1n, 100n]) => ({
  reputation, logs, fromBlock: 10n, toBlock: 50n,
});
const slash = (blockNumber, amount, logIndex = 0) => ({ blockNumber, logIndex, transactionHash: `0x${blockNumber}`, args: { amount } });

test("four separate dimensions use explicit approvals and distinct approving clients", () => {
  const result = machineTrust(snapshot());
  assert.deepEqual(Object.keys(result), ["deliveryQuality", "reliability", "integrity", "demand", "window"]);
  assert.equal(result.deliveryQuality.approved, 4n);
  assert.equal(result.demand.distinctClients, 2n);
  assert.equal(result.reliability, null);
  assert.equal(result.integrity.disputes, 1n);
  assert.equal(result.window.counterFromBlock, 10n);
});

test("slash resets counter window without erasing lifetime slash evidence", () => {
  const result = machineTrust(snapshot([slash(20n, 100n), slash(30n, 0n)], [1n, 0n, 1n, 0n, 0n]));
  assert.equal(result.window.counterFromBlock, 30n);
  assert.equal(result.window.afterSlash, true);
  assert.equal(result.integrity.slashEvents, 2);
  assert.equal(result.integrity.stakeLossEvents, 1);
  assert.equal(result.integrity.totalSlashed, 100n);
  assert.equal(result.demand.distinctClients, 1n);
});

test("duplicate logs do not inflate lifetime slashes", () => {
  const event = slash(20n, 5n);
  assert.equal(machineTrust(snapshot([event, event])).integrity.slashEvents, 1);
});

test("missing, failed or inconsistent data is unavailable, not zero", () => {
  for (const value of [undefined, {}, { ...snapshot(), reputation: undefined }, { ...snapshot(), logs: undefined }, { ...snapshot(), toBlock: 1n }, snapshot([slash(60n, 1n)]), snapshot([], [-1n, 0n, 0n, 0n, 0n]), snapshot([{ ...slash(20n, 1n), args: {} }])]) {
    assert.equal(machineTrust(value), null);
  }
});

test("observed zeros remain zeros and submission counts never imply timeliness", () => {
  const result = machineTrust(snapshot([], [0n, 100n, 0n, 0n, 0n]));
  assert.equal(result.deliveryQuality.approved, 0n);
  assert.equal(result.demand.distinctClients, 0n);
  assert.equal(result.integrity.slashEvents, 0);
  assert.equal(result.reliability, null);
});

test("malformed and conflicting slash observations fail closed", () => {
  assert.equal(machineTrust(snapshot([null])), null);
  assert.equal(machineTrust(snapshot([slash(20n, 5n), slash(20n, 6n)])), null);
  assert.equal(machineTrust(snapshot([{ ...slash(20n, 5n), removed: true }])), null);
});
