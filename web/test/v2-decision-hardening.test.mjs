import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { RevisionReview, DecisionReview, IncomingMutualCard } from '../app/v2/_components/decision-review.mjs';
const client='0x1111111111111111111111111111111111111111',operator='0x2222222222222222222222222222222222222222',resolver='0x3333333333333333333333333333333333333333';
const job={jobId:'7',stateVersion:'4',status:'3',client,operator,resolver};
const session={authenticated:true,wallet:operator,csrf:'test-csrf'},health={status:'healthy',stale:false,gap:null};
const json=r=>new Response(JSON.stringify(r),{headers:{'content-type':'application/json'}});
const ctx={jobId:'7',stateVersion:'4',deliveryVersion:'1',correctionDeadline:'1900000000',revisionLimit:'1',revisionsUsed:'1',unlimitedRevisions:false};
const saved={id:'n1',jobId:'7',requestStateVersion:'4',deliveryVersion:'1',criterionReference:'Mobile controls',note:'Fix touch drag on mobile',verification:'verified'};
const label=(t,s)=>t.root.findAllByType('button').find(n=>n.children.join('')===s);
test('assigned operator sees confirmed revision card in real RevisionPending status',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>json({context:ctx,notes:[saved]});let t;try{await act(async()=>{t=TestRenderer.create(React.createElement(RevisionReview,{job,session,health}));});assert.match(JSON.stringify(t.toJSON()),/Fix touch drag/);assert.match(JSON.stringify(t.toJSON()),/Revision requested/);assert.equal(label(t,'Review revision request'),undefined);}finally{if(t)await act(async()=>t.unmount());globalThis.fetch=old;}});
test('mismatch remains readable with an explicit unverified warning',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>json({context:ctx,notes:[{...saved,verification:'mismatch'}]});let t;try{await act(async()=>{t=TestRenderer.create(React.createElement(RevisionReview,{job,session,health}));});assert.match(JSON.stringify(t.toJSON()),/Fix touch drag/);assert.match(JSON.stringify(t.toJSON()),/unverified|not verified/i);}finally{if(t)await act(async()=>t.unmount());globalThis.fetch=old;}});
test('incoming card never enables accept with missing financial terms',async()=>{let t;await act(async()=>{t=TestRenderer.create(React.createElement(IncomingMutualCard,{mutual:{active:true,version:'1',proposer:client},onAccept:()=>assert.fail('must not accept')}));});assert(!label(t,'Accept settlement')||label(t,'Accept settlement').props.disabled);await act(async()=>t.unmount());});
test('canonical stale acceptance refreshes once without replaying the accept POST',async()=>{let reads=0,sends=0;const old=globalThis.fetch;const m={active:true,version:'4',jobStateVersion:'4',proposer:operator,client,operator,expiry:'1900000000',refund:'250000',grossPayout:'750000',fee:'37500',operatorNet:'712500'};globalThis.fetch=async(p,o)=>{if(o?.method==='POST'){sends++;return new Response(JSON.stringify({error:'STALE_DATA'}),{status:503});}reads++;return json({context:{jobId:'7',stateVersion:'4',block:'100',blockHash:'0x'+'ab'.repeat(32)},mutual:m,resolved:null});};let t;try{await act(async()=>{t=TestRenderer.create(React.createElement(DecisionReview,{job:{...job,status:'2'},session:{...session,wallet:client},health}));});await act(async()=>label(t,'Accept settlement').props.onClick());assert.equal(sends,1);assert.equal(reads,2);}finally{if(t)await act(async()=>t.unmount());globalThis.fetch=old;}});

test('private revision content disappears immediately on wallet change while the next read is pending',async()=>{
 const old=globalThis.fetch;let release;globalThis.fetch=async()=>json({context:ctx,notes:[saved]});let t;
 try{await act(async()=>{t=TestRenderer.create(React.createElement(RevisionReview,{job,session,health}));});assert.match(JSON.stringify(t.toJSON()),/Fix touch drag/);
 globalThis.fetch=()=>new Promise(r=>{release=r;});await act(async()=>t.update(React.createElement(RevisionReview,{job,session:{...session,wallet:resolver},health})));assert.doesNotMatch(JSON.stringify(t.toJSON()),/Fix touch drag/);assert.match(JSON.stringify(t.toJSON()),/Loading revision/);release(json({context:ctx,notes:[saved]}));await act(async()=>{});
 await act(async()=>t.update(React.createElement(RevisionReview,{job,session:{authenticated:false},health})));assert.equal(t.toJSON(),null);
 }finally{if(t)await act(async()=>t.unmount());globalThis.fetch=old;}
});
test('a saved-note response arriving after an input edit cannot enable confirmation',async()=>{
 const {documentHash}=await import('../lib/v2/ui-actions.mjs');const old=globalThis.fetch;let release,posted;globalThis.fetch=async(p,opt)=>{if(opt?.method==='POST'){posted=JSON.parse(opt.body);return new Promise(r=>{release=r;});}return json({context:{...ctx,stateVersion:'3'},notes:[]});};let t,pending;
 try{await act(async()=>{t=TestRenderer.create(React.createElement(RevisionReview,{job:{...job,stateVersion:'3',status:'2'},session:{...session,wallet:client},health}));});await act(async()=>t.root.findByType('textarea').props.onChange({target:{value:'Original note'}}));await act(async()=>t.root.findAllByType('input').find(n=>n.props.name==='criterionReference').props.onChange({target:{value:'Criterion 1'}}));
 await act(async()=>{pending=label(t,'Review revision request').props.onClick();});assert(posted);await act(async()=>t.root.findByType('textarea').props.onChange({target:{value:'Changed note'}}));
 release(json({note:{id:'n1',jobId:'7',...posted,requestStateVersion:'4',criterionHash:documentHash(posted.criterionReference),referenceHash:documentHash(posted.note)}}));await act(async()=>pending);assert.equal(label(t,'Confirm revision request'),undefined);assert.equal(t.root.findByType('textarea').props.value,'Changed note');
 }finally{if(t)await act(async()=>t.unmount());globalThis.fetch=old;}
});
test('a resolver preview with missing financial fields never enables confirmation after valid input submission',async()=>{
 const {ResolverActionPanel}=await import('../app/v2/_components/action-panels.js');const old=globalThis.fetch;let posts=0;globalThis.fetch=async(p,opt)=>{if(opt?.method==='POST'){posts++;return json({context:ctx,previewBinding:ctx,preview:{grossPayout:'0'}});}return json({context:ctx});};let t;
 try{await act(async()=>{t=TestRenderer.create(React.createElement(ResolverActionPanel,{job:{...job,status:'5'},session:{...session,wallet:resolver},health}));});for(const input of t.root.findAllByType('input').filter(n=>n.props.type!=='checkbox'))await act(async()=>input.props.onChange({target:{value:input.props.name==='grossPayout'?'0':'Evidence'}}));await act(async()=>t.root.findByType('textarea').props.onChange({target:{value:'Reason'}}));await act(async()=>t.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(posts,1);assert.equal(label(t,'Confirm resolution'),undefined);assert.equal(t.root.findAllByProps({'data-testid':'economic-preview'}).length,0);
 }finally{if(t)await act(async()=>t.unmount());globalThis.fetch=old;}
});
