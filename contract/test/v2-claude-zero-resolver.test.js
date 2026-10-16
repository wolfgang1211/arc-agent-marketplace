const { expect } = require("chai");
const { artifacts, ethers } = require("hardhat");
const { wrapMarket } = require("./helpers/v2-read-model");
const { deployV2Pair } = require("./helpers/deploy-v2-pair");

const U = 1_000_000n;
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const fixtures = [];

async function deploy() {
  const [owner, client, operator, treasury, auditor] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const pair = await deployV2Pair({ token, owner, treasury });
  const market = wrapMarket(pair.market);
  for (const signer of [owner, client, operator, treasury, auditor]) await token.mint(signer.address, 1_000n * U);
  const env = { owner, client, operator, treasury, auditor, token, market, vault: pair.vault };
  fixtures.push(env);
  return env;
}

async function post(e, reward = U) {
  const id = await e.market.nextJobId();
  await e.token.connect(e.client).approve(e.market, reward);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await e.market.connect(e.client).postJob(
    reward, now + 2 * 86400, 2 * 86400, 24 * 3600, 12 * 3600, 2, false,
    H(`criteria-${id}`), H(`description-${id}`), false,
  );
  return e.market.getJob(id);
}

async function accounting(e) {
  let free = 0n; let reserved = 0n; let credits = 0n; let escrow = 0n;
  for (const signer of [e.owner, e.client, e.operator, e.treasury, e.auditor]) {
    free += await e.market.freeStake(signer.address);
    reserved += await e.market.reservedStake(signer.address);
    credits += await e.market.credits(signer.address);
  }
  for (let id = 1n; id < await e.market.nextJobId(); id++) {
    const job = await e.market.getJob(id);
    if (Number(job.status) <= 5) escrow += job.reward;
  }
  expect(free + reserved).to.equal(await e.market.stakeLiability());
  expect(credits).to.equal(await e.market.creditsLiability());
  expect(escrow).to.equal(await e.market.escrowed());
  expect(await e.token.balanceOf(e.market)).to.equal(escrow + credits + await e.market.surplus());
}

describe("Claude fixes: resolver-zero post guard", function () {
  afterEach(async function () {
    for (const e of fixtures.splice(0)) await accounting(e);
  });

  it("preserves zero resolver policy fallback to owner for a normal post", async function () {
    const e = await deploy();
    await e.market.connect(e.owner).setResolverForClient(e.client.address, ethers.ZeroAddress);
    const job = await post(e);
    expect(job.resolver).to.equal(e.owner.address);
    expect(job.status).to.equal(0n);
  });

  it("Storage-corruption negative guard: rejects post when owner and resolver are zero", async function () {
    const e = await deploy();
    const buildInfo = await artifacts.getBuildInfo("contracts/AgentMarketplaceV2.sol:AgentMarketplaceV2");
    const layout = buildInfo.output.contracts["contracts/AgentMarketplaceV2.sol"].AgentMarketplaceV2.storageLayout;
    const ownerEntry = layout.storage.find((entry) => entry.label === "_owner");
    expect(ownerEntry, "current V2 storage layout must expose Ownable _owner").to.exist;
    const ownerSlot = ethers.toBeHex(BigInt(ownerEntry.slot));
    const marketAddress = await e.market.getAddress();
    const originalWord = await ethers.provider.getStorage(marketAddress, ownerSlot);
    try {
      await ethers.provider.send("hardhat_setStorageAt", [marketAddress, ownerSlot, ethers.zeroPadValue(ethers.ZeroAddress, 32)]);
      await e.token.connect(e.client).approve(e.market, U);
      const before = {
        nextJobId: await e.market.nextJobId(),
        clientBalance: await e.token.balanceOf(e.client),
        escrowed: await e.market.escrowed(),
        marketBalance: await e.token.balanceOf(e.market),
      };
      await expect(post(e)).to.be.revertedWithCustomError(e.market, "ZeroAddress");
      expect(await e.market.nextJobId()).to.equal(before.nextJobId);
      expect(await e.token.balanceOf(e.client)).to.equal(before.clientBalance);
      expect(await e.market.escrowed()).to.equal(before.escrowed);
      expect(await e.token.balanceOf(e.market)).to.equal(before.marketBalance);
    } finally {
      await ethers.provider.send("hardhat_setStorageAt", [marketAddress, ownerSlot, originalWord]);
    }
    expect(await e.market.owner()).to.equal(e.owner.address);
  });
});
