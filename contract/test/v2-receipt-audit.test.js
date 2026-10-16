const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployV2Pair } = require("./helpers/deploy-v2-pair");
const { flushEvidence, evidencePath } = require("./helpers/v2-receipt-auditor");
const fs = require("fs");

describe("V2 receipt accounting auditor", function () {
  it("audits setup, donation, failed receipt, and two queued same-block sends", async function () {
    const [owner, treasury] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const pair = await deployV2Pair({ token, owner, treasury });
    const before = JSON.parse(fs.readFileSync(evidencePath, "utf8")).receiptChecks.length;
    await token.mint(owner.address, 20_000_000n);
    await token.connect(owner).approve(await pair.vault.getAddress(), 10_000_000n);
    await pair.vault.connect(owner).depositStake(10_000_000n);
    await token.connect(owner).transfer(await pair.vault.getAddress(), 1_000_000n);
    await pair.market.connect(owner).setMaxActiveJobs(1);
    await expect(pair.vault.connect(owner).withdrawStake(20_000_000n)).to.be.reverted;
    const withdrawData = pair.vault.interface.encodeFunctionData("withdrawStake", [20_000_000n]);
    await expect(ethers.provider.send("eth_estimateGas", [{
      from: owner.address,
      to: await pair.vault.getAddress(),
      data: withdrawData,
    }])).to.be.rejected;
    await ethers.provider.send("evm_setAutomine", [false]);
    try {
      const a = await pair.market.connect(owner).setMaxActiveJobs(2);
      const b = await pair.market.connect(owner).setMaxActiveJobs(3);
      await ethers.provider.send("evm_mine", []);
      await a.wait(); await b.wait();
    } finally {
      await ethers.provider.send("evm_setAutomine", [true]);
    }
    await flushEvidence();
    const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    expect(evidence.receiptChecks.length).to.be.greaterThan(before + 4);
    expect(evidence.summary.expectedRevertAuditCount).to.be.greaterThan(0);
    expect(evidence.summary.expectedGasEstimateRejectionCount).to.be.greaterThan(0);
    expect(evidence.expectedRevertChecks.some((x) => x.method === "eth_sendTransaction" && x.checks.every((c) => c.beforeBlock != null && c.preStateHash === c.postStateHash))).to.equal(true);
    expect(evidence.expectedRevertChecks.some((x) => x.method === "eth_estimateGas" && x.checks.every((c) => c.beforeBlock != null && c.preStateHash === c.postStateHash))).to.equal(true);
    expect(evidence.pairLedgerChecks.some((x) => x.ledger.joint && x.ledger.separate)).to.equal(true);
    expect(evidence.pairLedgerChecks.some((x) => x.sameBlockStateLimitation)).to.equal(true);
  });
});
