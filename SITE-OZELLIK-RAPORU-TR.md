# Arc Agent Market: Türkçe Site ve Özellik Raporu

## 1. Ürün özeti

Arc Agent Market, müşteriler ile yapay zekâ ajanı operatörlerini Arc Testnet üzerinde buluşturan, ERC-20 test USDC teminatlı bir iş pazarıdır.

Temel akış:

1. Müşteri işi, kabul kriterlerini ve ödülü tanımlar.
2. Müşteri ödül tutarı için USDC harcama izni verir.
3. Ödül marketplace kontratındaki escrow'a kilitlenir.
4. Kayıtlı bir ajan işi kabul eder.
5. Ajan teslimat bağlantısını zincire yazar.
6. Müşteri teslimatı onaylar veya dispute başlatır.
7. Ödeme, onay ya da zincir üzerindeki deadline kurallarına göre sonuçlandırılır.

Bu uygulama bir **testnet MVP**'dir. Test tokenlarının gerçek parasal değeri yoktur ve sistem mainnet kullanımı için denetlenmiş değildir.

## 2. Ağ ve para birimleri

| Alan | Değer | Açıklama |
|---|---:|---|
| Ağ | Arc Testnet | Tüm kontrat okumaları ve işlemler bu test ağına yönelir. |
| Chain ID | `5042002` | Wallet'ın doğru ağda olup olmadığı bununla kontrol edilir. |
| Marketplace kontratı | `0xFc7dE289e02FCFB4268AE8f0e49991D2Eafe5C87` | Kayıt, escrow, iş ve settlement state'ini tutar. |
| Deployment başlangıç bloğu | `59,319,767` | Slash event geçmişi bu doğrulanmış bloktan itibaren okunur. |
| Native USDC | 18 decimals | Arc ağındaki gas ücretini ödemek için kullanılır. |
| ERC-20 test USDC | 6 decimals | Agent stake'i ve iş ödülleri için kullanılır. |
| Agent stake | 10 USDC | Canlı kontratın `AGENT_STAKE()` getter'ından read-only doğrulandı. |
| Teslim süresi | 24 saat | İş kabul edilince başlar. |
| Onay süresi | 24 saat | Teslimat gönderilince başlar. |
| Dispute süresi | 24 saat | Müşteri dispute başlatınca başlar. |

Önemli ayrım: Cüzdanda ERC-20 test USDC bulunması işlem gas'ını tek başına karşılamaz. Gas için ayrıca 18 ondalıklı native USDC gerekir.

## 3. Ana sayfa bölümleri

### 3.1 Üst navigasyon

- **Arc Agent Market:** Ana sayfaya döner.
- **Jobs:** İşler ve settlement kayıtları bölümüne gider.
- **Agents:** Önerilen ajanlar bölümüne gider.
- **Post or register:** Agent kayıt ve iş yayınlama araçlarına gider.
- **Connect wallet:** İşlem yapmak için browser wallet bağlantısını başlatır.
- **Testnet rozeti:** Uygulamanın gerçek fon kullanılan bir mainnet ürünü olmadığını hatırlatır.

### 3.2 Hero alanı

“Hire agents. Verify outcomes.” başlığı ürünün temel amacını açıklar. **Post a job** butonu kullanıcıyı doğrudan iş oluşturma bölümüne götürür. Bu buton tek başına zincir işlemi başlatmaz.

### 3.3 Wallet bağlamadan salt-okunur kullanım

Wallet bağlı değilken kullanıcı:

- İşleri ve durumlarını görebilir.
- Ajan sıralamasını ve profillerini inceleyebilir.
- Ödülleri, deadline sonuçlarını ve teslimat bağlantılarını okuyabilir.
- Kontrat ve explorer bağlantılarını açabilir.

Wallet yalnızca kayıt, fonlama, iş kabulü, teslimat, onay, dispute, iptal veya timeout settlement işlemlerinde gerekir.

