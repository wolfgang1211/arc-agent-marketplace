# Reputation signal gap audit

## Scope and decision

Repository baseline: `8c2ada8f14362fe5342ab4f6f4b68d924543b8aa`. This is a source and local-test audit, not an attestation of a deployed contract, hosted indexer, live UI, or mainnet behavior. References below are repository-root-relative `path:line` locations at that baseline. No scoring, contract, UI, tests, deployment, or wallet settings are changed by this document.

**Recommended next increment: a read-only, deployment-scoped lifetime settlement evidence panel on the agent profile.** Show client approvals alongside delivery-timeout refunds and slash amounts, with submission timing and explicit coverage. Keep the existing score and recommendation ordering unchanged. Do not turn the panel into a quality rating or success percentage. First require projection parity with the contract; the present indexer is not an authoritative source for current-era reputation.

Why this increment: the existing profile combines resettable approval counters with lifetime slash events, while its delivery links are labeled as verified quality without content verification. Historical settlement evidence is reconstructible without new contract storage, economic policy, verifier authority, or moving escrow. It supplies context for selection without claiming to detect low-quality suppliers.

## Exact current contract surface

Source: `contract/contracts/AgentMarketplace.sol` (abbreviated below as `C`).

### Getters

| Exact getter | Return / meaning | Source |
| --- | --- | --- |
| `getAgent(address who)` | `Agent` tuple: `name`, `skill`, `fee`, `distinctClients`, `inProgress`, `submitted`, `approvedDeliveries`, `disputes`, `totalEarned`, `stake`, `activeJobs`, `registered` | C:46-59, 415-417 |
| `agents(address)` | Public mapping getter exposing the same agent fields | C:77 |
| `getAgentReputation(address who)` | `(uint256 distinctClients, uint256 submitted, uint256 approvedDeliveries, uint256 disputes, uint256 totalEarned)` | C:432-439 |
| `getReputationScore(address who)` | `uint256`, exactly `distinctClients * 100`; not quality, a probability, or an approval rate | C:444-446 |
| `getReputationByCategory(address who, string category)` | `uint256`, current-epoch distinct approved client addresses for the exact `keccak256(bytes(category))`, multiplied by 100 | C:451-453 |
| `jobs(uint256)` | Public `Job` tuple: `id`, `client`, `agent`, `description`, `category`, `deliverableURI`, `reward`, `status`, `createdAt`, `deliveryDeadline`, `approvalDeadline`, `disputeDeadline`, `clientShareOnDispute` | C:61-75, 87 |
| `jobCount()` | Number of jobs posted, not number accepted or completed | C:88, 183 |
| `getJobsPaged(uint256 offset, uint256 limit)` | `(Job[] page, uint256 total)`, zero-based offset, at most `MAX_PAGE_LIMIT() = 100` | C:396-413 |
| `getAllJobs()` | All `Job` structs; unbounded read, unsuitable as a scalable history endpoint | C:387-393 |
| `DELIVERY_TIMEOUT()`, `APPROVAL_TIMEOUT()`, `DISPUTE_TIMEOUT()` | Constructor-selected immutable windows; deadlines start at acceptance, submission, and dispute respectively | C:29-31, 117-135, 217, 233, 290 |
| `MIN_TIMEOUT()`, `DEFAULT_CLIENT_SHARE_ON_DISPUTE()` | Minimum window and fixed creation-time dispute share, respectively | C:28, 32, 197 |
| `AGENT_STAKE()`, `MIN_AGENT_STAKE()`, `MIN_JOB_REWARD()` | Actual deployment stake, minimum permitted stake, minimum job escrow; stake is not necessarily the historical 100-USDC example | C:19-21, 125, 130 |
| `REPUTATION_FEE_BPS()`, `FLAT_REPUTATION_FEE()` | Fee constants for a new global distinct-client relationship in the current epoch | C:22-23, 251-258 |
| `slashSinkBalance()`, `reputationFeeSinkBalance()` | Global accumulated amounts retained in-contract, not per-agent lifetime totals | C:420-429 |
| `usdc()`, `SLASH_SINK()` | Token and non-withdrawable slash sink addresses | C:16, 27, 129-131 |

