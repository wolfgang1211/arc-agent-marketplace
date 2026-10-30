const assert = require('node:assert/strict');
const { ethers } = require('hardhat');
const { deployV2Pair } = require('./helpers/deploy-v2-pair');
const { explicitLocalProfile } = require('./helpers/v2-explicit-local-profile');

const U = 1_000_000n;
const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const APPLICATION_TYPES = {
  Application: [
    { name: 'jobId', type: 'uint256' }, { name: 'operator', type: 'address' },
    { name: 'termsHash', type: 'bytes32' }, { name: 'validAfter', type: 'uint64' },
    { name: 'validBefore', type: 'uint64' }, { name: 'nonceEpoch', type: 'uint256' },
    { name: 'operatorNonce', type: 'uint256' },
  ],
};

function slot(n) { return ethers.zeroPadValue(ethers.toBeHex(BigInt(n)), 32); }
function mappingSlot(key, base) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [key, base]));
}
function addressMappingSlot(key, base) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [key, base]));
}
function mutateWord(word, byteOffset, value) {
  const bytes = Buffer.from(word.slice(2), 'hex'); bytes[31 - byteOffset] = value;
  return `0x${bytes.toString('hex')}`;
}
function mutateCode(code, byteOffset, byte) {
  const bytes = Buffer.from(code.slice(2), 'hex'); bytes[byteOffset] = byte;
  return `0x${bytes.toString('hex')}`;
}
function normalize(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && value.startsWith('0x')) return value.toLowerCase();
  return typeof value === 'number' ? BigInt(value) : value;
}

async function fixture() {
  const [owner, client, operator, treasury, resolver, other] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory('MockUSDC')).deploy();
  await token.waitForDeployment();
  const { market, vault } = await deployV2Pair({ token, owner, treasury });
  for (const signer of [owner, client, operator, treasury, resolver, other]) await (await token.mint(signer.address, 20n * U)).wait();
  await (await market.connect(owner).setResolverForClient(client.address, resolver.address)).wait();
  await (await market.connect(owner).setHouse(other.address, true)).wait();
  await (await market.connect(owner).setTestClient(other.address, true)).wait();
  await (await token.connect(client).approve(await market.getAddress(), 2n * U)).wait();
  await (await token.connect(operator).approve(await vault.getAddress(), 5n * U)).wait();
  await (await vault.connect(operator).depositStake(5n * U)).wait();
  await (await market.connect(operator).registerOperator()).wait();
  const { createV2ChainReader } = await import('../../web/lib/v2/server/chain-reader.mjs');
  const original = (method, params) => ethers.provider.send(method, params);
  const profile = await explicitLocalProfile({ market, vault, token, treasury });
  const readerFor = (transport = original) => createV2ChainReader({ transport, profile });
  return { owner, client, operator, treasury, resolver, other, token, market, vault, readerFor, original, createV2ChainReader };
}

async function postAndAward(e, reward = U) {
  const now = (await ethers.provider.getBlock('latest')).timestamp;
  const applyBy = now + 7200;
  await (await e.market.connect(e.client).postJob(reward, applyBy, 3600, 86400, 43200, 2, false, hash('criteria'), hash('description'), false)).wait();
  const job = await (await freshSnapshot(e)).snapshot.readJob(1n);
  const net = await ethers.provider.getNetwork();
  const value = { jobId: 1n, operator: e.operator.address, termsHash: job.canonicalTermsHash, validAfter: 0n, validBefore: BigInt(applyBy), nonceEpoch: 0n, operatorNonce: 0n };
  const domain = { name: 'AlphaBoard Agent Marketplace V2', version: '1', chainId: net.chainId, verifyingContract: await e.market.getAddress() };
  const signature = await e.operator.signTypedData(domain, APPLICATION_TYPES, value);
  await (await e.market.connect(e.client).awardJob(1, value, signature)).wait();
  return { applyBy, job };
}

async function freshSnapshot(e, transport = e.original) {
  const reader = e.readerFor(transport);
  return { reader, snapshot: await reader.read() };
}

