const { expect } = require("chai");
const { ethers } = require("hardhat");
const { registerVault } = require("./helpers/v2-receipt-auditor");

const U = 1_000_000n;
const M = 5n * U;
const amount = 10n * U;

async function deployPair(TokenName = "MockUSDC") {
  const [deployer, operator, client, other, treasury] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory(TokenName)).deploy();
  const nonce = await ethers.provider.getTransactionCount(deployer.address);
  const vaultAddress = ethers.getCreateAddress({ from: deployer.address, nonce });
  const authorityAddress = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 1 });
  const Vault = await ethers.getContractFactory("OperatorCollateralVaultV2");
  const vault = await Vault.deploy(token, authorityAddress, treasury.address);
  const Authority = await ethers.getContractFactory("V2VaultAuthority");
  const authority = await Authority.deploy(vaultAddress);
  expect(await authority.getAddress()).to.equal(authorityAddress);
  expect(await vault.getAddress()).to.equal(vaultAddress);
  expect(await vault.marketplace()).to.equal(authorityAddress);
  expect(await vault.token()).to.equal(await token.getAddress());
  expect(await vault.treasury()).to.equal(treasury.address);
  for (const who of [deployer, operator, client, other]) await token.mint(who, 1_000n * U);
  await registerVault({ token: await token.getAddress(), vault: await vault.getAddress(), deploymentTxHashes: [vault.deploymentTransaction()?.hash].filter(Boolean) });
  return { deployer, operator, client, other, treasury, token, authority, vault };
}

async function deposit(e, who, value = amount) {
  await e.token.connect(who).approve(e.vault, value);
  await e.vault.connect(who).depositStake(value);
}

async function reserve(e, id, value = amount, op = e.operator, client = e.client) {
  await e.authority.reserve(id, op.address, client.address, value);
}

async function snapshot(e, addresses = [e.operator]) {
  const rows = [];
  for (const who of addresses) rows.push([who.address, await e.vault.freeStake(who), await e.vault.reservedStake(who)]);
  return { rows, liability: await e.vault.stakeLiability(), vaultBalance: await e.token.balanceOf(e.vault), treasuryBalance: await e.token.balanceOf(e.treasury) };
}

async function expectUnchanged(e, before, addresses) {
  expect(await snapshot(e, addresses)).to.deep.equal(before);
}

async function increase(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}

async function pinNextBlockTimestamp(target) {
  const latest = await ethers.provider.getBlock("latest");
  expect(target).to.be.greaterThan(BigInt(latest.timestamp));
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(target)]);
}

async function minedReceipt(value) {
  if (value && value.blockNumber != null) return value;
  return ethers.provider.getTransactionReceipt(value.transactionHash);
}

async function minedTimestamp(value) {
  const receipt = await minedReceipt(value);
  return BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp);
}

