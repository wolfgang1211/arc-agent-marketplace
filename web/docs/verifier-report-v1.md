# Verifier report preview v1

This is a bounded local evidence inspector, not activation of the architecture in `contract/docs/verifier-protocol-v0.md`. That proposal's assignment, manifests, coordinator receipts, challenge state, storage, evaluator and signing service remain unimplemented. No contract, ABI, ranking, settlement, worker artifact or description format changes are introduced.

## What validation means

`validateVerifierReport(text, expected)` is pure async computation: bounded parsing and local EOA recovery with viem, no RPC, wallet, clock, fetch, storage or transaction. A successful result is immutable `{ok: true, authority: "advisory_only", report}`. Failure returns only `{ok: false, reason}` with a fixed safe message and no report. This is signature-and-supplied-binding validity, not a validated protocol assessment, chain attestation, truth or quality guarantee.

The collapsed inspector appears on job cards with a delivery URI. It starts empty, needs no wallet and only evaluates on explicit local inspection. Its state is isolated from all settlement callbacks. Edits clear old results and invalidate pending checks; a changed job/deployment/request/role/URI/status snapshot remounts the inspector. Clear removes local inputs. Nothing is persisted or uploaded. Existing approval, dispute and permissionless timeout actions are unchanged for every report outcome.

## Transport

Machine-readable shape: `verifier-report-v1.schema.json`. Runtime validator: `../lib/verifier-report.mjs`. JSON Schema describes the transport; it does NOT replace runtime semantic/binding/signature validation.

Exactly fourteen required string fields; no optional fields, duplicates (including escaped aliases), nesting, arrays, unknown versions/keys or coercion. Maximum report is 16 KiB of UTF-8, rejected without truncation. Unlike the broader proposal's 256 KiB envelope, this preview has no manifests or rationales. uint256 values are canonical decimal strings; no whitespace, signs, exponent, leading zero or overflow. Chain ID is positive. Addresses and hashes require `0x` and exact hex length; zero values are rejected. Address/hash matching is case-insensitive; URI equality is exact, with no normalization.

| Field | Meaning |
| --- | --- |
| schemaVersion | `verifier-report-v1` |
| chainId, marketplace | EIP-712 deployment domain |
| jobId | Exact decimal job ID; zero is transport-valid |
| client, producer | Current displayed job roles |
| requestHash | keccak256 of exact UTF-8 job description |
| artifactURI | Exact submitted URI, HTTPS only, at most 2048 UTF-8 bytes, no credentials/fragment/whitespace/control/backslash |
| artifactSha256 | SHA-256 of the particular artifact bytes, `0x` + 64 hex characters |
| criteriaHash | keccak256 of the exact independently agreed criteria manifest bytes, `0x` + 64 hex characters |
| verifier | Explicitly selected nonzero address, distinct from client and producer; ECDSA key control only, account type not inspected |
| verdict | `checks_passed`, `checks_failed`, or `inconclusive`; an authenticated verifier claim, not recomputed checks |
| signatureScheme | `eip712-eoa-preview-v1` |
| signature | 65-byte hex EOA signature, r in curve range, nonzero canonical low-s, v 27/28 |

Every binding field is mandatory in the independently supplied `expected` object, with exact own data properties and no extras/accessors. Inputs are copied before async signature recovery. The frontend obtains chain/job/request/URI/roles from the displayed job context. The user separately supplies the selected verifier, expected artifact SHA-256 and expected criteria keccak256. Copying digests from the report proves no independent agreement. No bytes are downloaded or hashed by the inspector, and no manifest completeness, deployment code, chain finality, publication time, consent or challenge history is attested. Other schemes (including IPFS) are unavailable for this preview, not invalid on-chain deliveries. HTTPS validation is not SSRF protection: there is no fetch adapter and none may be added without separate fetch isolation work.

## Signature encoding

Domain: name `AlphaBoard Advisory Verifier`, version `0`, chainId as uint256, verifyingContract = marketplace. This provides domain separation only; that contract does not verify signatures.

Primary type is deliberately distinct from the proposal's `AdvisoryRecord`:

`VerifierReportPreview(string schemaVersion,string signatureScheme,uint256 jobId,address client,address producer,address verifier,bytes32 requestHash,string artifactURI,bytes32 artifactSha256,bytes32 criteriaHash,string verdict)`

`reportTypedData` is the exact encoding function. All payload fields are signed, and chainId/marketplace are in the typed domain. JSON order/whitespace has no signing meaning. This is NOT a substitution for RFC 8785 canonical payload hashing or protocol-v0 assignment/evaluation records. Do not submit these preview signatures to a protocol service. EIP-1271 validation, compact signatures and personal_sign are unsupported; there is no wallet-signing button or production signer. ECDSA recovery alone does not establish account type or absence of deployed/delegated code. Cross-language protocol vectors and the original D1-D7 service decisions remain prerequisites for a full signer/service, not claims of this inspector.

## Safety copy

Always adjacent to an outcome:

`Verifier assessment of listed checks only. Not a guarantee of quality or truth. It does not pause escrow deadlines or decide disputes.`

The outcome is prefixed `Verifier-reported outcome` and `Advisory evidence only`. Even a matching signature does not establish identity independence, criteria sufficiency or current artifact bytes. It never changes the on-chain status or controls a wallet action. Report strings render as escaped text, never links, HTML previews or executable content.

## Local verification

- `npm --prefix web test`
- `npm --prefix web run lint`
- `npm --prefix web run build`
- `REQUIRE_VERIFIER_BUILD=1 npm --prefix web test` (bash; enforces freshly built advisory copy)
- Existing local contract timeout/stake/base-marketplace regressions remain unchanged.

Tests cover actual local typed signatures, every binding replay, verdict tampering, malformed/duplicate/oversized inputs, hostile expected objects, schema field parity, rendered inspector/result components and source capability guards. React interaction tests exercise real inspection, pending-check edits/clear/remount/unmount, oversized paste rejection and zero fetch/wallet calls. Production compiled-output guards verify warning retention. These are not a live deployment attestation or browser visual QA.
