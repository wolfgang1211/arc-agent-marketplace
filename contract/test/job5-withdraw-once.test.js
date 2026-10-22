'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { keccak256 } = require('ethers');
const {
  CHAIN_ID, MARKET, CLIENT, CREDIT, GAS_LIMIT, GAS_PRICE, withdrawData, dataHash,
  attestCanonical, validateSnapshot, makeIntent, createAttemptStore, executeJob5WithdrawOnce
} = require('../scripts/job5-withdraw-once');

function tempStore() { return createAttemptStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'job5-')), 'attempt.json')); }
function snap(overrides = {}) { return { chainId: CHAIN_ID, latestNonce: 0, pendingNonce: 0, credit: CREDIT, from: CLIENT, blockNumber: 100, job: { status: 'Refunded', reserved: 0 }, ...overrides }; }
function deps({ reader = async () => snap(), estimate = 21000n, send, sign = async () => '0x1234' } = {}) {
  const calls = { estimate: 0, send: 0, sign: 0 };
  return { calls, provider: { estimateGas: async () => { calls.estimate++; return estimate; }, getFeeData: async () => ({ gasPrice: 30_000_000_000n }), getBalance: async () => 10n ** 20n, send: async (...args) => { calls.send++; return (send || (async () => keccak256('0x1234')))(...args); } }, signer: { getAddress: async () => CLIENT, signTransaction: async tx => { calls.sign++; return sign(tx); } }, reader };
}

test('canonical attestation is exact and rejects wrong chain/address', () => {
  assert.equal(attestCanonical({ chainId: 5042002, rpc: 'https://rpc.testnet.arc.io', market: MARKET, vault: '0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423', token: '0x3600000000000000000000000000000000000000', client: CLIENT }).decimals, 6);
  assert.throws(() => attestCanonical({ chainId: 1, rpc: 'https://rpc.testnet.arc.io', market: MARKET, vault: MARKET, token: MARKET, client: CLIENT }), /CHAIN_ID_MISMATCH/);
});
test('withdraw calldata is exact zero-argument selector', () => assert.equal(withdrawData.length, 10));
test('wrong credit, pending nonce, and wrong chain all stop before send', async () => {
  for (const bad of [{ credit: 0 }, { pendingNonce: 1 }, { chainId: 1 }]) {
    const d = deps({ reader: async () => snap(bad) });
    await assert.rejects(executeJob5WithdrawOnce({ ...d, store: tempStore(), waitReceipt: false }), /CREDIT_NOT_EXACT|PENDING_NONCE_NOT_LATEST|CHAIN_ID_MISMATCH/);
    assert.equal(d.calls.send, 0); assert.equal(d.calls.sign, 0);
  }
});
test('arms and persists intent before signing or broadcasting', async () => {
  const store = tempStore(); const d = deps({ send: async () => { assert.equal(JSON.parse(fs.readFileSync(store.file)).status, 'broadcast-intent'); return keccak256('0x1234'); } });
  const out = await executeJob5WithdrawOnce({ ...d, store, waitReceipt: false });
  assert.equal(out.status, 'broadcast'); assert.equal(d.calls.sign, 1); assert.equal(d.calls.send, 1);
  const saved = JSON.parse(fs.readFileSync(store.file)); assert.equal(saved.intent.dataHash, dataHash); assert.equal(saved.intent.value, '0');
});
test('duplicate attempt is consumed even when first estimate fails', async () => {
  const store = tempStore(); const d = deps({ estimate: 500001n });
  await assert.rejects(executeJob5WithdrawOnce({ ...d, store, waitReceipt: false }), /GAS_LIMIT_EXCEEDED/);
  await assert.rejects(executeJob5WithdrawOnce({ ...deps(), store, waitReceipt: false }), /ATTEMPT_ALREADY_CONSUMED/);
});
test('nonce drift after arm stops without signing', async () => {
  let n = 0; const d = deps({ reader: async () => snap({ latestNonce: n++, pendingNonce: n - 1 }) });
  await assert.rejects(executeJob5WithdrawOnce({ ...d, store: tempStore(), waitReceipt: false }), /NONCE_CHANGED/);
  assert.equal(d.calls.send, 0); assert.equal(d.calls.sign, 0);
});
test('broadcast is called at most once when provider rejects', async () => {
  const d = deps({ send: async () => { throw new Error('transport'); } });
  await assert.rejects(executeJob5WithdrawOnce({ ...d, store: tempStore(), waitReceipt: false }), /EXECUTION_STOPPED/);
  assert.equal(d.calls.send, 1); assert.equal(d.calls.sign, 1);
});
test('readonly mode arms no signer and makes no broadcast', async () => {
  const store = tempStore(); const d = deps(); const out = await executeJob5WithdrawOnce({ ...d, store, dryRun: true });
  assert.equal(out.status, 'readonly-preflight'); assert.equal(d.calls.sign, 0); assert.equal(d.calls.send, 0); assert.equal(fs.existsSync(store.file), false);
});
test('gas cap and legacy transaction fields are bounded', async () => {
  let observed; const d = deps({ sign: async tx => { observed = tx; return '0x1234'; } });
  await executeJob5WithdrawOnce({ ...d, store: tempStore(), waitReceipt: false });
  assert.equal(observed.type, 0); assert.equal(observed.chainId, Number(CHAIN_ID)); assert.equal(observed.to, MARKET); assert.equal(observed.gasLimit, 25200n);  assert.equal(observed.gasPrice, 30_000_000_000n); assert.equal(observed.value, 0n); assert.equal(observed.data, withdrawData);
});
test('malformed signer address fails closed', async () => {
  const d = deps({ reader: async () => snap({ from: 'not-an-address' }) });
  await assert.rejects(executeJob5WithdrawOnce({ ...d, store: tempStore(), waitReceipt: false }), /SIGNER_ADDRESS_MISMATCH|ADDRESS_INVALID/);
  assert.equal(d.calls.send, 0);
});
test('all exported snapshot checks reject non-refunded or reserved jobs', () => {
  assert.throws(() => validateSnapshot(snap({ job: { status: 'InProgress', reserved: 1 } })), /JOB_NOT_REFUNDED/);
  assert.equal(makeIntent({ nonce: 0, from: CLIENT, blockNumber: 1 }).to, MARKET);
});