There is no public `repEpoch`, served-client map, per-agent lifetime approval/slash getter, submission timestamp, citation score, adjudication result, or identity-independence getter. Epoch and category dedupe are private (C:83-86).

### Events and joins

These are exact declared event signatures; `indexed` identifies filterable fields (C:92-115).

- `AgentRegistered(address indexed agent, string name, string skill, uint256 fee)`
- `JobPosted(uint256 indexed jobId, address indexed client, uint256 reward, string description, string category)`
- `JobAccepted(uint256 indexed jobId, address indexed agent)`
- `DeliverableSubmitted(uint256 indexed jobId, string deliverableURI)`
- `JobApproved(uint256 indexed jobId, address indexed agent, uint256 reward)`
- `ReputationFeeCharged(uint256 indexed jobId, address indexed agent, uint256 amount)`
- `JobDisputed(uint256 indexed jobId, address indexed agent)`
- `JobCancelled(uint256 indexed jobId)`
- `JobExpiredRefunded(uint256 indexed jobId, address indexed client, uint256 reward)`
- `JobExpiredPaid(uint256 indexed jobId, address indexed agent, uint256 reward)`
- `JobExpiredSplit(uint256 indexed jobId, address indexed client, address indexed agent, uint256 clientAmount, uint256 agentAmount)`
- `AgentSlashed(address indexed agent, uint256 amount)`

`JobApproved.reward` is the **net payout**, not gross job escrow (C:268-278). Submission logs lack the agent; refund logs lack the agent; approval logs lack the client and category. Join through job ID to `JobPosted`/`JobAccepted` or `jobs(id)`. `AgentSlashed` has no job ID: retain receipt/log ordering and pair it with the same call's `JobExpiredRefunded`, rather than guessing by timestamp. Obtain block timestamps separately; event payloads do not supply submission time.

## Feedback themes: observable facts versus claims

Classification: **on-chain** = state/log fact; **indexer** = derived history over those facts; **artifact** = retrievable output/source bytes; **verifier** = an identified evaluator applying a declared policy. A derivation does not become an on-chain getter merely because its inputs are logs.

| Theme | What exists now | Gap and defensible proposed signal | Class / trust boundary |
| --- | --- | --- | --- |
| Approved jobs vs slashes | `approvedDeliveries` increments only in `approveAndPay`; an InProgress timeout resets it. Slash logs survive resets. | Lifetime client-approved settlements next to delivery-timeout refunds, positive-value stake losses and all slash events, with linked jobs/receipts. Never divide current-era approvals by lifetime slashes. | on-chain inputs + indexer aggregation; not quality proof |
| Deadline reliability | Stored deadlines and submitted/timeout events. Job UI exposes countdown/recovery. | Per-job submission timestamp relative to delivery deadline, plus pending and missing-history states. No on-time aggregate from current status alone. | on-chain deadlines/logs/block timestamps + indexer joins |
| Disputes | `disputes` counts dispute starts until reset; fixed timeout split; no arbiter. | Separate dispute starts, currently disputed jobs, and timeout splits. None is a finding of agent fault. | on-chain + indexer; a merits decision would require a verifier |
| Repeat clients | Addresses in job records and approval logs; global/category dedupe; existing indexer pair records have first/last approved job. | Distinct returning **addresses** with multiple approvals in a stated window, plus concentration. Descriptive only; defer from the recommended increment. | indexer over on-chain approvals; identity independence unproven |
| Source/citation quality | A nonempty `deliverableURI`; profile links; self-authored operator note. | Artifact hash, retrievability, source URL/hash/time, quoted support, and rubric result. Hash integrity and valid links cannot establish factual support or completeness. | artifact for bytes/provenance; verifier for citation support, correctness and rubric judgment |
| Consistency | Persistent job history but no quality rubric or coherent lifetime outcomes summary. | Time-bucketed settlement/submission evidence with sample counts; comparable quality over repeated tasks needs versioned tasks and verifier assessments. Defer a consistency score. | indexer for lifecycle consistency; artifact + verifier for quality consistency |
| Cheap/low-quality suppliers | Minimum escrow and stake; suggested fee is agent-controlled; ranking uses clients then approvals. | Let buyers inspect scoped evidence and explicit acceptance criteria; do not infer quality from reward, fee, stake, or rank. No trustworthy automatic quality filter exists today. | on-chain economic facts; artifact + verifier needed for substantive filtering |

