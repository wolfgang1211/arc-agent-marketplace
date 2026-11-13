# Claude için bağımsız QA notları

## Güncel düzeltme turu: QA-WALLET-001 kapatıldı, önem Orta

Bu bölüm aşağıdaki tarihsel cron bulgularının güncel durumunu geçersiz kılar. Saatlik cron kapalı kalır.

- Genuine RED: 68 test, 53 pass, 15 fail, exit 1 (`red-missing-binding.log`).
- GREEN wallet: 68 pass, 0 fail, exit 0. Parent wallet/React/profile/transport/reader: 95 pass, 0 fail, exit 0.
- Bu dosyadaki bağımsız offline probe yeniden çalıştırıldı: exit 0; rejected=true, readbacks=0, sendCalls=0, pendingPreserved=true.
- Resume canonical transaction doğrulaması koşulsuz; eksik `to`/`calldataHash` reddedilir, recipient fallback kaldırıldı. Explicit reconcile aynı validator üzerinden geçer; React resume bu guard'a delege eder. Diğer resume yollarında benzer koşullu bypass bulunmadı.
- Ana/approval pozitif fixture'larına gerçek ABI calldata ve bound transaction bilgisi eklendi; doğrulama veya assertion gevşetilmedi. Parent izole local-chain-flow + local-indexer-sync: 2/2 pass, exit 0; mevcut süreçler ve 8545 değiştirilmedi.
- Tam seri suite, production-default build ve yeni ekranların nihai sonuçları `contract/docs/v2-acceptance-handoff.md` üzerinden takip edilir. Önceki test sayıları ve açık/Yüksek sınıflaması aşağıda yalnız tarihsel kanıttır.

## Önceki cron turu (tarihsel)

