# AlphaBoard /v2 App Implementation Plan

> **For Hermes:** Faz 1a yerel kodlaması kullanıcı tarafından onaylandı. Küçük TDD görevleri, bağımsız spec/güvenlik incelemesi ve her ana adım sonunda yerel commit kullan. Faz 1b, bulut kaynakları ve Yusuf'un manuel preview testi ayrıca onay gerektirir.

**Goal:** V1'i hiç taşımadan veya değiştirmeden, her türlü dijital iş için V2 başvuru-seçim, escrow, teslimat, uyuşmazlık ve teminat arayüzü/backend'i kurmak.

**Architecture:** Para ve kesin durum Arc Testnet'teki immutable Marketplace + Vault'ta; indekslenmiş okuma modeli ve imzalı başvurular PostgreSQL'de. Next.js yalnız /v2 ve /api/v2 yüzeylerini ekler; anahtarsız, bağımsız indexer zinciri okur. İşlem imzası kullanıcının cüzdanında kalır.

**Tech Stack:** Mevcut Next.js 14.2.35, React, viem/wagmi; V2'ye özel JS/ESM modülleri, PostgreSQL + SQL migrations/pg; ayrı Node.js indexer. Bu iş kapsamında V1'i TypeScript'e dönüştürmek veya framework yükseltmek yok.

**Durum:** Revize kapsam kabul edildi. Son kullanıcı kararı: Docker veya başka yükleyici çalıştırılmayacak; Windows güvenlik ilkesi değiştirilmeyecek/aşılmayacak. Faz 1a yerelde `@electric-sql/pglite` ile ilerler; aynı bağlantı arayüzü ve aynı SQL migration dosyaları daha sonra `pg` ile kullanılır. Çok bağlantı, advisory lock/indexer kilidi ve gerçek eşzamanlılık kabulü `[real-pg]` testleriyle ayrılır: şimdilik "gerçek Postgres bekliyor", geçmiş sayılmaz. Railway V2 Postgres + anahtarsız indexer, $10 hedef/$15 üst sınır ve yerel E2E sonrası ayrı onay kapısı korunur. Yusuf production branch=main ve Preview env secret izolasyonunu panelden doğruladı; Faz 1a yerel commit'lerinin feat/marketplace-v2 push'u da artık açıkça onaylıdır.

**Tema:** Faz 1a arayüzü siyah arka planlı koyu tema; yalnız V2 scoped stilleri. V1 globals/layout/provider değiştirilmez.

## 1. Doğrulanmış başlangıç ve durdurma kapıları

- Dal: `feat/marketplace-v2`. Kabul edilen kontrat kodu değiştirilmeyecek; proxy/upgrade veya UI için yeni getter/deploy eklenmeyecek.
- Chain ID: `5042002`; RPC: https://rpc.testnet.arc.io ; USDC: `0x3600000000000000000000000000000000000000`, ERC-20 decimals 6, native görünüm decimals 18. Bunlar iki farklı para değil.
- Marketplace: `0xFA156B7A5205B123c8a22A807ba98405e36130f1`; Vault: `0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423`.
- Kaynak ve dağıtım otoritesi: `contract/contracts/AgentMarketplaceV2.sol`, `OperatorCollateralVaultV2.sol`, canonical artifact/build-info ve `contract/docs/v2-testnet-deployment.json`.
- Dört canlı senaryo kabul edildi. Job 5 cron'u grace window nedeniyle çalışmadan kaldırılmıştı; tarihsel kayıt korunur. Yeni onaylı tek manuel denemede timeout claim ve 5 USDC resolver kesintisi doğrulandı; RPC SERVER_ERROR nedeniyle client çekimi gönderilmeden duruldu, tekrar denenmedi. Job Refunded, ayrılmış teminat 0, client credit 6 USDC; beşinci senaryo tamamlanmış sayılmaz. Bağımsız korunum geçti; kanıt commit'i `128cd9053d05f625c97cbb4ab3ffa18667dc94b1`. Bundan sonraki herhangi bir çekim/transaction için yeni açık onay gerekir.
- V1 kaynakları, kontratı, Railway botu, mevcut env ve production korunur. Testnet cüzdanları ana ağda kullanılmaz. Üretim/mainnet geçişi bu planın dışındadır.
- Eski taslaklardaki `getJob`, otomatik tek aktif iş veya otomatik slash varsayımları geçerli değildir: dağıtılmış kontratın gerçek ABI/durum modeli esas alınır.

## 2. İlk sürüm kapsamı ve ortak iş formu

### 2.1 Kullanıcı akışları

1. İş listesi ve detayını cüzdansız inceleme; taslak iş formunu bağlanmadan doldurma.
2. İş açma: sürümlü açıklama/kabul kriterlerini kaydetme, hash karşılaştırma, gerekiyorsa tam tutarlı USDC allowance, kullanıcı imzalı `postJob` ve başarılı receipt/readback.
3. Operatör kaydı, free/reserved teminat gösterimi, Vault'a allowance + `depositStake`, yalnız serbest tutar için `withdrawStake`; gerçek `maxActiveJobs`/aktif iş görünümü.
4. EIP-712 ile başvuru, özel başvuru listesi, client'ın geçerli başvuruyu `awardJob` ile seçmesi. Doğrudan accept akışı yok.
5. Teslimat, kriter/referans bağlı revizyon isteği, revizyon teslimi ve client onayı.
6. Dispute açma, ayrı yetkili hakem ekranı; gerekçe/kanıt hash'leriyle çözüm, kusur ve kesinti tutarının açık önizlemesi.
7. Mutual teklif, karşı tarafça kabul/red, teklif sahibince revoke; refund + gross payout = reward doğrulaması.
8. Settlement sonrası `credits(account)` ve `withdrawCredit`; ödeme tamamlandı ile çekilebilir credit oluştu ayrımı.
9. Faz 1a güvenli çıkışları: open cancel/expiry, review/delivery/dispute timeout claim ve fault-review/release. Fon kurtarma Faz 2 sohbetine bağımlı olamaz. Access report/recovery ve delivery extension Faz 1b'ye ertelendi; 1a action allowlist'inde bulunmaz.

### 2.2 Tek kategoriye kilitlenmeyen form

