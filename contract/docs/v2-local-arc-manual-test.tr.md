# Yusuf: yerel uygulama + gerçek Arc Testnet, M1–M8

## Başlamadan önce

Uygulama: http://127.0.0.1:3102/v2

Indexer sağlık: http://127.0.0.1:3103/health

**Bu adreslerin hazırlanmış olması testin hazır olduğu anlamına gelmez.** Indexer deploy bloklarından bütün geçmişi doğrulamadan ve sağlık `fresh` olmadan M3–M8'e başlama. `starting`, `degraded`, `stale` veya geçmiş tarama gecikmesi varsa Hermes'e sağlık sonucunu bildir. Sağlık göstergesini kapatıp zorla işlem yapma. Mevcut UI'da Cancel open job desteklenmediği için devre dışıdır; bu düğme test edilen bir özellik değildir.

Kendi mevcut Brave oturumunu kullan. Hermes senin cüzdanın adına imza veya işlem atmayacak. Şifre, seed phrase, özel anahtar, oturum cookie'si ve ham imza paylaşma. Karşı roller için yalnız atanmış test operator/resolver kullanılabilir; signer hazır değilse karşı adım bloke kalır.

### Aç / kapat

CMD'de repo dizininden:

```bat
web\scripts\start-v2-local-arc.cmd
web\scripts\stop-v2-local-arc.cmd
```

Başlatma migration veya build çalıştırmaz. Hazırlık sırasında migration ayrı komutla yapılır; kalıcı veriler bilgisayar yeniden başlatılınca korunur. Bilgisayar açılınca start komutunu kendin çalıştır. Üç servis yalnız bu yerel test için adlandırılmıştır; mevcut bot süreçlerine dokunulmaz.

Veri dizini: `%LOCALAPPDATA%\hermes\state\alphaboard-v2-local-arc\database`

DB: PGlite socket / PostgreSQL wire protocol, `127.0.0.1:54329`. PostgreSQL kurulum programı veya Docker gerekmez. PGlite'ın bu sunucu modu, gerçek PostgreSQL sunucusuna karşı test yapıldığı anlamına gelmez.

### Brave cüzdanı / Arc Testnet

| Alan | Değer |
|---|---|
| Ağ | Arc Testnet |
| Chain ID | 5042002 |
| RPC | https://rpc.testnet.arc.io |
| Para birimi | USDC |
| Explorer | https://testnet.arcscan.app |

Ağ eklemeyi ve cüzdan bağlantısını kendin onayla. Yusuf hesabı: `0x460EBe282Fb0e42B4d682a7f9EF408302417F780`.

Test USDC: https://faucet.circle.com . Arc Testnet'i ve kendi adresini seç. Gerçek para yatırma. Native USDC gas bakiyesi (18 ondalık) ile ERC-20 USDC gösterimi (6 ondalık) iki ayrı fon gibi toplanmamalı. Her işlemde spender, miktar, kontrat ve tahmini gas'ı kontrol et. Düşük bakiye halinde faucet isteğini kendin tamamla.

Resmi ağ bilgisi: https://docs.arc.network/arc/references/connect-to-arc

## Kurulum doğrulaması ve kalan engeller

