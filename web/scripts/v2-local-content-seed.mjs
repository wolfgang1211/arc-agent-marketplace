import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const require = createRequire(path.join(repo, 'contract/package.json'));
const { ethers } = require('ethers');
const { wrapMarket } = require(path.join(repo, 'contract/test/helpers/v2-read-model.js'));
const ARTIFACT_ROOT = path.join(repo, 'contract/artifacts-v2-runs50/contracts');
const MARKET_ARTIFACT = path.join(ARTIFACT_ROOT, 'AgentMarketplaceV2.sol/AgentMarketplaceV2.json');
const VAULT_ARTIFACT = path.join(ARTIFACT_ROOT, 'OperatorCollateralVaultV2.sol/OperatorCollateralVaultV2.json');
const TOKEN_ARTIFACT = path.join(ARTIFACT_ROOT, 'mocks/MockUSDC.sol/MockUSDC.json');
const U = 1_000_000n;
const DAY = 86400n;
const JOB_COUNT = 7;
const TYPES = ['address','address','address','uint256','uint256','address','uint256','uint64','uint64','uint64','uint64','uint256','uint256','uint256','bytes32','uint8','bool','uint64','bytes32','bytes32','bool'];
const FIELDS = ['token','vault','resolver','reward','feeBps','treasury','minReward','deliveryDuration','reviewDuration','revisionDuration','maxExtensionTotal','stakeFloor','stakeRound','collateralBps','schema','revisionLimit','unlimitedRevisions','applyBy','criteriaHash','descriptionHash','testJob'];

