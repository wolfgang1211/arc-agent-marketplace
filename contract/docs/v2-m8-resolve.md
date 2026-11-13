# M8: tek işe hakem kararı

## Kapsam ve yetki

`approved-v2-executor.js --phase=resolve` (veya `resolve`) geniş deploy/config/scenario yolundan **önce** dar modüle ayrılır. Solidity, deployed manifest, web live-signer köprüsü, V1, bot ve bulut değiştirilmez. Bu checkpoint geliştirme ve yerel testtir: gerçek keystore/DPAPI, testnet signing veya broadcast çalıştırılmadı.

Yalnız Arc `5042002`, resmi RPC `https://rpc.testnet.arc.io`, pinned V2 marketplace/vault/USDC ve client `0x460EBe282Fb0e42B4d682a7f9EF408302417F780`. Ödül pozitif ve en fazla `5000000` raw USDC. Pair bağları, gerçek runtime hash/normalized hash, token decimals, canonical snapshot ve resolver/party ayrımı doğrulanır. Test enjeksiyonu JSON/CLI'den açılmaz; izole testlerde dahi gerçek chain ID 5042002 zorunludur.

## Önizleme

Contract dizininden CMD, yalnız public karar girdisi:

```bat
node scripts\approved-v2-executor.js --phase=resolve < decision.json
```

```json
{
  "jobId": "123",
  "decision": {
    "kind": "resolveDispute",
    "grossPayout": "2000000",
    "operatorFault": false,
    "reasonHash": "0x...64 hex...",
    "evidenceHash": "0x...64 hex..."
  }
}
```

Hash örnekleri şablondur, çalışır değer değildir. Refund kontrat kuralıyla `reward - grossPayout` olarak hesaplanır. Fault-review kararı `kind: resolveFaultReview`, `slash` raw miktarı ve aynı iki nonzero hash'i taşır; `grossPayout/operatorFault` yerine `slash` kullanılır. Tek jobId, katı decimal string tutarlar, açık boolean ve bilinen alanlar zorunludur. Batch/jobIds, endpoint/deployment override ve karışık komutlar reddedilir.

Önizleme canonical blok/hash, job/stateVersion, resolver, karar, fee/refund/operator/client credit, stake/slash/escrow etkileri, ön muhasebe, exact calldata ve gas bütçesini içerir. Digest bütün bunları ve beş dakikalık süreyi bağlar. Fault review ödülü tekrar escrow'dan düşmez; yalnız slash liability ve rezerv etkilerini uygular.

## İnsan onayı ve çalıştırma

1. Hermes önce önizlemeyi Yusuf'a gösterir. Yusuf **o job, karar ve digest** için sohbette açıkça onay vermeden execute çağrılmaz. CLI JSON işareti, tek başına sohbet onayının kanıtı değildir; bunu insan operatör/Hermes iş akışı uygular. Cron, genel devam komutu veya önceki bir onay yeniden kullanılamaz.
2. Kontrollü execute girdisi public `preview` nesnesinin tamamını ve `approval` alanını taşır: `approved: true`, aynı `digest`, `jobId`, `blockHash`, `stateVersion` ve önizlemenin son kullanma süresini aşmayan decimal-string `expiresAt`.
3. Üretim yolu ayrıca `--execute-arc-testnet-v2 --execute` ve `mode: execute` ister. `--readonly/--plan` ile execute birleşirse reddedilir. Bu doküman execute yetkisi değildir.
4. Eski anchor hâlâ canonical olmalı; güncel job/credit/escrow/stake state önizlemeyle aynı kalmalı. Sadece yeni boş blok gelmesi onayı bozmaz; state değişmesi/expiry yeni önizleme ve onay gerektirir.
5. Wallet erişiminden **önce** exact `eth_call`, estimate ve gas sınırı, taze state kontrolü ve kalıcı exclusive job/stateVersion claim uygulanır. İmzalı gas üst sınırı 1,000,000 birim, gas fiyatı en fazla 45,000,000,000 wei; önizleme bu üst bütçeyi gösterir.
6. Yalnız canonical job resolver'ıyla eşleşen, mevcut onaylı `owner` veya `resolver` rolü yüklenebilir. Client/operator hesapları asla yüklenmez. Gerçek secret aktarımı yalnız mevcut güvenli operatör kanalıyla yapılmalıdır; parola/anahtar sohbetten istenmez, `decision.json` veya repo içine konmaz. Gerçek secret hand-off bu yerel testte denenmedi.
7. İmzalı raw transaction decode edilip from/to/calldata/value/chain/nonce/gas ile karşılaştırılır. Public transaction hash **broadcast öncesinde** fsync edilir; raw signature kaydedilmez.
8. Bir kez gönderilir; receipt, canonical block, gerçek transaction ve beklenen karar olayı bağlanır. Job version/status/rezerv, aktif işler, actor credit ve stake farkları ile iki korunum denklemi doğrulanmadan `confirmed` dönmez.

Kalıcı ledger: `%LOCALAPPDATA%\hermes\state\alphaboard-v2-local-arc\m8-resolve`. Anahtar chain/pair/job/stateVersion'dır; yeni blok veya farklı karar digest'i aynı state için ikinci gönderime izin vermez. Ledger claim/signed hash belirsiz kalırsa yeniden imzalama/gönderim yoktur; hash'ten salt-okuma uzlaştırması ve yeni insan kararı gerekir. Lock dosyası otomatik silinmez. Main/readonly/preview akışlarında key erişimi yoktur.

## Yerel kabul kanıtı

Parent gerçek chain ID **5042002** ile izole in-process Hardhat config ekledi. Değişmemiş V2 artifact bytecode'u deploy edildi; fixture client impersonation yalnız bu izole EVM'dedir. İlk worker'ın 31337 üzerinde test istisnası ve 2-test sonucu bu kapının kanıtı sayılmadı.

```bat
node node_modules\hardhat\internal\cli\cli.js test --no-compile --config hardhat.m8.config.js test/approved-v2-resolve.test.js
```

Parent sonucu: **14 passing, 0 failing**. Gerçek dispute/fault-review ve operatorFault slash; receipt/readback/action deltas/conservation; yanlış client, reward, payout/slash, status ve chain; explicit boolean; expiry/altered/stale state; yeni boş blok; farklı digest'lerle eşzamanlı claim; imzayı değiştiren signer; bozuk tx readback; belirsiz broadcast sonrası duplicate/restart engeli; production arming/readonly çakışması kontrol edildi.

Ayrı legacy config `31337` altında existing approved-executor, V2 accounting, disputes ve stake-review regresyonları: **24 passing, 0 failing**. Bu, full-repository suite veya public testnet execute kabulü değildir. Public-chain resolve, gerçek secret aktarımı ve live signer aktivasyonu yapılmadı.

Son frozen-source parent koşusu: exit 0, 14 passing, sourceUnchanged true; kaynak SHA-256 `e930a3ffdc0a095dbcbf967bbfbdaf2d5fbf2fc4660aeaf82cde80931a6bce91`. Raw log: `%LOCALAPPDATA%/hermes/cache/scratch/v2-nov13/m8-parent-final-eof.log`. Bağımsız salt-okuma incelemesi critical/high blocker bildirmedi; bu formal audit veya gerçek keystore/testnet execute sertifikası değildir.