- Zorunlu: başlık, serbest iş tanımı, ölçülebilir kabul kriterleri listesi, reward USDC, başvuru son tarihi, delivery/review/revision süreleri ve revizyon hakkı.
- İsteğe bağlı: kategori, çoklu etiket, beklenen teslim biçimleri, örnek/referans, dil, lisans/kullanım koşulu ve hassasiyet açıklaması. Kategori yalnız filtre/öneri sağlar; kontrat veya form tek iş türünü zorunlu tutmaz.
- Bot, web sitesi, araç, tasarım, video, araştırma ve diğer işler aynı akışı kullanır. Kod işine özgü repo/commit/test talimatı alanları koşullu; videoya ait süre/format alanları başka işi engellemez.
- Ortak teslim manifest'i: schemaVersion, iş kimliği (chain/market/jobId), operator, açıklama, kabul kriteri başına kanıt, links[], files[] (ad/MIME/byte size/hash), teslim sürümü, isteğe bağlı source commit ve çalıştırma/inceleme talimatı.
- Açıklama, kriterler ve teslim manifest'i değişmez sürümlerle tutulur. Canonical UTF-8 içerik/JCS hash sözleşmesi fixture ile sabitlenir; bu içerik hash'i Solidity'nin `abi.encode` ile hesapladığı canonicalTermsHash ile karıştırılmaz.
- Faz 1a yalnız HTTPS link ile teslim ve sürümlü link manifest'i sunar; dosya yükleme düğmesi/API'si/bucket yok. Faz 1b dosya desteği: özel S3-uyumlu bucket, doğrudan süreli upload URL'si, checksum/tamamlanma doğrulaması, boyut/adet/MIME sınırı, download-as-attachment. Büyük video için harici HTTPS teslim bağlantısı da kabul edilir. DB'de dosya binary'si değil metadata ve content hash saklanır. Bucket/provider oluşturma bu turda yapılmaz.
- Önerilen ilk limit: dosya başına 25 MB, teslim başına 10 dosya; büyük işler link kullanır. HTML/SVG/script/çalıştırılabilir içerik inline render edilmez; zip açılıp çalıştırılmaz. Tarama tamamlanmayan yükleme indirilebilir teslim sayılmaz.

## 3. V1 izolasyonu ve Paket 1 route sorunu

Paket 1'de V1'in `web/app/jobs/[id]/page.js` route'u ile taslağın `web/app/jobs/[jobId]/page.js` route'u çakışmıştı. Dynamic segment adını değiştirmek farklı URL üretmez; `/jobs/123` ikisi için de aynıdır. UI bu nedenle durdurulmuştu. PostgreSQL eksikliği de ayrı blokajdı; önceki yerel kurulum izni, kurulum zamanı yeniden sorulması koşuluyla ertelenmişti.

**Değişmeyecek V1 URL'leri:** `/`, `/jobs`, `/jobs/new`, `/jobs/[id]`, `/agents`, `/agents/register`, `/agents/[address]`, `/activity`, `/workflows`, `/api/delivery-preview`, `/api/source-preflight`.

**Önerilen yeni dosyalar/URL'ler:**

| Dosya | URL / amaç |
|---|---|
| `web/app/v2/layout.js`, `web/app/v2/page.js` | V2 kabuğu ve landing |
| `web/app/v2/jobs/page.js`, `web/app/v2/jobs/new/page.js` | Liste ve genel iş formu |
| `web/app/v2/jobs/[jobId]/page.js` | V2 detay/başvuru/atama/teslim/aksiyonlar |
| `web/app/v2/account/page.js` | Credit, operatör kaydı ve teminat |
| `web/app/v2/admin/page.js`, `web/app/v2/admin/jobs/[jobId]/page.js` | Ayrı, yetki kontrollü hakem yüzeyi |
| `web/app/api/v2/**/route.js` | Yalnız V2 API |
| `web/lib/v2/**`, `web/app/v2/_components/**` | Adres/ABI/okuma/görünüm izolasyonu |

- Root `web/app/layout.js`, `providers.js`, `globals.css`, `web/lib/wagmi.js`, V1 ABI/adresler ve V1 route'ları değiştirilmez. V2'ye özel provider/config nested layout altında; paylaşılan provider ile çifte wallet subscription sorunu ayrıca test edilir.
- Mevcut V1 wagmi RPC'si farklı bir hostname kullanıyor. V2'nin canonical RPC tercihi V1'de toplu bir RPC/env değişikliği gerekçesi değildir.
- V1'e redirect, rewrite, middleware catch-all veya otomatik V2 migrasyonu yok. V1/V2 aynı sayısal jobId'yi paylaşabilir; her DB/cache/query kimliği `(chainId, marketplace, jobId)` içerir.
- Paket 1 hatasına regresyon testi: `/jobs/1` V1 adres/ABI'si, `/v2/jobs/1` V2 adres/ABI'si kullanmalı. `next build` route manifest'inde çakışma bulunmamalı.
- Bu turda yeni `/v2` route'u bile oluşturulmaz; yukarıdakiler yalnız planlanan dosyalardır.

## 4. Backend, başvurular ve veritabanı

### 4.1 Sorumluluklar

- PostgreSQL zincirin yerine geçmez. Para, rol, deadline ve signature geçerliliği her write öncesi güncel zincirden tekrar kontrol edilir; cüzdan simülasyonu ve zincir receipt'i son otoritedir.
- V2 API başvuru/brief/teslim metadata'sını ve wallet session'larını saklar; kullanıcı anahtarı almaz, sunucudan kullanıcı adına transaction imzalamaz.
- DB düşerse özel içerik/başvuru işlemleri 503 olur; boş listeyi gerçek sıfır veri diye göstermez. Salt RPC balance/credit/recovery okuması ayrı kalır; önceden yayımlanmış işlemler tx hash ile takip edilebilir.
- API cevaplarında indexed block/hash, chain head, lastSyncedAt ve stale alanları bulunur. Eskimiş projection ile award/approve/resolve hazırlanmaz.

### 4.2 Başvuru imzası ve doğrulaması

EIP-712 domain birebir: name `AlphaBoard Agent Marketplace V2`, version `1`, chainId `5042002`, verifyingContract mevcut Marketplace.

Type birebir: `Application(uint256 jobId,address operator,bytes32 termsHash,uint64 validAfter,uint64 validBefore,uint256 nonceEpoch,uint256 operatorNonce)`.

