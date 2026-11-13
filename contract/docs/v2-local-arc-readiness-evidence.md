# Local Arc V2 acceptance evidence

## Verified result, 13 November 2026

**This section supersedes every historical gate below.** Local reader catch-up is complete under the user's explicit finalized-log policy. Signer work is shelved, not a remaining development task. M3 and M8 are not authorized.

- Parent frozen-source serial gate: **8 files, 104 tests, 104 pass, 0 fail, 0 skip**, exit 0, **297.282 seconds**, source unchanged, SHA-256 `646c76b72c9ca018e0fdaef284b1394197811be581a472f88e93005736692b82`. Only documentation changed after this gate. This is focused acceptance, not a new full-repository suite or real PostgreSQL concurrency test.
- Production Next build exit 0 with local Arc profile, one worker (`CIRCLE_NODE_TOTAL=2`) and bounded heap (`NODE_OPTIONS=--max-old-space-size=768`). Two existing React hook dependency warnings remain. No install/cloud deployment.
- Initial real cursor `68385081`; first engine start `2026-11-13T17:07:23.614Z`. First recorded fresh observation `2026-11-13T17:19:05.074Z`, **701.461 seconds** after start, including one controlled restart. This is an upper bound to observed completion, not the exact first-completion time. Cursor/safeHead `72209807`, head `72209808`, healthy, stale false, gap null, lag 0 relative to safeHead.
- Independent later smoke at `2026-11-13T17:25:06.084Z`: cursor/head/safeHead **`72210129`**, healthy, stale false, gap null, lag 0. Historical `lastRPCFailure`/`lastFailedRange` fields retain recovered failures; they are not current failure status.
- Explicit health model: `verificationMode: finalized-log-range-address-filtered`, `finalityTrust: provider-finalized-tag`, `perBlockReceipts: false`, `logsBloomProof: false`. Old finalized ranges use address-filtered logs, maximum 10,000 inclusive blocks; boundary/event headers and transaction-position binding. Only adjacent observed headers assert parent continuity. Reorg search is clamped to the actual head's final 32 blocks; older finalized conflicts fail closed. No intermediate full-header, receipt or bloom proof is claimed. Dense core semantics remain separately regression-tested. Prefetch OFF; concurrency 1 (cap 2); exponential backoff and full Retry-After preserved. Official public RPC only.
- Instrumented **1,000 empty-block fixture** through both real engines: old **2,017 HTTP requests**, new **81**. This is deterministic fixture measurement, not a live old-engine benchmark; old nonempty blocks additionally require receipt evidence. Checked-in probe reports per-method counts. New historical path has **zero receipt calls**.
- Separate live restart-local snapshot at first recorded fresh observation: **2,314,726 committed scanned blocks, 3,971 HTTP requests**, **1.7155378218 requests/1,000 blocks**. Includes retries, attestation and near-head maintenance; excludes the earlier process's counters. Maintenance increases this ratio after catch-up, so it is a bounded observed window, not a permanent rate guarantee.
- Job 5 withdrawal now has real canonical DB readback: transaction `0x9426285500c04fb4b77ff9d3907e0977d1ec7d973f1e4035df44db177342c15c`, block `68548436`, event `CreditWithdrawn`, account `0x64b223aa99f0a1e3cd151fb982e2fff9255035c8`, raw amount `6000000`, `canonical: true`. Public log/header binding matches the existing one-time withdrawal record. The event itself has no job ID. Receipt RPC returned null on repeat reads: **no new receipt-success claim and no transaction replay/send**.
- Local smoke exit 0: all five checked routes 200, host guard 403, removed shutdown endpoint 404, three migrations, five indexed jobs. Three jobs-list samples: **55.773 / 16.346 / 12.751 ms**, HTTP 200/five items. Local HTTP/build acceptance is not new wallet/browser lifecycle acceptance.
- Three named local PM2 processes online: DB, indexer and web. Not cron. Loopback web http://127.0.0.1:3102/v2 , health http://127.0.0.1:3103/health , DB `127.0.0.1:54329`.
- First Claude implementation call timed out and was not accepted as completion. Separate read-only CLI review returned a valid session/result. Parent independently added red/green head-race, transaction-binding, missing-event replay, no-double-projector replay and historical-reorg regressions; actual parent execution is the acceptance evidence.
- Shelved signer source is unchanged from WIP, not activated or newly developed. Gate regression passes; `LIVE_EXECUTION_NOT_ACCEPTED` remains before DPAPI/wallet access, C3/C4/C6/C7 open. Existing approved executor has deploy/config/all, not a safe one-job resolver entrypoint; not executed/changed. **M8 remains blocked** until a safe separately approved single-job path exists and Yusuf requests that exact job/decision.
- **M3 remains blocked** pending second Brave account address, read-only funding/registration checks and explicit Yusuf approval. Funding and all account signatures belong to Yusuf. No cloud, main, V1, contract or bot change; no public-chain send, decrypt or account mutation.

