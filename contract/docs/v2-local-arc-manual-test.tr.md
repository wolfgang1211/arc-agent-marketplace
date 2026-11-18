# Yusuf: yerel uygulama + gerçek Arc Testnet, M1-M8

## Güncel kabul ve sıra (18 Kasım 2026)

**M3-M5 ve Job #6 iade/çekimi gerçek Arc Testnet'te Yusuf tarafından kabul edildi.** Sıra: M6, sonra M7, en son ayrıca onaylı M8. Kanıt: [M3-M5 / Job #6 defteri](v2-m3-m5-arc-acceptance-evidence-2026-11-18.md).

| Aşama | Durum |
|---|---|
| M3: iş oluşturma | Tamamlandı, Job #7 |
| M4: kayıt, teminat, başvuru ve Award | Tamamlandı, Job #7 |
| M5: teslim, inceleme, Approve ve ödeme çekimi | Tamamlandı, Job #7 Completed / stateVersion 4 |
| Job #6: timeout iadesi ve çekim | Tamamlandı, Refunded / stateVersion 2 |
| M6: revizyon | Hazırlık, aşağıdaki karar bilgisi kapısı geçilmeli |
| M7: mutual settlement | Bu elle kabul turunda tamamlanmadı |
| M8: dispute / resolver | Bu elle kabul turunda tamamlanmadı; her karar ayrı onaylı |

Client: `0x460EBe282Fb0e42B4d682a7f9EF408302417F780`.
Operator: `0xD632648b649bD09198047388d150fF408165CC29`.

Son kabul okumasında operator kayıtlı, credit 0, free collateral 5 USDC, reserved collateral 0, active jobs 0. Her yeni testte tekrar okunur. Yeniden kayıt veya ikinci 5 USDC depozito varsayılan adım değildir.

## Yerel ortam ve güvenlik

- Uygulama: http://127.0.0.1:3102/v2
- Health: http://127.0.0.1:3103/health
- Arc Testnet, chain ID **5042002**, RPC https://rpc.testnet.arc.io
- Explorer: https://testnet.arcscan.app
- Web/indexer/DB PM2 süreçleridir, cron değildir; yalnız `127.0.0.1` üzerinde kalır.
- DB: PGlite PostgreSQL wire protocol, `127.0.0.1:54329`. Veri: `%LOCALAPPDATA%\hermes\state\alphaboard-v2-local-arc\database`. Gerçek PostgreSQL sunucusu kabulü değildir.
- Başlatma migration/build yapmaz. Bilgisayar açılışında otomatik başlatma iddiası yoktur.
- Her işlem öncesi health `healthy`, `stale:false`, `gap:null`, son sync en çok 30 saniye eski olmalı. Tarihsel yol finalized adres filtreli log taramasıdır; olay/sınır blokları doğrulanır, head yakınında 32 blok reorg penceresi vardır. Tüm tarihsel boş blokların receipt/bloom kanıtı iddiası yoktur.
- Kontrol script'indeki legacy ikinci-hesap/testReady etiketi güncel canonical hesap kontrolünün yerine geçmez. Gerçek kayıt/stake/taraflar reader ile doğrulanır; eski etiket signer açılarak aşılmaz.
- `LIVE_EXECUTION_NOT_ACCEPTED` kilidi korunur. Hermes client/operator adına imza, başvuru, manifest POST, fonlama veya transaction göndermez. Tüm hesap onayları mevcut Brave/Rabby oturumunda Yusuf tarafından verilir; yeni/izole tarayıcı açılmaz.
- Seed, anahtar, parola, cookie, CSRF veya ham imza paylaşılmaz. Native gas ile ERC-20 USDC bakiyesi ayrı para gibi toplanmaz. Ödül hesabı gas dahil net kâr değildir.
- Railway/Vercel, production, main, V1, kontrat, bot kapsam dışıdır. Yeni bulunan düzeltmeler, bulut ve Faz 1b ayrıca onay gerektirir.

### CMD: repo dizininden

```bat
web\scripts\start-v2-local-arc.cmd
web\scripts\stop-v2-local-arc.cmd
cd web
node scripts\v2-local-arc-control.mjs status
node scripts\v2-local-arc-smoke.mjs
```

