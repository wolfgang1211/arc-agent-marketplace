# AlphaBoard V2 Arc Testnet deployment report

Readback: 2026-10-19T21:40:09.764Z; block 68075445.

This is a historical deployment snapshot. **Operational update, 2026-10-20:** the timeout one-shot missed the scheduler's 120-second grace window and was removed without running at 13:13:40 Turkey time. No timeout claim, collateral slash or client withdrawal was sent. The task is stopped; no retry/reschedule was attempted. The canonical deployment JSON contains the new independent readback at 2026-10-20T10:35:47.757Z, block 68167354, and the scheduler failure evidence. This is not a passed timeout scenario.

## Contracts

- marketplace: `0xFA156B7A5205B123c8a22A807ba98405e36130f1`
  https://explorer.testnet.arc.io/address/0xFA156B7A5205B123c8a22A807ba98405e36130f1
  Explorer verified: True; compiler v0.8.28+commit.7893614a; optimizer runs 50; EVM cancun.
- vault: `0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423`
  https://explorer.testnet.arc.io/address/0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423
  Explorer verified: True; compiler v0.8.28+commit.7893614a; optimizer runs 50; EVM cancun.

Owner: `0xf5e14962e46F80fAA40570bD86BccE83AA6626fF`; Ownable2Step accepted and independently read back.

Immutable-aware runtime and constructor inputs match canonical artifacts. USDC is `0x3600000000000000000000000000000000000000`, decimals 6. Fee 500 bps; minReward 1 USDC.

## Deployment transactions

- deploy-vault: `0x9229f70c620e6fd31f32deb40193674f0aa47ea96a53dc4cb874c39f161c6400`; gas 1127657; successful receipt block 68072734.
- deploy-market: `0x2b354cfcd31abeceb19c012f19cfbf57571d5c6229fc2b8cec0dd713faa30b35`; gas 5391887; successful receipt block 68072744.
- transfer-owner: `0xe8c32e788f78a2f57a94f8b06fa57849339164c9acf66dd94bb24f598d85074d`; gas 48760; successful receipt block 68073091.
- accept-owner: `0x58a308a555f29d61a294f9962ce37c6cd38aa40cf904bc3b9f3f4ec2634000cd`; gas 28730; successful receipt block 68073096.

## Funding and remaining balances

| Role | Sent USDC | Remaining native USDC | Funding transaction |
|---|---:|---:|---|
| deployer | 0 | 38.384214359702930932 | No distribution |
| owner | 0.01 | 0.00928175 | `0x95b55a2e74b85ee7fa38c1e348445e6d3472bd0725a90ed22ce29edd2cfc5834` |
| treasury | 0.01 | 0.13061835 | `0x4ad21c5391a04430bb03c0a79cead9865c8cdf876d92013ae3b8c8c75fff9bb4` |
| resolver | 0.05 | 0.044114925 | `0x033ccf2cacf07a5e0f45345990bb26c5ab648d243436c1d371e003b6439a8ed2` |
| testOperator | 15.06 | 2.408718275 | `0xeafe652e771fd191dffc7d2ceeab244774ff8ac5361eb7cc60f8b09de03356ad` |
| testClient2 | 5.25 | 6.63803235 | `0x033493c311b8e4850bb49c87020a2d75ec8976ba387efd4568c721bb933a673c` |
| house | 0 | 14.485460225 | No distribution |
| testClient | 1.05 | 1.05 | `0x78611f904a8741f9fb8ed2646e99d9de488427c3a5fe01a9c1d8bd575c7ec5b6` |

Native USDC and ERC-20 USDC are views of the same asset, not additive balances. The deployer reserve remains in place. House balance was neither funded nor swept. Yusuf manual-client wallet was not used.

## Scenario table

