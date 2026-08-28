# Arc Testnet Verification Run Report

- Chain ID: `5042002`
- Verification contract: `0x3b03D4Aa1bf568bE7fAC6fF9Dad2aEE9c9C057a4`
- Run state: **COMPLETED**
- Verified live receipts: **30/30**
- Latest verification block: `59205957` (timestamp `1787884095`)
- Blocklist: **NOT_VERIFIED**
- Verification address was not written to frontend, Vercel, demo, or announcements.

## Funding and Arc gas asset gate

- Starting deployer native balance: **141.674653014524919144 USDC** (18-decimal raw `141674653014524919144`)
- Starting deployer ERC-20 balance: **141.674653 USDC** (6-decimal raw `141674653`)
- Second wallet before spending: native raw `500000000000000000`, ERC-20 raw `500000`; exact scale equality: **true**.
- Second-wallet probe transfer: [`0x15e2e3255f9082d3e450c7e613b06964cbe8acb9ae37953156074d4f33e32330`](https://testnet.arcscan.app/tx/0x15e2e3255f9082d3e450c7e613b06964cbe8acb9ae37953156074d4f33e32330), receipt status **1**, actual fee wei `1027698000000000`.
- Finding: on this Arc Testnet run, ERC-20 funding credited the same native gas asset and the funded wallet successfully paid gas.

## Deployment

| Step | Transaction | Status | Estimated gas | Actual gas |
| --- | --- | ---: | ---: | ---: |
| verification deploy | [0xbd8024e57b7c5cbe27d657b10e011d0be7d924e7bfa2ac57a6d921ec74aa3431](https://testnet.arcscan.app/tx/0xbd8024e57b7c5cbe27d657b10e011d0be7d924e7bfa2ac57a6d921ec74aa3431) | 1 | 3151097 | 3125127 |

## Scenario transactions

| Step | Transaction | Status | Estimated gas | Actual gas | Deviation |
| --- | --- | ---: | ---: | ---: | ---: |
| assetGate:fundAgent0.5 | [0x3344b7e77b46f1ef0d0dc68f6b7698b43f761f9e19da82feab0e277f84851601](https://testnet.arcscan.app/tx/0x3344b7e77b46f1ef0d0dc68f6b7698b43f761f9e19da82feab0e277f84851601) | 1 | 74826 | 73950 | -876 |
| assetGate:return0.01 | [0x15e2e3255f9082d3e450c7e613b06964cbe8acb9ae37953156074d4f33e32330](https://testnet.arcscan.app/tx/0x15e2e3255f9082d3e450c7e613b06964cbe8acb9ae37953156074d4f33e32330) | 1 | 49326 | 48938 | -388 |
| fundAgent:100.5 | [0x0b6e64df487524a6e39738a7fdaab5154c21d5d0fd6d620fe2ef2f54904e3b09](https://testnet.arcscan.app/tx/0x0b6e64df487524a6e39738a7fdaab5154c21d5d0fd6d620fe2ef2f54904e3b09) | 1 | 49350 | 48962 | -388 |
| agentApproveStake:first | [0xd4a41f6586c39c73c8f3db39ff80eec7809343d2258b20d7be8517418ea62c10](https://testnet.arcscan.app/tx/0xd4a41f6586c39c73c8f3db39ff80eec7809343d2258b20d7be8517418ea62c10) | 1 | 56241 | 55438 | -803 |
| registerAgent:first | [0x47c0f47fcc50131b1d3c32fd959fa7b0df1cb69408b79367e51e6da994df2d09](https://testnet.arcscan.app/tx/0x47c0f47fcc50131b1d3c32fd959fa7b0df1cb69408b79367e51e6da994df2d09) | 1 | 162882 | 151972 | -10910 |
| clientApproveRewards:25 | [0x0ff5242ff4e5a3cf7e838174dab09df9ab95f684862cd371b56425381d36d79a](https://testnet.arcscan.app/tx/0x0ff5242ff4e5a3cf7e838174dab09df9ab95f684862cd371b56425381d36d79a) | 1 | 56253 | 55450 | -803 |
| postJob:happy | [0xfb0e87e14bc0ab71bc4c39bf723f1f0bef1a104caec991572e53838a2c970ff8](https://testnet.arcscan.app/tx/0xfb0e87e14bc0ab71bc4c39bf723f1f0bef1a104caec991572e53838a2c970ff8) | 1 | 263030 | 256097 | -6933 |
| happy:accept | [0x2c884065e4acd4d1269b02193dec9764186f6dcf29f878d0b860dd0543785674](https://testnet.arcscan.app/tx/0x2c884065e4acd4d1269b02193dec9764186f6dcf29f878d0b860dd0543785674) | 1 | 141874 | 140733 | -1141 |
| happy:submit | [0xb1529d506a1039eb42a3ed693d168133a02354d896108d66f450706328fe4948](https://testnet.arcscan.app/tx/0xb1529d506a1039eb42a3ed693d168133a02354d896108d66f450706328fe4948) | 1 | 107009 | 101495 | -5514 |
| happy:approveAndPay | [0x00c3b612802fd70bb6f94eb0fb26e1ec3185fd552c7aaf0645f39630b3de0e40](https://testnet.arcscan.app/tx/0x00c3b612802fd70bb6f94eb0fb26e1ec3185fd552c7aaf0645f39630b3de0e40) | 1 | 248366 | 237991 | -10375 |
| donation:transfer5 | [0xbbafb9c4177e8fd0873c846d983d0b1eb320bafbf8eb1db9e03a76a4fbc3241e](https://testnet.arcscan.app/tx/0xbbafb9c4177e8fd0873c846d983d0b1eb320bafbf8eb1db9e03a76a4fbc3241e) | 1 | 49338 | 48950 | -388 |
| postJob:donation | [0x9f2aeef0706089d7f13a3e4ef32000f10d3f18ec858bbbb17b1d584d559b76c5](https://testnet.arcscan.app/tx/0x9f2aeef0706089d7f13a3e4ef32000f10d3f18ec858bbbb17b1d584d559b76c5) | 1 | 291149 | 283884 | -7265 |
| donation:accept | [0x60110e803af25716b7924fce8d387cde358634ab3f3f35d9efb48c061c700fbf](https://testnet.arcscan.app/tx/0x60110e803af25716b7924fce8d387cde358634ab3f3f35d9efb48c061c700fbf) | 1 | 141874 | 140733 | -1141 |
| donation:submit | [0x0abc024563208ffe6ca1f947ec08a2697c5c13913a7f35fae3cfba2ab6b69f31](https://testnet.arcscan.app/tx/0x0abc024563208ffe6ca1f947ec08a2697c5c13913a7f35fae3cfba2ab6b69f31) | 1 | 112235 | 106670 | -5565 |
| donation:approveAndPay | [0xd69a3952f77bbff8e9440d4836c9d05f6401840be62ed3b993826867452756aa](https://testnet.arcscan.app/tx/0xd69a3952f77bbff8e9440d4836c9d05f6401840be62ed3b993826867452756aa) | 1 | 103317 | 93224 | -10093 |
| withdrawStake:first | [0x9e46e8ccec09407140e6c739f819b709c12da124ab26ea667d45a52bb5c9a7b5](https://testnet.arcscan.app/tx/0x9e46e8ccec09407140e6c739f819b709c12da124ab26ea667d45a52bb5c9a7b5) | 1 | 69083 | 54277 | -14806 |
| agentApproveStake:timeouts | [0x16145594d409777dc0f9ac623a9b27405c23882d5ec0980818ea2a2a4c3f2157](https://testnet.arcscan.app/tx/0x16145594d409777dc0f9ac623a9b27405c23882d5ec0980818ea2a2a4c3f2157) | 1 | 56241 | 55438 | -803 |
| registerAgent:timeouts | [0x7888ccbe8ee52cee059027e9950ff1981bc649b53db15e35955fcecaeb0ded51](https://testnet.arcscan.app/tx/0x7888ccbe8ee52cee059027e9950ff1981bc649b53db15e35955fcecaeb0ded51) | 1 | 125307 | 114912 | -10395 |
| postJob:timeoutDelivery | [0x688e56c5311a584fd3e1ead5600fcd207065c2e6bc694d64ee52ecba58b08b30](https://testnet.arcscan.app/tx/0x688e56c5311a584fd3e1ead5600fcd207065c2e6bc694d64ee52ecba58b08b30) | 1 | 245642 | 238913 | -6729 |
| postJob:timeoutApproval | [0x3ff19ada490ba48233dfb926f450799b3e9d22d1cd9adf5bd23482def3e8c42c](https://testnet.arcscan.app/tx/0x3ff19ada490ba48233dfb926f450799b3e9d22d1cd9adf5bd23482def3e8c42c) | 1 | 245642 | 238913 | -6729 |
| postJob:timeoutDispute | [0x2240187338482309341b68a1c2253d02f616fd93219fffce2acc0cb2813e87e5](https://testnet.arcscan.app/tx/0x2240187338482309341b68a1c2253d02f616fd93219fffce2acc0cb2813e87e5) | 1 | 244430 | 234101 | -10329 |
| timeoutDelivery:accept | [0xf11118a5e5b5ac12d076c3becfe510b38f71b70bc24415332566fe89b052a9d3](https://testnet.arcscan.app/tx/0xf11118a5e5b5ac12d076c3becfe510b38f71b70bc24415332566fe89b052a9d3) | 1 | 141874 | 140733 | -1141 |
| timeoutApproval:accept | [0x4d85fd26b2d5f5e7ea840d58604e6aba96c95ffb315958dd14705f53a9130940](https://testnet.arcscan.app/tx/0x4d85fd26b2d5f5e7ea840d58604e6aba96c95ffb315958dd14705f53a9130940) | 1 | 107539 | 106533 | -1006 |
| timeoutDispute:accept | [0xe70f0330ad6c3325f6ef43fb13d79824aed0add3d76c8779d69550a9f9d18a77](https://testnet.arcscan.app/tx/0xe70f0330ad6c3325f6ef43fb13d79824aed0add3d76c8779d69550a9f9d18a77) | 1 | 107539 | 106533 | -1006 |
| timeoutApproval:submit | [0xdeb0bc050aa5ac22d64b0f6dbccffa1310b012819c05f3913439e276a7f3ecd5](https://testnet.arcscan.app/tx/0xdeb0bc050aa5ac22d64b0f6dbccffa1310b012819c05f3913439e276a7f3ecd5) | 1 | 90108 | 89171 | -937 |
| timeoutDispute:submit | [0x2a7e1450d56a1882bfcd2d2ea2aaf92221da1581274c9b224d12840344d5fb8e](https://testnet.arcscan.app/tx/0x2a7e1450d56a1882bfcd2d2ea2aaf92221da1581274c9b224d12840344d5fb8e) | 1 | 90096 | 89159 | -937 |
| timeoutDispute:dispute | [0x9c0b99ce8ea646ecb581925adb05823ae95f855bafacb268e15d3ccbd378cc14](https://testnet.arcscan.app/tx/0x9c0b99ce8ea646ecb581925adb05823ae95f855bafacb268e15d3ccbd378cc14) | 1 | 80168 | 79271 | -897 |
| timeoutDelivery:claim | [0x581b20fd25badefa2c01d8e9150da299998f2dba55677ba1441b379eb7dd3103](https://testnet.arcscan.app/tx/0x581b20fd25badefa2c01d8e9150da299998f2dba55677ba1441b379eb7dd3103) | 1 | 167796 | 132172 | -35624 |
| timeoutApproval:claim | [0x43f58da0a80b4bcdf2652be2375ce7513863270c085b74a0810301bd4e96c7c9](https://testnet.arcscan.app/tx/0x43f58da0a80b4bcdf2652be2375ce7513863270c085b74a0810301bd4e96c7c9) | 1 | 83056 | 77448 | -5608 |
| timeoutDispute:claim | [0x1b0aa10c181183c56be7e46d570062139f439a80b1395a569f31d973d771d481](https://testnet.arcscan.app/tx/0x1b0aa10c181183c56be7e46d570062139f439a80b1395a569f31d973d771d481) | 1 | 100317 | 90265 | -10052 |

## Expected reverts

| Check | RPC method | Block | Timestamp | Observed |
| --- | --- | ---: | ---: | --- |
| approval-before-deadline | eth_call | 59204371 | 1787883277 | Approval deadline not reached |
| dispute-before-deadline | eth_call | 59204983 | 1787883591 | Dispute deadline not reached |

## Terminal chain state

| Job | ID | Status enum | Reward raw |
| --- | ---: | ---: | ---: |
| happy | 1 | 4 | 5000000 |
| donation | 2 | 4 | 5000000 |
| timeoutDelivery | 3 | 6 | 5000000 |
| timeoutApproval | 4 | 7 | 5000000 |
| timeoutDispute | 5 | 8 | 5000000 |

- Slash sink: **100.0 USDC**
- Reputation fee sink: **0.5 USDC**
- Contract ERC-20 balance: **105.5 USDC** = 100 slashed stake + 5 donation + 0.5 reputation fee.
- Agent: registered=`false`, stake=`0.0`, global reputation all zero, category reputation=`0`.
- Jobs: `getJobsPaged(0,10)` returned 5; total 5.
- Final deployer balance: native **18.138671603524919144**, ERC-20 **18.138671**.
- Final agent balance: native **17.958442565**, ERC-20 **17.958442**.

## Scope limits

- Circle blocklist behavior: **NOT_VERIFIED**.
- Epoch re-registration after slash: **LOCAL_ONLY**; it was not run live because it requires another irreversible 100 USDC stake.
- The donation scenario proves internal accounting is independent of unsolicited ERC-20 balance, not Circle blocklist behavior.
- This run does not authorize or perform a production deployment, frontend address change, Vercel deployment, or push.

