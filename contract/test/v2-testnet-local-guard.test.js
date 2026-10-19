const { expect } = require("chai");
const { localOnlyGuard } = require("../scripts/e2e-v2-testnet-local");

describe("local testnet runner fail-closed guard", function () {
  it("rejects a non-Hardhat provider before any signer/deployment path", function () {
    expect(() => localOnlyGuard({ send: () => { throw new Error("must not be called"); } })).to.throw(/FAIL_CLOSED/);
  });
});
