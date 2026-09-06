> **GÜNCELLEME 3 — Adım 0.7 GERİ ÇEKİLDİ. Kod tarafında açık blocker kalmadı.**

## Adım 0.7 — geri çekildi (kayıt olarak duruyor, koşul değil)

Adım 0.7'de "retry yolunda gas rezervi yok, deterministik revert cüzdanı
~7,9 saatte boşaltır" demiştim. **Yanlıştı.** `chain.mjs`'i okumadan
`runtime.mjs` üzerinden akıl yürüttüm.

`execute()` her yazma işleminde önce `publicClient.simulateContract(...)`
çağırıyor, `walletClient.writeContract(request)` ondan sonra geliyor.
Deterministik olarak revert edecek bir `submitDeliverable` simülasyonda
yakalanır ve **hiç broadcast edilmez** — harcanan gas sıfır, yapılan şey
ücretsiz bir `eth_call`. Yani retry döngüsü para değil, sadece RPC çağrısı
tüketiyor.

Dahası döngü kendi kendini sınırlıyor: bir işlemin zincirde revert etmesi
için simülasyondan sonra state'in değişmiş olması gerekir (örneğin müşteri
`claimTimeout` çağırdı). O state değişikliği gerçekleştiği anda **bir sonraki
simülasyon da başarısız olur**. Yani en fazla bir tane ücretli revert olur,
döngü olmaz.

Kalan gas endişesi de yok: kabul yolunda `GAS_RESERVE_WEI` = 0,02 USDC şartı
var, işlem başına ölçülen maliyet ~0,0028 USDC. Kabul anında ayrılan rezerv
`submitDeliverable` + `claimTimeout` için gereken iki işlemin yaklaşık üç
katını karşılıyor.

**Bu bölüm bir koşul değildir.** Kayıt olarak duruyor ki aynı iddia tekrar
gündeme gelmesin.

## Kontrat deadline semantiği — bu kartın kapsamı dışında

`submitDeliverable`'ın deadline sonrası da çağrılabiliyor olması gerçek bir
protokol semantiği, ama Adım 1'in blocker'ı değil. `submitDeliverable` ve
`claimTimeout` aynı job status üzerinde yarışıyor; hangisi önce mined olursa
diğeri revert ediyor. Çift finalizasyon yok, kimse iki kez ödenmiyor. Müşteri
deadline geçtiği anda `claimTimeout` çağırma hakkına sahip, yani geç teslimatı
kabul edip etmemek müşterinin elinde.

Kontrat immutable ve deploy edilmiş durumda; buna dokunmak yeni adres, yeni
attestation, site ve bot tarafında adres taşıma demek. "Adım 1'de yalnız
`BOT_LIVE_WRITES` değişir" şartını ihlal eder.

**Ama mainnet kartına yazılacak.** Mainnet kontratı henüz deploy edilmedi,
yani orada bu karar hâlâ bedelsiz. İş başına ödül tavanı kararının yanına,
aynı listeye.

---

> **GÜNCELLEME — Adım 0 geçti, kapı hâlâ açılmıyor. Yeni ve tek koşul aşağıda.**
> Bu bölüm Adım 0'ın yerine geçmez, ona eklenir; Adım 1 bu koşul karşılanmadan
> uygulanmaz.

## Adım 0.6 — Slash bütçesi teslim süresine bağlanmalı (kapı öncesi, bağlayıcı)

`runtime.mjs` okundu. İki tespit var; biri lehimize, biri değil.

**Lehimize:** `prepareJob` → `assertPreparedArtifact` → `acceptJob` sırası
doğru. Özet API'si veya Pinata ölüyse `prepareJob` fırlatır, iş `rejected`
olur ve `acceptJob` hiç çağrılmaz. Yani ölü kimlik bilgisi stake'i yakmaz —
çünkü kimlik bilgileri paranın riske girdiği andan **önce** kullanılıyor.
Bu, açılışta preflight koşmaktan daha iyi bir koruma; kontrol kullanım anında
yapılıyor.

