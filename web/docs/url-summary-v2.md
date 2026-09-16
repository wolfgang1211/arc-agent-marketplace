# URL-summary request v2

This protocol supersedes only the URL-summary v1 wire rules in the historical workflow-template spec. Category and template ID stay `url-summary-v1`; they are routing identifiers, not the request version. No contract migration is required. Deploy the compatible worker before enabling new v2 posting in production. This document does not claim a deployed worker is upgraded or available.

## Request and compatibility

New descriptions contain exactly six JSON fields, with no appended prose. Example (illustrative, not a posted job):

```json
{"schemaVersion":2,"task":"url_summary","sourceUrl":"https://example.com/article","language":"en","maxWords":400,"acceptanceCriteria":["Summarize only the supplied source in en, with no more than 400 whitespace-separated words in the summary.","Include 1 to 8 key points and 0 to 8 limitations; state uncertainty rather than inventing facts.","Deliver an accessible IPFS page and result.json containing the source URL, final URL, fetch time, source hash, title, summary, key points, and limitations."]}
```

`buildUrlSummaryDescription` generates v2. `buildUrlSummaryCriteria` substitutes validated language (`en` or `tr`) and integer maxWords (150 through 600) into the immutable ordered strings. Changing these strings requires a new request schema version. V2 text is capped at 8,192 UTF-8 bytes. Unknown keys, duplicate top-level keys (including escaped duplicates), invalid versions, missing criteria, altered text, reordering, or additional criteria are rejected. Criteria are stored in the description on-chain, not just rendered in a preview. The UI renders the recorded criteria for posted v2 jobs.

Historical v1 remains exactly five fields: `schemaVersion`, `task`, `sourceUrl`, `language`, `maxWords`. Its request is never upgraded or supplemented. The posted-job renderer explicitly says criteria were not recorded for v1. Unsupported/malformed requests remain visible as text, not silently coerced into supported jobs. Reward and source eligibility guards are unchanged.

Pure schema code is mirrored byte-for-byte in `bot/src/url-summary-schema.mjs` and `web/lib/url-summary-schema.mjs` so each deployment root is self-contained. Tests enforce parity and feed real frontend requests into worker intake.

## Preflight before escrow

Only an explicit connected publish action calls `POST /api/source-preflight` with `{ "sourceUrl": "..." }`. Drafting, preview, illustrative examples and wallet connection do not fetch sources. The endpoint uses Node DNS/HTTPS with pinned public addresses, repeated redirect validation, anonymous HTML/plain-text access, a 2 MiB compressed/decompressed cap, 500 through 100,000 extracted characters, authentication/paywall checks, and a 20-second total deadline. The implementation mirrors the bot fetch policy byte-for-byte.

Requests are bounded to 8,192 bytes, a 5-second body-read deadline, and four concurrent handlers per server process. This is not a distributed rate limiter. Success returns only `{ "ok": true }`; failure returns allowlisted `reason` and `retryable`, never source content, headers, URLs or raw transport errors. Responses use `Cache-Control: no-store`. No LLM calls, uploads, wallet calls or external writes occur in the checker. The frontend fails closed before both USDC approval and postJob on any failed/unavailable/malformed check; every publishing attempt rechecks its exact source.

A successful preflight is not a reservation, delivery guarantee or proof of source quality. Sources can change. Worker intake fetches and validates again before acceptance. Unaccepted jobs can be canceled by their client; network fees are not refunded.

## Artifact binding

V1 `result.json` keeps the existing field set and generator version. V2 keeps the provenance and summary fields and sets `schemaVersion: 2`, `generatorVersion: "arc-url-summary-agent/2.0.0"`, plus:

- `requestSchemaVersion: 2`
- `request`: the full validated v2 request, including exact criteria
- `acceptanceCriteria`: an exact copy of the request array

The source URL must match the accepted request. HTML displays the recorded requirements. Independent reviewers compare the artifact request with the actual on-chain description, then evaluate the summary and provenance against those requirements. Neither a matching schema, a CID nor criteria in an artifact constitutes a verification verdict. Existing v1 artifacts are not rewritten. The worker still verifies retrieved HTML/JSON bytes before submitting a deliverable URI.

## Related marketplace views

Job timelines use actual Arc `getJobsPaged` records and chain time. Expired deadlines remain pending until a terminal contract status proves settlement. Approval payment detail distinguishes gross reward from net payment; the exact net amount is recorded by `JobApproved`. Recent activity is explicitly a current-state snapshot of the latest six posted jobs, ordered by creation ID, not a complete event log or a claim about the latest settlement time. Its two contract reads are pinned to one block.

`?view=my-jobs` filters by client; `?view=my-work` filters by assigned agent. `status=all|open|active|settled` and zero-based `page` round-trip through browser history. Role/status counts cover the same bounded 20-job page after open-job filters, not a wallet's complete history. Walletless visitors retain the public marketplace. Loading/error/disconnected states do not claim zero records.

## Verification

From the repository root:

```text
npm --prefix bot test
npm --prefix bot run check
npm --prefix web test
npm --prefix web run lint
npm --prefix web run build
npm --prefix web test
cd web
node test/source-preflight-smoke.mjs
```

The production smoke starts only a loopback HTTP server, rejects unsafe input through the real built route and verifies walletless homepage copy. `--live` additionally probes a public IANA page without writes; network-dependent availability is not a deterministic test. No automated check sends a wallet transaction.