Her senaryo için yeni küçük iş kullan; Job #6/#7 ve tarihsel Job #1-5 yeniden oynanmaz. Pending/belirsiz işlem tekrar gönderilmez; önce orijinal hash, receipt ve canonical state araştırılır. Cancel open job mevcut UI/API'da devre dışıdır; Job #6 kabulü `claimOpenJobTimeout` içindir.

## M1-M2: gezinme, Rabby ağı ve oturum

Cüzdansız liste/detay/form açılmalı. Kategori tek, etiketler çoklu seçimdir. Mobil/masaüstü taşma kontrolleri ayrı kabul maddesidir; işlem başarısı tüm responsive kontrollerin geçtiği anlamına gelmez.

**Rabby:** Connect sırasında uygulama `wallet_switchEthereumChain` ister. Yusuf ağ geçişini kendisi onaylar. Sonra `eth_accounts` ve `eth_chainId` yeniden doğrulanır. Switch isteğinin başarı dönmesi doğru ağ kanıtı değildir. Red, eksik ağ, desteklenmeyen switch veya hesap kaybında dur; gerekirse ağı Rabby'de manuel ekle/seç.

Bağlantı ile **Sign in with wallet** ayrıdır. Hesap değiştirirken **Sign out -> Rabby'de hesap seç -> yeniden bağlan -> yeni hesapla giriş**. Her işlem öncesi tam adresi kontrol et. İmzasız gezinmede sign-in veya transaction verme; M3-M8'de gereken imzaları Yusuf verir.

## M3: küçük iş açma (tamamlandı)

Client ile 1 test USDC iş açıldı. Tek iş karşı-rol üst sınırı 5 USDC. Yeni tekrarda kriter, kategori, etiket, gelecekteki UTC apply-by ve süreleri gir; kontratın tarih sınırını kontrol et. Minimum/policy farklıysa dur. Rabby'de allowance/spender/hedef/ödül/gas incele. Receipt/readback sonrası yeni Open job ID bekle. Public kapalı olsa zincir verisi gizlenmez.

## M4: başvuru / atama (tamamlandı)

Operator canonical kayıt/stake/capacity kontrolünden sonra pitch ile EIP-712 başvuru imzalar. Başvuru off-chain'dir, transaction hash uydurulmaz. Client hesabına geç, **Load applications**, doğru operator ve **Award job**. Beklenen InProgress ve bu işin reserved stake'i. Mevcut teminat yeterliyse tekrar yatırma.

## M5: teslim / inceleme / ödeme (tamamlandı)

Operator: **Delivery link**, **Delivery type: Delivery**, **Submit delivery**. History yüklenmiyorsa dur. Gerçek çıktı kullan.

Client **Submitted delivery** içinde sürüm, bağlantı, kriterler ve current on-chain hash eşleşmesini görür; **Open delivery** ile işi inceler. URL hash'i gelecekteki site içeriğini veya kaliteyi garanti etmez. Eksik manifest/hash mismatch/stale state halinde Approve verme.

Kriterler sağlanıyorsa **Approve -> Completed**. Operator Account credit'i okuyup **Withdraw payment** yapar. `withdrawCredit` mevcut credit'in tamamını çeker; Amount alanı tek başına kısmi çekim taahhüdü değildir. **Withdraw collateral** ayrı teminat işlemidir. Job #7'de 1 USDC = 0.95 operator + 0.05 treasury; operator çekimi tamamlandı, 5 USDC teminat korunuyor. Normal akışta Open dispute/Propose settlement kullanılmaz.

## M6: revizyon hazırlığı

**Başlama kapısı:** Her yazma öncesi health, taraflar, süre ve karar bilgisi kontrol edilir. Mevcut form revizyon notunu commitment hash'lerine dönüştürüyor; notun operator'a okunur şekilde yeniden sunulması henüz kanıtlanmadı. Yeni eksik için ayrı düzeltme onayı/kanıtı olmadan bütün M6 hazır ilan edilmez. Aşağıdaki sıra test planıdır.

