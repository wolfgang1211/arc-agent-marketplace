const { expect } = require("chai");

const {
  normalizePrivateKey,
  assertSufficientDeploymentBalance,
} = require("../lib/deploy-preflight");

describe("deployment preflight", function () {
  it("normalizes an unprefixed 64-hex private key without exposing it", function () {
    const raw = "1".repeat(64);
    expect(normalizePrivateKey(raw)).to.equal(`0x${raw}`);
  });

  it("preserves a valid 0x-prefixed private key", function () {
    const raw = `0x${"2".repeat(64)}`;
    expect(normalizePrivateKey(raw)).to.equal(raw);
  });

  it("rejects missing, malformed, and invalid scalar private keys", function () {
    for (const value of [undefined, "", "xyz", "0x1234", "0".repeat(64)]) {
      expect(() => normalizePrivateKey(value)).to.throw(/PRIVATE_KEY/);
    }
  });

  it("fails closed when deployment fee plus safety reserve exceeds the balance", function () {
    expect(() =>
      assertSufficientDeploymentBalance({
        balance: 100n,
        estimatedGas: 60n,
        maxFeePerGas: 1n,
        safetyMultiplier: 2n,
      }),
    ).to.throw(/Insufficient deployer native balance/);

    expect(
      assertSufficientDeploymentBalance({
        balance: 120n,
        estimatedGas: 60n,
        maxFeePerGas: 1n,
        safetyMultiplier: 2n,
      }).required,
    ).to.equal(120n);
  });
});
