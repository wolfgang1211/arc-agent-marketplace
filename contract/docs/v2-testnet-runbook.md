# Marketplace V2: Arc Testnet runbook

## Status and authorization boundary

Preparation only. No Arc deployment, funding distribution, approval, transaction or faucet automation has been performed in this preparation run. The only real-chain activity was public JSON-RPC reading.

Accepted evidence commit on `feat/marketplace-v2`:
`9475834937f2ce5bffccf3f18b5868b97d0dd755`

Message: `v2 contracts: tur3 evidence fixes, role matrix, size gate`.

Testnet-preparation scripts, this runbook, public manifests and `.gitignore` hardening were added after that commit and remain uncommitted. Do not push or deploy without separate approval. Do not change either Solidity contract, the V1 bot, Railway, Vercel, existing environment files or `main`.

## 1. Network and token: official claims versus RPC observations

Official sources:

- https://docs.arc.io/integrate/connect-to-arc
- https://docs.arc.io/arc/references/rpc-endpoints
- https://docs.arc.io/arc/references/contract-addresses
- https://docs.arc.io/arc/concepts/stablecoin-native-model
- https://faucet.circle.com

| Parameter | Official configuration |
|---|---|
| Network | Arc Testnet |
| Chain ID | 5042002 (`0x4cef52`) |
| RPC | https://rpc.testnet.arc.io |
| Explorer | https://explorer.testnet.arc.io |
| Gas currency | native USDC, 18 decimals |
| ERC-20 USDC | `0x3600000000000000000000000000000000000000` |
| ERC-20 precision | 6 decimals |

**Independently read from RPC**, snapshot `2026-10-18T18:24:07.814Z`, balance block `67882056`:

- Chain ID: 5042002.
- `decimals()`: 6; `symbol()`: `USDC`.
- All seven encrypted role wallets: pending nonce 0, balance 0, no runtime code.
- Deployer specifically: pending nonce 0 and code `0x`.
- Gas price: 25,000,000,000 native base units/gas (25 gwei).
- Block base fee: 20 gwei; priority quote: 5 gwei.
- Planning fee cap: `2 * baseFee + priority = 45 gwei`.

Evidence: `docs/v2-testnet-readonly-preflight.json`. These values are snapshots, not promises about a future fee market. Run `node scripts/preflight-v2-testnet.js` again before requesting transaction approval.

Native USDC and ERC-20 USDC are **one underlying balance**, exposed at different precisions. Never add them as separate funds. Marketplace escrow/stake uses the ERC-20 interface at 6 decimals; gas accounting uses native precision at 18 decimals. Native dust below one ERC-20 base unit is not additional ERC-20 spending capacity.

## 2. Public role addresses

| Role | Address |
|---|---|
| deployer | `0xb86786b6683c0d057cbfe4513881870568c94d22` |
| owner | `0xf5e14962e46f80faa40570bd86bcce83aa6626ff` |
| treasury | `0xd520bee785a4b6bea15c94f20f640aaad00088ab` |
| resolver | `0x8c1e3668528c7f1f2e56becdddb4f368de12d8d3` |
| testOperator | `0x7c3a84c2f23b50cd7a70a597641776475abb59e7` |
| testClient2 | `0x64b223aa99f0a1e3cd151fb982e2fff9255035c8` |
| house, existing | `0x843dD6a6153D73d17dAA5D7fB0e8E3e250A76505` |
| testClient, new encrypted role wallet | `0x305E306d13c1cF49E5023E13D19caC59072EC59e` |
| manualClient, Yusuf's existing wallet | `0x460EBe282Fb0e42B4d682a7f9EF408302417F780` |

Public-only manifest: `docs/v2-testnet-wallets.json`. House remains the exact existing address. The old Yusuf-controlled address is preserved as `manualClient`; the new encrypted `testClient` wallet is Hermes-controlled for approved testnet preparation only. House's real transactions and EOA application signatures still require Yusuf's participation.

