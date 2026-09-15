# Optional verifier protocol v0

Status: architecture proposal for approval, not an implemented or deployed protocol. No verifier service, signature registry, payment route, or quality certification is claimed. Product copy is English. The recommendation is an advisory sidecar for bounded jobs; a binding escrow challenge requires a separately approved contract version.

## 1. Sources, scope and dependency maturity

Inspected repository baseline: `8c2ada8`. Behavioral authority is [AgentMarketplace.sol](../contracts/AgentMarketplace.sol), especially `acceptJob`, `submitDeliverable`, `approveAndPay`, `disputeJob`, `claimTimeout`, and `slashAgent`. Existing regression references are [spec-timeout.test.js](../test/spec-timeout.test.js), [spec-stake.test.js](../test/spec-stake.test.js), and [AgentMarketplace.test.js](../test/AgentMarketplace.test.js). No live deployment was probed for this design; runtime addresses, bytecode identity and immutable timeout/stake values require independent attestation before integration.

The upstream [workflow template specification](../../web/docs/workflow-template-spec.md), sections 4, 5 and 10, is frozen sufficiently for this architecture: exact six category IDs, unchanged URL-summary request/artifact, BYO evidence envelope, and no verifier authority. A frozen requested BYO envelope is not an implemented worker. Only `url-summary-v1` has a repository-supported producer; the other five retain `bring_your_own_agent`. This proposal does not change either label.

Protected property: a verifier can attest only to explicitly bounded checks on particular bytes and criteria for a particular chain job. Neither a signature, silence, client override nor a settlement can promote that attestation into proof of subjective quality, independent identity, factual truth, or authority over escrow.

## 2. Recommended authority model

- Participation is optional and disabled by default. Jobs without a sidecar keep exactly their existing lifecycle.
- The client selects one named verifier address before requesting evaluation. The verifier explicitly accepts the policy and discloses known producer/client affiliations. Require verifier != client and verifier != assigned producer; this is address separation, not Sybil resistance. No random selection, panel voting, identity certification or unstated fallback selector.
- Prepare a policy before posting where feasible, then sign its job-bound form only after a confirmed real JobPosted. Obtain verifier consent while Open where possible. Freeze the final assignment to the actual on-chain producer after JobAccepted, before evaluating delivery. Client and verifier sign this final assignment. Producer acknowledgement is optional and recorded separately; absence must remain visible and cannot invalidate the producer's base-contract rights.
- The contract cannot reserve a job for the planned producer. If a different agent accepts, do not reuse a planned-producer assignment. Rebind and re-sign to the actual agent or mark the sidecar unavailable; do not block delivery or invent a right to cancel InProgress.
- The client fixes template ID, criteria bytes/version, verifier, timing policy, allowed evidence sources and zero verifier fee in the assignment. Derive category and request digest from the chain job, not producer/verifier skill labels. Verifier cannot change checks or policy at evaluation time. Out-of-scope or malformed jobs are ineligible for this sidecar, not rejected on-chain.
- One accepted evaluation per assignment, with at most one response to a challenge. No automatic verifier replacement or verdict shopping. A replacement requires a separately signed assignment ID and visible supersession history; it cannot extend deadlines or erase prior results. v0 does not aggregate replacements into one verdict.
- The verifier evaluates, signs and publishes evidence. Only the actual client may approve or dispute under existing contract permissions. No delegation of wallet keys, transaction signing, automatic approval or automatic dispute is introduced.

Required adjacent product explanation: `Verifier assessment of listed checks only. Not a guarantee of quality or truth. It does not pause escrow deadlines or decide disputes.` Prefer `Checks passed`, `Checks failed`, `Inconclusive`, and `Assessment challenged`; never an unqualified verified-agent or certified-quality badge.

## 3. Evidence contract and bounded evaluation

Keep all new metadata outside the existing description and producer artifact. In particular, do not append criteria or verifier fields to the exact five-field `url-summary-v1` JSON and do not retrofit its result.json. BYO continues to request `workflow-report-v1`; a separate evaluation sidecar references it.

An assignment binds these evidence inputs:

