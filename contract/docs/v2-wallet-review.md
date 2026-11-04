# V2 Cursor wallet execution audit

Initial worker scope: `web/lib/v2/new-wallet-execution.mjs` and its focused tests, without browser/RPC writes, real keys, or UI edits. The independent parent review and separate local-browser integration evidence are distinguished below. Table locations follow the final engine source.

## Findings and disposition

| Location | Severity | Finding | Status |
|---|---:|---|---|
| `new-wallet-execution.mjs:120-132` | High | The hook-local busy flag did not protect concurrent sends initiated by separate hooks; a pre-persistence race could duplicate a wallet submission. | Fixed with a module-level wallet execution lock; adversarial counter test passes. |
| `new-wallet-execution.mjs:148,156` | High | Account/network changes after allowance approval were not revalidated before the main action; expiry was also only checked before the wallet flow. | Fixed with post-approval and pre-main-send account/chain and expiry checks; mocked chain-switch test passes. |
| `new-wallet-execution.mjs:143-146` | High | `postJob` allowance metadata was optional and required amount was not bound to reward calldata. | Fixed; missing metadata and reward mismatch are rejected before simulation/send. |
| `new-wallet-execution.mjs:102-117` | High | Hash reconciliation accepted incomplete evidence: optional `to`, calldata hash, chain ID, and value, without canonical profile target validation. | Fixed; reconciliation now requires exact stored profile/chain/wallet, canonical target, calldata hash, zero value, and chain ID. Existing reconciliation test updated with explicit zero value. |
| `new-wallet-execution.mjs:175` | Medium | A second sequential action retained the previous successful `value`, allowing consumers using `result || wallet.value` to display stale success while the second action was pending. | Fixed by clearing `value` at the start of every run. |
| `new-wallet-execution.mjs:183` | Medium | Resume selection could choose terminal/reconciled/auto-disabled entries before a recoverable entry. | Fixed by filtering terminal, reconciled, and `autoResume === false` records. |
| `new-wallet-execution.mjs:78-90,128` | High | Unknown/hashless broadcasts must not be retried automatically. | Inherited behavior verified by existing tests; explicit reconciliation remains required. |
| `new-wallet-execution.mjs:74-90` | High | Success is returned only after receipt success plus canonical readback; approval completion returns `approval-confirmed`, not `success`. | Inherited behavior verified by existing tests; no early-success defect remains in this engine path. |

## Regression evidence

Added adversarial tests for:

- concurrent executions across hooks with an independent mocked send counter;
- `postJob` allowance presence and exact reward/calldata binding;
- chain change after approval, proving no main transaction is sent;
- hashless broadcast persistence, explicit hash reconciliation, duplicate-send prevention, and secret-safe errors;
- receipt/readback timeout recovery without resubmission;
- stale terminal resume-entry selection (covered by the filtering change).

Commands and results:

- `node --test web/test/v2-wallet-execution.test.mjs` — **20 passed, 0 failed**.
- `node --check web/lib/v2/new-wallet-execution.mjs` — **passed**.
- `git diff --check -- web/lib/v2/new-wallet-execution.mjs web/test/v2-wallet-execution.test.mjs` — **passed**.

The original worker suite uses mocked EIP-1193 providers only. It does not establish browser or live-chain acceptance.

## Independent parent review and verification

The parent re-read the engine and exercised wallet/profile/transport/reader tests independently. The first combined parent run passed 45 tests. Source review then found two additional acceptance gaps that those tests did not cover:

| Location | Severity | Finding | Disposition |
|---|---:|---|---|
| `reconcileWalletBroadcast`, recipient validation | Medium | A forged persisted `to` plus a matching observed transaction could bypass independent canonical-recipient comparison. The canonical server readback remained a separate gate, but the engine's recipient assertion was incomplete. | Added a RED regression that previously completed reconciliation; now rejects before readback, preserves the uncertain intent, and performs no further send. |
| `reconcileWalletBroadcast`, approval metadata | Medium | A forged persisted approval spender/zero required amount could be accepted independently of its bound approve calldata. | Added a RED regression that previously cleared the intent. Reconciliation now requires the canonical token, action-specific spender, positive bounded amount, and exact encoded-approval hash. A separate positive case reconciles a legitimate approval only to `approval-confirmed`, without submitting the main action. |

