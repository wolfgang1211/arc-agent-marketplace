# V2 Step 2 design — semantic gaps exceed the frozen runtime gate

## Gate decision

Step 1 matrix expectation corrections are retained. The approved V2 fixes are
implemented in the paired marketplace/vault sources under the frozen
`runs=50, viaIR=true, solc 0.8.28, Cancun` profile. No deployment, RPC write,
commit, or push was performed.

Measured with `hardhat.v2.config.js` and
`(deployedBytecode.length - 2) / 2`:

| measurement | runtime bytes | result |
|---|---:|---|
| prior measured baseline | 23,344 | 156 bytes headroom |
| current V2 marketplace after approved cleanup/fixes | 23,057 | **443 bytes headroom** |
| current V2 vault | 6,619 | 16,881 bytes headroom |

Current marketplace runtime SHA-256: `0f28cde6547c421953228ca5696a8ae01312fac0214948750cadb7e1ab5c25e0`.
Current vault runtime SHA-256: `dff8b2e98bbd99afe43ff32abb06eeb70165e44988777a833710ca84b464f311`.

## Corrected matrix expectations

The matrix now encodes the product rules rather than forcing the contract to
match invalid assertions:

- V2-017: the second resume is forbidden; it asserts revert and unchanged
  dispute usage/version. The title says remaining dispute budget, not an
  extra-delivery ceiling.
- V2-020: approval of an existing delivery succeeds after a missed revision
  deadline; review-timeout claim after settlement fails.
- V2-023: late access-recovery dispute uses `episodeStart == repairDeadline`.
- V2-024: a test client must be allowlisted; `house` is false at posting and
  is the operator house capability snapshot at award. The old client-house
  fixture was corrected.
- V2-026: uses `V2AccountingToken` and an actually blocklisted client withdrawal
  path, then unblocks only to verify recovery.
- V2-031: a pending mutual proposal does not block delivery.
- V2-032: same-block review-timeout claim versus invalid late action is tested
  in both transaction orders, with one success and one revert per block.
- V2-034: three grants are exercised; 30-day delivery plus 150 days of grants
  reaches the exact 180-day total, and +1 second is rejected.
- V2-035: the acceptance assertion requires `DeliverySubmitted.stateVersion`.
- V2-029 now requires the missing proposer-only `revokeMutual` ABI/function.

The corrected targeted matrix ran against the attempted implementation as
**21 passing, 1 failing** (V2-034's first assertion was then corrected to
measure extension-total versus total delivery duration). After that correction,
the attempted implementation ran **21 passing, 0 failing**, but failed the
runtime gate at 23,799 bytes. The source was restored before stopping.

## Genuine gaps requiring Step 2 implementation

1. **Operator-house capability snapshot**
   - Posting must not derive `Job.house` from the client.
   - A test job requires an allowlisted client.
   - An operator marked house may award only a test job for an allowlisted
     client; the awarded job freezes the operator house flag.
   - All house administrative actions remain blocked.

2. **Access-recovery dispute clock**
   - A dispute triggered after the repair deadline must set
     `episodeStart = repairDeadline`. Its initial `lastAdminActionAt` must also
     refer to `repairDeadline`, not the delayed trigger transaction. Otherwise
     the worker can grant a fresh seven-day inactivity window. A timely,
     authorized heartbeat can subsequently update the last action reference.

3. **Mutual proposal revocation**
   - Add `revokeMutual(id, expectedStateVersion)`.
   - Only the active proposer may revoke; the opposite party's existing
     `rejectMutual` authorization must not change.
   - Reuse the existing inactive/rejected event path if event distinction is
     not required by consumers.

4. **Event-only observability**
   - Rename `DeliverySubmitted.version` to `stateVersion` and emit the
     post-transition value (`current + 1` under the existing modifier).
   - Before implementation, enumerate the required event fields for canonical
     post terms, fee/min-reward snapshots, resolver, deadlines, state version,
     repair metadata, and fault metadata. Do not hide required values behind
     calldata or the test storage read model.
   - Prefer extending existing lifecycle events or compact dedicated events;
     measure each structural group independently.

## Required Step 2 measurement protocol

1. Create a RED test for one semantic group only.
2. Apply one minimal source group.
3. Clean-compile with the frozen profile.
4. Record runtime bytes, runtime SHA-256, artifact SHA-256, source SHA-256,
   and targeted test output.
5. Keep the group only if its behavior is correct and runtime is <=23,500.
6. Repeat for house authorization, revoke, access clock, and event
   observability separately. If any required group cannot fit in the remaining
   headroom, stop and retain this design rather than changing V1 settings,
   enabling unlimited size, restoring removed production getters, or using a
   proxy/upgrade path.

## Step 2: two-contract architecture proposal (design only)

This is the proposed split requested by the user, not another optimizer pass.
Implementation requires separate approval. No vault code is created here.

### Responsibilities and authority