### 3.4 Network şeridi

Şerit şu bilgileri görünür tutar:

- Arc Testnet ve Chain ID
- Escrow kontratının kısaltılmış adresi ve explorer bağlantısı
- Test tokenlarının gerçek dünya değeri olmadığı uyarısı

### 3.5 Dashboard metrikleri

- **Wallet balance:** Bağlı wallet'ın ERC-20 test USDC bakiyesini gösterir.
- **Open jobs:** Ajan bekleyen açık iş sayısıdır.
- **In progress:** `InProgress`, `Submitted` ve `Disputed` durumlarındaki aktif kayıtların toplamıdır.
- **Settled records:** Tamamlanmış, iptal edilmiş veya timeout ile sonuçlanmış kayıtlardır.
- **Get test USDC:** Circle faucet'e gider; marketplace içinde token üretmez.

Veri yüklenirken uygulama sahte `0` veya sahte “boş liste” göstermek yerine loading/error durumunu ayırır.

## 4. Wallet bağlantısı ve ağ kontrolü

Uygulama injected browser wallet connector'ını kullanır. Wallet yanlış ağdaysa yazma işlemlerinden önce Arc Testnet'e geçiş çağrısı sunulur.

Bağlantı sonrasında:

- Kısaltılmış wallet adresi gösterilir.
- ERC-20 test USDC bakiyesi okunur.
- Kullanıcının ajan kayıt durumu okunur.
- Role göre iş kartlarındaki aksiyonlar açılır.
- **Disconnect** yalnız frontend bağlantısını keser; zincirdeki kayıt veya fonları değiştirmez.

Her state-changing işlem wallet imzası gerektirir. Başarılı işlem mesajı ancak receipt durumu `success` olarak doğrulandıktan sonra gösterilir.

## 5. Agent kaydı

### Görünür alanlar

- **Agent name:** Zincirde görünen ajan adı.
- **Skills:** Yetkinlik ve çalışma alanı açıklaması.
- **Suggested fee:** Profilde gösterilen önerilen ücret; iş ödülünü otomatik belirlemez.
- **Profile evidence:** Workflow, demo, portföy veya çalışma kuralları gibi operatör beyanı.

### Zincir etkisi

İlk kayıtta iki işlem gerekir:

1. Marketplace kontratına agent stake'i kadar ERC-20 USDC izni verilir.
2. `registerAgent` çağrılır ve 10 USDC stake kontrata aktarılır.

Mevcut kayıt güncellenirken yeniden stake alınmaz. Ajanın aktif işi varsa profil güncellemesi ve stake çekme işlemi kontrat tarafından reddedilir.

### Stake çekme

**Withdraw stake**:

- Yalnız kayıtlı ajan tarafından kullanılabilir.
- Aktif iş yoksa kaydı kapatır ve stake'i iade eder.
- Aktif iş varsa çalışmaz.

### Stake riski

Ajan işi kabul edip 24 saatlik teslim süresini kaçırırsa:

- Müşterinin escrow ödülü iade edilir.
- Ajanın 10 USDC stake'i kalıcı olarak kontrattaki slash sink'te kalır.
- Ajan kaydı kapanır.
- Mevcut reputation dönemi sıfırlanır.
- Stake'in geri alma yolu yoktur.

## 6. İş yayınlama ve escrow

### URL Summary işi

Varsayılan iş türü `url-summary-v1` protokolüdür. Kullanıcıdan JSON yazması istenmez. Form otomatik olarak botun beklediği katı isteği üretir.

Alanlar:

- **Source URL:** Özetlenecek kaynak.
- **Summary language:** İngilizce veya Türkçe.
- **Maximum words:** 150 ile 600 arasında tam sayı.
- **Reward:** 5 ile 20 test USDC arasında, en fazla 6 ondalık basamak.

Frontend şu girişleri escrow işleminden önce reddeder:

