# V2 role-collision matrix

Pair count: 21; lifecycle paths: 8; base cells: 43; expected base cells: 168.
Controls: 1. Source hashes are recorded in the JSON evidence.

Exclusive classifications: {"target-tested":25,"impossible-under-contract-invariants":6,"prerequisite-blocked":12}. Controls: {"target-tested":1}.

Rows are actual Hardhat EVM outcomes. `prerequisite-blocked` records a real root proof and does not call an uninitialized downstream path; `impossible-under-contract-invariants` records collisions whose root guard makes the target unreachable. `target-tested` means the named target transaction was executed and either succeeded or matched its exact custom error.

| ID | Equal roles | Path | Variant | Expected | Actual | Classification | Error | Status |
|---|---|---|---|---|---|---|---|---|
| R-001 | client = operator | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-002 | client = operator | award | normal-job | revert:InvalidSignature | revert | target-tested | InvalidSignature | verifiedpass |
| R-003 | client = operator | dispute | normal-job | revert:InvalidSignature | revert | impossible-under-contract-invariants | InvalidSignature | verifiedpass |
| R-004 | client = operator | resolve | normal-job | revert:InvalidSignature | revert | impossible-under-contract-invariants | InvalidSignature | verifiedpass |
| R-005 | client = operator | recovery | normal-job | revert:InvalidSignature | revert | impossible-under-contract-invariants | InvalidSignature | verifiedpass |
| R-006 | client = operator | fault-review | normal-job | revert:InvalidSignature | revert | impossible-under-contract-invariants | InvalidSignature | verifiedpass |
| R-007 | client = operator | mutual | normal-job | revert:InvalidSignature | revert | impossible-under-contract-invariants | InvalidSignature | verifiedpass |
| R-008 | client = operator | timeout | normal-job | revert:InvalidSignature | revert | impossible-under-contract-invariants | InvalidSignature | verifiedpass |
| R-009 | client = resolver | post | normal-job | revert:Conflict | revert | target-tested | Conflict | verifiedpass |
| R-010 | client = resolver | award | normal-job | revert:Conflict | revert | target-tested | Conflict | verifiedpass |
| R-011 | client = house | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-012 | client = testClient | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-013 | client = owner | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-014 | client = treasury | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-015 | operator = resolver | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-016 | operator = resolver | award | normal-job | revert:Conflict | revert | target-tested | Conflict | verifiedpass |
| R-017 | operator = resolver | dispute | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-018 | operator = resolver | resolve | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-019 | operator = resolver | recovery | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-020 | operator = resolver | fault-review | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-021 | operator = resolver | mutual | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-022 | operator = resolver | timeout | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-023 | operator = house | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-024 | operator = house | award | normal-job | revert:Conflict | revert | target-tested | Conflict | verifiedpass |
| R-025 | operator = house | dispute | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-026 | operator = house | resolve | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-027 | operator = house | recovery | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-028 | operator = house | fault-review | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-029 | operator = house | mutual | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-030 | operator = house | timeout | normal-job | revert:Conflict | revert | prerequisite-blocked | Conflict | verifiedpass |
| R-031 | operator = testClient | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-032 | operator = owner | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-033 | operator = treasury | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-034 | resolver = house | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-035 | resolver = testClient | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-036 | resolver = owner | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-037 | resolver = treasury | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-038 | house = testClient | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-039 | house = owner | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-040 | house = treasury | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-041 | testClient = owner | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-042 | testClient = treasury | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| R-043 | owner = treasury | post | normal-job | allow | allow | target-tested |  | verifiedpass |
| C-001 | client = testClient | post | approved-testJob | allow | allow | target-tested |  | verifiedpass |

