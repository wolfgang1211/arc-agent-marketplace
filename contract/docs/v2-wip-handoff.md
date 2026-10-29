# V2 local WIP handoff

This branch is a preservation checkpoint, NOT a release or an acceptance approval.
Base: `7f7926934fd208c80a60a4f1cef559b7a883b83f` on `feat/marketplace-v2`.
Do not merge into main or deploy this WIP. The user requested a separate GitHub backup so another agent can continue.

## Preserved scope

- `/v2` Next.js pages and `/api/v2` runtime/routes.
- Authentication, private application/delivery APIs, unsigned transaction preflights, server-owned intents and receipt/readback verification.
- Explicit Arc-default and opt-in local Hardhat chain profiles, reader/indexer integration and production/Vercel guards.
- Shared browser-wallet execution, exact allowance handling, pending transaction storage, tests and local browser probes.
- Loopback-only local Hardhat configuration and deployment/seed script.

## Verified historical evidence, not current release acceptance

Earlier API/UI checkpoint: 476 passing tests, 6 real-Postgres tests skipped, build exit 0. Those results predate later changes and must not be represented as this branch's full regression result.
A real injected EIP-1193 wallet in installed headless Edge created local chain 31337 job 8. Transaction: `0x17a730669e676c67ca5ee5b6f67d0d863e616e04f22b89109ab85ea924dd8530`. Subsequent authenticated readback returned confirmed with actual job/client/terms/document hashes. The UI reload/resume success locator still timed out; complete browser acceptance is NOT established.

## Known open acceptance gates

1. Re-read interrupted worker edits, especially `api-private.mjs`, `job-access.mjs`, `action-panels.js`, and `ui-actions.mjs`. Workers were interrupted without final reports.
2. Verify all private API/ACL/SQL paths use the selected profile; register and verify the canonical EIP-712 application-context route in the runtime. Verify local signatures and browser application/award flow.
3. Verify account readback from actual token and liability deltas. An audit found omitted expected fields could be exempted and echoed; do not treat a receipt alone as proof.
4. Verify withdrawStake post-state arithmetic and exact depositStake allowance metadata.
5. Close broadcast-before-persist and timeout/manual-retry duplicate-send windows. Persist uncertain broadcast state, require reconciliation, and never automatically resubmit.
6. Require exact profile/chain/wallet/action/hash identity in readback and reload resume. Handle terminal/reverted/stale records without unbounded mount retries.
7. Finish link delivery and submitRevision transaction preparation, lifecycle state/version expectations, mutual actions and timeout semantics against canonical deployed ABI.
8. Complete real browser flows: create/apply/award/deliver/revise/resubmit/approve/credit withdrawal; mutual; dispute/resolver; stake deposit/withdraw; timeout.
9. Prove success UI is absent until both receipt and canonical readback are available, including reload resume and failure cases.
10. Capture requested desktop/mobile screenshots and file-to-screen/status index. No visual acceptance yet.
11. Run full serial regression, separate real-Postgres skips, production-default build, security/scope review. No final quality approval is implied by this WIP commit.

## Checkpoint verification

Parent-run focused command: `node --test --test-concurrency=1 test/v2-chain-profile.test.mjs test/v2-profile-transport.test.mjs test/v2-wallet-execution.test.mjs test/v2-ui-actions.test.mjs test/v2-ui-client.test.mjs` from `web/`.
Result: **39 tests, 38 passed, 1 failed, 0 skipped**, exit 1. Failure: `role/status matrix exposes only canonical actions`, operator RevisionPending now advertises `submitRevision` while the existing assertion expects only `openDispute`. This mismatch remains unresolved; neither implementation nor assertion was changed just to make the WIP green. Full regression/build were not rerun for this preservation-only checkpoint.

## Local setup limitations

Local database, manifest, evidence, accounts and build outputs are intentionally NOT published. A new checkout needs its own local deployment/manifest. `contract/scripts/v2-local-visual-setup.cjs` currently references untracked `artifacts-v2-runs50`; regenerate/verify artifacts against the checked-in runtime ABI witness and documented compiler settings before use. Do not silently substitute an arbitrary build.
Several browser probes reference the original operator's installed Playwright and scratch directories with absolute Windows paths. Adapt those paths explicitly; no browser installation was authorized.

## Safety constraints

Arc Testnet 5042002 stays the default. Local Hardhat 31337 is opt-in only and rejected for production/Vercel. Browser E2E must use only 127.0.0.1 local test accounts. Never use test accounts on Arc or mainnet. No server signing/broadcast, no private-key collection, no unlimited approvals, no automatic transaction retries. No changes to V1/contracts/production environments, no cloud resource creation, no main merge. Railway/real-Postgres activation, user-wallet Arc testing and design changes require separate approval.