## Historical observations below

These are archived context only. In particular, old stale-health, unproved-withdrawal and future-signer-work statements below are superseded, not current instructions or remaining gates.

## 13 November checkpoint: local policy changed explicitly

- Preservation branch `wip/v2-signer-indexer-2026-11` is remotely verified at `f189d1534fb93f0da6a2363c2cbed0e1c4a1ddaa`: 44 reviewed source/test/docs/plan files, not a release acceptance. Original EOF whitespace in five historical failure reports is intentionally preserved. Source work is classified in `v2-wip-preservation-2026-11.md` on that branch.
- Initial expanded status contained 2,915 files, largely generated artifacts/cache and prior evidence. A verified non-public archive plus SHA-256 inventory is retained at `C:/Users/wolfgang/arc-agent-marketplace-preservation/2026-11-13/initial-uncommitted-preservation.zip`; 2,872 excluded local outputs/fixture claims were not deleted. Local-only Git excludes prevent accidental staging; keys, PGlite data, logs and authorization records are absent from the WIP commit.
- The user explicitly replaced full per-block historical receipt/bloom verification for this **local Arc** path with address-filtered finalized log ranges, event/boundary headers and a 32-block near-head reorg window. This is a distinct provider-finality/log-completeness trust model, not the old full receipt proof. Default core semantics must not silently change.
- At DB startup the actual Arc store had five jobs, 76 fork-aware indexed events and cursor `68385081`. No local Arc services were running initially. Only the named Arc DB was started; unrelated PM2 applications were not changed.
- Read-only public-RPC proof found the previously missing withdrawal: tx `0x9426285500c04fb4b77ff9d3907e0977d1ec7d973f1e4035df44db177342c15c`, block `68548436`, canonical block hash `0x2ef500b0aa2d30e8223ad11cf05a815a2d3e865d4dddc8255bb5cc408b93dce3`, `CreditWithdrawn` account `0x64b223aa99f0a1e3cd151fb982e2fff9255035c8`, raw amount `6000000`. Both the block transaction list and address-filtered log bind the exact transaction/block hash. **The public `eth_getTransactionReceipt` endpoint returned null on repeat reads; this is log/header evidence, not a new receipt-success claim.** The record matches the existing one-time Job5 withdrawal record; the event itself has no jobId field. DB indexing still needs readback after catch-up.
- Live signer bridge is permanently shelved, C3/C4/C6/C7 open. Operator actions are manual through Yusuf's second Brave account; address/funding preflight awaits that address. No keys, signing, funding, manifest/application writes or sends are authorized during setup.
- M8 inspection found `approved-v2-executor.js` accepts deploy/config/all, loads broad wallet roles and includes deployments/config/funding/scenarios. It has no scoped one-job resolve command; it was not executed. Do not substitute that broad executor for M8. A safe approved single-job entrypoint must be identified or separately approved before any decision send.

