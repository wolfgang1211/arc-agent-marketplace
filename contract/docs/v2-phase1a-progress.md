# V2 Faz 1a yerel ilerleme

> **GÜNCEL KABUL KAPISI:** Eski `artifacts-v2-final2` ABI kaynağı, runtime ile eşleşen `artifacts-v2-runs50` kaynakları ve portable bytecode/ABI kanıtıyla düzeltildi. Kapasite=0 ve strict uint bulguları RED→GREEN regresyonlarla kapatıldı; parent private API **15/15** doğruladı. Güncel tam seri web suite **476 geçti, 0 hata, 6 real-pg ayrı**. Bağımsız SPEC PASS ve QUALITY APPROVED; parent 45-file kaynak fingerprint'ini ve değişmeyen catchall route hash'ini eşleştirdi. Güncel build **exit 0**; Step5 API yerel kabul kapıları tamamlandı. Step6 siyah `/v2` UI kodu ve yerel HTTP/form fixture entegrasyonu doğrulandı; SPEC PASS ve delta QUALITY APPROVED. UI'nin görsel/tarayıcı kabulü henüz tamamlanmadı. Checkpoint geçmişi korunur; güncel production build 127.0.0.1:3102'de yeniden başlatıldı ve beş route HTTP 200 doğrulandı. Reader gerçek durumda unavailable/stale; aksiyonlar fail-closed. Desktop preview read bridge yanıt vermedi, masaüstü aracı görünür Hermes penceresi bulamadı; screenshots/browser E2E blocker'ı açık.

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
| 4b2. Anahtarsız RPC indexer + projection replay/reorg | 402 geçti, 0 hata, 6 real-pg atlandı; seri tam web suite; build exit 0 | Yerel kabul; spec PASS / kalite APPROVED; yalnız reader salt-okuma canlı attestation ayrıca doğrulandı | `7f7926934fd208c80a60a4f1cef559b7a883b83f` |
| 5. API + runtime-bound ABI provenance düzeltmesi | Parent güncel tam seri suite: 450 geçti, 0 hata, 6 real-pg ayrı; private API 15/15; build exit 0 | Yerel kabul; SPEC PASS; QUALITY APPROVED; unsigned preflight, transaction yok | Henüz commit/push yok |
| 6. Siyah arka planlı /v2 UI | Parent 29/29 hedefli; güncel tam seri web suite 476 geçti, 0 hata, 6 real-pg ayrı; build exit 0; beş ana route HTTP 200 | Son iki kalite bulgusu da kapatıldı: parent private/UI/HTTP-form suite 33/33 geçti; SPEC PASS ve delta QUALITY APPROVED, parent beş-dosya fingerprint eşleşmesini doğruladı. Güncel tam suite/build tamamlandı ve güncel build ile V2 sunucusu yeniden başlatıldı. Masaüstü/mobil screenshot ve gerçek tarayıcı E2E kapıları açık; görünür Hermes penceresi bulunamadığı için görsel kanıt henüz yok. Önizleme son tamamlanan build ile 127.0.0.1:3102 üzerinde çalışıyor; UI yerel kabulü henüz yok | Yok |
| 7. Yerel E2E | Parent gerçek loopback HTTP + React form + PGlite suite 6/6 geçti; ephemeral EOA, cookie/CSRF, draft replay, award ABI, registration ve revision 1→2 DB readback | Offline fixture entegrasyon kanıtı; canlı RPC/EVM, Yusuf cüzdanı veya gerçek tarayıcı E2E kanıtı değildir. Tarayıcı/responsive screenshot kapıları açık; bulut kapısı kapalı | Yok |

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

## Event decoder ilk kabulü (4b1, tarihsel; ABI provenance iddiası geri çekildi)

