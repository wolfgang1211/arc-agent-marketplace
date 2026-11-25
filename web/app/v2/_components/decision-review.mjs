'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v2Request } from '../../../lib/v2/client-api.mjs';
import { documentHash, usdcToUnits, unitsToUsdc, jobRole, formatUtcDate, formatRelativeDate } from '../../../lib/v2/ui-actions.mjs';
import { normalizeStatus } from '../../../lib/v2/ui-read-model.mjs';
import { useAction } from './action-panels.js';

const h = React.createElement;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const text = value => value == null ? '—' : typeof value === 'string' ? value : JSON.stringify(value);
const clean = value => String(value ?? '').trim();
const server = value => value == null ? 'Unavailable' : String(value);
const uint=v=>typeof v==='string'&&/^(?:0|[1-9][0-9]*)$/.test(v);
const money=v=>uint(v)?`${unitsToUsdc(v)} USDC`:'Unavailable';
const utc=v=>uint(String(v))&&String(v)!=='0'&&Number.isFinite(new Date(Number(v)*1000).getTime())?`${formatUtcDate(String(v))} UTC (${formatRelativeDate(String(v))})`:'Unavailable';
const identity=(job,session)=>`${session?.wallet}:${session?.authenticated}:${job.jobId}:${job.stateVersion}:${job.sourceHash||''}`;
const allowed=(job,session)=>session?.authenticated===true&&['client','operator','resolver'].includes(jobRole(job,session.wallet));
const ready=(session,health)=>Boolean(session?.authenticated&&session.csrf&&(health?.data||health)?.status==='healthy'&&(health?.data||health)?.stale===false&&(health?.data||health)?.gap==null);
export const validEconomics=p=>Boolean(p&&['grossPayout','refund','fee','operatorNet','clientCredit','treasuryCredit','stakeReleased','stakeSlashed'].every(k=>uint(p[k]))&&p.conservation&&uint(p.conservation.totalBefore)&&uint(p.conservation.totalAfter)&&p.conservation.totalBefore===p.conservation.totalAfter);
const validMutual=m=>Boolean(m?.active&&['version','jobStateVersion','expiry','refund','grossPayout','fee','operatorNet'].every(k=>uint(m[k]))&&[m.proposer,m.client,m.operator].every(a=>/^0x[0-9a-fA-F]{40}$/.test(a||'')));
function Field({ label, name, value, onChange, type = 'text' }) { return h('label', { className: 'v2-field' }, h('span', null, `${label} *`), h('input', { className: 'v2-input', name, value, type, onChange: e => onChange(e.target.value) })); }
function ReviewRows({ values }) { return h('dl', { className: 'v2-review-rows' }, Object.entries(values).map(([key, value]) => h(React.Fragment, { key }, h('dt', null, key), h('dd', { className: /hash|address|tx/i.test(key) ? 'v2-code' : undefined, style:{overflowWrap:'anywhere',whiteSpace:'pre-wrap'} }, text(value))))); }
function useContext(job, session, path, request = v2Request) {
 const key=identity(job,session), liveKey=useRef(key),generation=useRef(0);liveKey.current=key;
 const [state,setState]=useState(null);
 const load=useCallback(()=>{const seq=++generation.current;if(!allowed(job,session)){setState(null);return Promise.resolve();}setState({key,loading:true});return Promise.resolve().then(()=>request(path)).then(data=>{if(seq===generation.current&&liveKey.current===key){if(data?.context?.jobId!==String(job.jobId)||String(data.context.stateVersion)!==String(job.stateVersion))throw new Error('STALE_DATA');setState({key,data});}}).catch(error=>{if(seq===generation.current&&liveKey.current===key)setState({key,error});});},[key,path,request]);
 useEffect(()=>{void load();return()=>{generation.current++;};},[load]);
 return {...(state?.key===key?state:{loading:true,data:null}),load};
}
function ErrorView({ error }) { return error ? h('div', { className: 'v2-error', role: 'alert' }, error.status === 403 ? 'This wallet is not authorized to read this private review.' : 'Unable to load the private review. Retry before acting.') : null; }