## Scope

Branch: `feat/marketplace-v2`. Local application, PGlite socket, keyless indexer and V2 UI only. No cloud deployment, main merge, V1/contract/bot source modification, or public-chain counterpart transaction is authorized by this setup run. Counterpart operations require separate specific chat requests.

## List latency diagnosis

Measured through the real read handler, real PostgreSQL-wire PGlite database and actual Arc public RPC, while the existing local indexer was running:

| Metric | Before | Projection-only list |
|---|---:|---:|
| Indexed items | 5 | 5 |
| Handler wall time | 35,611.9713 ms | 26.878 ms |
| Pool acquisition including initial connection | 5.2643 ms | 4.4243 ms |
| DB query wall time | 7.9176 ms | 5.7594 ms |
| DB queries | 6 | 6 |
| RPC calls | 250 | 0 |
| Aggregate RPC duration | 36,253.956 ms | 0 ms |
| RPC failures | 1 | 0 |

Aggregate RPC timing is not an exclusive wall-time partition because reader operations may overlap. Pool acquisition includes initial TCP connection; it is not a server-internal lock metric. DB query wall time includes wire/server waiting. These measurements do not prove PGlite runs transactions concurrently; they show that database/socket waiting was not the dominant cause of this observed timeout.

The old list initialized one canonical snapshot per job. The list now returns indexed projections and public documents without RPC. Detail/action preflight retains canonical reads and transaction freshness checks. No missing fields are fabricated as fresh state.

After production build and restart, actual HTTP `GET /api/v2/jobs` returned 200 with five items in three samples: **36.685 ms, 29.442 ms, 12.999 ms**. All were below the 2-second target. The complete local smoke script exited 0: `/v2`, `/jobs`, profile, health and jobs returned 200; wrong-host guard returned 403 and the removed HTTP shutdown endpoint returned 404. A successful smoke is not proof of fresh indexing or signer readiness.

## Indexer gate

Adaptive batching is local-only. The canonical core validation is unchanged: headers, parent continuity, query/receipt completeness, bloom, ABI provenance, reorg, projection and atomic cursor persistence remain required. Only the existing public RPC `https://rpc.testnet.arc.io` is used.

Observed after adaptive runner restart: indexed block `68084269`, gap `68084270` through `70926941`, reason `pending_verified_range`, status `degraded`, original status `catching_up`, stale true. This is a historical observation, not a fixed final head. The five real indexed jobs are #1–#5; three separate migrations are present. Public RPC probes observed intermittent 429 responses. No additional RPC or paid service was configured. **History catch-up and fresh-health acceptance remain open.**

## UI and screenshots

Public checkbox layout is narrowly constrained to 18x18px adjacent to its label, preserving checked-by-default behavior. Proposal expiry initializes three days after the actual current clock using UTC formatting and preserves edits. The parent focused UI/API/runtime/indexer/counterparty run passed 51 tests before the final secure-executor integration work. Production Next build exited 0, with two existing React hook dependency warnings.

The earlier Brave capture attempt was blocked and was not bypassed. After the user's new explicit authorization, two screenshots were captured using headless Playwright `channel: msedge`, without connecting to Brave or the user's wallet. Files: `v2-ui-screenshots/edge-current/local-arc-checkbox-desktop.png` (1440×1000) and `local-arc-checkbox-mobile.png` (390×844). Parent vision inspection and the saved metrics confirm a checked 18×18 px checkbox, 9 px label gap, and no horizontal overflow on either viewport.

## Post-review findings

