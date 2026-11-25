'use client';
import React, { useEffect, useState } from 'react';
import { keccak256, stringToHex } from 'viem';
import { v2Request } from '../../../lib/v2/client-api.mjs';
import { normalizeStatus } from '../../../lib/v2/ui-read-model.mjs';

const h = React.createElement;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
export function safeDeliveryUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function readDeliveryReview(payload, job) {
  const missing = { delivery: null, history: [], message: 'The submitted content could not be verified against the current on-chain delivery. Do not approve until the delivery is available and verified.' };
  if (!payload || payload.reviewContext?.jobId !== String(job.jobId) || payload.reviewContext?.stateVersion !== String(job.stateVersion) || !Array.isArray(payload.items) || payload.items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) return missing;
  const current = payload.canonicalDelivery;
  if (!current || typeof current.version !== 'string' || !UINT.test(current.version) || BigInt(current.version) < 1n || !HASH.test(current.contentHash) || /^0x0{64}$/i.test(current.contentHash)) return missing;
  const matches = payload.items.filter(item => String(item.jobId) === String(job.jobId) && item.version === current.version && typeof item.contentHash === 'string' && item.contentHash.toLowerCase() === current.contentHash.toLowerCase());
  if (matches.length !== 1) return missing;
  const delivery = matches[0];
  try { if (keccak256(stringToHex(canonical(delivery.content))) !== current.contentHash.toLowerCase()) return missing; } catch { return missing; }
  return { delivery, history: payload.items.filter(item => item !== delivery && String(item.jobId) === String(job.jobId)), message: null };
}
const readable = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
function criteriaView(criteria) {
  const items = Array.isArray(criteria) ? criteria : typeof criteria === 'string' ? criteria.split('\n').filter(line => line.trim()) : [];
  return h('section', { 'aria-label': 'Acceptance criteria' }, h('h3', null, 'Acceptance criteria'), items.length ? h('ul', null, items.map((item, i) => h('li', { key: i, style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, readable(item)))) : h('p', { className: 'v2-muted' }, 'No acceptance criteria were returned. Check the original job requirements before approving.'));
}
export function DeliveryReview({ job, session, request = v2Request }) {
  const wallet = typeof session?.wallet === 'string' ? session.wallet.toLowerCase() : '';
  const eligible = (normalizeStatus(job.status)?.code ?? 0) >= 2 && ADDRESS.test(wallet) && [job.client, job.operator, job.resolver].some(party => typeof party === 'string' && party.toLowerCase() === wallet);
  const key = `${wallet}:${job.jobId}:${job.stateVersion}:${job.sourceHash || ''}`;
  const [read, setRead] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    if (!eligible) { setRead(null); return () => { live = false; }; }
    setRead({ key, loading: true });
    Promise.resolve().then(() => request(`/api/v2/jobs/${encodeURIComponent(job.jobId)}/deliveries`)).then(payload => { if (live) setRead({ key, payload }); }).catch(() => { if (live) setRead({ key, error: true }); });
    return () => { live = false; };
  }, [key, eligible, attempt, request]);
  if (!eligible) return null;
  const state = read?.key === key ? read : null;
  const review = state?.payload ? readDeliveryReview(state.payload, job) : null;
  const delivery = review?.delivery;
  const url = safeDeliveryUrl(delivery?.content?.link);
  return h('section', { className: 'v2-panel v2-stack', 'aria-label': 'Delivery review' },
    h('h2', null, 'Submitted delivery'),
    h('p', { className: 'v2-muted' }, 'Open and test the submitted work, then compare it with the acceptance criteria before choosing Approve or Request revision. A confirmed submission is not proof that the work meets the requirements.'),
    criteriaView(job.document?.criteria),
    !state || state.loading ? h('p', { role: 'status' }, 'Loading submitted delivery…') : state.error ? h('div', { role: 'alert' }, 'Unable to load the private delivery. Do not approve without reviewing it.') : !delivery ? h('div', { role: 'alert', className: 'v2-warning' }, review?.message) : h('section', { 'aria-label': 'Current confirmed delivery' },
      h('h3', null, `Version ${delivery.version}`),
      h('p', { className: 'v2-muted' }, 'Content hash matches the current on-chain delivery. External website content can change after submission; inspect the actual work yourself.'),
      url ? h('a', { className: 'v2-button', href: url, target: '_blank', rel: 'noopener noreferrer', style: { overflowWrap: 'anywhere', wordBreak: 'break-word' } }, `Open delivery: ${url}`) : h('p', { className: 'v2-muted' }, 'No safe HTTP(S) delivery link is available. Review the submitted content below.'),
      h('details', null, h('summary', null, 'Submitted content and hash'), h('p', { className: 'v2-code', style: { overflowWrap: 'anywhere' } }, delivery.contentHash), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, readable(delivery.content))),
      review.history.length ? h('details', null, h('summary', null, 'Other stored versions'), review.history.map((item, i) => { // Only earlier, superseded versions get a link; unconfirmed drafts stay text.
      const itemUrl = safeDeliveryUrl(item?.content?.link); let earlier = false; try { earlier = BigInt(item.version) < BigInt(delivery.version); } catch {} return h('div', { key: i, className: 'v2-stack' }, h('p', null, `Version ${item.version} — ${earlier ? 'earlier version, kept unchanged' : 'saved but not the confirmed delivery'}`), earlier && itemUrl ? h('a', { href: itemUrl, target: '_blank', rel: 'noopener noreferrer', style: { overflowWrap: 'anywhere', wordBreak: 'break-word' } }, itemUrl) : null, h('details', null, h('summary', null, 'Stored content'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, readable(item.content)))); })) : null),
    state && !state.loading ? h('button', { type: 'button', className: 'v2-button secondary', onClick: () => setAttempt(value => value + 1) }, 'Refresh delivery') : null);
}