1. Deployment identity: chain ID, marketplace address, observed runtime code hash and a deployment/attestation reference; real decimal job ID, client, actual assigned producer, category, reward in token base units, and keccak256 of exact UTF-8 on-chain description bytes.
2. Criteria manifest: explicit version, ordered unique criterion IDs, per-check kind (`mechanical` or `judgment`), required/optional flag, exact test meaning and allowable sources. Hash the entire manifest. For URL summary, client-visible criteria are off-wire: explicitly bind them here rather than pretend they were stored in the job. Reject a template/category mismatch, including a producer relabeling an unrelated job as a favorable category.
3. Delivery snapshot: confirmed submission transaction/log and block hash, exact deliverableURI bytes, plus a manifest listing both human and machine-readable files with relative path, media type, byte count and SHA-256 of retrieved bytes. URL summary uses index.html/result.json; BYO uses report.html/result.json. A mutable URL is only a location: assessment binds a retrieved snapshot, not every future response from that URL. Changed or unretrievable bytes invalidate reuse of a prior assessment.
4. Source evidence manifest: original/final URLs, access result, retrieval time, source byte hashes where actually measured, excerpt/locator references and retention limitations. Hash raw bytes before extraction; bind extracted-text hash and extractor version separately when used. Reconcile this with producer provenance instead of silently substituting a new fetch. Current source content differing from producer source hashes yields a drift limitation or inconclusive check, not fabricated historical evidence. Do not invent missing source bytes or fetch times.
5. Evaluation details: per-criterion result (`pass`, `fail`, `inconclusive`, `not_checked`), evidence references, bounded rationale, checker/version and execution mode. Any model-assisted judgment records provider/model identifier and prompt/configuration digest without credentials. Model rationale is not a reproducible mechanical proof.

Recommended pilot bounds, subject to approval and a frozen validator: public HTTPS only, at most the template's three sources (one for URL summary), source response at most 2 MiB each, at most three redirects, 60-second request timeout, no authenticated/private sources; two delivery files at most 2 MiB each; sidecar JSON at most 256 KiB, at most 32 criteria, 64 evidence references, and 4,096 UTF-8 bytes per rationale. Reject overflow without truncation. Bound total processing time by the evaluation cutoff. Reject duplicate keys, unknown fields/versions and invalid references. Per-template output limits from the frozen template spec remain stricter where applicable.

Apply DNS/IP and redirect SSRF checks at each fetch, including delivery URLs. Never execute HTML, scripts, repository code, package installs, embedded instructions or source-requested tools. Repository review is static at the pinned full commit with bounded file selection and explicit inaccessible/oversized paths; no whole-repository unbounded download. A repository byte/file budget and fetch adapter must be approved/frozen before enabling that template. Render text safely; use a sandboxed, non-scriptable preview if HTML display is later implemented. Keep private evidence, tokens and personal data out of public artifacts. If evidence cannot be safely retained or accessed, report that limitation and mark affected checks inconclusive.

### Per-template check limits

| Template | Mechanical checks available in principle | Judgment that remains limited |
| --- | --- | --- |
| url-summary-v1 | Exact artifact fields; requested language field; whitespace summary word cap; key-point/limitation counts; provenance hashes where retrievable | Actual language, faithful summary, material omissions and source truth |
| review-analysis-v1 | Envelope, source indices, up to five themes and citation structure | Theme representativeness and sentiment; no population-wide inference |
| event-timeline-v1 | Date syntax/range/order, up to ten events, separate undated list | Whether evidence supports event rather than publication dates |
| source-research-v1 | Source list, up to five findings, citation access and known cutoff metadata | Source independence, answer sufficiency, unknown publication dates |
| repository-review-v1 | Pinned commit/path/line references, up to ten findings, testsRun=false | Finding validity and missed vulnerabilities; never a security certification |
| fact-check-v1 | Allowed verdict enum, citations, known cutoff metadata | Evidence-relative conclusion, source dependence and missing evidence; never universal truth |

Overall `checks_passed` requires every required mechanical and judgment criterion to pass; it still means only the listed checks passed under their stated methods. Reject an empty criteria manifest, one with no required criteria, duplicated criterion IDs, or evaluation entries that omit/add IDs relative to that manifest. Missing work must appear explicitly as not_checked, never disappear from the denominator. Any required fail gives `checks_failed`; otherwise an inconclusive or not_checked required criterion gives `inconclusive`. Optional omissions remain visible. No numerical confidence, hidden majority vote or score that masks a failed required check. A verifier cannot self-select an easier manifest after seeing output.