- **AgentMarketplaceV2** keeps job terms, signatures, registration/capacity,
  assignment, delivery/revision/access clocks, dispute decisions, reward escrow,
  platform fee snapshots and all operator/client/treasury settlement credits.
- **OperatorCollateralVaultV2** holds operator deposits, free collateral and
  per-job reserves, including terminal jobs awaiting fault review. It enforces
  sufficient free funds, job-isolated slash caps, release guards and the
  seven-day fault-review boundary. It cannot alter job outcomes or reward escrow.
- Pair both contracts immutably, with the same immutable USDC token. The vault's
  workflow authority is only the paired marketplace, not an admin wallet.
  There is no replaceable vault setter, arbitrary admin slash or sweep function.
- Resolve constructor-address circularity through an explicitly reviewed
  deterministic deployment/address plan or one-time binding protocol in the
  later approved deployment design. Do not silently introduce upgradeability.
  Validate predicted addresses, actual code and matching constructors before
  funding. No deployment action is part of this proposal.

### Calls and atomicity

| Action | Call and effect |
|---|---|
| Stake deposit/withdrawal | Operator calls vault; only free collateral is withdrawable |
| Award | Marketplace validates application, cap and terms; vault `reserve` moves free to a specific job reserve; both updates succeed or both revert |
| Normal close | Marketplace credits reward/fee/refund; vault `release` moves this reserve to operator free without a token transfer |
| Delivery failure | Marketplace refunds reward immediately and decrements active count once; vault retains only this job's reserve, with review ending at the actual claim receipt timestamp + seven days |
| Fault decision | Marketplace validates frozen resolver, conflict rules, evidence and deadline; vault validates recorded job/operator/client and slash <= reserve, then slashes/releases |
| No decision | Permissionless marketplace entrypoint requests full reserve release after the recorded fault deadline; no automatic slash |

Keep a single client payout-credit ledger in the marketplace. For a slash:

1. Marketplace validates and marks the fault disposition before calling vault.
2. Vault removes the slash from its collateral liability and returns the
   unslashed part to operator free collateral.
3. Vault transfers exactly the slash USDC to the marketplace using SafeERC20.
4. Marketplace verifies its received balance delta and credits that exact amount
   to the recorded client, with no fee on the slash.

No externally callable arbitrary `creditClient` callback is needed: credit
occurs in the original marketplace call after vault returns. Any failure
reverts both contracts' state. Reject fee-on-transfer mismatches instead of
crediting tokens not received. Vault must match beneficiary/operator/job to the
recorded reservation, not trust arbitrary recipients in a caller payload.

### Conservation

Let E be reward escrow, C marketplace payout credits, F vault free collateral,
R all job reserves (including pending fault review), and Sm/Sv donated surplus.

- Marketplace token balance = E + C + Sm.
- Vault token balance = F + R + Sv.
- Combined balances = E + C + F + R + Sm + Sv.
- Sum of recorded job reserves by operator equals its reserved collateral.
- Slash/release moves reserve into operator free collateral and client credit;
  combined liabilities do not change. Reward settlement moves E into C only.
- Pull withdrawal decreases the corresponding liability and balance equally.
- No duplicate collateral liability in marketplace accounting; donations remain
  separate surplus and cannot cover manufactured credits/reserves.

Verify each individual and combined equation after every receipt and expected
revert, including failed token transfers and terminal pending-review jobs.

### Reentrancy and failure risks

- Both contracts use nonReentrant and checks-effects-interactions. Calls to the
  vault remain inside the original marketplace guard. Token callbacks cannot
  reenter either contract's withdrawal, reservation, settlement or slash path.
- Avoid using a mid-transaction cross-contract read as a finalized accounting
  invariant; verify complete post-transaction totals and atomic rollback.
- One-shot disposition/state guards prevent duplicate reserve/release/slash.
  Frozen per-job resolver, beneficiary and policy snapshots survive global
  admin changes.
- A blocklisted client must not block credit-only reward settlement or
  bookkeeping-only reserve release. Blocked pull withdrawals retain their
  liability while unrelated users remain operational.
- If the token blocks a slash transfer to the marketplace, revert without
  losing the pending reserve. Do not invent an alternative recipient, silent
  forfeiture or unapproved slash policy to bypass it.
- No registry/oracle/backend call becomes mandatory for financial settlement.

### Acceptance and approval

Preserve all existing product rules and add real two-contract tests for
award/reserve, settlement/release, slash transfer, callback attacks and atomic
rollback. Run one operator/two jobs in the same marketplace and vault: slash A,
verify B unchanged, then complete B. Repeat deadline D-1/D/D+1, delayed-worker,
same-block ordering, full local E2E and V1 regressions. Require both runtime
artifacts <=23,500 bytes under pinned profiles, with source/compiler/artifact
identity. Event payloads must support the required event-only read model.

**Approval needed:** implementing this split and its local tests. Independent
review, commit, push, deployment and any external transaction remain separate
approval gates. The split has not been implemented.
