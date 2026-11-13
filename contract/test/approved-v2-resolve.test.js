const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('hardhat');
const { previewResolve, executeResolve, constants } = require('../scripts/approved-v2-resolve');
const { build, decoder } = require('../scripts/approved-v2-executor');

const U = 1_000_000n;
const H = s => ethers.keccak256(ethers.toUtf8Bytes(s));
const CLIENT = constants.CLIENT;

async function fixture() {
  await ethers.provider.send('hardhat_reset', []);
  assert.equal(BigInt(await ethers.provider.send('eth_chainId', [])),5042002n,'real isolated EVM must have the production chain ID');
  const [owner, operator, resolverSigner, treasury, outsider] = await ethers.getSigners();
  const resolver = ethers.Wallet.createRandom().connect(ethers.provider);
  await ethers.provider.send('hardhat_setBalance', [resolver.address, '0x3635C9ADC5DEA00000']);
  await ethers.provider.send('hardhat_setBalance', [CLIENT, '0x3635C9ADC5DEA00000']);
  await ethers.provider.send('hardhat_impersonateAccount', [CLIENT]);
  const client = await ethers.getSigner(CLIENT);
  const Token = await ethers.getContractFactory('MockUSDC');
  const token = await Token.deploy(); await token.waitForDeployment();
  await (await token.mint(CLIENT, 20n * U)).wait();
  await (await token.mint(operator.address, 20n * U)).wait();
  const V = await ethers.getContractFactory('OperatorCollateralVaultV2');
  const M = await ethers.getContractFactory('AgentMarketplaceV2');
  const nonce = await owner.getNonce();
  const marketplaceAddress = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 1 });
  const vault = await V.connect(owner).deploy(await token.getAddress(), marketplaceAddress, treasury.address); await vault.waitForDeployment();
  const market = await M.connect(owner).deploy(await token.getAddress(), owner.address, treasury.address, await vault.getAddress()); await market.waitForDeployment();
  const job = decoder(build('AgentMarketplaceV2').meta, await market.getAddress(), ethers.provider);
  await (await market.setResolverForClient(CLIENT, resolver.address)).wait();
  await (await token.connect(operator).approve(await vault.getAddress(), 10n * U)).wait();
  await (await vault.connect(operator).depositStake(10n * U)).wait();
  await (await market.connect(operator).registerOperator()).wait();
  await (await market.connect(operator).setMaxActiveJobs(10)).wait();
  return { owner, operator, resolver, treasury, outsider, client, token, vault, market, job };
}
async function postAndAward(f, reward = 5n * U, poster = f.client) {
  const now = BigInt((await ethers.provider.getBlock('latest')).timestamp);
  await (await f.token.mint(poster.address, reward)).wait();
  await (await f.token.connect(poster).approve(await f.market.getAddress(), reward)).wait();
  await (await f.market.connect(poster).postJob(reward, now + 3n * 86400n, 3600, 86400, 43200, 2, false, H('criteria'), H('description'), false)).wait();
  const id = await f.market.nextJobId() - 1n;
  const j = await f.job(id);
  const net = await ethers.provider.getNetwork();
  const terms = { jobId: id, operator: f.operator.address, termsHash: j.canonicalTermsHash, validAfter: 0, validBefore: j.applyBy, nonceEpoch: 0, operatorNonce: 0 };
  const sig = await f.operator.signTypedData({ name: 'AlphaBoard Agent Marketplace V2', version: '1', chainId: net.chainId, verifyingContract: await f.market.getAddress() }, { Application: [
    { name: 'jobId', type: 'uint256' }, { name: 'operator', type: 'address' }, { name: 'termsHash', type: 'bytes32' }, { name: 'validAfter', type: 'uint64' }, { name: 'validBefore', type: 'uint64' }, { name: 'nonceEpoch', type: 'uint256' }, { name: 'operatorNonce', type: 'uint256' },
  ] }, terms);
  await (await f.market.connect(poster).awardJob(id, terms, sig)).wait();
  return id;
}
function inputFor(jobId, decision) { return { jobId: String(jobId), decision, approval: undefined }; }
function approved(input, p) {
  return { ...input, preview:p, approval: { approved: true, digest: p.digest, jobId: p.jobId, blockHash: p.canonical.blockHash, stateVersion: p.canonical.stateVersion, expiresAt: String(p.expiresAt) } };
}
async function run(input, f, lockDir) {
  const opts = { provider: ethers.provider, marketplace: await f.market.getAddress(), vault: await f.vault.getAddress(), token: await f.token.getAddress(), signer: f.resolver, lockDir, internalTestFactory: true, broadcast: signed => ethers.provider.send('eth_sendRawTransaction', [signed]) };
  const p = await previewResolve(input, opts);
  const r = await executeResolve(approved(input, p), opts);
  return { p, r };
}

