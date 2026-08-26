/**
 * ============================================================================
 *  SPEC TESTLERİ — BUNLAR ŞU AN KIRMIZI VE ÖYLE OLMALI
 * ============================================================================
 *
 *  ⚠️  BU DOSYAYI "BOZUK" SANIP SİLME / ZAYIFLATMA.
 *
 *  Bu testler mevcut davranışı değil, HEDEFLENEN davranışı yazar.
 *  Şu an başarısız olmaları doğrudur — düzeltmeler geldikçe yeşile dönerler.
 *  Yeşile dönmeleri işin bittiğinin ölçüsüdür.
 *
 *  Bir test yeşile dönmüyorsa çözüm testi değiştirmek değil, kontratı
 *  düzeltmektir. Kabul kriteri değişecekse önce insana sor.
 *
 *  Fonksiyon isimleri (claimTimeout vb.) ÖNERİDİR. Farklı isim seçersen
 *  testteki ismi güncelle — ama assert edilen davranışı değiştirme.
 *
 *  REVİZYON 26 Ağustos (2. tur): SPEC 3 sıkılaştırıldı. Eski kriter
 *  ("toplam geri alınamayan maliyet > 0") tek seferlik bir kayıt
 *  depozitosuyla geçilebiliyordu — depozito N puana bölününce puan başına
 *  maliyet sıfıra gider. Yeni kriter MARJİNAL maliyet üzerinden.
 * ============================================================================
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

const REWARD = 100_000000n; // 100 USDC (6 decimals)
const DAY = 24 * 3600;

async function deploy() {
  const signers = await ethers.getSigners();
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  const Market = await ethers.getContractFactory("AgentMarketplace");
  const market = await Market.deploy(await usdc.getAddress());
  return { usdc, market, signers, addr: await market.getAddress() };
}

/** Kayıt ücreti/stake varsa otomatik karşılar — kontrat evrildikçe bozulmasın diye. */
async function registerAgent(usdc, market, addr, who, skill = "x") {
  let stake = 0n;
  try { stake = await market.AGENT_STAKE(); } catch { /* stake yok */ }
  if (stake > 0n) {
    await usdc.mint(who.address, stake);
    await usdc.connect(who).approve(addr, stake);
  }
  await market.connect(who).registerAgent("A", skill, 0);
  return stake;
}

function requireFn(contract, name) {
  if (typeof contract[name] !== "function") {
    throw new Error(
      `EKSİK: ${name}() henüz kontratta yok. Bu spec testi o fonksiyon ` +
      `eklenene kadar kırmızı kalacak.`
    );
  }
}

