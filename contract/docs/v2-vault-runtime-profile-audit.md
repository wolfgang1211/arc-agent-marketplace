# Vault runtime reduction: source and compiler-input audit

The 6,619 -> 4,854-byte reduction is a compiler-profile difference, not a source edit. Both compiler inputs contain exactly the current 8,420-byte `contracts/OperatorCollateralVaultV2.sol` source.

Source SHA-256 in both builds and the working tree:
`58b95582923b33f170e0879c0eb9c5fede1d1dfc6553fc3a68ed04f03880f89f`

| Setting | Previous vault build | Current vault build |
|---|---|---|
| Compiler | 0.8.28+commit.7893614a | 0.8.28+commit.7893614a |
| EVM | Cancun | Cancun |
| Optimizer | enabled, runs 200 | enabled, runs 50 |
| viaIR | absent, default false | true |
| Runtime bytes | 6,619 | 4,854 |
| Build-info | artifacts-v2-final2/build-info/3bc5d4b72f5b9e32f1a126aa09624be7.json | artifacts-v2-runs50/build-info/eaa02ef53ac5f224ef8259f9c7e6e483.json |

The source content from the old compiler input, new compiler input and working tree was compared directly. The ABI, method identifiers and storage layout were also compared and are identical.

## Source diff

The unified source diff is empty: zero added lines, zero removed lines. No function or event was removed, moved or rewritten. There is consequently no removed/moved function requiring a behavioral justification. The existing `onlyMarketplace` boundary is unchanged.

## Preserved behavior and dedicated coverage

All tests below are in `test/v2-vault.test.js`; this is a coverage inventory, not a replacement for a current execution log.

| Preserved surface | Test coverage |
|---|---|
| constructor immutables | `pins token, marketplace, and treasury immutables to the predicted pair`; `rejects zero constructor addresses and does not expose an admin/bind path` |
| `depositStake` | `deposits only the caller's stake, with exact received accounting` |
| `withdrawStake` | `withdraws only free stake and leaves reserved collateral locked` |
| `reserve`, `reserveOf` | `reserves two jobs for one operator and isolates slash/release to the selected job`; `rejects zero/duplicate reservations without changing state` |
| `release`, `_release` | `releases a normal reserve exactly once` |
| `markFault`, `slashAndRelease`, `releaseFault` | `permits D-1 slash, rejects D slash, and permits D release`; `accepts a late markFault deadline and gives no fresh interval` |
| `sweepSurplus` | `sweeps only donated surplus and cannot encroach on free or reserved liabilities` |
| `requiredStake` | `uses checked ceil-ten-percent collateral, five-USDC floor, and cent rounding` |
| `onlyMarketplace` | `rejects unauthorized reserve lifecycle calls and preserves all accounting` |
| transfer/reentrancy/rollback | `rejects false-return transfers atomically and swallows callback reentry`; `rolls back slash state when the marketplace receiver rejects the token` |

Preserved events: `StakeDeposited`, `StakeWithdrawn`, `StakeReserved`, `StakeReleased`, `FaultMarked`, `StakeSlashed`, `FaultReleased`, `SurplusSwept`.

## Runtime hashes

Previous deployedBytecode SHA-256:
`dff8b2e98bbd99afe43ff32abb06eeb70165e44988777a833710ca84b464f311`

Current deployedBytecode SHA-256:
`d347274acba982afd60956008affb1dff16a8faa984582c28edd2536f492388d`

These are compiler artifact runtime-template hashes, not a claim about a live deployed address. No source, compiler profile, chain state or deployment was changed by this audit.
