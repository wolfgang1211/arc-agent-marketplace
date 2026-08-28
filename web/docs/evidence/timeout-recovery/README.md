# Timeout recovery screenshot evidence

The evidence is intentionally split by what it proves. Every capture used the already-running Brave DevTools endpoint; no isolated browser, contract write, wallet signature, gas spend, deployment, Vercel action, or push was used.

## Live Arc chain integration

- `desktop-live-chain.png` (1440×900 viewport, full page): the real `app/page.js` read/render path displaying jobs 1–5 from Arc Testnet verification contract `0x3b03D4Aa1bf568bE7fAC6fF9Dad2aEE9c9C057a4`.
- `mobile-live-chain.png` (390×844 viewport, full page): the same live read path at the mobile breakpoint.
- `live-chain-evidence.json`: captured job IDs, required terminal statuses, viewport/page dimensions, contract address, and the explicit `transactionSent: false` boundary.

These captures prove `getJobsPaged` → `app/page.js` integration for the five real on-chain jobs, including `ExpiredRefund`, `ExpiredPayout`, and `ExpiredSplit`. The server received the verification address only as a temporary process environment override. `.env.local` remained on the old demo address. Because the normal landing page requires a wallet connection, its render-only gate was temporarily bypassed in the local working copy to avoid granting wallet permissions; the shipped source was restored before commit and no debug mode remains.

## Deterministic fixture coverage

- `desktop-states.png` (1440×900): claimable InProgress, waiting Submitted, terminal ExpiredSplit.
- `desktop-dispute.png` (1440×900): blocking no-arbiter/no-appeal/no-support dispute confirmation.
- `mobile-states.png` (390×844): claimable, waiting, and terminal responsive states.
- `mobile-dispute.png` (390×844): responsive dispute confirmation and both actions.

The fixture proves states no longer available on the verification contract: a live countdown, claimable action, and mandatory dispute confirmation. It does not claim to be live-chain integration evidence.

## Reproduction

1. From the repository root, serve the test fixture: `python -m http.server 4173 --directory web`.
2. Confirm an existing Brave DevTools endpoint is available at `http://127.0.0.1:9222/json/version`.
3. From `web`, run `node test/capture-timeout-evidence.mjs`.

The fixture capture script opens background tabs only in that already-running Brave instance, applies deterministic desktop/mobile viewport metrics, writes the four fixture PNGs, and closes those tabs.