describe("OperatorCollateralVaultV2", function () {
  it("pins token, marketplace, and treasury immutables to the predicted pair", async function () {
    const e = await deployPair();
    expect(await e.vault.marketplace()).to.equal(await e.authority.getAddress());
    expect(await e.authority.vault()).to.equal(await e.vault.getAddress());
  });

  it("rejects zero constructor addresses and does not expose an admin/bind path", async function () {
    const [a, b] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("OperatorCollateralVaultV2");
    await expect(Vault.deploy(ethers.ZeroAddress, a.address, b.address)).to.be.reverted;
    await expect(Vault.deploy(a.address, ethers.ZeroAddress, b.address)).to.be.reverted;
    await expect(Vault.deploy(a.address, b.address, ethers.ZeroAddress)).to.be.reverted;
    expect((await Vault.deploy(a.address, b.address, a.address)).interface.fragments.map(x => x.name).filter(Boolean)).to.not.include("setMarketplace");
  });

  it("deposits only the caller's stake, with exact received accounting", async function () {
    const e = await deployPair();
    await expect(e.vault.connect(e.operator).depositStake(0)).to.be.reverted;
    await deposit(e, e.operator, 20n * U);
    expect(await e.vault.freeStake(e.operator)).to.equal(20n * U);
    expect(await e.vault.reservedStake(e.operator)).to.equal(0n);
    expect(await e.vault.stakeLiability()).to.equal(20n * U);
    await expect(e.vault.connect(e.other).withdrawStake(1n)).to.be.reverted;
    expect(await e.vault.freeStake(e.other)).to.equal(0n);
  });

  it("rejects unauthorized reserve lifecycle calls and preserves all accounting", async function () {
    const e = await deployPair(); await deposit(e, e.operator);
    const before = await snapshot(e);
    for (const call of [
      e.vault.connect(e.other).reserve(1, e.operator, e.client, amount),
      e.vault.connect(e.other).release(1),
      e.vault.connect(e.other).markFault(1, 1),
      e.vault.connect(e.other).slashAndRelease(1, 0),
      e.vault.connect(e.other).releaseFault(1),
    ]) await expect(call).to.be.reverted;
    await expectUnchanged(e, before);
  });

  it("reserves two jobs for one operator and isolates slash/release to the selected job", async function () {
    const e = await deployPair(); await deposit(e, e.operator, 30n * U);
    await reserve(e, 1, 10n * U); await reserve(e, 2, 8n * U);
    expect(await e.vault.freeStake(e.operator)).to.equal(12n * U);
    expect(await e.vault.reservedStake(e.operator)).to.equal(18n * U);
    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 7 * 86400);
    await e.authority.markFault(1, deadline);
    await e.authority.slashAndRelease(1, 2n * U);
    const r2 = await e.vault.reserveOf(2); expect(r2.amount).to.equal(8n * U); expect(r2.disposition).to.equal(1n);
    expect(await e.vault.reservedStake(e.operator)).to.equal(8n * U);
    expect(await e.vault.freeStake(e.operator)).to.equal(20n * U);
    expect(await e.token.balanceOf(e.authority)).to.equal(2n * U);
  });

  it("rejects zero/duplicate reservations without changing state", async function () {
    const e = await deployPair(); await deposit(e, e.operator);
    for (const args of [[0, e.operator, e.client, 1], [1, ethers.ZeroAddress, e.client, 1], [1, e.operator, ethers.ZeroAddress, 1], [1, e.operator, e.client, 0]]) {
      await expect(e.authority.reserve(...args)).to.be.reverted;
    }
    await reserve(e, 1, amount); const before = await snapshot(e);
    await expect(e.authority.reserve(1, e.operator, e.client, amount)).to.be.reverted;
    await expectUnchanged(e, before);
  });

  it("withdraws only free stake and leaves reserved collateral locked", async function () {
    const e = await deployPair(); await deposit(e, e.operator, 20n * U); await reserve(e, 1, 12n * U);
    const before = await e.token.balanceOf(e.operator);
    await expect(e.vault.connect(e.operator).withdrawStake(9n * U)).to.be.reverted;
    await e.vault.connect(e.operator).withdrawStake(8n * U);
    expect(await e.vault.freeStake(e.operator)).to.equal(0n);
    expect(await e.vault.reservedStake(e.operator)).to.equal(12n * U);
    expect(await e.token.balanceOf(e.operator)).to.equal(before + 8n * U);
  });

  it("releases a normal reserve exactly once", async function () {
    const e = await deployPair(); await deposit(e, e.operator); await reserve(e, 1);
    await e.authority.release(1);
    const r = await e.vault.reserveOf(1); expect(r.amount).to.equal(0n); expect(r.disposition).to.equal(3n);
    expect(await e.vault.freeStake(e.operator)).to.equal(amount);
    await expect(e.authority.release(1)).to.be.reverted;
    await expect(e.authority.markFault(1, 1)).to.be.reverted;
  });

  it("permits D-1 slash, rejects D slash, and permits D release", async function () {
    const e = await deployPair(); await deposit(e, e.operator, 20n * U); await reserve(e, 1);
    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 100);
    await e.authority.markFault(1, deadline);
    await pinNextBlockTimestamp(deadline - 1n);
    const beforeDeadline = await e.authority.slashAndRelease(1, 1n * U, { gasLimit: 1_000_000 });
    expect(await minedTimestamp(await beforeDeadline.wait())).to.equal(deadline - 1n);
    expect((await e.vault.reserveOf(1)).disposition).to.equal(4n);

    await reserve(e, 2); const d2 = BigInt((await ethers.provider.getBlock("latest")).timestamp + 100);
    await e.authority.markFault(2, d2);
    await pinNextBlockTimestamp(d2);
    let boundaryError;
    try {
      const boundaryTx = await e.authority.slashAndRelease(2, 1, { gasLimit: 1_000_000 });
      await boundaryTx.wait();
    } catch (error) {
      boundaryError = error;
    }
    expect(boundaryError).to.exist;
    const boundaryReceipt = await minedReceipt(boundaryError);
    expect(boundaryReceipt.status).to.equal(0);
    expect(await minedTimestamp(boundaryReceipt)).to.equal(d2);
    await pinNextBlockTimestamp(d2 + 1n);
    const releaseAtAfter = await e.authority.releaseFault(2, { gasLimit: 1_000_000 });
    expect(await minedTimestamp(await releaseAtAfter.wait())).to.equal(d2 + 1n);
    expect((await e.vault.reserveOf(2)).disposition).to.equal(3n);
  });

  it("accepts a late markFault deadline and gives no fresh interval", async function () {
    const e = await deployPair(); await deposit(e, e.operator); await reserve(e, 1);
    const now = (await ethers.provider.getBlock("latest")).timestamp; const deadline = BigInt(now - 1);
    await e.authority.markFault(1, deadline);
    const r = await e.vault.reserveOf(1); expect(r.faultDeadline).to.equal(deadline); expect(r.faultPending).to.equal(true);
    await expect(e.authority.slashAndRelease(1, 0)).to.be.reverted;
    await e.authority.releaseFault(1);
  });

  it("sweeps only donated surplus and cannot encroach on free or reserved liabilities", async function () {
    const e = await deployPair(); await deposit(e, e.operator, 100n * U); await reserve(e, 1, 20n * U);
    await expect(e.vault.sweepSurplus()).to.be.reverted;
    await e.token.connect(e.deployer).transfer(e.vault, 10n * U);
    const beforeFree = await e.vault.freeStake(e.operator), beforeReserved = await e.vault.reservedStake(e.operator);
    const treasuryBefore = await e.token.balanceOf(e.treasury);
    await e.vault.connect(e.other).sweepSurplus();
    expect(await e.token.balanceOf(e.treasury)).to.equal(treasuryBefore + 10n * U);
    expect(await e.vault.freeStake(e.operator)).to.equal(beforeFree);
    expect(await e.vault.reservedStake(e.operator)).to.equal(beforeReserved);
    expect(await e.vault.stakeLiability()).to.equal(100n * U);
    await expect(e.vault.sweepSurplus()).to.be.reverted;
  });

  it("uses checked ceil-ten-percent collateral, five-USDC floor, and cent rounding", async function () {
    const e = await deployPair();
    expect(await e.vault.requiredStake(0)).to.equal(M);
    expect(await e.vault.requiredStake(5n * U)).to.equal(M);
    expect(await e.vault.requiredStake(50n * U + 1n)).to.equal(5_010_000n);
    expect(await e.vault.requiredStake((1n << 256n) - 1n)).to.equal(11579208923731619542357098500868790785326998466564056403945758400791312970000n);
  });

  it("rejects false-return transfers atomically and swallows callback reentry", async function () {
    const e = await deployPair("V2AccountingToken");
    await e.token.connect(e.deployer).setReturnFalse(true);
    const before = await snapshot(e);
    await e.token.connect(e.operator).approve(e.vault, amount);
    await expect(e.vault.connect(e.operator).depositStake(amount)).to.be.reverted;
    await expectUnchanged(e, before);

    await e.token.connect(e.deployer).setReturnFalse(false);
    await deposit(e, e.operator);
    const data = e.authority.interface.encodeFunctionData("reserve", [1, e.operator.address, e.client.address, amount]);
    await e.token.connect(e.deployer).setCallback(e.authority, data);
    await e.vault.connect(e.operator).withdrawStake(1n * U);
    expect(await e.token.callbackAttempted()).to.equal(true);
    expect(await e.token.callbackSucceeded()).to.equal(false);
    expect(await e.vault.freeStake(e.operator)).to.equal(9n * U);
  });

  it("rolls back slash state when the marketplace receiver rejects the token", async function () {
    const e = await deployPair("V2AccountingToken"); await deposit(e, e.operator); await reserve(e, 1);
    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 1000); await e.authority.markFault(1, deadline);
    await e.token.connect(e.deployer).setBlocked(e.authority, true);
    const before = await snapshot(e);
    await expect(e.authority.slashAndRelease(1, 1n * U)).to.be.reverted;
    await expectUnchanged(e, before);
    const r = await e.vault.reserveOf(1); expect(r.amount).to.equal(amount); expect(r.disposition).to.equal(2n); expect(r.faultPending).to.equal(true);
  });
});