export function RevisionReview({ job, session, health, onRefresh, request=v2Request }) {
 const state=useContext(job,session,`/api/v2/jobs/${encodeURIComponent(job.jobId)}/revision-notes`,request);
 const [note,setNote]=useState(''),[criterion,setCriterion]=useState(''),[review,setReview]=useState(null),[error,setError]=useState(null),[saving,setSaving]=useState(false);const action=useAction(onRefresh);
 const signature=JSON.stringify([identity(job,session),note,criterion]),live=useRef(signature),lock=useRef(false);live.current=signature;
 const context=state.data?.context||{}, current=review?.signature===signature?review:null;
 const canRequest=jobRole(job,session?.wallet)==='client'&&normalizeStatus(job.status)?.code===2;
 const change=setter=>e=>{setter(e.target.value);setReview(null);setError(null);};
 const prepare=async()=>{if(lock.current||!canRequest||!ready(session,health)||state.loading||state.error)return;const captured=signature;lock.current=true;setSaving(true);try{
  if(!note.trim()||!criterion.trim()||!uint(context.deliveryVersion))throw new Error();
  const body={expectedStateVersion:String(job.stateVersion),deliveryVersion:context.deliveryVersion,criterionReference:criterion,note};
  const result=await request(`/api/v2/jobs/${encodeURIComponent(job.jobId)}/revision-notes`,{method:'POST',csrfToken:session.csrf,body});const saved=result?.note;if(live.current!==captured)return;
  if(!saved||saved.jobId!==String(job.jobId)||saved.expectedStateVersion!==body.expectedStateVersion||saved.requestStateVersion!==(BigInt(body.expectedStateVersion)+1n).toString()||saved.deliveryVersion!==body.deliveryVersion||saved.note!==note||saved.criterionReference!==criterion||saved.criterionHash!==documentHash(criterion)||saved.referenceHash!==documentHash(note))throw new Error();setReview({signature:captured,saved});setError(null);
 }catch(e){if(live.current===captured)setError(e);}finally{lock.current=false;setSaving(false);}};
 const confirm=()=>{if(!current||!ready(session,health)||action.pending)return;const saved=current.saved,params={criterionHash:saved.criterionHash,referenceHash:saved.referenceHash,expected:saved.expectedStateVersion};return action.run(`revision-${job.jobId}-${saved.id}`,async key=>{try{return await request(`/api/v2/jobs/${encodeURIComponent(job.jobId)}/preflight`,{method:'POST',csrfToken:session.csrf,idempotencyKey:key,body:{action:'requestRevision',params}});}catch(e){setReview(null);void state.load();throw e;}},JSON.stringify(params));};
 if(!allowed(job,session)||![2,3,5,6,7].includes(normalizeStatus(job.status)?.code))return null;
 return h('section',{className:'v2-panel v2-stack','aria-label':'Revision review','data-testid':'revision-review'},state.loading?h('p',{role:'status'},'Loading revision context…'):null,h(ErrorView,{error:state.error}),state.data?.notes?.map((n,i)=>h(RevisionRequestedCard,{key:n.id||i,note:n,context})),canRequest?h(React.Fragment,null,h('h2',null,'Request a revision'),h('p',{className:'v2-muted'},'Name the acceptance criterion and exact change. The saved note is private to job parties.'),h('label',{className:'v2-field'},h('span',null,'Revision notes'),h('textarea',{className:'v2-input',name:'revisionNote',rows:4,value:note,onChange:change(setNote)})),h('label',{className:'v2-field'},h('span',null,'Requested criterion'),h('input',{className:'v2-input',name:'criterionReference',value:criterion,onChange:change(setCriterion)})),current?h('section',{'data-testid':'revision-confirmation'},h('h3',null,'Review before sending'),h(ReviewRows,{values:{'Revision note':current.saved.note,'Requested criterion':current.saved.criterionReference,'Delivery being revised':`Version ${current.saved.deliveryVersion}`}}),h('details',null,h('summary',null,'Technical details'),h(ReviewRows,{values:{'Criterion hash':current.saved.criterionHash,'Note hash':current.saved.referenceHash}})),h('button',{className:'v2-btn',type:'button',disabled:action.pending||!ready(session,health),onClick:confirm},'Confirm revision request')):h('button',{className:'v2-btn',type:'button',disabled:saving||state.loading||Boolean(state.error)||!ready(session,health)||!note.trim()||!criterion.trim(),onClick:prepare},saving?'Saving…':'Review revision request')):null,error?h('p',{className:'v2-error',role:'alert'},'Unable to verify the saved note. Refresh before acting.'):null,action.error?h('p',{className:'v2-error',role:'alert'},action.error):null);
}

