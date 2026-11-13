# Local Arc counterparty review: execution NOT accepted

This review covers only local V2 scripts. The hardcoded launcher and worker gate remains `LIVE_EXECUTION_NOT_ACCEPTED` before any DPAPI/keystore access. No real decryption, wallet signature, API application/delivery mutation, or public-chain broadcast was performed by this setup work.

## 13 Kasım kararı: signer rafa kaldırıldı

**Canlı karşı rol imza köprüsü rafa kaldırıldı; C3/C4/C6/C7 açık. `LIVE_EXECUTION_NOT_ACCEPTED` kilidi kalıcı olarak kapalı kalır.** Bu çalışmada yeni signer geliştirmesi, decrypt veya imza/gönderim yoktur. Operator işlemlerini Yusuf Brave'deki ikinci hesabıyla arayüzden kendisi yapar. Hermes, adres verildiğinde yalnız bakiye/kayıt salt-okuma ön kontrolünü yapar; fonlama faucet üzerinden Yusuf'tadır.

M8 için yalnız Yusuf'un o işe ve kesin karara özgü sohbet isteği, canonical client `0x460EBe282Fb0e42B4d682a7f9EF408302417F780`, simülasyon ve pozitif receipt/readback zorunludur. İncelenen `contract/scripts/approved-v2-executor.js:17-35` yalnız deploy/config/all fazlarını kabul ediyor, toplu roller yüklüyor ve deployment/config/scenario işlemleri içeriyor. Tek-job `resolveDispute` / `resolveFaultReview` komutu mevcut değildir. Bu geniş executor M8 yerine çalıştırılmaz. Kontrat/script değişikliği yapılmadı; güvenli tek-job onaylı giriş noktası bulunana veya ayrıca onaylanana kadar M8 gönderim yolu blokelidir. `--plan` dahi tek-job karar simülasyonu değildir.

## Initial independently inspected findings (historical source locations)

| ID | Location | Risk / missing guarantee | Required fix | Status |
|---|---|---|---|---|
| C1 | `web/scripts/v2-local-arc-counterparty-helper.mjs:21-27` | A syntactically valid non-vault address selects the marketplace ABI without enforcing the deployment target; ABI decoding alone does not pin the recipient or allowed action. | Pin action-to-contract and exact deployment addresses; use the runtime-attested full ABI for supported resolver actions; reject other targets/functions before signing. | Open |
| C2 | `web/scripts/v2-local-arc-counterparty-helper.mjs:55` | Client checks wallet/chain but does not reconstruct and bind the challenge's origin/domain/nonce/expiry/marketplace before signing its message. Server verification is not a signer-side validation substitute. | Validate complete challenge fields and exact canonical message with bounded future expiry before `signMessage`; reject redirects. | Open |
| C3 | `web/scripts/v2-local-arc-counterparty-helper.mjs:38` | Missing receipt chain ID falls back to plan chain ID, so the pure receipt gate can succeed without independently observed chain evidence. Real Ethereum receipts normally omit chain ID. | Require independent pinned-provider chain evidence and canonical transaction/block binding rather than assuming a receipt field. | Open |
| C4 | `web/scripts/v2-local-arc-counterparty-helper.mjs:8,40`; `web/scripts/v2-local-arc-secure-executor-worker.mjs:8,30` | Generic version increments include mutual propose/reject, which do not share the same job-version semantics as terminal transitions. | Derive action-specific job and mutual-request expectations; assert actual mutual state/version as well as job state. | Open |
| C5 | `web/scripts/v2-local-arc-counterparty.mjs:65,98-105` | Delivery calldata is prepared using caller hash before the API canonical manifest result. A returned-hash equality check exists and prevents a different hash from being sent, but the transaction is not directly derived from authoritative persisted output. | Persist manifest, construct/reconstruct the final plan with returned `blobHash`, decode final calldata and bind its hash argument before simulation. | Open, workflow/proof hardening |
| C6 | `web/lib/v2/server/local-arc-counterparty-policy.mjs:12,33-41`; `web/scripts/v2-local-arc-secure-executor.py:48-52`; `web/scripts/v2-local-arc-secure-executor-worker.mjs:19-21` | Replay set is process-local and future code decrypts before consuming exact operation authorization. Parameter canonicalization also needs nested-input coverage. | Atomic durable single-use authorization bound to exact action/job/params/expiry; claim before DPAPI/keystore access and test restart/concurrency/nested parameter changes. | Open |
| C7 | `web/scripts/v2-local-arc-secure-executor-worker.mjs:30` | Account existence and unchanged stateVersion can be reported as success without proving requested stake/credit deltas. | Pinned canonical pre/post account evidence, action-specific deltas and receipt events; unchanged state must fail. | Open |
| C8 | `web/lib/v2/server/local-arc-counterparty-policy.mjs:26-30` | Policy accepts caller-supplied trusted actor values. Preparation currently narrows these values, but the standalone boundary permits forged actor authority. | Pin public testOperator and trusted resolver/owner policy independently of caller arguments; verify effective resolver from pinned canonical evidence. | Open, partially constrained by preparation |