- İmzalı payload ve imza PostgreSQL `v2_applications` tablosunda, başvuru açıklaması/profil referansı ayrı sürümlü alanlarda tutulur. İmza yalnız kontrat alanlarını bağlar; pitch metni veya off-chain executionMode imzalanmış terms'in bir parçasıymış gibi gösterilmez.
- API kimliği login session operator'ıyla eşler; EOA için recovery, smart wallet için güncel zincirde ERC-1271 doğrulaması yapar. Ham signature ve özel başvurular herkese açık listede dönmez.
- Oluşturma ve award öncesi: job Open, current canonicalTermsHash, doğru chain/contract/job/operator, validAfter <= block.timestamp < validBefore <= applyBy, epoch/nonce, kayıt, kullanılabilir teminat ve aktif iş kapasitesi yeniden okunur. Resolver/client/operator çıkar çatışması kontrol edilir.
- Unique digest + operator + job ve idempotency key tekrar başvuruyu çift saymayı önler. Aynı işi eşzamanlı atama yarışında yalnız başarılı zincir receipt'i seçilmiş sayılır.
- DB'den gizleme imzayı iptal etmez. Kesin iptal `revokeApplication(jobId)`; tüm imzaları iptal `invalidateAllApplications()`. Global epoch değişimi için event yok; her doğrulamada getter okunur.
- `maxActiveJobs=0` kontratta sınırsızdır; UI tek aktif iş garantisi uyduramaz. İlk kontrollü operatör testlerinde 1 ayarı önerilir, fakat bunun transaction'ı ayrıca kullanıcı tarafından onaylanır.

### 4.3 Ortak PostgreSQL/PGlite şeması (Faz 1a migration kapsamı)

V2 tabloları `v2_` prefix'i kullanır. Sayısal USDC, nonce, block ve stateVersion için integer/numeric; JavaScript floating point para hesabı yok. Zaman UTC, adresler doğrulanmış binary/normalize edilmiş lookup anahtarı; kullanıcıdan gelen orijinal kimlikler audit'te korunur.

| Tablo | Temel alanlar ve kısıtlar |
|---|---|
| `v2_chain_deployments` | chainId, market, vault, deploy block/hash, artifact/source/schema hash; unique chain+market |
| `v2_indexer_cursors`, `v2_indexed_blocks` | indexed/finalized height+hash, parent hash, lease owner, health/gap state |
| `v2_chain_events` | chain/address/blockHash/txHash/logIndex, block/tx index, event name, decoded JSON, canonical flag; fork-aware unique |
| `v2_jobs` | composite job key, client/operator/resolver, reward/fee snapshots, canonicalTermsHash, descriptionHash/criteriaHash, status/stateVersion, deadline clocks, stake snapshot; source block/hash |
| `v2_job_documents`, `v2_deliveries`, `v2_attachments` | immutable version/content hash, visibility, storage key/link, checksum/MIME/size, criterion references, chain confirmation relation |
| `v2_applications` | job/operator, typed payload, signature/digest, nonceEpoch/operatorNonce, expiry, verification block/hash, visible/revoked/awarded state |
| `v2_operator_projection`, `v2_credit_projection`, `v2_reservations`, `v2_mutual_requests` | event-derived balances/capacity, per-job reserve/disposition, proposal version/expiry; RPC revalidation required |
| `v2_auth_challenges`, `v2_sessions` | single-use expiring challenge, origin/chain/wallet binding, hashed token, expiry/revocation |
| `v2_idempotency_keys`, `v2_audit_events` | wallet/endpoint/request fingerprint, response reference, security/admin read/write trail; no raw cookies/private keys |
| Faz 2: `v2_messages`, `v2_help_requests`, `v2_notification_outbox` | job ACL, append-only messages, admin help, idempotent delivery/retry/dead letter |
| Faz 3: `v2_agent_api_credentials`, `v2_external_identity_links` | scoped/revocable credentials and independently verified external identity evidence |

Zincir projection'ları raw event'lerden yeniden üretilebilir. Off-chain başvurular/brief/dosyalar zincirden geri üretilemez; şifreli backup ve restore testi Faz 1 teslim ölçütüdür. Chain reorg'unda kullanıcı belgeleri silinmez, orphaned-chain referansı ayrılır.

### 4.4 API sözleşmesi

Bütün aşağıdaki yollar `/api/v2` altında, küçük response schema/version, bounded body/cursor pagination/rate-limit ve job ACL ile sunulur:

| Metot / yol | Amaç / yetki |
|---|---|
| POST `/auth/challenge`, `/auth/verify`, `/auth/logout`; GET `/me` | Domain/chain bağlı wallet login; single-use nonce; EIP-712 başvurusundan ayrı auth mesajı |
| GET `/jobs`, `/jobs/[jobId]`, `/jobs/[jobId]/events` | Public ilan/durum ve güvenli event timeline |
| POST `/drafts`; GET `/drafts/[draftId]`; POST `/drafts/[draftId]/confirm` | İş açılmadan brief/hash saklama; confirmation tx receipt'inin gerçek sender/event/hash eşleşmesi |
| GET/POST `/jobs/[jobId]/applications` | GET: client/ilgili operator/yetkili inceleyen; POST: yalnız session ile aynı imzacı operator, sunucuda signature doğrulama |
| POST `/jobs/[jobId]/applications/[applicationId]/hide` | Yalnız görünürlük; on-chain revoke olmadığı açıkça belirtilir |
| GET/POST `/jobs/[jobId]/deliveries` | GET: taraflar/atanmış resolver; POST: yalnız seçilmiş operator ve uygun zincir durumu; versioned manifest, başarılı submit receipt'iyle doğrulama |
| POST `/uploads/init`, `/uploads/complete`; GET `/attachments/[attachmentId]/download` | Session + draft/job ACL, kısa ömürlü scoped URL, checksum/MIME/scan gate |
| GET `/operators/[address]`, `/accounts/[address]/credits` | Public projection + pinned-block RPC kontrolü; free/reserved ayrımı |
| POST `/jobs/[jobId]/actions/prepare` | Allowlist edilmiş fonksiyon için calldata + güncel version/expiry; kullanıcı cüzdanı imzalar, backend broadcast yapmaz |
| GET `/admin/jobs`, `/admin/jobs/[jobId]`; POST `/admin/jobs/[jobId]/decision-drafts` | Server-side doğrulanmış rol; imzasız karar taslağı, çözüm tx'i ayrıca resolver cüzdanından |
| GET `/health` | Cursor, gap, RPC/DB erişimi ve artifact attestation; özel env veya sır dönmez |