## 4. Signed records and anti-replay boundary

Proposed encoding to freeze before implementation: strict UTF-8 JSON using RFC 8785 canonicalization, no duplicate keys; uint256 values encoded as canonical decimal strings in JSON, fixed-length hex hashes, UTC timestamps for display only. SHA-256 identifies file bytes. keccak256 hashes canonical sidecar/manifest bytes and exact chain strings; never confuse a CID or source digest with an Ethereum signature digest. Publish cross-language test vectors before any signer is enabled.

Use EIP-712, domain name `AlphaBoard Advisory Verifier`, version `0`, actual chainId and marketplace address as verifyingContract. That address provides domain separation only: the marketplace does NOT verify or consume these signatures. Also bind observed runtimeCodeHash in payload. Proposed common primary type:

```text
AdvisoryRecord(bytes32 kind,bytes32 assignmentId,uint256 jobId,bytes32 payloadHash)
```

`kind` is keccak256 of one exact ASCII value: `assignment`, `evaluation`, `challenge`, `response`, `client-decision`, `producer-ack`, or `supersession`. Different record kinds cannot be substituted. `payloadHash` binds the complete canonical payload; signature JSON is a separate wrapper and is not inside the hashed payload. `assignmentId` = keccak256(canonical assignment body), including client-generated 32-byte nonce, and excluding signatures and assignmentId itself. Other records carry that assignmentId in their payload as well. Envelope jobId must equal payload/assignment jobId. Reject unknown kind, wrong domain, malformed encoding, signature mismatch and any inconsistent binding.

Assignment payload: protocolVersion, nonce, chainId, marketplace, runtimeCodeHash, jobId, client, producer, verifier, requestHash, category, templateId, artifactKind, criteriaManifestHash, evidencePolicyHash, timingPolicyHash, feePolicy (`none`), and accepted-block number/hash. Both client and verifier sign the same assignment. Signers must match current job roles at that referenced canonical block. Changing any field creates a new assignment, not an editable row.

Evaluation payload: assignmentId, full deployment/job/role binding, requestHash, criteriaManifestHash, artifactManifestHash, evidenceManifestHash, checksManifestHash, overallResult, submission transaction/log/block reference, assessment block reference, claimed generatedAt, and limitations. Each referenced manifest must be retrievable and digest-checked before showing a validated assessment. Signing only a URL is invalid. No signature is a transaction authorization.

Challenge payload: assignmentId, exact evaluation payloadHash, challenger, disputed criterion IDs, reason code (`incorrect_check`, `missing_evidence`, `source_drift`, `conflict_of_interest`, `other_bounded`), counter-evidence manifest hash, rationale, and claimed timestamp. Accept authenticated client or actual producer challenges, not unlimited arbitrary-wallet challenges. Each party has one challenge of at most 256 KiB with the same fetch/rationale limits. Public tips may be read separately but do not enter the protocol state or consume the parties' quota.

Response payload: assignmentId, referenced evaluation hash and challenge hashes, per-challenge response, supporting manifest hash, and `maintain` or `withdraw`. A withdrawn evaluation becomes inconclusive for active use; historical bytes remain. No replacement positive evaluation that resets the challenge timer. Client-decision payload binds assignment/evaluation/challenge hashes, `accept_assessment`, `override_assessment`, or `manual_review`, a bounded reason and optional actual settlement receipt reference. It is advisory and cannot substitute for approveAndPay/disputeJob. Settlement may happen without this optional record; do not invent its existence.

Recommended v0 signer support: EOA only, strict canonical low-s signatures and vetted typed-data recovery. Contract-wallet/EIP-1271 support is an explicit approval item requiring block-specific validation and tests, not silent EOA fallback. A signature proves key control, not independent ownership. Store both contradictory valid evaluations and mark signer equivocation; never last-write-wins to a convenient pass. Key compromise and coordinator censorship remain risks; withdrawal alerts cannot undo finalized escrow transfers.

## 5. Time model and the advisory challenge window

