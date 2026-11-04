# V2 local acceptance handoff

## Verified scope

Actual local EVM **31337**, real server reader/indexer and PGlite, installed headless Microsoft Edge, and controlled injected EIP-1193 test wallet. This is **not** an extension-wallet test, public Arc transaction acceptance, hosting deployment, or visual sign-off. Arc Testnet **5042002** remains the default; local overrides are explicit and loopback-only.

**Wallet checkpoint published:** `465624dbaf1923e748049f3dab95df040de1ae07` on `feat/marketplace-v2`, remote SHA independently matched. Fresh wallet/profile/transport/reader/React tests **95/95**, isolated local chain/indexer **2/2**, combined **97 passed, 0 failed, exit 0**. Production-default build **exit 0** on a clean HEAD export overlaid only with the five wallet/isolation/audit files. UI changes were excluded from that build snapshot and commit. UI checkpoint gates follow separately; historical browser evidence below must not be confused with fresh UI acceptance.

## Browser acceptance

The parent independently re-read **23** recorded transactions and successful receipts, canonical block hashes, chain ID, sender, target, zero native value and deployed runtime hashes. Public evidence: [v2-browser-acceptance.json](v2-browser-acceptance.json). The **19** required UI steps are below. Application is signed off-chain. Deployment/seed is setup evidence, not browser E2E.

| Flow | UI action | Observed result | Receipt / canonical evidence |
|---|---|---|---|
| main | postJob | canonical account readback | `0xcd757be6634e96c8ac3067614185e0fec6da7cafd158cf1e0fb739265cf66647`; canonical success, block 35 |
| main | apply | signed application, off-chain | Rendered application form, real local EIP-712 signature, authenticated API storage |
| main | awardJob | status 1 | `0x698e0b9a47f74056db1fcd6a7eadf549fb46909d8a39babbf188a0d3316cf703`; canonical success, block 36 |
| main | submitDelivery | status 2 | `0x10d41e41012398c36bdf7aa83cae3d4a5c8cfbfe27dafb78bd00805b226ecc0f`; canonical success, block 37 |
| main | requestRevision | status 3 | `0xbe7b9d16ba1d5d23a98549815198c794d514af7e25ddd13799efa24a37977b58`; canonical success, block 38 |
| main | submitRevision | status 2 | `0xb8390f93fcda8f0e2eaf360ef36a4aac089d47254d12cd67ff193a46023db95c`; canonical success, block 39 |
| main | approve | status 6 | `0x389c6000c3afb9518e5e39b9e90f055dd109e229739c7ec2e16f4c4dc866ed3a`; canonical success, block 40 |
| main | withdrawCredit | canonical account readback | `0x9d268a5be3ec27c2139dc994879ade9e6c5593280bc9e9b32085d7d75591869d`; canonical success, block 41 |
| stake | depositStake | canonical account readback | `0x4d02c2d1d3b6a81553e53c7fc294e5b615ed36542e3db651198f6f002818cbd1`; canonical success, block 43 |
| stake | withdrawStake | canonical account readback | `0x393224efec088a5580ffbc94a9e4cf87000c2a943bb44de09dc2170bbee74ea5`; canonical success, block 44 |
| recovery-confirmed-reload | withdrawStake | canonical account readback | `0x8d3651b4290d64e037549c1e0bec106bb1d5e0741ac66de60589145b20a3995a`; canonical success, block 48; 1 initial send, 0 resume sends, visible success |
| recovery-confirmed-disconnect | withdrawStake | canonical account readback | `0x8c9dcc60b47305915ca3abefaa8e724c9a6fc5e6185c9ee9ecd0636c43048002`; canonical success, block 49; 1 initial send, 0 resume sends, visible success |
| recovery-confirmed-timeout | withdrawStake | canonical account readback | `0x8ce27e62ec276a725b8bacde9ebd804787d1a3547410edc1d679c13f03c7b13c`; canonical success, block 50; 1 initial send, 0 resume sends, visible success |
| mutual | proposeMutual | status 3 | `0x3e3497c179abde654aa3c831be67b0b3766e9a77a6df0b280837d20c5f31887b`; canonical success, block 51 |
| mutual | acceptMutual | status 7 | `0x7624fd3fb01c392bd4cdeee7b0492cdc6fd5bc0bb8f3f9fe4ac175a818073354`; canonical success, block 52 |
| dispute | openDispute | status 5 | `0x29bb8222574c4af3d7b4f8ace3f023accdc4b857c87122cefa2d52298ba43f19`; canonical success, block 53 |
| dispute | resolveDispute | status 6 | `0xa3963f7347364a5040e257c65a8db3bd680f45d5169d35fc67af8ac4398458bd`; canonical success, block 54 |
| timeout-claimDeliveryTimeout | claimDeliveryTimeout | status 7 | `0x0f1181ce7bd07dbd488131ef9213b4dd7ed8d4ad16381ccd665aa4de6e52dc52`; canonical success, block 56 |
| timeout-claimOpenJobTimeout | claimOpenJobTimeout | status 7 | `0x92a5fc44ce58f6ec0160b76ccc7ae4eff9f4413542d99bd77a851d687816ece7`; canonical success, block 58; original pending intent recovered, no resend |

