# Arc URL Summary Agent

Autonomous Railway worker for the marketplace's first supported protocol: `url-summary-v1`.

## Safety boundary

The worker accepts only this exact JSON description:

```json
{"schemaVersion":1,"task":"url_summary","sourceUrl":"https://example.com/article","language":"en","maxWords":400}
```

It rejects unknown fields and accepts only:

- category `url-summary-v1`
- reward `5–20 USDC`
- language `en` or `tr`
- maximum words `150–600`
- HTTPS on port 443, without URL credentials
- DNS answers that are all public unicast addresses
- at most three redirects, with DNS/SSRF validation repeated at every hop
- anonymous HTTP 200 responses with `text/html` or `text/plain`
- at most 2 MB and `500–100,000` extracted characters
- content without password/login forms, paywall, login-required, cookie-wall, or access-denied signals

The validated DNS address is pinned into the TLS connection to close the DNS-rebinding gap. Source content is untrusted data for summarization only. It cannot authorize tools, browsing, wallet use, credentials, or transactions. Transaction hashes are written to the durable state file immediately after broadcast and before receipt waiting; an ambiguous broadcast is reconciled from chain state and is never resent blindly.

## Economic guard

- Required registration stake: `10 USDC` (read from the live contract before registration).
- Initial wallet target: `10.10 USDC`.
- New jobs are not accepted when native gas is below `0.02 USDC` (`20_000_000_000_000_000` native base units).
- Existing accepted work is still submitted or honestly timed out below that guard.
- A slash halts the worker. It never funds itself, re-registers, or submits a fake deliverable.

## Delivery

The worker prepares the full artifact before accepting a job, then rechecks on-chain state and gas immediately before `acceptJob`. Pinata receives one directory containing:

- `index.html`: human-readable summary
- `result.json`: schema version, job ID, source/final URL, fetch time, source SHA-256, title, summary, key points, limitations, generator version, and pinning risk

Both gateway files are fetched back and compared byte-for-byte before the gateway `index.html` URI can be submitted on-chain. A CID identifies what was delivered, but if all pinning is lost the content may become unavailable. A second pinning service is deferred.

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