- Yerel production build çalıştırıldı; API profili `arc-testnet`, chain ID `5042002` olarak okunuyor. DB, indexer ve web PM2 süreçleridir, cron işi değildir.
- Migration'lar ayrı uygulandı. Başlat/durdur döngüsü doğrulandı. Bu, bilgisayar yeniden başlatma testi veya gerçek PostgreSQL sunucusu testi değildir.
- Adaptif indexer yalnız mevcut public RPC'yi kullanıyor. Gözlenen bir tamamlanmamış aralık `68084270–70926941`, neden `pending_verified_range`; daha sonraki başarısız döngüde cursor `68084473`, head `70927229`, gap başlangıcı `68084474`, gap bitişi `null`, hata `INDEXER_RPC_FAILED` idi. Public RPC kontrollerinde aralıklı HTTP 429 görüldü. Geçmiş tamamlanmadı; güncel `/health` okunmadan hazır denmez. **5 iş ve Job 1–5 kimlikleri**, ayrıca **3 migration** DB'den doğrulandı.
- Liste gecikmesi düzeltildi: önce 5 işte 250 RPC çağrısı ve 35.6 saniye; artık liste yalnız DB projection'ından dönüyor. Production HTTP ölçümleri **36.685 / 29.442 / 12.999 ms**, her biri 200 ve 5 iş. Son smoke exit 0; bu indexer'ın fresh olduğu anlamına gelmez. Yazma öncesi canonical tazelik kontrolleri kaldırılmadı.
- Canlı, pinned canonical reader ön kontrolünde Yusuf ERC-20 USDC bakiyesi `14.972999`, native gösterimi `14.97299961`; bunlar toplanmaz. Sıfır değerli self-transfer gas tahmini `21000`, ölçülen gas fiyatıyla `0.00042 USDC`; bakiye yalnız bu örneği karşılıyor. Bu, marketplace işlemleri ve M1–M8 ödül/gas toplamına yeterlilik garantisi değildir.
- `testOperator`: `0x7c3A84C2F23B50Cd7A70A597641776475abb59e7`, kayıtlı; serbest teminat `5 USDC`, ayrılmış teminat `0`. Etkin resolver canonical client policy sıfır olduğu için owner fallback: `0xf5e14962e46F80fAA40570bD86BccE83AA6626fF`.
- Karşı-rol CLI'si varsayılan olarak yalnız **unsigned-plan** üretir. DPAPI için testOperator ve owner anahtar/parola dosyalarının varlığı salt-okuma `--status` ile doğrulandı; bu gerçek imza veya çalışır gönderim kanıtı değildir. Yeni canlı köprü, bağımsız incelemede nonce/gas hazırlığı, gerçek API payload entegrasyonu ve readback kontrolleri tamamlanmadığı için **anahtar çözülmeden `LIVE_EXECUTION_NOT_ACCEPTED` ile durur**. Şu an karşı roller uçtan uca hazır değildir. `python scripts\v2-local-arc-secure-executor.py --status` sonucu `blocked` olmalıdır. Genel yetki açık olsa da belirli job/işlem isteği olmadan anahtar çözme, imza veya gönderim yapılmaz.

### Tekrar kontrol komutları

Repo dizininden CMD:

```bat
cd web
node scripts\v2-local-arc-control.mjs status
node scripts\v2-local-arc-smoke.mjs
node scripts\v2-local-arc-preflight.mjs --operator=0x7c3A84C2F23B50Cd7A70A597641776475abb59e7
```

`status` çıktısında `testReady: false` varsa M3–M8 başlamaz. Health `healthy`, `stale: false`, `gap: null` olmalı ve tazelik 30 saniyeyi geçmemeli; ayrıca signer hazırlığı ayrı doğrulanmalıdır.

Karşı-rol plan arayüzü: `node scripts\v2-local-arc-counterparty.mjs --action=... --job-id=... --operator=... --expected-version=...`. Bunlar şablondur, `...` yerine gerçek canonical değerler gerekir. Desteklenen planlar: `apply`, `submit-delivery`, `revision`, `accept-mutual`, `resolve`. Teslimde gerçek kaydedilmiş manifest `--hash` değeri; mutual kabulde gerçek `--expected-request-version`; resolver kararında gerçek `--resolver`, `--reason-hash`, `--evidence-hash`, `--gross-payout` ve açık `--operator-fault=true/false` gerekir. Hiçbir plan doğrudan gönderilmez. Tarihsel başka client'ın işi, yanlış zincir, yanlış party/version ve eksik hash reddedilir.

## Her testte kayıt

Yeni küçük test işler aç; tarihsel Job 1–5 üzerinde senaryoları tekrar etme. Hermes'e job ID, durum ve varsa transaction hash söylemen yeterli. Başarı için receipt ve canonical readback gerekir. İşlem belirsiz/pending ise tekrar gönderme; hash'i araştırmak için dur.

## M1 — Cüzdansız gezinme

