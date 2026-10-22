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
| 3b. Wallet auth / ACL | Henüz yok | DB checkpoint sonrası sıradaki yerel görev | Yok |
| 4. Indexer + replay/reorg | Henüz yok | DB kapısına bağımlı | Yok |
| 5. API | Henüz yok | Önceki kapılara bağımlı | Yok |
| 6. Siyah arka planlı /v2 UI | Henüz yok | Önceki kapılara bağımlı | Yok |
| 7. Gerçek yerel E2E | Henüz yok | Tamamlanmadı; bulut kaynağı açma kapısı kapalı | Yok |

## Yerel DB kararı: PGlite (güncel)

- Son kullanıcı talimatıyla Docker kurulumu iptal edildi; hiçbir yükleyici çalıştırılmaz ve Windows güvenlik ilkesi değiştirilmez/aşılmaz.
- Faz 1a `@electric-sql/pglite` ile sürer. PGlite/pg tek bağlantı arayüzü ve aynı SQL migration dosyalarını kullanır; veri dizini repo dışındadır.
- Çok bağlantı, eşzamanlı yazma, advisory lock/indexer lease ve ilgili Postgres davranışları `[real-pg]` testleri olarak ayrılır; "gerçek Postgres bekliyor" gerekçesiyle atlanır, geçmiş sayılmaz. Test sayısı gerçek çalıştırma sonrası yazılır.
- Yeni onay Job 5 için tek withdraw-only denemeyi ve Faz 1a commit push'unu kapsar. Parent salt-okuma preflight: block 68542459, client credit 6,000,000 raw; latest=pending nonce `0x16`, bekleyen işlem görülmedi. Bu okuma henüz çekim gönderildiği anlamına gelmez; broadcast öncesi tekrar kontrol edilir.
- Migration/DB implementasyonu ve tek-kullanımlık çekim runner hazırlığı sürüyor; auth/ACL bundan sonra, indexer/API/UI/E2E kapıları korunur.

## Docker engeli (tarihsel, yeniden denenmeyecek)

- Mevcut WSL durumu: Ubuntu, varsayılan WSL 2.
- Resmî Docker Desktop Windows AMD64 4.95.0 installer indirildi: `C:/Users/wolfgang/Downloads/DockerDesktop-4.95.0-Installer.exe`.
- SHA-256: `73431db38491f770543880366228a23c993f84d1e8e045f56d83b8a98940cf76`; winget manifest'iyle aynı.
- Authenticode: Valid (Status 0), imzalayan Docker Inc.
- Onaylı per-user WSL2 kurulum denemesi CreateProcess aşamasında `WinError 1260` ile Windows grup ilkesi tarafından engellendi; exit 1. Installer çalıştırılamadı, Docker kurulmuş sayılmaz.
- İlke gevşetilmedi/aşılmadı, mevcut volume veya V1 env değiştirilmedi. Öneri: imzalı Docker installer için yetkili Windows uygulama iznini sağlamak. Otomatik reboot veya güvenlik ilkesi değişikliği yok.
- Docker yerine SQLite veya sahte persistence kullanılmayacak; gerçek PostgreSQL/E2E kanıtı üretilemeden başarılı raporlanmayacak.

## Onay sınırları

Faz 1a tamamen yerel. Railway/Neon/Supabase/R2 kaynağı, ücretli servis, Vercel/Railway env değişikliği, production deploy/main merge yok. Dosya upload, extension, access recovery, tam hakem paneli Faz 1b onayı bekler. Yusuf'un manuel preview cüzdan testi ayrı onay gerektirir.
