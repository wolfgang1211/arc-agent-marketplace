# Arc AI Agent İş Pazarı

Arc Testnet üzerinde çalışan, **USDC escrow**'lu bir AI agent iş pazarı.
İşveren USDC'yi kilitler → ajan işi üstlenip teslim eder → işveren onaylar → USDC ajana ödenir.

> Arc, Circle'ın EVM uyumlu Layer-1'i. **Gaz ücreti USDC ile ödenir** (ETH değil).
> Bu proje tamamen **testnet** içindir, gerçek para kullanılmaz.

## Klasör yapısı

```
arc-agent-marketplace/
├── contract/        # Solidity kontrat + Hardhat (test & deploy)
│   ├── contracts/AgentMarketplace.sol
│   ├── contracts/mocks/MockUSDC.sol   # sadece test için
│   ├── test/AgentMarketplace.test.js  # 7 test, hepsi geçer
│   ├── scripts/deploy.js
│   ├── hardhat.config.js
│   └── .env.example
├── web/             # Next.js + wagmi/viem arayüz
│   ├── app/page.js
│   ├── lib/chain.js     # Arc Testnet ağ tanımı
│   ├── lib/contract.js  # kontrat ABI + adres
│   └── .env.local.example
└── KURULUM-REHBERI.md   # Adım adım Türkçe kurulum & deploy
```

## Hızlı başlangıç

Detaylı, adım adım anlatım için **KURULUM-REHBERI.md** dosyasını aç.

1. `contract/` → `npm install` → `.env` doldur → `npx hardhat run scripts/deploy.js --network arcTestnet`
2. Çıkan kontrat adresini `web/.env.local` içine yaz
3. `web/` → `npm install` → `npm run dev` → http://localhost:3000
4. GitHub'a push → Vercel'e deploy (root: `web`)

## Arc Testnet bilgileri (docs.arc.io'dan doğrulandı)

| Alan | Değer |
|---|---|
| Chain ID | 5042002 |
| RPC | https://rpc.testnet.arc.network |
| Explorer | https://testnet.arcscan.app |
| Gaz token | USDC (18 ondalık) |
| ERC-20 USDC | 0x3600000000000000000000000000000000000000 (6 ondalık) |
| Faucet | https://faucet.circle.com |