## Evidence and limitations

- Parent serial focused run: **30 tests passed, 0 failed**, including local indexer diagnostics/adaptive tests and counterparty/integration/status tests.
- Real PGlite + actual API auth/private-handler integration covers an **ephemeral in-memory fixture application's** auth/storage behavior. It does not exercise real DPAPI signing or live transaction execution.
- Existing negative tests cover selected chain, non-Yusuf client, reward/deposit, role and unsupported-action boundaries. They do not close all eight findings above.
- Both live entrypoints remain blocked. Do not remove the gate because focused tests pass or keystore paths exist.
- The separately accepted 633-test baseline remains historical evidence. A new frozen-source serial run is separate and must have an actual exit result before being called green.

No M3 approval follows from this review.

## Parent review after remediation: not all findings are closed

The implementation worker reported all eight findings closed. Parent source inspection does **not** accept that conclusion. The focused suite passed independently, but the real launcher/worker bridge still has unfulfilled requirements:

| IDs | Verified improvement | Remaining acceptance boundary |
|---|---|---|
| C1 | Exact target/action guards, full deployed-runtime ABI selection, negative wrong-target/action/chain checks. | This proves the helper boundary, not a working live executor. |
| C2 | Exact canonical challenge reconstruction and redirect rejection. Parent repaired vacuous negative fixtures: real newline-separated messages, current valid baseline fields, and exact per-case errors now distinguish domain, expiry and malformed nonce. Actual ephemeral PGlite auth-handler integration also passes. | Live authentication must remain gated with the rest of the bridge. |
| C3 | Missing receipt chain metadata now rejects instead of falling back to the plan. | **Open:** `secure-executor-worker.mjs:15` still returns raw `eth_getTransactionReceipt` without independent provider-chain/canonical transaction/block attestation. Requiring a nonstandard receipt `chainId` is not the requested independent chain proof. Fetch and bind provider chain, transaction hash/from/to/data/value and canonical block before accepting success. |
| C4 | Helper no longer requires a job-version increment for mutual propose/reject. | **Open:** `secure-executor-worker.mjs:31` reads an API job projection and does not supply pinned canonical mutual request state/version; operation helper only checks mutual expectations when supplied. Require mandatory action-specific canonical mutual evidence, never conditional omission. |
| C5 | Final delivery calldata is reconstructed and decoded using the persisted manifest's returned hash, while rejecting disagreement with the approved hash. | The mock execution-order test is not live bridge acceptance. |
| C6 | Durable exclusive-create one-use claims bind nested params; restart/concurrent double-claim tests pass. Parent removed temporary/repository defaults, removed unsafe other-owner lock cleanup, added expiry rejection and flush-before-return, and isolated all fixtures under scratch. | **Open:** `secure-executor.py:48-52` still orders future DPAPI access before operation claim; `secure-executor-worker.mjs:22` loads the wallet before `executeCounterpartyOperation` claims authorization at line 32. No trusted issuer/pre-decrypt handoff is integrated. A caller's `fresh: true` JSON is not independent approval. Keep both unconditional gates and implement a trusted, atomic pre-decrypt claim protocol before activation. |
| C7 | Unchanged deposit, stake-withdrawal and credit-withdrawal account evidence rejects in the delta helper. | **Open:** `secure-executor-worker.mjs:31` still obtains account/job evidence from API projection, not pinned canonical pre/post account reads, and does not provide the required before/after evidence. Wire real canonical account deltas before any operation can broadcast. |
| C8 | Standalone trusted actor guards reject forged operator/resolver arguments. | End-to-end canonical resolver/role derivation must accompany bridge acceptance. |

### Actual parent verification

`node --test --test-concurrency=1 test/v2-local-arc-counterparty.acceptance.test.mjs test/v2-local-arc-counterparty.test.mjs test/v2-local-arc-counterparty.integration.test.mjs test/v2-local-arc-secure-status.test.mjs`

Run twice consecutively after parent fixes: **28 pass, 0 fail, 0 skip**, exit **0** on both runs. These are offline fixture/PGlite tests; no real wallet, DPAPI, port-3102 mutation or public-chain send occurred. The former 644-test frozen baseline predates these edits and is not a full-suite acceptance of the current tree.

The default authorization directory is now `%LOCALAPPDATA%/hermes/state/alphaboard-v2-local-arc/authorizations` (the default Windows user's Local AppData path), outside the repository and temporary storage. Tests supply unique explicit scratch directories; setup created no live authorization there. Existing `.local-counterparty-authz/` fixture claims from the earlier default were preserved, not deleted, and must not be committed or treated as real user approval. A safe authorization-record migration/issuer protocol has not been accepted.

**Result: C3, C4, C6 and C7 remain explicitly open at the live boundary. No live-execution acceptance, no new follow-up commit, and no M3 approval.**