- İlk fixture suite'i final2 ABI/build-info ile 34 Marketplace + 8 Vault = 42 event doğruladı. Build-info SHA-256 `28709ec142c70bd2f7f7c142a481db5d596da8f433a4830fe30173067d8c39ca`. Bunun dağıtılmış runtime ile eşleştiği yönündeki önceki iddia **yanlıştı ve geri çekildi**. Güncel Step5 kanıtı gerçek runs50 pair'ini ve 44-event envanterini doğrular.
- Eski artifact'te `OperatorFaultDeclared` olmaması bir kaynak-drift kanıtı değildi; yanlış ABI/build seçilmişti. Güncel runtime-matched ABI hem `OperatorFaultDeclared` hem `OwnershipTransferStarted` içerir; web event manifesti buna göre düzeltildi. Kontrat değiştirilmedi; compile/deploy yapılmadı.
- Ethers event encoding / viem strict decoding, tam decode/re-encode eşdeğerliği, packed collateralPolicy/clockPack/counters bit ofsetleri, uint256 precision ve 42 event fixture doğrulandı. Bu ABI interoperability kanıtıdır, gerçek Solidity/EVM receipt çalıştırması değildir.
- Sabit `5042002n` context/emitter bağları, descriptor-safe snapshot, topic cap-before-access, canonical array keys, hash/metadata/hexdata sınırları ve unknown/ERC-20 log reddi RED/GREEN ile doğrulandı. Spec PASS / kalite APPROVED; parent tam web 280 geçti / 6 real-pg atlandı; build exit 0.
- RPC polling, safe/finalized head, projection ve tam restart/reorg pipeline sıradaki 4b2 adımıdır; henüz tamamlanmış sayılmaz.

## Anahtarsız indexer / projection kabulü (4b2)

- Kullanıcı yerel kabulü ve yalnız Step4B2 kapsamlı commit/push işlemini onayladı. 402 geçti, 0 hata, 6 real-pg atlandı; `node --test --test-concurrency=1 test/*.test.mjs` ve `npm run build` exit 0. Kanıtlar: `C:/Users/wolfgang/AppData/Local/hermes/cache/scratch/v2-step4b2-final-h6e9k9rf/results.json`, `tests.log`, `build.log`.
- 42 canonical event hazırlama matrisi; tam 53 alanlı Job; gerçek reader account/capacity/credit ve job başına application nonce kanıtı; zorunlu global/client policy. Eksik taraf, bakiye veya policy sıfır/default uydurularak yazılmaz; protocol account version yoksa NULL korunur.
- Anahtarsız, salt-okuma RPC allowlist; zorunlu default runtime/source/immutable attestation; verified deployment anchor; bounded batch/retry/timeout; finality ve stale/gap health. Hata metinleri/provider getter'ları health'e sızdırılmaz.
- Header transaction hash dizisi açık, en fazla 10.000 elemanlı, dense own-data ve frozen snapshot olmalıdır. Eksik/bozuk transaction metadata veya 256-byte bloom reddedilir. Sıfır transaction için tam sıfır bloom gerekir; oversized diziler eleman descriptor'ları okunmadan reddedilir.
- Receipt/query log eşitliği tüm block/tx/index/topic/data ve açık `removed === false` bağlarını kapsar; Ethereum bloom bağımsız fixture ile 11-bit maske üzerinden doğrulandı. Exact depth-32 reorg kabulü, depth-33 mutation olmadan ret, orphan retention, atomic projection/cursor replay ve off-chain kayıt korunumu yerelde test edildi.
- Canlı reader salt-okuma attestation: chain 5042002, blok 68582872, 25 okuma, runtime/immutable pin eşleşmesi, gönderilen transaction 0. Bu canlı indexer E2E veya gerçek PostgreSQL kanıtı değildir.
- Tam spec ve kalite incelemeleri onaylandı. Son `removed` guard ek savunmadır: önceki decoder aynı kötü değerleri zaten reddettiğinden yeni RED/bypass kanıtı olarak sunulmaz.
- Bundan sonraki sıra: API → siyah `/v2` UI → yerel E2E. Masaüstü/mobil beş ana ekranın görüntüsü UI adımında alınır. Railway V2 Postgres/indexer ve real-pg yerel E2E sonrası ayrı onay; Yusuf'un gerçek cüzdanıyla manuel preview testi de ayrı onay gerektirir.

## API yerel runtime kanıtı (Step5, kabul henüz yok)

