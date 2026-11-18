# M3-M5 ve Job #6 iade kabul kaniti

## Kapsam ve karar

Yusuf, M3-M5 elle testlerini ve Job #6 iadesini gercek Arc Testnet uzerinde kabul etti. Bu belge normal akis kabuludur; M6, M7, M8, tum repo testleri veya production/cloud hazirligi kabul edilmis sayilmaz. Tum hesap imzalari ve transaction onaylari Yusuf tarafindan Rabby'de verildi. Hermes bu kanit toplamasinda yalniz salt-okuma yapti.

Dogrulama zamani: **2026-11-18T01:24:56.239Z**. Chain ID **5042002**.

- RPC: https://rpc.testnet.arc.io
- Marketplace: `0xFA156B7A5205B123c8a22A807ba98405e36130f1`
- Vault: `0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423`
- USDC ERC-20: `0x3600000000000000000000000000000000000000`
- Client: `0x460EBe282Fb0e42B4d682a7f9EF408302417F780`
- Operator: `0xD632648b649bD09198047388d150fF408165CC29`
- Job #7 treasury snapshot: `0xD520BEe785A4B6BEA15C94f20F640AAAd00088Ab`
- Son account/job read anchor: blok `72771379`, hash `0x0c523d9bcc4a3376602a25e93c657495d47ce462e3b6b7e3abd64a3b585f633a`.

## Kanit yontemi

Yerel canonical indexer kayitlarindan ilgili transaction hash'leri secildi. Asagidaki **10 benzersiz transaction** icin RPC'den transaction, receipt, canonical block header ve hedef runtime bytecode yeniden okundu. Her birinde receipt status `0x1`, chain ID, sifir native transaction value, marketplace/vault hedefi, receipt/transaction/block hash baglari ve indekslenmis olaylarin receipt address/topics/data/logIndex eslesmesi dogrulandi. Her tarihsel hedef bytecode hash'i canonical reader'in attested marketplace/vault runtime hash'iyle eslesti. ABI yalniz action adini dogrulamak icin decode edildi; ham calldata ve application imzasi bu belgeye alinmadi.

Her iki credit cekiminde USDC `Transfer` olayi, marketplace -> hak sahibi ve `CreditWithdrawn.amount` ile birebir eslesti. Bu, yalniz UI mesaji veya event-derived bakiye cikarimi degildir. Tam receipt/loglar, DB verisi, session, cookie, CSRF, ham imza, anahtar veya yerel log dosyasi commit edilmez.

## Transaction defteri

| Asama | Action | Blok | Transaction hash | Sonuc |
|---|---|---:|---|---|
| Job #6 olusturma | `postJob` | 72485192 | `0xc52b34f6cae12a236ccf0b754b72852051425b51b6cbdc5ea7c253978cf9e8ee` | Open, reward 1 USDC |
| Operator kaydi | `registerOperator` | 72488113 | `0xa7fb8712931152ff85f63fbbeb752c9eab1b3de0602a8b30c6ce30a84ae1822a` | Registered |
| Operator teminati | `depositStake` | 72692501 | `0x2118eaf7576db0d3f8f501e44f32c8e39a32cc22a2e54accd19dc35a74f7e5c8` | 5 USDC free stake |
| Job #6 suresi gecmis is iadesi | `claimOpenJobTimeout` | 72693769 | `0xc7c7d4eab1d9345b0aecb83ea3598ab57dafedfe3d7bd56ef97f902ec0929fe7` | Refunded, stateVersion 2 |
| Job #6 client credit cekimi | `withdrawCredit` | 72694740 | `0x794ea480c89a6e8726233201005224a293727b59c581d192927e7cacdc524bc2` | Client'a 1 USDC Transfer |
| M3: Job #7 olusturma | `postJob` | 72695866 | `0xa9633d7b4a8fca4d87dbdcf060aeab4a15b1233236b45f4b389f745d87f0d50f` | Open, reward 1 USDC |
| M4: operator atamasi | `awardJob` | 72696620 | `0x305a7f3f7c91b16b9c8ddf8cf81198bc4fc2de7539b59e3efc9a3a1c51f0b2f1` | InProgress, stateVersion 2, 5 USDC reserved |
| M5: teslim | `submitDelivery` | 72697811 | `0x844aa213788c95f4f5366cdd0dee9384f9e3ba74b7a3d9788d6913514d2199cf` | Submitted, stateVersion 3, deliveryVersion 1 |
| M5: client kabul | `approve` | 72702906 | `0x4a95274e95740ac8de8beae23ba6525832b0d47ab3175e4562f5a7428bb07a18` | Completed, stateVersion 4, teminat serbest |
| M5: operator credit cekimi | `withdrawCredit` | 72766280 | `0xc14021a3a503ecd2446c21b5c51fab1ab0bdb60b456afd3d3d1a3b3ec7c44cc2` | Operator'e 0.95 USDC Transfer |

