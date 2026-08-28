/**
 * ARC PARİTE — Arc Testnet koşumunun yerel modelde birebir yeniden üretimi.
 * Yerel model ile gerçek zincir aynı muhasebeyi üretiyor mu?
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const R = 5_000000n; // MIN_JOB_REWARD

describe("ARC PARITE — 28 Agustos kosumunun yerel yeniden uretimi", function () {
  it("son durum Arc'ta olculen degerlerle ayni mi?", async function () {
    const [client, agent, stranger] = await ethers.getSigners();
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const M = await ethers.getContractFactory("AgentMarketplace");
    const market = await M.deploy(await usdc.getAddress(), 600, 900, 1200);
    const addr = await market.getAddress();
    const stake = await market.AGENT_STAKE();

    const reg = async () => {
      await usdc.mint(agent.address, stake);
      await usdc.connect(agent).approve(addr, stake);
      await market.connect(agent).registerAgent("A", "audit", 0);
    };
    const post = async (cat) => {
      await usdc.mint(client.address, R);
      const id = (await market.jobCount()) + 1n;
      await usdc.connect(client).approve(addr, R);
      await market.connect(client)["postJob(string,uint256,string)"]("is", R, cat);
      return id;
    };
    const warp = async (s) => { await ethers.provider.send("evm_increaseTime",[s]); await ethers.provider.send("evm_mine",[]); };

    await reg();
    // 1) happy path
    let id = await post("audit");
    await market.connect(agent).acceptJob(id);
    await market.connect(agent).submitDeliverable(id, "ipfs://x");
    await market.connect(client).approveAndPay(id);
    // 2) donation workflow: yabanci 5 USDC bagislar, sonra bir is daha tamamlanir
    await usdc.mint(stranger.address, R);
    await usdc.connect(stranger).transfer(addr, R);
    id = await post("audit");
    await market.connect(agent).acceptJob(id);
    await market.connect(agent).submitDeliverable(id, "ipfs://x");
    await market.connect(client).approveAndPay(id);
    // 3) withdrawStake + yeniden kayit (ayni 100 USDC)
    await market.connect(agent).withdrawStake();
    await usdc.connect(agent).approve(addr, stake);
    await market.connect(agent).registerAgent("A", "audit", 0);
    // 4) uc timeout isi, tek bekleme
    const a = await post("audit"); await market.connect(agent).acceptJob(a);
    const b = await post("audit"); await market.connect(agent).acceptJob(b);
    await market.connect(agent).submitDeliverable(b, "ipfs://x");
    const c = await post("audit"); await market.connect(agent).acceptJob(c);
    await market.connect(agent).submitDeliverable(c, "ipfs://x");
    await market.connect(client).disputeJob(c);
    await warp(1201);
    await market.claimTimeout(a);
    await market.claimTimeout(b);
    await market.claimTimeout(c);

    const slashSink = await market.slashSinkBalance();
    const feeSink = await market.reputationFeeSinkBalance();
    const bal = await usdc.balanceOf(addr);
    const paged = await market.getJobsPaged(0, 10);
    const statuses = [];
    for (let i = 1n; i <= await market.jobCount(); i++) statuses.push(Number((await market.jobs(i)).status));

    console.log("      slashSink :", ethers.formatUnits(slashSink,6));
    console.log("      feeSink   :", ethers.formatUnits(feeSink,6));
    console.log("      bakiye    :", ethers.formatUnits(bal,6));
    console.log("      is sayisi :", paged.total.toString());
    console.log("      durumlar  :", statuses.join(","));
    const rep = await market.getAgentReputation(agent.address);
    console.log("      global rep:", rep[0].toString(), " kategori:", (await market.getReputationByCategory(agent.address,"audit")).toString());

    // Arc'ta olculen degerler:
    expect(slashSink).to.equal(100_000000n);
    expect(feeSink).to.equal(500000n);
    expect(bal).to.equal(105_500000n);
    expect(paged.total).to.equal(5n);
    expect(statuses).to.deep.equal([4,4,6,7,8]);
    expect(rep[0]).to.equal(0n);
    expect(await market.getReputationByCategory(agent.address,"audit")).to.equal(0n);
    expect((await market.getAgent(agent.address)).registered).to.equal(false);
  });
});
