# AlphaBoard Agents: URL Summary Worker

Autonomous Railway worker for the marketplace's first supported protocol: `url-summary-v1`.

## Safety boundary

The worker accepts strict request schemas v1 and v2 under the unchanged routing category `url-summary-v1`. New web jobs use v2 and persist the three canonical acceptance criteria in the on-chain JSON. Historical v1 requests remain readable without inventing criteria. Legacy shape:

```json
{"schemaVersion":1,"task":"url_summary","sourceUrl":"https://example.com/article","language":"en","maxWords":400}
```

V2 has those same five fields, `schemaVersion: 2`, and an `acceptanceCriteria` array containing the exact ordered strings from `src/url-summary-schema.mjs`. Missing, altered, reordered, or extra criteria fail closed. See `../web/docs/url-summary-v2.md` for the complete wire and artifact contract. Roll out this compatible worker before publishing v2 jobs; an older v1-only worker will decline them.

It rejects unknown fields and accepts only:

- category `url-summary-v1`
- reward `5–20 USDC`
- language `en` or `tr`
- maximum words `150–600`
- HTTPS on port 443, without URL credentials
- DNS answers that are all public unicast addresses
- at most three redirects, with DNS/SSRF validation repeated at every hop
- anonymous HTTP 200 responses with `text/html` or `text/plain`
- at most 2 MiB and `500–100,000` extracted characters
- content without password/login forms, paywall, login-required, cookie-wall, or access-denied signals

The validated DNS address is pinned into the TLS connection to close the DNS-rebinding gap. Source content is untrusted data for summarization only. It cannot authorize tools, browsing, wallet use, credentials, or transactions. Transaction hashes are written to the durable state file immediately after broadcast and before receipt waiting. An ambiguous pending broadcast is never resent blindly; only a proven reverted receipt reopens retry, while a still-pending submit advances to timeout handling at the delivery deadline.

DNS, redirects and HTTPS share a 20-second total source deadline. The web posting preflight uses a byte-identical standalone copy of this policy before USDC approval. It does not upload artifacts, invoke a model or request wallet actions. A successful check is only a point-in-time accessibility observation: the worker always rechecks and can still decline.

## Economic guard

- Required registration stake: `10 USDC` (read from the live contract before registration).
- Initial wallet target: `10.10 USDC`.
- New jobs are not accepted when native gas is below `0.02 USDC` (`20_000_000_000_000_000` native base units).
- Existing accepted work is still submitted or honestly timed out below that guard.
- The house agent accepts an eligible Open job only after `HOUSE_DELAY_SECONDS` of chain time have elapsed since creation. The default is `14400` seconds (4 hours), with a validated range of `0–86400`. It uses `job.createdAt` when present, otherwise the `JobPosted` event block timestamp; unreadable creation time fails closed and is reported in the cycle log.
- The explicit category allowlist currently contains only `url-summary-v1`; every other category is rejected as `unsupported_category`.
- Permanent post-accept failures become terminal immediately. Transient failures retry on the normal poll cadence while more than `300` seconds remain before the delivery deadline; no additional backoff is applied.
- `submitAttempts` persists across restarts as diagnostic evidence only. It does not consume or shorten the deadline-based retry budget.
- A slash halts the worker. It never funds itself, re-registers, or submits a fake deliverable.

## Payout attention recovery

A Submitted job enters `payout_needs_attention` when automatic payout claiming can no longer proceed safely, including after five hash-backed failed claims, a payout transaction remaining pending for more than 30 minutes of chain time, or an ambiguous broadcast without a transaction hash. The worker emits one `operator_alert` on the transition and will not automatically claim that job again. Ten consecutive simulation failures also emit a one-time `operator_alert`, but keep the job in the normal Submitted/cooldown flow and do not increment `payoutAttempts`.

To clear `payout_needs_attention` safely:

1. Stop the worker so it cannot overwrite `/data/state.json` while it is being inspected. Keep a backup of that file.
2. Read the job and recorded `payoutTxHash` from the configured chain. Do not clear the state while that transaction is pending or its outcome is unknown.
3. If the job is still Submitted and the recorded transaction is conclusively dropped or reverted, change only that job record's `phase` to `submitted`; set `payoutAttempts` to `0`; and remove `reason`, `payoutNeedsAttentionAt`, `payoutTxHash`, `payoutAttemptCountedHash`, `nextPayoutAttemptAt`, `payoutBroadcastAt`, and `payoutBroadcastAtChainTimestamp`. Remove `payoutSimulationFailures` and `payoutSimulationAlerted` only when intentionally starting a new simulation-error streak.
4. If the chain already shows Completed, Disputed, or expired-paid settlement, do not reset the record to Submitted. Reconcile it to that observed terminal state instead.
5. Validate the JSON, restart the worker with the same state file, and confirm one read-only/status cycle before enabling writes.

Never delete the whole state file to clear one job: it also contains registration and transaction-reconciliation safety state.

## Delivery

The worker prepares the full artifact before accepting a job, then rechecks on-chain state and gas immediately before `acceptJob`. Pinata receives one directory containing:

- `index.html`: human-readable summary
- `result.json`: schema version, job ID, source/final URL, fetch time, source SHA-256, title, summary, key points, limitations, generator version, and pinning risk

Both gateway files are fetched back and compared byte-for-byte before the gateway `index.html` URI can be submitted on-chain. A CID identifies what was delivered, but if all pinning is lost the content may become unavailable. A second pinning service is deferred.

V1 artifacts retain their schema and field set. V2 artifacts use `schemaVersion: 2`, generator `arc-url-summary-agent/2.0.0`, and additionally include `requestSchemaVersion: 2`, the full validated `request`, and an exact copy of `acceptanceCriteria`. These bind the delivered report to requirements for independent comparison, not a verification verdict.

## Commands

```text
npm ci
npm test
npm run check
npm run probe
npm run once
npm start
npm run status
npm run register
```

`BOT_LIVE_WRITES` defaults to `false`. `npm run register`, `acceptJob`, `submitDeliverable`, and `claimTimeout` fail closed unless it is exactly `true`.

## Railway activation order

1. Create a Railway service with `bot/` as its root directory and attach a persistent volume mounted at `/data`.
2. Add the variables from `.env.example`. Keep `BOT_PRIVATE_KEY`, `SUMMARY_API_KEY`, and `PINATA_JWT` only in Railway secrets. Use `BOT_STATE_FILE=/data/state.json`.
3. Start with `BOT_LIVE_WRITES=false`; verify the service and public wallet address.
4. Transfer exactly `10.10 USDC` to that new independent wallet.
5. Set `BOT_LIVE_WRITES=true`, run `npm run register` once, and verify the approve/register transaction receipts plus `getAgent` state.
6. Start the worker and verify `registered=true`, native balance at or above `0.02 USDC`, and zero active jobs before asking the customer to post.
7. After 48 hours, review Railway CPU/memory/credit use. Move to Hobby only if needed to preserve 24/7 operation.

Do not put a private key, provider key, JWT, gateway credential, or connection string in this repository, a state file, logs, or deployment output.
