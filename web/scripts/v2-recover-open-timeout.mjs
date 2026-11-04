// Read-only recovery of a real UI-broadcast open-timeout transaction.
// Restore its pending identity after the ephemeral test browser was closed;
// never replay the claim or synthesize a receipt/readback response.
import assert from 'node:assert/strict';
import { decodeFunctionData, keccak256 } from 'viem';
import manifestAbi from '../lib/v2/action-manifest.json' with { type: 'json' };
import { storageKey } from '../lib/v2/new-wallet-execution.mjs';
import { EdgeAcceptance, until } from './v2-edge-driver.mjs';
const run = await new EdgeAcceptance().start();
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let gate;
try {
  const flow = 'timeout-claimOpenJobTimeout', action = 'claimOpenJobTimeout';
  assert.equal(run.steps.some(s => s.flow === flow && s.action === action && s.passed), false, 'Already recovered; do not replay');
  const failed = run.steps.find(s => s.flow === flow && s.action === action && s.hashes?.length === 1);
  assert.ok(failed?.intentId);
  const hash = failed.hashes[0];
  const transaction = await run.rpc('eth_getTransactionByHash', [hash]);
  const receipt = await run.rpc('eth_getTransactionReceipt', [hash]);
  assert.equal(receipt.status, '0x1');
  assert.equal(transaction.to.toLowerCase(), run.manifest.pair.market.toLowerCase());
  assert.equal(transaction.from.toLowerCase(), run.manifest.roles.client.toLowerCase());
  assert.equal(BigInt(transaction.chainId), 31337n);
  const decoded = decodeFunctionData({ abi: manifestAbi.contracts.marketplace.abi, data: transaction.input });
  assert.equal(decoded.functionName, action);
  const page = await run.login('client');
  let attempts = 0;
  await page.context().route(run.manifest.rpcUrl, async route => {
    const method = route.request().postDataJSON()?.method;
    if (method === 'eth_sendTransaction' || method === 'eth_sendRawTransaction') { attempts++; return route.abort(); }
    return route.fallback();
  });
  const profileResponse = await page.request.get(run.origin + '/api/v2/profile');
  const profile = (await profileResponse.json()).profile;
  const jobResponse = await page.request.get(run.origin + '/api/v2/jobs/' + decoded.args[0]);
  const job = (await jobResponse.json()).data;
  assert.equal(job.status, '7');
  // Expected transition is derived independently from the original calldata
  // and immutable job parties, not from a mocked canonical response.
  const expected = { action, jobId: String(decoded.args[0]), stateVersion: String(decoded.args[1] + 1n), status: 7, client: job.client, operator: null, resolver: job.resolver };
  const stored = { intentId: failed.intentId, profileId: profile.id || profile.name, chainId: '31337', wallet: transaction.from, action, kind: 'main', status: 'broadcast', hash, to: transaction.to, calldataHash: keccak256(transaction.input), expected, autoResume: true, resumeAttempts: 0 };
  const nonceBefore = await run.rpc('eth_getTransactionCount', [transaction.from, 'pending']);
  const broadcastBefore = run.broadcasts.length;
  gate = { action, intentId: failed.intentId, expected, hashes: new Set([hash.toLowerCase()]), releaseReceipt: deferred(), releaseReadback: deferred(), receiptSeen: false, readbackSeen: false };
  run.gate = gate;
  await page.evaluate(({key, value}) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey(stored), value: stored });
  await page.goto(run.origin + '/v2/jobs/' + decoded.args[0], { waitUntil: 'domcontentloaded' });
  await until(() => gate.receiptSeen, 'open-timeout-resume:real-receipt');
  assert.equal(await page.getByTestId('v2-tx-success').count(), 0);
  gate.releaseReceipt.resolve();
  await until(() => gate.readbackSeen || gate.apiFailure, 'open-timeout-resume:canonical-readback');
  assert.equal(gate.apiFailure, undefined);
  assert.equal(await page.getByTestId('v2-tx-success').count(), 0);
  gate.releaseReadback.resolve();
  await page.getByTestId('v2-tx-success').first().waitFor({ state: 'visible', timeout: 90000 });
  assert.equal(await run.rpc('eth_getTransactionCount', [transaction.from, 'pending']), nonceBefore);
  assert.equal(run.broadcasts.length, broadcastBefore);
  assert.equal(attempts, 0);
  assert.equal(gate.readback.state.operator, null);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey(stored)), null);
  run.steps.push({ flow, action, passed: true, hash, blockHash: receipt.blockHash, blockNumber: String(BigInt(receipt.blockNumber)), receiptStatus: 'success', state: gate.readback.state, originalBroadcastCount: 1, broadcastCount: 0, resumeSentTransactions: 0, successAbsentBeforeReceipt: true, successAbsentBeforeReadback: true, uiConfirmationVisible: true, recoverySetup: 'Restored the original pending intent identity after ephemeral test-context teardown; real original transaction, receipt and canonical readback only' });
  run.save();
  console.log('OPEN_TIMEOUT_UI_RECOVERED_ORIGINAL_HASH_NO_RESEND', hash);
} finally {
  gate?.releaseReceipt.resolve(); gate?.releaseReadback.resolve(); run.gate = undefined;
  await run.close();
}