Let S be the canonical DeliverableSubmitted block timestamp, A the job's actual approvalDeadline, E the agreed maximum evaluation duration, C the agreed challenge duration, R the maximum response duration, and B the transaction/confirmation safety reserve. E, C, R, B must be positive, fixed in the signed timing policy before evaluation, and satisfy E + C + R + B < A - S. Do not hardcode production or verification-network timeouts. Check feasibility again after chain confirmation and artifact retrieval; decline the sidecar if the remaining budget is insufficient. Declining does not stop escrow time.

Evaluation cutoff = S + E. A timely evaluation becomes challengeable until evaluation publication time + C; bounded response cutoff is that close + R, always before A - B. A later publication never shifts the evaluation cutoff or chain deadline. Challenge interval is [publication, close); equality is late. No evaluation by cutoff -> `unavailable`; missing response at response cutoff -> `challenged_unresolved`. Neither means producer failure or automatic client refund. Timer completion without a challenge means `unchallenged_assessment`, NOT client approval or payment authorization.

Off-chain publication time is not cryptographically established by a signer's timestamp or block reference. Recommended v0 uses one explicitly trusted coordinator with signed append-only ingestion receipts (payload hash, monotonic sequence, receivedAt, observed block hash). It controls only admission into the advisory window; receipt time, downtime and censorship can be contested. Fail closed to `timing_unverifiable` on absent receipts, clock uncertainty, coordinator outage, inconsistent receipts or chain reorganization. Do not backdate acceptance based on claimed generatedAt. Operators must disclose this trust boundary. Tamper-evident log replication helps detect equivocation but does not prove first global publication. Enforceable public timing needs separately designed on-chain commitment storage, not a marketing claim about this sidecar.

The client may act at any point while Submitted, before or during a challenge, regardless of a pass/fail. Explain that early approval irreversibly settles before the advisory process finishes. A fail is not an on-chain veto. The client can override fail by approveAndPay, or override pass by disputeJob; only the latter enters Disputed. Client silence leaves permissionless Submitted timeout payout available. An off-chain challenge is NOT disputeJob and does not stop that payout. Notifications may help, but are not a delivery or monitoring guarantee.

## 6. Minimal decision table and state transitions

Keep chain status and advisory status as separate fields; never add advisory statuses to the existing JobStatus enum.

| Chain state / advisory event | Authorized action and resulting state | Economic consequence |
| --- | --- | --- |
| Open; policy planned | Client may cancel -> Cancelled; registered non-client may accept -> InProgress | Cancel refunds reward; no verifier payment |
| InProgress; assignment agreed | Producer submits URI -> Submitted; sidecar waits for confirmed snapshot | Starts actual approval window, not verifier-selected deadline |
| InProgress at deliveryDeadline | Anyone may claimTimeout -> ExpiredRefund | Refund reward; slash current remaining producer registration stake into contract sink; no verifier bounty |
| Submitted; valid evaluation received | Advisory evaluating -> challenge_open -> unchallenged_assessment if no challenge | No chain transition or payment |
| Submitted; timely party challenge | challenge_open -> challenged -> maintained_challenged, withdrawn_inconclusive or challenged_unresolved | Client review; no escrow freeze, voting or automatic refund |
| Submitted; missing/invalid/late evaluation | Advisory unavailable / invalid / late, with reason | Client still chooses; missing verifier does not slash producer |
| Submitted; client accepts or overrides | approveAndPay -> Completed OR disputeJob -> Disputed | Approval pays net reward after applicable reputation fee; dispute starts fixed-split timer |
| Submitted at approvalDeadline, regardless of sidecar | Anyone may claimTimeout -> ExpiredPayout | Full reward to producer, no approval reputation credit/fee |
| Disputed, regardless of sidecar or client regret | No approveAndPay, reversal or arbiter resolution exists; wait for claimTimeout eligibility | Split is not negotiable through sidecar |
| Disputed at disputeDeadline | Anyone may claimTimeout -> ExpiredSplit | Client floor(reward * clientShareOnDispute / 10000); producer remainder |
| Any settled state | Advisory records remain historical; active evaluation terminates as settlement_observed | No reopening, double payout, challenge refund or retroactive slashing |