### Contract semantics that make naive metrics wrong

1. **Deadlines enable competing transactions; they do not automatically freeze transitions.** `submitDeliverable` checks status and nonempty URI but not delivery time (C:224-237). A late submission can succeed before timeout settlement, and then be approved. `approveAndPay` and `disputeJob` similarly have no approval-deadline guard (C:240-293). At the exact deadline, timeout is already eligible (`>=`, C:304/327/336). For the proposed evidence panel, define "before delivery deadline" strictly as submission block timestamp `< deliveryDeadline`; equality is "at deadline", not before. Transaction inclusion order determines which eligible state transition wins. No slash does not imply timely delivery.
2. **Counters are not a clean funnel.** `inProgress` rises at acceptance and falls at submission; `submitted` rises on submission but is not decremented on approval, dispute, or payout. Slash zeros these counters even if other jobs remain active (C:218-235, 303-315). Thus `submitted` is not a current submitted backlog and `approved/submitted` is not a reliable lifetime success rate. With concurrent jobs, a post-slash submission of an already accepted InProgress job attempts to decrement a zero `inProgress` counter and can revert under checked arithmetic. This is a source-derived risk, not exercised by a new test in this audit.
3. **Epoch is settlement-time accounting, not acceptance-cohort accounting.** A previously submitted job may be approved after another job causes a slash and can then earn reputation in the new epoch (C:249). Do not describe reset counters as "jobs accepted since last slash".
4. **Slash event count is not necessarily stake-loss count.** Multiple accepted jobs can expire after the first has emptied the one shared registration stake. Further `AgentSlashed` logs can have `amount = 0` and still reset reputation (C:305-322). Count events separately from positive-value losses and sum actual event amounts. Do not multiply event count by `AGENT_STAKE()`.
5. **Approval is consent, not objective quality.** Any nonempty URI is accepted; content is never fetched or verified (C:229). An approval records that the designated client released funds. `ExpiredPayout` is not client approval and does not add reputation or `totalEarned`; dispute split is not a verdict (C:326-344). `totalEarned` means current-epoch net approved payouts, not all income.
6. **Voluntary withdrawal is not a slash.** `withdrawStake` changes registration/stake but retains reputation (C:357-365). `AgentRegistered` can also be a metadata update, not a new identity or epoch (C:142-155). There is no withdrawal event here, so registration status needs a current getter read.

## Current UI and projection findings

### Profile and discovery

- `web/app/agents/[address]/page.js:45-77,188-218` reads contract reputation and lifetime slash logs from the configured deployment block. It labels counters "Since last slash" when needed, and hides them if slash history is unavailable. This is a useful existing separation, but lifetime approvals are absent.
- Profile `page.js:86-110,218` examines the latest **100 marketplace jobs**, not the latest 100 jobs belonging to this agent. Empty history is not proof of no work; categories outside that window are absent. Displayed delivery examples also can span epochs while counters do not.
- `page.js:190` says "Independent clients", but addresses do not prove independent ownership. `page.js:128,248-265` calls approved jobs with a URI "Delivery quality / Verified deliveries" without verifying bytes or citations. Better evidence-panel terminology is "Distinct approving addresses" and "Client-approved delivery links". `page.js:183-184` correctly labels the operator verification note as operator-provided.
- `page.js:109,116-117` trims a job's category before querying the exact-byte contract getter. A posted category such as `" research "` can therefore be queried incorrectly as `"research"`. Preserve raw bytes for lookup; friendly display normalization must not change identity.
- Profile read failures show an error banner, but counter values can still default to `0` when slash logs succeeded (`page.js:134,161-165,191-208`). Unknown/stale data must not look like observed zero in the proposed panel.
- `web/lib/discovery.mjs:29-36,143-145` and `web/app/page.js:498-527` rank by current distinct approved clients then approved deliveries. Dispute and slash history do not enter ordering. Repeat self-dealing can cheaply inflate the tie-breaker. The on-chain fallback is bounded to candidates from 20 jobs and eight agents (`discovery.mjs:39-79`), not a complete market ranking.
- `web/lib/timeout-recovery.mjs:119-120` says the client's dispute window "has closed" after the approval deadline, while `disputeJob` still permits a dispute if it wins before settlement. Do not reuse this stronger claim in reputation analysis.

