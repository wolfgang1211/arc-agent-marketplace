# V2 decision-review implementation evidence

Date: 2026-11-18 (local verification completed around 06:00 +03:00).
Branch: `feat/marketplace-v2`.
Status: **implementation accepted by Yusuf; commit/push authorized independently of screenshots; M6 open**.

## Yusuf için özet

- Üç karar inceleme düzeltmesi yerel uygulamaya entegre edildi.
- Entegre test grubu 213/213 geçti; production build exit 0.
- UI/executor karşılaştırması gerçek dönen delta alanlarını kullanıyor.
- Headless Edge ile 8 masaüstü/mobil offline fixture görüntüsü alındı; kullanıcı tarayıcısına bağlanılmadı.
- Yusuf görüntüleri commit koşulundan çıkardı; M6 açık. Revizyon kartının gerçek kabulü M6 sırasında yapılacak.

## Implementation and source locations

### Revision reason

- `web/lib/v2/server/revision-notes-api.mjs:29`: canonical chain, terms, parties, state, delivery and required-field validation.
- `web/lib/v2/server/revision-notes-api.mjs:55`: exact off-chain note persistence in the existing audit table, immutable/idempotent insert, locked canonical-row revalidation.
- `web/lib/v2/server/revision-notes-api.mjs:74`: private reads and explicit verified/pending/mismatch classification.
- `web/app/v2/_components/decision-review.mjs:32`: save -> inspect exact content/commitments -> explicit unsigned preflight; edits/account changes invalidate prepared review.
- `web/app/v2/_components/decision-review.mjs:54`: assigned operator card with readable reason, criterion, delivery version, remaining revisions, deadline and visible mismatch warning.
- The deployed Job layout has no `requestStateVersion` field. The saved request records expected state + 1, and current revision verification uses the actual canonical state version, delivery and exact commitments. Tests explicitly omit the invented reader field.
- A newly persisted note has a nonzero source hash before broadcast. Pending classification is tested through the actual POST response, not a fabricated zero source hash.

### Incoming mutual proposal

- `web/lib/v2/server/decision-review-api.mjs:21`: status-specific canonical financial windows.
- `web/app/v2/_components/decision-review.mjs:50`: separate incoming proposal card, proposer/counterparty, refund, gross payout, fee, operator net, expiry, proposal version and card-only accept/reject.
- `web/app/v2/_components/decision-review.mjs:65`: accept preflight binds displayed job and proposal versions; stale errors refresh without replaying the POST.
- `web/app/v2/_components/action-panels.js`: generic panel excludes incoming accept/reject and revision request; the new-proposal form stays separate.

### Dispute economic review

- `web/lib/v2/decision-economics.mjs:11`: exact integer accounting and conservation, explicit released/retained/slashed stake.
- `web/lib/v2/server/decision-review-api.mjs:32`: resolved outcome reconstructed from nested decoded args, canonical marketplace/vault emitters and the same transaction/block event set.
- Terminal `stakeReserved` is not used as the historical release/slash amount. The verified collateral event supplies that amount.
- `web/app/v2/_components/action-panels.js:154`: read-only preview -> exact reason/evidence and economic review -> explicit unsigned preflight. Incomplete economics, changed inputs, wrong context and stale state block confirmation.
- `web/app/v2/_components/decision-review.mjs:60`: client/operator resolved outcome with the same economic line items and provenance.
- Existing-fault-review resolution remains excluded from this narrow resolver preview, matching the existing approved executor guard. No executor guard or live signer was opened or changed.

## RED -> GREEN evidence

Parent-run regressions demonstrated these failures before the corresponding fixes:

- Four UI integration failures: operator card absent in RevisionPending, mismatch reason absent, incomplete incoming terms enabled acceptance, and stale accept did not refresh.
- Five economic API failures: post-read health not checked, arbitrary reader error code leaked, wrong mutual financial clock, and missing released/slashed historical outcomes at zero terminal reserve.
- One real parity failure: UI returned the wrong free-stake delta. The corrected test compares the actual returned delta rather than reconstructing it in the assertion.
- Two real-schema revision failures: nonexistent reader field required, and actual POST note incorrectly labelled mismatch before broadcast.

All corresponding final regressions passed.

## Tests and build