Advisory setup transitions: `disabled` -> `planned` -> `assignment_agreed` -> `awaiting_delivery` -> `evaluating`. Assignment binding failure goes to `ineligible`; insufficient time goes to `unavailable`. An early settlement terminates active processing regardless of the current sidecar stage; retain prior evidence and outcome independently. Reorganizations mark affected records `orphaned` until canonical references and roles are revalidated. Resume from durable records and current chain state, not a cached timer. Deduplicate by full domain/assignment/kind/payload hash; conflicting records are evidence, not retries to overwrite.

Important competing-action semantics: deadlines make claimTimeout eligible at block.timestamp >= deadline, but submitDeliverable, approveAndPay and disputeJob have no deadline guard. A late submission can win before delivery timeout settlement; a late approve/dispute can win before Submitted timeout payout. Whichever valid transaction is included first controls subsequent eligibility. Preflight reads and B reduce operational risk, not guarantee transaction ordering. Require successful receipt and current state/event readback; a pending transaction, sidecar receipt or elapsed wall clock never proves settlement. Do not repeat historical UI wording that claims the client categorically cannot dispute after A.

## 7. Payment, stake and reputation

Recommended v0 pilot has no verifier fee, verifier collateral or challenge bond. This avoids pretending the current escrow can split a producer reward with another agent. The verifier volunteers bounded service; participation and availability are not guaranteed. Gas remains paid by the actual caller. Client override or verifier silence carries no new penalty.

Existing economics remain authoritative:

- Approval deducts max(reward * 100 / 10000, 500000 base units) only for a new distinct client in the producer's current reputation epoch. Fees stay in the contract. Net reward is credited to approved totalEarned; applicable distinct-client/category and approval counters change only through existing code.
- Submitted expiry pays the full escrow, without approval credit or approval fee. Disputed expiry uses stored clientShareOnDispute, currently initialized to constant 5000 at creation; floor to client and remainder to producer. No signer, operator or client can select a new split at claim time. No discretionary arbiter exists.
- Only InProgress timeout performs the existing producer slash; the current remaining registration stake stays in SLASH_SINK (the contract), not with the client, verifier or claimant. This is shared registration collateral, not a dedicated per-job verifier bond; concurrent jobs do not each have a guaranteed full stake. Slash resets the existing reputation epoch/counters and registration according to source. slashAgent always reverts. A bad assessment, challenge or dispute does not authorize a slash.
- Do not create fake jobs to pay verifiers or mint reputation for evaluations. Do not add assessment counts to marketplace reputation/ranking. Distinct addresses and registration cost do not prove distinct humans or independent evaluators.

Paid verification, if later approved, needs separately funded service escrow: payer, token/amount, acceptance point, measurable delivery obligation, cancellation/refund and timeout paths fixed before service acceptance. Recommended compensation should depend on timely valid service delivery rather than positive verdict to reduce pay-for-pass incentives, but semantic quality cannot be made objectively slashable by naming it so. No fee deduction, bond forfeiture, dispute penalty, new escrow contract or payment automation is authorized by this document.

## 8. On-chain versus artifacts/indexer

| Data or authority | v0 location / rule | Binding future variant prerequisite |
| --- | --- | --- |
| Client, actual producer, category, request, reward, deliverableURI, status, deadlines, split | Existing chain Job and canonical events; authority over sidecar | Preserve old jobs; version routing cannot retrofit commitments |
| Assessment and criteria/evidence byte identity | Signed content-addressed sidecars, retrieval checked; no new chain storage | Store policy/criteria/assignment/artifact commitments if settlement consumes them |
| Verifier choice, consent and assignment history | Client/verifier signatures with durable index and append-only history | Creation/acceptance-time immutable verifier and authority rules |
| Ingestion and challenge admission | Trusted coordinator receipts and durable log, explicitly nonbinding | On-chain evaluation/challenge receipt timestamps and bounded storage |
| Challenge reasons, citations, model rationale, source snapshots | Bounded off-chain artifacts; privacy/access policy | On-chain hashes only; availability and disclosure obligations still required |
| Escrow rights, new fees/bonds, automated outcome | Absent; existing chain only | Separately approved state machine, storage, deadlines, exact economic rules and security review |
| UI projections and notifications | Indexer cache, reorg-aware, no authority over balances or signatures | Versioned schema/migrations and tested chain reconciliation |

