import pg from 'pg';
import { performance } from 'node:perf_hooks';
import { createV2ReadApi } from '../lib/v2/server/api-read.mjs';
import { createReadOnlyV2Transport } from '../lib/v2/server/api-runtime.mjs';
import { createV2ChainReader } from '../lib/v2/server/chain-reader.mjs';
import { ARC_TESTNET_PROFILE as profile } from '../lib/v2/chain-profile.mjs';
const pool = new pg.Pool({host:'127.0.0.1',port:54329,user:'postgres',database:'postgres',ssl:false,max:1,connectionTimeoutMillis:3000,query_timeout:5000});
const metrics = { poolWaitMs:0, dbMs:0, dbQueries:0, rpcMs:0, rpcCalls:0, rpcFailures:0, rpcMethods:{} };
const db = { async query(sql, params) { const begin=performance.now(); const client=await pool.connect(); metrics.poolWaitMs+=performance.now()-begin; const start=performance.now(); try {return await client.query(sql,params);}finally{metrics.dbMs+=performance.now()-start;metrics.dbQueries++;client.release();} } };
const base = createReadOnlyV2Transport({profile});
const transport = async (method,params) => {const start=performance.now();metrics.rpcCalls++;metrics.rpcMethods[method]=(metrics.rpcMethods[method]??0)+1;try{return await base(method,params);}catch(e){metrics.rpcFailures++;throw e;}finally{metrics.rpcMs+=performance.now()-start;}};
const readerFactory=()=>createV2ChainReader({transport,profile,chainId:profile.canonicalChainId,marketplace:profile.marketplace,vault:profile.vault});
try {
 const start=performance.now();
 const api=createV2ReadApi({db,profile,readerFactory});
 const response=await api(new Request('http://127.0.0.1:3102/api/v2/jobs'));
 const body=await response.json();
 console.log(JSON.stringify({kind:'real-db-real-rpc-read-handler',status:response.status,itemCount:body.data?.count,elapsedMs:performance.now()-start,...metrics},null,2));
}finally{await pool.end();}
