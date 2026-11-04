# V2 final UI / Preview handoff

## Scope and acceptance

Branch: `feat/marketplace-v2`. Parent: `50e13c3f0b8c4b0aa0462ce12efd6d773bbe53e0`.

This checkpoint completes the final local UI refinement and its test/build/browser gates. It is **not** a hosted Preview, real-PostgreSQL, Arc indexer, user-wallet, or final design acceptance. Production, main, V1, contracts and bot source were not changed. No cloud resources, hosted env values or migrations were written.

## UI changes

- Entire Applications/Apply panel is hidden unless the job is Open and unassigned.
- Delivery has one Submit delivery / Submit revision button: persist the manifest, then prepare and execute the wallet intent. An actual provider rejection (`4001`) followed by an explicit retry is covered: one manifest POST, a fresh second preflight, persistence before wallet invocation. Only the manifest is reused; prepared transactions are not cached globally. Existing document-draft idempotency remains scoped to unchanged draft bodies.
- Next action uses separate primary/secondary buttons. Submitted client order is Approve, Request revision, Open dispute. Open-client Award only navigates to the private Applications panel; actual award still requires a selected private application.
- Category is a single select: Website, Bot, Tool, Video, Research, Design, Other. Values are lowercase; tags remain multi-chip. Legacy GameBot/game bot displays as Game bot.
- Detail/list dates use English UTC minute precision with relative days, not locale-dependent seconds.
- Make this job public defaults to checked. Accurate copy is: “Public jobs show their title and description in the job list. Turn off to keep document details out of public views. On-chain job data remains public.” The requested applicant-visibility guarantee was deliberately not used: private document details are not automatically shared with applicants by the existing API. No ACL change was made. Indexed on-chain jobs remain visible independently of document visibility.

### Existing unsupported action boundary

Inspection found that `cancelOpenJob` exists in the deployed-runtime ABI witness but is absent from the unsigned action manifest and server preflight. Its visible secondary button is therefore disabled with an explanation; even direct handler invocation makes zero requests. `completeAfterReview` is not present in the selected runtime ABI/action manifest/preflight and is not advertised. No guessed ABI, wallet target mapping, API expansion or contract change was introduced. These actions must not be represented as verified end-to-end features.

## Fresh verification

- Parent exact UI suite: **35 passed, 0 failed, exit 0**.
- Parent UI + wallet + React resume check before the final unsupported-action guard: **97 passed, 0 failed, exit 0**. Final full suite below includes the final guard.
- Final full serial web suite: **65 files, 608 tests, 602 passed, 0 failed, 0 cancelled, 6 skipped, exit 0**.
- All six skips are gated real-PostgreSQL tests. **Real PostgreSQL was not exercised.** No other skips.
- Production-default Next build: **exit 0**, with V2/local profile overrides removed.
- Source fingerprint: **184 tracked web files unchanged** across final screenshots, build and serial tests.
- Browser: installed Microsoft Edge 156.0.4314.58, headless; 1440×1000 desktop and 390×844 mobile.
- **12/12** fresh captures, **0** browser transaction-send attempts, **0** horizontal overflow. Isolated loopback EVM/PGlite evidence, not public Arc wallet evidence. Fixture setup transactions are separate from the read-only browser audit. Existing RPC 8545 was not used.
- All prior **44** PNGs preserved byte-for-byte; **56** PNGs now present.
- Screenshot ledger: `v2-ui-screenshots/edge-current/ui-final-ledger.json`; historical index preserved and appended.

### New screenshot filenames

All under `contract/docs/v2-ui-screenshots/edge-current/`:

- `ui-final-filled-chip-form-48-24-24utc-desktop.png`
- `ui-final-filled-chip-form-48-24-24utc-mobile.png`
- `ui-final-disconnected-next-connect-desktop.png`
- `ui-final-disconnected-next-connect-mobile.png`
- `ui-final-client-open-applications-empty-load-desktop.png`
- `ui-final-client-open-applications-empty-load-mobile.png`
- `ui-final-operator-inprogress-delivery-visible-desktop.png`
- `ui-final-operator-inprogress-delivery-visible-mobile.png`
- `ui-final-operator-revisionpending-delivery-visible-desktop.png`
- `ui-final-operator-revisionpending-delivery-visible-mobile.png`
- `ui-final-client-submitted-delivery-hidden-connected-approve-desktop.png`
- `ui-final-client-submitted-delivery-hidden-connected-approve-mobile.png`

## Railway gate: blocked, no writes

Recorded CLI session is invalid. No V2 project, PostgreSQL or indexer service was created; no migration or real-PG test was run, and no hosted health/job-count evidence exists. The $15/month limit was **not set or verified**.

Railway spending controls are workspace-scoped; hitting the hard limit may stop all workspace workloads. Applying that limit to a workspace containing V1 would violate the isolation requirement. Before creating billable resources, reauthenticate, establish a V1-isolated workspace, and read back the $15 hard-limit configuration. Stop if that cannot be done. Documentation: https://docs.railway.com/pricing/cost-control

After this gate, migrations must be a distinct approved execution step, never an automatic build step. Real-PG tests require a separate test schema/DB. Start the keyless indexer from the exact checked-in Arc deployment anchors and verify Marketplace/Vault history, Job 1–5, health and counts independently.

## Vercel gate: authenticated, no writes or deploy

Read-only API inspection verified the linked `arc-agent-marketplace` project and existing SSO protection `{ deploymentType: all_except_custom_domains }`. CLI project-inspect JSON omits SSO fields, so the full project API was used. No protection or sharing setting was modified.

Added env names: **none**. Applied scope: **none**. Preview URL: **not created**. Hosted build and Preview V1/V2 route verification: **not performed**. Existing Production env/deployment metadata was captured for unchanged-state verification.

Do not treat setting a DB env variable as a hosted runtime implementation: the existing `getV2LocalRuntime` path is loopback/PGlite-oriented and auto-initializes local migrations. A hosted Postgres/keyless-indexer runtime must be separately wired and verified without enabling build-time migrations or changing production defaults. Only branch-scoped Preview env for `feat/marketplace-v2` is authorized.

## Yusuf manual tests and remaining approvals

Turkish M1–M8 guide: `contract/docs/v2-manual-preview-test-guide.tr.md`. Network/faucet references and actor prerequisites are present, but the guide explicitly blocks execution until a real SSO Preview URL and live backend evidence exist. No synthetic Preview URL or success result is supplied.

Remaining: hosted infrastructure/runtime gates; final design approval using the new screenshots; Yusuf's wallet tests; approval before fixing findings from those manual tests; separate approval before Phase 1b. No public-chain transaction, external message or post was sent.