- Latest checked: 2026-11-01 16:11 +03:00. Önceki turdaki çakışan Next/Hardhat süreçleri artık görünmedi; bu tur busy değil. Dal `feat/marketplace-v2`, HEAD `9120f6755151a81701f78ac7ad4e5039cfdfc26b`.
- Hedefli sekiz test dosyası seri: **79/79 pass, exit 0**. Production-default build: **exit 0**, `NODE_ENV=production`, `V2_CHAIN_PROFILE` ve `V2_LOCAL_UI_STATE` kaldırıldı. İki mevcut exhaustive-deps uyarısı: `web/app/v2/account/page.js:7`, `web/app/v2/jobs/[id]/page.js:9`. Ayrı typecheck script'i yok; build lint/type kontrolünü çalıştırdı.
- Python ile 65 mevcut dosyadan seçilen 62 dosyada geniş seri suite: **557 tests, 551 pass, 0 fail, 6 skipped, exit 0**. Altı skip gerçek Postgres testleri; testlerde `V2_RUN_REAL_PG=0`, `V2_REAL_PG_APPROVED=0`, DSN kaldırıldı. Hedefli testler geniş suite içinde de var; sayılar toplanmaz.
- Dosya bazlı hariçler: `test/v2-local-edge-e2e.test.mjs` (browser yasağı), `test/v2-local-chain-flow.test.mjs` ve `test/v2-local-indexer-sync.test.mjs` (contract deployment helper'ının tüm kalıcı yan etkileri güvenlik denetimi tamamlanmadığı için muhafazakâr skip). Bu iki local EVM gate geçmiş/geçti sayılmadı. Gerçek DB, public RPC, mevcut 8545, gerçek cüzdan ve browser/screenshot kabulü yapılmadı. Güncel screenshot yolu yalnız `contract/docs/v2-ui-screenshots/edge-current/`.
- **QA-WALLET-001 dinamik olarak yeniden doğrulandı, açık**: aşağıdaki bağımsız offline probe **exit 1**. Gerçek gözlem: `rejected=false`, `phase=success`, `readbacks=1`, `canonicalTransactionReads=0`, `sendCalls=0`, `pendingPreserved=false`. Yeşil mevcut suite bu sınırı kapsamıyor. Bu yalnız bellek içi fixture kanıtıdır, chain işlemi değildir.
- Sekiz `node --check` ve staged/unstaged whitespace kontrolleri exit 0. AGENTS.md/CLAUDE.md kök/üst dizinlerde ve web kaynak dizinlerinde bulunmadı. Kaynak ve index değiştirilmedi; build yalnız üretilen çıktıları yeniledi. 179 kaynak/config dosyasının HEAD/index ve fingerprint'i her aşama öncesi/sonrası sabit: `188d9639dec4cc56e2ccd29a9795156428e2d1bd61923a006b49679922e18518`; stale yok.
- Kanıt ve makine özeti: `C:/Users/wolfgang/AppData/Local/hermes/qa/marketplace-v2/20261101T1600-review/summary.json`. Ayrı redakte TAP/build/probe logları, dosya hash haritaları, staged/unstaged diff ve yeniden üretim script'i aynı dizinde. Kaynak düzeltmesi, git yazısı, mesaj veya deploy yok.

### 06:00 turu (tarihsel)

- Latest checked: 2026-11-01 06:00 +03:00 (Türkiye). Yeni bulgu veya çözülme yok. Aynı-repo Next PID 32028 ve Next dev parent PID 39172 halen aktif olduğundan bu tur da **busy/skipped**; test/build/probe çalıştırılmadı, süreçlere ve 8545'e dokunulmadı. Preview PID 33660 ve Hardhat fixture PID 14728 de süreç listesinde görüldü.
- 06:00 kanıtı: `C:/Users/wolfgang/AppData/Local/hermes/qa/marketplace-v2/20261101T060040+0300/summary.json`. Sekiz syntax kontrolü ve iki whitespace kontrolü exit 0; test/build counts ve exit N/A (busy). Python ile 65 dosyadan 64 aday üretildi; `test/v2-local-edge-e2e.test.mjs` hariç, adayların güvenlik incelemesi tamamlanmadı. AGENTS.md/CLAUDE.md kök/üst dizinlerde ve taranan web kaynak dizinlerinde bulunmadı. package.json ve v2-verify-web.py güncel olarak okundu; browser testini de toplayan script bu tur çalıştırılmadı.
- 06:00 HEAD `9120f6755151a81701f78ac7ad4e5039cfdfc26b`, dal `feat/marketplace-v2`; 179 kaynak/config dosyasının öncesi/sonrası fingerprint'i `188d9639dec4cc56e2ccd29a9795156428e2d1bd61923a006b49679922e18518`, 05:01 ile aynı; index hash'i değişmedi. Kaynak/index değiştirilmedi. Staged/unstaged web farkları, status ve son commitler ayrı loglarda korundu. Önceki 05:01 özeti okundu ve korundu.
- `QA-WALLET-001` :95 koşullu gate ve :100 fallback güncel kaynakta yeniden görüldü; iki alanın birlikte yokluğu regresyon tablosunda halen yok. Dinamik yeniden üretim yok; bulgu açık. Aşağıdaki 03:01 ve 01:02 ayrıntıları tarihsel olarak korunmuştur.

### 03:01 turu (tarihsel)

- Latest checked: 2026-11-01 03:01 +03:00 (Türkiye). Önceki 02:01 turu ile aynı kapsam ve aynı fingerprint; yeni bulgu veya çözülme yok.
- Bu tur: **busy/skipped**. Aynı-repo Next preview PID 32028, Next dev parent PID 39172 ve Hardhat fixture PID 14728 halen çalışıyor. Test/build/offline probe başlatılmadı, mevcut süreçlere ve 8545'e dokunulmadı.
- Dal/HEAD değişmedi. 186 web app/lib/test/scripts ve kök config dosyasının öncesi/sonrası fingerprint'i aynı: `e852a3b9c20be876ba7ccb577148521120ccbf66235fee08b9df4f6c20b740a7`. Bu kapsam önceki turun 254 dosyalık kapsamıyla doğrudan kıyaslanmaz. Env, node_modules ve generated build çıktıları dahil değildir.
- Sekiz dosyada `node --check` (wallet execution, wallet execution testi, resume React testi, API actions/read/runtime/private, API action-context testi), staged/unstaged `git diff --check`: tümü exit 0. Bunlar test kabulü değildir.
- Hedefli/geniş test counts ve exit: N/A (busy). Production-default build exit: N/A (busy). Python ile 65 mevcut test dosyasından aday liste üretildi; `test/v2-local-edge-e2e.test.mjs` açıkça hariç. Diğer adayların güvenlik incelemesi tamamlanmadı, hiçbiri çalıştırılmadı.
- `QA-WALLET-001` güncel kaynakta yeniden görüldü: `:95` koşullu canonical gate ve `:100` recipient fallback değişmemiş; test tablosunda iki alanın birlikte yokluğu halen yok. Dinamik RED/GREEN yok, bulgu kapatılmadı. Kaynak/index değiştirilmedi; staged/unstaged web diff'leri ve son commitler ayrı kaydedildi. Kök/üst dizinler ve web kaynak ağacında AGENTS.md/CLAUDE.md bulunmadı.
- Yeni tur log/özet: `C:/Users/wolfgang/AppData/Local/hermes/qa/marketplace-v2/20261101T030118+0300/summary.json`. Önceki `20261101T020125+0300/summary.json` özeti okundu ve korundu. Git index hash'i de değişmedi. Gerçek DB, public RPC, EVM/cüzdan ve browser/screenshot kabulü yapılmadı.

### Önceki tur kanıtı (tarihsel)

- Latest checked: 2026-11-01 01:02 +03:00 (Türkiye).
- Dal: `feat/marketplace-v2`; HEAD: `9120f6755151a81701f78ac7ad4e5039cfdfc26b`.
- Sonuç: **busy/skipped**. Mevcut aynı-repo local browser preview PID 33660, Next dev PID 39172/32028 ve Hardhat PID 14728 nedeniyle çakışabilecek test/build başlatılmadı. Hiçbir mevcut süreç durdurulmadı; 8545'e istek gönderilmedi.
- Kaynak kodu, index, kontratlar, env ve kullanıcı çalışmaları değiştirilmedi. Staged ve unstaged değişiklikler ayrı incelendi. Kök/üst dizinler ve web kaynak ağacında AGENTS.md/CLAUDE.md bulunmadı.
- Önceki QA not dosyası veya belirtilen QA klasöründe önceki tur kaydı bulunmadı. Geçmiş bulgu yalnız aşağıdaki güncel kaynak incelemesiyle değerlendirildi.
- 254 web kaynak/config/test dosyası için öncesi/sonrası birleşik SHA-256 aynı: `32e7135a9b4156008cee14a38c47cd2a5c73f17c1bf424728d287ee3d1bb6381`. Tam dosya hash haritası log dizininde. HEAD de sabit.
- `git diff --check` ve `git diff --cached --check`: exit 0. CRLF uyarıları whitespace hatası değildir.
- `node --check`: wallet execution, wallet execution testi, wallet resume React testi, API actions ve API read modüllerinin tamamı exit 0. Bunlar yalnız syntax kontrolüdür, test değildir.
- Hedefli testler, geniş seri web suite ve production-default build: **çalıştırılmadı, busy**. Test sayısı/exit ve build exit: N/A; geçti sayılmadı.
- Python ile mevcut dosyalardan aday geniş test listesi üretildi. `test/v2-local-edge-e2e.test.mjs` açıkça hariç tutuldu. Diğer adayların çalıştırma güvenliği henüz tam incelenmedi. Real Postgres, public RPC, gerçek EVM/cüzdan, browser/screenshot kabulü yapılmadı. Güncel screenshot yolu `contract/docs/v2-ui-screenshots/edge-current/`; ekranlar yeniden kabul edilmedi.
- Kanıt/log: `C:/Users/wolfgang/AppData/Local/hermes/qa/marketplace-v2/20261101T010205+0300/summary.json` ve aynı dizindeki ayrı log/fingerprint dosyaları.

## QA-WALLET-001 | Yüksek | Açık, dinamik olarak yeniden doğrulandı

- Latest checked: 2026-11-01 16:11 +03:00. HEAD `9120f6755151a81701f78ac7ad4e5039cfdfc26b`; wallet source SHA-256 `5218a0346c15f2d50de888dd5ee945bde4024745879b05ce37524296af12ee39`. Güncel koşullu gate `web/lib/v2/new-wallet-execution.mjs:95`; fallback `:100`. Regresyon tablosu `web/test/v2-wallet-execution.test.mjs:191-235` iki binding alanının birlikte yokluğunu kapsamıyor.
- Beklenen: canonical bağlama kanıtı eksikse `reconciliation-required`, readback=0, send=0, pending korunmalı. Gerçek: bellek içi provider ile `phase=success`, readback=1, canonical transaction read=0, send=0 ve pending silindi. Assertion başarısız, **exit 1**; harness/import hatası değil. Mevcut hedefli 79 ve geniş 551 pass bu eksik satırı kanıtlamıyor.
- Bu tur çalıştırılan tam yeniden üretim (PowerShell, repo kökünden):
  ```powershell
  Set-Location 'C:/Users/wolfgang/arc-agent-marketplace/arc-agent-marketplace/web'
  $env:V2_RUN_REAL_PG='0'; $env:V2_REAL_PG_APPROVED='0'; Remove-Item Env:V2_REAL_PG_DSN -ErrorAction SilentlyContinue
  node 'C:/Users/wolfgang/AppData/Local/hermes/qa/marketplace-v2/20261101T1600-review/missing-binding-probe.mjs'
  ```
- Gerçekte QA runner aynı `node` argv'sini `cwd=web` ile çalıştırdı; komut/result ve redakte çıktı `missing-binding-probe-result.json` / `missing-binding-probe.log` içinde. Script yalnız bellek içi fixture kullanır; hiçbir network isteği veya transaction gönderimi yoktur. Kaynak sabit, probe öncesi/sonrası fingerprint aynı.
- En küçük çözüm: main resume canonical validation'ı persisted metadata varlığına bağlama; eksik/bozuk `to` ve `calldataHash` değerlerini fallback ile tamamlamak yerine fail-closed reddet. Önce yok/null/boş alan kombinasyonları için regresyon ekle; no readback/no send/pending preserved ve geçerli main/approval pozitif satırlarını doğrula. Sonra hedefli ve geniş seri suite/build'i tekrar çalıştır. Kod bu cron tarafından değiştirilmedi.

### 06:00 statik kontrol ve eski yeniden üretim (tarihsel)

- Latest checked: 2026-11-01 06:00 +03:00. Güncel fingerprint ve kontrol sınırları Son tur bölümünde. :95 koşullu gate ve :100 fallback yeniden görüldü. Aşağıdaki 01:02 kanıtı tarihsel olarak korunmuştur. Bu tur da dinamik probe busy nedeniyle çalıştırılmadı.
- Kaynak: `web/lib/v2/new-wallet-execution.mjs:95`, canonical validator `:97-117`.
- Regresyon kapsamı: `web/test/v2-wallet-execution.test.mjs:186-235`.
- HEAD/fingerprint: yukarıdaki son tur ile aynı.
- Güncel gerçek statik davranış: `resumeWalletIntent`, canonical transaction doğrulamasını hâlâ `if (stored.to || stored.calldataHash || stored.kind === 'approval')` koşuluyla çağırıyor. Main pending record'da `to` ve `calldataHash` birlikte yoksa bu çağrı atlanıyor; receipt/readback dalına ilerlemek mümkün. Yeni test tablosu yanlış transaction target/from/data/chain/value ve forged approval senaryolarını ekliyor, fakat iki persisted alanın birlikte yokluğunu sınamıyor.
- Beklenen: eksik canonical bağlama kanıtı `reconciliation-required` ile fail-closed reddedilmeli; success, pending kaydı temizleme, yeni gönderim veya readback çağrısı olmamalı.
- Güven sınırı: bu tur **dinamik yeniden üretim yapılmadı**. Tarihsel adversarial probe sonucunu güncel test sonucu olarak kullanmıyorum. Aşağıdaki offline probe, busy durumu bittikten sonra çalıştırılmak üzere verilmiştir; bu tur probe exit code/test count **N/A (busy)**. Yukarıdaki syntax/whitespace kontrollerinin gerçek exit code'u 0'dır.

### Bağımsız offline yeniden üretim

PowerShell'de repo `web` dizininden aşağıdaki komutu çalıştır. Bu komut gerçek provider/network kullanmaz, bellek içi fixture döndürür ve transaction gönderimini kabul etmez. Fixture sonucu gerçek chain kanıtı değildir. Sağlam implementasyonda assertion geçmeli; mevcut koşul atlandığında `assert.rejects` reddedilme beklerken çözülmüş promise görecektir.

```powershell
$env:V2_RUN_REAL_PG='0'; $env:V2_REAL_PG_APPROVED='0'; Remove-Item Env:V2_REAL_PG_DSN -ErrorAction SilentlyContinue
node --input-type=module -e '
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const { resumeWalletIntent } = await import(pathToFileURL(resolve("lib/v2/new-wallet-execution.mjs")));
const wallet = "0x" + "11".repeat(20);
const profile = { id:"offline-qa", chainId:"31337", rpcUrl:"https://rpc.invalid", marketplace:"0x"+"22".repeat(20), vault:"0x"+"33".repeat(20), usdc:"0x"+"44".repeat(20) };
const hash = "0x" + "55".repeat(32);
const stored = { intentId:"qa-missing-binding", profileId:profile.id, chainId:profile.chainId, wallet, action:"approve", kind:"main", status:"broadcast", hash, autoResume:true, resumeAttempts:0 };
const map = new Map();
globalThis.localStorage = { get length(){ return map.size; }, key:i=>[...map.keys()][i]??null, getItem:k=>map.get(k)??null, setItem:(k,v)=>map.set(k,String(v)), removeItem:k=>map.delete(k) };
let readbacks = 0;
const calls = [];
const provider = { request:async ({method})=>{ calls.push(method); if(method==="eth_accounts") return [wallet]; if(method==="eth_chainId") return "0x7a69"; if(method==="eth_getTransactionReceipt") return { status:"0x1", transactionHash:hash }; throw new Error("OFFLINE_UNEXPECTED_METHOD"); } };
const readback = async ()=>{ readbacks++; return { ok:true, confirmed:true, intentId:stored.intentId, profileId:profile.id, chainId:profile.chainId, wallet, action:stored.action, hash, state:{ stateVersion:"4" } }; };
await assert.rejects(()=>resumeWalletIntent({stored,profile,provider,readback,receiptTimeoutMs:0}),e=>e.code==="reconciliation-required");
assert.equal(readbacks,0);
assert.equal(calls.includes("eth_sendTransaction"),false);
'
```

### En küçük önerilen çözüm ve tekrar doğrulama

1. Main resume için canonical doğrulamayı metadata varlığına bağlama. Eksik/bozuk `to` ve `calldataHash` değerlerini açık ve güvenli hata koduyla reddet; gerekirse validator'ın mevcut `stored.to || expectedTarget` fallback'ini de fail-closed yap. Kaydı otomatik silme veya yeniden gönderme.
2. Önce eksik `to`, eksik `calldataHash`, ikisi eksik/null/boş varyantlarını kapsayan davranışsal RED regresyonları ekle. Hata kodu, readback sayısı 0, gönderim sayısı 0 ve pending kaydın korunmasını doğrula. Tam geçerli main/approval pozitif senaryolarını koru.
3. Busy süreçler bittikten sonra hedefli wallet execution + resume React + chain profile + profile transport + chain reader + API actions/read/action-context testlerini seri çalıştır. Ardından browser/real DB/public-network yazısı içermeyen geniş suite ve temiz production-default build'i ayrı aşamalarda doğrula. Önce/sonra HEAD ve içerik hash'i değişirse sonuç stale/inconclusive.
4. Dinamik RED ve GREEN gerçek exit/count kanıtı eklenmeden bu bulguyu çözüldü sayma.
