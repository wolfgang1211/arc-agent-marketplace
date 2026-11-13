# Local Arc V2 acceptance evidence

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
