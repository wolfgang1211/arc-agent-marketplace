# Arc Agent Marketplace: Real-World Product Plan

**Date:** 2026-09-24
**Status:** Proposed, validation first
**Prepared by:** Hermes + Claude debate, then reconciled against the current repository and public market evidence

## 1. Decision

Do **not** continue as a broad “agent marketplace.” Reposition the first product as:

> **Verifiable on-chain change review for DeFi teams and risk operators.**

A buyer submits an expected deployment/configuration change plus the relevant chain, contracts, proposal/audit/repository references, and acceptance criteria. An operator-assisted agent produces a reproducible evidence packet. Payment is held in escrow and released only when the evidence schema is complete and independently reproducible.

Initial working name: **Verified Change Review**.

The marketplace remains infrastructure, not the homepage story. The product sold to users is a specific outcome:

- “Verify that the deployed contracts and configuration match what was approved.”
- Not: “Hire an autonomous agent.”
- Not: “Get an audit.”
- Not: “Prove the protocol is safe.”

## 2. Why this wedge

### Buyer

Primary ICP:

- DeFi vault curators
- Protocol operations teams
- DAO delegates and governance service providers
- Risk/research teams reviewing listings, upgrades, and parameter changes

Secondary ICP, only after the first segment validates:

- Grant and hackathon evaluators verifying deployment milestones
- Treasury committees releasing milestone payments
- Integration teams verifying counterparties before listing them

### Real problem

A proposal, audit, or repository describes an intended system. What is live on-chain can differ because of:

- wrong chain or address
- unverified source
- proxy implementation drift
- unexpected owner/admin/role configuration
- missing timelock
- parameter mismatch
- deployment after the referenced audit/commit
- frontend or documentation pointing to stale contracts

This work is currently performed manually and repeatedly. Public evidence that this is a real operating function:

- Steakhouse describes vault setup controls, role monitoring, timelocks, and a due-diligence process with at least two internal and one external reviewer: https://www.steakhouse.financial/docs/risk-management/monitoring/vault-setup-and-controls
- Block Analitica describes risk assessments, monitoring, and mitigation services for DeFi protocols: https://forum.morpho.org/t/block-analitica-b-protocol-flagship-eth-and-usdc-metamorpho-vaults-whitelisting/372
- Morpho’s curator ecosystem contains many specialized risk teams with recurring listing and monitoring responsibilities: https://forum.morpho.org/c/vaults/17

These sources validate the workflow category. They do **not** prove willingness to buy this product. Paid pilots are the next required evidence.

## 3. Why our current system fits

Existing useful primitives:

- stablecoin escrow
- explicit job lifecycle
- deliverable commitments
- timeout/refund paths
- verifier evidence
- agent capability and executability checks
- safe source preflight
- bounded delivery preview
- workflow templates
- on-chain activity trail

These primitives create a credible chain of accountability. They should be reused rather than replaced.

Current gaps:

- only one general URL-summary execution adapter
- no deterministic EVM deployment/configuration evidence collector
- no narrowly defined customer-facing offer
- no public sample evidence packet
- no paid-customer proof
- no service-level expectation or manual escalation runbook
- mainnet economics and operational ownership are not validated

## 4. Product boundary

### The product does

For a specified chain and target address set, collect and present:

1. chain ID and canonical contract addresses
2. deployed bytecode/code hash
3. explorer source-verification status
4. proxy type, implementation address, and relevant storage slots
5. owner/admin/role assignments
6. timelock and multisig configuration when publicly resolvable
7. selected parameter values with expected-versus-observed comparison
8. deployment transaction/block/timestamp
9. referenced audit/repository commit metadata
10. reproducible commands/RPC calls and source URLs
11. explicit pass, fail, unknown, and manual-review results per check

### The product does not do

- claim that a protocol is safe
- replace a smart-contract audit
- provide legal or investment advice
- make subjective economic-risk decisions autonomously
- auto-release disputed funds from Telegram
- execute privileged protocol changes
- infer missing scope silently

## 5. Evidence packet contract

Every delivery must contain a versioned machine-readable object plus a human-readable view.

Minimum schema:

```json
{
  "schemaVersion": "verified-change-review/v1",
  "jobId": "...",
  "chainId": 1,
  "observedAtBlock": "...",
  "observedAt": "...",
  "targets": [],
  "expectedChanges": [],
  "checks": [
    {
      "id": "proxy-implementation",
      "status": "pass|fail|unknown|manual_review",
      "expected": "...",
      "observed": "...",
      "sources": [],
      "reproduction": []
    }
  ],
  "limitations": [],
  "agentCommitment": "...",
  "reviewerAttestation": "..."
}
```

Rules:

- `unknown` is a valid and necessary result.
- Every pass/fail claim requires a reproducible source.
- Subjective assertions cannot trigger automatic settlement.
- Reviewer attestation confirms schema/evidence completeness, not protocol safety.
- Evidence must be pinned to a block number to avoid moving-target ambiguity.

## 6. Business model hypotheses

Do not encode pricing into the protocol yet. Test it manually.

Initial price tests:

- founding pilot: 50–100 USDC
- standard single-change review: 150–300 USDC
- recurring monitoring/reporting: priced only after three successful one-off reviews

Potential long-term economics:

- fixed job fee for standardized reviews
- optional expedited SLA
- recurring monitoring subscription outside the escrow contract
- marketplace fee only after there is repeat demand

A free report is a sample, not validation. Success requires a third party to fund escrow with its own money.

## 7. Six-week execution plan

### Phase 0: Scope freeze and demo asset, days 1–3

Deliverables:

- one-page landing copy focused only on Verified Change Review
- one anonymized/sample evidence packet using a public DeFi deployment
- intake form with required fields and explicit exclusions
- internal runbook for manual fulfillment
- list of 30 relevant prospects

Use the existing application. Do not build x402, launchpad, token, social feed, multi-agent orchestration, or Telegram transaction features.

Acceptance:

- A new visitor can explain the offer in one sentence after viewing the page.
- The sample packet contains reproducible evidence and visible limitations.
- The intake form rejects jobs without chain, targets, expected state, and acceptance criteria.

### Phase 1: Customer discovery and pre-sale, days 4–10

Contact 30 prospects across curator, protocol ops, governance, and risk teams.

Interview questions:

1. Tell us about the last deployment, listing, or parameter change you manually verified.
2. Who performed the checks and how long did it take?
3. Which mistakes were most expensive or embarrassing?
4. What evidence was required before approval?
5. Which parts can be deterministic and which require expert judgment?
6. Would an external evidence packet be accepted internally?
7. Would you fund a 50–100 USDC pilot for a current or recent change?

Gate to continue:

- at least 10 real conversations
- at least 3 prospects provide a real past/current case
- at least 2 prospects agree to a paid pilot or place funds in escrow

If fewer than two paid pilots exist, do not build the verifier. Reassess ICP/message first.

### Phase 2: Concierge paid pilots, days 11–18

Fulfill 2–3 jobs manually while using the existing lifecycle and escrow.

Operator responsibilities:

- normalize the customer’s expected state
- run reproducible RPC/explorer/repository checks
- produce the v1 evidence packet
- have a second human reproduce a bounded sample of checks
- deliver through the current safe preview flow
- collect approval, rejection, time-to-review, and revision reasons

Pilot SLA hypothesis:

- acknowledgment: 4 business hours
- first packet: 24 hours for a bounded single-change review
- one clarification/revision round included

Acceptance:

- funds genuinely enter escrow
- evidence is delivered through the job lifecycle
- buyer independently reproduces at least one result
- payment is released or rejection reasons are recorded
- no manual database/state edits are needed

### Phase 3: Productize only repeated work, days 19–32

Implement only checks used in at least two paid pilots.

Expected modules:

- EVM RPC evidence collector
- explorer verification adapter with explicit chain support
- EIP-1967 proxy/implementation resolver
- owner/role/timelock reader
- expected-versus-observed rule engine
- versioned evidence schema validator
- deterministic report renderer
- reviewer checklist and attestation

Required product changes:

- make Verified Change Review the primary homepage action
- move the generic marketplace to a secondary route
- replace generic briefs with structured intake
- show status as `pass`, `fail`, `unknown`, or `manual review`
- display observation block and freshness prominently
- make evidence reproduction one click/copyable

Security requirements:

- chain allowlist
- bounded RPC requests and timeouts
- no user-supplied arbitrary RPC endpoints in the first release
- no arbitrary code execution
- no secret/token leakage into evidence
- explicit proxy and unsupported-contract handling
- SSRF protections retained for every URL fetch

Acceptance:

- same inputs at the same block produce semantically identical evidence
- unsupported/ambiguous cases fail closed to `unknown` or `manual review`
- verifier checks can be reproduced independently
- end-to-end tests cover escrow, execution, delivery, review, timeout, and refund

### Phase 4: Repeatability and paid conversion, days 33–42

Run another 5 paid jobs with the productized flow.

Instrument:

- lead → interview conversion
- interview → funded job conversion
- median funded budget
- time to first evidence packet
- first-pass acceptance rate
- revision rate and reasons
- percentage of checks that are deterministic
- independent reproduction success
- dispute/refund rate
- repeat purchase intent and actual repeat purchase

Go/no-go gate after six weeks:

Continue if all are true:

- at least 5 funded jobs total
- at least 3 distinct paying organizations/wallet owners
- at least 60% first-pass acceptance
- median delivery under 24 hours for in-scope jobs
- at least 2 repeat jobs or signed recurring-monitoring intent
- zero critical evidence-integrity failures

Pause/pivot if any are true:

- buyers like reports but will not fund even 50 USDC
- all demand is one-off grant verification with no repeatability
- buyers require a recognized audit brand rather than reproducible evidence
- most checks remain subjective/manual
- acquisition requires more effort than the expected contract value supports

## 8. Operating model

The first version is not fully autonomous.

Roles:

- **Buyer:** defines expected state and funds escrow.
- **Execution agent:** gathers deterministic evidence.
- **Human operator:** handles scope, exceptions, and customer communication.
- **Independent reviewer:** reproduces selected checks and attests to evidence completeness.
- **Contract:** holds payment and records lifecycle commitments.

Escalation:

- missing scope → request clarification; no execution
- unsupported chain/contract pattern → `unknown/manual review`
- conflicting data sources → preserve both, do not choose silently
- verifier outage → pause SLA and notify buyer
- dispute → no automatic release; use the current explicit resolution path

Telegram, if added, is notification-only:

- funded job
- clarification needed
- evidence ready
- review deadline approaching
- deep link to web app

Wallet linking must be opt-in, nonce-based, expiring, and revocable. Approvals and settlement stay in the wallet/web flow.

## 9. Contract and launch policy

Do not deploy a new production contract merely to look live.

Before any mainnet launch:

- run the paid pilots on the least risky supported environment
- verify token decimals and economic behavior with realistic budgets
- rehearse approve/fund/accept/deliver/review/settle/timeout/refund end to end
- document admin powers and dispute ownership
- publish contract source and deployment attestation
- define incident response and pause policy
- obtain external contract review proportionate to value at risk
- set a conservative escrow/value cap during the pilot

Claude raised a fee-rounding concern. Repository review shows that ordinary 50–300 USDC budgets do not round a 2% fee to zero with a 6-decimal token, so this is not a launch blocker. Small-amount boundary tests should still remain in the suite.

## 10. Explicitly deferred

Until the six-week gate passes:

- open-ended agent marketplace expansion
- x402 service marketplace
- agent token launchpad
- staking/reputation token
- autonomous juries
- multi-agent visual pipeline builder
- trading/casino/prediction features
- Telegram transaction signing
- generalized “AI agent” marketing

## 11. First backlog after approval

1. Select one public deployment/configuration change for the sample packet.
2. Write the v1 intake schema and evidence schema.
3. Produce the sample packet manually and independently reproduce it.
4. Replace homepage value proposition with the narrow offer.
5. Prepare the 30-prospect outreach list and interview script.
6. Run discovery calls/messages before implementing the EVM collector.
7. Secure two paid pilot commitments.
8. Only then implement repeated deterministic checks.

## 12. Debate reconciliation

Claude’s first proposal selected grant milestone deployment verification. The second round challenged that choice and preferred DeFi deployment/configuration verification because:

- buyer pain is tied to capital and governance risk
- work repeats across listings, upgrades, and parameter changes
- the project’s escrow/evidence architecture has a stronger trust rationale
- the user already operates in crypto/finance

Accepted from Claude:

- stop selling a generic marketplace
- use a narrow, measurable verification outcome
- validate willingness to pay before more protocol work
- make deliverables reproducible and block-pinned
- keep a human in the loop initially

Rejected or modified:

- “mainnet now” was rejected; paid demand and operational rehearsal come first
- grant evaluators remain a secondary segment, not the initial ICP
- fee rounding was not accepted as a material realistic-budget problem
- escrow alone is not product-market fit; repeated paid verification is the test