### Indexer parity is a prerequisite, not evidence of a changed contract policy

`indexer/src/EventHandlers.ts:82-98,102-129,141-157` stores agent/client and category/client keys without epoch. Slash clears aggregates but does not clear pair records or use epoch in their keys. The pure model does the same (`indexer/src/reputation.mjs:23-48`). Consequently an old client returning after slash is not counted by the indexer, but **is** counted and charged again by the contract (C:83-86,249-265,315). `indexer/test/reputation.test.mjs:16-31` explicitly expects lifetime dedupe, whereas contract `test/spec.test.js` SPEC 7 and `test/v2-review.test.js` test new-epoch re-earning. Both existing suites pass while disagreeing.

The indexer also normalizes category identity (trim/lowercase/collapse spaces, `EventHandlers.ts:5,100`), unlike the contract's exact bytes (C:261). `Research`, `research`, and ` research ` are separate contract categories, not interchangeable reputation buckets. Normalization is acceptable for discovery filtering only if labeled as such.

`indexer/schema.graphql:1-14` stores only creation and last-update timestamps, not acceptance/submission timestamps or deadlines. `updatedAt` is overwritten on later transitions, so it cannot supply delivery timing. Full event replay is necessary for historical timing. The pure replay model does not dedupe duplicate logs; deterministic fresh replay is not idempotent re-ingestion. Framework reorg/delivery guarantees must be verified independently before trusting a hosted projection.

## Sybil and self-dealing analysis

- Same-address self-acceptance is forbidden (C:213), but a second address controlled by the same operator bypasses that identity assumption. No identity or beneficial-owner verifier exists.
- Each new global approving address in an epoch costs `max(job.reward * REPUTATION_FEE_BPS / 10000, FLAT_REPUTATION_FEE)` plus gas, with integer division as implemented. Escrow can recycle between colluding wallets after payout. Minimum reward is working capital, not all irreversibly spent; honest withdrawal can recover stake. The fee imposes a cost, not proof of genuine demand or independence.
- Repeat approvals by the same address in an epoch do not incur that reputation fee again. They still increase approvals and net approved earnings, and hence can improve the UI tie-breaker. Returning-client rate, revenue, volume, and apparent consistency are farmable.
- A client already counted globally can approve jobs in additional exact-byte categories and add category reputation without another global distinct-client fee. Client-authored categories stop agent metadata relabeling, but not colluding client category fabrication. Summing categories would double-count overlapping relationships.
- A slash erases current counters but not old logs; a new wallet starts a separate history. The panel must say "this address on this deployment", never lifetime operator history. Cross-wallet ownership heuristics risk false accusations and remain out of scope.
- A client can dispute honest work without an adjudicator proving fault. Conversely, colluders can approve meaningless or copied artifacts and pay the fee. A fast empty artifact can look timely. Economic loss, delivery timing, approval, and content quality are distinct properties.

## Recommended increment: lifetime settlement evidence panel v1

This is a recommendation, not an implemented interface. Scope is one agent address on one configured chain/contract from verified deployment block through a stated confirmed block. No new weighted score, recommendation ordering, supplier exclusion, or contract method.

### Frozen proposed semantics