Parent evidence:

- Genuine RED: `reconcile-binding-red.tap`, **21 passed, 2 failed**, both failures `Missing expected rejection` for the new adversarial cases.
- Final focused command: `node --test --test-reporter=tap --test-concurrency=1 test/v2-wallet-execution.test.mjs test/v2-wallet-resume-react.test.mjs test/v2-chain-profile.test.mjs test/v2-profile-transport.test.mjs test/v2-chain-reader.test.mjs` from `web/`.
- Final focused result: **50 passed, 0 failed, 0 skipped**, stored as `parent-wallet-audit.tap` in the local acceptance evidence directory.
- Reader profile-override regressions prove local profiles are rejected in production/Vercel contexts before RPC access; the production default remains separate from the explicit loopback profile.
- Actual local Edge integration separately passed exact-approval stake deposit/withdraw and reload/disconnect/timeout recovery. The driver delayed real receipt/readback responses and counted broadcasts to reject early success or duplicate sends. This is local chain 31337 evidence, not a real wallet extension, public-chain, or production claim.

A further real-browser finding was reproduced: after reload, canonical readback succeeded and no duplicate was sent, but the cancelled hook discarded its success while the replacement hook skipped an already-running resume. Two dedicated React regressions (remount and changing refresh callback) first failed, then passed after sharing the in-flight resume promise and keeping the refresh callback in a ref. A fresh `recovery-confirmed` browser run now requires a visible success message after releasing canonical readback; reload, disconnect, and the real receipt timeout all passed with exactly one broadcast each. Earlier negative-safety-only recovery records are retained rather than overwritten.

## QA-WALLET-001: fixed, Medium

Accepted severity: **Medium**, incorrect-success risk with no demonstrated money loss. Known-hash resume previously conditionally skipped canonical validation when persisted `to` and `calldataHash` were absent; recipient fallback also inferred missing metadata from the expected target.

- Genuine pre-fix RED (`red-missing-binding.log`): **68 tests, 53 passed, 15 failed, exit 1**. Failures are missing expected rejection, not import or harness errors.
- Wallet GREEN: **68 passed, 0 failed, exit 0**. Main and approval, both resume and explicit reconciliation, cover missing recipient/hash, both missing, null and empty bindings. Every negative row asserts `reconciliation-required`, zero readbacks, zero sends, and preserved pending intent.
- Parent independently reran wallet + React resume + profile + transport + reader: **95 passed, 0 failed, exit 0** (`parent-focused.tap`). React positive fixtures now supply actual ABI-encoded calldata, its hash, and bound transaction evidence; success/readback/no-send assertions were not relaxed.
- Existing independent offline probe: **exit 0**, `rejected=true`, `readbacks=0`, `sendCalls=0`, `pendingPreserved=true`. This is in-memory regression evidence, not on-chain acceptance.
- `resumeWalletIntent` now invokes `readAndValidateCanonicalTransaction` unconditionally before receipt/readback. The shared validator requires valid persisted recipient/hash, canonical action target, wallet/profile/chain, input hash and zero value. Missing metadata is rejected, never repaired using an expected-target fallback.
- Explicit `reconcileWalletBroadcast` uses the same unconditional validator, including canonical approval token/spender/amount/calldata binding. The React resume hook delegates to this guarded resume path. Initial-send `finishBroadcast` consumes freshly bound intent data; hashless recovery never auto-resends. No analogous conditional persisted-metadata bypass remains in these paths.

The 50-test result and browser recovery above are historical. Fresh full-suite/build and publication evidence are recorded in the acceptance handoff; local regression success is not public-chain, extension-wallet or production acceptance.

The browser lifecycle matrix and final full-suite/build outcomes are recorded separately in the acceptance handoff. No public-network transaction, real private key, or native wallet approval was used for this review.
