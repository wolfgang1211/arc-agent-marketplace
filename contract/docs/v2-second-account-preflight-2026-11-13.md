# Second Brave account: read-only preflight

Observed: `2026-11-13T18:14:38.885Z`. Arc chain ID `5042002`, pinned block `72213798`, block hash `0x4e61fe150afd4d0657f9e90761e2284052d33eb07ebd8b79b82977b4af0968e3`.

Account exactly as supplied: `0xD632648b649bD09198047388d150fF408165CC29`. Address syntax and checksum validated. Runtime-attested `createV2ChainReader` supplied canonical account/policy reads; the block hash and chain were checked again after the read sequence. Only read-only public RPC methods were available; no wallet, key, signature, funding or transaction submission was used.

| Check | Observed result |
|---|---|
| ERC-20 USDC | `20000000` raw, **20 USDC** |
| Native USDC | `20000000000000000000` raw, **20 USDC** |
| Registered operator | **false** |
| Free / reserved stake | **0 / 0 USDC** |
| Active jobs / maxActiveJobs | **0 / 0** |
| Client collision | None; client `0x460EBe282Fb0e42B4d682a7f9EF408302417F780` |
| Owner collision | None; owner `0xf5e14962e46F80fAA40570bD86BccE83AA6626fF` |
| Effective resolver collision | None; canonical policy is zero so owner fallback applies |
| registerOperator gas estimate | `45293` units, simulation only |

Native and ERC-20 displays represent the same underlying USDC, **not 40 USDC**. Gas price observed: `25000000000` wei. Declared conservative operational estimate: 12 operator transactions at 1,000,000 gas each, priced at twice that observed gas price = **0.6 USDC** reserve. With **5 USDC** still to deposit, the funding threshold was **5.6 USDC**, covered by 20. This is a gas-budget estimate, not a guarantee for future prices or arbitrary M3–M7 actions; every wallet preview remains authoritative before approval.

Independent health recheck at `2026-11-13T18:14:57.503Z`: healthy, stale false, gap null, lag 0, cursor/head/safeHead `72213826`.

## M3 decision and M4 prerequisites

Yusuf explicitly approved M3 conditional on a clean read-only preflight. Funding and role-separation gates passed and reader was fresh: **M3'e başlayabilirsin.** Operator registration and stake are deliberately manual M4 setup steps, not already completed: before M4 application/award, Yusuf must use this second Brave account to register and deposit 5 USDC, confirm capacity and read back the results. Do not treat the funding check as registration/stake completion or permission for Hermes to send.

All account signatures and funding belong to Yusuf. Hermes only verifies subsequent user-requested results from indexer/DB/chain. Each M8 decision requires a separate exact preview followed by current chat approval; the shelved live signer remains closed.