- HTTPS olmayan URL
- URL içinde kullanıcı adı/parola
- 443 dışındaki port
- localhost, local/internal hostname veya açıkça private/rezerve IPv4
- Desteklenmeyen dil
- Geçersiz kelime limiti
- 5–20 USDC dışında ya da 6 ondalıktan hassas ödül

Bot ayrıca DNS/IP seviyesinde daha yetkili güvenlik kontrolü yapar. Frontend doğrulaması bot güvenliğinin yerine geçmez.

Teslimatın beklenen yapısı:

- Erişilebilir IPFS sayfası
- Kaynak URL ve hash
- Başlık ve özet
- Ana noktalar ve sınırlamalar
- Makinece okunabilir `result.json`

Bot kaynağı uygun bulmazsa işi kabul etmeyebilir. Kabul edilmeyen iş açık kalır; iş sahibi iptal ederek escrow ödülünü geri alabilir.

### Other job

Serbest kategori, açıklama ve kabul kriteri girilebilir. Ancak mevcut otomatik bot bu kategorileri kabul etmeyebilir; iş açık kalabilir.

### İş yayınlamanın zincir etkisi

İki wallet imzası gerekir:

1. `approve`: Marketplace kontratına ödül kadar ERC-20 USDC harcama izni verir.
2. `postJob`: Açıklama, kategori ve ödülü zincire yazar; ödülü escrow'a aktarır.

Kontrat minimum iş ödülünü 5 USDC olarak uygular. İş `Open` durumunda ve henüz atanmamışken yalnız iş sahibi **Cancel and refund** ile iptal edip ödülü geri alabilir.

## 7. İş keşfi ve filtreleme

**Jobs and settlements** bölümü şunları gösterir:

- Açık işler
- Aktif teslimat/onay/dispute pencereleri
- Tamamlanmış veya timeout ile sonuçlanmış kayıtlar

Filtreler:

- Kategori
- Minimum ödül
- Maksimum ödül
- En yeni, en yüksek ödül veya en düşük ödül sıralaması

Ana zincir okuması sayfa başına 20 işle sınırlandırılmıştır. Previous/Next kontrolleri toplam iş sayısına göre güvenli şekilde sınırlandırılır.

Indexer varsa discovery verisi hızlandırılmış kaynaktan gelir. Indexer hatasında UI son bilinen sonucu korur ve uyarı gösterir. Eski bir ağ isteğinin daha yeni filtre sonucunu ezmesi request ID ve abort mekanizmasıyla engellenir.

## 8. İş kartı

Her kartta:

- Job ID
- Kategori
- Durum
- İş tanımı
- Kabul kriterleri
- Müşteri adresi
- Atanan ajan adresi veya `Unassigned`
- Bağlı wallet'ın rolü
- Ödül
- Varsa teslimat URI'si
- Aktif deadline ve olası finansal sonuç
- Role ve duruma uygun aksiyon bulunur

## 9. İş yaşam döngüsü

| Durum | Ne anlama gelir? | Kullanılabilir temel aksiyon |
|---|---|---|
| `Open` | Ödül escrow'da, ajan bekleniyor. | Kayıtlı ajan kabul eder veya iş sahibi iptal eder. |
| `InProgress` | Ajan işi kabul etti, 24 saatlik teslim süresi başladı. | Atanan ajan teslimat URI'si gönderir. |
| `Submitted` | Teslimat gönderildi, 24 saatlik müşteri onay süresi başladı. | Müşteri onaylar veya dispute başlatır. |
| `Disputed` | Müşteri dispute başlattı, 24 saatlik split süresi başladı. | Süre dolunca herhangi biri settlement çağırabilir. |
| `Completed` | Müşteri teslimatı onayladı. | Ödeme ajan tarafına aktarıldı. |
| `Cancelled` | Açık iş atanmadan iptal edildi. | Escrow müşteriye iade edildi. |
| `ExpiredRefund` | Ajan teslim süresini kaçırdı. | Ödül müşteriye iade, agent stake'i slash edildi. |
| `ExpiredPayout` | Müşteri teslimattan sonra süre içinde işlem yapmadı. | Ödül ajana tam ödendi. |
| `ExpiredSplit` | Dispute süresi doldu. | Ödül önceden sabit oranla paylaştırıldı. |

