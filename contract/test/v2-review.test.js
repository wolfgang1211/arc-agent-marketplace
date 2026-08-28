/**
 * ============================================================================
 *  AÇIK BULGULAR — bu testlerin GEÇMESİ bugun var olduğunu gösterir
 * ============================================================================
 *
 *  3. turun bulguları (slash sicili sıfırlamıyor, aktif işle yeniden kayıt)
 *  düzeltildi ve regresyona taşındı — bkz. exploit.test.js
 *
 *  Buradakiler 5. turda, REPUTATION_FEE + sink getter turundan sonra bulundu.
 *  Değişmez testi ve bilgi testleri de burada duruyor; onlar bug değil,
 *  ölçüm. Bir bulgu düzeltilince testi regresyon kutbuna çevir, silme.
 * ============================================================================
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const REWARD = 100_000000n;
const DAY = 24 * 3600;
const DEAD = "0x000000000000000000000000000000000000dEaD";

async function build(tokenName) {
  const signers = await ethers.getSigners();
  const Token = await ethers.getContractFactory(tokenName);
  const usdc = await Token.deploy();
  const Market = await ethers.getContractFactory("AgentMarketplace");
  const market = await Market.deploy(
    await usdc.getAddress(),
    100_000000n,
    30 * 24 * 60 * 60,
    30 * 24 * 60 * 60,
    30 * 24 * 60 * 60,
  );
  const addr = await market.getAddress();
  const stake = await market.AGENT_STAKE();
  return { usdc, market, addr, signers, stake };
}

async function reg(usdc, market, addr, who) {
  const stake = await market.AGENT_STAKE();
  await usdc.mint(who.address, stake);
  await usdc.connect(who).approve(addr, stake);
  await market.connect(who).registerAgent("A", "x", 0);
}

async function fullJob(usdc, market, addr, client, agent) {
  await usdc.mint(client.address, REWARD);
  const id = (await market.jobCount()) + 1n;
  await usdc.connect(client).approve(addr, REWARD);
  await market.connect(client)["postJob(string,uint256,string)"]("is", REWARD, "general");
  await market.connect(agent).acceptJob(id);
  await market.connect(agent).submitDeliverable(id, "ipfs://x");
  await market.connect(client).approveAndPay(id);
  return id;
}

async function warp(s) {
  await ethers.provider.send("evm_increaseTime", [s]);
  await ethers.provider.send("evm_mine", []);
}

describe("AÇIK BULGULAR (5. tur) — ölçüm ve değişmez", function () {

  it("REGRESYON: bloklu dış adres approveAndPay ödeme yolunu durduramıyor", async function () {
    // Arc'ta USDC blocklist'i var. Reputation fee kontratta tutulduğu için
    // keyfi bir dış adresin transfer alamaması ödeme yolunu etkilememeli.
    const { usdc, market, addr, signers } = await build("BlocklistUSDC");
    const [client, agent] = signers;
    await reg(usdc, market, addr, agent);

    // Önce normal çalışıyor.
    await fullJob(usdc, market, addr, client, agent);

    // Sink bloklanıyor.
    await usdc.setBlocked(DEAD, true);

    const [, , client2] = signers;
    await usdc.mint(client2.address, REWARD);
    const id = (await market.jobCount()) + 1n;
    await usdc.connect(client2).approve(addr, REWARD);
    await market.connect(client2)["postJob(string,uint256,string)"]("is2", REWARD, "general");
    await market.connect(agent).acceptJob(id);
    await market.connect(agent).submitDeliverable(id, "ipfs://x");

    const feeBefore = await market.reputationFeeSinkBalance();
    await expect(market.connect(client2).approveAndPay(id)).to.emit(market, "JobApproved");
    const perPoint = (REWARD * await market.REPUTATION_FEE_BPS()) / 10000n;
    expect(await market.reputationFeeSinkBalance()).to.equal(feeBefore + perPoint);
    expect((await market.jobs(id)).status).to.equal(4n);
    expect(await usdc.balanceOf(DEAD)).to.equal(0n);

    // SLASH_SINK ise address(this) — kendi içinde, dışa bağımlı değil.
    expect(await market.SLASH_SINK()).to.equal(addr);
  });

  it("DEĞİŞMEZ: bakiye == slashSink + reputationFeeSink + aktif escrow + kilitli stake", async function () {
    // Karmaşık senaryo: çok ajan, karışık durumlar, bir slash, bir
    // withdrawStake, bir dispute, bir timeout ödemesi.
    const { usdc, market, addr, signers, stake } = await build("MockUSDC");
    const [c1, a1, a2, a3, c2, c3] = signers;
    for (const a of [a1, a2, a3]) await reg(usdc, market, addr, a);

    // a1: tamamlanmış iş
    await fullJob(usdc, market, addr, c1, a1);
    // a1: aktif escrow (InProgress)
    await usdc.mint(c2.address, REWARD);
    const live = (await market.jobCount()) + 1n;
    await usdc.connect(c2).approve(addr, REWARD);
    await market.connect(c2)["postJob(string,uint256,string)"]("acik", REWARD, "general");
    await market.connect(a1).acceptJob(live);
    // a2: bırakılmış iş → slash
    await usdc.mint(c3.address, REWARD);
    const dead = (await market.jobCount()) + 1n;
    await usdc.connect(c3).approve(addr, REWARD);
    await market.connect(c3)["postJob(string,uint256,string)"]("olu", REWARD, "general");
    await market.connect(a2).acceptJob(dead);
    await warp(31 * DAY);
    await market.claimTimeout(dead);
    // a3: hiç iş almadı, stake'ini çeker
    await market.connect(a3).withdrawStake();

    // Beklenen bileşenler
    const sink = await market.slashSinkBalance();
    const activeEscrow = REWARD;                 // sadece `live` işi
    const lockedStakes = stake;                  // a1 kayıtlı; a2 slash'lendi, a3 çekti
    const reputationFeeSink = await market.reputationFeeSinkBalance();
    const expected = sink + reputationFeeSink + activeEscrow + lockedStakes;

    expect(await usdc.balanceOf(addr)).to.equal(expected);
    expect(sink).to.equal(stake); // tek slash
  });

  it("bilgi: reputation fee marjinal maliyeti yaratıyor (SPEC 3 bu sayede yeşil)", async function () {
    const { usdc, market, addr, signers } = await build("MockUSDC");
    const farmer = signers[1];
    await reg(usdc, market, addr, farmer);
    const bps = await market.REPUTATION_FEE_BPS();

    const before = await market.reputationFeeSinkBalance();
    for (const c of signers.slice(2, 6)) {
      await fullJob(usdc, market, addr, c, farmer);
    }
    const burned = await market.reputationFeeSinkBalance() - before;
    const perPoint = (REWARD * bps) / 10000n;

    // Her yeni distinct-client puanı için geri alınamaz bir bedel sink'e eklendi.
    expect(burned).to.equal(perPoint * 4n);
    const rep = await market.getAgentReputation(farmer.address);
    expect(rep[0]).to.equal(4n);
  });

  // ---------------------------------------------------------------------
  // 7. TUR REGRESYONU — slash bütün sicil yüzeylerini aynı anda sıfırlar.
  // Bu iki test bulgu kutbundan pozitif regresyona çevrildi; silinmemeli.
  // Hedef davranış spec.test.js > SPEC 7'de yazılı.
  // ---------------------------------------------------------------------

  it("REGRESYON: slash global ve kategori sicilini birlikte sıfırlıyor", async function () {
    const { usdc, market, addr, signers } = await build("MockUSDC");
    const [bad, agent, c1, c2, c3] = signers;
    await reg(usdc, market, addr, agent);
    const min = await market.MIN_JOB_REWARD();

    for (const c of [c1, c2, c3]) {
      await usdc.mint(c.address, min);
      const id = (await market.jobCount()) + 1n;
      await usdc.connect(c).approve(addr, min);
      await market.connect(c)["postJob(string,uint256,string)"]("is", min, "audit");
      await market.connect(agent).acceptJob(id);
      await market.connect(agent).submitDeliverable(id, "ipfs://x");
      await market.connect(c).approveAndPay(id);
    }

    await usdc.mint(bad.address, min);
    const dead = (await market.jobCount()) + 1n;
    await usdc.connect(bad).approve(addr, min);
    await market.connect(bad)["postJob(string,uint256,string)"]("terk", min, "audit");
    await market.connect(agent).acceptJob(dead);
    await warp(31 * DAY);
    await market.claimTimeout(dead);

    // Global ve kategori yüzeyleri aynı reputation epoch'unu göstermeli.
    expect((await market.getAgentReputation(agent.address))[0]).to.equal(0n);
    expect(await market.getReputationByCategory(agent.address, "audit")).to.equal(0n);
  });

  it("REGRESYON: slash sonrası gerçek iş eski müşteriden yeni puan ve ücret üretir", async function () {
    const { usdc, market, addr, signers } = await build("MockUSDC");
    const [bad, agent, c1] = signers;
    await reg(usdc, market, addr, agent);
    const min = await market.MIN_JOB_REWARD();

    async function done(c) {
      await usdc.mint(c.address, min);
      const id = (await market.jobCount()) + 1n;
      await usdc.connect(c).approve(addr, min);
      await market.connect(c)["postJob(string,uint256,string)"]("is", min, "audit");
      await market.connect(agent).acceptJob(id);
      await market.connect(agent).submitDeliverable(id, "ipfs://x");
      await market.connect(c).approveAndPay(id);
    }

    await done(c1);
    await usdc.mint(bad.address, min);
    const dead = (await market.jobCount()) + 1n;
    await usdc.connect(bad).approve(addr, min);
    await market.connect(bad)["postJob(string,uint256,string)"]("terk", min, "audit");
    await market.connect(agent).acceptJob(dead);
    await warp(31 * DAY);
    await market.claimTimeout(dead);

    await reg(usdc, market, addr, agent); // 100 USDC yeni stake yatırdı
    const feeBefore = await market.reputationFeeSinkBalance();
    await done(c1);                        // aynı müşteriye gerçek iş

    // Yeni epoch eski dedupe kayıtlarını erişilemez bırakır; gerçek iş yeniden
    // puan üretir ve marjinal reputation fee'sini tekrar öder.
    expect((await market.getAgentReputation(agent.address))[0]).to.equal(1n);
    expect(await market.getReputationByCategory(agent.address, "audit")).to.be.greaterThan(0n);
    expect(await market.reputationFeeSinkBalance()).to.be.greaterThan(feeBefore);
  });
});
