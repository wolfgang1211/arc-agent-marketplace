"""Calculate testnet funding from observed local gas and read-only Arc fee data."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
evidence = json.loads((ROOT / 'docs/v2-testnet-local-evidence.json').read_text())
rpc = json.loads((ROOT / 'docs/v2-testnet-readonly-preflight.json').read_text())
assert evidence['status'] == 'passed' and len(evidence['scenarios']) == 6
cap = int(rpc['feeQuote']['planningCapWei'])
principals = {'deployer': 0, 'owner': 0, 'treasury': 0, 'resolver': 0, 'testOperator': 15, 'testClient2': 5, 'house': 5, 'testClient': 1}
extra = {'deployer': 126000, 'owner': 100000, 'treasury': 0, 'resolver': 100000, 'testOperator': 100000, 'testClient2': 100000, 'house': 200000, 'testClient': 0}
rows = []
for role, principal in principals.items():
    gas = int(evidence['gasByRole'][role])
    # ceil to one cent after 20% reserve; one cent is 10**16 native units.
    numerator = (gas + extra[role]) * cap * 120
    gas_cents = (numerator + 100 * 10**16 - 1) // (100 * 10**16)
    required = principal * 10**18 + gas_cents * 10**16
    current = int(rpc['roles'][role]['nativeRaw'])
    delta = max(0, required - current)
    fmt = lambda value: f'{value // 10**18}.{value % 10**18:018d}'.rstrip('0').rstrip('.')
    rows.append({'role': role, 'address': rpc['roles'][role]['address'], 'observedGas': gas, 'additionalPlanningGas': extra[role], 'principalUSDC': str(principal), 'gasReserveUSDC': f'{gas_cents // 100}.{gas_cents % 100:02d}', 'requiredUSDC': fmt(required), 'requiredRawNative': str(required), 'observedBalanceUSDC': fmt(current), 'topUpUSDC': fmt(delta), 'topUpRawNative': str(delta)})
new_roles = [row for row in rows if row['role'] not in ('house',)]
new_total = sum(int(row['requiredRawNative']) for row in new_roles)
all_delta = sum(int(row['topUpRawNative']) for row in rows)
recommended = ((all_delta + 5 * 10**18 - 1) // (5 * 10**18)) * 5 * 10**18
result = {'model': 'observed local receipt gas plus explicit unmeasured-operation allowance, 45-gwei current planning cap and 20% reserve; rounded up to cents per wallet', 'planningCapWeiPerGas': str(cap), 'feeSnapshot': rpc['timestamp'], 'sourceReceiptCount': len(evidence['receipts']), 'observedTotalGas': sum(int(v) for v in evidence['gasByRole'].values()), 'additionalGasIsAnEstimate': True, 'rows': rows, 'newWalletFundingUSDC': fmt(new_total), 'allWalletTopUpUSDC': fmt(all_delta), 'recommendedFaucetUSDC': fmt(recommended), 'roundingPolicy': 'upward to a multiple of 5 USDC', 'nativeAndErc20BalanceAreNotAdded': True, 'ordering': 'Incoming faucet -> nonce-zero pair deployment -> verify immutable pair -> separately approved funding distribution -> owner acceptance/scenarios -> deployer remainder to owner after gas reserve', 'caveats': ['This is a local gas estimate, not an Arc execution quote.', 'No ERC-20 mock deployment cost is included because Arc USDC already exists.', 'Five funding transfers and one deployer recovery transfer are budgeted at 21000 gas each, not measured by the local receipt list.', 'House EOA signing requires Yusuf; local house simulation is ERC-1271.', 'Existing house/manualClient balances remain theirs and will not be swept or redistributed automatically.', 'Fee data must be refreshed before separately approved chain activity.']}
(ROOT / 'docs/v2-testnet-funding-plan.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
