import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeErrorResult,
  decodeFunctionData,
  getAddress,
  keccak256,
} from 'viem';
import actionManifest from './action-manifest.json' with { type: 'json' };
import runtimeProof from './runtime-abi-proof.json' with { type: 'json' };
const ERROR_ABI = [...runtimeProof.contracts.marketplace.abi, ...runtimeProof.contracts.vault.abi].filter((item) => item.type === 'error');

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ERC20_ABI = [{ type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }, { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }];
const PHASES = Object.freeze(['prepared', 'checking-wallet', 'simulating', 'awaiting-wallet', 'awaiting-receipt', 'awaiting-readback', 'success', 'error']);
const SAFE_ERRORS = new Set(['wallet-rejected', 'simulation-reverted', 'receipt-reverted', 'timeout', 'stale-reader', 'readback-mismatch', 'wrong-chain', 'wrong-account', 'profile-unavailable', 'expired', 'busy', 'wallet-unavailable', 'reconciliation-required', 'broadcast-uncertain']);

const TARGET_BY_ACTION = Object.freeze({ postJob: 'marketplace', awardJob: 'marketplace', approve: 'marketplace', submitDelivery: 'marketplace', submitRevision: 'marketplace', requestRevision: 'marketplace', openDispute: 'marketplace', resolveDispute: 'marketplace', registerOperator: 'marketplace', withdrawCredit: 'marketplace', proposeMutual: 'marketplace', acceptMutual: 'marketplace', rejectMutual: 'marketplace', revokeMutual: 'marketplace', timeoutClaim: 'marketplace', claimOpenJobTimeout: 'marketplace', claimDeliveryTimeout: 'marketplace', depositStake: 'vault', withdrawStake: 'vault' });