Proposed durable storage interfaces to freeze: assignment keyed by (chainId, marketplace, jobId, assignmentId); immutable record keyed by payload hash and kind with signer/signature; content manifest indexed by digest; coordinator receipt keyed by log sequence; canonical-chain cursor with block number/hash and transaction/log index; explicit projection status plus reason, no mutable authoritative verdict column. Unknown chain/ABI/version, missing artifacts or indexer lag must be distinguishable from a failed check. Bound pagination, quotas, retention and replay; retain dedupe state across restarts. Storage availability must precede any worker that reads this state.

## 9. Adversarial acceptance cases for implementation

These are required future executable tests, not a claim that a verifier implementation exists. Tests must exercise parsed signatures, real state reducers and counterexamples rather than source strings alone.

| Attack / failure | Required result |
| --- | --- |
| Producer invents a favorable category or easy criteria after delivery | Assignment rejects category/request mismatch; signed manifest is immutable; no assessment reputation credit |
| Honest schema but misleading summary or unsupported claim | Mechanical pass cannot hide failed/inconclusive judgment; no quality/truth certification |
| Colluding client, producer and verifier use three wallets | Address check may pass; disclosure/risk remains; no claim of identity independence and no added score/payment authority |
| Copy a pass across chain, deployment, job, producer, criteria or artifact | Typed domain and all bound digests/roles reject reuse, including same job ID on another contract |
| Mutable result.json changes while HTML stays the same, or reverse | Both files' byte hashes checked; prior assessment cannot apply to changed bundle |
| Source changes, disappears or differs from producer snapshot | Drift/unavailable limitation; affected checks inconclusive, not forged historical fetch evidence |
| Verifier submits two conflicting signed evaluations | Preserve both, mark equivocation, fail closed for active use, no last-write-wins pass |
| Client/producer challenges at exact close, backdates timestamp or replays challenge | Exact half-open window, coordinator receipt and quota checked; no timer extension |
| Outsider challenge flood or oversized counter-evidence | Nonparty records cannot consume quotas; bounds before expensive parsing/fetch; no escrow freeze |
| Coordinator withholds receipt or presents inconsistent log | timing_unverifiable, disclose trusted-service limitation; no fabricated timely success |
| No verifier response; client offline while approval deadline passes | Sidecar unresolved; anyone may still settle full producer payout; no automatic dispute/refund |
| Pass then client disputes; fail then client approves | Both base actions remain valid while Submitted; advisory result neither vetoes nor initiates them |
| Client tries to approve or change split after Disputed | Existing contract rejects approveAndPay; expiry uses creation-time stored split |
| Submission/approve/dispute races claimTimeout at and after deadlines | Test both orderings on local chain; first valid transaction determines state, no hard-cutoff assumption |
| Malicious HTML, prompt injection, internal-IP redirect or repository install request | Fetch/render isolation and source-data boundary hold; no tools, code execution, secrets or writes |
| Reorg, restart, duplicate receipt or terminal-state late evaluation | Orphan/revalidate canonical binding, durable dedupe, no double action or retroactive settlement change |
| Slash during concurrent jobs; challenged verifier seeks reward from sink | Use actual remaining producer stake; no per-job stake promise, withdrawal, bounty or arbitrary slash |

Negative implementation guards: source and freshly built UI artifacts must keep advisory warnings and existing capability labels; parsed ABI must have no verifier-controlled base settlement/slash entry point; wallet spies must show zero sends for viewing, evaluating or challenging. Signature tests must reject cross-domain and criteria-swapping attacks. Integration tests must prove off-chain challenge state never enters transaction authority or suppresses permissionless timeout. No weakening existing timeout/stake/reputation spec assertions to make new tests pass.

## 10. Implementation dependency map and approval decisions