The secure executor's key-path status originally claimed ready from file existence. Parent review rejected that claim. Live execution is now explicitly blocked **before DPAPI or keystore access**, in both launcher and worker, with `LIVE_EXECUTION_NOT_ACCEPTED`. Remaining gaps include real API payload integration, transaction fee/nonce population, authenticated challenge validation, strict canonical target and receipt/readback binding, durable authorization replay protection, and action-specific account/application readback. Injected execution-order tests are not proof of working real signing. No real decrypt, signature, counterpart API write or broadcast was performed. A real launcher denial probe returned exit 2 and `LIVE_EXECUTION_NOT_ACCEPTED` before DPAPI. Direct worker startup also revealed an unresolved `ethers` package import in the web package; it exited before accepting input and is not a ready signing path.

The first complete frozen-source suite returned **633 tests, 626 pass, 1 fail, 6 skip** (71 files). Its single failure was the prior list test expecting live RPC-derived timeout context. That expectation was updated to the explicitly authorized projection-only list contract, while detail canonical-action assertions remain unchanged. The focused follow-up passed **7/7**. The failing log was archived outside the repository; this red run is not the final reviewed result below.

A later actual health observation had gap **68086648–70930486**, **2,843,839 blocks**, reason `pending_verified_range`, degraded/stale. Across two real observations 1,653.586 seconds apart, the cursor advanced 2,174 blocks while head advanced 3,256: measured **1.315 indexed blocks/s versus 1.969 new blocks/s**, so lag grew by **1,082** blocks in this interval. Adaptive batching has not established sustainable catch-up; no fresh claim is made. A subsequent HTTP list sample was 145.454 ms (200, five items), still below two seconds.

## Remaining acceptance gates

### Subsequent independently verified checkpoint