| Scenario | Job | Result | Transactions | Conservation after scenario (USDC) |
|---|---|---|---|---|
| normal | 1 | passed | scenario-normal-approve-token: `0xfb655c5bbd7c1a94a770d9d3f7d39d18b98dd29f55ad132d140c419e9e2adbfb`<br>scenario-normal-post: `0x47fae13ed7d36056862a4c2411a8aa8653522225218f4de63ea46941c3993da8`<br>scenario-normal-award: `0xbae24a078e2507532ec8b14dd83864210d3f2a9b3ec9e2e0bd3f33cb58f4b6cd`<br>scenario-normal-delivery: `0xf7cac4bb356990760577500e34c78888cb360ba11136ec848a38f36471cdaab2`<br>scenario-normal-approve: `0x0de975d904c5dee8017ae81371cc75fb73bd90f909f7cc9e62e8c1e894907740`<br>scenario-normal-withdraw-testOperator: `0x3ececc6beeeba9ad75eac374a4423d7d57e8c4a3cd989d762da209066ccf735e`<br>scenario-normal-withdraw-treasury: `0x22f7763f5fbefbb514d18a946724340504698e1ce55df0815b025044b801c8ce` | Market 0 = escrow 0 + credit 0; vault 15 = free 15 + reserved 0; active jobs 0 |
| revision | 2 | passed | scenario-revision-approve-token: `0xbf373b87456047d110fadf6a772c34aa40d38220cc7f78694626e24dc4db3334`<br>scenario-revision-post: `0x4df335a6b25b30b023aa64b3a2573180b2f04cc9b9dfdd38b7542f7369057cdc`<br>scenario-revision-award: `0xa2ad19df176b63e702125e74be05cc0677f6fd3e140bcc74dac3c5266b3470f0`<br>scenario-revision-delivery: `0x3f40886a060c567cdbfb932198c6205bab4ef25f9d39e66783b720b41e5ca762`<br>scenario-revision-request-revision: `0x7b9027b815e7fec2b05815a688b8cc6a787de52baebbb840e9192bf74312126c`<br>scenario-revision-submit-revision: `0x155c2f7983a54db9eb73ca7462b16203b817b1517e3604968ebe5037e5221700`<br>scenario-revision-approve: `0x286a10dab1d5e4acc3fc9e87741b33e5d09c03f4346a4358bea24ae150538426`<br>scenario-revision-withdraw-testOperator: `0x575d0a898c615ab077f375b3f8aed31d73ca1d4042974b3389bdbeb0cb32b7cd`<br>scenario-revision-withdraw-treasury: `0xf1c7809dcaea1a6d13f7da16dc416ee5186aa72fec6ddeabb48e113022a1cb3f` | Market 0 = escrow 0 + credit 0; vault 15 = free 15 + reserved 0; active jobs 0 |
| dispute | 3 | passed | scenario-dispute-approve-token: `0x901553e713fa6156276ef9bd5ad207c6d3935093ef5f0b9d75b2ac2213769b98`<br>scenario-dispute-post: `0x421b37c7f422d27738ab55f530a96543e44913c7e44d662d33c765b06043106a`<br>scenario-dispute-award: `0x9cefc49382b7693e0ba7d397385e7681382e168fe2c9b4dafdc1156ffe21e14a`<br>scenario-dispute-open: `0xd5dc45cf6a4b7bf4fa90b51f1c79f3b38ac70491b36b48467bab920ad560f3dc`<br>scenario-dispute-resolve: `0x4457cea8c9eae1c8706b640908f3ccb8973fc482c7eb5e6887f6f7600d525bf9`<br>scenario-dispute-withdraw-testOperator: `0x1832ab0330ceaa50909b12d430e0fefad302b1dd5978653ab027afeb02d9bfa0`<br>scenario-dispute-withdraw-testClient2: `0x798b2e2e0e3c1a0c9a98cbddd93b6bd9245af327600733a5794ac4bbfa8642a7`<br>scenario-dispute-withdraw-treasury: `0x809c2e5a8dbc6c62c09453dd5ea67e5fe9f67d04cffc3f6e17e697448ba5311f` | Market 0 = escrow 0 + credit 0; vault 10 = free 10 + reserved 0; active jobs 0 |
| mutual | 4 | passed | scenario-mutual-approve-token: `0xb9561023787558f3fb9629518ab1a870c3b988b7abda6b5fa6d4c024acab2944`<br>scenario-mutual-post: `0x28f2a3e3d7611f84aa9646262f4b5edd07ebb244220543282dfafa1c510ccbdf`<br>scenario-mutual-award: `0xd67d5c0a88977117941159737f272528fcdeabcf0c49238aebb4a999f010a4c3`<br>scenario-mutual-propose: `0x9895265197b6daa2851d2f54fc456fa19ff00ec7534a02b95eca253571b3211a`<br>scenario-mutual-accept: `0xae192408ec57f1d9a1ddca909a8d687523d459960272a71c7ac27278b925e52c`<br>scenario-mutual-withdraw-testClient2: `0x072c25b8c160f532cc754ae608df5933e7e0d895c7da40f941f394fd0ae1f8cc` | Market 0 = escrow 0 + credit 0; vault 10 = free 10 + reserved 0; active jobs 0 |
| timeout | 5 | pending | scenario-timeout-approve-token: `0xf8b87220e5f8109f8b5862ad2e817bc106fb5da9dcb42db4cc01be6262decb6f`<br>scenario-timeout-post: `0xc36f194f11be845cbd31119386bcb0528eee1fe60fdf4b68d1b798d5945b3dd6`<br>scenario-timeout-award: `0xebaf8cb1ff2d2c70d3f736e0e644e6b4be0f19dad331472bc294a26e37ef9dbd` | Market 1 = escrow 1 + credit 0; vault 10 = free 5 + reserved 5; active jobs 1 |
| House test | Not created | Deferred to V2 bot integration | No transaction; house key was not accessed/copied | Not applicable |

