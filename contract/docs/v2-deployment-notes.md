# V2 deployment and lifecycle notes

## Token units

Arc USDC is an ERC-20 interface with **six decimals**. V2 amounts are raw
USDC base units; they are not native-coin amounts and must not be scaled as an
18-decimal token. The local V2 fixtures assert `decimals() == 6` for both
`MockUSDC` and `V2AccountingToken`. No production RPC address is asserted here;
an address must be supplied and independently verified by the deployment
operator.

## Fault review

A delivery-timeout claim refunds the reward credit immediately, but collateral
remains reserved for fault review. The fault-review deadline is the actual
claim receipt block timestamp plus seven days. The resolver may resolve with a
partial, full, or zero slash strictly before that deadline; at the deadline
only the permissionless full reserve release path is available. Repeated claim
attempts cannot create another review window.

## Revision expiry and dispute fallback

If a revision correction window expires, both parties' funds remain held; the
contract does not auto-pay or auto-refund a `RevisionPending` job. The operator
path is an authorized dispute. The client may still approve where the existing
state rules permit it, or the parties may use mutual settlement. Dispute
inactivity is bounded by the effective seven-day idle clock and the twenty-one-
day episode budget; it is not an automatic revision-expiry payout.

Notifications, indexer updates, or UI timers do not stop or extend any on-chain
clock. Only an accepted transaction changes the relevant state.

## Pair and local-run gate

Use a dedicated clean wallet for one local or deployment run. Sequentially
create the vault and marketplace pair, verify both immutable directions
(`marketplace -> vault`, `vault -> marketplace`) and token/treasury equality,
then fund only after the read-back matches. A nonce mismatch or constructor
mismatch aborts before funding. No external RPC, deployment, or wallet
intervention is part of the local verification artifact.

## M-02 operator-fault dispute decision

Hakem operatörü kusurlu bulursa teminattan kesinti yapılır; hakem karar vermezse kesinti yapılmaz.
For any assigned job state (`InProgress`, `Submitted`, `RevisionPending`,
`AccessRecovery`, or a dispute opened from one of them), `operatorFault=true`
requires a positive client refund and slashes the entire already-recorded
reserve through the existing vault `slashAndRelease` path in the same atomic
call. There is no client-stake penalty, free-amount parameter, or
arbiter-selected slash amount. The client receives the reward refund plus the
reserve slash; the normal fee is calculated only on gross operator payout and
never on the reserve. A zero-refund fault decision reverts before mutation.
`operatorFault=false` releases the reserve normally. Resolver inactivity,
mutual settlement, timeout settlement, and resume paths do not slash. The
fault-review claim rule remains separate: the delivery-timeout claim starts a
new seven-day review window from its receipt timestamp, while a late fault
decision does not renew a window.

## Runtime gate

The canonical V2 build is Solidity 0.8.28, Cancun, viaIR, optimizer runs 50.
The marketplace and vault runtimes must each remain at or below 24,000 bytes.
The post-tur3 marketplace runtime is 23,908 bytes, leaving only **92 bytes**
below that acceptance ceiling. No new features will be added to this contract;
Package 2/3 features must be planned off-chain or in separate contracts.
Historical measurement reports are snapshots, not approval of their test
coverage. The vault's source-preserving compiler-profile reduction is documented
in `v2-vault-runtime-profile-audit.md`. Rebuild with `npm run size:v2` and use the current verification
artifacts before any separately approved deployment.

## Resolver and treasury operational separation

On mainnet, the resolver and treasury will use **separate wallets**. This is an
operational requirement, not a new on-chain address-inequality restriction.
The contract continues to allow the addresses to coincide.

The fee is charged only on gross operator payout, not on a client refund or a
collateral slash. A resolver who also controls the treasury therefore has a
financial incentive connected to the payout allocation. This conflict risk
must be disclosed to users. The deployment checklist must record and verify
the separate resolver and treasury wallet addresses before funding or use;
this document does not authorize deployment or wallet transactions.
