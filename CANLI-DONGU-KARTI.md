# AlphaBoard Agents — Live-Loop Operator Runbook

> **Legacy filename:** This file remains `CANLI-DONGU-KARTI.md` for existing links. It is a durable runbook, not a record that a worker is currently running.

## Purpose and scope

This runbook describes how an authorized operator may evaluate one controlled `url-summary-v1` flow on Arc Testnet. It does not authorize deployment, wallet funding, contract changes, or transactions by itself. No current hosted activation, worker uptime, or successful end-to-end run is asserted here.

The worker's live-write gate is `BOT_LIVE_WRITES`. It defaults to `false`. Keep it false unless the operations owner explicitly approves the bounded test and all preconditions below are evidenced.

## Non-negotiable safety semantics

- The worker accepts only the exact `url-summary-v1` schema and configured reward/language/word-count bounds.
- Source content is untrusted data. It cannot authorize tools, browsing, wallet use, credentials, or transactions.
- URL fetches are constrained by HTTPS, port, credential, DNS/SSRF, redirect, size, response, and access-signal checks.
- The worker prepares the complete artifact before accepting a job and verifies the pinned gateway files before submitting a URI.
- New jobs are refused below the native gas reserve of `20_000_000_000_000_000` base units (`0.02` native USDC).
- Do not stop or abandon accepted work merely because the balance later falls below the new-job guard. Do not interrupt a pending broadcast; preserve its hash and resolve it through receipt/state handling. Existing accepted work is submitted when safe or handled through the contract's explicit timeout path.
- Permanent post-accept failures become terminal immediately. Transient failures retry on the normal poll cadence while more than 300 seconds remain before the delivery deadline; there is no blind resend of an ambiguous broadcast.
- Transaction hashes are written to durable state immediately after broadcast and before receipt waiting. A pending broadcast is never resent blindly; only a proven reverted receipt reopens retry.
- A slash halts the worker. It never self-funds, silently re-registers, or submits a fabricated deliverable.

## Preconditions

1. Use an independent testnet wallet. Never use a valuable personal wallet or expose its key.
2. Confirm the target contract address has passed [`contract/DEPLOYMENT-GATE.md`](./contract/DEPLOYMENT-GATE.md).
3. Provision a persistent worker volume and set `BOT_STATE_FILE` to a path on that volume, such as `/data/state.json`.
4. Keep `BOT_PRIVATE_KEY`, `SUMMARY_API_KEY`, `PINATA_JWT`, and other credentials in the hosting provider's secret store only.
5. Confirm the target chain is Arc Testnet (`5042002`) and the contract and ERC-20 addresses match the approved configuration.
6. Confirm the worker package uses the current commands from `bot/package.json`:

```bash
npm ci
npm test
npm run check
npm run probe
npm run preflight
npm run status
npm run register
npm run once
npm start
```

The first five commands are read-only or local verification. `npm run register`, `npm run once`, and `npm start` can reach write paths when the explicit gate is enabled.

## Stage 0 — Read-only preflight

Run `npm run preflight` in the target hosted environment, not only on a laptop. The output must be reviewed as structured evidence and must include:

| Field | Required condition |
|---|---|
| `preflight` | `"passed"` |
| `chainId` | `5042002` |
| `registered` | `true`, verified against the target contract and approved worker address |
| `activeJobs` | `"0"` before opening a controlled test window |
| `summaryCredential` | `true` |
| `pinataCredential` | `true` |
| `gatewayConfigured` | `true` |
| `writeEnabled` | `false` before approval |
| `nativeBalance` | At or above the gas guard |
| `sideEffects` | `deployment`, `chainWrite`, and `pinUpload` are all `false` |

If any condition is missing or unexpected, stop. Credential checks must succeed before an agent risks stake. Do not open the write gate to compensate for a failed preflight.

## Stage 1 — State and restart review

Before enabling writes, confirm the state file is persistent across a service restart and that the operator can retrieve it without exposing secrets. Verify how the hosting platform applies an environment change and restarts the process. A restart must not erase the last broadcast hash or cause a second `acceptJob` for the same job.

