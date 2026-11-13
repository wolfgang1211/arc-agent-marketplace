#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPublicClient, encodeFunctionData, formatUnits, getAddress, http, isAddress } from 'viem';
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';
import { defaultV2ReaderFactory } from '../lib/v2/server/api-runtime.mjs';
import manifest from '../lib/v2/action-manifest.json' with { type: 'json' };
import runtimeProof from '../lib/v2/runtime-abi-proof.json' with { type: 'json' };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const EVIDENCE_DIR = process.env.V2_ARC_EVIDENCE_DIR || 'C:/Users/wolfgang/AppData/Local/hermes/cache/scratch/v2-local-arc-20261105';
const RPC = ARC_TESTNET_PROFILE.rpcUrl;
const CHAIN_ID = ARC_TESTNET_PROFILE.canonicalChainId;
const MARKETPLACE = getAddress(ARC_TESTNET_PROFILE.marketplace);
const TOKEN = getAddress(ARC_TESTNET_PROFILE.usdc);
const YUSUF = getAddress('0x460EBe282Fb0e42B4d682a7f9EF408302417F780');
const safeJson = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const args = (argv) => Object.fromEntries(argv.filter((x) => x.startsWith('--')).map((x) => { const [k, ...v] = x.slice(2).split('='); return [k, v.join('=') || true]; }));
const address = (value, label) => { if (typeof value !== 'string' || !isAddress(value)) throw new Error(`${label}_REQUIRED`); return getAddress(value); };
async function publicRoles() { const d = JSON.parse(await fs.readFile(path.join(ROOT, 'contract/docs/v2-testnet-wallets.json'), 'utf8')); return Object.fromEntries(Object.entries(d.roles).map(([k, v]) => [k, address(v, `role_${k}`)])); }

export async function buildPreflight({ operator, readerFactory = defaultV2ReaderFactory, gasReader = null, jobId = null } = {}) {
  const operatorAddress = address(operator, 'OPERATOR_REQUIRED');
  const reader = readerFactory({ profile: ARC_TESTNET_PROFILE }); const snap = await reader.read();
  if (BigInt(snap.chainId) !== CHAIN_ID) throw new Error('READER_CHAIN_MISMATCH');
  const roles = await publicRoles();
  if (operatorAddress.toLowerCase() !== roles.testOperator.toLowerCase()) throw new Error('OPERATOR_NOT_VERIFIED_PUBLIC_ROLE');
  const [operatorState, clientPolicy] = await Promise.all([snap.readAccount(operatorAddress), snap.readClientPolicy(YUSUF)]);
  const effectiveResolver = address(clientPolicy.resolvedResolver, 'EFFECTIVE_RESOLVER');
  const owner = address(snap.getters.owner, 'CANONICAL_OWNER');
  let job = null;
  if (jobId !== null && jobId !== undefined) { const id = BigInt(String(jobId)); if (id < 1n) throw new Error('JOB_ID_REQUIRED'); const actual = await snap.readJob(id); job = { jobId: id.toString(), client: actual.client, operator: actual.operator, resolver: actual.resolver, status: actual.status, stateVersion: actual.stateVersion, termsHash: actual.canonicalTermsHash, nonces: { operatorNonce: (await snap.readAccount(operatorAddress)).applicationNonce(id) } }; }
  const gas = gasReader ?? createPublicClient({ chain: { ...ARC_TESTNET_PROFILE, id: Number(CHAIN_ID) }, transport: http(RPC), batch: { multicall: false } });
  const gasPrice = await gas.getGasPrice();
  const [nativeBalance, yusufAccount] = await Promise.all([gas.getBalance({ address: YUSUF, blockNumber: BigInt(snap.blockTag) }), snap.readAccount(YUSUF)]);
  const yusuf = { address: YUSUF, nativeRaw18: nativeBalance.toString(), nativeUSDC: formatUnits(nativeBalance, 18), erc20Raw6: yusufAccount.tokenBalance.toString(), erc20USDC: formatUnits(yusufAccount.tokenBalance, 6), note: 'Native and ERC-20 representations are not additive balances.' };
  let registerEstimate = null;
  try { const data = encodeFunctionData({ abi: manifest.contracts.marketplace.abi, functionName: 'registerOperator' }); registerEstimate = await gas.estimateGas({ account: operatorAddress, to: MARKETPLACE, data }); } catch { registerEstimate = null; }
  let gasProbe = null;
  try { const units = await gas.estimateGas({ account: YUSUF, to: YUSUF, value: 0n }); const cost = units * gasPrice; gasProbe = { gasUnits: units.toString(), estimatedCostRaw18: cost.toString(), estimatedCostUSDC: formatUnits(cost, 18), balanceCoversThisProbe: nativeBalance >= cost, scope: 'Zero-value self-transfer estimate, not a marketplace transaction or M1-M8 total.' }; } catch {}
  return { schema: 2, gasProbe, yusuf, mode: 'readonly', signer: { status: 'blocked', reason: 'No secret/password/keystore read; all actions are unsigned and no broadcast is available.' }, chain: { canonicalChainId: CHAIN_ID.toString(), observedChainId: snap.chainId.toString(), rpc: RPC }, evidence: { blockTag: snap.blockTag, blockHash: snap.blockHash, blockTimestamp: snap.blockTimestamp?.toString() ?? null, source: 'canonical createV2ChainReader via defaultV2ReaderFactory and read-only transport' }, operator: { address: operatorAddress, verifiedPublicRole: 'testOperator', registered: operatorState.registered, freeStakeRaw6: operatorState.freeStake.toString(), freeStakeDisplay6: formatUnits(operatorState.freeStake, 6), reservedStakeRaw6: operatorState.reservedStake.toString(), reservedStakeDisplay6: formatUnits(operatorState.reservedStake, 6), tokenBalanceRaw6: operatorState.tokenBalance.toString(), nonceEpoch: operatorState.nonceEpoch.toString() }, resolver: { effectiveResolver, owner, policyResolver: clientPolicy.resolverPolicy, source: 'canonical reader readClientPolicy(Yusuf); zero policy resolves to canonical owner', ownerFallbackApplied: effectiveResolver.toLowerCase() === owner.toLowerCase() && clientPolicy.resolverPolicy.toLowerCase() === '0x0000000000000000000000000000000000000000' }, deployment: { marketplace: MARKETPLACE, token: TOKEN, vault: getAddress(ARC_TESTNET_PROFILE.vault), abiWitness: 'web/lib/v2/runtime-abi-proof.json + web/lib/v2/action-manifest.json', runtimeProofProvenance: runtimeProof.provenance }, gas: { liveGasPriceWei: gasPrice.toString(), registerOperatorProbeGas: registerEstimate?.toString() ?? null, scope: 'live gas price and one registerOperator estimate only; no whole-workflow affordability claim' }, job, transactionMethodsPermitted: false };
}

export async function main(argv = process.argv.slice(2)) { const a = args(argv); const result = await buildPreflight({ operator: a.operator, jobId: a['job-id'] ?? a.jobId }); await fs.mkdir(EVIDENCE_DIR, { recursive: true }); await fs.writeFile(path.join(EVIDENCE_DIR, 'v2-local-arc-preflight.json'), safeJson(result)); process.stdout.write(safeJson(result)); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`READONLY_PREFLIGHT_FAILED:${error.message.replace(/\s+/g, '_')}\n`); process.exitCode = 1; });
export { CHAIN_ID, MARKETPLACE, TOKEN, YUSUF };