- Identity key: `(chainId, contractAddress, agentAddress)`. Job evidence additionally keys by job ID; raw logs key by `(chainId, contractAddress, transactionHash, logIndex)` and retain block hash for rollback.
- Show **Client-approved settlements**, **Delivery-timeout refunds**, **Slash events**, **Stake-loss events (amount > 0)**, and **Total stake slashed** as separate lifetime counts/amount. Include **Approval-timeout payouts**, **Dispute starts**, and **Dispute-timeout splits** in an expandable outcome breakdown. They are not approval or fault equivalents.
- Link each evidence row to its job and transaction, retaining gross escrow versus net payout distinction. Slash/refund association must be proven from call/receipt ordering; ambiguous associations are shown as unknown, never guessed. Terminal job counts use unique jobs; slash counts use unique logs.
- Add a submission timing field on rows: `before deadline`, `at deadline`, `after deadline`, `not yet submitted`, or `history unavailable`. For no submission, show whether the snapshot deadline has passed and whether refund settlement actually occurred. Do not confuse overdue-unsettled with slashed. Timestamps reflect chain inclusion, not when a worker finished offline.
- Read deadlines from the same contract snapshot, or reconstruct acceptance time plus the independently verified immutable delivery window and cross-check job state. Keep immutable configuration per deployment, not a hard-coded timeout from old docs.
- Header includes deployment scope, from/to block, indexed block hash, confirmation policy, and freshness. Completion requires continuous coverage from deployment to the reported block. Incomplete/failed reads show unavailable/partial coverage, not zero counts or a global rate. Choose a chain-appropriate confirmation depth at release and publish it; do not silently use `latest` as finality.
- Preserve current-epoch counters separately and label them as such. Existing ranking remains unchanged by this increment. No quality badge is generated from URI, approval, timing, fee, or stakeholder loss. Label linked artifacts as client-approved, not independently verified.

### Counterexample acceptance matrix for a future implementation

These are required tests to add later, **not tests implemented or claimed passing by this audit**. Use local contract receipts as fixtures, not just handwritten events, and compare replay against same-block getters where semantics overlap.

| Case / attacker-controlled input | Required assertion |
| --- | --- |
| Approve, slash, re-register, same client approves again | Lifetime approvals retain both jobs; current epoch counts the returning client again with fee; lifetime slash history remains. Contract and production indexer agree. |
| Same client repeats many trivial approvals | Distinct address count does not increase in the epoch; no quality/independence badge, no new score or ranking policy from the panel. |
| Agent accepts multiple jobs; two delivery refunds after stake drained | Two unique refund jobs and two slash logs; only positive-amount log is a stake-loss event; total is actual emitted sum, not event count times configured stake. |
| Late submission wins before timeout | Recorded as after deadline even if subsequently Completed; it must not be counted as timely because no slash occurred. |
| Submission exactly at deadline, and opposite timeout/submission inclusion orders | Equality is never labeled before deadline; outcome follows actual canonical log order, not UI clock. |
| Late dispute wins before approval-timeout settlement | Preserve actual Disputed/split path; elapsed deadline alone must not be reported as a completed payout or legally closed dispute path. |
| Submitted before another job's slash, then approved after reset | Lifetime approval increments once; current counters follow approval-time epoch; no invented acceptance cohort. |
| Approval timeout or fixed dispute split without explicit approval | No approved-settlement increment and no positive-quality/verdict inference. |
| Categories differ by case, leading/trailing or repeated whitespace | Exact category reads/replay remain separate; discovery normalization cannot merge reputation. |
| Arbitrary URI, valid IPFS hash with false citations, dead HTTPS URL, or mutable content | Only delivery-link/approval facts appear; never verified quality. Integrity and truth are separately represented. |
| Repeated log delivery, restart, reorg replacing approval with dispute | Counts remain idempotent; rollback removes orphaned evidence; getter parity restored at selected canonical block. |
| Missing block range, wrong deployment block, RPC failure, or profile's 100-job sample | No lifetime zero/rate claim; explicit incomplete state. A bounded page cannot masquerade as whole history. |
| New wallet operated by a previously slashed supplier | New address has unknown operator history; no claim of a clean operator or identity continuity. |
| Voluntary withdrawal then re-registration, or metadata-only registration update | No slash, reset, or new identity credited; current registration read from contract. |