**Lehimize değil:** `acceptJob`'dan sonra `MAX_POST_ACCEPT_ATTEMPTS = 3`.
`POLL_INTERVAL_MS = 8000` ile bu, yaklaşık **24 saniyelik** bir tolerans
demek. Üçüncü başarısız `submitDeliverable`'dan sonra `markTerminalFailure`
çağrılıyor, oradan geri dönüş yolu yok: `handleOwnedInProgress` artık yalnız
`deliveryDeadline`'ı bekleyip `claimTimeout` çağırıyor ve stake yanıyor.
`submitAttempts` state'te kalıcı, yani restart'lar arasında da birikiyor.

Oysa `DELIVERY_TIMEOUT` **86.400 saniye**. Kontrat bir gün teslim hakkı
veriyor; bot bu hakkın on binde üçünü kullanıp kendi stake'ini kendi eliyle
yakıyor. 30 saniyelik bir RPC kesintisi 10 USDC'ye mal olur — ve bundan
öğrenilecek hiçbir şey yoktur.

### Yazılması gereken özellik

> Bot, kontrat hâlâ teslimata izin verirken kendi stake'ini imha etmemeli.

`terminal_failure` kararı sabit bir deneme sayısının değil, **kalan teslim
süresinin ve hatanın kalıcı olup olmadığının** fonksiyonu olmalı. Kalıcı hata
(`invalid_prepared_artifact` gibi, zaten `permanent: true` taşıyor) hemen
terminal olabilir; geçici hata (RPC, ağ, nonce) deadline yaklaşana kadar
denenmeli.

Çözümü ben yazmıyorum. Kararı sen ver, ama:

1. Yeni davranışı **çalışan bir testle** yaz. Test, geçici hata veren bir
   `submitDeliverable` ile botun deadline'dan çok önce `terminal_failure`'a
   düşmediğini göstermeli.
2. Kalıcı hatanın hâlâ hemen terminal olduğunu ayrı bir testle koru —
   sonsuza kadar deneyen bir bot da doğru değil.
3. Backoff ekliyorsan üst sınırını ve toplam deneme penceresinin
   `deliveryDeadline`'ı hangi payla geçmediğini söyle.
4. `submitAttempts`'in restart'lar arası birikmesi bu yeni modelde ne anlama
   geliyor — koru mu, sıfırla mı? Gerekçelendir.

Bu inişten sonra Adım 1 açılabilir.

---

# Kart: İlk gerçek uçtan uca döngü — `BOT_LIVE_WRITES` kapısı

Kabul edilen risk, kartı açmanın bedeli:
**İlk koşu `acceptJob`'dan sonra başarısız olursa botun 10 USDC stake'i yanar
ve geri alınamaz.** Bu bilinçli bir tasarım tercihiydi — sahte teslimat
göndermektense stake yansın. Kart açılıyorsa bu risk kabul edilmiş demektir.

Bu kart **tek bir iş** kapsar. İkinci iş ayrı karardır.

---

## Adım 0 — Kapı açılmadan: preflight, Railway ortamında

`npm run preflight`'ı **Railway'in kendi ortamında** çalıştır (lokalde değil —
lokal ortam farklı env okuyabilir, o zaman doğrulanan şey üretim olmaz).

Beklenen alanlar:

| alan | olması gereken |
|---|---|
| `preflight` | `"passed"` |
| `chainId` | 5042002 |
| `registered` | `true` |
| `activeJobs` | `"0"` |
| `summaryCredential` | `true` |
| `pinataCredential` | `true` |
| `gatewayConfigured` | `true` |
| `writeEnabled` | `false` (henüz) |
| `nativeBalance` | gas rezervinin üstünde |

Bunun kapıdan **önce** olmasının sebebi tek: `SUMMARY_API_KEY` veya
`PINATA_JWT` bozuksa, bunu `acceptJob`'dan sonra öğrenmek 10 USDC'ye mal olur.
Kimlik doğrulaması para riske girmeden yapılmalı. Preflight'ın herhangi bir
alanı beklenenden farklıysa kapı açılmaz.

## Adım 0.5 — Cevaplaman gereken bir soru (kod okuyarak, tahminle değil)

`config.stateFile` → `data/state.json`, Railway container'ının diskinde.
`railway.json`'da tanımlı bir volume yok.

Sor kendine ve **koddan cevapla**:

1. `BOT_LIVE_WRITES` değişkenini değiştirmek container'ı yeniden başlatır mı?
   Başlatırsa `data/` ne olur?
2. Bot `acceptJob` tx'ini broadcast etti, receipt gelmeden container yeniden
   başladı ve state dosyası yok — yeni instance ne yapar? Zincirden mi okur,
   sıfırdan mı başlar? "tx hash'i broadcast anında kalıcılaştırıyoruz"
   koruması, state dosyası hayatta kalmıyorsa neyi koruyor?
3. Bu senaryoda ikinci bir `acceptJob` gönderilebilir mi? Gönderilirse ne olur?

Cevap "sorun yok" ise **kod satırıyla göster**. Cevap "sorun var" ise, kapıyı
açmadan önce mi düzeltilmeli yoksa bu tek koşu için kabul edilebilir bir risk
mi — gerekçesiyle söyle. Şu an aktif iş yok, yani restart şu an güvenli; soru,
iş açıldıktan sonrası için.

---

## Adım 1 — Kapı

`BOT_LIVE_WRITES=true`. **Yalnızca bu değişken.** Başka hiçbir ayar aynı anda
değişmez; koşu başarısız olursa nedeni tek olsun.

## Adım 2 — Hazırlık teyidi (kapıdan sonra, iş açılmadan önce)

`/healthz` üzerinden `readiness.readyForNewJob === true` görülmeli.

Dikkat: `readyForNewJob` tanımı `config.writeEnabled && ...` ile başlıyor, yani
read-only modda **her zaman false**. Bu yüzden bu teyit kapıdan önce alınamaz;
yeri tam olarak burası. Aynı çıktıda `registered`, `activeJobs: "0"`,
`gasGuardSatisfied: true` de görünmeli.

Bu teyit gelmeden iş açılmaz. Aksi hâlde iş açılır, kimse almaz, escrow bekler.

## Adım 3 — İş açılır

Yusuf siteden **elle** bir `url-summary-v1` işi açar:

- URL: `https://www.iana.org/help/example-domains`
  (botun filtresinden geçtiği ölçüldü: 827 karakter, `text/html`)
- Ödül: 5–20 USDC aralığında

Sen bu adımda hiçbir şey yapmazsın. İşi sen açmazsın.

## Adım 4 — Bot kendi başına çalışır

Görür → kabul eder → çeker → özetler → IPFS'e pinler → teslim eder.

**Hiçbir adımda insan müdahalesi olmaz.** Bot takılırsa elle düzeltip devam
ettirme, restart etme, env değiştirme. Takıldığı yeri olduğu gibi raporla —
takılmak da bir sonuçtur ve gizlenirse değersizleşir.

## Adım 5 — Müşteri onaylar

Yusuf `approveAndPay` çağırır.

## Adım 6 — Rapor: log değil, zincir kanıtı

| istenen | biçim |
|---|---|
| `postJob` | tx hash |
| `acceptJob` | tx hash |
| `submitWork` | tx hash |
| `approveAndPay` | tx hash |
| IPFS | tam gateway linki — `index.html` ve `result.json` (açılıp okunacak) |
| bot bakiyesi | önce / sonra, ERC-20 raw (6 hane) |
| müşteri bakiyesi | önce / sonra, ERC-20 raw |
| fee sink | önce / sonra |
| bot sicili | `getAgentReputation(bot)` sonrası |
| toplam gas | USDC |

Bakiye farkları ile ödül + fee toplamı **birebir tutmalı**. Tutmuyorsa rapor
"başarılı" demez; farkı açıklar.

---

## Başarı çıtası

> Siteden bir `url-summary-v1` işi açılır; bot onu kendi başına görür, kabul
> eder, yapar, teslim eder; müşteri onaylar; para botun cüzdanına geçer — ve
> bu adımların hiçbirinde insan müdahalesi olmaz.

Kısmi sonuç da rapor edilir. "Bot kabul etti, teslim edemedi, stake yandı"
değerli ve dürüst bir sonuçtur. "Hallettim" bir sonuç değildir.

## Sınırlar

- `git push` yok.
- Slash sonrası otomatik yeniden kayıt / stake yenileme yok.
- Kontrat üzerinde değişiklik yok; denetim kapalı.