function fail(code, message = code) { const error = new Error(message); error.code = SAFE_ERRORS.has(code) ? code : 'wallet-execution-failed'; throw error; }
function providerOf(provider = globalThis.ethereum) { if (!provider || typeof provider.request !== 'function') fail('wallet-unavailable', 'No browser wallet provider is available.'); return provider; }
function normalize(value) { return String(value ?? '').toLowerCase(); }
function ensureAddress(value, label) { if (typeof value !== 'string' || !ADDRESS.test(value)) fail('profile-unavailable', `Invalid ${label}.`); return getAddress(value); }
function canonicalAbi() { return [...(actionManifest.contracts.marketplace?.abi || []), ...(actionManifest.contracts.vault?.abi || [])]; }
function safeCustomError(error) {
  const names = new Set(ERROR_ABI.map((item) => item.name));
  const seen = new Set();
  for (let current = error, depth = 0; current && depth < 16 && !seen.has(current); current = current.cause, depth += 1) {
    seen.add(current);
    if (names.has(current.data?.errorName)) return current.data.errorName;
    for (const data of [current.data, current.data?.data, current.details]) {
      if (typeof data !== 'string' || !/^0x[0-9a-fA-F]+$/.test(data)) continue;
      try { const decoded = decodeErrorResult({ abi: ERROR_ABI, data }); if (names.has(decoded.errorName)) return decoded.errorName; } catch {}
    }
  }
  return null;
}
function actionAbi(action) { const entries = [...(actionManifest.contracts.marketplace?.abi || []), ...(actionManifest.contracts.vault?.abi || [])]; const item = entries.find((candidate) => candidate.type === 'function' && candidate.name === action); if (!item) fail('simulation-reverted', 'Unsupported wallet action.'); return item; }
function chainDefinition(profile) { return { id: Number(profile.chainId), name: profile.name || profile.id || 'V2 chain', nativeCurrency: { name: 'Native', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [profile.rpcUrl] } } }; }
function storageKey(intent) { return `v2-wallet-intent:${intent.profileId}:${intent.chainId}:${normalize(intent.wallet)}:${intent.action}:${intent.intentId}`; }
function storageAvailable() { const store = globalThis.localStorage; return Boolean(store && typeof store.setItem === 'function' && typeof store.getItem === 'function' && typeof store.removeItem === 'function'); }
function persist(intent) { if (!storageAvailable()) fail('wallet-unavailable', 'Wallet intent storage is unavailable.'); const record = { status: intent.status || 'broadcast', hash: intent.hash ?? null, intentId: intent.intentId, profileId: intent.profileId, chainId: String(intent.chainId), wallet: intent.wallet, action: intent.action, kind: intent.kind || 'main', calldataHash: intent.calldataHash ?? null, autoResume: intent.autoResume !== false, resumeAttempts: Number(intent.resumeAttempts || 0), ...(intent.spender ? { spender: intent.spender, requiredAmount: intent.requiredAmount } : {}), ...(intent.expected ? { expected: intent.expected } : {}) }; globalThis.localStorage.setItem(storageKey(intent), JSON.stringify(record)); return record; }
function clear(intent) { if (!storageAvailable()) return; globalThis.localStorage.removeItem(storageKey(intent)); }
function listIntents() { if (!storageAvailable()) return []; const found = []; for (let i = 0; i < globalThis.localStorage.length; i += 1) { const key = globalThis.localStorage.key(i); if (!key?.startsWith('v2-wallet-intent:')) continue; try { found.push(JSON.parse(globalThis.localStorage.getItem(key))); } catch { fail('reconciliation-required', 'A stored wallet intent is unreadable.'); } } return found; }
function unresolvedIntent(profile, wallet, action) { return listIntents().find((stored) => stored && stored.profileId === (profile.id || profile.name) && String(stored.chainId) === String(profile.chainId) && normalize(stored.wallet) === normalize(wallet) && stored.action === action && stored.status !== 'reconciled' && stored.status !== 'terminal'); }
function txFrom(result, wallet, profile) { const tx = result?.transaction; if (!tx || typeof tx !== 'object') return null; if (!ADDRESS.test(String(tx.to)) || typeof tx.data !== 'string' || !/^0x[0-9a-fA-F]*$/.test(tx.data)) fail('simulation-reverted', 'Prepared transaction is invalid.'); const chainId = String(tx.chainId ?? profile.chainId); if (!/^\d+$/.test(chainId) || BigInt(chainId) !== BigInt(profile.chainId)) fail('wrong-chain', 'The prepared transaction targets the wrong network.'); if (!tx.from || normalize(tx.from) !== normalize(wallet)) fail('wrong-account', 'The prepared transaction targets a different wallet.'); const target = TARGET_BY_ACTION[result.action] && profile[TARGET_BY_ACTION[result.action]]; if (!target || normalize(tx.to) !== normalize(target)) fail('simulation-reverted', 'The prepared recipient is not the canonical action target.'); const value = BigInt(String(tx.value ?? '0')); if (value !== 0n) fail('simulation-reverted', 'Wallet actions must not transfer native value.'); return { to: getAddress(tx.to), data: tx.data, value, chainId }; }
function decodedAction(result, tx) { let decoded; try { decoded = decodeFunctionData({ abi: [actionAbi(result.action)], data: tx.data }); } catch { fail('simulation-reverted', 'The prepared calldata does not match the canonical action.'); } if (decoded.functionName !== result.action) fail('simulation-reverted', 'The prepared calldata targets a different action.'); return decoded; }
function sameExpected(actual, expected) { if (!expected || typeof expected !== 'object' || !actual || typeof actual !== 'object') return false; for (const [key, value] of Object.entries(expected)) { if (value && typeof value === 'object' ? !sameExpected(actual[key], value) : normalize(actual[key]) !== normalize(value)) return false; } return true; }
function readExpiry(value) { const n = typeof value === 'number' ? value : /^\d+$/.test(String(value ?? '')) ? Number(value) : Date.parse(String(value ?? '')); if (!Number.isFinite(n) || n <= Date.now()) fail('expired', 'This prepared wallet action has expired.'); return n; }

export async function loadV2Profile() { const response = await fetch('/api/v2/profile', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } }); if (!response.ok) fail('profile-unavailable', 'The selected chain profile is unavailable.'); const body = await response.json(); const profile = body?.profile; if (!profile || (!profile.id && !profile.name) || !/^\d+$/.test(String(profile.chainId ?? profile.canonicalChainId)) || !profile.rpcUrl || !ADDRESS.test(profile.marketplace) || !ADDRESS.test(profile.vault) || !ADDRESS.test(profile.usdc)) fail('profile-unavailable', 'The selected chain profile is invalid.'); return { ...profile, id: profile.id || profile.name, chainId: String(profile.chainId ?? profile.canonicalChainId) }; }