## 3. Keystore protection and runtime loading

Private material is outside the repository and `duo`:

`C:\Users\wolfgang\AppData\Local\hermes\keys\alphaboard-testnet`

- Six encrypted JSON `.keystore` files: AES-128-CTR, scrypt.
- Six separate `.password.dpapi` files: Windows DPAPI **CurrentUser**, not plaintext passwords.
- Folder ACL inheritance disabled; only the current Windows user and SYSTEM have access.
- Filesystem ancestors have no reparse/junction points. The configured OneDrive root is `C:\Users\wolfgang\OneDrive`, which does not contain this folder. Google DriveFS and Dropbox configuration was absent in the observed environment. This verifies observed configured sync clients, not unknown third-party backup software.
- Preserve the Windows user profile: DPAPI-protected passwords are tied to that user/profile. Do not copy these test keys into cloud storage or reuse them for mainnet.
- Offline runtime loader: `python scripts/run-v2-keystore-wallet.py deployer` (or another one of the six roles). It decrypts in memory and prints only a public address. Secret material uses an anonymous stdin pipe, not argv, environment variables or plaintext files.
- Local application signing helpers accept only testOperator applications bound to chain 31337. They cannot produce Arc Testnet/mainnet application signatures. This is deliberately not an armed live transaction runner.

Security evidence: `docs/v2-testnet-keystore-security.json`. The repository ignores `*.keystore`, `*.keystore.json`, `*.key`, `*.dpapi`, `keys/`, `keystores/` and `.env*`. Existing placeholder-only `.env.example` / `.env.local.example` exceptions remain; never put real secrets there.

## 4. Funding plan: no transfer is authorized yet

Yusuf manually requests **25 testnet USDC** into the deployer at https://faucet.circle.com. Do not automate the faucet or solve CAPTCHA. If the faucet limits a request, accumulate the target manually and verify the incoming balance before any next step.

The measured local receipt trace contains 14,162,834 gas across deployment, setup and scenarios. The funding model applies the observed 45-gwei planning cap, an explicit 20% reserve, upward cent rounding, plus unmeasured-operation gas allowances. It does not add native and ERC-20 balances together.

| Role | Escrow/stake capital USDC | Gas reserve USDC | Required balance USDC | Top-up USDC |
|---|---:|---:|---:|---:|
| deployer | 0 | 0.38 | 0.38 | 0.38 |
| owner | 0 | 0.01 | 0.01 | 0.01 |
| treasury | 0 | 0.01 | 0.01 | 0.01 |
| resolver | 0 | 0.05 | 0.05 | 0.05 |
| testOperator | 15 | 0.06 | 15.06 | 15.06 |
| testClient2 | 5 | 0.25 | 5.25 | 5.25 |
| house | 5 | 0.02 | 5.02 | 0 |
| testClient | 1 | 0.05 | 1.05 | 1.05 |

Minimum modeled additional funds: **21.81 USDC**. Recommended deployer faucet target: **25 USDC**. House remains funded with approximately 14.485460225 native USDC at the snapshot; Yusuf's old manualClient balance is not included in the faucet target, swept or redistributed automatically. The new testClient starts unfunded and is included in the 21.81-USDC preparation budget.

The operator's 15-USDC capital covers two separate 5-USDC full-reserve slash scenarios plus a remaining 5-USDC free reserve. Client2's 5-USDC budget conservatively covers five 1-USDC jobs without relying on recycled rewards/refunds to fund initial approval.

Additional planning gas is estimated, not measured: five funding transfers plus one deployer recovery transfer at 21,000 gas each; role-specific spare action/withdrawal allowances are listed in `docs/v2-testnet-funding-plan.json`. Local mock-token deployment is excluded because Arc USDC already exists. House gas/authentication still needs live EOA preflight rather than relying on the local ERC-1271 stand-in.

Recalculate with `python scripts/calculate-v2-testnet-funding.py` after refreshing the read-only fee/balance snapshot and local evidence. Stop if the actual fee cap or required capital exceeds the approved budget.