## Timer and safety boundary

Cron `404f0fe8f2d6` was scheduled for `2026-10-19T22:27:58+00:00`, one shot, no-agent, local output only. **It was removed without execution after missing its 120-second grace window. No active replacement exists.**
Script: `alphaboard_v2_timeout_once.py`. The original executor hashes remain pinned and untouched. A fresh explicit user approval is required before any new run or replacement schedule. No automatic retry was attempted. Any later approved completion must independently verify receipts, collateral slash, client withdrawal and conservation; it cannot infer success from the timer record.

## Approved manual Job 5 attempt: stopped, incomplete

A new explicit user approval authorized one manual attempt after the missed cron. Claim and full 5 USDC collateral slash succeeded; an RPC SERVER_ERROR stopped the executor before any client withdrawal broadcast. No retry was attempted. Job 5 is Refunded, reserved stake is zero, but **6 USDC remains client credit, not a completed withdrawal**. A fresh explicit approval is required for further transactions.

- Claim: `0x1e518303ebfc7449ae5145a2fcd02735fbef5254618515bc2c674b39b96bb837`, successful receipt block 68173105.
- Slash: `0x0cac31aed0b7021c93b6e32bc9e29f5c05fd2ecf06d8a86a50b971840b078fe4`, successful receipt block 68173137; 5 USDC.
- Withdrawal: not broadcast; no hash.
- After claim, block 68173112: Market 1 = escrow 0 + credit 1; Vault 10 = free 5 + reserved 5; active jobs 0.
- Parent accounting readback, block 68173561: Market 6 = escrow 0 + credit 6; Vault 5 = free 5 + reserved 0; active jobs 0. Solvency and whole-run conservation passed.
- Parent receipt/client-credit readback, block 68173633: sender, calldata, chain and successful status verified; client credit exactly 6 USDC.
- The launcher stopped before updating aggregate gas totals. Totals were repaired from the 54 confirmed receipts, and the independent whole-run verifier passed. This evidence-only repair sent no transaction and does not mean Job 5 passed.
- Current totals: 54 confirmed receipts; 13,198,620 gas; 0.3299655 USDC gas cost. Underlying asset conservation: 74.472705359702930932 = 74.142739859702930932 + 0.3299655.

The sections above and below retain the original deployment snapshot. The canonical JSON's `manualCompletion` and `independentReadback` contain the newer stopped-attempt state; its `scheduledCompletion` remains the historical cron record.

## Gas and whole-run conservation (original snapshot)

Successful transactions: 52; total gas 12890605; actual gas cost 0.322265125 USDC.
Initial underlying USDC 74.472705359702930932 = final wallets plus contracts 74.150440234702930932 + gas 0.322265125. No duplicated native/ERC-20 assets.

No push, mainnet action, frontend/env/hosting change or V1 bot change was made.

Canonical evidence with every receipt: `contract/docs/v2-testnet-deployment.json`.