async function readWallet(provider) { const [accounts, chainId] = await Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]); return { account: accounts?.[0], chainId: BigInt(chainId) }; }
async function pollReceipt(publicClient, hash, timeout = 120000) { const started = Date.now(); for (;;) { try { return await publicClient.getTransactionReceipt({ hash }); } catch { if (Date.now() - started >= timeout) fail('timeout', 'Timed out waiting for the wallet receipt.'); } await new Promise((resolve) => setTimeout(resolve, 250)); } }
function assertReadbackIdentity(response, intent, hash) { if (!response || response.ok !== true || response.confirmed !== true || response.intentId !== intent.intentId || response.profileId == null || String(response.profileId) !== String(intent.profileId) || response.chainId == null || String(response.chainId) !== String(intent.chainId) || !response.wallet || normalize(response.wallet) !== normalize(intent.wallet) || response.action !== intent.action || !response.hash || normalize(response.hash) !== normalize(hash)) fail('readback-mismatch', 'The canonical reader did not confirm this wallet intent.'); if (!response.state || typeof response.state !== 'object' || Array.isArray(response.state)) fail('readback-mismatch', 'The canonical reader did not return chain state.'); if (intent.expected && !sameExpected(response.state, intent.expected)) fail('readback-mismatch', 'The canonical reader did not confirm the expected state.'); return response; }
async function waitReadback({ hash, intent, readback }) { const response = await readback(hash, intent.intentId); return assertReadbackIdentity(response, intent, hash); }

export async function resumeWalletIntent({ stored, profile, readback = defaultReadback } = {}) { if (!stored?.intentId || !profile || stored.autoResume === false || stored.status === 'terminal' || stored.status === 'reconciled') return null; if ((stored.resumeAttempts || 0) >= 3) return null; const nextAttempts = Number(stored.resumeAttempts || 0) + 1; persist({ ...stored, resumeAttempts: nextAttempts, autoResume: stored.status === 'broadcast-unknown' ? false : stored.autoResume }); if (!stored.hash || stored.status === 'broadcast-unknown') fail('reconciliation-required', 'A previous wallet broadcast is unconfirmed. Reconcile it before sending another transaction.'); const provider = providerOf(); const wallet = await readWallet(provider); const chainId = BigInt(profile.chainId); if (String(stored.profileId) !== String(profile.id || profile.name) || String(stored.chainId) !== String(chainId) || normalize(wallet.account) !== normalize(stored.wallet) || wallet.chainId !== chainId) return null; const publicClient = createPublicClient({ chain: chainDefinition(profile), transport: custom(provider) }); let receipt; try { receipt = await pollReceipt(publicClient, stored.hash); } catch (error) { persist({ ...stored, status: 'awaiting-receipt', hash: stored.hash, resumeAttempts: nextAttempts }); throw error; } if (receipt.status !== 'success') { persist({ ...stored, status: 'terminal', hash: stored.hash, autoResume: false, resumeAttempts: nextAttempts }); fail('receipt-reverted', 'The pending wallet transaction reverted.'); } if (stored.kind === 'approval') { const allowance = await publicClient.readContract({ address: ensureAddress(profile.usdc, 'USDC'), abi: ERC20_ABI, functionName: 'allowance', args: [getAddress(wallet.account), getAddress(stored.spender)] }); if (BigInt(allowance) < BigInt(stored.requiredAmount)) fail('readback-mismatch', 'The allowance approval was not confirmed.'); clear(stored); return { phase: 'approval-confirmed', hash: stored.hash }; } const read = await waitReadback({ hash: stored.hash, intent: stored, readback }); clear(stored); return { phase: 'success', hash: stored.hash, readback: read }; }