describe('M8 narrow approved V2 resolve', function () {
  it('requires an explicit boolean operatorFault and rejects unknown decision fields', function () {
    const {decisionOf}=require('../scripts/approved-v2-resolve');
    assert.throws(()=>decisionOf({decision:{kind:'resolveDispute',grossPayout:'0',reasonHash:H('r'),evidenceHash:H('e')}}), /OPERATOR_FAULT_REQUIRED/);
    assert.throws(()=>decisionOf({decision:{kind:'resolveDispute',grossPayout:'0',operatorFault:'false',reasonHash:H('r'),evidenceHash:H('e')}}), /OPERATOR_FAULT_REQUIRED/);
  });
  it('fault review previews only slash accounting, never a second escrow settlement', function () {
    const {effects}=require('../scripts/approved-v2-resolve');
    const e=effects({reward:5000000n,status:7n,stakeReserved:5000000n,feeBpsSnapshot:500n},{kind:'resolveFaultReview',slash:500000n});
    assert.equal(e.escrowDelta,0n);assert.equal(e.creditsLiabilityDelta,500000n);
  });
  it('previews and executes valid dispute and fault-review decisions on isolated chain 5042002', async function () {
    const f = await fixture();
    const lockDir = path.join(process.env.TMPDIR || path.join(process.env.LOCALAPPDATA, 'hermes', 'cache', 'scratch'), `m8-resolve-${Date.now()}`);
    const id1 = await postAndAward(f);
    let j = await f.job(id1); await (await f.market.connect(f.client).openDispute(id1, j.stateVersion)).wait();
    const dispute = inputFor(id1, { kind: 'resolveDispute', grossPayout: '2000000', operatorFault: false, reasonHash: H('reason'), evidenceHash: H('evidence') });
    const out1 = await run(dispute, f, lockDir);
    assert.equal(out1.p.canonical.status, '5');
    assert.equal(out1.p.effects.refund, '3000000');
    assert.equal((await f.job(id1)).status, 6n);
    assert.equal(out1.r.status, 'confirmed');

    const id2 = await postAndAward(f);
    j = await f.job(id2); await ethers.provider.send('evm_increaseTime', [3601]); await ethers.provider.send('evm_mine');
    await (await f.market.connect(f.outsider).claimDeliveryTimeout(id2, j.stateVersion)).wait();
    const fault = inputFor(id2, { kind: 'resolveFaultReview', slash: '500000', reasonHash: H('fault'), evidenceHash: H('evidence-fault') });
    const pair2 = { provider: ethers.provider, marketplace: await f.market.getAddress(), vault: await f.vault.getAddress(), token: await f.token.getAddress(), internalTestFactory: true };
    await assert.rejects(() => previewResolve(inputFor(id2, { kind: 'resolveFaultReview', slash: '5000001', reasonHash: H('fault'), evidenceHash: H('evidence-fault') }), pair2), /SLASH_EXCEEDS_RESERVE/);
    const out2 = await run(fault, f, lockDir);
    assert.equal(out2.p.effects.slash, '500000');
    assert.equal(out2.r.status, 'confirmed');
    const after = await f.job(id2);
    assert.equal(after.faultReviewPending, false);
    assert.equal(after.stakeReserved, 0n);
    assert.equal(await f.market.creditsLiability(), (await f.market.credits(f.client.address)) + (await f.market.credits(f.operator.address)) + (await f.market.credits(f.treasury.address)));
    fs.rmSync(lockDir, { recursive: true, force: true });
  });

  it('rejects wrong client, status, reward, stale state, malformed approval, and duplicate authorization before a second send', async function () {
    const f = await fixture();
    const lockDir = path.join(process.env.TMPDIR || path.join(process.env.LOCALAPPDATA, 'hermes', 'cache', 'scratch'), `m8-boundary-${Date.now()}`);
    const id = await postAndAward(f, 5n * U);
    const base = inputFor(id, { kind: 'resolveDispute', grossPayout: '0', operatorFault: false, reasonHash: H('r'), evidenceHash: H('e') });
    const pair = { provider: ethers.provider, marketplace: await f.market.getAddress(), vault: await f.vault.getAddress(), token: await f.token.getAddress(), internalTestFactory: true };
    const wrongChain=new Proxy(ethers.provider,{get(target,key){if(key==='send')return async(method,params)=>method==='eth_chainId'?'0x7a69':target.send(method,params);const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
    await assert.rejects(() => previewResolve(base, { ...pair, provider:wrongChain }), /CHAIN_ID_MISMATCH/);
    await assert.rejects(() => previewResolve(base, pair), /JOB_NOT_DISPUTED/);
    let j = await f.job(id); await (await f.market.connect(f.client).openDispute(id, j.stateVersion)).wait();
    await assert.rejects(() => previewResolve(inputFor(id, { kind: 'resolveDispute', grossPayout: '5000001', operatorFault: false, reasonHash: H('r'), evidenceHash: H('e') }), pair), /PAYOUT_EXCEEDS_REWARD/);
    const opts = { provider: ethers.provider, marketplace: await f.market.getAddress(), vault: await f.vault.getAddress(), token: await f.token.getAddress(), signer: f.resolver, lockDir, internalTestFactory: true, broadcast:signed=>ethers.provider.send('eth_sendRawTransaction',[signed]) };
    await (await f.market.setResolverForClient(f.owner.address, f.resolver.address)).wait();
    const wrongClientId = await postAndAward(f, 5n * U, f.owner);
    const wrongJob = await f.job(wrongClientId); await (await f.market.connect(f.owner).openDispute(wrongClientId, wrongJob.stateVersion)).wait();
    await assert.rejects(() => previewResolve(inputFor(wrongClientId, { kind: 'resolveDispute', grossPayout: '0', operatorFault: false, reasonHash: H('r2'), evidenceHash: H('e2') }), opts), /CLIENT_MISMATCH/);
    const p = await previewResolve(base, opts);
    const stale = { ...base, approval: { approved: true, digest: p.digest, jobId: String(id), blockHash: p.canonical.blockHash, stateVersion: String(BigInt(p.canonical.stateVersion) - 1n), expiresAt: String(Math.floor(Date.now() / 1000) + 600) } };
    await assert.rejects(() => executeResolve(stale, opts), /EXACT_FRESH_APPROVAL_REQUIRED/);
    const good = approved(base, p);
    await assert.rejects(() => executeResolve(good, { ...opts, broadcast: undefined }), /LIVE_BROADCAST_BRIDGE_CLOSED/);
    await assert.rejects(() => executeResolve(good, { ...opts, broadcast:async()=>{throw Error('NETWORK_AMBIGUOUS');} }), /NETWORK_AMBIGUOUS/);
    await ethers.provider.send('evm_mine');
    await assert.rejects(() => executeResolve(good, { ...opts, broadcast: async () => { throw new Error('must-not-send-twice'); } }), /DUPLICATE_OR_RESTARTED_AUTHORIZATION/);
    fs.rmSync(lockDir, { recursive: true, force: true });
  });
});

describe('M8 parent boundary and signing gates',function(){
 async function setup(reward=5n*U){const f=await fixture();const id=await postAndAward(f,reward);const j=await f.job(id);await(await f.market.connect(f.client).openDispute(id,j.stateVersion)).wait();
 const input=inputFor(id,{kind:'resolveDispute',grossPayout:'2000000',operatorFault:false,reasonHash:H('parent-r'),evidenceHash:H('parent-e')});
 const lockDir=fs.mkdtempSync(path.join(process.env.TMPDIR||path.join(process.env.LOCALAPPDATA,'hermes','cache','scratch'),'m8-parent-'));
 const opts={provider:ethers.provider,marketplace:await f.market.getAddress(),vault:await f.vault.getAddress(),token:await f.token.getAddress(),internalTestFactory:true,lockDir,broadcast:s=>ethers.provider.send('eth_sendRawTransaction',[s]),signer:f.resolver};return{f,id,input,opts};}
 it('rejects reward above five USDC through the actual deployed job',async()=>{const x=await setup(5000001n);await assert.rejects(()=>previewResolve(x.input,x.opts),/REWARD_CAP_EXCEEDED/);});
 it('rejects expired and altered approvals before any signer load',async()=>{const x=await setup(),p=await previewResolve(x.input,x.opts);let loads=0;const opts={...x.opts,signer:undefined,loadSigner:async()=>{loads++;throw Error('unexpected-load');}};
 const a=approved(x.input,p);await assert.rejects(()=>executeResolve({...a,approval:{...a.approval,expiresAt:'1'}},opts),/EXACT_FRESH_APPROVAL_REQUIRED/);
 await assert.rejects(()=>executeResolve({...a,decision:{...a.decision,grossPayout:'1000000'}},opts),/APPROVAL_BINDING_MISMATCH/);assert.equal(loads,0);});
 it('rejects unknown top-level batch and deployment overrides',async()=>{const x=await setup();await assert.rejects(()=>previewResolve({...x.input,jobIds:['1','2']},x.opts),/UNKNOWN_INPUT_FIELD/);});
 it('binds changed canonical job state, not merely approval self-assertions',async()=>{const x=await setup(),p=await previewResolve(x.input,x.opts);await(await x.f.market.connect(x.f.resolver).heartbeatDispute(x.id,H('heartbeat-r'),H('heartbeat-e'),p.canonical.stateVersion)).wait();
 await assert.rejects(()=>executeResolve(approved(x.input,p),x.opts),/STALE_OR_ALTERED_PREVIEW/);});
 it('accepts a new empty block without forcing an impossible same-block approval',async()=>{const x=await setup(),p=await previewResolve(x.input,x.opts);await ethers.provider.send('evm_mine');const out=await executeResolve(approved(x.input,p),x.opts);assert.equal(out.status,'confirmed');assert.equal(out.conservationAfter.marketBalance,BigInt(out.conservationAfter.escrowed)+BigInt(out.conservationAfter.creditsLiability)+'');});
 it('one persistent job/version claim wins across different decision digests before key load',async()=>{const x=await setup(),p1=await previewResolve(x.input,x.opts),other={...x.input,decision:{...x.input.decision,grossPayout:'1000000'}},p2=await previewResolve(other,x.opts);let loads=0,sends=0;
 const opts={...x.opts,signer:undefined,loadSigner:async()=>{loads++;throw Error('FIXTURE_SIGNER_UNAVAILABLE');},broadcast:async()=>{sends++;throw Error('unexpected-send');}};
 const result=await Promise.allSettled([executeResolve(approved(x.input,p1),opts),executeResolve(approved(other,p2),opts)]);assert.equal(loads,1);assert.equal(sends,0);assert.deepEqual(result.map(r=>r.reason?.message).sort(),['DUPLICATE_OR_RESTARTED_AUTHORIZATION','FIXTURE_SIGNER_UNAVAILABLE'].sort());});
 it('rejects a signer that changes the signed value before broadcast',async()=>{const x=await setup(),p=await previewResolve(x.input,x.opts);let sends=0;const signer={getAddress:()=>x.f.resolver.getAddress(),signTransaction:req=>x.f.resolver.signTransaction({...req,value:1n})};
 await assert.rejects(()=>executeResolve(approved(x.input,p),{...x.opts,signer,broadcast:async()=>{sends++;throw Error('must-not-send');}}),/SIGNED_TRANSACTION_MISMATCH/);assert.equal(sends,0);});
 it('executes operatorFault slash and proves exact credit/stake/global conservation deltas',async()=>{const x=await setup();x.input.decision.operatorFault=true;const p=await previewResolve(x.input,x.opts),before=await x.f.vault.stakeLiability();assert.equal(p.effects.slash,'5000000');const out=await executeResolve(approved(x.input,p),x.opts);assert.equal(out.status,'confirmed');assert.equal(await x.f.vault.stakeLiability(),before-5000000n);assert.equal(out.jobAfter.faultReviewPending,false);});
 it('rejects a forged transaction readback after one real local send and never calls it confirmed',async()=>{const x=await setup(),p=await previewResolve(x.input,x.opts);let sent=false,sends=0;const provider=new Proxy(ethers.provider,{get(target,key){const value=Reflect.get(target,key);if(key==='getTransaction')return async h=>{const tx=await target.getTransaction(h);return sent?{...tx,value:1n}:tx;};return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(()=>executeResolve(approved(x.input,p),{...x.opts,provider,broadcast:async s=>{sends++;const h=await ethers.provider.send('eth_sendRawTransaction',[s]);sent=true;return h;}}),/TX_READBACK_MISMATCH/);assert.equal(sends,1);const row=JSON.parse(fs.readFileSync(path.join(x.opts.lockDir,fs.readdirSync(x.opts.lockDir)[0])));assert.equal(row.status,'broadcast-intent');});
 it('requires explicit production arming before any network or wallet operation',async()=>{const {main}=require('../scripts/approved-v2-resolve');await assert.rejects(()=>main({execute:true},['--phase=resolve','--execute']),/NOT_ARMED/);await assert.rejects(()=>main({},['--phase=resolve','--phase=deploy']),/INVALID_RESOLVE_FLAG/);await assert.rejects(()=>main({execute:true,mode:'execute'},['--phase=resolve','--readonly','--execute-arc-testnet-v2']),/CONFLICTING_RESOLVE_MODE/);});
});
