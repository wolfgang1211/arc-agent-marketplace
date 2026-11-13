# V2 WIP preservation, 2026-11-13

Non-release preservation checkpoint from e63400a017e7bc06d7f42537d12156a31d5c2543. No current-tree acceptance or signing readiness is claimed. Historical full baseline: 644 tests, 638 pass, 6 skip, before subsequent edits. Preservation gate: git diff --cached --check identifies pre-existing blank-at-EOF whitespace in five historical rolecollisionmatrix.failed-*.md reports; these original records are preserved without normalization. This WIP is not a release-quality acceptance checkpoint.

Live signer bridge is shelved; LIVE_EXECUTION_NOT_ACCEPTED remains unconditional. C3/C4/C6/C7 remain open. No live signing or executor send is authorized by this checkpoint.

## Classification

### guide (12)
- `contract/docs/v2-local-arc-manual-test.tr.md`
- `OPERATOR-GUIDE.md`
- `contract/docs/rolecollisionmatrix.failed-focused-20261016.md`
- `contract/docs/rolecollisionmatrix.failed-focused2-20261016.md`
- `contract/docs/rolecollisionmatrix.failed-full-20261016.md`
- `contract/docs/rolecollisionmatrix.failed-full2-20261016.md`
- `contract/docs/rolecollisionmatrix.failed-run-20261016.md`
- `contract/docs/v2-local-arc-counterparty-review.md`
- `contract/docs/v2-local-arc-readiness-evidence.md`
- `contract/docs/v2-ui-screenshots/edge-current/local-arc-checkbox-desktop.png`
- `contract/docs/v2-ui-screenshots/edge-current/local-arc-checkbox-mobile.png`
- `contract/docs/v2-ui-screenshots/edge-current/local-arc-checkbox-metrics.json`

### indexer (2)
- `web/scripts/local-arc-prefetch-transport.mjs`
- `web/scripts/v2-local-arc-indexer.mjs`

### other (14)
- `web/lib/v2/server/api-runtime.mjs`
- `.hermes/plans/2026-09-24-real-world-product-plan.md`
- `.hermes/plans/2026-10-12_144116-marketplace-v2.md`
- `CLAUDE_REVIEW_NOTES.md`
- `web/lib/v2/server/local-arc-runtime.mjs`
- `web/scripts/start-v2-local-arc.cmd`
- `web/scripts/stop-v2-local-arc.cmd`
- `web/scripts/v2-local-arc-checkbox-capture.mjs`
- `web/scripts/v2-local-arc-control.mjs`
- `web/scripts/v2-local-arc-db.mjs`
- `web/scripts/v2-local-arc-list-probe.mjs`
- `web/scripts/v2-local-arc-preflight.mjs`
- `web/scripts/v2-local-arc-smoke.mjs`
- `web/scripts/v2-private-context-probe.mjs`

### signer (6)
- `web/lib/v2/server/durable-authorization.mjs`
- `web/lib/v2/server/local-arc-counterparty-policy.mjs`
- `web/scripts/v2-local-arc-counterparty-helper.mjs`
- `web/scripts/v2-local-arc-counterparty.mjs`
- `web/scripts/v2-local-arc-secure-executor-worker.mjs`
- `web/scripts/v2-local-arc-secure-executor.py`

### test (9)
- `web/test/v2-local-arc-counterparty.acceptance.test.mjs`
- `web/test/v2-local-arc-counterparty.integration.test.mjs`
- `web/test/v2-local-arc-counterparty.test.mjs`
- `web/test/v2-local-arc-indexer-adaptive.test.mjs`
- `web/test/v2-local-arc-indexer-diagnostics.test.mjs`
- `web/test/v2-local-arc-indexer-prefetch-core.test.mjs`
- `web/test/v2-local-arc-indexer-prefetch.test.mjs`
- `web/test/v2-local-arc-runtime.test.mjs`
- `web/test/v2-local-arc-secure-status.test.mjs`

## Exclusions and local preservation

Keys, databases, logs, authorization records and generated build/cache outputs are not staged. Existing untracked outputs and fixture claims remain untouched locally, with an additional verified non-public local archive and per-file hash inventory outside the checkout. No reset, clean, deletion or force push is used. Local-only excludes keep generated artifacts out of git status; they are not a remote backup.

## Next gates

Promote only required local runtime/indexer files. Implement the newly authorized finalized log-only historical scan and bounded 32-block head reorg checks, measure RPC methods, test reorg/gaps/replay, verify actual health and Job 5 events. Update manual second-Brave-account steps. Do not reactivate the shelved signer.
