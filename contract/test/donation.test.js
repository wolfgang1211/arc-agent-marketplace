/**
 * ARC'A ÖZGÜ GUARD — istenmeyen USDC girişi muhasebeyi bozmamalı.
 *
 * Arc'ta gas token'ı USDC ve ERC-20 arayüzü aynı varlığı gösteriyor.
 * Yani kontratın token bakiyesi aynı zamanda native bakiyesi. Herhangi biri
 * kontrata USDC gönderebilir. Kontrat muhasebesi bakiyeye değil sayaçlara
 * dayanıyorsa bu zararsızdır — bu testin kanıtladığı şey budur.
 *
 * Bu YEŞİL olmalı ve yeşil kalmalı. Kırmızıya dönerse biri muhasebeyi
 * balanceOf'a bağlamış demektir.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ARC GUARD — kontrata bedava USDC gönderilmesi", function () {
  it("hediye USDC ne sicili ne ödemeleri ne de sink sayaçlarını etkiler", async function () {
    const [client, agent, stranger] = await ethers.getSigners();
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const market = await (await ethers.getContractFactory("AgentMarketplace")).deploy(
      await usdc.getAddress(),
      30 * 24 * 60 * 60,
      30 * 24 * 60 * 60,
      30 * 24 * 60 * 60,
    );
    const addr = await market.getAddress();
    const stake = await market.AGENT_STAKE();
    const reward = await market.MIN_JOB_REWARD();

    await usdc.mint(agent.address, stake);
    await usdc.connect(agent).approve(addr, stake);
    await market.connect(agent).registerAgent("A", "audit", 0);

    // Yabanci biri kontrata dogrudan 1000 USDC gonderiyor.
    const gift = 1000_000000n;
    await usdc.mint(stranger.address, gift);
    await usdc.connect(stranger).transfer(addr, gift);

    const slashBefore = await market.slashSinkBalance();
    const feeBefore = await market.reputationFeeSinkBalance();

    // Tam bir is akisi hediyenin ustunde calisiyor.
    await usdc.mint(client.address, reward);
    const id = (await market.jobCount()) + 1n;
    await usdc.connect(client).approve(addr, reward);
    await market.connect(client)["postJob(string,uint256,string)"]("is", reward, "audit");
    await market.connect(agent).acceptJob(id);
    await market.connect(agent).submitDeliverable(id, "ipfs://x");

    const agentBefore = await usdc.balanceOf(agent.address);
    await market.connect(client).approveAndPay(id);
    const paid = await usdc.balanceOf(agent.address) - agentBefore;

    const fee = await market.reputationFeeSinkBalance() - feeBefore;
    expect(paid, "odeme hediyeden etkilendi").to.equal(reward - fee);
    expect(await market.slashSinkBalance(), "slash sink hediyeyi yuttu").to.equal(slashBefore);
    expect((await market.getAgentReputation(agent.address))[0]).to.equal(1n);

    // Hediye hala kontratta duruyor ve kimsenin cekme yolu yok.
    const components = slashBefore + (await market.reputationFeeSinkBalance()) + stake;
    expect(await usdc.balanceOf(addr)).to.equal(components + gift);

    // Ajan stake'ini sorunsuz cekebiliyor; hediye kilitlemiyor.
    await market.connect(agent).withdrawStake();
    expect(await usdc.balanceOf(addr)).to.equal(components + gift - stake);
  });
});