- Accepted nine-file commit pushed and remote SHA read back: `e63400a017e7bc06d7f42537d12156a31d5c2543`. No runtime key, PGlite data or log is included. New unaccepted runtime/signer work is separate.
- Parent serial focused indexer/counterparty/integration/status tests: **30 pass, 0 fail**, exit 0. This includes production-default 429 delay, non-log-method cooldown, Retry-After preservation and per-request timeout with an upstream signal.
- Parent complete frozen-source serial run: **73 files, 644 tests, 638 pass, 0 fail, 0 cancelled, 6 skipped**, exit 0, **665.9 seconds**, `sourceUnchanged: true`, source SHA-256 `71d0a6587f527fedb96e517917857605cc01366d6688aaa5f275ab8fc5181a97`. Log: `%LOCALAPPDATA%/hermes/cache/scratch/v2-local-arc-reviewed-serial-20261106-200115.log`. This checkpoint precedes the next counterpart-security/prefetch changes and does not validate them prospectively.
- Controlled, separately address-filtered official RPC probe: both marketplace and vault accept **10,000 inclusive blocks**, reject **10,001** and **10,002**, and reject 50k/100k/500k with JSON-RPC `-32012`, exact message `requested range too large`. Earlier 500k HTTP 429 was a rate limit observation, not proof of a range limit. Only `https://rpc.testnet.arc.io` was used.
- Live failure telemetry after restart identified `eth_getBlockReceipts`, block `0x4103d41`, HTTP 200 / JSON-RPC `-32005`; controlled retry returned four receipts. Another actual failure was `eth_getLogs`, range `68173323–68173372`, HTTP 200 / `-32603`, demonstrating that even small log ranges can fail. The safe public telemetry intentionally does not expose arbitrary provider bodies.
- Sustained measurement over **100.185 seconds**: cursor +75 blocks, head +242 blocks, **0.7486 indexed blocks/s versus 2.4155 new blocks/s**. At `2026-11-06T17:03:24.134Z`: cursor `68173347`, head `71060457`, gap `68173348–71060457`, lag `2887110`, degraded/stale. Catch-up is not established.
- Job 5 canonical event DB now includes timeout/fault settlement at block `68173105` (tx `0x1e518303ebfc7449ae5145a2fcd02735fbef5254618515bc2c674b39b96bb837`) and stake slash/fault resolution at `68173137` (tx `0x0cac31aed0b7021c93b6e32bc9e29f5c05fd2ecf06d8a86a50b971840b078fe4`). Projection: state version 4, status 7, reserved stake 0. Job 5 withdrawal remains unproved; earlier withdrawal events precede Job 5 creation. A read-only log probe over `68173105–68183104` also contained no withdrawal. This historical job's client is not Yusuf and it must never be used for counterpart execution.
- Read-only JSON-RPC batch feasibility: 20 historical header/receipt pairs plus chain ID returned 41 responses, HTTP 200, no errors, **161.0469 ms** and 287,713 bytes. This transport benchmark did not translate to sustainable indexing. Parent review found and fixed small-window cardinality, abort/cache reuse, bounded-window eviction, head ceiling, repeated-read freshness and request-cap defects. The new transport plus unchanged core guards passed **95 tests**, exit 0, including real PGlite/indexer-through-prefetch source-change and missing-receipt rollback tests. A 60.377-second live trial then advanced 36 blocks against head +126: **0.5963 indexed blocks/s vs 2.0869 new blocks/s**, with repeated `-32005` rate limits. All 15 concurrent list reads returned HTTP 200/five items; maximum list latency **155.2291 ms**. **Prefetch was rolled back to OFF (`V2_LOCAL_ARC_PREFETCH=0`)** and health readback confirmed `transportMode: scalar`. This is not a successful catch-up result.
- Fixture isolation incident: the first new prefetch-core test accidentally omitted `dataDir` and added synthetic empty-header fixture records to the inactive legacy local default `%LOCALAPPDATA%/hermes/state/alphaboard-v2/pglite`. Subsequent tests now use unique explicit scratch directories. The actual Arc socket DB is the separate `alphaboard-v2-local-arc/database` directory and was not replaced or seeded by those fixtures. The legacy fixture records were preserved, not silently deleted/restored; that legacy store must not be used as public-chain evidence or resumed as a real-chain runtime without review.
- Counterparty remediation worker returned an all-eight-closed claim, rejected by parent source review. After parent fixes, the exact four-file focused suite passed **28/28 twice consecutively**, exit 0 on both runs. C1/C2/C5/C8 helper boundaries improved; **C3/C4/C6/C7 remain open in the actual launcher/worker** (independent receipt/transaction/block evidence, canonical mutual state, trusted pre-decrypt authorization handoff, canonical pre/post account deltas). Updated source locations, risks and fixes are in `v2-local-arc-counterparty-review.md`. Launcher and worker remain unconditionally blocked before DPAPI; no real signing or broadcast occurred.
- Latest parent HTTP health read: cursor `68177738`, head `71067092`, safeHead `71067093`, reported lag `2889355`, gap `68177739–71067093`, degraded/stale, `transportMode: scalar`, `headerBatchLimit: 1000`, lastSyncedAt `2026-11-06T18:01:25.561Z`. Last RPC failure remains `eth_getBlockReceipts` at `0x4104f5a`, HTTP 200 / JSON-RPC `-32005`, rate_limited. A jobs HTTP sample returned 200 in 14 ms; a subsequent exact envelope read confirmed `data.items.length === 5`.
- Authorization records now default to persistent local state outside the repository, not OS temp or checkout. Every acceptance/execution fixture explicitly injects a unique scratch ledger. Existing earlier `.local-counterparty-authz/` fixture claims are preserved and excluded from any commit/real approval use. Exclusive-create claims are flushed before returning; expired claims reject and concurrent claim tests wait for both contenders to settle.

- Complete authentic historical backfill and prove healthy, stale false, gap null, freshness at most 30 seconds.
- Finish and independently test real secure DPAPI counterpart/API wiring without signing or sending during setup.
- Run fresh affected/full gates after the next security and prefetch modifications; do not reuse the 644-test checkpoint as prospective evidence.
- Commit/push only independently reviewed follow-up files; the accepted nine-file commit is already remote-verified.
- Do not authorize M3 until its prerequisites are actually verified.
