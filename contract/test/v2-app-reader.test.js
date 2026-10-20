const { ethers } = require('hardhat');
const assert = require('node:assert/strict');

describe('V2 canonical web reader local integration', function () {
  it('reads the actual canonical pair and posted job at one pinned block', async function () {
    const { createV2ChainReader } = await import('../../web/lib/v2/server/chain-reader.mjs');
    const { build, decoder } = require('../scripts/approved-v2-executor');
    const [owner, treasury, resolver] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory('MockUSDC')).deploy(); await token.waitForDeployment();
    const nonce = await owner.getNonce();
    const predictedMarket = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 1 });
    const vault = await (await ethers.getContractFactory('OperatorCollateralVaultV2')).deploy(await token.getAddress(), predictedMarket, treasury.address); await vault.waitForDeployment();
    const market = await (await ethers.getContractFactory('AgentMarketplaceV2')).deploy(await token.getAddress(), owner.address, treasury.address, await vault.getAddress()); await market.waitForDeployment();
    await (await market.setResolverForClient(owner.address, resolver.address)).wait();
    await (await token.mint(owner.address, 1_000_000)).wait();
    await (await token.approve(await market.getAddress(), 1_000_000)).wait();
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const hash = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));
    const applyBy = now + 7200;
    const tx = await market.postJob(1_000_000, applyBy, 3600, 86400, 43200, 2, false, hash('criteria'), hash('description'), false);
    const receipt = await tx.wait();
    const transport = (method, params) => ethers.provider.send(method, params);
    const reader = createV2ChainReader({ transport, chainId: 31337n, marketplace: await market.getAddress(), vault: await vault.getAddress(), localTestConfig: true, token: await token.getAddress(), treasury: treasury.address });
    const snapshot = await reader.read();
    const job = await snapshot.readJob(1n);
    assert.equal(job.client.toLowerCase(), owner.address.toLowerCase());
    assert.equal(job.reward, 1_000_000n);
    assert.equal(job.status, 0);
    const canonical = await decoder(build('AgentMarketplaceV2').meta, await market.getAddress(), ethers.provider)(1n, snapshot.blockTag);
    const normalize = value => typeof value === 'bigint' ? value : typeof value === 'string' && value.startsWith('0x') ? value.toLowerCase() : value;
    assert.deepEqual(Object.fromEntries(Object.keys(canonical).map(key => [key, normalize(canonical[key])])), Object.fromEntries(Object.keys(job).map(key => [key, normalize(typeof job[key] === 'number' ? BigInt(job[key]) : job[key])])), 'reader/storage decoder field mismatch');
    const termsLog = receipt.logs.map((log) => { try { return market.interface.parseLog(log); } catch { return null; } }).find((log) => log?.name === 'JobTerms');
    assert.ok(termsLog);
    const { canonicalTermsHash, V2_TERMS_SCHEMA } = await import('../../web/lib/v2/terms.mjs');
    assert.equal(job.canonicalTermsHash, canonicalTermsHash({
      token: await token.getAddress(), vault: await vault.getAddress(), resolver: resolver.address,
      reward: 1_000_000n, feeBps: 500n, treasury: treasury.address, minReward: 1_000_000n,
      deliveryDuration: 3600n, reviewDuration: 86400n, revisionDuration: 43200n,
      maxExtensionTotal: 180n * 86400n, stakeFloor: 5_000_000n, stakeRound: 10_000n,
      collateralBps: 1000n, schema: V2_TERMS_SCHEMA, revisionLimit: 2,
      unlimitedRevisions: false, applyBy: BigInt(applyBy), criteriaHash: hash('criteria'), descriptionHash: hash('description'), testJob: false
    }));
    assert.equal(job.canonicalTermsHash, termsLog.args.canonicalTermsHash);
    assert.equal(snapshot.getters.usdc.toLowerCase(), (await token.getAddress()).toLowerCase());
    assert.equal(snapshot.getters.collateralVault.toLowerCase(), (await vault.getAddress()).toLowerCase());
    assert.ok(snapshot.blockTag.startsWith('0x'));
    const account = await snapshot.readAccount(owner.address);
    assert.equal(account.nonceEpoch, await market.nonceEpoch(owner.address));
    assert.equal(await account.applicationNonce(1n), await market.applicationNonce(1n, owner.address));
    await assert.rejects(() => snapshot.readJob(0n), /positive/);
    await assert.rejects(() => snapshot.readJob(1n << 256n), /uint256/);
  });

  it('reads private client policy mappings and rejects a changed pinned block on lazy reads', async function () {
    const { createV2ChainReader } = await import('../../web/lib/v2/server/chain-reader.mjs');
    const [owner, treasury, resolver, operator] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory('MockUSDC')).deploy(); await token.waitForDeployment();
    const nonce = await owner.getNonce();
    const predictedMarket = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 1 });
    const vault = await (await ethers.getContractFactory('OperatorCollateralVaultV2')).deploy(await token.getAddress(), predictedMarket, treasury.address); await vault.waitForDeployment();
    const market = await (await ethers.getContractFactory('AgentMarketplaceV2')).deploy(await token.getAddress(), owner.address, treasury.address, await vault.getAddress()); await market.waitForDeployment();
    await (await market.setResolverForClient(owner.address, resolver.address)).wait();
    await (await market.setHouse(owner.address, true)).wait();
    await (await market.setTestClient(owner.address, true)).wait();
    let changed = false;
    const original = (method, params) => ethers.provider.send(method, params);
    const transport = async (method, params) => {
      if (method === 'eth_getBlockByNumber' && changed) return { hash: '0x' + '22'.repeat(32) };
      return original(method, params);
    };
    const reader = createV2ChainReader({ transport, chainId: 31337n, marketplace: await market.getAddress(), vault: await vault.getAddress(), localTestConfig: true, token: await token.getAddress(), treasury: treasury.address });
    const snapshot = await reader.read();
    assert.equal((await snapshot.readClientPolicy(owner.address)).listedHouse, true);
    changed = true;
    await assert.rejects(() => snapshot.readJob(1n), /SNAPSHOT_CHANGED/);
  });
});