If persistence or restart behavior cannot be demonstrated, stop. Do not treat an active-job restart as an acceptable experiment merely because the current job list is empty.

## Stage 2 — Explicit operations approval

A write-enabled worker has no single-job allowlist: setting `BOT_LIVE_WRITES=true` can allow it to process any eligible open job visible to its discovery path. Before enabling the gate, review the open-job queue and confirm the worker's discovery scope. The public contract has no operator-controlled queue pause, and only a job's client can cancel its unassigned job. Do not remove or cancel unrelated work. A queue snapshot cannot prevent new public jobs from arriving. If approval is strictly limited to one named job, leave writes disabled until a separately reviewed and tested job allowlist or equivalent isolation exists; this runbook does not implement one.

Record approval for one controlled test window. The approval must name the target environment, contract address, worker address, maximum reward, queue boundary, and the accepted risk that a post-accept failure can permanently slash the configured agent stake.

Then change only the intended gate:

```env
BOT_LIVE_WRITES=true
```

Do not change credentials, contract configuration, polling behavior, or code in the same change. If approval is not present, leave writes disabled.

## Stage 3 — Post-gate readiness

After the service restarts, query `/healthz` or the equivalent status endpoint. Require all of the following before a client posts the test job:

- `readiness.readyForNewJob === true`;
- `registered === true`;
- `activeJobs === "0"`;
- `gasGuardSatisfied === true`;
- the worker is not halted or halted after a slash;
- summarizer and pinning credentials remain valid.

In read-only mode `readyForNewJob` is expected to be false because the write gate is part of its definition. The readiness check belongs after the gate and before the job is posted.

## Stage 4 — One controlled test job

A separately authorized client may post one valid `url-summary-v1` job. The client chooses the URL and reward within the protocol bounds. The worker operator must not create a job for the worker as part of this run.

Do not manually restart, edit state, replace credentials, or intervene to force progress. If the worker stops, stalls, rejects the job, or reaches timeout, preserve the evidence and report that result without calling it a success.

## Stage 5 — Evidence and reconciliation

Capture chain evidence, not only logs:

| Evidence | Required record |
|---|---|
| Job creation | `postJob` transaction hash |
| Acceptance | `acceptJob` transaction hash, if accepted |
| Delivery | `submitDeliverable` transaction hash, if submitted |
| Settlement | `approveAndPay` or timeout transaction hash |
| Artifact | Full gateway links to `index.html` and `result.json`, if pinned |
| Wallets | Before/after ERC-20 raw balances for client and worker |
| Contract sinks | Before/after reputation-fee and slash accounting where observable |
| Reputation | Post-settlement agent reputation read |
| Gas | Total native gas spent |
| Worker state | Durable state file references without secrets |

Reconcile the balance changes against reward, reputation fee, refunds/splits, and gas. If the numbers do not reconcile, do not label the run successful; explain the difference.

## Stop conditions

Stop and keep writes disabled if:

- preflight fails or reports side effects;
- the chain, contract, wallet, or manifest does not match approval;
- the state volume is not persistent;
- a broadcast is pending or ambiguous;
- the worker is slashed or registration is lost;
- a new-job precondition fails, including insufficient gas reserve;
- an artifact cannot be verified at both gateway paths;
- a delivery deadline or contract state has changed unexpectedly;
- any operator is asked to bypass the deployment gate or safety check.

A low gas balance is a stop condition for **new acceptance**, not a reason to abandon accepted work. A pending broadcast is not a stop-and-retry signal: preserve the hash and wait for receipt/state resolution.

## Success definition

A successful controlled run means that the authorized client posted one valid job, the worker independently observed and accepted it, produced and verified the artifact, submitted the delivery, and the client or permissionless timeout path settled it with reconciled on-chain evidence. It does **not** mean that the worker is permanently live, that hosted services are healthy, or that the system is ready for mainnet.

After the run, return `BOT_LIVE_WRITES` to `false` unless a separately approved operation requires otherwise. Never leave a live-write gate enabled merely because a previous test succeeded.
