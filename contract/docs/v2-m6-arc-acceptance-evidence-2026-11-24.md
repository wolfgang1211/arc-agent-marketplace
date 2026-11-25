# M6 — Revizyon akışı kabul kanıtı (Arc Testnet, gerçek cüzdanlar)

**Tarih:** 23–24 Kasım 2026 · **Job:** #8 · **Sonuç:** Kabul edildi (Yusuf, elle test)

## Taraflar ve iş

| Alan | Değer |
|---|---|
| Marketplace | `0xFA156B7A5205B123c8a22A807ba98405e36130f1` |
| Client | `0x460EBe282Fb0e42B4d682a7f9EF408302417F780` (Rabby) |
| Operator | `0xD632648b649bD09198047388d150fF408165CC29` (Rabby) |
| Resolver (snapshot) | `0xf5e14962e46F80fAA40570bD86BccE83AA6626fF` |
| İş | "Design a simple logo for an indie game studio" · Design · 1 USDC · revizyon limiti 2 |

## Akış ve gözlenen durumlar

| Adım | Rol | Sonuç (canonical okuma) |
|---|---|---|
| İş açma + atama | Client | Job #8 InProgress, stateVersion 2 |
| İlk teslim (v1, `https://example.com/logo-v1`) | Operator | Submitted, stateVersion 3, deliveryVersion 1; manifest hash = zincir deliveryHash `0xd3f1ad4b…a3914` |
| Revizyon isteği | Client | RevisionPending, stateVersion 4; düzeltme son tarihi 2026-11-24 20:41:18 UTC |
| Notun operatöre görünmesi | Operator | Not, kriter, kalan hak (1), son tarih görüldü; "Verified against on-chain hashes" |
| Yeni sürüm (v2, `https://example.com/logo-v2`) | Operator | Submitted, stateVersion 5; v1 değişmeden "Other stored versions" altında |
| Onay | Client | Completed, stateVersion 6 · tx `0x96a05202aadb14334b349d0df321c740fcf77df51bd89655bffe0674bf05895e` |
| Ödeme çekimi | Operator | 0,95 USDC (1 USDC − %5 ücret) · tx `0x8126c691e3545b3120948f7754e499ec1ed92d30a581747a60313de07e545e89` (explorer: Success, blok 73759226) |

## Tüm Job #8 işlemleri (indexer kanonik olaylarından)

| Olay adı | Blok | Tx hash |
|---|---:|---|
| JobPosted | 73580683 | `0xab0fc61f1a80f793fb180132868ad16527118a982aa4a37971498add7857815c` |
| JobTerms | 73580683 | `0xab0fc61f1a80f793fb180132868ad16527118a982aa4a37971498add7857815c` |
| StakeReserved | 73582896 | `0x5257f6a4fa41874c75cbb69441ae3bd52d49d0d4531e7f15f74d20affd51bf84` |
| JobAwarded | 73582896 | `0x5257f6a4fa41874c75cbb69441ae3bd52d49d0d4531e7f15f74d20affd51bf84` |
| JobState | 73582896 | `0x5257f6a4fa41874c75cbb69441ae3bd52d49d0d4531e7f15f74d20affd51bf84` |
| DeliverySubmitted | 73594342 | `0xc85f721d1c36aa85f544235a333b398239eb091d84497a7bcda14ccc1e30f1ca` |
| JobState | 73594342 | `0xc85f721d1c36aa85f544235a333b398239eb091d84497a7bcda14ccc1e30f1ca` |
| RevisionRequested | 73756226 | `0x4704ac889c626443ef4ada16390a3461b28bbffc09af55fc0c32161a8f9e93fc` |
| JobState | 73756226 | `0x4704ac889c626443ef4ada16390a3461b28bbffc09af55fc0c32161a8f9e93fc` |
| RevisionSubmitted | 73756631 | `0x4bd95d88a8252e03535b9fd8d38c496dac858ee0405474f5f53d4d2ba21f30ec` |
| JobState | 73756631 | `0x4bd95d88a8252e03535b9fd8d38c496dac858ee0405474f5f53d4d2ba21f30ec` |
| StakeReleased | 73757369 | `0x96a05202aadb14334b349d0df321c740fcf77df51bd89655bffe0674bf05895e` |
| Settled | 73757369 | `0x96a05202aadb14334b349d0df321c740fcf77df51bd89655bffe0674bf05895e` |
| JobState | 73757369 | `0x96a05202aadb14334b349d0df321c740fcf77df51bd89655bffe0674bf05895e` |

## Testte bulunan ve düzeltilen sorunlar

1. Paralel private okumalar public RPC rate limit'ine takılıyordu (503/500) → eşzamanlı RPC sınırı + rate-limit tekrarı (`ef43efb`).
2. Başarılı işlem kayıtları tarayıcıda kalıp aynı aksiyonu süresiz kilitliyordu → receipt başarısından sonra kayıt `mined` (kilitlemez); deneme hakkı biten eski kayıtlar canonical tx doğrulaması + başarılı receipt ile temizlenir.
3. İşlem sonrası indexer gecikmesinde private kartlar hata veriyordu → yalnız private job GET'lerinde 503 STALE_DATA/READER_UNAVAILABLE için kısa tekrar.
4. Başarılı çekimden sonra "doğrulanamadı" uyarısı → receipt başarılıysa "zincirde onaylandı, sayfa güncelleniyor" (`confirmed-sync-pending`).
5. Karşılanmış revizyon notu "hash mismatch" görünüyordu → kanonik `RevisionRequested` olayıyla eşleşen ve sonrasında yeni teslim olan not "fulfilled".
6. `localhost` ile girişte private okumalar ORIGIN_MISMATCH → arayüz `127.0.0.1`'e yönlendirir.
7. Teslim/dispute olmayan veya terminal işte boş/hatalı "Decision review" kartı → yalnız karar varsa gösterilir.
8. Görünüm: başvuru listesi taşması ve ham kimlik, atanmamış işte mutual formu, ham alan adları/ISO tarih, eski sürüm açıklaması.

Elle temizlenen tarayıcı kayıtları (zincirde başarılı oldukları doğrulandıktan sonra): operator `depositStake` (M4, `0x2118eaf7…e5c8`), operator `withdrawCredit` (M5, `0xc14021a3…4cc2`, 18 Kasım), client `withdrawCredit` (Job #6 iadesi; client credit 0).