export function IncomingMutualCard({mutual,onAccept,onReject,wallet,disabled=false}) {
 if(!mutual?.active)return null;const valid=validMutual(mutual),counterpart=String(wallet).toLowerCase()===String(mutual.client).toLowerCase()?mutual.operator:mutual.client;
 return h('section',{className:'v2-panel v2-stack','aria-label':'Incoming mutual proposal'},h('h3',null,'Incoming settlement proposal'),h(ReviewRows,{values:{proposer:mutual.proposer,counterpart,refund:money(mutual.refund),grossPayout:money(mutual.grossPayout),fee:money(mutual.fee),operatorNet:money(mutual.operatorNet),expiry:utc(mutual.expiry),version:mutual.version}}),!valid?h('p',{className:'v2-warning'},'Incomplete proposal terms. Do not accept.'):null,h('div',{className:'v2-action-list'},h('button',{className:'v2-btn',type:'button',disabled:disabled||!valid,onClick:onAccept},'Accept settlement'),h('button',{className:'v2-btn secondary',type:'button',disabled:disabled||!valid,onClick:onReject},'Reject settlement')));
}
export function RevisionRequestedCard({note,context}) {
 if(!note)return null;
 const limit=uint(context?.revisionLimit)?BigInt(context.revisionLimit):null,used=uint(context?.revisionsUsed)?BigInt(context.revisionsUsed):null;
 const remaining=context?.unlimitedRevisions===true?'Unlimited':context?.unlimitedRevisions===false&&limit!==null&&used!==null?String(limit>used?limit-used:0n):'Unavailable';
 return h('section',{className:'v2-panel v2-stack','aria-label':'Revision requested'},h('h3',null,note.verification==='pending'?'Saved revision request (not yet confirmed)':note.verification==='fulfilled'?'Earlier revision request (addressed)':'Revision requested'),h('p',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},note.note),h(ReviewRows,{values:{'Requested criterion':note.criterionReference,'Delivery version':note.deliveryVersion,'Remaining revisions':remaining,'Revision deadline':utc(context?.correctionDeadline),'Verification':note.verification==='verified'?'Verified against on-chain hashes':note.verification==='fulfilled'?'Addressed in a later delivery (verified against the on-chain request)':note.verification==='pending'?'Pending wallet submission / chain confirmation':'Not verified (hash mismatch)'}}),note.verification==='mismatch'?h('p',{className:'v2-warning',role:'alert'},'This note is unverified: content or hashes do not match the canonical revision. It remains readable; do not rely on it until reconciled.'):null);
}
export function EconomicOutcomeCard({preview,resolved}) {
 const data=resolved?.economics||resolved||preview;if(!data)return null;const valid=validEconomics(data);
 return h('section',{className:'v2-panel v2-stack','aria-label':resolved?'Resolved dispute':'Economic preview'},h('h3',null,resolved?'Resolved dispute':'Economic preview'),h(ReviewRows,{values:{'Client refund':money(data.refund),'Operator gross payout':money(data.grossPayout),'Fee / treasury credit':money(data.fee),'Operator net credit':money(data.operatorNet),'Client total credit (including slash)':money(data.clientCredit),'Stake released':money(data.stakeReleased),'Release recipient':data.releaseRecipient||'None','Stake slashed':money(data.stakeSlashed),'Slash recipient':data.slashRecipient||'None',...(data.stakeRetained!=null?{'Stake retained':money(data.stakeRetained)}:{}),'Conservation':valid?`${money(data.conservation.totalBefore)} = ${money(data.conservation.totalAfter)} (verified)`:'Not verified'}}),resolved?h(ReviewRows,{values:{'Transaction hash':resolved.txHash,'Source block':resolved.block,'Operator fault':resolved.operatorFault,'Reason hash':resolved.reasonHash,'Evidence hash':resolved.evidenceHash}}):null,!valid?h('p',{className:'v2-warning',role:'alert'},'Incomplete or unverified economic result. Do not confirm.'):null);
}

export function DecisionReview({job,session,health,onRefresh,resolver=false,request=v2Request}) {
 const state=useContext(job,session,`/api/v2/jobs/${encodeURIComponent(job.jobId)}/decision-review`,request),action=useAction(onRefresh),m=state.data?.mutual;
 const incoming=validMutual(m)&&m.jobStateVersion===String(job.stateVersion)&&String(m.proposer).toLowerCase()!==String(session?.wallet).toLowerCase()&&['client','operator'].includes(jobRole(job,session?.wallet));
 const run=name=>{if(!incoming||!ready(session,health)||state.loading||state.error||action.pending)return;const params={expected:m.jobStateVersion,expectedRequestVersion:m.version};return action.run(`mutual-${job.jobId}-${name}-${m.version}`,async key=>{try{return await request(`/api/v2/jobs/${encodeURIComponent(job.jobId)}/preflight`,{method:'POST',csrfToken:session.csrf,idempotencyKey:key,body:{action:name,params}});}catch(e){void state.load();throw e;}},JSON.stringify(params));};
 const code=normalizeStatus(job.status)?.code;
 if(!allowed(job,session)||![1,2,3,4,5,6,7].includes(code))return null;
 const terminal=code===6||code===7, hasContent=incoming||Boolean(m?.active)||Boolean(state.data?.resolved)||code===5;
 // Show the card only when there is a decision to review: an incoming proposal,
 // an active dispute, or a resolved dispute outcome. Terminal jobs cannot act,
 // so a failed optional read there is hidden instead of shown as an error.
 if(!state.loading&&!state.error&&!hasContent&&!action.error)return null;
 if(terminal&&state.error)return null;
 return h('section',{className:'v2-panel v2-stack','aria-label':'Decision review','data-testid':'decision-review'},h('h2',null,resolver?'Dispute decision review':'Decision review'),h(ErrorView,{error:state.error}),state.loading?h('p',{role:'status'},'Loading decision review…'):null,incoming?h(IncomingMutualCard,{mutual:m,wallet:session.wallet,onAccept:()=>run('acceptMutual'),onReject:()=>run('rejectMutual'),disabled:action.pending||state.loading||Boolean(state.error)||!ready(session,health)}):null,m?.active&&!validMutual(m)?h('p',{className:'v2-warning'},'Proposal terms are incomplete. Do not accept.'):null,state.data?.resolved?h(EconomicOutcomeCard,{resolved:state.data.resolved}):null,state.error?h('button',{type:'button',className:'v2-btn secondary',onClick:state.load},'Refresh decision review'):null,action.error?h('p',{className:'v2-error',role:'alert'},action.error):null);
}
