# Yusuf: yerel uygulama + gerçek Arc Testnet, M1–M8

## Başlamadan önce

**13 Kasım güncel karar:** Canlı karşı rol signer köprüsü rafa kaldırıldı; `LIVE_EXECUTION_NOT_ACCEPTED` kalıcı olarak kapalı. Operatörü Brave'deki ikinci hesabınla kendin oynayacaksın. İkinci hesabın adresini Hermes'e ver; yalnız bakiye/kayıt salt-okuma kontrolü yapılır. Faucet/fonlama ve bütün hesap imzaları sende. Aşağıdaki eski testOperator/signer hazırlık notları tarihseldir ve işlem yetkisi vermez. M3 için yeni indexer taraması fresh olmalı ve ikinci hesabın fonlanması doğrulanmalıdır.

**Indexer güven modeli değişti:** Eski finalized aralıklar adres filtreli log batch'leriyle taranır; tüm boş blokların receipt/bloom kontrolü artık bu yerel tarihsel yolun iddiası değildir. Olay blokları ve aralık sınırları doğrulanır, head yakınında 32 blok reorg penceresi tutulur. Fresh, yeni açıkça belirtilmiş bu politika altında gerçek tarama tamamlanınca raporlanabilir; eski tam blok/receipt doğrulamasıyla karıştırılmaz.

Uygulama: http://127.0.0.1:3102/v2

Indexer sağlık: http://127.0.0.1:3103/health

**Bu adreslerin hazırlanmış olması testin hazır olduğu anlamına gelmez.** Indexer deploy bloklarından bütün geçmişi doğrulamadan ve sağlık `fresh` olmadan M3–M8'e başlama. `starting`, `degraded`, `stale` veya geçmiş tarama gecikmesi varsa Hermes'e sağlık sonucunu bildir. Sağlık göstergesini kapatıp zorla işlem yapma. Mevcut UI'da Cancel open job desteklenmediği için devre dışıdır; bu düğme test edilen bir özellik değildir.

Kendi mevcut Brave oturumunu kullan. Hermes senin cüzdanın adına imza veya işlem atmayacak. Şifre, seed phrase, özel anahtar, oturum cookie'si ve ham imza paylaşma. Operator rolünü ikinci Brave hesabınla kendin oynarsın; rafa kaldırılmış signer bu akışın ön koşulu değildir.

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
- 13 Kasım 17:25 UTC kontrolünde indexer cursor/head/safeHead `72210129`, status `healthy`, `stale: false`, `gap: null`, lag `0`. Bu anlık ölçümdür; her işlemden önce güncel sağlık tekrar okunmalıdır. **5 iş ve 3 migration** doğrulandı.
- Liste yalnız DB projection'ından döner. Son üç HTTP ölçümü **55.773 / 16.346 / 12.751 ms**, her biri 200 ve 5 iş. Build ve smoke exit 0; yazma öncesi canonical tazelik kontrolleri kaldırılmadı.
- İkinci hesap adresi henüz verilmedi. Güncel native/ERC-20 bakiye, kayıt ve teminat salt-okuma kontrolü adres gelince yapılır; eski hesap bakiyeleri güncel fon yeterliliği kanıtı değildir. Native ve ERC-20 USDC gösterimleri toplanmaz.
- Faucet, kayıt, teminat, başvuru, teslim ve bütün hesap imzaları Yusuf tarafından yapılır. Hermes fon göndermez. M3 için ikinci hesabın fonlanması ve ayrıca açık başlama onayı gerekir.
- Signer köprüsü kalıcı olarak rafa kaldırıldı: `LIVE_EXECUTION_NOT_ACCEPTED`; C3/C4/C6/C7 açık. Gate regresyonları geçti, fakat bu canlı signer kabulü değildir. M8 geniş executor ile çalıştırılmaz; güvenli tek-job komutu bulunmadığı için gönderim blokeli.

### Tekrar kontrol komutları

Repo dizininden CMD:

```bat
cd web
node scripts\v2-local-arc-control.mjs status
node scripts\v2-local-arc-smoke.mjs

```

`readerGatePassed: true` yalnız reader koşulunu kanıtlar. Health `healthy`, `stale: false`, `gap: null` olmalı ve tazelik 30 saniyeyi geçmemeli. `testReady: false` ve `pending_user_address` ikinci hesap/onay kapısının açık kaldığını belirtir; signer köprüsünü açarak aşılmaz.

Operatör için CLI kullanma; aşağıdaki ikinci Brave hesabı adımlarını izle. M8'de Hermes'ten yalnız belirli job ve karara özgü plan iste. Hazır tek-job executor bulunmadan bu plan gönderim yeteneği anlamına gelmez.

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

**Yusuf'un adımı:** Brave cüzdanında ikinci hesaba geç, uygulamada eski oturumu kapat ve yeni adresi kontrol ederek bu hesapla yeniden bağlan/oturum aç. Arc Testnet chain ID `5042002` olmalı. Arayüzden operator kaydı yap; gerekiyorsa faucet ile kendin fonla ve teminatı kendin yatır. Güncel minimumu kontrol et; tek test yatırımı en fazla 5 USDC. İkinci hesapla işin başvuru formunu doldurup EIP-712 başvurusunu kendin imzala. Sonra ilk/client hesabına geçip eski operator oturumunu kapat, client oturumunu doğrula; Load applications ile tam ikinci hesap adresini seç ve Award işlemini kendin onayla.

**Hermes'ten isteyeceğin:** “İkinci hesabım 0x...; bakiye/kayıt/teminatı salt-okuma kontrol et.” Ardından job ID ve kendi tx hash'lerini vererek receipt/canonical durumu doğrulat. Hermes başvurmaz, teminat yatırmaz, fon göndermez ve hesap değiştirme/cüzdan otomasyonu yapmaz.

