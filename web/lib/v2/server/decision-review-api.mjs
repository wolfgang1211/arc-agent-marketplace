import { ARC_TESTNET_PROFILE, assertV2Profile } from '../chain-profile.mjs';
import { calculateDecisionEconomics, uint } from '../decision-economics.mjs';
const ADDRESS=/^0x[0-9a-fA-F]{40}$/, HASH=/^0x[0-9a-fA-F]{64}$/, UINT=/^(?:0|[1-9][0-9]*)$/, HEX=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/, MAX_BODY=64*1024;
class ReviewError extends Error { constructor(code,status=400){super(code);this.code=code;this.status=status;} }
const fail=(code,status)=>{throw new ReviewError(code,status);};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',Vary:'Cookie'}});
const lower=(v,code='READER_UNAVAILABLE')=>{if(typeof v!=='string'||!ADDRESS.test(v))fail(code,code==='FORBIDDEN'?403:503);return v.toLowerCase();};
const dec=(v,code='BAD_BODY')=>{if(typeof v!=='string'||v.length>78||!UINT.test(v))fail(code,code==='STALE_DATA'?503:400);try{uint(v,code);}catch{fail(code,code==='STALE_DATA'?503:400);}return v;};
const hash=(v)=>{if(typeof v!=='string'||!HASH.test(v))fail('READER_UNAVAILABLE',503);return v.toLowerCase();};
const stat=(v)=>typeof v==='bigint'?Number(v):typeof v==='number'&&Number.isInteger(v)?v:typeof v==='string'&&/^[0-8]$/.test(v)?Number(v):-1;
const rowStat=(v)=>{if(typeof v==='string'&&/^[0-8]$/.test(v))return Number(v);return ({open:0,inprogress:1,submitted:2,revisionpending:3,accessrecovery:4,disputed:5,completed:6,refunded:7,cancelled:8}[String(v).toLowerCase()]??-1);};
const argsOf=(e)=>e?.decoded?.args??{};
function blockNumber(s){if(!s||typeof s.blockTag!=='string'||!HEX.test(s.blockTag))fail('READER_UNAVAILABLE',503);return BigInt(s.blockTag);}
function context(id,s,j){return{jobId:id,stateVersion:String(j.stateVersion),block:blockNumber(s).toString(),blockHash:hash(s.blockHash)};}
async function rowFor(db,p,id){const r=await db.query('SELECT * FROM v2_jobs WHERE chain_id=$1 AND LOWER(marketplace)=LOWER($2) AND job_id=$3 LIMIT 1',[Number(p.canonicalChainId),p.marketplace,id]);return r.rows[0]??null;}
function validateRow(r,p,id){if(!r||String(r.chain_id)!==p.canonicalChainId.toString()||typeof r.marketplace!=='string'||r.marketplace.toLowerCase()!==p.marketplace.toLowerCase()||String(r.job_id)!==id||!UINT.test(String(r.state_version))||typeof r.terms_hash!=='string'||!HASH.test(r.terms_hash)||!UINT.test(String(r.source_block))||typeof r.source_hash!=='string'||!HASH.test(r.source_hash)||rowStat(r.status)<0)fail('READER_UNAVAILABLE',503);return r;}
function job(raw,r){if(!raw||typeof raw!=='object')fail('READER_UNAVAILABLE',503);for(const k of ['client','operator','resolver','reward','status','stateVersion','canonicalTermsHash','feeBpsSnapshot','stakeReserved','treasurySnapshot','episodeStart','disputeTimeUsed','lastAdminActionAt','faultReviewPending','faultReviewDeadline','house'])if(raw[k]===undefined||raw[k]===null)fail('READER_UNAVAILABLE',503);for(const k of ['client','operator','resolver','treasurySnapshot'])lower(raw[k]);if(typeof raw.canonicalTermsHash!=='string'||!HASH.test(raw.canonicalTermsHash)||typeof raw.house!=='boolean')fail('READER_UNAVAILABLE',503);for(const k of ['reward','stateVersion','feeBpsSnapshot','stakeReserved','episodeStart','disputeTimeUsed','lastAdminActionAt','faultReviewDeadline'])try{uint(raw[k],k);}catch{fail('READER_UNAVAILABLE',503);}if(typeof raw.faultReviewPending!=='boolean'||stat(raw.status)<0)fail('READER_UNAVAILABLE',503);return raw;}
function verify(s,r,p){if(!s||s.chainId!==p.canonicalChainId||blockNumber(s)!==BigInt(r.source_block)||hash(s.blockHash)!==r.source_hash.toLowerCase())fail('STALE_DATA',503);}
function same(a,b){return['client','operator','resolver','reward','stateVersion','canonicalTermsHash','feeBpsSnapshot','stakeReserved','treasurySnapshot','status','faultReviewPending'].every(k=>String(a[k]).toLowerCase()===String(b[k]).toLowerCase());}
function deadline(j){const hard=BigInt(j.episodeStart)+21n*86400n-BigInt(j.disputeTimeUsed),idle=BigInt(j.lastAdminActionAt)+7n*86400n;return hard<idle?hard:idle;}
function financialWindow(j,now) {
 const status=stat(j.status);
 if(status===1)return now<uint(j.deliveryDeadline);
 if(status===2)return now<uint(j.reviewDeadline);
 if(status===3)return true;
 if(status===4)return now<uint(j.repairDeadline);
 if(status===5)return now<deadline(j);
 return status===0;
}
function mutual(m,j,now){if(!m||m.active!==true)return null;for(const k of ['version','jobStateVersion','expiry','refund','grossPayout'])dec(String(m[k]??''),'READER_UNAVAILABLE');const proposer=lower(m.proposer),client=lower(j.client),operator=lower(j.operator);if(String(m.jobStateVersion)!==String(j.stateVersion)||BigInt(m.version)===0n||BigInt(m.expiry)<=now||(proposer!==client&&proposer!==operator)||BigInt(m.refund)+BigInt(m.grossPayout)!==BigInt(j.reward)||!financialWindow(j,now))return null;return{active:true,version:String(m.version),jobStateVersion:String(m.jobStateVersion),proposer,client,operator,expiry:String(m.expiry),...calculateDecisionEconomics(j,{grossPayout:String(m.grossPayout)}),treasury:lower(j.treasurySnapshot)};}
async function eventsFor(db,p,id){const r=await db.query("SELECT * FROM v2_indexer_events_fork WHERE chain_id=$1 AND LOWER(emitter) IN (LOWER($2),LOWER($3)) AND canonical=true AND decoded->'args'->>'jobId'=$4 ORDER BY block_number,transaction_index,log_index",[Number(p.canonicalChainId),p.marketplace,p.vault,id]);return r.rows;}
function resolved(events,j,id,profile) {
 const groups=new Map();
 for(const e of events){
  if(String(argsOf(e).jobId)!==id||!HASH.test(e.transaction_hash||'')||!HASH.test(e.block_hash||''))continue;
  const key=`${e.transaction_hash}:${e.block_number}:${String(e.block_hash).toLowerCase()}`;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);
 }
 const valid=[];
 for(const es of groups.values()){
  const only=(name)=>{const rows=es.filter(e=>e.event_name===name);return rows.length===1?rows[0]:null;};
  const d=only('DisputeResolved'),settled=only('Settled');if(!d||!settled)continue;
  const da=argsOf(d),sa=argsOf(settled),rel=only('StakeReleased'),sl=only('StakeSlashed'),fault=only('OperatorFaultDeclared');
  const isMarket=e=>e&&String(e.emitter).toLowerCase()===profile.marketplace.toLowerCase();
  const isVault=e=>e&&String(e.emitter).toLowerCase()===profile.vault.toLowerCase();
  if(!isMarket(d)||!isMarket(settled)||!HASH.test(da.reasonHash||'')||!HASH.test(da.evidenceHash||''))continue;
  try{
   const gross=dec(String(da.grossPayout??''),'READER_UNAVAILABLE'),refund=dec(String(da.refund??''),'READER_UNAVAILABLE');
   if(gross!==String(sa.grossPayout)||refund!==String(sa.refund)||BigInt(gross)+BigInt(refund)!==BigInt(j.reward)||lower(sa.operator)!==lower(j.operator))continue;
   const outcome=gross==='0'?'0':BigInt(gross)===BigInt(j.reward)?'1':'2';
   if(String(da.outcome)!==outcome||stat(j.status)!==(gross==='0'?7:6))continue;
   const isFault=Boolean(fault||sl);let historicalStake;
   if(isFault){
    if(!isMarket(fault)||!isVault(sl)||rel||lower(argsOf(fault).operator)!==lower(j.operator)||lower(argsOf(sl).operator)!==lower(j.operator))continue;
    historicalStake=dec(String(argsOf(sl).reservedAmount??''),'READER_UNAVAILABLE');
    if(String(argsOf(sl).slash)!==historicalStake||String(argsOf(fault).slashedAmount)!==historicalStake)continue;
   }else{
    if(!isVault(rel)||sl||fault||lower(argsOf(rel).operator)!==lower(j.operator))continue;
    historicalStake=dec(String(argsOf(rel).amount??''),'READER_UNAVAILABLE');
   }
   const economics=calculateDecisionEconomics({...j,stakeReserved:historicalStake,faultReviewPending:false},{grossPayout:gross,operatorFault:isFault});
   if(economics.fee!==String(sa.fee))continue;
   valid.push({action:'resolveDispute',txHash:d.transaction_hash,block:String(d.block_number),blockHash:d.block_hash.toLowerCase(),outcome,grossPayout:gross,refund,fee:economics.fee,operatorFault:isFault,reasonHash:da.reasonHash,evidenceHash:da.evidenceHash,economics});
  }catch{continue;}
 }
 return valid.length===1?valid[0]:null;
}
async function body(req){if(req.headers.get('content-type')!=='application/json')fail('BAD_BODY');const l=req.headers.get('content-length');if(l!==null&&(!/^\d+$/.test(l)||Number(l)>MAX_BODY))fail('BODY_TOO_LARGE',413);const text=await req.text();if(Buffer.byteLength(text)>MAX_BODY)fail('BODY_TOO_LARGE',413);let v;try{v=JSON.parse(text);}catch{fail('BAD_JSON');}if(!v||typeof v!=='object'||Array.isArray(v))fail('BAD_BODY');return v;}
export function createV2DecisionReviewApi({db,auth,readerFactory,getHealth,origin,profile=ARC_TESTNET_PROFILE}={}){assertV2Profile(profile);if(!db?.query||typeof readerFactory!=='function'||typeof getHealth!=='function'||typeof origin!=='string')throw new TypeError('db, readerFactory, getHealth and origin are required');const healthy=async()=>{let h;try{h=await getHealth();}catch{fail('STALE_DATA',503);}if(!h||h.status!=='healthy'||h.stale!==false||h.gap!=null)fail('STALE_DATA',503);};const session=async(req,mut=false)=>{const fn=mut?auth?.authorizeMutation:auth?.authenticateRequest;if(typeof fn!=='function')fail('INVALID_SESSION',401);const a=await fn(req),w=a?.wallet??a?.session?.wallet;if(typeof w!=='string'||!ADDRESS.test(w))fail('INVALID_SESSION',401);return w.toLowerCase();};const load=async(id)=>{const r=validateRow(await rowFor(db,profile,id),profile,id),pinnedReader=readerFactory({toBlockTag:`0x${BigInt(r.source_block).toString(16)}`}),pinned=await pinnedReader.read();verify(pinned,r,profile);const pj=job(await pinned.readJob(BigInt(id)),r);if(String(pj.stateVersion)!==String(r.state_version)||String(pj.canonicalTermsHash).toLowerCase()!==String(r.terms_hash).toLowerCase()||stat(pj.status)!==rowStat(r.status))fail('STALE_DATA',503);const latestReader=readerFactory(),latest=await latestReader.read(),j=job(await latest.readJob(BigInt(id)),r);if(latest.chainId!==profile.canonicalChainId||!HEX.test(latest.blockTag)||!same(pj,j))fail('STALE_DATA',503);return{snap:latest,job:j};};const read=async(id,w)=>{await healthy();const{snap,job:j}=await load(id);if(![lower(j.client),lower(j.operator),lower(j.resolver)].includes(w))fail('FORBIDDEN',403);return{context:context(id,snap,j),mutual:mutual(await snap.readMutual(BigInt(id)),j,BigInt(snap.blockTimestamp)),resolved:stat(j.status)>=6?resolved(await eventsFor(db,profile,id),j,id,profile):null};};const post=async(req,id)=>{await healthy();const actor=await session(req,true),v=await body(req);if(Object.keys(v).length!==3||Object.keys(v).some(k=>!['stateVersion','grossPayout','operatorFault'].includes(k))||typeof v.operatorFault!=='boolean')fail('BAD_BODY');const sv=dec(v.stateVersion),gp=dec(v.grossPayout),{snap,job:j}=await load(id);if(stat(j.status)!==5||String(j.stateVersion)!==sv||j.house===true)fail('STALE_DATA',409);if(j.faultReviewPending||lower(j.resolver)===lower(j.client)||lower(j.resolver)===lower(j.operator)||/^0x0{40}$/.test(lower(j.resolver)))fail('INVALID_STATUS',409);if(actor!==lower(j.resolver))fail('FORBIDDEN',403);if(BigInt(snap.blockTimestamp)>=deadline(j))fail('STALE_DATA',409);const c=context(id,snap,j);return{context:c,preview:{action:'resolveDispute',grossPayout:gp,...calculateDecisionEconomics(j,{grossPayout:gp,operatorFault:v.operatorFault})},previewBinding:{jobId:id,stateVersion:sv,block:c.block,blockHash:c.blockHash,action:'resolveDispute'}};};return async req=>{try{const u=new URL(req.url);if(u.origin!==origin||(req.method==='GET'?req.headers.get('origin')!==null&&req.headers.get('origin')!==origin:req.headers.get('origin')!==origin))fail('ORIGIN_MISMATCH',403);if([...u.searchParams].length||u.pathname.endsWith('/'))fail('NOT_FOUND',404);const m=u.pathname.match(/^\/api\/v2\/jobs\/([1-9][0-9]*)\/decision-review$/);if(!m)fail('NOT_FOUND',404);dec(m[1]);if(req.method==='GET'){const result=await read(m[1],await session(req));await healthy();return json(result);}if(req.method==='POST'){const result=await post(req,m[1]);await healthy();return json(result);}fail('METHOD_NOT_ALLOWED',405);}catch(e){const safe=new Set(['INVALID_SESSION','CSRF_INVALID','ORIGIN_MISMATCH','METHOD_NOT_ALLOWED','NOT_FOUND','BODY_TOO_LARGE','BAD_BODY','BAD_JSON','FORBIDDEN','STALE_DATA','READER_UNAVAILABLE','INVALID_STATUS']);const known=safe.has(e?.code);return json({error:known?e.code:'INTERNAL_ERROR'},known&&Number.isInteger(e.status)&&e.status>=400&&e.status<=599?e.status:500);}};}
export{ReviewError};
