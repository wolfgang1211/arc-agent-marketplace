# V2 role-collision matrix

Pair count: 21; lifecycle paths: 8; base cells: 1; expected base cells: 168.
Controls: 0. Source hashes are recorded in the JSON evidence.

Exclusive classifications: {"target-tested":1}. Controls: {}.

Rows are actual Hardhat EVM outcomes. `prerequisite-blocked` records a real root proof and does not call an uninitialized downstream path; `impossible-under-contract-invariants` records collisions whose root guard makes the target unreachable. `target-tested` means the named target transaction was executed and either succeeded or matched its exact custom error.

| ID | Equal roles | Path | Variant | Expected | Actual | Classification | Error | Status |
|---|---|---|---|---|---|---|---|---|
| R-001 | client = operator | post | normal-job | allow | allow | target-tested |  | verifiedpass |

