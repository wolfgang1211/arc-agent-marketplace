# Adım Adım Kurulum & Deploy Rehberi

Bu rehber, hiç yazılım bilmeden projeyi kendi bilgisayarında çalıştırıp internete
yayınlaman için yazıldı. Sırayla takip et. Her komutu **olduğu gibi** kopyala-yapıştır.

> Önemli: Her şey **Arc Testnet** üzerinde. Gerçek para YOK. Sadece test parası (USDC) kullanacağız.

---

## 0) Önce bunları kur (tek seferlik)

1. **Node.js (LTS)** — https://nodejs.org → "LTS" sürümünü indir ve kur.
   - Kontrol: terminal/PowerShell aç, `node -v` yaz. Bir sürüm numarası görmelisin.
2. **VS Code** — https://code.visualstudio.com → indir, kur.
3. **MetaMask** (tarayıcı cüzdanı) — https://metamask.io/download → tarayıcına ekle.
   - **YENİ ve boş bir cüzdan oluştur** (bu projeye özel). Asıl/paralı cüzdanını KULLANMA.
4. **Git** (GitHub'a yüklemek için) — https://git-scm.com/downloads → kur.

---

## 1) Projeyi VS Code'da aç

1. Bu `arc-agent-marketplace` klasörünü bilgisayarına indir/çıkart.
2. VS Code → **File → Open Folder** → `arc-agent-marketplace` klasörünü seç.
3. Üstten **Terminal → New Terminal** ile bir terminal aç.

---

## 2) MetaMask'a Arc Testnet'i ekle ve test parası al

1. MetaMask → ağ menüsü → **Add a custom network** ve şunları gir:
   - Network name: `Arc Testnet`
   - RPC URL: `https://rpc.testnet.arc.network`
   - Chain ID: `5042002`
   - Currency symbol: `USDC`
   - Block explorer: `https://testnet.arcscan.app`
2. **Faucet'ten USDC al:** https://faucet.circle.com → cüzdan adresini yapıştır → Arc Testnet seç → USDC iste.
   - Not: Hem **gaz için USDC** hem de **escrow için USDC** lazım; faucet ikisini de verir. İşlem yapmadan önce bakiyenin geldiğini MetaMask'ta gör.

---

## 3) Kontratı Arc Testnet'e deploy et

Terminalde sırayla:

```bash
cd contract
npm install
```

`.env` dosyasını oluştur: `contract` klasöründeki `.env.example` dosyasını kopyalayıp adını `.env` yap.
İçine **test cüzdanının private key'ini** yaz:

```
PRIVATE_KEY=buraya_private_key
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
```

> **Private key nasıl alınır?** MetaMask → hesap menüsü → **Account details → Show private key** →
> şifreni gir → kopyala. **Sadece bu test cüzdanının** key'ini kullan. Bu satırı kimseyle paylaşma,
> GitHub'a yükleme (`.env` zaten `.gitignore`'da, otomatik gizli kalır).

(İsteğe bağlı) Testleri çalıştır — hepsi geçmeli:

```bash
npx hardhat test
```

Deploy et:

```bash
npx hardhat run scripts/deploy.js --network arcTestnet
```

Çıktıda şuna benzer bir satır göreceksin:

```
AgentMarketplace deployed to: 0xABC123...
Explorer: https://testnet.arcscan.app/address/0xABC123...
```

**Bu adresi kopyala** — birazdan lazım olacak. Explorer linkine tıklayıp kontratını zincirde görebilirsin.

> Hata alırsan: çoğu hatanın sebebi gaz için cüzdanda **native USDC** olmamasıdır. Faucet'ten tekrar USDC al ve dene.

---

## 4) Arayüzü (web) kendi bilgisayarında çalıştır

Yeni bir terminal aç (veya `cd ..` ile geri dön):

```bash
cd web
npm install
```

`web` klasöründe `.env.local.example` dosyasını kopyala, adını `.env.local` yap ve içine
3. adımda kopyaladığın kontrat adresini yaz:

```
NEXT_PUBLIC_CONTRACT_ADDRESS=0xABC123...
```

Çalıştır:

```bash
npm run dev
```

Tarayıcıda **http://localhost:3000** aç. Akış:

1. **Cüzdan bağla** (MetaMask) → gerekirse **Arc Testnet'e geç** butonu çıkar.
2. **Ajan olarak kaydol** (isim + beceri).
3. **İş ilanı aç** → önce USDC `approve`, sonra ilan (iki imza).
4. Başka bir cüzdanla (veya arkadaşınla) **işi üstlen → teslim et**.
5. İşveren **Onayla ve öde** → USDC ajana gider. Her işlemde **Explorer** linki çıkar.

> İki taraflı test için MetaMask'ta ikinci bir hesap ekleyip ona da faucet'ten USDC alabilirsin.

---

## 5) GitHub'a yükle

1. https://github.com → sağ üst **+ → New repository** → isim ver → **Create repository**.
2. Açılan sayfadaki repo linkini kopyala (örn. `https://github.com/kullanici/arc-agent-marketplace.git`).
3. Proje **ana klasöründe** (arc-agent-marketplace) terminalde:

```bash
git init
git add .
git commit -m "Arc AI agent marketplace"
git branch -M main
git remote add origin BURAYA_REPO_LINKI
git push -u origin main
```

> `.env` ve `node_modules` otomatik dışarıda kalır (`.gitignore` sağ olsun). Private key GitHub'a gitmez.

---

## 6) Vercel'e deploy (arayüzü internete yayınla)

1. https://vercel.com → GitHub ile kayıt ol / giriş yap.
2. **Add New → Project** → GitHub reposunu seç → **Import**.
3. **Önemli ayarlar:**
   - **Root Directory**: `web` (klasörü `web` olarak seç — proje arayüzü orada).
   - **Environment Variables**: `NEXT_PUBLIC_CONTRACT_ADDRESS` = deploy ettiğin kontrat adresi.
4. **Deploy**'a bas. Bitince sana bir `https://...vercel.app` adresi verir — siten yayında!

> Deploy hatası alırsan: çoğunlukla ya Root Directory `web` seçilmemiştir ya da environment
> variable eklenmemiştir. İkisini düzeltip tekrar deploy et.

---

## Sık karşılaşılan sorunlar

- **"Yanlış ağdasın" uyarısı:** Arayüzdeki "Arc Testnet'e geç" butonuna bas.
- **İşlem göndermiyor / gaz hatası:** Cüzdanda gaz için **native USDC** yok. Faucet'ten al.
- **"ERC-20 USDC bakiyen yetersiz":** Escrow için yatıracağın USDC yetmiyor; faucet'ten al.
- **Bakiye var ama yine de gaz hatası:** Arc'ta gaz **native USDC** ile ödenir; ERC-20 USDC ile karıştırma.
- **Kontrat adresi tanımlı değil:** `web/.env.local` içine adresi yazıp `npm run dev`'i yeniden başlat.

## Güvenlik hatırlatması

- Private key'i **sadece** boş/test cüzdanı için kullan, kimseyle paylaşma.
- `.env` ve `.env.local` dosyalarını asla GitHub'a yükleme (otomatik gizli, dokunma yeter).
- Bu proje testnet içindir; mainnet'e / gerçek paraya geçmeden önce profesyonel güvenlik denetimi şart.