async function warp(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

/** Bir grup cüzdanın toplam USDC serveti. */
async function totalWealth(usdc, wallets) {
  let sum = 0n;
  for (const w of wallets) sum += await usdc.balanceOf(w.address);
  return sum;
}

/** Tek tur sahte iş: client işi açar, farmer alır, teslim eder, client onaylar. */
async function farmOneJob(usdc, market, addr, client, farmer) {
  await usdc.mint(client.address, REWARD);
  const id = (await market.jobCount()) + 1n;
  await usdc.connect(client).approve(addr, REWARD);
  await market.connect(client).postJob("sahte", REWARD);
  await market.connect(farmer).acceptJob(id);
  await market.connect(farmer).submitDeliverable(id, "ipfs://cop");
  await market.connect(client).approveAndPay(id);
}

/** Ajanın itibar puanı — şemadan bağımsız okumak için ilk sayacı alır. */
async function repPoints(market, who) {
  const rep = await market.getAgentReputation(who);
  return rep[0];
}

// ---------------------------------------------------------------------------
describe("SPEC 1 — Escrow korunumu: hiçbir iş parayı escrow'da bırakamaz", function () {
  // Değişmez kural: bir iş terminal duruma ulaştığında o işe ait escrow
  // sıfırlanmalı. Para ya client'a döner ya ajana gider. Üçüncü yol yok.
  //
  // NOT: kontrat bakiyesi stake ve reputation fee sink'i de içeriyor. Bu yüzden
  // ölçüm "bakiye == 0" değil, "bakiye == stake + fee sink".

  it("onaylanan iş escrow'u boşaltmalı", async function () {
    const { usdc, market, signers, addr } = await deploy();
    const [client, agent] = signers;
    const stake = await registerAgent(usdc, market, addr, agent);
    await usdc.mint(client.address, REWARD);
    await usdc.connect(client).approve(addr, REWARD);
    await market.connect(client).postJob("is", REWARD);
    await market.connect(agent).acceptJob(1);
    await market.connect(agent).submitDeliverable(1, "ipfs://x");
    await market.connect(client).approveAndPay(1);

    requireFn(market, "reputationFeeSinkBalance");
    expect(await usdc.balanceOf(addr)).to.equal(
      stake + await market.reputationFeeSinkBalance()
    );
  });

  it("dispute edilen iş de sonunda escrow'u boşaltabilmeli", async function () {
    const { usdc, market, signers, addr } = await deploy();
    const [client, agent] = signers;
    const stake = await registerAgent(usdc, market, addr, agent);
    await usdc.mint(client.address, REWARD);
    await usdc.connect(client).approve(addr, REWARD);
    await market.connect(client).postJob("is", REWARD);
    await market.connect(agent).acceptJob(1);
    await market.connect(agent).submitDeliverable(1, "ipfs://x");
    await market.connect(client).disputeJob(1);

    await warp(90 * DAY);
    requireFn(market, "claimTimeout");
    await market.connect(agent).claimTimeout(1);

    expect(await usdc.balanceOf(addr)).to.equal(stake);
  });
});

// ---------------------------------------------------------------------------
describe("SPEC 2 — İki taraflı timeout (ERC-8183 tarzı, hakemsiz)", function () {
  // Tasarım: her durumun bir son tarihi var. Süre dolunca sonuç önceden
  // bellidir ve tetiklemeyi HERKES yapabilir. Yargı yok, sadece takvim.

  it("InProgress'te ajan teslim etmezse süre dolunca client parasını geri alır", async function () {
    const { usdc, market, signers, addr } = await deploy();
    const [client, agent, stranger] = signers;
    await registerAgent(usdc, market, addr, agent);
    await usdc.mint(client.address, REWARD);
    await usdc.connect(client).approve(addr, REWARD);
    await market.connect(client).postJob("is", REWARD);
    await market.connect(agent).acceptJob(1);

    await warp(30 * DAY);
    requireFn(market, "claimTimeout");

    const before = await usdc.balanceOf(client.address);
    // Taraf olmayan biri de tetikleyebilmeli — kurtarma yolu kimseye bağlı olmamalı.
    await market.connect(stranger).claimTimeout(1);

    expect(await usdc.balanceOf(client.address) - before).to.equal(REWARD);
  });

  it("Submitted'da client onaylamazsa süre dolunca ajan hakedişini alır", async function () {
    const { usdc, market, signers, addr } = await deploy();
    const [client, agent, stranger] = signers;
    await registerAgent(usdc, market, addr, agent);
    await usdc.mint(client.address, REWARD);
    await usdc.connect(client).approve(addr, REWARD);
    await market.connect(client).postJob("is", REWARD);
    await market.connect(agent).acceptJob(1);
    await market.connect(agent).submitDeliverable(1, "ipfs://x");

    await warp(30 * DAY);
    requireFn(market, "claimTimeout");

    const before = await usdc.balanceOf(agent.address);
    await market.connect(stranger).claimTimeout(1);

    expect(await usdc.balanceOf(agent.address) - before).to.equal(REWARD);
  });

  it("süre dolmadan timeout tetiklenememeli", async function () {
    const { usdc, market, signers, addr } = await deploy();
    const [client, agent] = signers;
    await registerAgent(usdc, market, addr, agent);
    await usdc.mint(client.address, REWARD);
    await usdc.connect(client).approve(addr, REWARD);
    await market.connect(client).postJob("is", REWARD);
    await market.connect(agent).acceptJob(1);

    requireFn(market, "claimTimeout");
    await expect(market.claimTimeout(1)).to.be.reverted;
  });

  it("timeout ile ödenen iş, onaylanmış teslimle AYNI itibar sinyalini vermemeli", async function () {
    // Client onayı ile sessizlik aynı şey değil. Ayrılmazsa ajan sistematik
    // olarak susan client arayarak sicil toplar.
    const { usdc, market, signers, addr } = await deploy();
    const [client, agent] = signers;
    await registerAgent(usdc, market, addr, agent);
    await usdc.mint(client.address, REWARD);
    await usdc.connect(client).approve(addr, REWARD);
    await market.connect(client).postJob("is", REWARD);
    await market.connect(agent).acceptJob(1);
    await market.connect(agent).submitDeliverable(1, "ipfs://x");

    await warp(30 * DAY);
    requireFn(market, "claimTimeout");
    await market.claimTimeout(1);

    const rep = await market.getAgentReputation(agent.address);
    const approved = rep.approvedDeliveries ?? rep[2];
    expect(approved, "timeout ödemesi onaylanmış teslim sayılıyor").to.equal(0n);
  });
});

// ---------------------------------------------------------------------------
describe("SPEC 3 — Sybil maliyeti: itibarın MARJİNAL fiyatı sıfır olamaz", function () {
  /**
   * ÇERÇEVE:
   *
   * İzinsiz bir kayıt defterinde sybil'i ELEMEK mümkün değil. Beş sahte
   * client cüzdanı, zincir üstünde beş gerçek client'tan ayırt edilemez.
   * Çözülebilecek problem "engellemek" değil, FİYATLAMAK.
   *
   * DİKKAT — bu kriterin zayıf hali işe yaramaz:
   * "toplam geri alınamayan maliyet > 0" demek yetmiyor, çünkü tek seferlik
   * bir kayıt depozitosu bunu geçer ama depozito N puana bölününce puan
   * başına maliyet sıfıra gider. 100 USDC / 1 puan = 100 USDC;
   * 100 USDC / 100 puan = 1 USDC; 100 USDC / 10.000 puan ≈ 0.
   *
   * DOĞRU KRİTER: her EK itibar puanının marjinal maliyeti > 0 olmalı.
   * Yani sicili büyütmek sürekli para yakmalı, bir kez ödenip
   * amortize edilebilen bir giriş bileti olmamalı.
   */

  it("ek itibar puanının marjinal maliyeti sıfır olmamalı", async function () {
    const { usdc, market, signers, addr } = await deploy();
    const farmer = signers[1];
    await registerAgent(usdc, market, addr, farmer);

    const fakeClients = signers.slice(2, 12); // 10 sahte client — hepsi saldırganın
    const wallets = [farmer, ...fakeClients];

    // 1. faz: 5 puan topla.
    for (const c of fakeClients.slice(0, 5)) {
      await farmOneJob(usdc, market, addr, c, farmer);
    }
    const wealthAfterPhase1 = await totalWealth(usdc, wallets);
    const pointsAfterPhase1 = await repPoints(market, farmer.address);

    // 2. faz: 5 puan daha topla.
    for (const c of fakeClients.slice(5, 10)) {
      await farmOneJob(usdc, market, addr, c, farmer);
    }
    const wealthAfterPhase2 = await totalWealth(usdc, wallets);
    const pointsAfterPhase2 = await repPoints(market, farmer.address);

    const extraPoints = pointsAfterPhase2 - pointsAfterPhase1;
    // mint edilen ödüller serveti şişirmesin diye net akışı ölçüyoruz:
    // 2. fazda mint edilen miktarı düş.
    const minted = REWARD * 5n;
    const marginalCost = wealthAfterPhase1 + minted - wealthAfterPhase2;

    expect(extraPoints, "2. fazda sicil artmadı, test anlamsız").to.be.greaterThan(0n);
    expect(
      marginalCost,
      `${extraPoints} ek itibar puanı ${marginalCost} birim maliyetle alındı — ` +
      `giriş depozitosu amortize ediliyor, marjinal fiyat sıfır`
    ).to.be.greaterThan(0n);
  });

  it("sicil YALNIZCA tamamlanan işten kazanılmalı — kabul etmek yetmemeli", async function () {
    // distinctClients şu an acceptJob içinde artıyor. Ajan işi kabul edip
    // hiç teslim etmese bile "farklı client" sicili kazanıyor.
    // Sybil maliyeti neredeyse gas: ödül 1 mikro-USDC olabiliyor.
    const { usdc, market, signers, addr } = await deploy();
    const farmer = signers[1];
    await registerAgent(usdc, market, addr, farmer);
    const fakeClients = signers.slice(2, 8);
    // Minimum ödül eşiği varsa ona uy — test eşikten değil, sicilden düşmeli.
    let amount = 1n;
    try { amount = await market.MIN_JOB_REWARD(); } catch {}

    for (const c of fakeClients) {
      await usdc.mint(c.address, amount);
      const id = (await market.jobCount()) + 1n;
      await usdc.connect(c).approve(addr, amount);
      await market.connect(c).postJob("bos", amount);
      await market.connect(farmer).acceptJob(id);
      // teslim yok, onay yok
    }

    expect(
      await repPoints(market, farmer.address),
      "kabul etmek tek başına sicil üretiyor"
    ).to.equal(0n);
  });

  it("aynı client'tan tekrarlayan işler doğrusal sicil üretmemeli", async function () {
    const { usdc, market, signers, addr } = await deploy();
    const [client, agent] = signers;
    await registerAgent(usdc, market, addr, agent);
    await usdc.mint(client.address, REWARD * 10n);

    for (let i = 0; i < 5; i++) {
      const id = (await market.jobCount()) + 1n;
      await usdc.connect(client).approve(addr, REWARD);
      await market.connect(client).postJob("is " + i, REWARD);
      await market.connect(agent).acceptJob(id);
      await market.connect(agent).submitDeliverable(id, "ipfs://x");
      await market.connect(client).approveAndPay(id);
    }

    requireFn(market, "getReputationScore");
    const score = await market.getReputationScore(agent.address);
    expect(score, "tek client'tan gelen sicil doğrusal artıyor").to.be.lessThan(5n * 100n);
  });
});

// ---------------------------------------------------------------------------
describe("SPEC 4 — Stake mekanizması adil olmalı", function () {
  // 2. turda eklenen stake için. Depozito almak meşru, ama:
  //  - dürüst ajan parasını geri alabilmeli
  //  - el koyma keyfi olmamalı ve el koyandan kâr çıkmamalı

  it("dürüst ajan kaydını kapatıp stake'ini geri alabilmeli", async function () {
    const { usdc, market, signers, addr } = await deploy();
    const agent = signers[1];
    const stake = await registerAgent(usdc, market, addr, agent);
    if (stake === 0n) return this.skip();

    requireFn(market, "withdrawStake");
    const before = await usdc.balanceOf(agent.address);
    await market.connect(agent).withdrawStake();
    expect(await usdc.balanceOf(agent.address) - before).to.equal(stake);
  });

  it("ANTI-GRIEF: client slash'tan kâr etmemeli — yalnızca kendi ödülünü alır", async function () {
    // En kritik değişmez. Slash edilen stake karşı tarafa giderse, client
    // teslim edilmesi zor iş açıp ajanın stake'ini toplamaya teşvik edilir:
    // maliyet gas + 30 gün kilitli sermaye, getiri kurban başına 100 USDC.
    // Hakemi sistemden çıkardık; kâr güdüsünü client'a taşımak aynı
    // çarpıklığı geri getirir.
    const { usdc, market, signers, addr } = await deploy();
    const [client, agent, stranger] = signers;
    const stake = await registerAgent(usdc, market, addr, agent);
    if (stake === 0n) return this.skip();

    await usdc.mint(client.address, REWARD);
    await usdc.connect(client).approve(addr, REWARD);
    await market.connect(client).postJob("is", REWARD);
    await market.connect(agent).acceptJob(1);

    const cBefore = await usdc.balanceOf(client.address);
    const sBefore = await usdc.balanceOf(stranger.address);
    await warp(31 * DAY);
    await market.connect(stranger).claimTimeout(1);

    expect(
      await usdc.balanceOf(client.address) - cBefore,
      "client slash'tan kâr ediyor — grief teşviki"
    ).to.equal(REWARD);
    expect(
      await usdc.balanceOf(stranger.address) - sBefore,
      "tetikleyen taraf slash'tan kâr ediyor — grief teşviki"
    ).to.equal(0n);
  });

  it("SLASH_SINK kasıtlı olmalı: kilitli kalır ve kimse çıkaramaz", async function () {
    // Arc'ta sıfır adrese transfer revert ediyor, yani yakma seçenek değil.
    // Sink bu zincirde yakmanın tek pratik karşılığı — sorun paranın
    // sıkışması değil, sıkışmanın kasıtlı olduğunun yazılı olmaması.
    const { usdc, market, signers, addr } = await deploy();
    const [client, agent, stranger] = signers;
    const stake = await registerAgent(usdc, market, addr, agent);
    if (stake === 0n) return this.skip();

    await usdc.mint(client.address, REWARD);
    await usdc.connect(client).approve(addr, REWARD);
    await market.connect(client).postJob("is", REWARD);
    await market.connect(agent).acceptJob(1);
    await warp(31 * DAY);
    await market.connect(stranger).claimTimeout(1);

    // Sink dolu ve çıkışsız.
    expect(await usdc.balanceOf(addr)).to.equal(stake);
    const names = market.interface.fragments
      .filter(f => f.type === "function" && f.stateMutability !== "view")
      .map(f => f.name);
    const drains = names.filter(n => /sweep|drain|treasury|rescue|withdrawAll|distribute/i.test(n));
    expect(drains, `sink çıkışı eklenmiş: ${drains}`).to.have.lengthOf(0);

    // Niyet KODDA olmalı, sadece yorumda değil: sink bakiyesini açan
    // bir getter, kararın kasıtlı olduğunu makine tarafından doğrulanabilir
    // hale getirir.
    requireFn(market, "slashSinkBalance");
    expect(await market.slashSinkBalance()).to.equal(stake);
  });

  it("slash nesnel bir gerekçeye bağlı olmalı, keyfi olmamalı", async function () {
    const { usdc, market, signers, addr } = await deploy();
    const [owner, agent] = signers;
    const stake = await registerAgent(usdc, market, addr, agent);
    if (stake === 0n) return this.skip();
    if (typeof market.slashAgent !== "function") return this.skip();

    // Ajan hiçbir şey yapmadı: ne iş aldı, ne teslim etti, ne süre kaçırdı.
    // Böyle bir ajan slash edilememeli.
    await expect(
      market.connect(owner).slashAgent(agent.address),
      "ihlali olmayan ajan slash edilebiliyor"
    ).to.be.reverted;
  });
});

// ---------------------------------------------------------------------------
describe("SPEC 5 — Kimlik ve sayaç hijyeni", function () {
  it("uzmanlık değiştirmek eski sicili taşımamalı", async function () {
    const { usdc, market, signers, addr } = await deploy();
    const [client, agent] = signers;
    await registerAgent(usdc, market, addr, agent, "ucuz-is");
    await usdc.mint(client.address, REWARD);
    await usdc.connect(client).approve(addr, REWARD);
    await market.connect(client).postJob("is", REWARD);
    await market.connect(agent).acceptJob(1);
    await market.connect(agent).submitDeliverable(1, "ipfs://x");
    await market.connect(client).approveAndPay(1);

    await market.connect(agent).registerAgent("A", "smart-contract-audit", 5000_000000n);

    requireFn(market, "getReputationByCategory");
    const score = await market.getReputationByCategory(agent.address, "smart-contract-audit");
    expect(score, "sicil kategoriler arası taşınıyor").to.equal(0n);
  });

  it("getAllJobs() sayfalanabilir olmalı", async function () {
    const { market } = await deploy();
    requireFn(market, "getJobsPaged");
  });
});