### Mandatory ordering: preserve deployer nonce zero

**Do not distribute funds from the deployer before creating the pair.** Outgoing transfers increment its nonce and violate the nonce-zero deployment gate. Incoming faucet funds do not increment its nonce.

Order, subject to separate approvals:

1. Yusuf funds deployer from faucet.
2. Read-only preflight verifies balance, code and pending/latest nonce zero.
3. After explicit deployment approval, deploy the pair using nonces 0 and 1.
4. Verify both immutable directions and patched runtimes before funding either contract.
5. After explicit distribution approval, fund the other six new wallets; configure roles and complete owner acceptance.
6. Run separately approved live scenarios.
7. After all intended deployer actions are finished, return deployer remainder to owner, keeping the explicitly estimated transaction fee/dust reserve. Do not auto-sweep existing house/manualClient funds.

If distribution must happen before deployment, stop and ask for a revised funding/deployment plan. Do not silently change the nonce-zero rule or generate another wallet.

## 5. Deployment checklist: future approved phase only

The scripts delivered in this preparation run do not expose an enabled Arc deployment/transfer path.

- Pin compiler 0.8.28, Cancun, viaIR, runs 50; run `npm run size:v2` from `contract`.
- Require both runtimes <=24,000 bytes. Current marketplace is 23,908 bytes (92-byte headroom); vault 4,854 bytes. Add no new marketplace features.
- Record artifact JSON and runtime-template hashes, compiler input, dependency lock and constructor manifest.
- Before any transaction: chain ID must be 5042002, deployer pending/latest nonce must both be 0, deployer code must be empty, token decimals/symbol must be 6/USDC, and funds must meet the refreshed budget.
- Use the `deploy-v2-pair` sequence: vault CREATE nonce 0, marketplace CREATE nonce 1. Any intervening outgoing transaction aborts the run.
- Predicted addresses, **not deployed by this preparation**: vault `0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423`, marketplace `0xFA156B7A5205B123c8a22A807ba98405e36130f1`.
- Read back marketplace->vault, vault->marketplace, token and treasury addresses before any escrow/stake deposit.
- Verify creation input/constructor manifest and exact deployed runtime. These contracts have immutables: patch the artifact template at every compiler immutable reference using the expected Arc chain ID, addresses, constructor values and EIP-712 constants. Require patched byte-for-byte equality/hash equality with `eth_getCode`, and normalized runtime equality. Do **not** compare an unpatched template hash directly with deployed code.
- Local attestation is implemented/exercised by `scripts/e2e-v2-testnet-local.js`. Arc attestation must use chain ID 5042002 and the real USDC precompile, not local chain/token values. Any unmapped immutable is a stop condition.
- Configure/read back fee 500 bps and minReward 1,000,000 ERC-20 base units; register permanent house, allowlist existing testClient, and set each client resolver to the separate resolver wallet.
- Configure using temporary deployer ownership, then call Ownable2Step `transferOwnership(owner)`. Fund owner only after pair creation and approved distribution; owner calls `acceptOwnership()`. Read back owner/pending owner and prove deployer no longer has admin authority.
- Treasury and resolver use separate wallets operationally. The contract does not forbid equality; disclose the conflict because fee accrues only on operator payout, not a client refund/slash.
- Collect deployer remainder only after the remaining approved setup actions are completed. Recompute fees immediately before signing; record recipient, amount and receipt. No collection is authorized in the current phase.

## 6. Live scenario recipe, 1-USDC rewards

Use only after explicit chain-transaction approval. Record every receipt and independently read both ledgers after every receipt, expected revert and completed scenario.

