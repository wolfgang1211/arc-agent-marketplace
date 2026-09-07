# Deployment identity gate

> The `production` label is a configuration profile, not proof of mainnet support. Current deployment scripts target `arcTestnet`; a mainnet release requires separately reviewed network configuration, fresh evidence, and explicit operator approval.

Every deployment card must consume this gate before an address is announced, configured in the frontend, or used for integration testing.

1. Run `npm run verify:artifact` from `contract/` to clean-compile and verify the governed build identity.
2. Select and review an explicit mode: `DEPLOYMENT-MANIFEST.json` is the Arc verification instrument with delivery=600s, approval=900s, and dispute=1200s; `DEPLOYMENT-MANIFEST.production.json` currently also specifies 86400-second delivery, approval, and dispute windows; its name does not imply a mainnet deployment. `DEPLOYMENT-MANIFEST.live-testnet.json` is the public testnet profile with a 10 USDC stake and 86400-second delivery, approval, and dispute windows. `npm run verify:config` validates the governed configurations and rejects an equal-window verification manifest. Never derive expectations from the deployed contract.
3. Run `npm run attest:deployment -- --rpc <RPC_URL> --address <DEPLOYED_ADDRESS> --tx <DEPLOYMENT_TX_HASH> --mode <verification|live-testnet|production>`. A wrong-mode address is rejected.
4. Preserve the JSON output in the deployment record: RPC URL, chain ID, block tag, address, deployment transaction, constructor arguments, decoded byte length, observed and reconstructed expected keccak256 hashes, normalized hash, immutable getter values, and exit status.
5. Accept the address only when the command exits zero and prints `ACCEPTED`. Any chain, manifest coverage, creation input, constructor argument, getter, length, hash, or byte mismatch exits nonzero and rejects the address.

The compiler runtime contains placeholders for Solidity immutables. A raw hash of that unpatched artifact cannot equal normal on-chain runtime code. The executable gate dynamically resolves compiler AST IDs to immutable names, requires exactly one manifest rule for every name, and reconstructs runtime from manifest expectations rather than trusting getters. `SLASH_SINK` is explicitly resolved to the deployed address. Public getters must equal the same effective manifest configuration. The deployment transaction must create the attested address and its input must exactly equal governed creation bytecode plus ABI-encoded manifest constructor arguments. Unknown, unmapped, missing, or duplicate immutable rules fail closed. Exact runtime bytes/hash and immutable-normalized identity are still required.

`ARTIFACT-IDENTITY.json` is governed. Update it only for an intentional contract change, with the old and new creation/runtime-template hashes and a specific reason recorded in the contract-changing commit or governed change record. Regenerating identity merely to silence `verify:artifact` is forbidden.

The opcode evidence is limited to Arc Testnet chain ID `0x4cef52`, the recorded block, and the observed client. `eth_call` with `stateOverride` measures that node's EVM behavior at that block only. Later network forks or client changes may alter behavior. Arc mainnet requires fresh probes before deployment.
