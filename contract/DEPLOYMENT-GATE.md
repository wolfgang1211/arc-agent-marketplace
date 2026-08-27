# Deployment identity gate

Every deployment card must consume this gate before an address is announced, configured in the frontend, or used for integration testing.

1. Run `npm run verify:artifact` from `contract/` to clean-compile and verify the governed build identity.
2. Run `npm run attest:deployment -- --rpc <RPC_URL> --address <DEPLOYED_ADDRESS>`.
3. Preserve the JSON output in the deployment record: RPC URL, chain ID, block tag, address, decoded byte length, observed and reconstructed expected keccak256 hashes, normalized hash, immutable getter values, and exit status.
4. Accept the address only when the command exits zero and prints `ACCEPTED`. Any chain, length, immutable configuration, hash, or byte mismatch exits nonzero and rejects the address.

The compiler runtime contains placeholders for Solidity immutables. A raw hash of that unpatched artifact cannot equal normal on-chain runtime code. The executable gate therefore uses the compiler `immutableReferences` to reconstruct the exact expected runtime from every public immutable getter, then requires byte-for-byte equality and an exact runtime keccak256 match. It also verifies the recorded immutable-normalized identity. This attests both the governed code body and all constructor-derived immutable configuration. If a future immutable lacks a public no-argument getter, attestation fails closed.

`ARTIFACT-IDENTITY.json` is governed. Update it only for an intentional contract change, with the old and new creation/runtime-template hashes and a specific reason recorded in the contract-changing commit or governed change record. Regenerating identity merely to silence `verify:artifact` is forbidden.

The opcode evidence is limited to Arc Testnet chain ID `0x4cef52`, the recorded block, and the observed client. `eth_call` with `stateOverride` measures that node's EVM behavior at that block only. Later network forks or client changes may alter behavior. Arc mainnet requires fresh probes before deployment.