**Ne göreceksin:** İkinci hesabın gerçek başvurusu; client Award receipt/readback'inden sonra InProgress ve tam ikinci hesap adresi. Hesap değişince önceki hesabın imzalı oturumu diğer hesap için kullanılmamalı.

## M5 — Teslim / normal onay / ödeme çekimi

**Yusuf'un adımı:** İkinci/operator hesabına ve ona ait oturuma geç. Gerçek teslim içeriğini/linkini arayüzden gir, manifest kaydı ve submitDelivery için kendi cüzdan onayını ver. Submitted olduktan sonra ilk/client hesabına ve oturumuna dön; Approve / Request revision / Open dispute düğmelerini kontrol edip Approve işlemini kendin onayla. Credit çekimi için hak sahibi hesaba tekrar geçip arayüzden kendin işlem yap.

**Hermes'ten isteyeceğin:** “Job #..., teslim/onay/çekim tx ...; receipt ve state/credit/bakiye farkını salt-okuma doğrula.” Hermes manifest POST, operator teslimi veya credit çekimi göndermez.

**Ne göreceksin:** Submitted, sonra onay receipt/readback'i ile Completed; ödeme credit'i ile token çekimi ayrıdır. Belirsiz/pending işlem tekrar gönderilmez.

## M6 — Revizyon

**Yusuf'un adımı:** Ayrı küçük işi Submitted'e getir. Request revision seçip notunu gir; kendi işlemini onayla. Revize teslim geldiğinde kendin onayla.

**Hermes'ten isteyeceğin:** “Job #... RevisionPending, tx ...; salt-okuma doğrula.” Revize teslimi ikinci/operator hesabına ve onun oturumuna geçerek arayüzden kendin yap; yeni delivery sürümünü ve tx hash'ini doğrulat. Client onayı ve hak sahibinin çekimi yine kendi hesaplarıyla yapılır.

**Ne göreceksin:** RevisionPending, yeni delivery sürümü, ardından Submitted. Önceki teslim korunur. “Ne oldu?” sorusu veya genel devam komutu yeni işlem yetkisi sayılmaz.

## M7 — Mutual settlement

**Yusuf'un adımı:** Ayrı uygun işte client olarak tam iade/kısmi ödeme teklifini, miktarları ve expiry'yi kontrol edip kendi cüzdanınla öner. Proposal expires başlangıçta üç gün sonrasıyla dolu gelmeli; değiştirilebilir.

**Hermes'ten isteyeceğin:** “Job #... mutual request version ...; tarafları, payout/refund/expiry ve işlem sonucunu salt-okuma doğrula.” Operator kabul/ret/teklifini ikinci Brave hesabı ve onun oturumuyla kendin yap; client kabulünü ilk hesapla kendin imzala. Hermes mutual işlem göndermez.

**Ne göreceksin:** Yalnız güncel, süresi geçmemiş ve karşı tarafın teklifi üzerinde işlem. Kabul sonrası receipt/readback ve doğru terminal durum/credit. Çekimler ayrı isteklerdir.

## M8 — Dispute / resolver

**Yusuf'un adımı:** Ayrı uygun işte client olarak Open dispute işlemini kendin yap. Operator tarafı gerekirse ikinci Brave hesabından kendin işlem yap. Resolver kararındaki payout, operatorFault ve olası slash etkisini incele; sonra **Hermes'ten karar iste**.

**Hermes'ten isteyeceğin:** Önce “Job #... Disputed, tx ...; şu payout/operatorFault/reason/evidence için resolver planını göster.” Plan gönderim değildir. Yalnız güvenli, tek-job onaylı executor hazırsa “Job #... gösterdiğin kararı uygula” isteğiyle simülasyon → gönderim → receipt → canonical readback yapılabilir. Fault review ayrı bir resolveFaultReview isteğidir. Şu an incelenen approved-v2-executor deploy/config/all komutları içeriyor; tek-job karar komutu yok. Bu yüzden geniş executor çalıştırılmaz ve **M8 gönderimi bloke** kalır.

**Ne göreceksin:** Gerçek etkin resolver doğrulanır; simülasyon sonrasında yalnız o job/karar gönderilir. Receipt ve canonical stake/slash/credit readback'i ile tx hash raporlanır. Uygun signer yoksa veya sınır aşılırsa imza/gönderim yapılmadan durulur.

### Bütün karşı-rol isteklerinde sınırlar

Operatör işlemleri yalnız Yusuf'un ikinci Brave hesabıyla manuel yapılır; Hermes bunları göndermez. Hermes'in olası hakem yetkisi yalnız Arc Testnet `5042002`, canonical client `0x460EBe282Fb0e42B4d682a7f9EF408302417F780`, reward en fazla 5 USDC, etkin resolver/owner ve ayrıca onaylı tek-job resolveDispute/resolveFaultReview kapsamındadır. Deploy/config/fonlama/toplu senaryo bu kapsamda değildir. Yusuf adına hiçbir imza yoktur; otomatik/zamanlanmış gönderim yoktur. İkinci hesap ve ilk hesap için seed, anahtar, şifre, cookie veya ham imza paylaşma. Her hakem işlemi ayrıca belirli sohbet isteği, simülasyon, receipt ve canonical readback gerektirir. Rafa kaldırılmış signer köprüsü yeniden açılmaz.

## Durdurma

Beklenmedik ağ/kontrat, stale reader, signer uyuşmazlığı, yanlış bakiye veya receipt olmadan başarı görürsen dur. Hermes'e senaryo/job ID ile beklenen ve görülen durumu bildir. Elle testte bulunan sorunların düzeltilmesi, buluta geçiş ve Faz 1b ayrıca Yusuf onayı gerektirir.