### Exact approvals and recovery history

- Post: **100 USDC = 100000000 base units**, marketplace spender. Stake: **2.5 USDC = 2500000 base units**, vault spender. Both bounded, not unlimited, independently bound to their following decoded transaction.
- Historical `recovery-*` rows proved negative safety only. Fresh `recovery-confirmed-*` rows additionally prove visible positive success after receipt/readback, exactly one initial send and zero resume sends.
- Open timeout initially broadcast once, then null-versus-zero operator mismatch blocked UI success. After the fix, the **original hash/server intent** was recovered with real receipt/readback and sends blocked. Test-only restoration after ephemeral browser teardown is explicitly labelled. The claim was **never resent**. Failed attempts remain in the ledger.
- Timeout tests advanced only the owned local EVM clock. No public chain was written.

## Tests and findings

- Wallet/React resume/profile/transport/reader: **50 passed, 0 failed, 0 skipped**.
- API actions/read/action-context after integration fixes: **20 passed, 0 failed, 0 skipped**.
- Targeted UI/HTTP: **29 passed, 0 failed, 0 skipped**.
- Production-default build: **passed, exit 0**, no local override.
- Full serial result: **65 files, 551 tests, 545 passed, 0 failed, 0 cancelled, 6 skipped; exit 0**. All six skips are the deliberately gated real-PostgreSQL tests; there are no other skips. Real PostgreSQL remains a separate approval gate.

| Severity / boundary | Root cause | Resolution and evidence |
|---|---|---|
| High, stored main intent | Forged persisted recipient could enter reconciliation | Independently canonical action target; dedicated RED to GREEN regression |
| High, stored approval | Forged persisted spender/amount/calldata metadata | Canonical token, spender, positive exact amount and calldata binding; valid approval completion regression |
| Medium, React resume | Remount/callback cleanup could drop positive success while another hook skipped in-flight work | Shared promise map + stable refresh ref; React regressions and three positive browser recoveries |
| Medium, action context | Real enum decoder returns a number, unlike bigint-only fixtures | Safe integer enum support; malformed/out-of-range number rejection; actual-type regressions |
| Medium, timeout liveness | Last-job-event timestamp incorrectly used as current chain clock | Verify historical indexed witness, then matching fresh canonical state; empty-block regression and actual timeout UI |
| Medium, party readback | Unassigned zero address differed from expected null | Consistent null/zero normalization, exact rejection of an unexpected assigned party, original-hash UI recovery |

Detailed initial audit: [v2-wallet-review.md](v2-wallet-review.md). Final integration code: `web/lib/v2/server/api-actions.mjs:172`, `web/lib/v2/server/api-read.mjs:141,230`; wallet code: `web/lib/v2/new-wallet-execution.mjs:97,164`.

## Screenshots and visual gate

[Index, 32 screenshots](v2-ui-screenshots/edge-current/INDEX.md) · [measurement ledger](v2-ui-screenshots/edge-current/ledger.json).

- **32/32** actual, nonempty, unique images, 16 cases each at desktop **1440x1000** and mobile **390x844**; full-page where needed.
- Seven seeded lifecycle states were captured **before** later acceptance transactions changed them. These are timestamped historical captures, not a claim that every initial state remains in the preview.
- Filled form: landing-page brief, Website category, tags, visible UTC date, human-hour durations and revision limit; not a link-summary-only example.
- Authenticated account/resolver shots **6/6**. Reader fault **2/32**, explicitly network-unreachable request-abort injection, never fabricated JSON.
- Horizontal overflow **0/32**, metric/reward-category overlap **0/32**, blockchain send attempts during capture **0**.
- Parent inspected representative detail, filled mobile and reader-fault images. Superseded sets were archived outside the repository, not deleted.
- **Visual acceptance remains pending Yusuf + Claude.** Reader-offline shots can show loading/empty copy alongside the explicit error; wrong-network mobile alert spacing remains a review item. No visual sign-off is claimed.

## Operational handoff

Local preview: `http://127.0.0.1:3104/v2/jobs`; EVM loopback port `8545`. Set `V2_LOCAL_UI_STATE` to the private local fixture directory containing the public-only manifest. Existing Playwright and installed Edge are required; `V2_PLAYWRIGHT_MODULE` can select the module. No browser install/download is performed.

