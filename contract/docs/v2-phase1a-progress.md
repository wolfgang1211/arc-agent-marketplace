# V2 Faz 1a yerel ilerleme

Bu kayıt kabul edilmiş çalışma sırasını izler. Bir testin geçmesi sonraki fazın veya canlı deployment'ın tamamlandığı anlamına gelmez. V1 kaynakları, layout/provider, ABI/adres ve bot değiştirilmeyecek.

## Doğrulanmış baseline

- Uygulama öncesi mevcut web suite: 169/169, exit 0.
- Uygulama öncesi `npm run build`: exit 0.
- Yeni route-scope testleri: gerçek RED (olmayan implementation import'u), ardından 4/4 GREEN; spec incelemesinin malformed-path bulgusuna ek RED (5 test: 4 pass, 1 fail) ve düzeltme sonrası 5/5 GREEN.
- Parent yeniden çalıştırma: ilk web `npm test` 173/173 ve `npm run build` exit 0; son düzeltmenin target suite'i parent tarafından 5/5 ve scoped hash'lerle yeniden doğrulandı. Son full web suite evidence: 174/174, 0 fail.
- Bu ilk adım namespace/composite identity policy'sidir. Henüz gerçek /v2 route veya render edilmiş UI kanıtı değildir.
- Spec yeniden incelemesi PASS ve kalite/güvenlik APPROVED: C1 (`U+0080–U+009F`) ve Unicode line/paragraph separator (`U+2028`/`U+2029`) bulgusu ek RED (4 pass, 1 fail), minimum regex düzeltmesi ve GREEN (5/5 hedefli, 174/174 toplam) ile kapandı. Parent hedefli suite'i tekrar çalıştırdı (5/5).
- Adım 1 yerel commit: `a53209d22765da9f9224b364ce0d1c6e017608f2`. Yalnız iki V2 helper/test dosyası commit edildi; push yapılmadı ve `main` değişmedi.
- Adım 2 ilk aday: 7 hedefli web / 181 toplam web testi, 1 yerel Hardhat testi ve build geçti; ancak bağımsız spec incelemesi FAIL verdi. Bu yeşil sonuçlar kabul kanıtı değildir. Zorunlu runtime/immutable attestation, tam 53 alanlı Job ve dört-slot MutualRequest çözümü, uint128 hassasiyeti, strict bool/enum/storage kontrolleri, nonce/preflight okumaları ve gerçek imza interoperability kapsamı eksik bulundu. Parent ayrıca süresi dolmuş application ve uint64 taşmasının kabulünü yerelde yeniden üretti.
- Adım 2 son kabul: terms/application/imza ve reader kapsamlarında bağımsız spec PASS ve kalite PASS/APPROVED. Gerçek RED regresyonları sonrası tam 53 alanlı canonical Job çözümü, dört-slot/nonzero MutualRequest, hassas uint128, tüm immutable değerleri, pinned-block/reorg guard'ları, client policy/fallback ve account/nonce okumaları doğrulandı. Gerçek yerel EOA award, ERC-1271 magic/wrong-magic ve revoked application senaryoları geçti.
- Parent son doğrulaması: 184/184 web testi; `npm run build` exit 0; reader 7 + application interoperability 2 + timeout harness 4 olmak üzere birlikte çalıştırılmış Hardhat suite 13/13, exit 0. Bu yalnız yerel canonical pair/fixture kanıtıdır, yeni canlı işlem veya gerçek /v2 UI/API/E2E kanıtı değildir.
- Adım 2 checkpoint kapsamı: 10 V2 module/test dosyası ve bu ilerleme kaydı. Yalnız açık allowlist stage edilir; `.hermes/`, geçici loglar, artifacts/cache ve diğer untracked dosyalar hariç tutulur. Adım 3 Docker engeli nedeniyle başlamadı.
- Job 5 korunum yürütücüsü ayrı scope'ta spec/kalite onayı ve 4/4 yerel test sonrası `6f379335def4d3b871bc8bb8fbfd86caf4879ded` commit'ine alındı. Bu yalnız yerel harness düzeltmesidir; durdurulmuş canlı çekim yeniden denenmedi ve Job 5 tamamlanmış sayılmadı.

| Adım | Doğrulanmış test sayısı | Durum | Yerel commit |
|---|---:|---|---|
| 1. V1 baseline / V2 route izolasyon policy | 169 baseline; 5 yeni; 174 toplam | GREEN; spec PASS; kalite APPROVED | `a53209d22765da9f9224b364ce0d1c6e017608f2` |
| 2. Read adapter + hash/imza fixtures | 184 toplam web; 9 yeni yerel Hardhat; harness ile 13/13 | GREEN; spec PASS; kalite onaylı | `206a6016cd5abc668483286d5f996743abef176e` |
| 3a. PGlite/pg ortak DB + migration | 9 PGlite geçti; 6 `[real-pg]` atlandı; toplam web 193 geçti / 6 atlandı; build exit 0 | Spec PASS / kalite APPROVED; gerçek Postgres doğrulanmadı | Bu kayıtla aynı DB checkpoint |
| 3b. Wallet auth / ACL | 10 hedefli (7 auth + 3 ACL); toplam web 203 geçti / 6 real-pg atlandı; build exit 0 | Spec PASS; kalite APPROVED; kuyrukta expiry regresyonu dahil | Bu kayıtla aynı auth checkpoint |
| 4a. Fork-aware indexer kayıt katmanı + migration 002 | 34 hedefli gerçek PGlite geçti; toplam web 228 geçti / 6 real-pg atlandı; build exit 0 | Spec PASS / kalite APPROVED; parent hedefli 34/34 yeniden doğruladı | Bu kayıtla aynı indexer-store checkpoint |
| 4b1. Canonical event decoder + packed-field fixtures | 52 hedefli geçti; toplam web 280 geçti / 6 real-pg atlandı; build exit 0 | Spec PASS / kalite APPROVED; ethers/viem ABI interoperability, EVM receipt kanıtı değil | Bu kayıtla aynı decoder checkpoint |
| 4b2. Anahtarsız RPC indexer + projection replay/reorg | Henüz yok | Kayıt ve decoder katmanları kabul edildi; sıradaki yerel görev | Yok |
| 5. API | Henüz yok | Önceki kapılara bağımlı | Yok |
| 6. Siyah arka planlı /v2 UI | Henüz yok | Önceki kapılara bağımlı | Yok |
| 7. Gerçek yerel E2E | Henüz yok | Tamamlanmadı; bulut kaynağı açma kapısı kapalı | Yok |

## Yerel DB kararı: PGlite (güncel)

- Son kullanıcı talimatıyla Docker kurulumu iptal edildi; hiçbir yükleyici çalıştırılmaz ve Windows güvenlik ilkesi değiştirilmez/aşılmaz.
- Faz 1a `@electric-sql/pglite` ile sürer. PGlite/pg tek bağlantı arayüzü ve aynı SQL migration dosyalarını kullanır; veri dizini repo dışındadır.
- Çok bağlantı, eşzamanlı yazma, advisory lock/indexer lease ve ilgili Postgres davranışları `[real-pg]` testleri olarak ayrılır; "gerçek Postgres bekliyor" gerekçesiyle atlanır, geçmiş sayılmaz. Test sayısı gerçek çalıştırma sonrası yazılır.
- Yeni onay Job 5 için tek withdraw-only denemeyi ve Faz 1a commit push'unu kapsar. Parent salt-okuma preflight: block 68542459, client credit 6,000,000 raw; latest=pending nonce `0x16`, bekleyen işlem görülmedi. Bu okuma henüz çekim gönderildiği anlamına gelmez; broadcast öncesi tekrar kontrol edilir.
- Job 5 son durum: yeni onaylı withdraw-only runner spec/güvenlik GO, 14/14 yerel test ve gerçek keyless preflight sonrası **bir kez** broadcast edildi. Tx `0x9426285500c04fb4b77ff9d3907e0977d1ec7d973f1e4035df44db177342c15c`, receipt block68548436. Gross 6 USDC; gas0.00146055, net bakiye artışı5.99853945 USDC; credit0. Parent 55receipt/full-run conservation ve runtime'ları block68548660'ta tekrar doğruladı. Market0=esc0+credit0; Vault5=free5+res0; aktif0. Önceki stop kaydı JSON geçmişinde korunur; bir daha çekim gönderilmez.
- DB/migration checkpoint `11a43a92cd50d2f7ffa087cad958c4a6c1927c1c` push sonrası GitHub'dan doğrulandı. Auth/session/ACL artık spec PASS + kalite APPROVED: sabit Arc/pair/origin bağları, kanonik giriş mesajı, tek-kullanımlık nonce, hashlenmiş session, CSRF/cookie/logout ve client/operator/snapshot resolver ACL'leri doğrulandı. DB transaction kuyruğunda süresi dolan challenge gerçek RED/GREEN ile kapatıldı; consumed_at NULL ve session sayısı 0 kalır. Bu auth katmanında gerçek EOA imzaları test edildi; gerçek ERC-1271 auth kanıtı ve çok bağlantılı PostgreSQL testi iddia edilmez. Indexer/API/UI/E2E henüz tamamlanmadı.

## Docker engeli (tarihsel, yeniden denenmeyecek)

- Mevcut WSL durumu: Ubuntu, varsayılan WSL 2.
- Resmî Docker Desktop Windows AMD64 4.95.0 installer indirildi: `C:/Users/wolfgang/Downloads/DockerDesktop-4.95.0-Installer.exe`.
- SHA-256: `73431db38491f770543880366228a23c993f84d1e8e045f56d83b8a98940cf76`; winget manifest'iyle aynı.
- Authenticode: Valid (Status 0), imzalayan Docker Inc.
- Onaylı per-user WSL2 kurulum denemesi CreateProcess aşamasında `WinError 1260` ile Windows grup ilkesi tarafından engellendi; exit 1. Installer çalıştırılamadı, Docker kurulmuş sayılmaz.
- İlke gevşetilmedi/aşılmadı, mevcut volume veya V1 env değiştirilmedi. Öneri: imzalı Docker installer için yetkili Windows uygulama iznini sağlamak. Otomatik reboot veya güvenlik ilkesi değişikliği yok.
- Docker yerine SQLite veya sahte persistence kullanılmayacak; gerçek PostgreSQL/E2E kanıtı üretilemeden başarılı raporlanmayacak.

## Indexer kayıt katmanı kabulü (4a)

- `001-core.sql` değişmedi. Ortak PGlite/pg `002-indexer.sql`, fork-aware blok/log tabloları ve tam uint256 stateVersion alanlarını ekler; eski belirsiz log tabloları korunur, emitter/canonical kimliği uydurulmaz. Bekleyen migration'lar tek atomic transaction ve ayrı checksum kayıtlarıyla uygulanır.
- Header/event/cursor/canonical flag atomikliği, doğrulanmış ortak ata ve 32 blok reorg sınırı, orphan retention/reactivation, crash rollback, restart/replay, boş-log aralıkları, stale cursor ve off-chain kayıt korunumu gerçek PGlite ile doğrulandı.
- Deep snapshot/TOCTOU, cap-before-access, küçük/büyük harf hash kimliği, secret-safe proxy hataları ve kök/iç içe non-finite JSON reddi gerçek RED/GREEN regresyonlarıyla kapandı. Parent son dört hedefli dosyayı kendisi çalıştırdı: 34/34, exit 0; tam web 228 geçti / 6 real-pg atlandı; build exit 0.
- Bu kabul yalnız persistence/migration katmanıdır. Canlı RPC polling, ABI decode ve event-derived projection/replay henüz yok; API/UI/E2E tamamlanmadı. Çok bağlantılı PostgreSQL ve lease doğrulaması iddia edilmez.

## Canonical event decoder kabulü (4b1)

- Deployed final2 ABI/build-info ile 34 Marketplace + 8 Vault = 42 event doğrulandı. Build-info SHA-256 `28709ec142c70bd2f7f7c142a481db5d596da8f433a4830fe30173067d8c39ca`; pair/runtime pin'leri mevcut read manifest ve deployment kanıtıyla eşleşir.
- Mevcut Solidity kaynak dosyası `OperatorFaultDeclared` bildirir, ancak dağıtılmış canonical artifact ABI'sinde yoktur. Decoder yalnız canonical artifact'i izler; yeni ABI/event uydurulmadı ve kontratlar değiştirilmedi. Yeni compile/deploy yapılmış sayılmaz.
- Ethers event encoding / viem strict decoding, tam decode/re-encode eşdeğerliği, packed collateralPolicy/clockPack/counters bit ofsetleri, uint256 precision ve 42 event fixture doğrulandı. Bu ABI interoperability kanıtıdır, gerçek Solidity/EVM receipt çalıştırması değildir.
- Sabit `5042002n` context/emitter bağları, descriptor-safe snapshot, topic cap-before-access, canonical array keys, hash/metadata/hexdata sınırları ve unknown/ERC-20 log reddi RED/GREEN ile doğrulandı. Spec PASS / kalite APPROVED; parent tam web 280 geçti / 6 real-pg atlandı; build exit 0.
- RPC polling, safe/finalized head, projection ve tam restart/reorg pipeline sıradaki 4b2 adımıdır; henüz tamamlanmış sayılmaz.

## Onay sınırları

Faz 1a tamamen yerel. Railway/Neon/Supabase/R2 kaynağı, ücretli servis, Vercel/Railway env değişikliği, production deploy/main merge yok. Dosya upload, extension, access recovery, tam hakem paneli Faz 1b onayı bekler. Yusuf'un manuel preview cüzdan testi ayrı onay gerektirir.
