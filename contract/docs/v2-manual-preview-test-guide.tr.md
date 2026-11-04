# Yusuf için V2 Preview / Arc Testnet elle test rehberi

## Başlatma kapısı

**Durum: Henüz elle teste hazır değil.** Preview bağlantısı, ayrı Railway kaynakları, gerçek PostgreSQL testleri ve indexer sağlığı doğrulanmadan aşağıdaki işlemleri başlatma. Railway yeniden giriş ve V1'i etkilemeyen $15/ay hard limit doğrulaması bekleniyor. Geçerli bir Preview URL henüz atanmadığından bu belgede tahmini bağlantı verilmez.

Hazır olduğunda operatör bu bölümü gerçek, SSO korumalı Preview URL, deploy SHA, `/api/v2/health` sonucu, Marketplace/Vault adresleri ve indekslenen job sayısıyla tamamlar. Sadece sayfanın açılması veri kaynağının çalıştığı anlamına gelmez. Eski yerel ekran görüntüleri hosted Preview kanıtı değildir.

- Production/main/V1 kullanılmaz veya değiştirilmez.
- Kendi mevcut Brave oturumunu ve cüzdanını kullan. Yeni/izole Brave açma.
- Seed phrase, özel anahtar, şifre, cookie, CSRF veya imza paylaşma.
- Her cüzdan işlemini Yusuf gözden geçirip kendi onaylar. Bu rehber Hermes'e public-chain işlem yetkisi vermez.
- M4–M8 için farklı adresli bir operator ve gerektiğinde atanmış resolver gerekir. Bu aktörler hazır değilse senaryoyu **bloke** işaretle; aynı adresle rol kontrollerini atlatma.

## Ağ ve test USDC

Cüzdanın özel ağ ekleme bölümüne:

| Alan | Değer |
|---|---|
| Ağ adı | Arc Testnet |
| RPC | https://rpc.testnet.arc.io |
| Chain ID | 5042002 |
| Para birimi | USDC |
| Explorer | https://testnet.arcscan.app |

Resmi ağ kaynağı: https://docs.arc.network/arc/references/connect-to-arc

Test USDC: https://faucet.circle.com . Ağ olarak Arc Testnet'i ve kendi test adresini seç. CAPTCHA/giriş gerekirse kendin tamamla. Gerçek para gönderme. Arc native gas bakiyesi ile ERC-20 USDC aynı varlığın farklı gösterimleri olabilir; iki bakiyeyi toplayıp iki kat varlık varmış gibi yorumlama. Native gas birimi 18, marketplace ERC-20 USDC miktarları 6 ondalık kullanır. İzin/approve penceresindeki spender ve miktarı ayrıca kontrol et.

Profilde beklenen mevcut V2 adresleri:
- Marketplace: `0xFA156B7A5205B123c8a22A807ba98405e36130f1`
- Vault: `0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423`
- USDC ERC-20: `0x3600000000000000000000000000000000000000`

Bunlar checked-in Arc profilidir; Preview hazır olduğunda gerçek `/api/v2/profile` ve zincir readback'i ile tekrar eşleşmelidir. Fark varsa işlem yapma.

## Her senaryoda kaydet

Başlangıç/son durum, job ID, rol, test zamanı, receipt hash/explorer bağlantısı, UI sonucu ve canonical readback. Yeni bir test için yeni küçük test job kullan; tarihsel Job 1–5 üzerinde geçmiş işlemleri tekrar etme. Bekleyen işlem veya belirsiz broadcast varsa yeniden gönderme. Başarı yalnız receipt + canonical readback sonrasında görünmelidir.

### M1 — Cüzdansız gezinme ve V1 izolasyonu
1. SSO ile Preview'a gir; cüzdanı henüz bağlama.
2. `/`, `/jobs`, `/agents` gibi mevcut V1 sayfalarını kontrol et. Sayfa/URL davranışları önceki V1 ile aynı kalmalı.
3. `/v2/jobs`, bir V2 job detayı ve `/v2/jobs/new` aç. Sağlık canlı ve indekslenmiş veri gerçek olmalı; veri yoksa yükleniyor durumunu başarı sayma.
4. Formdaki kategori listesini, çoklu etiketleri, İngilizce saniyesiz tarih + göreli süreyi ve varsayılan işaretli public seçeneğini kontrol et.
5. Open dışındaki işlerde Applications/Apply görünmemeli. Cüzdansız Next action tek açıklama + Connect wallet olmalı. Masaüstü ve mobil genişlikte taşma olmamalı.

### M2 — Ağ ve oturum korumaları
1. Yanlış bir ağ seç; Connect wallet dene. Ağ uyuşmazlığında aksiyonlar kapalı kalmalı.
2. Ağ değiştirmeyi reddet; imza/approve/post gönderilmediğini doğrula.
3. Arc Testnet'e kendin geç; cüzdanı bağla, ardından ayrı Sign in with wallet adımını tamamla.
4. Hesabı değiştir veya bağlantıyı kes. Aksiyon paneli güncellenmeli; eski hesapla işleme izin verilmemeli.