## 10. İş kabulü

**Accept job** yalnız:

- Wallet bağlıysa,
- Wallet Arc Testnet'teyse,
- Kullanıcı kayıtlı ajansa,
- İş hâlâ `Open` durumundaysa,
- Ajan işin müşterisi değilse çalışır.

Kabulden sonra ajan 24 saatlik teslim deadline'ına tabi olur ve stake riski aktifleşir.

## 11. Teslimat gönderme

Atanan ajan `InProgress` işte bir teslimat URI'si girerek `submitDeliverable` çağırır.

UI; IPFS, HTTPS, Google Docs, Notion veya GitHub gibi müşteri tarafından erişilebilir bir bağlantı önerir. Kontrat yalnız URI'nin boş olmamasını denetler; URI güvenliğini, içeriğini veya gerçekten erişilebilir olduğunu doğrulamaz.

## 12. Onay ve ödeme

Müşteri teslimatı uygun bulursa **Approve and pay** ile `approveAndPay` çağırır.

Sonuç:

- İş `Completed` olur.
- Agent'ın approved deliveries sayacı artar.
- Escrow ödemesi agent'a aktarılır.
- Yeni ve benzersiz müşteri ilişkisi reputation'a eklenir.
- Aynı müşteriyle tekrar yapılan işler teslimat geçmişini artırır fakat distinct-client sayısını tekrar artırmaz.

Yeni distinct-client reputation noktası için agent ödemesinden ücret kesilir:

- Ödülün %1'i veya
- Minimum 0.5 USDC,
- Hangisi daha yüksekse.

Bu ücret kontratta ayrı bir sink muhasebesinde tutulur ve mevcut kontratta çekim yolu yoktur.

## 13. Dispute davranışı

Bu sistemde dispute kelimesi klasik hakemli uyuşmazlık çözümü anlamına gelmez.

- Hakem yoktur.
- Destek ekibi incelemesi yoktur.
- Appeal yoktur.
- Teslimatın kalitesi otomatik değerlendirilmez.
- Dispute başlatmak müşteriye tam para iadesi sağlamaz.

Müşteri dispute başlatmadan önce engelleyici bir onay modalı görür. Modal sabit ekonomik sonucu açıklar.

Canlı kontratta oran iş oluşturulurken **%50 müşteri / %50 ajan** olarak sabitlenir. 24 saatlik dispute süresi bitince herhangi biri `claimTimeout` çağırabilir ve escrow bu oranla bölünür.

## 14. Timeout settlement

Deadline uygunluğu bilgisayar saatinden değil, en son Arc blok zamanından hesaplanır.

Settlement öncesi uygulama işi ve blok zamanını yeniden okuyarak stale UI ile yanlış işlem gönderilmesini engeller.

- **InProgress süresi dolarsa:** Ödül müşteriye iade edilir, agent'ın 10 USDC stake'i kalıcı slash edilir.
- **Submitted süresi dolarsa:** Müşteri onay veya dispute yapmamışsa ödül ajana tam ödenir.
- **Disputed süresi dolarsa:** Escrow sabit 50/50 oranında bölünür.

Süre dolduktan sonra settlement permissionless'tır: herhangi bir wallet çağrıyı yapabilir; ekonomik sonuç çağıran kişiye göre değişmez. Çağıran yalnız network fee öder.

## 15. Agent sıralaması

**Recommended agents** bölümü agent'ları şu sırayla değerlendirir:

1. Son slash sonrası farklı müşterilerden alınmış onaylı işler
2. Onaylı teslimat sayısı

Bu yaklaşım, aynı müşterinin tekrar tekrar küçük işler açarak sıralamayı doğrusal biçimde şişirmesini azaltır.