- `web/scripts/v2-local-content-seed.mjs`: fresh-deployment-only setup; **never replay** against this used deployment.
- `web/scripts/v2-import-local-documents.mjs`: stop the owned preview before PGlite import; preserve object JSONB.
- `web/scripts/v2-browser-acceptance.mjs`: actual UI lifecycle and gated receipt/readback; do not replay submitted steps.
- `web/scripts/v2-recover-open-timeout.mjs`: original-hash read-only recovery, no second completed recovery and no sends.
- `web/scripts/v2-edge-screenshots.mjs`: actual state/form/auth/overflow/overlap witnesses and send guards.
- `web/scripts/v2-export-acceptance.mjs`: independently re-read canonical transactions/receipts/runtime; export public allowlisted fields only.
- `web/scripts/v2-verify-web.py`: serial tests; real-PG flags forced off and DSN removed from child environments.

The local EVM clock has advanced and jobs have transitioned. Use a separate fresh fixture for another full run, not reset/replay of this evidence-bearing deployment.

## UI checkpoint: scope and remaining decisions

The UI changes add category/tag chips, hide delivery forms outside the assigned operator's InProgress/RevisionPending states, show a one-line connect-wallet action when disconnected, use action-specific button labels, and show an empty Applications message only after a successful empty response.

Additional issues found during final review:
- Uncommitted chip text was lost on focus change: commit the draft on blur; regression verified.
- Next action did not react to provider account/disconnect events: subscribe and remove listeners; behavioral regression verifies disconnect, reconnect and cleanup.
- Reader status badge CSS had been accidentally removed: restored all live/delayed/offline definitions.
- Missing action labels fell back to a generic name: explicit Cancel open job and Complete after review labels added.
- Actual desktop chip clicks were intercepted by the adjacent field because `v2-span-6` had no grid rule: added six-column desktop spans and the mobile one-column reset. The browser gate exercises actual remove/add clicks, not forced dispatch.

### Public setting, unchanged

`public` remains **false by default**. The implementation requires explicit opt-in to publish document metadata; the original product rationale is not independently documented. This is not on-chain secrecy:
- List/detail API: the indexed job is still listed; only documents with `visibility='public'` contribute title/description/category/tags.
- Applications: this flag is not a direct eligibility check. Authentication, registration, canonical role/status and signing requirements remain authoritative.
- Indexer: public/private document choice does not stop chain-event indexing.
- Draft API: nonpublic draft reads are owner-restricted; the public read-model excludes private documents.

Fresh UI evidence: **12/12** new installed-Edge captures (six cases × desktop/mobile), **0 send attempts**, **0 horizontal overflow**, chain **31337** on isolated loopback RPC **56974**. Both owned Next/Hardhat processes were stopped before final build/tests. The original 32 captures are retained unchanged; the directory now contains **44 PNGs**. New filenames and evidence are in [INDEX.md](v2-ui-screenshots/edge-current/INDEX.md) and [qa001-ledger.json](v2-ui-screenshots/edge-current/qa001-ledger.json). The parent independently checked ledger counts, unique image hashes, final desktop chip layout and delivery controls. Fresh build/serial results follow separately; visual approval is still pending.

## Final UI checkpoint gates

- Production-default build: **exit 0**, all local V2 profile overrides removed from the child environment.
- Full serial web suite: **65 files, 600 tests, 594 passed, 0 failed, 0 cancelled, 6 skipped; exit 0**. All six skips are explicitly gated real-PostgreSQL tests; other skips: **0**. Real PG flags forced off, DSN removed.
- Source freeze: **174** implementation/test/script fingerprints remained unchanged across build and full suite. Build and tests ran sequentially after the screenshot processes stopped.
- Fresh browser gate: **12/12** desktop/mobile captures, **0** transaction send attempts and **0** horizontal-overflow cases. Final desktop category/tag remove/add interactions passed without forced clicks.
- Wallet checkpoint: `465624dbaf1923e748049f3dab95df040de1ae07`, pushed and remote SHA verified.
- UI checkpoint is committed with `fix(v2-ui): polish action panels and verify responsive flows`; its exact SHA is reported after commit and remote readback. No hosting/production deployment is part of either checkpoint.

## Remaining gates and Git status

1. Yusuf + Claude visual acceptance.
2. Separately approved real-PostgreSQL acceptance if required.
3. Separately approved manual user-wallet Arc acceptance.
4. Hosting/production release is separate. Contracts, V1, bot, main and environment files are outside this checkpoint.

Two-checkpoint publication: the wallet commit is identified above; the UI commit is identified by its exact message in the final gates section and by SHA in the operator's verified push report. Unrelated plans, diagnostics, caches and runtime state are excluded and preserved. No credentials, signatures, cookies, CSRF, private payloads or connection strings are included in this public report or ledger.