- Integrated run: **213 tests, 213 passed, 0 failed, 0 skipped, 0 cancelled**, exit 0, serial file execution.
- Included suites: canonical account, auth, private API, action preflight, revision notes, decision API, economics parity, decision UI hardening, runtime routes, general UI actions, wallet network/execution/readback/resume.
- After changing only the economic API test's temporary-directory selection to the shared scratch helper, its exact final version was independently rerun: **8/8**, exit 0.
- Final production build: `node node_modules/next/dist/bin/next build`, Arc Testnet local profile, exit 0.
- Build retains two existing hook-dependency warnings in account and job pages. The newly introduced resolver dependency warning was removed; no lint rule was disabled.
- `git diff --check`: exit 0. Changed-source hygiene scan found no private-key PEM, credential URL, GitHub token or trailing-space matches. No environment files, DB data or raw logs are planned commit inputs.
- Raw local test/build logs remain outside the checkout in the agent scratch directory.

## UI/executor accounting parity

`web/test/v2-decision-economics.test.mjs:13` imports the existing `effects` function from `contract/scripts/approved-v2-resolve.js` and compares its result against `calculateDecisionEconomics`.

Cases: zero payout, partial payout, full payout and operator-fault refund. The comparison includes payout/refund/fee/net credits/slash, market and vault balance deltas, escrow and liability deltas, free/reserved stake, active-job delta and terminal status.

This is an offline pure-function witness. It is **not** a signer invocation, executor execution or public-chain resolve transaction.

## Runtime readback after final build

- `http://127.0.0.1:3102/v2/jobs/7`: HTTP 200.
- `http://127.0.0.1:3102/v2/resolver`: HTTP 200.
- Both new private GET routes without a session: HTTP 401 `INVALID_SESSION`.
- Health: `healthy`, `stale:false`, `gap:null`, `lag:0`.
- The served page bundles were read back and contained the new review/confirmation labels.
- Only the named loopback web service was restarted. DB and indexer were not stopped.

## Visual evidence: headless Edge, separate from manual acceptance

After Yusuf explicitly authorized headless Edge, eight full-page screenshots were captured using Playwright `chromium.launch(channel="msedge", headless=True)` on installed Edge 157.0.4341.60.

The source is the actual review-component SSR fixture set and application stylesheet. All screens visibly say OFFLINE FIXTURE, no real job or transaction, with fictional public-pattern wallets. This is visual evidence only, not user-wallet, live-chain or M6/M7/M8 acceptance.

| Screen | Desktop 1280px | Mobile 390px |
|---|---|---|
| Incoming mutual | `v2-mutual-desktop-edge.png` | `v2-mutual-mobile-edge.png` |
| Revision requested | `v2-revision-desktop-edge.png` | `v2-revision-mobile-edge.png` |
| Dispute economic preview | `v2-dispute-preview-desktop-edge.png` | `v2-dispute-preview-mobile-edge.png` |
| Resolved dispute | `v2-dispute-desktop-edge.png` | `v2-dispute-mobile-edge.png` |

All eight captures measured document/body width equal to the viewport, with no horizontal overflow. Screenshot files and their recorded SHA-256 hashes were independently checked. The images are delivered in `v2-decision-screenshots-edge.zip`; screenshot files and machine-local capture metadata are outside the source checkout.

No user browser was attached or controlled during this step. Only a new headless Edge process was used and then closed. The ephemeral fixture HTTP server was shut down by the capture script. The earlier Brave permission timeout is historical and no longer a commit or M6 gate.

## Commit, push and release gate

- Yusuf explicitly authorized immediate commit/push of this implementation, tests and evidence without waiting for screenshots.
- Implementation commit: `f5081ef01e14e95e0dd5dba510d103b1a7a3e371`; remote `feat/marketplace-v2` readback matched this exact SHA after push. The screenshot-result documentation is recorded in a follow-up docs-only commit.
- Local `main` remains `c7aa27c6ff28676122b94ffeddef6f57d5d3efef`.
- **M6 is open by explicit Yusuf decision.** The real revision-card acceptance is deferred to Yusuf’s M6 test; mutual-card acceptance to M7; dispute-card acceptance to separately authorized M8.
- Screenshots may use only headless Playwright Edge with `channel: "msedge"`. Do not attach to Brave or any user browser. Edge failure is report-only, not an M6 blocker.
- During M6, provide read-only verification after each step when requested: persisted note and on-chain commitments; immutable first delivery and distinct new version; remaining revision allowance and deadline; final payment, fee and conservation. Fixing any newly discovered M6 issue needs separate approval.
- After M6 completes, write transaction hashes, canonical states and conservation evidence, then commit that evidence. No M6 completion or transaction is claimed here.
- Real M6-M8 lifecycle transactions remain manual/user-authorized. Each M8 decision still requires a fresh explicit approval.
- No Solidity, V1, bot, cloud deployment, signer activation, user-wallet signature or testnet transaction was changed or performed.