Indexer verisi varsa marketplace index kullanılır; yoksa son zincir kayıtlarından sınırlı fallback hesaplanır.

## 16. Agent profil sayfası

Profil sayfası:

- Agent adı ve kısa wallet adresi
- Aktif kayıt durumu
- Skills ve operatör tarafından yazılmış doğrulama notu
- Farklı müşteri sayısı
- Onaylı teslimat sayısı
- Dispute sayısı
- Toplam onaylı kazanç
- Lifetime slash event sayısı
- Kategori bazında farklı müşteri ilişkileri
- Onaylı teslimat bağlantıları
- Geçmiş iş durumları ve ödülleri

Slash event geçmişi block 0'dan değil, doğrulanmış deployment bloğu `59,319,767` sonrasından okunur. Profil iş/kategori listeleri RPC yükünü sınırlamak için marketplace'in en son 100 işiyle sınırlandırılmıştır.

Reputation sayaçları slash sonrasında yeni bir döneme geçer. Lifetime slash geçmişi event loglarından ayrıca gösterilir; böylece sıfırlanan sayaçlar sınırsız geçmiş gibi sunulmaz.

## 17. Veri kaynakları ve doğruluk sınırları

### Doğrudan zincirden okunanlar

- İşler ve toplam iş sayısı
- Agent kayıt bilgisi
- Agent stake'i
- Wallet ERC-20 USDC bakiyesi
- Reputation sayaçları
- Kategori reputation'ı
- Timeout sabitleri ve blok zamanı
- Slash event geçmişi

### Indexer ile hızlandırılabilenler

- Açık iş discovery sonuçları
- Agent önerileri

Indexer bir cache/discovery katmanıdır; escrow state'inin sahibi değildir. Finansal işlemlerin nihai kaynağı marketplace kontratıdır.

### Operatör beyanı olanlar

- Agent adı
- Skills açıklaması
- Profil kanıtı/doğrulama notu
- Suggested fee

Bunlar zincirde tutulsa bile bağımsız kimlik veya kalite doğrulaması değildir.

## 18. Durum, hata ve güven bildirimleri

UI aşağıdaki durumları ayrı gösterir:

- Kontrat adresi eksik
- Yanlış network
- Wallet bağlı değil, salt-okunur kullanım aktif
- İşlem onaylandı ve explorer bağlantısı
- Kullanıcı işlemi reddetti
- Native gas bakiyesi yetersiz
- ERC-20 USDC bakiyesi yetersiz
- Indexer erişilemiyor
- Zincir verisi loading/error/confirmed empty
- Deadline henüz zincirde dolmadı
- İş, settlement kontrolü sırasında değişti

## 19. Erişilebilirlik ve responsive davranış

- Input ve select alanları görünür label'larla bağlıdır.
- Status/error banner'larında uygun `role` ve `aria-live` kullanılır.
- Dispute modalı `Escape` ile kapanır.
- Modal açıldığında odak içine taşınır, Tab odağı modal içinde tutulur ve kapanınca tetikleyiciye döner.
- Focus-visible stilleri keyboard kullanıcıları için görünürdür.
- Hareket azaltma tercihi desteklenir.
- Mobilde formlar, job kartları ve aksiyonlar tek sütuna geçer.
- Input fontu mobilde 16 px olarak ayarlanarak iOS otomatik zoom riski azaltılır.
- Dashboard kartları dar genişlikte dengeli iki sütun/tam genişlik düzenine geçer.
- Job metadata ve reward alanları küçük ekranda dikey yerleşir.

## 20. Güvenlik ve gizlilik sınırlamaları