**Yusuf'un adımı:** http://127.0.0.1:3102/v2 adresini cüzdan bağlamadan aç. Listeyi, detayı ve yeni iş formunu kontrol et. Public kutusu normal boyutta etiketin yanında, varsayılan açık olmalı. Kategori tek, etiketler çoklu seçimdir. Masaüstü ve mobilde kontrol et.

**Hermes'ten isteyeceğin:** “M1: liste/detay/form açıldı; sağlık ..., taşma var/yok. Salt-okuma kontrol et.” Bu istek imza veya gönderim yetkisi değildir.

**Ne göreceksin:** Gerçek indekslenmiş işler; saniyesiz tarih ve göreli süre. Veri yüklenmemesi başarı değildir.

## M2 — Ağ ve oturum

**Yusuf'un adımı:** Bu tur M1–M2 **imzasız incelemedir**. Yanlış ağ uyarısını ve işlem düğmelerinin kapalı kaldığını kontrol et. İstersen cüzdan bağlantısını ve ağ seçimini yalnız kendin yönet; **Sign in with wallet imzasını bu tur verme**, onay/transaction gönderme. Bağlantıyı kesince eski hesap görünümünün temizlendiğini kontrol et.

**Hermes'ten isteyeceğin:** “M2 imzasız: yanlış ağ uyarısı ..., bağlantı kesilince görünüm ...; salt-okuma kontrol et.” Hermes tarayıcını veya cüzdanını kontrol etmez.

**Ne göreceksin:** Bağlantı ve oturum açma ayrı adımlardır. Yanlış ağda aksiyonlar kapalı; imzasız incelemede oturum yetkisi kazanılmaz. Gerçek imzalı oturum kabulü daha sonra ayrıca yapılacaktır.

## M3 — Küçük normal iş açma

**Yusuf'un adımı:** Yalnız Hermes açıkça “M3'e başlayabilirsin” dedikten sonra yeni iş oluştur. Ödülü 1 test USDC seç; güncel minimum kabul etmiyorsa dur. Karşı-rol sınırı iş başına en fazla 5 USDC'dir. Kriter, kategori, etiket, UTC başvuru tarihi ve süreleri doldur. Policy/resolver, exact allowance ve gas'ı kontrol ederek kendi cüzdan onaylarını kendin ver.

**Hermes'ten isteyeceğin:** “M3: job #... Open, tx ...; receipt ve canonical durumu salt-okuma doğrula.” Henüz operator başvurusu gönderilmez.

**Ne göreceksin:** Receipt/readback sonrasında yeni Open job ID. Public kapatmak zincir verilerini gizlemez. Tüm M1–M8 ödül/gas bütçesi ayrıca kontrol edilmelidir.

## M4 — Operator başvurusu / client ataması

**Yusuf'un adımı:** İş ID'sini doğrula; başvuru geldikten sonra Load applications yapıp doğru testOperator'ı seç. Award işlemini kendi cüzdanınla onayla.

**Hermes'ten isteyeceğin:** “Job #... için testOperator başvursun.” Bu yalnız o işe ait EIP-712 başvuru ve imzalı API POST isteğidir; başka işlem yetkisi değildir. Teminat gerekiyorsa ayrıca “Job #... için testOperator ... USDC teminat yatırsın” de; tek yatırma en fazla 5 USDC.

**Ne göreceksin:** Gerçek API'de başvuru; senin Award receipt/readback'inden sonra InProgress ve doğru operator. Applications gizlenir. Hermes işlem sonucu/hash varsa bildirir.

## M5 — Teslim / normal onay / ödeme çekimi

**Yusuf'un adımı:** Job Submitted olduktan sonra ayrı Approve / Request revision / Open dispute düğmelerini kontrol et. Approve işlemini kendi cüzdanında onayla.

**Hermes'ten isteyeceğin:** Önce “Job #... için şu gerçek teslim linkini ... teslim et.” Hermes gerçek manifest'i API'de kaydeder, yalnız atanmış testOperator ile simülasyon sonrası submitDelivery gönderir. Ödeme çekimi için daha sonra ayrıca “Job #... sonrası testOperator credit'ini kontrol et ve çek” de; çekim ayrı istektir.