function confirmedDeps(altered = {}) {
  const { Interface } = require('ethers');
  const { TOKEN } = require('../scripts/job5-withdraw-once');
  const gasUsed = 21000n, gasPrice = 30_000_000_000n, gas = gasUsed * gasPrice;
  const before = { native:10n**19n, erc20:10000000n, marketBalance:CREDIT, escrowed:0n, creditsLiability:CREDIT, vaultBalance:5000000n, freeStake:5000000n, reservedStake:0n, stakeLiability:5000000n, activeJobs:0n };
  const after = { ...before, native:before.native+6n*10n**18n-gas, marketBalance:0n, creditsLiability:0n, ...altered };
  const event = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
  const log = event.encodeEventLog(event.getEvent('Transfer'), [MARKET, CLIENT, CREDIT]);
  const d = deps({reader:async tag => snap(tag === undefined ? {balances:before} : {credit:0n, balances:after, blockNumber:101, latestNonce:1, pendingNonce:1})});
  d.provider.getTransactionReceipt = async () => ({status:1, blockNumber:101, gasUsed, effectiveGasPrice:gasPrice, logs:[{address:TOKEN, ...log}]});
  d.provider.getTransaction = async () => ({from:CLIENT, to:MARKET, chainId:CHAIN_ID, nonce:0, data:withdrawData, value:0n});
  return d;
}

test('confirmed withdrawal verifies zero credit, gross transfer and native gas equation', async () => {
  const d = confirmedDeps(), store = tempStore();
  const out = await executeJob5WithdrawOnce({...d, store});
  assert.equal(out.status, 'confirmed');
  assert.equal(out.verification.post.credit, 0n);
  assert.equal(JSON.parse(fs.readFileSync(store.file)).verification.conservation, true);
  assert.equal(d.calls.send, 1);
});

test('confirmed withdrawal rejects a changed but internally solvent vault', async () => {
  const d = confirmedDeps({vaultBalance:4000000n, freeStake:4000000n, stakeLiability:4000000n});
  await assert.rejects(executeJob5WithdrawOnce({...d, store:tempStore()}), /VAULT_POSTCONDITION_FAILED/);
  assert.equal(d.calls.send, 1);
});

test('confirmed withdrawal rejects nonzero active jobs without resending', async () => {
  const d = confirmedDeps({activeJobs:1n});
  await assert.rejects(executeJob5WithdrawOnce({...d, store:tempStore()}), /ACTIVE_JOBS_NONZERO/);
  assert.equal(d.calls.send, 1);
});