describe('V2 reader boundary coverage', function () {
  it('reads nonzero mutual/account/policy state and matches the independent decoder', async function () {
    const e = await fixture();
    const { applyBy } = await postAndAward(e);
    const snapshot = (await freshSnapshot(e)).snapshot;
    const before = await snapshot.readJob(1n);
    await (await e.market.connect(e.client).proposeMutual(1, 600_000, 400_000, BigInt((await ethers.provider.getBlock('latest')).timestamp) + 600n, BigInt(before.stateVersion))).wait();
    const fresh = (await freshSnapshot(e)).snapshot;
    const job = await fresh.readJob(1n);
    const mutual = await fresh.readMutual(1n);
    const { build, decoder } = require('../scripts/approved-v2-executor');
    const canonical = await decoder(build('AgentMarketplaceV2').meta, await e.market.getAddress(), ethers.provider, 'mutual')(1n, fresh.blockTag);
    assert.deepEqual(Object.fromEntries(Object.entries(canonical).map(([k, v]) => [k, normalize(v)])), Object.fromEntries(Object.entries(mutual).map(([k, v]) => [k, normalize(v)])));
    assert.deepEqual({ version: mutual.version, jobStateVersion: mutual.jobStateVersion, refund: mutual.refund, grossPayout: mutual.grossPayout, expiry: mutual.expiry, proposer: mutual.proposer.toLowerCase(), active: mutual.active }, { version: 1n, jobStateVersion: job.stateVersion, refund: 600000n, grossPayout: 400000n, expiry: mutual.expiry, proposer: e.client.address.toLowerCase(), active: true });
    assert.equal(job.reward, U);
    assert.equal(job.applyBy, BigInt(applyBy));
    const account = await fresh.readAccount(e.operator.address);
    assert.equal(account.registered, true); assert.equal(account.activeJobs, 1n); assert.equal(account.reservedStake, 5n * U); assert.equal(account.freeStake, 0n); assert.equal(await account.applicationNonce(1n), await e.market.applicationNonce(1n, e.operator.address)); assert.equal(account.credits, 0n); assert.equal(account.maxActiveJobs, await e.market.maxActiveJobs(e.operator.address));
    assert.deepEqual(await fresh.readClientPolicy(e.client.address), { listedHouse: false, testClient: false, resolverPolicy: e.resolver.address, resolvedResolver: e.resolver.address });
    assert.deepEqual(await fresh.readClientPolicy(e.other.address), { listedHouse: true, testClient: true, resolverPolicy: ethers.ZeroAddress, resolvedResolver: e.owner.address });
  });

  it('preserves an actual uint128-scale reward exactly', async function () {
    const e = await fixture();
    const reward = 1n << 80n;
    await (await e.token.mint(e.client.address, reward)).wait();
    await (await e.token.connect(e.client).approve(await e.market.getAddress(), reward)).wait();
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    await (await e.market.connect(e.client).postJob(reward, now + 7200, 3600, 86400, 43200, 2, false, hash('large-criteria'), hash('large-description'), false)).wait();
    const snapshot = (await freshSnapshot(e)).snapshot;
    assert.equal((await snapshot.readJob(1n)).reward, reward);
  });

  it('rejects malformed storage words, ABI responses, and policy mappings', async function () {
    const e = await fixture(); await postAndAward(e);
    const clean = (await freshSnapshot(e)).snapshot;
    await clean.readJob(1n); await clean.readAccount(e.operator.address); await clean.readClientPolicy(e.client.address);
    const jobBase = BigInt(mappingSlot(1n, 11));
    const cases = [
      ['short storage word', (m, p) => m === 'eth_getStorageAt' && BigInt(p[1]) === jobBase + 10n, '0x00', /malformed storage/],
      ['invalid bool', (m, p) => m === 'eth_getStorageAt' && BigInt(p[1]) === jobBase + 10n, mutateWord(ethers.ZeroHash, 2, 2), /invalid boolean/],
      ['invalid status enum', (m, p) => m === 'eth_getStorageAt' && BigInt(p[1]) === jobBase + 10n, mutateWord(ethers.ZeroHash, 5, 9), /invalid enum status/],
      ['invalid extension enum', (m, p) => m === 'eth_getStorageAt' && BigInt(p[1]) === jobBase + 23n, mutateWord(ethers.ZeroHash, 24, 5), /invalid enum extension/],
      ['listedHouse mapping boolean', (m, p) => m === 'eth_getStorageAt' && p[1].toLowerCase() === addressMappingSlot(e.client.address, 15).toLowerCase(), mutateWord(ethers.ZeroHash, 0, 2), /invalid mapping boolean/],
      ['resolver mapping address', (m, p) => m === 'eth_getStorageAt' && p[1].toLowerCase() === addressMappingSlot(e.client.address, 17).toLowerCase(), ethers.toBeHex(1n << 160n, 32), /malformed resolver policy/],
    ];
    for (const [name, match, replacement, error] of cases) {
      const transport = async (method, params) => match(method, params) ? replacement : e.original(method, params);
      const s = (await freshSnapshot(e, transport)).snapshot;
      const target = name.includes('mapping') ? (name.includes('resolver') ? s.readClientPolicy(e.client.address) : s.readClientPolicy(e.client.address)) : s.readJob(1n);
      await assert.rejects(target, error, name);
    }
    const malformedCall = async (method, params) => method === 'eth_call' ? '0x00' : e.original(method, params);
    await assert.rejects(async () => (await freshSnapshot(e, malformedCall)).snapshot.readAccount(e.operator.address), /chain read failed|malformed/);
  });

  it('rejects runtime and immutable corruption while preserving normalized hash checks', async function () {
    const e = await fixture();
    const base = await freshSnapshot(e);
    const marketCode = await e.original('eth_getCode', [await e.market.getAddress(), base.snapshot.blockTag]);
    const vaultCode = await e.original('eth_getCode', [await e.vault.getAddress(), base.snapshot.blockTag]);
    const cases = [
      ['market immutable domain', await e.market.getAddress(), mutateCode(marketCode, 23229, (parseInt(marketCode.slice(2 + 23229 * 2, 2 + 23229 * 2 + 2), 16) ^ 1)), /runtime raw hash mismatch/],
      ['market immutable token', await e.market.getAddress(), mutateCode(marketCode, 3731, (parseInt(marketCode.slice(2 + 3731 * 2, 2 + 3731 * 2 + 2), 16) ^ 1)), /runtime raw hash mismatch/],
      ['vault runtime', await e.vault.getAddress(), mutateCode(vaultCode, 0, (parseInt(vaultCode.slice(2, 4), 16) ^ 1)), /runtime raw hash mismatch/],
      ['empty market code', await e.market.getAddress(), '0x', /empty runtime/],
    ];
    for (const [name, address, replacement, error] of cases) {
      const transport = async (method, params) => method === 'eth_getCode' && params[0].toLowerCase() === address.toLowerCase() ? replacement : e.original(method, params);
      await assert.rejects(() => freshSnapshot(e, transport), error, name);
    }
  });

  it('guards every lazy read against a changed pinned block', async function () {
    const e = await fixture(); await postAndAward(e);
    let changed = false; const calls = [];
    const transport = async (method, params) => {
      calls.push({ method, params });
      if (method === 'eth_getBlockByNumber' && changed) return { hash: `0x${'22'.repeat(32)}` };
      return e.original(method, params);
    };
    const s = (await freshSnapshot(e, transport)).snapshot;
    await s.readJob(1n); await s.readMutual(1n).catch(() => {}); await s.readAccount(e.operator.address); await s.readClientPolicy(e.client.address);
    changed = true;
    for (const operation of [() => s.readJob(1n), () => s.readMutual(1n), () => s.readAccount(e.operator.address), () => s.readAccount(e.operator.address).then((a) => a.applicationNonce(1n)), () => s.readClientPolicy(e.client.address)]) await assert.rejects(operation, /SNAPSHOT_CHANGED/);
    const pinned = calls.filter((x) => ['eth_getCode', 'eth_getStorageAt', 'eth_call'].includes(x.method));
    assert.ok(pinned.length > 0); assert.ok(pinned.every((x) => typeof x.params.at(-1) === 'string' && x.params.at(-1).startsWith('0x')));
  });
});
