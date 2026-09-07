import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createConfig, connect, getAccount, getChainId } from '@wagmi/core';
import { injected } from '@wagmi/core';
import { http } from 'viem';
const page = fs.readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
const chain = { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name:'USDC', symbol:'USDC', decimals:18 }, rpcUrls:{default:{http:['https://rpc.testnet.arc.network']}}, testnet:true };
function pageConnect(connector) {
 const body=page.match(/const requestConnect = \(\) => \{([\s\S]*?)\n  \};/)?.[1];
 assert.ok(body, 'shared requestConnect handler exists');
 let request;
 new Function('connectors','connect','arcTestnet','setMsg','humanError',body)([connector],(parameters,callbacks)=>{request={parameters,callbacks};},chain,()=>{},()=> 'Wallet request rejected');
 return request;
}
function wallet({initial=1,known=true,reject=false,failSwitch=false}={}) {
 const provider=new EventEmitter(); const calls=[]; let id=initial;
 provider.request=async({method,params})=>{
  calls.push({method,params});
  if(method==='wallet_requestPermissions')return [{caveats:[{value:['0x0000000000000000000000000000000000000001']}]}];
  if(method==='eth_accounts'||method==='eth_requestAccounts')return ['0x0000000000000000000000000000000000000001'];
  if(method==='eth_chainId')return '0x'+id.toString(16);
  if(method==='wallet_switchEthereumChain') {
   if(reject)throw Object.assign(new Error('User rejected request'),{code:4001});
   if(failSwitch)throw Object.assign(new Error('Switch unsupported'),{code:4200});
   if(!known)throw Object.assign(new Error('Unknown chain'),{code:4902});
   id=Number(params[0].chainId);provider.emit('chainChanged',params[0].chainId);return null;
  }
  if(method==='wallet_addEthereumChain'){known=true;id=Number(params[0].chainId);provider.emit('chainChanged',params[0].chainId);return null;}
  throw new Error('Unexpected RPC '+method);
 };
 globalThis.window={addEventListener(){},removeEventListener(){}};
 const config=createConfig({chains:[chain],connectors:[injected({target:{id:'test',name:'Mock EIP-1193 wallet',provider}})],transports:{[chain.id]:http(chain.rpcUrls.default.http[0])},ssr:true,storage:null,multiInjectedProviderDiscovery:false});
 return {config,calls};
}
test('all connect controls share the explicit Arc handler and surface errors',()=>{
 const {parameters,callbacks}=pageConnect({id:'example'});
 assert.equal(parameters.chainId,chain.id);
 assert.equal(typeof callbacks?.onError,'function');
 assert.match(page,/<WalletConnect[^>]*onConnect=\{requestConnect\}/);
 assert.doesNotMatch(page,/onConnect\(\{ connector \}\)/);
});
test('wrong-network detection uses the connected wallet chain, not config default',()=>{
 assert.match(page,/const \{ address, isConnected, chainId \} = useAccount\(\)/);
 assert.doesNotMatch(page,/useChainId\(/);
 assert.match(page,/wrongNetwork = isConnected && chainId !== arcTestnet.id/);
});
test('Ethereum first connection requests Arc',async()=>{
 const {config,calls}=wallet();const result=await connect(config,pageConnect(config.connectors[0]).parameters);
 assert.equal(result.chainId,chain.id);assert.equal(calls.filter(x=>x.method==='wallet_switchEthereumChain').length,1);
});
test('missing Arc network invokes add-network with USDC metadata',async()=>{
 const {config,calls}=wallet({known:false});const result=await connect(config,pageConnect(config.connectors[0]).parameters);
 assert.equal(result.chainId,chain.id);const added=calls.find(x=>x.method==='wallet_addEthereumChain');assert.ok(added);assert.equal(added.params[0].nativeCurrency.symbol,'USDC');
});
test('already on Arc does not request a needless switch',async()=>{
 const {config,calls}=wallet({initial:chain.id});await connect(config,pageConnect(config.connectors[0]).parameters);
 assert.equal(calls.filter(x=>x.method==='wallet_switchEthereumChain').length,0);
});
test('rejected switch rejects connection without sending transactions',async()=>{
 const {config,calls}=wallet({reject:true});await assert.rejects(connect(config,pageConnect(config.connectors[0]).parameters));
 assert.ok(!calls.some(x=>/sendTransaction|sign/i.test(x.method)));
});
test('unsupported switch leaves account on Ethereum even if config reports Arc',async()=>{
 const {config}=wallet({failSwitch:true});await connect(config,pageConnect(config.connectors[0]).parameters);
 assert.equal(getAccount(config).chainId,1);assert.equal(getChainId(config),chain.id);
});
