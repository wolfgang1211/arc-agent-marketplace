# Interrupted marketplace batch integration

Task: `t_c3a0dddf`. Local integration only; no push, deployment, wallet transaction, worker activation or live-job creation.

## Starting inventory and attribution

There was no halted Git merge or separate branch history to reconcile: all four interrupted workers had written into the shared `main` working tree. Initial inventory was 14 tracked modifications and 21 untracked files. Attribution is inferred from file contents and each source card's recorded intent, not claimed as Git authorship.

| Origin | Files (relative to repository root) |
| --- | --- |
| `t_25742d7a`, source preflight | `bot/src/safe-fetch.mjs`; `web/package.json`; `web/package-lock.json`; `web/app/api/source-preflight/route.js`; `web/lib/server/safe-fetch.mjs`; `web/lib/server/source-preflight.mjs`; `web/lib/source-preflight.mjs`; `web/test/source-preflight-smoke.mjs`; `web/test/source-preflight.test.mjs` |
| `t_e90d0496`, explicit v2 criteria | `bot/src/artifact.mjs`; `bot/src/eligibility.mjs`; `bot/src/url-summary-schema.mjs`; `bot/test/artifact.test.mjs`; `bot/test/eligibility.test.mjs`; `bot/test/url-summary-v2.test.mjs`; `web/app/components/workflows.js`; `web/app/components/job-description.js`; `web/lib/url-summary-job.mjs`; `web/lib/url-summary-schema.mjs`; `web/lib/workflow-templates.mjs`; `web/test/url-summary-job-form.test.mjs`; `web/test/workflow-templates.test.mjs`; `web/test/url-summary-v2-ui.test.mjs` |
| `t_f95f75e4`, lifecycle/activity | `web/lib/timeout-recovery.mjs`; `web/lib/job-lifecycle.mjs`; `web/app/components/job-lifecycle.js`; `web/app/components/recent-activity.js`; `web/app/job-lifecycle.css`; `web/test/job-lifecycle.test.mjs` |
| `t_bc8e653f`, role views | `web/lib/job-views.mjs`; `web/app/components/job-views.js`; `web/app/job-views.css`; `web/test/job-views.test.mjs`; `web/test/job-views-ui.test.mjs` |
| All four | `web/app/page.js` |

Additional integration documentation: `bot/README.md`, the historical notice in `web/docs/workflow-template-spec.md`, `web/docs/url-summary-v2.md`, and this handoff. No contract, ABI, deployment, credential or unrelated application files were changed.

## Reconciliation decisions

- `web/app/page.js` imports, posting continuation, job-description renderer, timeline/activity mounts and role/status selection: disjoint intents, retain all four. URL preflight wraps both allowance approval and postJob; role selection uses the existing bounded page, not a second role-specific data source.
- `web/lib/timeout-recovery.mjs` completed-payment wording versus new lifecycle expectations: same question, different API expectations. Restore the legacy helper and its exact tracked assertion unchanged. Add `settlementOutcomeCopy` in `web/lib/job-lifecycle.mjs` for the new settlement UI, retaining gross/net qualification. The new lifecycle assertion is redirected to this actual UI helper with its expectation intact and an additional fee assertion. The old helper and its test have no diff against HEAD. Non-approval statuses delegate to the legacy helper.
- URL-summary request format: v2 supersedes the five-field builder only for new requests. Preserve strict v1 parsing and its artifact field set; never infer historical criteria. Keep category `url-summary-v1` as routing identity. New artifacts bind the accepted v2 request and exact ordered criteria. Byte-parity tests keep standalone bot/web protocol copies aligned.
- Lifecycle/activity evidence: contract status and chain timestamp win over backend progress or elapsed browser time. Latest-six activity is explicitly a creation-ordered current-state snapshot, not an event chronology. No invented transaction hashes. Explorer links point to real contract/block evidence.
- Role views: current-page client/agent matching with case-insensitive addresses, explicit bounded counts, URL/history state, walletless public marketplace and distinct loading/error/empty states. Selecting a different role resets page; selecting a status keeps the current page so the user can scan it under that filter.
- Homepage discovery label: replace ambiguous 'latest records' with 'bounded on-chain page'; contract paging is oldest-first by ID, with page-local presentation sorting.

Hotspot: `web/app/page.js` has collided across all four workers. Keep dedicated modules/components and avoid concurrent edits to its orchestration in future batches.

## Verification from this integration run

| Execution | Actual result |
| --- | --- |
| Initial bot full test suite and check | 65 tests, 65 pass, 0 fail; check exit 0 |
| Initial web full suite | 149 tests, 148 pass, 1 fail at the required legacy terminal-copy assertion |
| Reconciled web full suite before final build | 149 tests, 149 pass, 0 fail, 0 skipped |
| `npm --prefix web run lint` | Exit 0, no warnings/errors |
| `npm --prefix web run build` | Exit 0, production homepage and dynamic source-preflight route built |
| Web full suite after final build | 149 tests, 149 pass, 0 fail, 0 skipped; compiled-artifact guards exercised |
| Final bot full suite and check | 65 tests, 65 pass, 0 fail, 0 skipped; check exit 0 |
| `forge test` from root | Exit 0, `Nothing to compile`, 0 tests. This repo has no Foundry configuration or Solidity test suite; this is NOT contract-test coverage. |
| Actual contract runner, `npm --prefix contract test` | Hardhat: 99 passing, exit 0 |
| Production `source-preflight-smoke.mjs --live` | Exit 0; three unsafe/DNS cases rejected with safe reason codes, GET 405, homepage 200 with expected walletless copy, public IANA source returned exactly `{ "ok": true }` |
| `git diff --check` | Exit 0; only Git LF/CRLF conversion notices |
| Conflict-marker scan | 180 tracked/nonignored text files scanned before this handoff; 0 conflict markers. Broad initial search timed out, so a bounded Git-file-list scan was used instead. |

The exact timeout assertion at `web/test/timeout-recovery.test.mjs:201` was not narrowed or edited. New schema snapshots are exact assertions, not relaxed matching. Test counts above refer to each suite separately, not unique totals across repeated executions.

## Remaining human verification and local runtime

- Mobile/visual QA was attempted only against the existing Brave window. Inspection was refused with `browser_consent_required`: explicit existing-profile approval is needed. No isolated browser was launched, no policy changed, and no browser gate bypassed. React render/interaction tests pass, but they are not mobile layout evidence.
- A loopback-only Next production preview at `http://127.0.0.1:3187` returned HTTP 200. Cleanup through the process manager timed out; the surviving listener was identified as this preview's Node process. Forced cleanup was denied by unattended command approval. The preview may therefore remain running; do not claim it stopped. This is a process, not a cron job or public deployment.
- Compatible bot rollout must precede new v2 production jobs. No claim is made that a currently deployed bot already supports v2.

Ready for integration review, with browser/mobile verification explicitly outstanding and the Forge-versus-Hardhat runner mismatch disclosed.
