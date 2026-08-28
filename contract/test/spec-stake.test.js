/**
 * ============================================================================
 *  SPEC 9 — AJAN STAKE'İ DEPLOY ANINDA BELİRLENİR
 * ============================================================================
 *
 *  ⚠️  BU DOSYAYI "BOZUK" SANIP SİLME / ZAYIFLATMA.
 *  Stake parametreleştirme kartı inene kadar KIRMIZI kalacak.
 *
 *  Gerekçe: 100 USDC sabit stake testnet'te ürünü kullanılamaz kılıyor
 *  (faucet 2 saatte 20 USDC → 20 saat bekleme). Testnet'te o 100 USDC
 *  gerçek bir sybil savunması da değil; para bedava, sadece sabır istiyor.
 *
 *  Parametre isimleri ÖNERİDİR, sırası serbest — test constructor'ı ABI'den
 *  isimle çözüyor. Assert edilen DAVRANIŞ değişmez.
 * ============================================================================
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const REWARD = 5_000000n;

/** Constructor argümanlarını ABI'den isimle eşler; sıra Hermes'in tercihi. */
async function deployWith({ stake, delivery = 86400n, approval = 86400n, dispute = 86400n }) {
  const Market = await ethers.getContractFactory("AgentMarketplace");
  const inputs = Market.interface.deploy.inputs;
  const byName = (re) => inputs.findIndex((i) => re.test(i.name));
  const iStake = byName(/stake/i);
  if (iStake < 0) {
    throw new Error(
      "EKSİK: constructor bir stake parametresi almıyor. AGENT_STAKE hâlâ sabit " +
      "olabilir. Bu spec o değişiklik inene kadar kırmızı kalacak."
    );
  }
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const args = new Array(inputs.length);
  args[byName(/usdc/i)] = await usdc.getAddress();
  args[iStake] = stake;
  args[byName(/delivery/i)] = delivery;
  args[byName(/approval/i)] = approval;
  args[byName(/dispute/i)] = dispute;
  if (args.some((a) => a === undefined)) {
    throw new Error("EKSİK: constructor parametreleri isimle eşlenemedi: " +
      inputs.map((i) => i.name).join(", "));
  }
  const market = await Market.deploy(...args);
  return { usdc, market, addr: await market.getAddress() };
}

describe("SPEC 9 — stake deploy anında belirlenir", function () {

  it("deploy edilen stake fiilen tahsil edilir (getter değil, davranış)", async function () {
    const STAKE = 10_000000n; // 10 USDC — testnet degeri
    const [, agent] = await ethers.getSigners();
    const { usdc, market, addr } = await deployWith({ stake: STAKE });

    expect(await market.AGENT_STAKE()).to.equal(STAKE);

    // Tam olarak STAKE kadar cekiliyor: bir eksigi yetmiyor, fazlasi alinmiyor.
    await usdc.mint(agent.address, STAKE);
    await usdc.connect(agent).approve(addr, STAKE - 1n);
    await expect(market.connect(agent).registerAgent("A", "audit", 0)).to.be.reverted;

    await usdc.connect(agent).approve(addr, STAKE);
    await market.connect(agent).registerAgent("A", "audit", 0);
    expect(await usdc.balanceOf(agent.address), "fazladan tahsilat").to.equal(0n);
    expect(await usdc.balanceOf(addr)).to.equal(STAKE);
  });

  it("slash tam olarak deploy edilen stake'i yakar", async function () {
    const STAKE = 10_000000n;
    const [client, agent] = await ethers.getSigners();
    const { usdc, market, addr } = await deployWith({ stake: STAKE });

    await usdc.mint(agent.address, STAKE);
    await usdc.connect(agent).approve(addr, STAKE);
    await market.connect(agent).registerAgent("A", "audit", 0);

    await usdc.mint(client.address, REWARD);
    const id = (await market.jobCount()) + 1n;
    await usdc.connect(client).approve(addr, REWARD);
    await market.connect(client)["postJob(string,uint256,string)"]("terk", REWARD, "audit");
    await market.connect(agent).acceptJob(id);
    await ethers.provider.send("evm_increaseTime", [86401]);
    await ethers.provider.send("evm_mine", []);
    await market.claimTimeout(id);

    expect(await market.slashSinkBalance(), "yanan miktar deploy edilen stake degil").to.equal(STAKE);
    expect(await usdc.balanceOf(client.address), "musteri iadesi eksik").to.equal(REWARD);
  });

  it("withdrawStake deploy edilen stake'i aynen iade eder", async function () {
    const STAKE = 25_000000n; // farkli bir deger: sabit 100'e geri kacisi yakalar
    const [, agent] = await ethers.getSigners();
    const { usdc, market, addr } = await deployWith({ stake: STAKE });
    await usdc.mint(agent.address, STAKE);
    await usdc.connect(agent).approve(addr, STAKE);
    await market.connect(agent).registerAgent("A", "audit", 0);
    await market.connect(agent).withdrawStake();
    expect(await usdc.balanceOf(agent.address)).to.equal(STAKE);
  });

  it("sıfır ve MIN_AGENT_STAKE altı stake ile deploy REDDEDİLİR", async function () {
    // Stake sifirsa slash bedelsiz olur: ajan is kabul edip birakmanin
    // hicbir maliyeti kalmaz, DoS savunmasi tamamen coker.
    const Market = await ethers.getContractFactory("AgentMarketplace");
    const probe = await deployWith({ stake: 10_000000n });
    let min;
    try { min = await probe.market.MIN_AGENT_STAKE(); }
    catch { throw new Error("EKSİK: MIN_AGENT_STAKE() alt sınırı yok. Stake parametreleşiyorsa tabanı olmalı."); }

    // Taban en az MIN_JOB_REWARD olmali: bir isi birakmanin bedeli,
    // dondurdugu escrow'dan az olamaz.
    expect(min, "MIN_AGENT_STAKE, MIN_JOB_REWARD'dan kucuk").to.be.gte(await probe.market.MIN_JOB_REWARD());

    await expect(deployWith({ stake: 0n }), "sifir stake kabul edildi").to.be.rejected;
    await expect(deployWith({ stake: min - 1n }), "taban alti stake kabul edildi").to.be.rejected;
  });
});
