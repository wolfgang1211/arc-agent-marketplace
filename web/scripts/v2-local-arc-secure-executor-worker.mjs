import { loadRuntimeWallet } from '../../contract/scripts/keystore/v2-keystore-worker.js';
import { recoverTypedDataAddress } from 'viem';
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';
import { executeCounterpartyOperation } from './v2-local-arc-counterparty.mjs';
import { createArcApiClient } from './v2-local-arc-counterparty-helper.mjs';

const MAX_INPUT = 128 * 1024;
const ACCOUNT_ACTIONS = new Set(['depositStake', 'withdrawStake', 'withdrawCredit']);
const STATE_TRANSITIONS = new Set(['submitDelivery', 'submitRevision', 'acceptMutual', 'openDispute', 'resolveDispute', 'resolveFaultReview']);
const readInput = async () => { let value = ''; for await (const chunk of process.stdin) { value += chunk; if (value.length > MAX_INPUT) throw new Error('INPUT_TOO_LARGE'); } return JSON.parse(value); };
const rpcClient = (url) => {
  if (url !== ARC_TESTNET_PROFILE.rpcUrl) throw new Error('RPC_URL_INVALID');
  let id = 0;
  const call = async (method, params = []) => { const requestId = ++id; const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: AbortSignal.timeout(5000), cache: 'no-store' }); const b = await r.json(); if (!r.ok || b.jsonrpc !== '2.0' || b.id !== requestId || b.error || !Object.hasOwn(b, 'result')) throw new Error('RPC_FAILED'); return b.result; };
  return { simulate: async ({ plan }) => call('eth_call', [{ from: plan.from, to: plan.target, data: plan.data, value: '0x0' }, 'latest']), populateTransaction: async ({ plan }) => { const [chainId, nonce, gas, fee] = await Promise.all([call('eth_chainId'), call('eth_getTransactionCount', [plan.from, 'pending']), call('eth_estimateGas', [{ from: plan.from, to: plan.target, data: plan.data, value: '0x0' }]), call('eth_gasPrice')]); return { chainId: String(BigInt(chainId)), to: plan.target, data: plan.data, value: '0', nonce: Number(BigInt(nonce)), gasLimit: gas, gasPrice: fee }; }, sendRawTransaction: (raw) => call('eth_sendRawTransaction', [raw]), receipt: async (hash) => { for (let i = 0; i < 60; i++) { const r = await call('eth_getTransactionReceipt', [hash]); if (r) { const chainId = await call('eth_chainId'); return { transactionHash: r.transactionHash, status: r.status, to: r.to, from: r.from, blockNumber: r.blockNumber, blockHash: r.blockHash, chainId: BigInt(chainId).toString() }; } await new Promise((resolve) => setTimeout(resolve, 1000)); } throw new Error('RECEIPT_TIMEOUT'); } };
};
const main = async () => {
  // Defense in depth: the unaccepted bridge must not decrypt even if invoked directly.
  throw new Error('LIVE_EXECUTION_NOT_ACCEPTED');
  const input = await readInput();
  if (!input || input.op !== 'execute' || !['testOperator', 'owner'].includes(input.role) || typeof input.password !== 'string') throw new Error('INVALID_WORKER_REQUEST');
  const wallet = await loadRuntimeWallet({ op: 'decrypt', role: input.role, password: input.password }); input.password = '';
  const api = createArcApiClient({ baseUrl: input.baseUrl, origin: input.origin, fetchImpl: fetch });
  const signer = {
    address: wallet.address,
    signMessage: (message) => wallet.signMessage(message),
    signApplication: ({ domain, types, message }) => { const safeTypes = Object.fromEntries(Object.entries(types).filter(([name]) => name !== 'EIP712Domain')); return wallet.signTypedData(domain, safeTypes, message); },
    signTransaction: (plan) => wallet.signTransaction({ chainId: Number(plan.chainId), to: plan.target, data: plan.data, value: 0n, nonce: plan.nonce, gasLimit: plan.gasLimit ?? plan.gas, ...(plan.maxFeePerGas ? { maxFeePerGas: plan.maxFeePerGas, maxPriorityFeePerGas: plan.maxPriorityFeePerGas } : { gasPrice: plan.gasPrice }) }),
  };
  const rpc = rpcClient(input.rpcUrl);
  const readback = async ({ plan, action }) => { if (ACCOUNT_ACTIONS.has(action)) { if (typeof api.readAccount !== 'function') throw new Error('CANONICAL_ACCOUNT_READBACK_REQUIRED'); const data = await api.readAccount(plan.from); const account = data?.data ?? data; if (!account || account.address?.toLowerCase() !== plan.from.toLowerCase() || (!account.operator && !account.credits)) throw new Error('CANONICAL_ACCOUNT_READBACK_UNCONFIRMED'); return { confirmed: true, jobId: plan.job.jobId, stateVersion: plan.job.stateVersion, account }; } const data = await api.readJob(plan.job.jobId); const job = data?.data ?? data?.job ?? data; const expected = STATE_TRANSITIONS.has(action) ? BigInt(plan.job.stateVersion) + 1n : BigInt(plan.job.stateVersion); return { confirmed: String(job?.jobId ?? job?.id) === String(plan.job.jobId) && String(job?.stateVersion) === String(expected), jobId: job?.jobId ?? job?.id, stateVersion: job?.stateVersion }; };
  const result = await executeCounterpartyOperation(input.argv, { chatRequest: input.chatRequest, signer, api, rpc, readback, roles: input.roles });
  process.stdout.write(JSON.stringify({ ok: true, result }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
};
main().catch(() => { process.stdout.write(JSON.stringify({ ok: false, error: 'SECURE_EXECUTION_FAILED' })); process.exitCode = 1; });
