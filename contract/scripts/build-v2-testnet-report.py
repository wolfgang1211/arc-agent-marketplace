"""Render a public testnet report from actual, independently checked evidence."""
from decimal import Decimal
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
d = json.loads((ROOT / 'docs/v2-testnet-deployment.json').read_text())
assert d['independentReadback']['passed'] is True
assert d['independentReadback']['wholeRunConservation']['passed'] is True
fmt = lambda value, decimals=18: format(Decimal(value) / Decimal(10 ** decimals), 'f')
r = ['# AlphaBoard V2 Arc Testnet deployment report', '', f"Readback: {d['independentReadback']['checkedAt']}; block {d['independentReadback']['blockNumber']}.", '', 'This is a snapshot. The timeout is genuinely pending; scheduled completion updates the canonical deployment JSON.', '', '## Contracts', '']
for key in ['marketplace', 'vault']:
    v = d['explorerVerification'][key]
    r += [f"- {key}: `{d['pair'][key]}`", f"  https://explorer.testnet.arc.io/address/{d['pair'][key]}", f"  Explorer verified: {v['verified']}; compiler {v['compilerVersion']}; optimizer runs {v['optimizationRuns']}; EVM {v['evmVersion']}."]
r += ['', f"Owner: `{d['owner']['address']}`; Ownable2Step accepted and independently read back.", '', 'Immutable-aware runtime and constructor inputs match canonical artifacts. USDC is `0x3600000000000000000000000000000000000000`, decimals 6. Fee 500 bps; minReward 1 USDC.', '', '## Deployment transactions', '']
for label in ['deploy-vault', 'deploy-market', 'transfer-owner', 'accept-owner']:
    t = d['transactions'][label]
    r += [f"- {label}: `{t['hash']}`; gas {t['gasUsed']}; successful receipt block {t['blockNumber']}."]
r += ['', '## Funding and remaining balances', '', '| Role | Sent USDC | Remaining native USDC | Funding transaction |', '|---|---:|---:|---|']
for role, b in d['balances']['roles'].items():
    t = d['transactions'].get('fund-' + role)
    r.append(f"| {role} | {fmt(t['value']) if t else '0'} | {fmt(b['nativeRaw'])} | `{t['hash']}` |" if t else f"| {role} | 0 | {fmt(b['nativeRaw'])} | No distribution |")
r += ['', 'Native USDC and ERC-20 USDC are views of the same asset, not additive balances. The deployer reserve remains in place. House balance was neither funded nor swept. Yusuf manual-client wallet was not used.', '', '## Scenario table', '', '| Scenario | Job | Result | Transactions | Conservation after scenario (USDC) |', '|---|---|---|---|---|']
for name, s in d['scenarios'].items():
    ts = [f"{k}: `{v['hash']}`" for k, v in d['transactions'].items() if k.startswith('scenario-' + name + '-')]
    a = s['accounting']
    equation = f"Market {fmt(a['marketBalance'],6)} = escrow {fmt(a['escrowed'],6)} + credit {fmt(a['creditsLiability'],6)}; vault {fmt(a['vaultBalance'],6)} = free {fmt(a['freeStake'],6)} + reserved {fmt(a['reservedStake'],6)}; active jobs {a['activeJobs']}"
    r.append(f"| {name} | {s['jobId']} | {s['status']} | {'<br>'.join(ts)} | {equation} |")
r += ['| House test | Not created | Deferred to V2 bot integration | No transaction; house key was not accessed/copied | Not applicable |', '', '## Timer and safety boundary', '', f"Cron `{d['scheduledCompletion']['jobId']}`: `{d['scheduledCompletion']['runAt']}`, one shot, no-agent, local output only.", f"Script: `{d['scheduledCompletion']['script']}`. Executor hashes are pinned; only the timeout claim, full collateral slash and client credit withdrawal may be new transactions. No automatic retry on failure. Future execution must independently verify receipts/conservation and commit only the deployment JSON.", '', '## Gas and whole-run conservation', '', f"Successful transactions: {len(d['transactions'])}; total gas {d['totalGas']}; actual gas cost {fmt(d['totalGasCostRaw'])} USDC."]
w = d['independentReadback']['wholeRunConservation']
r += [f"Initial underlying USDC {fmt(w['initialNativeRaw'])} = final wallets plus contracts {fmt(w['finalNativeRaw'])} + gas {fmt(w['gasCostRaw'])}. No duplicated native/ERC-20 assets.", '', 'No push, mainnet action, frontend/env/hosting change or V1 bot change was made.', '', 'Canonical evidence with every receipt: `contract/docs/v2-testnet-deployment.json`.']
output = ROOT / 'docs/v2-testnet-deployment-report.md'
output.write_text('\n'.join(r) + '\n', encoding='utf-8')
print(json.dumps({'path': str(output), 'receiptCount': len(d['transactions']), 'scenarios': {k:v['status'] for k,v in d['scenarios'].items()}, 'gasUsed':d['totalGas'], 'gasCostUSDC':fmt(d['totalGasCostRaw'])}))
