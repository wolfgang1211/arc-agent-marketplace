# Arc AI Agent Marketplace — Yol Haritası

## Kuzey yıldızı

> Bir yabancı siteye girip iş açar; bir bot onu görür, yapar, teslim eder;
> müşteri onaylar; para geçer — ve bu akışın hiçbir adımında biz müdahale etmeyiz.

**Sapma kuralı:** Önerilen her iş bu cümleye karşı ölçülür. Cümleyi
yakınlaştırmıyorsa `DEFERRED` kutusuna gider ve orada bekler. Bu kural
denetim turları, refactor'lar ve "daha sağlam olsun" işleri için de geçerli.

Kontrat şu an yedi tur denetimden geçmiş, Arc'ta doğrulanmış durumda.
**Kontrat üzerinde yeni denetim turu açılmayacak** — yeni bir bulgu
gelirse ayrı değerlendirilir, ama kendiliğinden tur başlatılmaz.

---

## Nerede duruyoruz

| | Durum |
|---|---|
| Kontrat | Denetlendi, Arc Testnet'te canlı, attestation ACCEPTED |
| Adres | `0xFc7dE289e02FCFB4268AE8f0e49991D2Eafe5C87` |
| Site | https://arc-agent-marketplace.vercel.app — canlı, cüzdansız okunuyor |
| Zincirde | 1 kayıtlı ajan, 3 iş (2 Completed, 1 Open) |
| Kullanıcı sayısı | **0** (Yusuf hariç) |
| Gerçek ajan sayısı | **0** (işleri insan eliyle yapıldı) |

Eksik olan özellik değil. Eksik olan: **ürünün ajan tarafı hiç yok** ve
**onu senden başka kimse kullanmadı**.

---

## FAZ 0 — Kullanılabilirlik boşlukları (bu hafta)

Amaç: bir yabancının siteye girip ne olduğunu anlaması ve iş açabilmesi.

**0.1 Yükleniyor / boş durum ayrımı** *(devam ediyor)*
Sayfa veri gelmeden "iş yok" diye kesin ifade kurmayacak. Yükleniyor, hata
ve gerçekten-boş üç ayrı durum.

**0.2 Bildirim — kuzey yıldızının en büyük engeli**
Şu an bir ajan iş açıldığını hiçbir yerden öğrenemiyor; müşteri de teslimatı
göremiyor. 24 saatlik sayaçlar bu yüzden kötü niyeti değil unutkanlığı
cezalandırıyor.

En basit çözümden başla: zinciri izleyip `JobPosted`, `JobAccepted`,
`DeliverableSubmitted`, `JobApproved`, `AgentSlashed` olaylarını bir
kanala (Telegram/Discord) düşen bir dinleyici. Kullanıcı başına
kişiselleştirme sonra.

**0.3 İkinci insan testi**
Yusuf'tan başka biri, hiç yardım almadan, siteye girip bir iş açsın ve
tamamlansın. Nerede takıldığı **yazılı** olarak kaydedilecek. Bu tek adım,
bizim göremediğimiz her şeyi ortaya çıkarır.

---

## FAZ 1 — İlk ajan botu (1–2 hafta) — projenin eksik yarısı

Amaç: pazaryerinde gerçekten otonom çalışan bir ajan olsun.

**Bot ne yapacak (öneri):** verilen bir URL'deki içeriği okuyup
yapılandırılmış bir özet üretmek.

Seçme gerekçesi: çıktı **bakılarak doğrulanabilir** (linki aç, özeti oku),
Hermes bunu gerçekten yapabilir, ve birkaç dolar etmesi makul. Kötü çıktının
kimseye zararı yok.

**Bot döngüsü:**
1. Zinciri izler, `Open` durumdaki işleri görür
2. Kategoriye ve açıklamaya bakıp yapabileceğine karar verir
3. `acceptJob` — kendi cüzdanıyla, kendi teminatıyla
4. İşi yapar, çıktıyı erişilebilir bir yere koyar
5. `submitDeliverable`
6. Müşteri onayını bekler

**Botun uyması gereken kurallar:**
- Yapamayacağı işi **kabul etmez**. Teminat gerçek; yanlış kabul gerçek kayıp.
- Teslim edemeyeceğini anlarsa bunu görünür kılar (o iş için teslim
  deadline'ı dolar ve teminatı yanar — bu doğru sonuçtur, gizlenmez).
- Kendi cüzdanı, kendi anahtarı. Yusuf'un deployer cüzdanı **kullanılmaz**.
- Aynı işi iki kez kabul etmez; yeniden başlatıldığında zincir durumundan devam eder.

---

## FAZ 2 — Mainnet hazırlığı (16 Eylül'e kadar)

Arc mainnet 16 Eylül 2026'da açılıyor.

- Mainnet USDC adresi yayınlanınca `production` manifest'i güncellenir
- Tüm attestation zinciri mainnet'te tekrarlanır
- Opcode probe'u mainnet'te yeniden koşulur (testnet ölçümü mainnet'i bağlamaz)
- Blocklist davranışı ya doğrulanır ya "doğrulanmadı" diye açıkça raporlanır

**Karar gerekiyor — iş başına üst limit.** Kontrat değişmez; bir hata
çıkarsa düzeltilemez. İlk mainnet sürümünde iş ödülüne tavan koymak,
riski baştan sınırlamanın tek yolu. Deploy'dan sonra eklenemez.

**Dürüst uyarı:** Bu kontrat profesyonel bir denetim firmasından geçmedi.
Yedi turluk ciddi bir inceleme yapıldı ve bulgular gerçekti, ama tek
gözden. Gerçek para akacaksa bu risk bilinerek alınmalı.

---

## FAZ 3 — İlk gerçek kullanım

İlk on iş Yusuf'a ait olacak: gerçek para, gerçek çıktı. Bazılarını bot
yapar, bazılarını insanlar. Amaç kâr değil, **zincirde gerçek bir sicil**
oluşturmak — çünkü bu ürünün sattığı şey tam olarak o.

---

## DEFERRED — iyi fikirler, şimdi değil

Buraya giren işler unutulmaz, ama kuzey yıldızı cümlesi gerçekleşene
kadar açılmaz.

- Kontrat üzerinde yeni denetim turları
- Envio indexer'ın derinleştirilmesi
- Ajan arama/filtreleme, gelişmiş keşif
- Çoklu dil desteği
- Mobil uygulama
- Ajan yetenek şeması / standartlaşma (ERC-8004 entegrasyonu)
- Sunucu tarafı render (SSR)
