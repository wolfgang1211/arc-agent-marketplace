# Timeout recovery screenshot evidence

Captured from the deterministic test-only fixture at `web/test/fixtures/timeout-recovery-evidence.html` through the already-running Brave DevTools endpoint. No isolated browser, production debug mode, wallet action, contract write, deployment, or address change was used.

## Evidence

- `desktop-states.png` (1440×900): claimable InProgress, waiting Submitted, terminal ExpiredSplit.
- `desktop-dispute.png` (1440×900): blocking no-arbiter/no-appeal/no-support dispute confirmation.
- `mobile-states.png` (390×844): claimable, waiting, and terminal responsive states.
- `mobile-dispute.png` (390×844): responsive dispute confirmation and both actions.

## Reproduction

1. From the repository root, serve the test fixture: `python -m http.server 4173 --directory web`.
2. Confirm an existing Brave DevTools endpoint is available at `http://127.0.0.1:9222/json/version`.
3. From `web`, run `node test/capture-timeout-evidence.mjs`.

The capture script opens background tabs only in that already-running Brave instance, applies deterministic desktop/mobile viewport metrics, writes the four PNGs, and closes those tabs.
