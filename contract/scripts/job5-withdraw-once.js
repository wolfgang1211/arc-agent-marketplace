'use strict';
const fs=require('fs'),path=require('path');
const serialize = (value, unused, indent) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, indent);
const {JsonRpcProvider,Contract,Interface,getAddress,keccak256}=require('ethers');
const CHAIN_ID=5042002n,RPC_URL='https://rpc.testnet.arc.io',MARKET='0xFA156B7A5205B123c8a22A807ba98405e36130f1',VAULT='0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423',TOKEN='0x3600000000000000000000000000000000000000',CLIENT='0x64b223aa99f0a1e3cd151fb982e2fff9255035c8',CREDIT=6000000n,GAS_LIMIT=500000n,GAS_PRICE=45000000000n;
const STATE=path.join(require('os').homedir(),'AppData','Local','hermes','state','alphaboard-v2','job5-withdraw-20261020.json');
const MARKET_ABI=['function withdrawCredit()','function credits(address) view returns(uint256)','function creditsLiability() view returns(uint256)','function escrowed() view returns(uint256)','function jobs(uint256) view returns(address,address,uint128,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint256,address,uint256,uint8,uint256,uint8,uint8,bool,bool,bool,uint8,bytes32,bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint256,uint8,uint8,address,bool,bool,uint8,bytes32,bytes32)','function usdc() view returns(address)','function collateralVault() view returns(address)','function name() view returns(string)','function version() view returns(string)'];
const TOKEN_ABI=['function balanceOf(address) view returns(uint256)'],VAULT_ABI=['function token() view returns(address)','function marketplace() view returns(address)','function freeStake(address) view returns(uint256)','function reservedStake(address) view returns(uint256)','function stakeLiability() view returns(uint256)'];
const withdrawData=new Interface(['function withdrawCredit()']).encodeFunctionData('withdrawCredit',[]),dataHash=keccak256(withdrawData),TRANSFER_TOPIC=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']).getEvent('Transfer').topicHash;
function err(c){const e=new Error(c);e.code=/^[A-Z][A-Z0-9_]{2,79}$/.test(String(c))?String(c):'EXECUTION_STOPPED';return e} function assert(x,c){if(!x)throw err(c)} function big(x){return BigInt(x??0)} function addr(x,c='ADDRESS_INVALID'){try{return getAddress(x)}catch{throw err(c)}} function json(f){return JSON.parse(fs.readFileSync(f,'utf8'))} function status7(x){return x==='Refunded'||x===7||x==='7'||Number(x)===7}
function attestCanonical({chainId,rpc,market,vault,token,client}){assert(big(chainId)===CHAIN_ID,'CHAIN_ID_MISMATCH');assert(rpc===RPC_URL,'RPC_MISMATCH');assert(addr(market).toLowerCase()===MARKET.toLowerCase(),'MARKET_MISMATCH');assert(addr(vault).toLowerCase()===VAULT.toLowerCase(),'VAULT_MISMATCH');assert(addr(token).toLowerCase()===TOKEN,'TOKEN_MISMATCH');assert(addr(client).toLowerCase()===CLIENT,'CLIENT_MISMATCH');return Object.freeze({chainId:String(CHAIN_ID),rpc:RPC_URL,market:MARKET,vault:VAULT,token:TOKEN,client:CLIENT,decimals:6,nativeDecimals:18})}
async function attestRuntime(p) {
  const E = require('ethers');
  const approved = require('./approved-v2-executor');
  const d = json(path.join(__dirname, '../docs/v2-testnet-deployment.json'));
  attestCanonical({chainId: await p.send('eth_chainId', []), rpc: RPC_URL, market: d.pair.marketplace, vault: d.pair.vault, token: d.token.address, client: d.roles.testClient2});
  const M = approved.build('AgentMarketplaceV2'), V = approved.build('OperatorCollateralVaultV2');
  const domain = {name:'AlphaBoard Agent Marketplace V2', version:'1', chainId:CHAIN_ID, verifyingContract:MARKET};
  const H = text => E.keccak256(E.toUtf8Bytes(text));
  const market = await approved.attest(p, MARKET, M, {usdc:TOKEN, collateralVault:VAULT, _cachedDomainSeparator:E.TypedDataEncoder.hashDomain(domain), _cachedChainId:CHAIN_ID, _cachedThis:MARKET, _hashedName:H(domain.name), _hashedVersion:H(domain.version), _name:domain.name, _version:domain.version});
  const vault = await approved.attest(p, VAULT, V, {token:TOKEN, marketplace:MARKET, treasury:d.roles.treasury});
  const contract = new Contract(MARKET, M.a.abi, p);
  const actualDomain = await contract.eip712Domain();
  assert(actualDomain[1] === domain.name && actualDomain[2] === domain.version && actualDomain[3] === CHAIN_ID && actualDomain[4].toLowerCase() === MARKET.toLowerCase(), 'DOMAIN_IMMUTABLE_MISMATCH');
  return {market, vault, pair:{marketplace:MARKET, vault:VAULT}};
}
function validateSnapshot(s, expectedCredit=CREDIT){assert(s&&typeof s==='object','SNAPSHOT_INVALID');assert(big(s.chainId)===CHAIN_ID,'CHAIN_ID_MISMATCH');assert(big(s.latestNonce)===big(s.pendingNonce),'PENDING_NONCE_NOT_LATEST');assert(big(s.credit)===expectedCredit,'CREDIT_NOT_EXACT');assert(s.job&&status7(s.job.status),'JOB_NOT_REFUNDED');assert(big(s.job.reserved)===0n,'JOB_RESERVED_NONZERO');assert(addr(s.from).toLowerCase()===CLIENT,'SIGNER_ADDRESS_MISMATCH');return s}
function makeIntent({nonce,from,blockNumber,gasLimit=GAS_LIMIT,gasPrice}){return Object.freeze({scenario:'timeout-withdraw-testClient2',chainId:String(CHAIN_ID),from:addr(from),to:MARKET,nonce:Number(nonce),dataHash,value:'0',gasLimit:String(gasLimit),gasPrice:String(gasPrice),intendedBlock:Number(blockNumber)})}
function createAttemptStore(file=STATE){return{file,reserve(intent){assert(!fs.existsSync(file),'ATTEMPT_ALREADY_CONSUMED');fs.mkdirSync(path.dirname(file),{recursive:true});const r={status:'armed',createdAt:new Date().toISOString(),intent};const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,serialize(r,null,2))}finally{fs.closeSync(fd)}return r},update(p){const c=json(file);fs.writeFileSync(file,serialize({...c,...p},null,2))}}}
async function freshRead(p, s, reader, tag) {
  if (reader) return reader(tag);
  const approved = require('./approved-v2-executor');
  const spec = approved.build('AgentMarketplaceV2');
  const d = json(path.join(__dirname, '../docs/v2-testnet-deployment.json'));
  const job = approved.decoder(spec.meta, MARKET, p);
  const from = await s.getAddress();
  const block = await p.getBlock(tag ?? 'latest');
  assert(block && Number.isSafeInteger(block.number), 'BLOCK_READ_FAILED');
  const t = block.number, ov = {blockTag:t};
  const m = new Contract(MARKET, spec.a.abi, p);
  const token = new Contract(TOKEN, TOKEN_ABI, p);
  const v = new Contract(VAULT, VAULT_ABI, p);
  const chainId = await p.send('eth_chainId', []);
  const latestNonce = await p.getTransactionCount(from, 'latest');
  const pendingNonce = await p.getTransactionCount(from, 'pending');
  const j = await job(5, t);
  const credit = await m.credits(CLIENT, ov);
  const native = await p.getBalance(CLIENT, t);
  const erc20 = await token.balanceOf(CLIENT, ov);
  const marketBalance = await token.balanceOf(MARKET, ov);
  const escrowed = await m.escrowed(ov);
  const creditsLiability = await m.creditsLiability(ov);
  const vaultBalance = await token.balanceOf(VAULT, ov);
  let freeStake=0n, reservedStake=0n, activeJobs=0n;
  for (const account of Object.values(d.roles)) {
    freeStake += await v.freeStake(account, ov);
    reservedStake += await v.reservedStake(account, ov);
    activeJobs += await m.activeJobs(account, ov);
  }
  const stakeLiability = await v.stakeLiability(ov);
  return {chainId:big(chainId), latestNonce, pendingNonce, blockNumber:t, credit, from, job:{status:Number(j.status), reserved:j.stakeReserved}, balances:{native, erc20, marketBalance, escrowed, creditsLiability, vaultBalance, freeStake, reservedStake, stakeLiability, activeJobs}};
}
function conserve(a,b,g) {
  assert(big(b.native)===big(a.native)+6000000000000000000n-big(g),'NATIVE_CONSERVATION_FAILED');
  assert(big(b.marketBalance)===0n&&big(b.creditsLiability)===0n&&big(b.escrowed)===0n,'MARKET_ACCOUNTING_NONZERO');
  assert(big(b.vaultBalance)===big(b.freeStake)+big(b.reservedStake)&&big(b.reservedStake)===0n&&big(b.stakeLiability)===big(b.freeStake),'VAULT_ACCOUNTING_MISMATCH');
  assert(big(a.vaultBalance)===5000000n&&big(a.freeStake)===5000000n&&big(b.vaultBalance)===5000000n&&big(b.freeStake)===5000000n&&big(a.vaultBalance)===big(b.vaultBalance)&&big(a.freeStake)===big(b.freeStake),'VAULT_POSTCONDITION_FAILED');
  assert(big(b.activeJobs)===0n,'ACTIVE_JOBS_NONZERO');
}
async function executeJob5WithdrawOnce({provider,signer,store,reader,dryRun=false,waitReceipt=true,broadcast=provider?.send?.bind(provider),attestation}){assert(provider&&signer&&store,'DEPENDENCY_INVALID');const att=attestation||(reader?{injected:true}:await attestRuntime(provider));const initial=validateSnapshot(await freshRead(provider,signer,reader));if(dryRun)return{status:'readonly-preflight',attestation:att,snapshot:initial};const fee=big((await provider.getFeeData()).gasPrice);assert(fee>0n&&fee<=GAS_PRICE,'GAS_PRICE_CAP_EXCEEDED');let intent=makeIntent({nonce:initial.latestNonce,from:initial.from,blockNumber:initial.blockNumber,gasLimit:GAS_LIMIT,gasPrice:fee});store.reserve(intent);try{const est=big(await provider.estimateGas({from:initial.from,to:MARKET,data:withdrawData,value:0n})),limit=(est*12n+9n)/10n;assert(limit<=GAS_LIMIT,'GAS_LIMIT_EXCEEDED');assert(big(await provider.getBalance(initial.from))>=limit*fee,'INSUFFICIENT_NATIVE_GAS_RESERVE');intent=makeIntent({nonce:initial.latestNonce,from:initial.from,blockNumber:initial.blockNumber,gasLimit:limit,gasPrice:fee});store.update({intent});const cur=validateSnapshot(await freshRead(provider,signer,reader));assert(big(cur.latestNonce)===big(intent.nonce)&&big(cur.pendingNonce)===big(intent.nonce),'NONCE_CHANGED');const tx={type:0,chainId:Number(CHAIN_ID),nonce:intent.nonce,to:MARKET,data:withdrawData,value:0n,gasLimit:limit,gasPrice:fee},signed=await signer.signTransaction(tx),signedHash=keccak256(signed);store.update({status:'broadcast-intent',signedTxHash:signedHash,txHash:signedHash});const h=await broadcast('eth_sendRawTransaction',[signed]);assert(typeof h==='string'&&/^0x[0-9a-f]{64}$/i.test(h),'BROADCAST_HASH_INVALID');assert(h.toLowerCase()===signedHash.toLowerCase(),'BROADCAST_HASH_MISMATCH');store.update({status:'broadcast',txHash:h});if(!waitReceipt)return{status:'broadcast',txHash:h,intent,attestation:att};const rec=await waitForReceipt(provider,h,120000);assert(rec&&Number(rec.status)===1,'RECEIPT_FAILED');const gas=big(rec.gasUsed)*big(rec.effectiveGasPrice||fee),block=Number(rec.blockNumber),txr=await provider.getTransaction(h);assert(txr&&addr(txr.from).toLowerCase()===CLIENT&&Number(txr.chainId)===Number(CHAIN_ID)&&Number(txr.nonce)===intent.nonce&&addr(txr.to).toLowerCase()===MARKET.toLowerCase()&&txr.data.toLowerCase()===withdrawData.toLowerCase()&&big(txr.value)===0n,'TX_READBACK_MISMATCH');const log=(rec.logs||[]).find(l=>l.address?.toLowerCase()===TOKEN&&l.topics?.[0]===TRANSFER_TOPIC&&l.topics?.[1]?.slice(-40).toLowerCase()===MARKET.slice(2).toLowerCase()&&l.topics?.[2]?.slice(-40).toLowerCase()===CLIENT.slice(2).toLowerCase());assert(log&&big(log.data)===CREDIT,'CREDIT_TRANSFER_MISSING');const post=validateSnapshot(await freshRead(provider,signer,reader,block),0n);conserve(initial.balances,post.balances,gas);const receipt={txHash:h,blockNumber:block,status:1,gasUsed:String(rec.gasUsed),gasPrice:String(rec.effectiveGasPrice||fee),gasCostRaw:String(gas)};store.update({status:'confirmed',receipt,verification:{attestation:att,pre:initial,post,accounting:post.balances,transferRaw:String(CREDIT),gasCostRaw:String(gas),conservation:true}});return{status:'confirmed',txHash:h,receipt,intent,verification:{pre:initial,post,gasCostRaw:String(gas)}}}catch(e){const c=/^[A-Z][A-Z0-9_]{2,79}$/.test(String(e.code||''))?e.code:'EXECUTION_STOPPED';store.update({status:'stopped',errorCode:c});throw err(c)}}
async function waitForReceipt(p,h,t){const s=Date.now();while(Date.now()-s<t){const r=await p.getTransactionReceipt(h);if(r)return r;await new Promise(x=>setTimeout(x,250))}throw err('RECEIPT_TIMEOUT_PENDING')}
function buildLiveContext(password, suppliedProvider){assert(typeof password==='string','PASSWORD_MISSING');const provider=suppliedProvider||new JsonRpcProvider(RPC_URL,Number(CHAIN_ID),{batchMaxCount:1,cacheTimeout:-1,staticNetwork:false}),worker=require('./keystore/v2-keystore-worker');return worker.loadRuntimeWallet({op:'decrypt',role:'testClient2',password}).then(w=>({provider,signer:w.connect(provider)}))}
module.exports={CHAIN_ID,RPC_URL,MARKET,VAULT,TOKEN,CLIENT,CREDIT,GAS_LIMIT,GAS_PRICE,withdrawData,dataHash,attestCanonical,attestRuntime,validateSnapshot,makeIntent,createAttemptStore,freshRead,executeJob5WithdrawOnce,waitForReceipt,buildLiveContext,STATE};
if(require.main===module)(async()=>{let raw='';for await(const c of process.stdin)raw+=c;const input=raw?JSON.parse(raw):{mode:'readonly'};assert(Object.keys(input).every(k=>['mode','password'].includes(k)),'UNKNOWN_INPUT');const p=new JsonRpcProvider(RPC_URL,Number(CHAIN_ID),{batchMaxCount:1,cacheTimeout:-1,staticNetwork:false});try{if(input.mode!=='execute'){const r=await executeJob5WithdrawOnce({provider:p,signer:{getAddress:async()=>CLIENT},store:createAttemptStore(STATE),dryRun:true});process.stdout.write(serialize({status:r.status,attestation:r.attestation,snapshot:r.snapshot}));return}const {signer}=await buildLiveContext(input.password,p);input.password='';const r=await executeJob5WithdrawOnce({provider:p,signer,store:createAttemptStore(STATE)});process.stdout.write(serialize({status:r.status,txHash:r.txHash,intent:r.intent,verification:r.verification}))}finally{p.destroy()}})().catch(()=>{process.stdout.write(serialize({status:'error',errorCode:'JOB5_WITHDRAW_STOPPED'}));process.exitCode=1});