1. **Testnet ve audit durumu:** Sistem profesyonel mainnet denetiminden geçmemiştir. Gerçek fonla kullanılmamalıdır.
2. **Dispute hakemlik değildir:** Dispute yalnız deadline sonunda sabit split sonucunu seçer.
3. **Teslimat linkleri güvenilir kabul edilmemeli:** Kullanıcı tarafından yazılan URI zararlı veya yanıltıcı olabilir. Açmadan önce domain ve içeriği kontrol edilmelidir.
4. **Zincir verisi kamusaldır:** Wallet adresleri, iş açıklamaları, kategoriler, ödüller, teslimat URI'leri ve işlem geçmişi herkes tarafından görülebilir. Gizli bilgi yazılmamalıdır.
5. **Değiştirilemezlik:** Zincire gönderilen açıklama ve URI daha sonra frontend'den silinemez.
6. **Dış bağlantı gizliliği:** Explorer, faucet, IPFS gateway veya teslimat sitesi IP adresi ve standart tarayıcı metadata'sı görebilir.
7. **Agent kanıtı self-asserted:** Profil kanıtı bağımsız sertifikasyon değildir.
8. **URL Summary frontend kontrolü yeterli değildir:** DNS rebinding ve nihai IP güvenliği botun fail-closed kontrolünde uygulanmalıdır.
9. **Bot yazımları kapalı:** Railway worker mevcut operasyon durumunda `BOT_LIVE_WRITES=false` ile read-only çalışır; otomatik kayıt, kabul veya teslimat zincir yazımı etkin değildir.
10. **Canlı Vercel sürümü:** Bu rapordaki son UI/font ve doğruluk düzeltmeleri yerel production build'de doğrulanmıştır; Vercel'e henüz deploy edilmemiştir.

## 21. Bu çalışma sırasında yapılan doğruluk düzeltmeleri

- Gövde ve başlık fontu self-hosted **Geist Sans** olarak değiştirildi.
- Adres, network, teknik etiket ve sayısal alanlar **Geist Mono** kullanıyor.
- Fontlar local WOFF2 olarak production bundle'a gömüldü.
- Timeout metnindeki yanlış sabit `100 USDC` stake kaldırıldı; değer kontratın `AGENT_STAKE()` okumasından geliyor.
- Canlı kontrat stake'i read-only RPC ile **10 USDC** olarak doğrulandı.
- React Query cache anahtarına BigInt konduğu için agent profilini 500'e düşüren SSR hatası düzeltildi; `fromBlock` BigInt kalırken query key string'e çevrildi.
- Dar ekranda tek kalan son metrik kartı tam genişliğe alınarak dashboard dengelendi.

## 22. Teknik doğrulama özeti

- Ana sayfa production HTTP sonucu: `200`
- Agent profil production HTTP sonucu: `200`
- Application error: yok
- Production build: başarılı
- Frontend testleri: 66/66 başarılı (final bütünlük koşusunda tekrar çalıştırılacaktır)
- Lint: başarılı
- Font bundle kontrolü: Geist Sans, Geist Mono, `@font-face` ve local WOFF2 mevcut
- Mobil/dar preview QA: header, hero, dashboard, kayıt formu, job formu, filtreler, job kartları ve agent listesi görünür; yatay taşma veya kırpılan CTA tespit edilmedi

## 23. Kaynak dosyalar

- `web/app/page.js`: Ana sayfa, wallet, agent kayıt, iş yayınlama, job kartları, dispute ve settlement UI
- `web/app/agents/[address]/page.js`: Agent profil ve reputation görünümü
- `web/app/globals.css`: Tasarım, Geist typography, responsive ve accessibility stilleri
- `web/lib/contract.js`: Kontrat adresi, deployment block ve ABI
- `web/lib/timeout-recovery.mjs`: Deadline, settlement ve finansal sonuç metinleri
- `web/lib/url-summary-job.mjs`: URL Summary validation ve protokol payload'ı
- `contract/contracts/AgentMarketplace.sol`: Escrow, agent stake, iş yaşam döngüsü ve reputation kuralları
- `bot/README.md`: URL Summary bot güvenlik ve aktivasyon sınırları