export async function executeWalletAction(result, { profile, provider = globalThis.ethereum, readback = defaultReadback, onPhase } = {}) {
  if (!result?.transaction) return result;
  if (!profile) fail('profile-unavailable', 'The chain profile is unavailable; wallet actions are disabled.');
  const intentId = result.intentId; if (typeof intentId !== 'string' || !intentId) fail('profile-unavailable', 'The prepared intent is missing its identifier.'); readExpiry(result.expiry);
  const walletProvider = providerOf(provider); onPhase?.('checking-wallet');
  const wallet = await readWallet(walletProvider); const profileChain = BigInt(profile.chainId); if (wallet.chainId !== profileChain) fail('wrong-chain', 'Switch to the selected V2 network before continuing.'); if (!wallet.account) fail('wrong-account', 'Connect the wallet before continuing.');
  const tx = txFrom(result, wallet.account, profile); const chain = chainDefinition(profile); const publicClient = createPublicClient({ chain, transport: custom(walletProvider, { retryCount: 0 }) }); const walletClient = createWalletClient({ account: wallet.account, chain, transport: custom(walletProvider, { retryCount: 0 }) }); const decoded = decodedAction(result, tx);
  if (unresolvedIntent(profile, wallet.account, result.action)) fail('reconciliation-required', 'Reconcile the pending wallet transaction before sending another one.');
  if (result.action === 'depositStake' && !result.allowance) fail('simulation-reverted', 'depositStake requires exact allowance metadata.');
  const rejected = (error) => error?.code === 4001 || error?.name === 'UserRejectedRequestError';
  if (result.allowance) {
    const allowance = result.allowance; const token = ensureAddress(allowance.token, 'USDC'); const spender = ensureAddress(allowance.spender, 'spender'); const required = BigInt(String(allowance.requiredAmount)); if (normalize(token) !== normalize(profile.usdc) || normalize(spender) !== normalize(tx.to) || required <= 0n || required === (1n << 256n) - 1n) fail('simulation-reverted', 'The allowance request is invalid.'); if (result.action === 'depositStake' && BigInt(decoded.args?.[0]) !== required) fail('simulation-reverted', 'The allowance amount does not match calldata.');
    const current = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [getAddress(wallet.account), spender] });
    if (BigInt(current) < required) { onPhase?.('simulating'); await publicClient.simulateContract({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [spender, required], account: wallet.account }); const approvalIntent = { status: 'broadcast-unknown', hash: null, intentId: `${intentId}:approval`, profileId: profile.id || profile.name, chainId: String(profileChain), wallet: wallet.account, action: result.action, kind: 'approval', spender, requiredAmount: required.toString(), autoResume: true, resumeAttempts: 0 }; persist(approvalIntent); onPhase?.('awaiting-wallet'); let approvalHash; try { approvalHash = await walletClient.writeContract({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [spender, required], account: wallet.account }); } catch (error) { if (rejected(error)) { clear(approvalIntent); fail('wallet-rejected', 'The wallet rejected the allowance approval.'); } persist({ ...approvalIntent, status: 'broadcast-unknown', autoResume: false }); fail('broadcast-uncertain', 'The allowance broadcast result is unknown. Reconcile it before retrying.'); } persist({ ...approvalIntent, status: 'broadcast', hash: approvalHash }); onPhase?.('awaiting-receipt'); const approvalReceipt = await pollReceipt(publicClient, approvalHash); if (approvalReceipt.status !== 'success') { persist({ ...approvalIntent, status: 'terminal', hash: approvalHash, autoResume: false }); fail('receipt-reverted', 'The allowance approval reverted.'); } const verifiedAllowance = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [getAddress(wallet.account), spender] }); if (BigInt(verifiedAllowance) < required) fail('readback-mismatch', 'The approved allowance is lower than required.'); clear(approvalIntent); }
  }
  const abiItem = actionAbi(result.action);
  onPhase?.('simulating');
  try { await publicClient.simulateContract({ address: tx.to, abi: [abiItem, ...ERROR_ABI], functionName: decoded.functionName, args: decoded.args, account: wallet.account, value: tx.value }); }
  catch (error) { const name = safeCustomError(error); const e = new Error(name || 'Simulation reverted.'); e.code = 'simulation-reverted'; e.customErrorName = name; throw e; }
  const intent = { status: 'broadcast-unknown', hash: null, intentId, profileId: profile.id || profile.name, chainId: String(profile.chainId), wallet: wallet.account, action: result.action, expected: result.expected, calldataHash: keccak256(tx.data), autoResume: true, resumeAttempts: 0 };
  persist(intent);
  onPhase?.('awaiting-wallet'); let hash; try { hash = await walletClient.writeContract({ address: tx.to, abi: [abiItem], functionName: decoded.functionName, args: decoded.args, account: wallet.account, value: tx.value }); } catch (error) { if (rejected(error)) { clear(intent); fail('wallet-rejected', 'The wallet rejected this transaction.'); } persist({ ...intent, status: 'broadcast-unknown', autoResume: false }); fail('broadcast-uncertain', 'The wallet broadcast result is unknown. Reconcile it before retrying.'); }
  persist({ ...intent, status: 'broadcast', hash }); onPhase?.('awaiting-receipt'); const receipt = await pollReceipt(publicClient, hash); if (receipt.status !== 'success') { persist({ ...intent, status: 'terminal', hash, autoResume: false }); fail('receipt-reverted', 'The wallet transaction reverted.'); } onPhase?.('awaiting-readback'); const verified = await waitReadback({ hash, intent: { ...intent, hash }, readback }); clear(intent); onPhase?.('success'); return { ...result, phase: 'success', hash, receipt, readback: verified };
}

