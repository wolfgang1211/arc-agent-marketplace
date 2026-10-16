const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  U, H, sourceIdentity, deploySecurityFixture, pairLedger, checked, checkedRevert,
  expectRevert, post, stakeAndRegister, award, receipt,
} = require("./helpers/v2-pair-security-fixture");

function sameIdentity(a, b) { expect(JSON.stringify(b)).to.equal(JSON.stringify(a)); }

describe("V2 real paired-contract security acceptance", function () {
  let identityAtStart;
  before(function () { identityAtStart = sourceIdentity(); });
  after(function () { sameIdentity(identityAtStart, sourceIdentity()); });

  it("constructs only the nonce-paired vault/market and exposes no rebinding path", async function () {
    const [owner, treasury, wrongTreasury, outsider] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("V2AccountingToken"); const token = await Token.deploy(); await token.waitForDeployment();
    const Vault = await ethers.getContractFactory("OperatorCollateralVaultV2"); const Market = await ethers.getContractFactory("AgentMarketplaceV2");
    const n = await ethers.provider.getTransactionCount(owner.address);
    const predictedVault = ethers.getCreateAddress({ from: owner.address, nonce: n });
    const predictedMarket = ethers.getCreateAddress({ from: owner.address, nonce: n + 1 });
    const vault = await Vault.deploy(await token.getAddress(), predictedMarket, treasury.address); await vault.waitForDeployment();
    expect(await vault.getAddress()).to.equal(predictedVault);
    const market = await Market.deploy(await token.getAddress(), owner.address, treasury.address, await vault.getAddress()); await market.waitForDeployment();
    expect(await market.collateralVault()).to.equal(await vault.getAddress()); expect(await vault.marketplace()).to.equal(await market.getAddress());
    const wrongVault = await Vault.deploy(await token.getAddress(), ethers.Wallet.createRandom().address, treasury.address); await wrongVault.waitForDeployment();
    await expectRevert(Market.deploy(await token.getAddress(), owner.address, treasury.address, await wrongVault.getAddress()));
    const otherToken = await Token.deploy(); await otherToken.waitForDeployment();
    const wrongTokenVault = await Vault.deploy(await otherToken.getAddress(), predictedMarket, treasury.address); await wrongTokenVault.waitForDeployment();
    await expectRevert(Market.deploy(await token.getAddress(), owner.address, treasury.address, await wrongTokenVault.getAddress()));
    const mismatchVault = await Vault.deploy(await token.getAddress(), predictedMarket, wrongTreasury.address); await mismatchVault.waitForDeployment();
    await expectRevert(Market.deploy(await token.getAddress(), owner.address, treasury.address, await mismatchVault.getAddress()));
    await expectRevert(Market.deploy(await token.getAddress(), owner.address, treasury.address, outsider.address));
    expect(await market.interface.getFunction("setTreasury")).to.not.equal(null);
    expect(await market.interface.getFunction("setTreasury").inputs.length).to.equal(1);
    await expectRevert(market.connect(outsider).setTreasury(outsider.address));
    await expectRevert(vault.connect(outsider).reserve(1, outsider.address, owner.address, U));
    await expectRevert(vault.connect(outsider).markFault(1, 1));
    await expectRevert(vault.connect(outsider).slashAndRelease(1, 0));
    await expectRevert(vault.connect(outsider).release(1));
  });

  it("rolls back both ledgers when a real slash transfer is blocked or returns false", async function () {
    for (const falseReturn of [false, true]) {
      const e = await deploySecurityFixture(); await stakeAndRegister(e);
      const job = await post(e); await award(e, 1n, job);
      await ethers.provider.send("evm_increaseTime", [3601]); await ethers.provider.send("evm_mine");
      const timeoutJob = await e.market.getJob(1);
      await checked(e, () => e.market.connect(e.outsider).claimDeliveryTimeout(1, timeoutJob.stateVersion));
      const pending = await e.market.getJob(1); const before = await pairLedger(e);
      if (falseReturn) await receipt(e.token.connect(e.owner).setReturnFalse(true)); else await receipt(e.token.connect(e.owner).setBlocked(await e.market.getAddress(), true));
      await checkedRevert(e, () => e.market.connect(e.owner).resolveFaultReview(1, U, H("reason"), H("evidence"), pending.stateVersion));
      const after = await pairLedger(e); expect(after).to.deep.equal(before);
      const r = await e.vault.reserveOf(1); expect(r.amount).to.equal(5_000_000n); expect(r.faultPending).to.equal(true); expect(r.disposition).to.equal(2n);
    }
  });

  it("rejects false-return deposit, escrow pull, and credit withdrawal atomically", async function () {
    const e = await deploySecurityFixture(); await receipt(e.token.connect(e.owner).setReturnFalse(true));
    await receipt(e.token.connect(e.operator).approve(await e.vault.getAddress(), 10n * U));
    await checkedRevert(e, () => e.vault.connect(e.operator).depositStake(10n * U));
    await receipt(e.token.connect(e.owner).setReturnFalse(false)); await stakeAndRegister(e); const job = await post(e); await award(e, 1n, job);
    await receipt(e.token.connect(e.owner).setReturnFalse(true));
    await checkedRevert(e, () => e.vault.connect(e.operator).withdrawStake(U));
    await receipt(e.token.connect(e.owner).setReturnFalse(false));
    let current = await e.market.getJob(1);
    await checked(e, () => e.market.connect(e.operator).submitDelivery(1, H("delivery"), current.stateVersion));
    current = await e.market.getJob(1);
    await checked(e, () => e.market.connect(e.client).approve(1, current.stateVersion));
    const credit = await e.market.credits(e.operator.address); await receipt(e.token.connect(e.owner).setReturnFalse(true));
    await checkedRevert(e, () => e.market.connect(e.operator).withdrawCredit());
    expect(await e.market.credits(e.operator.address)).to.equal(credit);
  });

  it("blocks token callbacks before authorization and preserves both ledgers", async function () {
    const e = await deploySecurityFixture(); await stakeAndRegister(e); const job = await post(e); await award(e, 1n, job);
    const reserveCall = e.vault.interface.encodeFunctionData("reserve", [77, e.operator.address, e.client.address, U]);
    await receipt(e.token.connect(e.owner).setCallback(await e.vault.getAddress(), reserveCall));
    await checked(e, () => e.vault.connect(e.operator).withdrawStake(U));
    expect(await e.token.callbackAttempted()).to.equal(true); expect(await e.token.callbackSucceeded()).to.equal(false);
    await receipt(e.token.connect(e.owner).setCallback(await e.market.getAddress(), e.market.interface.encodeFunctionData("withdrawCredit")));
    await ethers.provider.send("evm_increaseTime", [3601]); await ethers.provider.send("evm_mine");
    const j = await e.market.getJob(1); await checked(e, () => e.market.connect(e.outsider).claimDeliveryTimeout(1, j.stateVersion));
    const second = await post(e, U, "callback-second"); await award(e, 2n, second);
    let secondState = await e.market.getJob(2);
    await checked(e, () => e.market.connect(e.operator).submitDelivery(2, H("callback-delivery"), secondState.stateVersion));
    secondState = await e.market.getJob(2);
    await checked(e, () => e.market.connect(e.client).approve(2, secondState.stateVersion));
    await receipt(e.token.connect(e.owner).setCallback(await e.market.getAddress(), e.market.interface.encodeFunctionData("withdrawCredit")));
    await checked(e, () => e.market.connect(e.operator).withdrawCredit());
    expect(await e.token.callbackSucceeded()).to.equal(false);
    const ledger = await pairLedger(e); expect(ledger.vaultBalance).to.be.gte(ledger.stakeLiability);
  });

  it("sweeps only exact vault donations and cannot encroach on free or reserved stake", async function () {
    const e = await deploySecurityFixture(); await stakeAndRegister(e); const job = await post(e); await award(e, 1n, job);
    const before = await pairLedger(e); const donation = 7n * U;
    const vaultAddress = await e.vault.getAddress();
    await checked(e, () => e.token.connect(e.owner).transfer(vaultAddress, donation));
    const donated = await pairLedger(e); expect(donated.vaultSurplus).to.equal(donation); expect(donated.reserved).to.equal(before.reserved);
    await receipt(e.token.connect(e.owner).setBlocked(e.treasury.address, true)); await checkedRevert(e, () => e.vault.connect(e.outsider).sweepSurplus());
    await receipt(e.token.connect(e.owner).setBlocked(e.treasury.address, false));
    const treasuryBefore = await e.token.balanceOf(e.treasury.address); await checked(e, () => e.vault.connect(e.outsider).sweepSurplus());
    expect(await e.token.balanceOf(e.treasury.address)).to.equal(treasuryBefore + donation);
    const swept = await pairLedger(e); expect(swept.vaultSurplus).to.equal(0n); expect(swept.reserved).to.equal(before.reserved); expect(swept.free).to.equal(before.free);
    await checkedRevert(e, () => e.vault.connect(e.outsider).sweepSurplus());
  });
});
