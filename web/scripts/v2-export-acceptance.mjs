// Read-only independent re-verification and public evidence export.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFunctionData, formatUnits, keccak256 } from 'viem';
import abiManifest from '../lib/v2/action-manifest.json' with { type: 'json' };
const stateDir = process.env.V2_LOCAL_UI_STATE;
assert.ok(stateDir, 'V2_LOCAL_UI_STATE is required');
const manifest = JSON.parse(await fs.readFile(path.join(stateDir, 'manifest.json'), 'utf8'));
const ledger = JSON.parse(await fs.readFile(path.join(stateDir, 'edge-acceptance.json'), 'utf8'));
assert.equal(String(manifest.chainId), '31337');
assert.equal(manifest.rpcUrl, 'http://127.0.0.1:8545');
assert.equal(ledger.anchorBlock.hash, manifest.anchorBlock.hash);
async function rpc(method, params = []) {
  assert.ok(['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getCode', 'eth_call'].includes(method));
  const response = await fetch(manifest.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json(); assert.equal(body.error, undefined); return body.result;
}
assert.equal(BigInt(await rpc('eth_chainId')), 31337n);
const anchor = await rpc('eth_getBlockByNumber', [`0x${BigInt(manifest.anchorBlock.number).toString(16)}`, false]);
assert.equal(anchor.hash, manifest.anchorBlock.hash);
for (const item of Object.values(manifest.runtime)) {
  const code = await rpc('eth_getCode', [item.address, 'latest']);
  assert.equal(keccak256(code).toLowerCase(), item.rawHash.toLowerCase());
}
const decimals = Number(BigInt(await rpc('eth_call', [{ to: manifest.pair.token, data: '0x313ce567' }, 'latest'])));
assert.equal(decimals, 6);
const approvalAbi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }];
const transactions = [];
assert.equal(new Set(ledger.broadcasts.map(b => b.hash.toLowerCase())).size, ledger.broadcasts.length);
for (const sent of ledger.broadcasts) {
  const tx = await rpc('eth_getTransactionByHash', [sent.hash]);
  const receipt = await rpc('eth_getTransactionReceipt', [sent.hash]);
  const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
  assert.equal(receipt.status, '0x1'); assert.equal(receipt.transactionHash.toLowerCase(), sent.hash.toLowerCase());
  assert.equal(tx.hash.toLowerCase(), sent.hash.toLowerCase()); assert.equal(tx.blockHash, receipt.blockHash); assert.equal(block.hash, receipt.blockHash);
  assert.equal(BigInt(tx.chainId), 31337n); assert.equal(BigInt(tx.value), 0n);
  assert.equal(tx.from.toLowerCase(), manifest.roles[sent.role].toLowerCase()); assert.equal(tx.to.toLowerCase(), sent.to.toLowerCase());
  const tokenApproval = tx.to.toLowerCase() === manifest.pair.token.toLowerCase();
  const target = tokenApproval ? 'token' : tx.to.toLowerCase() === manifest.pair.market.toLowerCase() ? 'marketplace' : tx.to.toLowerCase() === manifest.pair.vault.toLowerCase() ? 'vault' : null;
  assert.ok(target);
  const decoded = decodeFunctionData({ abi: tokenApproval ? approvalAbi : abiManifest.contracts[target].abi, data: tx.input });
  const record = { hash: tx.hash, from: tx.from, to: tx.to, role: sent.role, function: decoded.functionName, chainId: '31337', value: '0', calldataHash: keccak256(tx.input), receiptStatus: 'success', blockNumber: String(BigInt(receipt.blockNumber)), blockHash: receipt.blockHash, canonicalBlockVerified: true, gasUsed: String(BigInt(receipt.gasUsed)) };
  if (tokenApproval) {
    assert.ok([manifest.pair.market, manifest.pair.vault].some(address => address.toLowerCase() === decoded.args[0].toLowerCase()));
    assert.ok(decoded.args[1] > 0n && decoded.args[1] < (1n << 256n) - 1n);
    record.approval = { spender: decoded.args[0], amountBaseUnits: String(decoded.args[1]), amountUSDC: formatUnits(decoded.args[1], decimals), unlimited: false };
  }
  transactions.push(record);
}
for (let index = 0; index < transactions.length; index++) {
  const approval = transactions[index]; if (!approval.approval) continue;
  const following = transactions.slice(index + 1).find(tx => tx.from.toLowerCase() === approval.from.toLowerCase() && tx.to.toLowerCase() === approval.approval.spender.toLowerCase());
  assert.ok(following && ['postJob', 'depositStake'].includes(following.function));
  const raw = await rpc('eth_getTransactionByHash', [following.hash]);
  const target = following.function === 'postJob' ? 'marketplace' : 'vault';
  const decoded = decodeFunctionData({ abi: abiManifest.contracts[target].abi, data: raw.input });
  assert.equal(String(decoded.args[0]), approval.approval.amountBaseUnits);
  approval.approval.boundAction = following.function; approval.approval.boundTransaction = following.hash;
}
const stepFields = ['flow','action','scenario','passed','hash','blockNumber','blockHash','receiptStatus','state','broadcastCount','originalBroadcastCount','resumeSentTransactions','nonceBefore','nonceAfter','timeoutObserved','disconnectObserved','successAbsentBeforeReceipt','successAbsentBeforeReadback','uiConfirmationVisible','recoverySetup','evidence','deadline','targetTimestamp','actionAbsentBeforeDeadline'];
const steps = ledger.steps.filter(s => s.passed).map(s => Object.fromEntries(stepFields.filter(k => s[k] !== undefined).map(k => [k,s[k]])));
for (const step of steps.filter(s => s.hash)) assert.ok(transactions.some(tx => tx.hash.toLowerCase() === step.hash.toLowerCase()));
const finalFlows = [['main','postJob'],['main','apply'],['main','awardJob'],['main','submitDelivery'],['main','requestRevision'],['main','submitRevision'],['main','approve'],['main','withdrawCredit'],['mutual','proposeMutual'],['mutual','acceptMutual'],['dispute','openDispute'],['dispute','resolveDispute'],['stake','depositStake'],['stake','withdrawStake'],['timeout-claimDeliveryTimeout','claimDeliveryTimeout'],['timeout-claimOpenJobTimeout','claimOpenJobTimeout'],...['reload','disconnect','timeout'].map(s => ['recovery-confirmed-'+s,'withdrawStake'])];
for (const [flow, action] of finalFlows) assert.ok(steps.some(s => s.flow === flow && s.action === action), `${flow}/${action}`);
for (const step of steps.filter(s => s.flow.startsWith('recovery-confirmed-'))) { assert.equal(step.broadcastCount, 1); assert.equal(step.resumeSentTransactions, 0); assert.equal(step.uiConfirmationVisible, true); }
const latestJobs = [];
for (const id of [1,2,3,4,5,6,7,8]) {
  const response = await fetch(`http://127.0.0.1:3104/api/v2/jobs/${id}`); assert.equal(response.status, 200); const {data} = await response.json();
  latestJobs.push(Object.fromEntries(['jobId','status','stateVersion','client','operator','resolver','sourceBlock','sourceHash'].map(k => [k,data[k]])));
}
const latest = await rpc('eth_getBlockByNumber', ['latest', false]);
const output = { evidence: 'Actual headless Edge + injected local EIP-1193 + real loopback EVM + server reader/indexer. Not a wallet extension or public-chain acceptance.', capturedAt: new Date().toISOString(), chainId: '31337', anchorBlock: manifest.anchorBlock, latestBlock: { number: String(BigInt(latest.number)), hash: latest.hash }, runtime: manifest.runtime, transactions, steps, requiredStepCount: finalFlows.length, failedAttempts: ledger.steps.filter(s => s.passed === false).map(s => ({ flow:s.flow, action:s.action, broadcastCount:s.broadcastCount, hashes:s.hashes || [], safeApiFailure:s.apiFailure || null })), historicalRecoveryNote: 'Original recovery-* rows prove negative safety but did not display positive success. Fresh recovery-confirmed-* rows verify the repaired visible success. Open-timeout used read-only recovery of the original broadcast; it was never resent.', latestJobs, screenshotsNote: 'Screenshots captured all seven seeded lifecycle states before mutual/dispute/timeout acceptance changed those jobs. Local EVM time was advanced only for timeout tests.' };
const destination = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../contract/docs/v2-browser-acceptance.json');
await fs.writeFile(destination, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ verifiedTransactions: transactions.length, requiredSteps: finalFlows.length, approvals: transactions.filter(t => t.approval).map(t => t.approval), destination }));