1. **Normal:** testClient2 approves/posts 1 USDC; testOperator signs a real EIP-712 application for chain 5042002 and the deployed market; client awards; operator submits; client approves; operator and treasury withdraw credits.
2. **Revision:** post/award; submit; client requests revision; operator submits correction; client approves; withdraw. Respect actual chain deadlines; do not use local time-travel calls on Arc.
3. **Delivery timeout and slash:** do not deliver; after the actual delivery deadline claim timeout; confirm immediate client refund and a fresh seven-day fault window from the claim receipt; resolver slashes the fixed 5-USDC reserve within that window. Confirm zero job reserve and no second active-job decrement. Second slash/release must be rejected.
4. **Dispute + operatorFault:** operator opens dispute before deadline; resolver resolves with 0.5-USDC gross operator payout, positive client refund and `operatorFault=true`. Client gets 0.5 reward refund + 5 reserve slash; fee is 5% of gross only, never reserve.
5. **Mutual:** propose/accept a full client refund with matching job and request versions; reserve returns to operator; no fee on zero payout and no slash.
6. **House test job:** Yusuf controls the existing house and testClient signatures. Client must be allowlisted and post `testJob=true`; house registers/deposits and signs its application. Resolver settlement/fault decisions on a house job are prohibited. Exercise the documented permissionless timeout fallback and read back full conservation.

For real-chain deadlines, save resumable state and stop until the required block time. Never replace live waiting with `evm_increaseTime`, forge storage or inject account code.

## 7. Local rehearsal and limitations

Windows CMD, from the repository:

```cmd
cd /d C:\Users\wolfgang\arc-agent-marketplace\arc-agent-marketplace\contract
node scripts/preflight-v2-testnet.js
python scripts/run-v2-keystore-wallet.py deployer
npx hardhat run --no-compile --config hardhat.v2.config.js --network hardhat scripts/e2e-v2-testnet-local.js
npx hardhat test --no-compile --config hardhat.v2.config.js --network hardhat test/v2-testnet-local-guard.test.js
python scripts/calculate-v2-testnet-funding.py
```

Local runner requires the in-process Hardhat provider, chain ID 31337 and no fork. It rejects other providers before signer/deployment work. Local token minting, account impersonation, balance injection and time travel are simulation-only.

The real encrypted testOperator keystore signs local applications in memory; application signatures are bound to chain 31337 and are not reusable on Arc. Only the existing house is a local ERC-1271 stand-in; this **does not prove possession of its EOA key or its real-chain signature flow**. Yusuf must provide those signatures in the live phase.

Latest parent-executed result: **6/6 scenarios, 57 successful receipts, 2 strict expected reverts, exit 0**; separate provider guard test: **1 passing**. Deployment and setup gas are included; fixture minting is excluded from Arc capital/fee modeling.

Final local accounting in ERC-20 base units:

```text
marketBalance 0 = escrowed 0 + creditsLiability 0
vaultBalance 10,000,000 = freeStake 10,000,000 + reservedStake 0
combined 10,000,000 = escrow + credits + freeStake + reservedStake
marketSurplus = vaultSurplus = activeJobs = 0
```

Evidence: `docs/v2-testnet-local-evidence.json`, `docs/v2-testnet-readonly-preflight.json`, `docs/v2-testnet-funding-plan.json`.

## 8. Stop rules

Stop before the next transaction on: wrong chain, nonce/code mismatch, pair/constructor/runtime mismatch, any unmapped immutable, insufficient budget, unexpected revert, unconfirmed/failed receipt, negative or unexpected surplus, escrow/credit/stake mismatch, terminal active-job mismatch, replay, or role conflict. Save evidence; do not auto-retry, replace wallets, weaken checks or add funds without approval.

## 9. Mainnet and separate backlog

These testnet wallets must **never** be used on mainnet. Mainnet owner, treasury and resolver will be Yusuf's own wallets, preferably hardware wallets. Hermes may hold only a temporary mainnet deployer key under separately approved handling; these testnet keystores do not grant any mainnet authority.

V2 bot integration is a separate task: isolated V2 API/routes and bot process, a V2-specific manifest/ABI, no Railway V1 bot edits, and separately approved execution/funding. GitHub push is also separate and requires checking the Vercel preview behavior first.