async function defaultReadback(hash, intentId) { const response = await fetch(`/api/v2/transactions/${hash}?intent=${encodeURIComponent(intentId)}`, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } }); if (!response.ok) return null; return response.json(); }

const RESUME_IN_FLIGHT = new Set();

export function useWalletExecution({ profile, readback = defaultReadback, onRefresh } = {}) {
  const [phase, setPhase] = useState('prepared');
  const [error, setError] = useState(null);
  const [value, setValue] = useState(null);
  const busy = useRef(false);
  const run = useCallback(async (result) => {
    if (busy.current) { const e = new Error('Wallet action is already pending.'); e.code = 'busy'; throw e; }
    busy.current = true; setError(null); setPhase('prepared');
    try { const effectiveProfile = profile || await loadV2Profile(); const next = await executeWalletAction(result, { profile: effectiveProfile, readback, onPhase: setPhase }); setValue(next); onRefresh?.(); return next; }
    catch (cause) { setPhase(cause?.code || 'error'); setError(cause); throw cause; }
    finally { busy.current = false; }
  }, [onRefresh, profile, readback]);
  useEffect(() => {
    let cancelled = false;
    if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage.length === 0) return undefined;
    const start = async () => { const effectiveProfile = profile || await loadV2Profile(); const pending = []; try { for (let i = 0; i < localStorage.length; i += 1) { const key = localStorage.key(i); if (!key?.startsWith('v2-wallet-intent:')) continue; try { const stored = JSON.parse(localStorage.getItem(key)); if (stored?.profileId === (effectiveProfile.id || effectiveProfile.name) && stored?.chainId === String(effectiveProfile.chainId)) pending.push(stored); } catch {} } } catch {} if (pending[0]) { const resumeKey = storageKey(pending[0]); if (RESUME_IN_FLIGHT.has(resumeKey)) return; RESUME_IN_FLIGHT.add(resumeKey); try { const next = await resumeWalletIntent({ stored: pending[0], profile: effectiveProfile, readback }); if (!cancelled && next) { setValue(next); setPhase(next.phase); onRefresh?.(); } } finally { RESUME_IN_FLIGHT.delete(resumeKey); } } };
    start().catch((cause) => { if (!cancelled) { setPhase(cause?.code || 'error'); setError(cause); } });
    return () => { cancelled = true; };
  }, [onRefresh, profile, readback]);
  return { phase, pending: ['checking-wallet', 'simulating', 'awaiting-wallet', 'awaiting-receipt', 'awaiting-readback'].includes(phase), error, value, run };
}

export { PHASES, sameExpected, storageKey, defaultReadback, assertReadbackIdentity };