function fail(message) { throw new Error(message); }
function loopback(value) { if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value)) fail('V2_LOCAL_RPC_URL must be http://127.0.0.1:<port>'); return value; }
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function contentHash(value) { return ethers.keccak256(ethers.toUtf8Bytes(canonical(value))); }
function termsHash(terms) { return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(TYPES, FIELDS.map((field) => terms[field]))); }
async function artifact(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function receipt(provider, hash) { const value = await provider.waitForTransaction(hash); if (!value || value.status !== 1) fail(`transaction failed: ${hash}`); return value; }
async function tx(contract, method, args) { return receipt(contract.runner.provider, (await (await contract[method](...args)).hash)); }
function requireManifest() { const file = process.env.V2_LOCAL_UI_STATE; if (!file) fail('V2_LOCAL_UI_STATE must point to manifest.json'); return file; }

async function main() {
  const manifestFile = requireManifest();
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const rpcUrl = loopback(manifest.rpcUrl ?? process.env.V2_LOCAL_RPC_URL);
  if (String(manifest.chainId) !== '31337') fail('manifest chainId must be 31337');
  const provider = new ethers.JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });
  const observed = await provider.send('eth_chainId', []);
  if (typeof observed !== 'string' || BigInt(observed) !== 31337n) fail('refusing seed before eth_chainId is 31337');
  if (!manifest.pair?.market || !manifest.pair?.vault || !manifest.pair?.token || !manifest.pair?.treasury) fail('manifest pair is incomplete');
  const [marketCode, vaultCode] = await Promise.all([provider.getCode(manifest.pair.market), provider.getCode(manifest.pair.vault)]);
  if (marketCode === '0x' || vaultCode === '0x') fail('manifest contracts are not deployed');
  const marketArtifact = await artifact(MARKET_ARTIFACT); const vaultArtifact = await artifact(VAULT_ARTIFACT); const tokenArtifact = await artifact(TOKEN_ARTIFACT);
  const owner = await provider.getSigner(manifest.roles.owner);
  const client = await provider.getSigner(manifest.roles.client);
  const operator = await provider.getSigner(manifest.roles.operator);
  const treasury = ethers.getAddress(manifest.roles.treasury);
  const resolver = ethers.getAddress(manifest.roles.resolver);
  const market = wrapMarket(new ethers.Contract(manifest.pair.market, marketArtifact.abi, client));
  if (await market.nextJobId() !== 1n) fail('Seed requires a fresh deployment; refusing to replay transactions');
  if (ethers.keccak256(marketCode) !== manifest.runtime.market.rawHash || ethers.keccak256(vaultCode) !== manifest.runtime.vault.rawHash) fail('manifest runtime mismatch');
  const ownerMarket = market.connect(owner); const clientMarket = market.connect(client); const operatorMarket = market.connect(operator);
  const vault = new ethers.Contract(manifest.pair.vault, vaultArtifact.abi, owner);
  const token = new ethers.Contract(manifest.pair.token, tokenArtifact.abi, owner);
  if (ethers.getAddress(await market.collateralVault()) !== ethers.getAddress(manifest.pair.vault) || ethers.getAddress(await vault.marketplace()) !== ethers.getAddress(manifest.pair.market)) fail('manifest marketplace/vault pair mismatch');
  const decimals = 1_000_000n;
  const plannedReward = BigInt(JOB_COUNT) * 100n * decimals;
  await tx(token.connect(client), 'approve', [manifest.pair.market, plannedReward]);
  await tx(token.connect(operator), 'approve', [manifest.pair.vault, 100n * decimals]);
  await tx(ownerMarket, 'setResolverForClient', [manifest.roles.client, resolver]);
  await tx(operatorMarket, 'registerOperator', []);
  await tx(vault.connect(operator), 'depositStake', [100n * decimals]);
  const head = await provider.getBlock('latest');
  const applyBy = BigInt(head.timestamp) + 30n * DAY;
  const documents = [
    ['gamebot','Build a deterministic game bot tutorial video', 'gamebot', ['automation','game-ai']],
    ['website','Refresh the public landing page for the marketplace', 'website', ['frontend','accessibility']],
    ['tool','Create a CLI tool for validating job evidence', 'tool', ['nodejs','cli']],
    ['shortvideo','Produce a concise launch explainer short', 'shortvideo', ['editing','motion']],
    ['research','Compare escrow UX patterns for agent work', 'research', ['ux','analysis']],
    ['design','Design a compact operator dashboard concept', 'design', ['figma','dashboard']],
    ['gamebot','Prototype a replay-safe game bot harness', 'gamebot', ['testing','simulation']],
  ].map(([category, title, kind, tags], index) => ({ title, description: `${title}. Deliver a reviewable artifact with evidence.`, criteria: [`${kind} artifact is complete`, 'Acceptance evidence is reproducible', 'No placeholder links are used'], category, tags, index }));
  const seed = [];
  const ids = [];
  for (const document of documents) {
    const descriptionHash = contentHash(document.description); const criteriaHash = contentHash(document.criteria);
    const terms = { token: manifest.pair.token, vault: manifest.pair.vault, resolver, reward: 100n * decimals, feeBps: await market.feeBps(), treasury, minReward: await market.minReward(), deliveryDuration: 7n * DAY, reviewDuration: 7n * DAY, revisionDuration: 3n * DAY, maxExtensionTotal: 180n * DAY, stakeFloor: 5_000_000n, stakeRound: 10_000n, collateralBps: 1000n, schema: ethers.keccak256(ethers.toUtf8Bytes('AlphaBoard.AgentMarketplaceV2.JobTerms.v2')), revisionLimit: 2n, unlimitedRevisions: false, applyBy, criteriaHash, descriptionHash, testJob: false };
    const txResponse = await clientMarket.postJob(terms.reward, terms.applyBy, terms.deliveryDuration, terms.reviewDuration, terms.revisionDuration, terms.revisionLimit, terms.unlimitedRevisions, terms.criteriaHash, terms.descriptionHash, terms.testJob);
    const postReceipt = await receipt(provider, txResponse.hash);
    const jobId = BigInt(await market.nextJobId()) - 1n;
    ids.push(jobId);
    seed.push({ jobId: jobId.toString(), document: { ...document, index: undefined }, descriptionHash, criteriaHash, client: ethers.getAddress(manifest.roles.client), termsHash: termsHash(terms), receiptHash: postReceipt.hash, postReceipt: { blockNumber: postReceipt.blockNumber, blockHash: postReceipt.blockHash, transactionHash: postReceipt.hash } });
  }
  const operatorMarket2 = market.connect(operator);
  async function award(jobId) {
    const nonce = await market.applicationNonce(jobId, manifest.roles.operator);
    const application = { jobId, operator: manifest.roles.operator, termsHash: seed[Number(jobId) - 1].termsHash, validAfter: 0n, validBefore: applyBy, nonceEpoch: await market.nonceEpoch(manifest.roles.operator), operatorNonce: nonce };
    const domain = { name: 'AlphaBoard Agent Marketplace V2', version: '1', chainId: 31337, verifyingContract: manifest.pair.market };
    const signature = await operator.signTypedData(domain, { Application: [{ name:'jobId', type:'uint256' },{ name:'operator', type:'address' },{ name:'termsHash', type:'bytes32' },{ name:'validAfter', type:'uint64' },{ name:'validBefore', type:'uint64' },{ name:'nonceEpoch', type:'uint256' },{ name:'operatorNonce', type:'uint256' }] }, application);
    await tx(clientMarket, 'awardJob', [jobId, application, signature]);
  }
  async function submit(jobId) { const j = await market.getJob(jobId); await tx(operatorMarket2, 'submitDelivery', [jobId, contentHash({ jobId: String(jobId), link: 'https://example.com/deliverables/' + jobId }), j.stateVersion]); }
  async function approve(jobId) { const j = await market.getJob(jobId); await tx(clientMarket, 'approve', [jobId, j.stateVersion]); }
  await award(ids[1]);
  await award(ids[2]); await submit(ids[2]);
  await award(ids[3]); await submit(ids[3]); await tx(clientMarket, 'requestRevision', [ids[3], contentHash('Show the accessibility checklist'), contentHash('Review notes for revision'), (await market.getJob(ids[3])).stateVersion]);
  await award(ids[4]); await submit(ids[4]); await tx(clientMarket, 'openDispute', [ids[4], (await market.getJob(ids[4])).stateVersion]);
  await award(ids[5]); await submit(ids[5]); await approve(ids[5]);
  await tx(clientMarket, 'cancelOpenJob', [ids[6], (await market.getJob(ids[6])).stateVersion]);
  const statusNames = ['Open','InProgress','Submitted','RevisionPending','Disputed','Completed','Refunded'];
  const nextJobId = (await market.nextJobId()).toString();
  const operatorRegistered = await market.registered(manifest.roles.operator);
  const operatorFreeStake = (await vault.freeStake(manifest.roles.operator)).toString();
  const expectedStatuses = [0, 1, 2, 3, 5, 6, 7];
  const readbacks = [];
  for (let index = 0; index < ids.length; index++) { const jobId = ids[index]; const j = await market.getJob(jobId); if (Number(j.status) !== expectedStatuses[index] || j.canonicalTermsHash.toLowerCase() !== seed[index].termsHash.toLowerCase()) fail('Actual seed status/terms mismatch'); readbacks.push({ jobId: String(jobId), status: statusNames[index], actualStatus: Number(j.status), stateVersion: String(j.stateVersion), client: j.client, termsHash: j.canonicalTermsHash, postReceipt: seed[index].postReceipt, chainReadback: { nextJobId, operatorRegistered, operatorFreeStake } }); }
  const output = process.env.V2_LOCAL_SEED_OUT ?? path.join(path.dirname(manifestFile), 'seed-content.json');
  await writeFile(output, `${JSON.stringify({ chainId: '31337', rpcUrl, pair: manifest.pair, roles: manifest.roles, jobs: seed, readbacks }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, jobs: readbacks.length, statuses: readbacks.map((x) => x.status) })}\n`);
}
main().catch((error) => { process.stderr.write(`${error?.message ?? 'seed failed'}\n`); process.exitCode = 1; });