Wallet session için V2'ye özel isimli Secure/HttpOnly/host-only cookie, kısa TTL, logout/revoke; V1 cookie'sini overwrite etmez. Origin/CSRF/replay/IDOR kontrolleri her write'ta yapılır. URL'ye tx hash eklemek receipt doğrulanmadan iş/teslim kaydı oluşturmaz.

## 5. Event indexer ve zincir okuma adaptörü

### 5.1 İndekslenecek gerçek olaylar

Marketplace (artifact ABI'siyle, yalnız attested emitter):
- İş/şart/durum: `JobPosted`, `JobTerms`, `JobAwarded`, `JobState`, `ApplicationRevoked`, `OperatorRegistered`.
- Teslim/revizyon/erişim: `DeliverySubmitted`, `RevisionRequested`, `RevisionSubmitted`, `AccessReported`, `AccessRecovered`.
- Uzatma: `DeliveryExtensionRequested`, `DeliveryExtensionGranted`, `DeliveryExtensionRejected`, `DeliveryExtensionRevoked`.
- Uyuşmazlık: `DisputeOpened`, `DisputeResolved`, `DisputeHeartbeat`, `DisputeResumed`.
- Kusur: `FaultReviewOpened`, `FaultReviewResolved`, `FaultReviewReleased`, `OperatorFaultDeclared`.
- Mutual/ödeme: `MutualProposed`, `MutualRejected`, `MutualRevoked`, `Settled`, `CreditWithdrawn`.
- Politika/rol: `PolicyChanged`, `TreasuryChanged`, `HouseStatusChanged`, `TestClientStatusChanged`, `ResolverPolicyChanged`; ABI'deki inherited `OwnershipTransferStarted`, `OwnershipTransferred`.

Vault: `StakeDeposited`, `StakeWithdrawn`, `StakeReserved`, `StakeReleased`, `FaultMarked`, `StakeSlashed`, `FaultReleased`, `SurplusSwept`.

- ERC-20 `Transfer` loglarını V2 job event'i gibi kullanma; native/ERC-20 görünümünü çift para sayma.
- `JobPosted` anında ayrı JobState event'i yok: initial Open/stateVersion=1, JobPosted + JobTerms ile kurulup pinned-block storage read ile doğrulanır.
- `JobTerms.collateralPolicy`, `JobState.clockPack` ve counters bit paketleri kaynak kodun exact bit offset'leriyle decode edilir; golden fixtures gerekir.
- `setMaxActiveJobs`, global nonce epoch invalidation ve bazı private alanlar tümüyle event'lerden türetilemez; getter/storage read revalidation zorunlu.

### 5.2 Getter olmayan alanlar release blocker olmamalı

`jobs`, `mutual`, `listedHouse`, `testClient`, `resolverPolicy` dağıtılmış kontratta public getter değildir. UI için hayali `getJob()` çağrısı veya kontrat büyütme yok.

- `contract/scripts/approved-v2-executor.js` içindeki canonical build/storage-layout decoder yaklaşımını referans alarak, V2 server-only, salt-okuma adapter tasarlanır. CLI executor/keystore loader web dependency'si olarak import edilmez.
- Tam compiler storage layout ve source/artifact/runtime hash pin'leri yeni web read package'ına açık, secretsiz manifest olarak alınır. Runtime/immutable attestation başarısızsa adapter fail-closed olur.
- Job/mutual/mapping alanları `eth_getStorageAt` ile aynı sabit blockTag'de okunur; getter verileri aynı blockTag'de birleşir. Private Solidity alanı zincirde gizlilik anlamına gelmez.
- Açık getter'lar ve event projection ile çapraz kontrol; typed digest hesabı kontrat fixture'larıyla eşlenir. `awardJob`, `approve`, `resolve` öncesi fresh preflight + wallet simulateContract şarttır.

### 5.3 Eksik blok, reorg, restart

1. Vault deploy receipt block `68072734`, Marketplace deploy receipt block `68072744` başlangıçları manifest'ten doğrulanır; genesis taranmaz.
2. HTTP `eth_getLogs` ile iki emitter, başlangıçta 1.000 blokluk adaptif batch; provider limitinde batch küçültülür. Websocket yalnız hızlandırma, cursor/backfill'in yerine geçmez.
3. Cursor'dan hedef safe/finalized head'e kadar kesintisiz aralık sorgulanır; log dönmeyen aralık da işlendi olarak kaydedilir. Provider'ın finalized/safe tag desteği startup'ta test edilir; unsupported ise konservatif confirmation buffer kullanıldığı API'de açıklanır.
4. Her batch'te block/hash/parentHash doğrulanır; block/transaction/log sırasıyla raw event + projection + cursor tek DB transaction'ında commit edilir. Unique log identity tekrarları engeller.
5. Restart'ta son 32 blok yeniden tarama/uzlaştırma; hash uyuşmazlığında ortak ata bulunur, orphaned raw log'lar canonical=false olur, projection son doğru checkpoint'ten yeniden üretilir. 32 blok sınırının dışındaki uyuşmazlık otomatik tahminle geçilmez, indexer degraded olur ve derin replay ister.
6. RPC 429/timeout/backoff, başka read-only RPC'ye geçiş ve boş/eksik log cevapları kontrol edilir. Cursor veri işlenmeden ilerlemez; yarım batch tekrar idempotent okunur. Arşiv erişimi yetersizse tam backfill yapılmış sayılmaz.
7. Sağlık: head-cursor lag, last successful range/hash, missing range queue, error count, DB lease, attestation. Önerilen stale uyarısı 60 saniye; yanlış clock veya gap'te write hazırlığı bloklanır.
8. Tek aktif indexer için DB advisory lock/lease. Event indexer hiçbir anahtara sahip olmaz, otomatik claim/settlement veya ücretli transaction göndermez. Scheduler uyusa bile para kararı otomatik atlanmaz; kalan claim'ler kullanıcıya görünür.

## 6. Barındırma ve maliyet seçimi (onay bekliyor)

### 6.1 Yerel başlangıç

Onaylı yerel yol: Node.js içinde PGlite; kurulum programı, Docker, WSL değişikliği veya güvenlik ilkesi müdahalesi yok. Veri dosyaları repo dışında tutulur. `query`/`transaction`/`close` bağlantı arayüzü hem PGlite hem `pg` için aynıdır; SQL migration dosyaları iki sürücüde de değişmez. PGlite tek kullanıcı/bağlantı olduğundan yerel indexer ve API tek DB sahibiyle çalışır; aynı veri dizinine bağımsız çoklu process/pool açılmaz. Gerçek Postgres kilit/çoklu oturum/eşzamanlı yazma/bağlantı havuzu testleri `[real-pg]` etiketiyle atlanır ve "gerçek Postgres bekliyor" olarak raporlanır. Railway kaynağı ve real-pg çalıştırma onayı ayrı kapıdır.

### 6.2 Canlı seçenekleri

Fiyat kaynakları 20 Ekim 2026'da resmî fiyat sayfalarının arama çıktısından kontrol edildi. USD, vergi/kur farkı hariç; hesaplar tahmindir, mevcut hesabın plan/indirim/kullanımı doğrulanmadı.

| Seçenek | DB ve artılar | Sınır/risk | Örnek aylık DB / worker maliyeti |
|---|---|---|---|
| Neon | Managed PostgreSQL, branch ve scale-to-zero; Vercel için uygun | Sürekli polling DB'yi uyanık tutar. Free 100 CU-hour ve 1 GB sınırı 7/24 indexer için bedava garanti değildir | Launch: $0.106/CU-hour + $0.35/GB-month. 0.25 CU, 730 saat, 1 GB = $19.695; yalnız 8 saat/gün x 30 gün = $6.71; ayrı worker eklenir |
| Supabase | PostgreSQL + daha sonraki auth/storage/realtime olanakları | Free 500 MB, 1 hafta inaktivitede pause; Pro maliyeti küçük MVP'de daha yüksek. Wallet ACL yine bizim sorumluluğumuz | Tek Micro project Pro tabanı $25; ayrı yeni Railway Hobby worker ile örnek $30; storage/quota aşımı ayrıca |
| Railway Postgres | Worker ve PostgreSQL aynı platform/private network; basit operasyon | DB bir PostgreSQL servisi; backup/restore ve sürüm işletimi ayrıca sahiplenilir. V1 ile aynı service/env kullanılmaz | RAM $10/GB-month, CPU $20/vCPU-month, volume $0.15/GB-month, egress $0.05/GB. Aşağıdaki küçük yük varsayımında DB + worker $6.20 toplam kaynak kullanımı |

Railway örnek hesabı: servis başına ortalama 0.25 GB RAM + 0.02 vCPU + 1 GB volume + 1 GB egress = $3.10; iki servis = $6.20. Indexer stateless tutulursa volume gerekmeyebilir; hesap konservatif biçimde içerir. Gerçek RAM/CPU ve backfill yükü daha yüksek olabilir. Hobby $5/ay tabanı $5 kullanım içerir; taban kullanımın üstüne ikinci kez eklenmez. Mevcut V1 faturası ve mevcut dahil kredi ayrıca okunmadan ek maliyet kesinleştirilemez.

**Önerilen varsayılan:** Vercel'de mevcut web uygulamasının izole V2 route'ları + ayrı Railway V2 project/service içinde anahtarsız indexer ve ayrı PostgreSQL. İlk bütçe hedefi $10/ay, gözlem/backfill payıyla $15/ay üst hedef; otomatik kaynak satın alma değil, onaylanacak bütçedir. Managed DB branch/PITR önceliği maliyetten yüksekse Neon Launch + Railway worker alternatifidir.

- Vercel request/serverless fonksiyonunda sonsuz indexer loop'u yok. API kısa ömürlü; pg pooler/bağlantı limitiyle çalışır. DB migration build esnasında otomatik production'a koşmaz, ayrı onaylı adım olur.
- Her preview için izole V2 test DB/namespace ve bucket prefix; üretim DB/anahtarına erişim yok. Dışarı açık API'de testnet banner ve rate-limit gerekir.
- Dosya varsayılanı: private Cloudflare R2 Standard veya S3-uyumlu eşdeğer. R2 resmî liste: 10 GB-month, 1M Class A ve 10M Class B ücretsiz kota; sonrası storage $0.015/GB-month ve operation ücretleri. Kota içinde tahmini storage faturası $0; scan/backup/worker ve diğer hizmet maliyetleri ayrıca. Kullanım limiti/budget alarmı olmadan açılmaz.
- Şifreli DB backup: günlük + release öncesi, 7 günlük önerilen retention, ayrı güvenli hedef ve local restore tatbikatı. Private dosya ACL'leri backup/restore'da korunur. PITR/HA veya sıfır veri kaybı varmış gibi sunulmaz.
- RPC bu planda public endpoint ile test edilir; rate/availability sınırına gelirse özel RPC için ayrı onay ve fiyat gerekir. Vercel mevcut plan kotası/fiyatı bu turda değiştirilmez veya sıfır maliyet garantisi verilmez.

Kaynaklar:
https://neon.com/pricing
https://supabase.com/pricing
https://docs.railway.com/pricing/plans
https://developers.cloudflare.com/r2/pricing/

## 7. Güvenlik, ekonomik risk ve hakem paneli

- Uygulama custody tutmaz. Frontend/API/indexer env'ine deployer, owner, resolver, treasury veya house private key konmaz. Browser, server log, telemetry ve hata mesajlarında raw session/signature/secret yok.
- Yanlış ağ guard'ı gerçek bağlı hesabın chainId'sinden türetilir. İmza ve transaction kontrolleri disabled kalır; ağ ekleme/değiştirme kullanıcı onayıyla, reddedilirse otomatik devam yok.
- İş açarken/başvururken/atarken tam canonicalTermsHash kopyalanabilir gösterilir. Token, pair, resolver, reward/fee/net payout, süreler, revizyon hakkı ve stake alt sınırı görünür; hash tek başına anlaşılır şartların yerine geçmez.
- Başvuru imzası ödeme değildir ama geçerli süre boyunca client'ın işi atamasına izin verir. Off-chain gizleme iptal değildir; exact revoke tx'i ayrıca onaylanır. Permit/limitsiz approval varsayılan olmaz.
- Teminat `requiredStake(reward)` getter'ından, en az 5 USDC ve reward'un %10'u/0.01 USDC yukarı yuvarlama politikasıyla gösterilir. Sadece free stake çekilir; reserved stake bekleyen fault review'da kilitli kalabilir.
- Client onayı veya review-timeout payout önce credit oluşturur; çekim ayrı işlem. Fee iş açılış snapshot'ından hesaplanır; tüm para hesabı raw integer ile.
- **7 gün hareketsizlik kuralı:** aktif Disputed episode'da effective deadline = min(episodeStart + 21 gün - önceki dispute süresi, lastAdminActionAt + 7 gün). Hakem heartbeat'i sınırsız değildir; en fazla 2. Süre dolunca `claimDisputeTimeout` ile client'a reward refund credit'i oluşur; otomatik transfer veya 50/50 yok. Kullanıcı manuel claim gerektiğini görür.
- **Ayrı 7 günlük kusur incelemesi:** delivery-timeout claim reward'u client credit'ine çevirir, fakat teminatı hemen kesmez; fault review açar. Yetkili resolver süre içinde 0..reserved slash belirleyebilir; kesinti client'a credit olur. Süre geçerse `releaseFaultReview` ile stake serbest bırakılır. OperatorFault dispute çözümünde ise mevcut kontrat tam ayrılmış teminatı keser. Bu iki akış aynıymış gibi anlatılmaz.
- Resolver iş açılırken snapshot'tır; client policy yoksa owner fallback'ı uygulanır. `manualClient` için atanmış resolver varmış gibi davranılmaz; UI açmadan önce gerçek effective resolver okunur. Ayrı resolver istenirse owner ayarı başka bir onaylı testnet transaction'ıdır.
- Resolver client/operator olamaz. API'de admin etiketi finansal yetki vermez; yalnız snapshot resolver'ın wallet transaction'ı geçerlidir. V1 admin veya platform owner rolü otomatik V2 resolution yetkisi değildir.
- `/v2/admin` ve admin API'leri server-side auth/role kontrolü yapar. Atanmış resolver yalnız ilgili özel başvuru/teslim/kanıtı okuyabilir. Global operasyon admin okuması gerekiyorsa ayrı allowlist ve kullanıcıya açıklanmış erişim politikası onaylanır. Her özel admin okuması ve karar taslağı audit edilir.
- Hakem kalite hakkında takdir kullanır; trustless kalite garantisi verilemez. Değiştirilebilir dış linkler, dosya erişiminin kaybı, blokzincirde kalıcı hash/veri, cüzdan kaybı, RPC/indexer gecikmesi ve testnet USDC'nin gerçek para olmadığı açıkça anlatılır.
- XSS/SSRF/IDOR: zengin HTML çalıştırma yok, URL şeması/host/IP/redirect sınırı, localhost/private-network fetch yok, dosyalar özel ve authenticated. Frontend link preview ile sunucudan keyfi URL fetch etme varsayılan değildir.
- Receipt başarısız, zincir/storage attestation uyumsuz, stale stateVersion, imza uyuşmazlığı veya korunum hatasında başarı gösterilmez ve otomatik transaction tekrarı yapılmaz.

## 8. Fazlar ve teslim ölçütleri

### Faz 1a: Yerel çekirdek akış + güvenli çıkışlar (onaylı)

**Bağlayıcı sıra:** (1) V1 npm test/build baseline ve route izolasyon testleri, (2) canonical read adapter + hash/EIP-712 fixture'ları, (3) V2 PGlite/pg ortak DB katmanı + migration/auth/ACL, (4) indexer + replay/reorg testleri, (5) API, (6) siyah arka planlı /v2 UI, (7) gerçek yerel PGlite persistence + EVM + tarayıcı E2E. Her adım RED -> minimum kod -> GREEN -> inceleme -> yerel commit; sonraki bağımlı adım kapı geçmeden başlamaz. Bu yerel kabul, `[real-pg]` çok bağlantı/kilit testlerinin geçtiği anlamına gelmez; onlar Railway V2 onayından sonra ayrıca çalıştırılır.

**Kesin 1a kapsamı:** iş listesi/detay, genel iş formu, iş açma, EIP-712 başvuru, client ataması, link ile teslim, revizyon, onay, mutual, dispute açma, minimal yetkili resolver çözüm ekranı, credit çekme, teminat yatırma/çekme; open cancel/expiry, delivery/review/dispute timeout claim ve fault review release. Para hareketi cüzdan imzası ve receipt/readback ile; sunucu/indexer anahtarsız. Sahte persistence/SQLite, fixture-only E2E veya boş API stub'ı tamamlanmış sayılmaz.

**1a dışı:** dosya upload/R2, delivery extension, access report/recovery, tam hakem dashboard'u, sohbet/bildirim ve agent API. İlgili mevcut zincir event'lerinin salt okunur indekslenmesi bu özelliklerin UI/API write akışlarını açma yetkisi değildir.

Planlanan dosyalar:
- `web/lib/v2/{chain,contracts,terms,applications}.mjs`, `web/lib/v2/server/{chain-reader,wallet-session,job-access,db}.mjs`. `uploads.mjs` yalnız 1b.
- `web/db/v2/migrations/001-core.sql`, PGlite/pg ortak adapter ve `.env` içermeyen örnek yapılandırma/uyumluluk belgesi; Docker Compose yok.
- Bölüm 3'teki yalnız yeni route'lar; `web/app/api/v2/**/route.js`.
- `services/v2-indexer/{package.json,src/index.mjs,src/reducer.mjs,src/cursor.mjs,test/*.test.mjs}`; V1 bot klasörü kullanılmaz.
- `web/test/v2-{route-isolation,terms,applications,auth,job-access,chain-reader,actions}.test.mjs`; browser E2E `web/e2e/v2-*.spec.js`. Upload testleri/endpoint'leri 1b'ye aittir.

Teslim ölçütleri:
- Her kod görevi önce gerçek failing test, sonra minimum uygulama ve passing test; fixture-only çıktı uçtan uca kanıt diye sunulmaz.
- Tüm zorunlu yerel akışlar gerçek PGlite SQL/persistence + yerel EVM üzerinde; başarı receipt/hash/bakiye ve API rol matrisiyle doğrulanır. PGlite'ta doğrulanamayan gerçek Postgres davranışları `[real-pg]` atlanan testler olarak ayrı sayılır; tam Postgres eşdeğerliği iddia edilmez. Redis/Kafka/GraphQL gibi ek sistemler gerekmeden başlangıç.
- V1 `npm test` ve `npm run build` baseline korunur; ayrıca indexer testleri, DB integration, V2 browser E2E ve mobil/masaüstü walletless form doğrulanır.
- Reorg, duplicate log, boş blok, RPC 429, yarım batch crash ve restart testi deterministik; replay aynı projection'ı üretir. Backup restore imzalı başvuruları ve dosya ACL'sini korur.
- Hatalı ağ/imza/nonce/terms/rol, stale version, aynı anda award, double-click, başarısız receipt ve off-chain hide/on-chain revoke ayrımı test edilir.
- Yusuf'un manuel test matrisi ve bekleyen Job 5 kanıtı ayrı tamamlanır. UI başarı etiketi yalnız receipt + readback sonrası görünür.
- Onaylı branch preview'si production'ı değiştirmeden doğrulanır. Frontend build başarısı production deploy kanıtı değildir; main merge ve production release bu teslimatın parçası değildir.

### Faz 1b: Dosyalar, uzatma, erişim kurtarma ve tam hakem paneli (onay bekliyor)

- R2/private bucket dosya yükleme, checksum/MIME/scan ve güvenli download.
- Delivery extension request/grant/reject/revoke; pending talep saati durdurmaz.
- Access report/recovery ve ilgili dispute recovery akışları.
- Hakem panelinin tam hâli: tüm kuyruklar/filtreler, ayrıntılı timeline, heartbeat/resume operasyonları ve kapsamlı audit görünümü. 1a'nın minimal, atanmış resolver çözüm ekranını büyütür.
- Ayrı açık Faz 1b onayı olmadan kod/endpoint/bucket oluşturulmaz. Kabul: dosya/rol/SSRF testleri, exact deadline/version sınırları ve 1a regresyon/E2E; R2 kaynağı ayrıca onaylı olmalıdır.

### Faz 2: Sohbet + bildirim

- Yalnız iş tarafları ve açıkça yetkilendirilmiş admin için append-only sohbet; yardım talebi ile finansal dispute ayrımı; terminal job odası read-only politikası.
- Admin'in sohbet okuma/yazma kapsamı kullanıcıya bildirilir ve audit edilir. Bu operasyon rolü kontrattaki resolver yetkisiyle karıştırılmaz.
- Durable outbox, idempotent event-to-notification, bounded retry/backoff/dead-letter; başlangıç in-app. Telegram/e-posta/webhook dış gönderimleri ayrı kanal/onay olmadan açılmaz.
- Teslim: rol matrisi/IDOR, sıralama/pagination, reconnect, duplicate/outbox crash ve channel failure testleri; veri sızıntısız bildirim. Bildirim kaçması deadline'ı durdurmaz veya para hareketi başlatmaz.

### Faz 3: Agent API + dış itibar/ERC-8004

- Aynı V2 domain/service kuralları üstünde versioned OpenAPI, read-only discovery, scoped/revocable agent credentials ve request idempotency. Agent'lar da imzalı başvuru + client award bekler.
- Execution mode self-declared etiketi; gerçek on-chain iş/teslim/uyuşmazlık istatistikleri ayrı. Testnet/house işlemleri gerçek müşteri itibarı diye sunulmaz.
- ERC-8004 kimlik ve dış reputasyon isteğe bağlı adaptör; seçilen ağın registry adresi/standard sürümü ayrıca resmî kaynak ve zincir üzerinden doğrulanmadan bağlanmaz. Dış itibar ödeme/atama veya admin yetkisi vermez.
- Teslim: web ve agent API aynı auth/terms/state test vektörlerini geçer; identity ownership doğrulama/revocation/cache failure testleri; kimlik servisi bozuksa çekirdek fonlar kilitlenmez. Ücretli tool/x402 bütçesi ve otomatik write modu ayrıca onay ister.

**Kabul edilen sıra:** Faz 1a yerel E2E -> ayrı Railway V2 kaynak onayı -> ayrı Yusuf manuel preview testi onayı -> ayrıca Faz 1b onayı -> Faz 2 -> Faz 3. Read adapter/DB/indexer/API UI'dan önce; 1b veya chat/agent işleri 1a'ya taşınmaz.

## 9. Yusuf'un manuel test planı

Manuel client: `0x460EBe282Fb0e42B4d682a7f9EF408302417F780`. Anahtarı Hermes'e aktarılmaz; gerçek Brave cüzdanında Yusuf imzalar. Şimdiki tur bu testleri çalıştırma veya cüzdan transaction'ı onayı değildir. Her case ayrı küçük testnet job, başlangıç/son block ve integer bakiye snapshot'ı kullanır.

### 9.1 Faz 1a manuel matris (yerel E2E sonrası ayrıca preview test onayı)

| Case | Manuel akış / beklenen kanıt |
|---|---|
| M1 | Cüzdansız V1/V2 liste/detay; bot/web/video/araştırma ortak formu; connect CTA; siyah V2 tema, V1 değişmemiş |
| M2 | Yanlış ağdan connect, switch reject, doğru ağ; ağ onayı olmadan imza/approve/post yok |
| M3 | 1 USDC normal job; resolver snapshot, exact allowance, JobPosted/Terms receipt ve brief hash eşleşmesi |
| M4 | Kontrollü testOperator EIP-712 başvuru; Yusuf ataması; rol izolasyonu ve ayrılan stake |
| M5 | Yalnız HTTPS link manifest'i teslimi; criterion/hash kontrolü, onay, net payout/fee credit ve ayrı çekimler; upload düğmesi yok |
| M6 | Criterion/reference bağlı revizyon; yeni link manifest sürümü; önceki içerik değişmez; onay/çekim |
| M7 | Mutual tam iade/kısmi ödeme, karşı taraf kabulü, stale/expired proposal reddi ve client çekimi |
| M8 | Dispute açma + minimal atanmış resolver çözüm ekranı; yetkisiz erişim reddi; operatorFault ve slash/client credit readback |
| M9 | Minimum gerçek delivery timeout; claim -> fault review -> resolver slash -> client çekim ayrı receipt'ler; scheduler bağımlılığı yok |
| M10 | Open cancel/expiry ve review-timeout; D-1/D/D+1, izin verilmeyen state/deadline'da buton/tx guard |
| M11 | Dispute inactivity ve fault-review release 7 günlük sınırları local EVM; gerçek testnet beklemeleri ayrıca onay, beklemede etiketi |
| M12 | Free stake yatırma/çekme; reserved miktarı ve başkasının credit/stake'ini çekememe |
| M13 | UI hide != imza iptali; on-chain revoke/epoch sonrası imza reddi; yanlış domain/expired imza |
| M14 | Aynı jobId V1/V2 izolasyonu, refresh/crash/RPC/DB failure, double-click/pending tx; çift ödeme/broadcast yok |

### 9.2 Faz 1b manuel matris (henüz onaylı değil)

| Case | Manuel akış / beklenen kanıt |
|---|---|
| B1 | Private R2 dosya yükleme/checksum/scan, güvenli download, yanlış MIME/boyut ve ilgisiz kullanıcı erişimi reddi |
| B2 | Delivery extension request/grant/reject/revoke; süre dolmadan client rızası, pending talep saati durdurmaz, stale request reddi |
| B3 | Access report/recovery, hash/sürüm ve repair/review clocks; yanlış rol ve sınır anları; gerekirse recovery dispute |
| B4 | Tam hakem paneli: filtre/kuyruk/timeline, heartbeat/resume, özel içerik rol/audit kontrolü; 1a minimal çözüm regresyonu |

Her ödeme yolunda: Marketplace token balance = escrowed + creditsLiability + açıklanmış surplus; Vault balance = stakeLiability + surplus ve stakeLiability = toplam free + reserved. Bireysel credit toplamları liability'ye eşit. Başlangıç + dış girişler = son bakiyeler + gas + dış çıkışlar, underlying USDC bir kez sayılır. Kontrollü fixture'da surplus 0 beklenir; rastgele dış transfer içeriğinde `>=` muhasebesi ve surplus ayrımı gerekir. Kanıtlar testnet tx hash'leri, pinned block/readback ve screenshot'tur; wallet imza popup'ı receipt sayılmaz.

## 10. V2 house bot entegrasyonu (ayrı iş)

- Mevcut house `0x843dD6a6153D73d17dAA5D7fB0e8E3e250A76505`; kalıcı house flag'i kaldırılmaya çalışılmaz. House yalnız testJob + izinli testClient kombinasyonuyla atanabilir. Yusuf manuel wallet'ı bu izne sahipmiş gibi varsayılmaz; mevcut Hermes testClient house testi için ayrıdır.
- İlk adım salt-okuma adapter, offline fixture/local EVM ve dry-run. Yeni V2 worker ayrı service/process, ayrı state DB ve pair allowlist kullanır. V1 listener/ABI/env ve Railway'deki mevcut private key okunmaz, kopyalanmaz, değiştirilmez.
- House signing gereken canlı aşama bu planla açılmaz. Yusuf'un kontrolünde mevcut signer'ın V2'yi desteklemesi veya bağımsız, kullanıcı tarafından kurulacak signer tasarımı için ayrıca onay gerekir. Özel anahtar konuşmaya/env'ye aktarılmaz; signer iş/pair/chain/function/amount/expiry allowlist'iyle yalnız onaylı calldata imzalar. Teknik destek yoksa canlı house testi ertelenir; farklı EOA mevcut house diye etiketlenmez.
- EIP-712 apply -> client award bekleme -> gerçek delivery hash submit sırası. Fonlar, gas/paid-tool bütçesi, pending tx nonce ve restart reconciliation ayrı; bot kendi işini award/approve/resolve edemez.
- House'a ilişkin resolver fonksiyonları kontratta sınırlandırılmıştır; UI bunu aşmaya çalışmaz. House dispute/fault timeout güvenli çıkışları local testte kanıtlanmadan live write açılmaz.
- Kabul: V1 hâlâ aynı commit/write-mode; V2 başlangıç dry-run; yalnız izinli test job'lar; restart/double-send/fail-closed testleri; ayrı write-mode ve bütçe onayı. Railway key erişimi yoksa durum açıkça `V2 bot entegrasyonuna ertelendi` kalır.

## 11. Yusuf'un kararları ve önerilen varsayılanlar

| Karar | Önerilen varsayılan | Onay verilmeden yapılmayacak |
|---|---|---|
| DB / indexer | Kabul: local V2 PGlite, ortak pg arayüzü -> ayrı Railway V2 Postgres + anahtarsız worker; $10 hedef/$15 üst sınır | Docker/yükleyici yasak; Railway ve real-pg testleri ancak 1a yerel E2E sonrası ayrı onayla |
| Dosyalar | Private R2 Standard, 25 MB x 10 sınırı, büyük teslimler link; bucket/scanner bütçesi ayrıca | Bucket/key/sharing veya upload kurulumu |
| Faz sırası | Kabul: 1a -> ayrı 1b onayı -> 2 -> 3 | 1b/2 kapsamını 1a'ya çekme |
| Faz 1a başlatma | Yerel kodlama, PGlite migration/auth ve devam sırası onaylı | Docker/yükleyici, bulut kaynağı, V1 dosya değişikliği, anahtar/custody |
| Kaçırılan timeout | Yeni talimatla Job 5 tek manuel completion onaylı; her adımdan sonra korunum | Beklenmedik sonuçta tekrar deneme veya yeni cron |
| Manuel wallet resolver | Önce effective resolver'ı göster; bağımsız resolver tercih edilirse ayrıca owner-policy onayı | Manual client'ı whitelist/resolver map veya testClient yapma |
| House | Şimdilik deferred; anahtarsız dry-run ve ayrı signer kararı sonraki iş | Railway key okuma/kopyalama veya V1 bot değişikliği |

Push kullanıcı tarafından onaylandı: Yusuf panelden production branch `main` ve Preview env'lerinde gizli anahtar bulunmadığını doğruladı. Son talimat Faz 1a yerel commit'lerinin `feat/marketplace-v2` dalına push'unu da kapsar; preview build sonucu başarısızsa raporlanır, production/env değiştirilmez. `main` merge/production deploy onaylı değildir.
