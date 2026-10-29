/* eslint-disable no-console */
// Strictly local V2 visual/bootstrap state. No private keys, compile, or remote RPC.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ethers } = require('ethers');
const { wrapMarket } = require('../test/helpers/v2-read-model');

const RPC_URL = 'http://127.0.0.1:8545';
const CHAIN_ID = 31337n;
const U = 1_000_000n;
const DAY = 86400;
const SCRATCH = process.env.V2_LOCAL_UI_STATE || path.join(process.env.LOCALAPPDATA || process.env.TEMP, 'hermes', 'cache', 'scratch', 'v2-local-ui-state');
const MANIFEST = path.join(SCRATCH, 'manifest.json');
const ROOT = path.resolve(__dirname, '..');
const ART = path.join(ROOT, 'artifacts-v2-runs50', 'contracts');
const artifact = (file, contract) => JSON.parse(fs.readFileSync(path.join(ART, file, `${contract}.json`), 'utf8'));
const marketArtifact = artifact('AgentMarketplaceV2.sol', 'AgentMarketplaceV2');
const vaultArtifact = artifact('OperatorCollateralVaultV2.sol', 'OperatorCollateralVaultV2');
const tokenArtifact = artifact('mocks/MockUSDC.sol', 'MockUSDC');
const h = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const jsonSafe = (v) => typeof v === 'bigint' ? v.toString() : v;
const clean = (v) => JSON.parse(JSON.stringify(v, (_, x) => jsonSafe(x)));