EIP-712 operator basvurusu off-chain'dir; kendisine uydurma bir transaction hash atanmaz. Award receipt'i dogru operator atamasini kanitlar; ham basvuru imzasi yayimlanmaz. Allowance transaction'lari bu defterin kapsaminda degildir.

## Teslim ve terminal durumlar

- Job #7 teslim baglantisi: https://kellearena.com/
- Delivery version: `1`.
- Delivery hash: `0x36fb0463e82afb4015244b6f438813d38c7eb3ea78f4921f0e38a47dceae45c1`.
- Kayitli manifestin canonical JSON hash'i zincirdeki hash ile eslesti. Bu URL hash'i sitenin gelecekteki icerigini dondurmez; bagimsiz oyun kalite/kriter denetimi iddiasi degildir.
- Job #6: `Refunded` (status `7`), stateVersion `2`, reward `1000000`.
- Job #7: `Completed` (status `6`), stateVersion `4`, reward `1000000`, feeBpsSnapshot `500`.
- Read anchor'da operator: registered `true`, credit `0`, free stake `5000000`, reserved stake `0`, active jobs `0`.
- Read anchor'da client: credit `0`, free/reserved stake `0`, active jobs `0`.

## Ucret ve korunum

Butun ham miktarlar **6 ondalikli ERC-20 USDC birimi**dir. Native gas bakiyesi veya gas gideri bu odul denklemlerine eklenmez. Gas dahil net cuzdan kari iddia edilmez.

### Job #7

```text
reward = grossPayout + refund = 1,000,000 + 0 = 1,000,000
fee = floor(grossPayout * 500 / 10,000) = 50,000
operatorNet = grossPayout - fee = 950,000
reward = operatorNet + treasuryFee + clientRefund
       = 950,000 + 50,000 + 0 = 1,000,000
USDC: 1.00 = 0.95 + 0.05 + 0.00
```

`Settled`: grossPayout `1000000`, refund `0`, fee `50000`. Treasury payi credit olarak tahakkuk etti; bu kabulde hazinenin cekim yaptigi iddia edilmez.

Approve'dan onceki blok ve approve blogunda bagimsiz block-pinned `eth_call` sonuclari:

| Alan (ham USDC) | Blok 72702905 | Blok 72702906 | Degisim |
|---|---:|---:|---:|
| Client credit | 0 | 0 | 0 |
| Operator credit | 0 | 950000 | +950000 |
| Treasury credit | 0 | 50000 | +50000 |
| creditsLiability | 0 | 1000000 | +1000000 |
| escrowed | 1000000 | 0 | -1000000 |
| Marketplace token balance | 1000000 | 1000000 | 0 |

```text
Settlement: delta(escrowed + creditsLiability) = -1,000,000 + 1,000,000 = 0
Before: token balance = escrowed + creditsLiability = 1,000,000 + 0
After:  token balance = escrowed + creditsLiability = 0 + 1,000,000
Operator withdrawal: 950,000 credit extinguished = 950,000 USDC Transfer
Collateral lifecycle: 5,000,000 free -> 5,000,000 reserved -> 5,000,000 free
Slash: 0; terminal reserved stake: 0
```

Teminat odulun parcasi degildir; 5 USDC, 1 USDC odul denklemine tekrar eklenmez.

### Job #6

```text
reward = grossPayout + refund = 0 + 1,000,000 = 1,000,000
fee = 0; operatorNet = 0
1.00 USDC escrow -> 1.00 USDC client credit -> 1.00 USDC client Transfer
Final client credit at read anchor = 0
```

Job #6'ya operator atanmadi; `Settled.operator` zero address. Iade, Cancel open job degil `claimOpenJobTimeout` yoluyla yapildi.

## Checkpoint kalite kapilari

- Talep edilen yedi dosyalik grup: **146 passed, 0 failed, 0 skipped**, exit `0`; seri kosu suresi `105720.043 ms`.
- Ek canonical account / loopback HTTP / readback lag grubu: **26 passed, 0 failed, 0 skipped**, exit `0`.
- Production `next build`: exit `0`. Account ve job detail'deki mevcut iki `react-hooks/exhaustive-deps` uyarisi devam ediyor; build hatasi degil.
- Ilk paralel test denemesi 180 saniyede timeout verdi, basari sayilmadi. Son kabul yukaridaki tamamlanmis seri kosuya dayanir.
- Bu sayilar tum repo veya CI kabul sayisi degildir. Build almak production/cloud deploy demek degildir.

Checkpoint duzeltmeleri: Rabby ag gecisi ve yeniden dogrulama; canonical hesap okuma; yalniz izinli gecici durumlarda bounded salt-okuma readback; client icin canonical teslim incelemesi. Yeni signer, kontrat, V1 veya bot degisikligi yok.