Executable negative guards for that future delivery: tests assert absence of quality/independence/success-rate fields in the panel data model, UI source and **cleanly rebuilt** profile output; compare `getReputationScore`/category behavior and the ranking comparator against baseline fixtures; fail if a timeout payout contributes to explicit approvals or missing history renders zero. Keep adversarial behavioral tests in addition to copy scans. Do not narrow contract spec assertions to make projection tests green; any later `spec.test.js` change requires explicit old/new assertion disclosure on its own card.

## Migration, deployment and readiness

1. No contract deployment or state migration is required for this panel. Existing immutable-contract events and jobs suffice; historical aggregate/timing projection is new off-chain work. Contract scoring and fees remain untouched.
2. Before using the existing indexer as input, resolve epoch-key and exact-category divergence against the contract as prerequisite work. Version the projection schema, replay from each deployment's verified start block into a separate dataset, validate against getters, then switch readers with rollback available. Backfilling only current aggregates cannot recover pre-slash lifetime history or overwritten timing.
3. Add durable acceptance/submission timestamps, deadlines, event identity and coverage metadata only in the future projection design; current schema does not expose them. Do not dispatch UI work that reads those fields before storage/API are available. Required maturity: fixed semantics, frozen read interface, and actual projection state.
4. For a future contract-semantic change such as strict deadline cutoffs or concurrency-safe counters, use a separate specification and explicit deployment approval. This contract has no upgrade mechanism shown. A new address requires independently verified artifact/configuration identity, new ABI/address/start-block bindings, and separate histories. Existing escrow must remain recoverable on the old contract; never imply reputation or jobs moved automatically.
5. A future artifact/verifier increment would need content addressing, retrieval guarantees, rubric version, verifier identity, client-specified acceptance criteria, conflicts/appeals and failure policy. None exists as an on-chain quality authority today; it is a larger product decision, not a small reputation-field addition.

## Explicitly rejected metrics

- A single "trust/quality/success" score blending approvals, disputes and slashes: mismatched windows, incentives and meanings.
- Approval/submission ratio from resettable counters, or a ratio calculated from the latest 100 global jobs: invalid denominator/coverage.
- No-slash equals on-time or good work: late transactions and unclaimed timeouts disprove it.
- Distinct address equals independent customer; repeat-client rate equals loyalty: Sybil/self-dealing cannot be excluded.
- High suggested price, escrow, earned amount or stake equals quality; low price equals poor quality: arbitrary pricing and recyclable volume.
- Submission count, URI presence, source count, link availability or IPFS hash equals citation correctness: bytes and support are different claims.
- Dispute start/split equals agent fault, refund equals client profit from slash, or payout equals approval: not contract semantics.
- Lifetime slash count times configured stake equals amount lost: zero-amount subsequent slashes disprove it.
- Sum of category scores equals independent demand, or normalized category label equals exact contract category: overlapping clients and byte identities invalidate both.
- Cross-deployment/cross-wallet merged reputation without explicit identity and migration provenance: scope laundering.

## Verification performed and limits

Local execution on the audited baseline:

- In `contract`: `npm test -- --network hardhat` returned exit 0, **99 passing**. Scope: all `contract/test/*.js`, including `AgentMarketplace.test.js`, `spec.test.js`, `spec-timeout.test.js`, `spec-stake.test.js`, `exploit.test.js`, `v2-review.test.js`, and deployment/accounting regression suites. This was local Hardhat execution, not deployment to an external chain.
- At repository root: `node --test indexer/test/reputation.test.mjs web/test/profile-truthfulness.test.mjs web/test/profile-bounds.test.mjs web/test/discovery.test.mjs web/test/onchain-agent-fallback.test.mjs` returned exit 0, **18 passing**. The indexer test passes its existing lifetime-dedupe expectation; it does not prove contract parity.
- UI inspection is source-level, not a fresh browser session or new production build. The existing compiled-profile guard ran as part of the focused suite, but no clean rebuild was performed, so this audit does not claim fresh compiled-artifact coverage.
- The late-transition, concurrent-job and zero-stake-log findings are source-derived; the table above specifies additional adversarial acceptance cases rather than claiming they were newly executed.

No external deployment, push, commit, wallet transaction, scoring change, or mainnet verification was performed. This audit leaves implementation and release decisions to a separately authorized task.