- Parent tüm yeni API dosyalarını seri çalıştırdı: 31/31, exit 0. Bu sayı sonraki millisecond regresyon testinden öncedir; tam web suite sonucu değildir.
- Gerçek Next.js HTTP login denemesi `CHALLENGE_BINDING` hatası verdi. Kök neden: PGlite/pg Date döndürürken `Date.parse(Date)` millisecond kısmını kaybediyordu; eski test clock'ları tam saniye olduğundan bunu örtüyordu. Yeni `.123Z` regresyonu önce 1 FAIL, `Date.getTime()` düzeltmesinden sonra HTTP auth + temel auth birlikte 16/16 PASS.
- Sonrasında gerçek `http://127.0.0.1:3102` üzerinde ephemeral test EOA ile challenge → verify (HTTP 200) → cookie/session → CSRF logout → anonymous session geçti. Yusuf'un cüzdanı kullanılmadı; anahtar yalnız bellekteydi, yazdırılmadı/kaydedilmedi; gönderilen transaction 0. Auth doğrulayıcısı Arc'a salt-okuma attestation yaptı; bu tam marketplace E2E değildir.
- Next.js route native Node import kullanır: PGlite WASM/SQL dosyalarının webpack URL dönüşümünü V1 build ayarını değiştirmeden önler. Sabit local Host doğrulanır; Next'in internal URL hostname'i sabit origin'e yalnız path/query/header/body korunarak uyarlanır. Deploy/production paketleme kanıtı değildir.
- İş taslağı/preflight canonical ABI/terms helper adayı ve testleri eklendi; API spec incelemesi FAIL: account preflight route'u eksik/job rolüne yanlış bağlı, award admission/stake kontrolleri eksik, draft identity ham caller terms üzerinden hesaplanıyor, ABI seçimi tam signature'a bağlı değil. Mevcut iki action testi tüm advertised lifecycle yüzeyini kanıtlamıyor. Düzeltme ve on aksiyonun davranış matrisi sürüyor; UI kapısı henüz açılmadı.

## ABI provenance düzeltmesi: salt-okuma kök neden kanıtı

- Daha önce kullanılan `artifacts-v2-final2/build-info/485d4238c6e0b10cdff6a496e5894686.json` SHA-256 `28709ec142c70bd2f7f7c142a481db5d596da8f433a4830fe30173067d8c39ca` Marketplace runtime boyutu **23118 byte**, kendi immutable referansları sıfırlanmış hash'i `0x6b4e076706147e23409ed83a6414723ab7926dfa0fd16b1e46f3accde8b77afe`. Dağıtılmış pin ile **eşleşmez**. Bu build'in ABI'sini canonical/deployed diye adlandıran önceki kayıtlar hatalıdır.
- Parent tüm yerel `artifacts-v2*/build-info` adaylarını kendi immutable referanslarıyla normalize ederek taradı. Eşleşen Marketplace: `artifacts-v2-runs50/build-info/aa06f923b29a016fd50e070a2e74426f.json`, SHA-256 `4753ec82c34e978ab8d57e5b9a84686d6ed97bdb2e19ef503c4999a94bb6ea31`, **23908 byte**, normalized hash `0x7d24e8ddcdcb8b42aa93c453c363ad0b25f259e38362d5a11df3d5a87ed45166`.
- Taze Arc salt-okuma attestation: blok **68942712**, chain **5042002**, 25 okuma, transaction **0**. Marketplace raw hash `0xb0c95b7be8af29f83ccda60bbf4f7503fb93e505c8cf425fd3e5a3bb6b4acd2b`, normalized hash yukarıdaki runs50 ile eşleşir. Mevcut runtime/read pin'leri doğru; yanlış olan ABI kaynak seçimi.
- Eşleşen ABI'de `resolveDispute(uint256,uint256,bool,bytes32,bytes32,uint256)` vardır. Marketplace event sayısı 36'dır; eski 34-event manifest'te `OperatorFaultDeclared` ve `OwnershipTransferStarted` eksiktir. Eski `OperatorFaultDeclared` kaynak-drift açıklaması geri çekilir. Bağımsız denetim ve parent readback Vault için `artifacts-v2-runs50/build-info/eaa02ef53ac5f224ef8259f9c7e6e483.json` SHA-256 `7b906c45043419597eaa714d996cc5ffb5e9df1b5c21bf48f822bdf432817d7f`, 4854 byte ve mevcut normalized pin eşleşmesini doğruladı. Storage manifest/read adapter'ın jobs=11 ve diğer slotları doğru build ile uyumlu; bunlar değişmeyecek. Eski final2 jobs=10'dur. Event/preflight manifestleri web-only düzeltme ve portable ABI/runtime proof testleriyle yeniden üretiliyor.
- Yeni deploy/kontrat edit'i, git reset/history rewrite veya ek zincir işlemi yapılmayacak. Web ABI/decoder/preflight provenance düzeltmesi ve buna bağlı test/review kapıları tamamlanmadan UI/API kabul edilmeyecek. Lokal Next preview bu sırada durduruldu.

## Onay sınırları

Faz 1a tamamen yerel. Railway/Neon/Supabase/R2 kaynağı, ücretli servis, Vercel/Railway env değişikliği, production deploy/main merge yok. Dosya upload, extension, access recovery, tam hakem paneli Faz 1b onayı bekler. Yusuf'un manuel preview cüzdan testi ayrı onay gerektirir.
