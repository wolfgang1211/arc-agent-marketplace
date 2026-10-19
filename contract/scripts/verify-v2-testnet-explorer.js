'use strict';
const fs=require('node:fs'),path=require('node:path');
const {build}=require('./approved-v2-executor');
const file=path.resolve(__dirname,'../docs/v2-testnet-deployment.json'),base='https://explorer.testnet.arc.io';
async function request(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(45000)});let body;try{body=await r.json();}catch{body={error:'NON_JSON_RESPONSE'};}return{http:r.status,body};}
async function main(){const d=JSON.parse(fs.readFileSync(file));if(d.chainId!=='5042002'||!d.attestation?.marketplace?.passed||!d.attestation?.vault?.passed)throw Error('NOT_ATTESTED');d.explorerVerification||={};
for(const [name,key,step]of [['AgentMarketplaceV2','marketplace','deploy-market'],['OperatorCollateralVaultV2','vault','deploy-vault']]){
 const address=d.pair[key],target=`${base}/api/v2/smart-contracts/${address}`,spec=build(name),before=await request(target);const row={address,url:`${base}/address/${address}`,checkedAt:new Date().toISOString(),beforeVerified:before.body.is_verified===true};
 if(!row.beforeVerified&&d.explorerVerification[key]?.guid){row.guid=d.explorerVerification[key].guid;row.submission=d.explorerVerification[key].submission;row.statusCheck=await request(base+'/api?'+new URLSearchParams({module:'contract',action:'checkverifystatus',guid:row.guid}));}else if(!row.beforeVerified){const creation=before.body.creation_bytecode||'',args=creation.startsWith(spec.a.bytecode)?creation.slice(spec.a.bytecode.length):null;if(args===null)throw Error('EXPLORER_CREATION_MISMATCH');
 const fields=new URLSearchParams({module:'contract',action:'verifysourcecode',contractaddress:address,codeformat:'solidity-standard-json-input',sourceCode:JSON.stringify(spec.b.input),contractname:`contracts/${name}.sol:${name}`,compilerversion:'v'+spec.b.solcLongVersion.split('.Emscripten')[0],constructorArguements:args,licenseType:'3'});
 row.submission=await request(base+'/api',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fields});
 if(row.submission.body.status==='1'&&typeof row.submission.body.result==='string'){row.guid=row.submission.body.result;row.statusCheck=await request(base+'/api?'+new URLSearchParams({module:'contract',action:'checkverifystatus',guid:row.guid}));}
 }
 const after=await request(target),v=after.body;row.verified=v.is_verified===true;row.compilerVersion=v.compiler_version||null;row.optimizationEnabled=v.optimization_enabled??null;row.evmVersion=v.evm_version||v.compiler_settings?.evmVersion||null;row.optimizationRuns=v.optimization_runs??v.compiler_settings?.optimizer?.runs??null;row.contractName=v.name||null;row.status=row.verified?'verified':'unverified';d.explorerVerification[key]=row;const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(d,null,2)+'\n');fs.renameSync(tmp,file);console.log(JSON.stringify(row));
}}
main().catch(e=>{console.log(JSON.stringify({status:'failed',code:/^[A-Z_]+$/.test(e.message)?e.message:'EXPLORER_REQUEST_FAILED'}));process.exitCode=1;});