| Dependency | Required maturity before dependent work | Current status / owner |
| --- | --- | --- |
| Template category/request/artifact semantics | Frozen interface for designing parsers | Frozen upstream; parser implementation not implied |
| Existing settlement ABI/deadline/economic semantics | Implemented source for compatibility; attested deployment for activation | Source inspected; activation attestation still required |
| Verifier authority and zero-fee advisory model | User-approved semantics before implementation | Proposed here; user decision D1 |
| Criteria manifests and bounded per-template checks | Exact versions, required flags and validation rules frozen | D2; URL pilot first, other evaluators not implemented |
| Signed payload schema/canonicalization/signature support | Complete schema plus cross-language vectors frozen before signer/parser work | D3; field design above is proposal, not library code |
| Time budget, coordinator trust and receipt API | Values and admission/clock/finality rules frozen | D4; must fit actual approval window |
| Durable assignment/record/receipt/cursor storage | Schema and retention semantics frozen, storage present in repo before state-reading workers | D5; absent, cannot dispatch consumers against a prose stub |
| Fetch isolation and source retention | Safe adapters, budgets and failure semantics implemented/tested before evaluator execution | D2/D5; current URL worker is not a general verifier |
| Paid service or binding escrow | User-approved economics and immutable creation-time policy, new storage/interfaces and migration plan before Solidity or consumers | D6/D7; explicitly out of v0 |

Open decisions requiring user approval (no funds, signatures or services activated by this document):

- D1: Approve advisory-only, optional, zero-fee pilot, client-selected single verifier, actual-producer binding and optional producer acknowledgement? Recommendation: yes; no on-chain authority and no automatic wallet writes.
- D2: Approve starting with URL-summary only, the proposed bounds and an explicit mechanical/judgment criteria manifest? Each BYO template remains disabled for verifier execution until its exact evaluator, budgets and evidence limits are separately frozen. Repository review especially needs a byte/file budget.
- D3: Approve EIP-712 + canonical JSON hashing and EOA-only pilot? Smart-wallet support, full JSON schemas, checker-version identifiers and test vectors must be settled before signing. No silent format substitutions.
- D4: Choose E/C/R/B values for the target deployment, coordinator operator and signing key, clock tolerance, chain confirmation/reorg policy, outage policy and monitoring expectations. Recommendation: decline service if sufficient review and response time cannot be reserved; no guessed production defaults.
- D5: Choose artifact/coordinator storage operator, accessibility, retention duration, public-evidence privacy policy, quotas and operating budget. Recommendation: content-addressed public-safe records with checked retrieval and durable append-only receipts; no permanence guarantee.
- D6: Should a later phase pay verifiers or require bonds? Recommendation: keep zero fee/no bond until separately funded service economics and objective non-delivery rules are approved. Any fee/bond values and beneficiaries fixed before acceptance; no quality-based arbitrary slash.
- D7: Is a genuinely binding challenge desired later? If yes, approve a separate contract-version design with immutable verifier/criteria/artifact commitments, on-chain challenge storage, exact override powers, finality and timeout priorities, dispute/split policy, payment/stake rules and migration treatment. Do not implement an advisory wrapper that claims to freeze the existing marketplace. Existing jobs always retain current permissions and economics.

This document completes architecture scope only. Approval of the document does not authorize deployment, wallet operations or implementation. No Solidity/frontend changes, push, contract deployment, service launch, source fetches or real evaluations are part of this task.

## Verification of this architecture deliverable

- Executed `npm --prefix contract test -- --network hardhat test/spec-timeout.test.js test/spec-stake.test.js test/AgentMarketplace.test.js`: exit 0, 22 passing. These existing local-chain tests support the inspected compatibility baseline, not verifier functionality or live deployment configuration. Local test fixtures create ephemeral contracts; no external deployment or wallet action occurred.
- Executed `git diff --check`: no diagnostics. Since this is an untracked new document, also executed `git -c core.autocrlf=false diff --no-index --check -- NUL contract/docs/verifier-protocol-v0.md`: no whitespace diagnostics; exit 1 represents a new-file difference, not a verifier test failure.
- Relative references were located/read with repository tools; an automated Python link checker and execute_code were blocked by headless execution policy and did not run. No automated link-check success is claimed.
- No existing spec/test assertions, Solidity, frontend code or deployment files were changed by this task. Concurrent workflow-template files and the reputation audit were left untouched. The adversarial matrix above is a mandatory implementation acceptance specification, not executed verifier test coverage.