async function main() {
  if (!/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(RPC_URL)) throw new Error('RPC_DESTINATION_NOT_LOOPBACK');
  const provider = new ethers.JsonRpcProvider(RPC_URL, { name: 'hardhat-local', chainId: 31337 }, { staticNetwork: true });
  // staticNetwork is a provider hint, not evidence of the RPC's actual chain.
  // Query the endpoint before acquiring any signer or sending transactions.
  const actualChainId = BigInt(await provider.send('eth_chainId', []));
  if (actualChainId !== CHAIN_ID) throw new Error('CHAIN_ID_MISMATCH');
  const accounts = await provider.send('eth_accounts', []);
  if (accounts.length < 8) throw new Error('INSUFFICIENT_UNLOCKED_HARDHAT_ACCOUNTS');
  const roles = Object.fromEntries(['owner', 'client', 'operator', 'treasury', 'relayer', 'other', 'resolver', 'observer'].map((n, i) => [n, ethers.getAddress(accounts[i])]));
  if (new Set(Object.values(roles)).size !== Object.values(roles).length) throw new Error('ROLE_ADDRESSES_NOT_DISTINCT');
  const signers = Object.fromEntries(await Promise.all(Object.keys(roles).map(async (role) => [role, await provider.getSigner(roles[role])] )));
  const signer = (role) => signers[role];
  const receipts = [];
  const reads = [];
  const deployments = [];
  const tx = async (role, label, fn, readback) => {
    let sent;
    try { sent = await fn(); } catch (error) { throw new Error(`TX_SEND_FAILED:${label}:${String(error.shortMessage || error.message || error).split('\\n')[0]}`); }
    let receipt;
    try { receipt = await sent.wait(); } catch (error) { throw new Error(`TX_WAIT_FAILED:${label}:${String(error.shortMessage || error.message || error).split('\\n')[0]}`); }
    const reread = await provider.getTransactionReceipt(sent.hash);
    if (!reread || reread.status !== 1 || reread.hash !== sent.hash || reread.from.toLowerCase() !== roles[role].toLowerCase()) throw new Error(`RECEIPT_READBACK_FAILED:${label}`);
    const row = { label, txHash: reread.hash, status: Number(reread.status), blockNumber: reread.blockNumber, from: reread.from, to: reread.to, nonce: reread.nonce, gasUsed: reread.gasUsed.toString(), method: sent.data.slice(0, 10) };
    if (readback) row.readback = clean(await readback());
    receipts.push(row);
    return receipt;
  };
  const read = async (label, fn) => { const value = clean(await fn()); reads.push({ label, value }); return value; };

  const Token = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, signer('owner'));
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenTx = await provider.getTransaction(token.deploymentTransaction().hash);
  deployments.push({ name: 'MockUSDC', address: await token.getAddress(), txHash: token.deploymentTransaction().hash, from: tokenTx.from, nonce: tokenTx.nonce });
  const tokenAddress = await token.getAddress();
  const rpcNonce = async (tag = 'latest') => Number(BigInt(await provider.send('eth_getTransactionCount', [roles.owner, tag])));
  const ownerNonce = await rpcNonce('pending');
  const expectedMarket = ethers.getCreateAddress({ from: roles.owner, nonce: ownerNonce + 1 });
  const Vault = new ethers.ContractFactory(vaultArtifact.abi, vaultArtifact.bytecode, signer('owner'));
  const vault = await Vault.deploy(await token.getAddress(), expectedMarket, roles.treasury);
  await vault.waitForDeployment();
  const vaultReceipt = await provider.getTransactionReceipt(vault.deploymentTransaction().hash);
  const vaultTransaction = await provider.getTransaction(vault.deploymentTransaction().hash);
  const nonceAfterVault = await rpcNonce('pending');
  if (vaultTransaction.nonce !== ownerNonce || nonceAfterVault !== ownerNonce + 1) throw new Error(`PAIR_NONCE_DRIFT:${ownerNonce}:${vaultTransaction.nonce}:${nonceAfterVault}`);
  const Market = new ethers.ContractFactory(marketArtifact.abi, marketArtifact.bytecode, signer('owner'));
  const marketContract = await Market.deploy(await token.getAddress(), roles.owner, roles.treasury, await vault.getAddress());
  await marketContract.waitForDeployment();
  const marketReceipt = await provider.getTransactionReceipt(marketContract.deploymentTransaction().hash);
  if (await vault.marketplace() !== await marketContract.getAddress() || await marketContract.collateralVault() !== await vault.getAddress()) throw new Error('PAIR_RECIPROCAL_READBACK_FAILED');
  const market = wrapMarket(marketContract);
  const marketTransaction = await provider.getTransaction(marketContract.deploymentTransaction().hash);
  deployments.push({ name: 'OperatorCollateralVaultV2', address: await vault.getAddress(), txHash: vault.deploymentTransaction().hash, blockNumber: vaultReceipt.blockNumber, from: vaultTransaction.from, nonce: vaultTransaction.nonce });
  deployments.push({ name: 'AgentMarketplaceV2', address: await marketContract.getAddress(), txHash: marketContract.deploymentTransaction().hash, blockNumber: marketReceipt.blockNumber, from: marketTransaction.from, nonce: marketTransaction.nonce });

  const runtime = {};
  for (const [name, address, a] of [['market', await market.getAddress(), marketArtifact], ['vault', await vault.getAddress(), vaultArtifact], ['token', await token.getAddress(), tokenArtifact]]) {
    const code = await provider.getCode(address);
    if (code === '0x') throw new Error(`MISSING_RUNTIME:${name}`);
    runtime[name] = { address, bytes: (code.length - 2) / 2, rawHash: ethers.keccak256(code), artifactCreationHash: crypto.createHash('sha256').update(a.bytecode.slice(2), 'hex').digest('hex') };
  }

  const mintAmount = 1_000n * U;
  for (const role of Object.keys(roles)) await tx('owner', `mint:${role}`, () => token.mint(roles[role], mintAmount), () => token.balanceOf(roles[role]));
  const vaultAddress = await vault.getAddress();
  await tx('operator', 'approve-vault', () => token.connect(signer('operator')).approve(vaultAddress, 100n * U));
  await tx('operator', 'deposit-stake', () => vault.connect(signer('operator')).depositStake(100n * U), () => vault.freeStake(roles.operator));
  await tx('operator', 'register-operator', () => market.connect(signer('operator')).registerOperator(), () => market.registered(roles.operator));
  const marketAddress = await market.getAddress();
  await tx('owner', 'set-resolver-policy', () => market.setResolverForClient(roles.client, roles.resolver), () => marketAddress);
  await tx('client', 'approve-market', () => token.connect(signer('client')).approve(marketAddress, 8n * U));

  const jobMeta = [
    ['Open showcase', 'gamebot', 0], ['In progress showcase', 'website', 1], ['Submitted showcase', 'tool', 2],
    ['Revision pending showcase', 'shortvideo', 3], ['Disputed showcase', 'research', 5], ['Completed showcase', 'design', 6], ['Refunded showcase', 'other', 7],
  ];
  const jobs = [];
  const snapshot = async (id) => { const j = await market.getJob(id); return { id: id.toString(), status: Number(j.status), client: j.client, operator: j.operator, reward: j.reward.toString(), stateVersion: j.stateVersion.toString(), stakeReserved: j.stakeReserved.toString(), deliveryDeadline: j.deliveryDeadline.toString(), reviewDeadline: j.reviewDeadline.toString(), canonicalTermsHash: j.canonicalTermsHash }; };
  const post = async (title, kind) => {
    const id = await market.nextJobId();
    const now = BigInt((await provider.getBlock('latest')).timestamp);
    const reward = 1n * U;
    await tx('client', `post:${kind}`, () => market.connect(signer('client')).postJob(reward, now + 2n * BigInt(DAY), 2n * BigInt(DAY), 2n * BigInt(DAY), 1n * BigInt(DAY), 2, false, h(`${title}:criteria`), h(`${title}:description`), false), () => snapshot(id));
    return id;
  };
  const signApplication = async (id) => {
    const j = await market.getJob(id);
    const nonce = await market.applicationNonce(id, roles.operator);
    const epoch = await market.nonceEpoch(roles.operator);
    const value = { jobId: id, operator: roles.operator, termsHash: j.canonicalTermsHash, validAfter: 0, validBefore: j.applyBy, nonceEpoch: epoch, operatorNonce: nonce };
    const network = await provider.getNetwork();
    const sig = await signer('operator').signTypedData({ name: 'AlphaBoard Agent Marketplace V2', version: '1', chainId: network.chainId, verifyingContract: await market.getAddress() }, { Application: [{ name: 'jobId', type: 'uint256' }, { name: 'operator', type: 'address' }, { name: 'termsHash', type: 'bytes32' }, { name: 'validAfter', type: 'uint64' }, { name: 'validBefore', type: 'uint64' }, { name: 'nonceEpoch', type: 'uint256' }, { name: 'operatorNonce', type: 'uint256' }] }, value);
    return { value, sig };
  };
  const award = async (id, kind) => { const a = await signApplication(id); await tx('client', `award:${kind}`, () => market.connect(signer('client')).awardJob(id, a.value, a.sig), () => snapshot(id)); };
  const submit = async (id, kind) => { const j = await market.getJob(id); await tx('operator', `submit:${kind}`, () => market.connect(signer('operator')).submitDelivery(id, h(`${kind}:delivery`), j.stateVersion), () => snapshot(id)); };

  for (const [title, kind, expected] of jobMeta) {
    const id = await post(title, kind);
    if (expected >= 1) await award(id, kind);
    if ([2, 3, 6].includes(expected)) await submit(id, kind);
    if (expected === 3) { const j = await market.getJob(id); await tx('client', `request-revision:${kind}`, () => market.connect(signer('client')).requestRevision(id, h(`${kind}:criterion`), h(`${kind}:reference`), j.stateVersion), () => snapshot(id)); }
    if (expected === 5) { const j = await market.getJob(id); await tx('client', `open-dispute:${kind}`, () => market.connect(signer('client')).openDispute(id, j.stateVersion), () => snapshot(id)); }
    if (expected === 6) { const j = await market.getJob(id); await tx('client', `approve:${kind}`, () => market.connect(signer('client')).approve(id, j.stateVersion), () => snapshot(id)); }
    if (expected === 7) {
      const after = await market.getJob(id);
      const latestTimestamp = async () => Number(BigInt((await provider.send('eth_getBlockByNumber', ['latest', false])).timestamp));
      const nowTimestamp = await latestTimestamp();
      const waitSeconds = Math.max(0, Number(after.deliveryDeadline) - nowTimestamp + 2);
      await provider.send('evm_increaseTime', [waitSeconds]); await provider.send('evm_mine', []);
      const timeoutTimestamp = await latestTimestamp();
      if (BigInt(timeoutTimestamp) < after.deliveryDeadline) throw new Error('REFUND_CLOCK_NOT_ADVANCED');
      const timeoutJob = await market.getJob(id);
      await tx('relayer', `timeout-refund:${kind}`, async () => {
        try { return await market.connect(signer('relayer')).claimDeliveryTimeout(id, timeoutJob.stateVersion); }
        catch (error) { throw new Error(`REFUND_CALL_STATE:${timeoutJob.status}:${timeoutJob.stateVersion}:${timeoutJob.deliveryDeadline}:${timeoutTimestamp}:${String(error.shortMessage || error.message || error).split('\\n')[0]}`); }
      }, () => snapshot(id));
      const refunded = await market.getJob(id);
      if (Number(refunded.status) !== 7) throw new Error('REFUND_STATUS_NOT_7');
      await tx('resolver', `release-refund-stake:${kind}`, () => market.connect(signer('resolver')).resolveFaultReview(id, 0, h(`${kind}:reason`), h(`${kind}:evidence`), refunded.stateVersion), () => snapshot(id));
    }
    const final = await snapshot(id);
    if (final.status !== expected) throw new Error(`SEED_STATUS_MISMATCH:${kind}:${final.status}:${expected}`);
    jobs.push({ jobId: id.toString(), title, kind, expectedStatus: expected, final });
  }
  const anchor = await provider.getBlock('latest');
  const manifest = { schema: 'arc.v2.local.visual.setup.v1', generatedAt: new Date().toISOString(), chainId: '31337', rpcUrl: RPC_URL, roles, pair: { token: await token.getAddress(), market: await market.getAddress(), vault: await vault.getAddress(), treasury: roles.treasury }, deployments, runtime, jobs, receipts, reads, anchorBlock: { number: anchor.number, hash: anchor.hash }, source: { marketplaceV2Sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'contracts', 'AgentMarketplaceV2.sol'))).digest('hex'), artifactProfile: 'artifacts-v2-runs50; solc 0.8.28; viaIR; optimizer runs 50; Cancun' }, immutableExpected: { token: await token.getAddress(), owner: roles.owner, treasury: roles.treasury, vault: await vault.getAddress(), marketplace: await market.getAddress() } };
  fs.mkdirSync(SCRATCH, { recursive: true }); fs.writeFileSync(MANIFEST, JSON.stringify(clean(manifest), null, 2) + '\n');
  console.log(JSON.stringify({ manifest: MANIFEST, chainId: '31337', rpcUrl: RPC_URL, pair: manifest.pair, deployments: deployments.map(x => ({ name: x.name, address: x.address, txHash: x.txHash })), seedLedger: jobs.map(x => ({ jobId: x.jobId, kind: x.kind, status: x.final.status })) }, null, 2));
}
main().catch((error) => { console.error(String(error.shortMessage || error.message || error).split('\n')[0]); process.exitCode = 1; });