### M3 — Küçük normal iş açma
1. Yeni işte açıklama, kabul kriteri, kategori ve etiketleri doldur. Ödülü 1 test USDC seç; güncel policy bunu kabul etmiyorsa zorlamadan dur.
2. Süreleri saat/gün olarak gir; UTC son başvuru tarihini ve gösterilen göreli süreyi kontrol et.
3. Public işaretli kalsın. Bu seçenek başlık/açıklamanın genel listeye eklenmesini sağlar; zincir verilerini gizlemez.
4. Resolver/policy snapshot'ı ve exact allowance miktarını kontrol et. Sınırsız allowance istememeli.
5. Cüzdan onaylarını tek tek incele. Receipt ve canonical readback sonrası yeni job ID görünmeli; başlık/açıklama listede olmalı.

### M4 — Başvuru ve atama
1. Ayrı, uygun kayıt/stake koşullarını sağlayan operator adresi Open işe başvursun.
2. Başvuru EIP-712 off-chain imzasıdır; doğru chain ID ve Marketplace domain'i kontrol edilmeli.
3. Client oturumuna dön; Load applications ile gerçek başvuruyu seç ve Award yap.
4. Başarılı receipt/readback sonrasında InProgress, atanmış operator ve ayrılan stake eşleşmeli.
5. Applications paneli artık gizlenmeli. Client veya başka cüzdan delivery formunu görmemeli.

### M5 — Tek butonla teslim, reddetme ve tekrar deneme
1. Atanmış operator InProgress işte HTTPS teslim linki girsin. Upload/raw JSON zorunluluğu olmamalı.
2. Submit delivery tek düğme olmalı. Önce manifest kaydı, sonra wallet işlemi başlatılmalı.
3. İlk wallet işlemini bilerek reddet. İş henüz Submitted olmamalı; kaydedilmiş manifest korunmalı.
4. Linki değiştirmeden tekrar dene. Aynı manifest kullanılmalı, ikinci manifest kaydı oluşturulmamalı. Bu kontrol gerekiyorsa yalnız ilgili network isteğinin sayısını kaydet; hassas header/payload paylaşma.
5. İşlemi onayla; Submitted ve teslim hash/version readback'ini kontrol et.
6. Client Approve yapsın; Completed, payout/fee credit doğru olmalı. Payment withdrawal ayrı işlem olarak yapılmalı; credit kaydı ile gerçek token çekimini aynı şey sayma.

### M6 — Revizyon
1. Ayrı bir job'ı Submitted durumuna getir.
2. Client'ın ayrı butonlarından Request revision seç; not/kriter referansını gir ve işlemi onayla.
3. RevisionPending'de yalnız atanmış operator teslim/revizyon formunu görmeli.
4. Operator yeni HTTPS link manifest'ini Submit revision ile sunsun. Version artmalı; önceki teslim içeriği değişmemeli.
5. Client onay ve ayrı ödeme çekimini receipt/readback ile doğrulasın.

### M7 — Mutual settlement
1. Ayrı uygun bir işte Propose settlement ile tam iade veya kısmi ödeme teklifi oluştur; toplamlar/son tarih server policy ile uyumlu olmalı.
2. Karşı taraf ayrı hesabıyla kabul etsin. Eski/expired teklifin kabulü fail-closed reddedilmeli; aynı işlemi tekrar gönderme.
3. Canonical terminal durum ile client/operator credit'lerini kontrol et; çekimleri ayrı işlemler olarak yap.
4. Her taraf yalnız kendi yetkili aksiyonlarını görmeli. UI butonunun gizlenmesini on-chain yetki kontrolünün yerine sayma.

### M8 — Dispute ve atanmış resolver
1. Ayrı uygun bir işte client/operator Open dispute seçsin; receipt/readback ile Disputed doğrulansın.
2. Atanmamış cüzdanla resolver ekranında çözüm yetkisi olmadığını kontrol et.
3. Atanmış resolver kendi cüzdanıyla karar, kanıt referansı, payout ve operatorFault alanlarını incelesin. Test varlıklarıyla dahi slash sonucunu anlamadan onay verme.
4. Karar işlemi sonrası terminal durum, slash/reserved/free stake ve client credit readback'leri uyuşmalı; gerekirse credit ayrıca çekilmeli.

## Durdurma ve rapor

Yanlış ağ/kontrat, stale veya unavailable reader, çelişkili bakiye, tekrarlanan gönderim, receipt olmadan başarı, wallet rejection sonrasında yanlış terminal durum görülürse dur. Broadcast belirsizse mevcut hash'i araştırmadan tekrar deneme. Bulguyu senaryo/job ID, beklenen/gerçek durum ve hassas bilgi içermeyen ekranla bildir. Bulunan sorunları düzeltmek ve Faz 1b'ye geçmek ayrıca Yusuf onayı gerektirir.

Kaynak matris: `contract/docs/v2-app-plan.md`, Faz 1a M1–M8. Bu belge test planıdır; senaryolar çalıştırılmış veya kabul edilmiş değildir.