1. Client ile **yeni ayrı 1 USDC iş**, en az 1 revizyon hakkı, gelecekte apply-by ve yeterli teslim/review/revision süreleri seç. Güncel stake/gas oku; normal başvuru/Award ile InProgress'e gel.
2. Operator gerçek **v1** çıktısını Submit delivery ile gönderir. Client **Version 1**, içerik/hash ve kriterleri inceler. V1 referansını koru; özel içeriği public rapora kopyalama.
3. Client **Revision notes** içine hangi kriterin neden karşılanmadığını ve beklenen değişikliği açıkça yazar. Notun operator'a ulaşması ve boş gerekçeyle kör karar verilmemesi kontrol edilir. Yusuf **Request revision** işlemini Rabby'de onaylar.
4. Yusuf isterse Hermes receipt + canonical **RevisionPending**, artan stateVersion, revizyon sayacı/süre ve not commitment'ını salt-okuma doğrular. Hash, okunur gerekçenin yerine geçmez.
5. Operator kendi hesabı/oturumuna geçer, revizyon gerekçesini okur. **Delivery type: Revision**, yeni içerik ve **Submit revision**. Next version reader'dan gelir; draft/önceki deneme yoksa **v2**, elle zorlanmaz.
6. **V1 değişmezliği:** content ve hash aynen kalmalı. Yeni current version/hash zincirle eşleşir; eski sürüm **Other stored versions** içinde ayrılır. Status tekrar **Submitted**. Stored draft current confirmed teslim sayılmaz.
7. Client **yeni sürümü** açıp revizyon notu ve kriterlerle tekrar inceler. Sağlanıyorsa **Approve**, sonra **Completed** ve doğru stateVersion doğrulanır.
8. Operator Account credit/free/reserved/active jobs okur. **Withdraw payment** sonrası receipt, USDC Transfer, sıfır credit ve korunmuş collateral doğrulanır. Yeni işin fee snapshot'ı esas alınır; 1 USDC/500 bps ise 0.95 + 0.05 beklenir.

Her adım sonrası “Job #..., tx ...; salt okuma doğrula” denebilir. Hermes Yusuf istemeden adım yürütmez veya transaction tekrar göndermez. Yanlış ağ/hedef, stale veri, eksik not/teslim veya belirsiz receipt halinde durulur.

## M7: mutual settlement (M6'dan sonra)

Karar öncesi güncel canonical teklif sahibi/version, job stateVersion, refund, gross payout, fee/net payout, expiry ve varsa gerekçe görünür olmalı. Yeni teklif formunun varsayılan tutarları gelen teklif koşulları değildir. Görünür canonical teklif yoksa **Accept settlement** verme.

Taraflar teklif/kabul/ret işlemlerini kendi hesabıyla yapar. Yalnız aktif ve süresi geçmemiş karşı teklif kabul edilir. Sonra receipt, terminal durum, credit dağılımı; çekimler ayrı adım olarak doğrulanır. Ekran eksikleri giderilip güncel bütçe/health okunmadan M7 başlatılmaz.

## M8: dispute / resolver (en son, ayrıca onaylı)

Yusuf ayrı uygun işte Open dispute yapar. Karar öncesi teslim/geçmiş, kriterler, taraflar, payout/refund/fee/net, gerekçe/evidence, operatorFault/slash etkileri incelenir. Hash alanı tek başına okunur gerekçe değildir.

Önce tek job/karar için **önizleme** istenir. Önizleme gönderim yetkisi değildir. Etkin resolver, deployment/chain, stateVersion, süre, miktar sınırı, muhasebe ve simulation doğrulanır. Ancak sonra o karara özgü yeni açık sohbet onayıyla dar tek-job `resolveDispute` veya ayrı `resolveFaultReview` değerlendirilebilir. Geniş deploy/config/all kullanılmaz; uygun signer/önkoşul yoksa durulur. Ayrıntı: [M8 dar executor](v2-m8-resolve.md). Yerel EVM kabulü gerçek testnet resolver kabulü değildir; live signer kilidi açılmaz.

## Durdurma

Genel “devam” yeni testnet işlemi/resolve onayı değildir. Beklenmedik hesap/ağ/kontrat, stale health, görünmeyen karar koşulu veya belirsiz işlemde dur. Kimseye mesaj/paylaşım yapma. M6-M8 bitse bile bulut kurulumu ve Faz 1b ayrıca Yusuf onayı gerektirir.