**Ne göreceksin:** Submitted, sonra onay receipt/readback'i ile Completed; ödeme credit'i ile token çekimi ayrıdır. Belirsiz/pending işlem tekrar gönderilmez.

## M6 — Revizyon

**Yusuf'un adımı:** Ayrı küçük işi Submitted'e getir. Request revision seçip notunu gir; kendi işlemini onayla. Revize teslim geldiğinde kendin onayla.

**Hermes'ten isteyeceğin:** “Job #... RevisionPending, tx ...; şu yeni teslimi ... revizyon olarak teslim et.” Bu yalnız gerçek API manifest kaydı ve submitRevision içindir. Son ödeme çekimini ayrı iste.

**Ne göreceksin:** RevisionPending, yeni delivery sürümü, ardından Submitted. Önceki teslim korunur. “Ne oldu?” sorusu veya genel devam komutu yeni işlem yetkisi sayılmaz.

## M7 — Mutual settlement

**Yusuf'un adımı:** Ayrı uygun işte client olarak tam iade/kısmi ödeme teklifini, miktarları ve expiry'yi kontrol edip kendi cüzdanınla öner. Proposal expires başlangıçta üç gün sonrasıyla dolu gelmeli; değiştirilebilir.

**Hermes'ten isteyeceğin:** “Job #... mutual request version ...; testOperator bu teklifi kabul etsin.” Ret için açıkça “bu teklifi reddetsin” de. Operator'ın teklif oluşturması gerekiyorsa payout/refund/expiry değerlerini açıkça yazarak ayrı istek ver; client kabulünü kendin imzala.

**Ne göreceksin:** Yalnız güncel, süresi geçmemiş ve karşı tarafın teklifi üzerinde işlem. Kabul sonrası receipt/readback ve doğru terminal durum/credit. Çekimler ayrı isteklerdir.

## M8 — Dispute / resolver

**Yusuf'un adımı:** Ayrı uygun işte client olarak Open dispute işlemini kendin yap. Resolver karar planındaki payout, operatorFault ve olası slash etkisini incele. Operator'ın dispute açması isteniyorsa bunu ayrıca açıkça söyle.

**Hermes'ten isteyeceğin:** Önce “Job #... Disputed, tx ...; şu payout/operatorFault/reason/evidence için resolver planını göster.” Plan göstermek gönderim değildir. Ardından yalnız o karar için “Job #... gösterdiğin resolver kararını uygula” de. Fault-review kararı gerekiyorsa job, slash, reason ve evidence ile resolveFaultReview isteğini ayrıca belirt.

**Ne göreceksin:** Gerçek etkin resolver doğrulanır; simülasyon sonrasında yalnız o job/karar gönderilir. Receipt ve canonical stake/slash/credit readback'i ile tx hash raporlanır. Uygun signer yoksa veya sınır aşılırsa imza/gönderim yapılmadan durulur.

### Bütün karşı-rol isteklerinde sınırlar

Yalnız Arc Testnet `5042002`, canonical client Yusuf, reward en fazla 5 USDC; yalnız doğrulanmış testOperator ve etkin resolver/owner, yalnız onaylı fonksiyonlar. Yusuf adına hiçbir imza yoktur. Otomatik/zamanlanmış gönderim yoktur; her işlem için yeni ve belirli sohbet isteği gerekir. Keystore DPAPI mekanizmasında kalır; anahtar, şifre, ham imza veya cookie paylaşılmaz. Her zincir işlemi önce simülasyon, sonra receipt ve readback ister.

## Durdurma

Beklenmedik ağ/kontrat, stale reader, signer uyuşmazlığı, yanlış bakiye veya receipt olmadan başarı görürsen dur. Hermes'e senaryo/job ID ile beklenen ve görülen durumu bildir. Elle testte bulunan sorunların düzeltilmesi, buluta geçiş ve Faz 1b ayrıca Yusuf onayı gerektirir.
