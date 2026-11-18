# V2 karar oncesi bilgi taramasi

Kapsam: mutual kabul, revizyon istegi ve dispute cozumu. Kaynak baseline: `0f59e1c1021739123ff6aeca882057f05a110878`. Tarih: 18 Kasim 2026. Bu tarama salt-okuma kaynak incelemesidir; yeni testnet transaction, browser/wallet otomasyonu veya M6-M8 elle kabul kaniti degildir.

## Kabul edilen duzeltme

Client teslim incelemesi baseline commit'te mevcut: kriterler, current delivery version/hash, yeniden hesaplanmis content hash, guvenli dis baglanti ve diger stored version ayrimi. `web/app/v2/_components/delivery-review.mjs:16-25,50-60`.

## Yeni bulgular (duzeltme onayi bekliyor)

| ID | Karar | Dogrulanan eksik | Risk / asgari duzeltme |
|---|---|---|---|
| DR-1 | Accept settlement | Canonical read context aktif teklif icin version/stateVersion/proposer/expiry donduruyor, refund/grossPayout dondurmuyor. UI accept dugmesi oncesi karsi teklifin kosullarini gostermiyor. | Yeni teklif formunun default tutarlari gelen teklif sanilabilir. Server-canonical refund/gross/net/fee, taraflar/proposer/expiry ve request version gorunur review blogunda sunulmali; eksik/stale/malformed durumda kabul acilmamali. |
| DR-2 | Request revision | Revision notes yalniz criterionHash/referenceHash'e donusuyor. Formda insan okunur metin var, fakat exact metin/hash son onay ozeti ve operator'a kalici okunur gerekce akisi yok. | Operator neyin duzeltilecegini hash'ten anlayamaz. Bos not reddi, exact metin/hash onay ozeti ve yalniz yetkili taraflara okunan hash-bagli gerekce gereksinimi netlestirilip ayrica onaylanmali. Local ozet tek basina operator'a erisim problemini cozmez. |
| DR-3 | Resolve dispute | Payout, reason/evidence ve operatorFault giriliyor; refund, fee, operator/client net credit, treasury payi, stake release/slash sonuclari karar oncesi gorunur degil. | Server tarafinda canonical muhasebe onizlemesi, acik sifir degerler, exact gerekce/evidence/hash ozeti; degisince gecersizlesen ve sonuctan once incelenen review kapisi gerekli. React'te tahmini finans hesabi otorite yapilmamali. |

### Kaynak baglari

- `web/lib/v2/server/api-read.mjs:180-207`: current mutual context; satir 206 payload'inda refund/grossPayout yok.
- `web/app/v2/_components/action-panels.js:93-104`: yeni mutual form defaultlari, yalniz mutual version'la accept parametreleri, revision notes hash donusumu ve karar dugmeleri.
- `web/app/v2/_components/action-panels.js:151`: resolver formu, payout/reason/evidence/operatorFault; preflight'tan sonra dogrudan mevcut action yolu.
- `web/lib/v2/server/api-actions.mjs:257-283`: revision/dispute hash parametreleri, canonical mutual dogrulamasi ve transaction/expected readback cevabi; insan okunur ekonomik consequence payload'i yok.
- `contract/docs/v2-m8-resolve.md`: M8 dar yolun ayri muhasebe/simulation/onay sinirlari. UI eksigi, dar executor'un test edilmedigi veya acilmasi gerektigi anlamina gelmez.

## Server guvenligi ile insan incelemesi farki

Canonical preflight rol/status/freshness, proposal version/expiry, payout/refund toplami ve calldata baglarini kontrol ediyor. Bunlar degerli guvenlik sinirlaridir; kullanicinin finansal kosullari ve gerekceyi gormesi yerine gecmez. Hash, okunur teslim/gerekce veya ekonomik onizleme degildir.

## Onay sonrasi onerilen test matrisi

- Mutual: client/operator, proposer/karsi taraf, canonical refund/gross/fee/net/expiry, kendi teklifini kabul red, expired/stale/malformed read; gizli veya default kosullarla sifir send.
- Revision: bos not red, exact UTF-8 metin -> hash, confirmation ozeti, yetkili taraf okuma/outsider red, hesap/job degisiminde icerik temizligi, operator'a gerekce gorunumu.
- Resolution: operatorFault false/true; zero/full/partial payout; exact refund/net/fee/slash/release ve korunum; degisen input/state ile preview gecersizligi; unavailable/malformed preview halinde sifir send.
- Mevcut wallet/readback/delivery regresyonlari yeniden kosulur. Kaynak tarama icin alt calisanin bildirdigi test sayisi parent-run kabul sayisi olarak sunulmaz.

## Karar

Yeni bulunan bu eksikler icin talimatin ayri onay kapisi korunur: **bu checkpoint'te DR-1/DR-2/DR-3 kodu degistirilmedi**. Mevcut onayli teslim incelemesi korunup push edildi. M6'nin tum adimlarina kosulsuz baslama onayi verilmez; ozellikle DR-2 giderilmeden Request revision akisi tamamlanmis hazir sayilmaz. M7/M8 insan inceleme kapilari da acik kalir.

Bu belge ve guncel rehber yeni signer, resolve, cloud veya Faz 1b izni vermez.
