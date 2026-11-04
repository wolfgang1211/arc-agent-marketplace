import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EdgeAcceptance } from './v2-edge-driver.mjs';

// Explicit local acceptance runner. All mutations below use rendered forms and
// the injected EIP-1193 provider. Node-side RPC is read-only except explicit
// local-clock advancement in the timeout phase.
const phase = process.argv[2] || 'probe';
const run = await new EdgeAcceptance().start();
const checkpoint = path.join(run.stateDir, 'browser-flow-state.json');
const state = fs.existsSync(checkpoint) ? JSON.parse(fs.readFileSync(checkpoint, 'utf8')) : {};
const save = () => fs.writeFileSync(checkpoint, JSON.stringify(state, null, 2));
async function nav(page, route) { await page.goto(run.origin + route, { waitUntil: 'domcontentloaded', timeout: 90000 }); await page.getByText('Live', { exact: true }).first().waitFor({ timeout: 90000 }); }
async function field(form, name, value) {
  const names = { Title: 'title', Description: 'description', Category: 'category', Tags: 'tags', 'Reward (USDC)': 'reward', 'Apply by (UTC)': 'applyBy', Delivery: 'deliveryDuration', Review: 'reviewDuration', Revision: 'revisionDuration' };
  if (names[name]) { await form.locator(`[name="${names[name]}"]`).fill(String(value)); return; }
  if (name === 'Acceptance criteria') { await form.locator('textarea').last().fill(String(value)); return; }
  await form.getByLabel(name, { exact: true }).fill(String(value));
}
const submitted = (flow, action) => run.steps.find(x => x.flow === flow && x.action === action && x.passed);
async function tx(page, action, flow, form, fill) {
  const done = submitted(flow, action);
  if (done) return done;
  await form.waitFor({ state: 'visible', timeout: 90000 });
  return run.tx(page, action, { flow, fill, click: () => form.locator('button[type="submit"]').click() });
}
async function main() {
  const client = await run.login('client');
  if (!state.mainJobId) {
    assert.equal(submitted('main', 'postJob'), undefined, 'Recover job ID from the existing proof; never send again');
    await nav(client, '/v2/jobs/new');
    const form = client.getByTestId('job-creation-form');
    const latest = await run.rpc('eth_getBlockByNumber', ['latest', false]);
    const applyBy = new Date((Number(BigInt(latest.timestamp)) + 3 * 86400) * 1000).toISOString().slice(0, 16);
    const posted = await tx(client, 'postJob', 'main', form, async () => {
      await field(form, 'Title', 'Build an accessible prediction-market research dashboard');
      await field(form, 'Description', 'Create a responsive research dashboard with wallet-independent browsing, searchable markets, clear empty states, keyboard navigation, and a reproducible local setup. Do not use live credentials or submit trades.');
      await field(form, 'Acceptance criteria', 'Market search filters rendered results\nKeyboard navigation reaches all controls\nMobile layout has no horizontal overflow\nREADME documents the local setup');
      await field(form, 'Category', 'website');
      await field(form, 'Tags', 'nextjs, accessibility, analytics');
      await field(form, 'Reward (USDC)', '100');
      await field(form, 'Apply by (UTC)', applyBy);
      await field(form, 'Delivery', '48');
      await field(form, 'Review', '24');
      await field(form, 'Revision', '24');
      await form.locator('[name="revisionLimit"]').fill('1');
      await form.getByRole('checkbox').check();
    });
    state.mainJobId = posted.state.jobId; save();
  }
  if (phase === 'post') { console.log('POST_JOB_UI_PASSED', state.mainJobId); return; }
  const id = state.mainJobId;
  const operator = await run.login('operator');
  if (!state.applicationPrepared) {
    await nav(operator, '/v2/jobs/' + id);
    const form = operator.getByTestId('application-form');
    await form.waitFor();
    await form.locator('[name="pitch"]').fill('I will build the accessible dashboard, test keyboard navigation and mobile layout, and provide a clear setup guide.');
    await form.locator('button[data-action="apply"]').click();
    await operator.getByText('Application signed and saved. No transaction submitted.', { exact: true }).waitFor({ timeout: 90000 });
    state.applicationPrepared = true; save();
    run.steps.push({ flow: 'main', action: 'apply', passed: true, broadcastCount: 0, evidence: 'Rendered application form, real local EIP-712 signature, authenticated API storage' }); run.save();
  }
  if (!submitted('main', 'awardJob')) {
    await nav(client, '/v2/jobs/' + id);
    const applications = client.getByTestId('application-form');
    await applications.getByRole('button', { name: 'Load applications', exact: true }).click();
    await applications.getByRole('button', { name: /^Operator / }).first().click();
    await run.tx(client, 'awardJob', { flow: 'main', click: () => applications.locator('button[data-action="awardJob"]').click() });
  }
  if (!submitted('main', 'submitDelivery')) {
    await nav(operator, '/v2/jobs/' + id);
    const form = operator.getByTestId('delivery-form');
    await tx(operator, 'submitDelivery', 'main', form, async () => {
      const link = form.locator('[name="deliveryLink"]');
      if (await link.count()) await link.fill('https://example.com/research-dashboard/review');
      else await field(form, 'Content JSON', JSON.stringify({ link: 'https://example.com/research-dashboard/review', summary: 'Responsive dashboard, search, keyboard navigation and setup guide are ready for review.' }));
    });
  }
  if (!submitted('main', 'requestRevision')) {
    await nav(client, '/v2/jobs/' + id);
    await client.getByTestId('job-action-form').locator('select[name="action"]').selectOption('requestRevision');
    const form = client.getByTestId('job-action-form');
    await tx(client, 'requestRevision', 'main', form, async () => {
      await form.locator('[name="revisionNotes"]').fill('Add a visible keyboard focus ring and include the accessibility checklist in the setup guide.');
    });
  }
  if (!submitted('main', 'submitRevision')) {
    await nav(operator, '/v2/jobs/' + id);
    const form = operator.getByTestId('delivery-form');
    await tx(operator, 'submitRevision', 'main', form, async () => {
      const link = form.locator('[name="deliveryLink"]');
      if (await link.count()) await link.fill('https://example.com/research-dashboard/revision-1');
      else await field(form, 'Content JSON', JSON.stringify({ link: 'https://example.com/research-dashboard/revision-1', summary: 'Revised keyboard focus styling and added the accessibility checklist.' }));
    });
  }
  if (!submitted('main', 'approve')) {
    await nav(client, '/v2/jobs/' + id);
    await client.getByTestId('job-action-form').locator('select[name="action"]').selectOption('approve');
    await tx(client, 'approve', 'main', client.getByTestId('job-action-form'));
  }
  if (!submitted('main', 'withdrawCredit')) {
    await nav(operator, '/v2/account');
    await run.tx(operator, 'withdrawCredit', { flow: 'main', click: () => operator.getByTestId('account-form').locator('button[data-action="withdrawCredit"]').click() });
  }
  console.log('MAIN_UI_FLOW_PASSED', id);
}
async function lifecycle(role, jobId, action, flow, fill) {
  const done = submitted(flow, action);
  if (done) return done;
  const page = await run.login(role);
  await nav(page, '/v2/jobs/' + jobId);
  const form = page.getByTestId('job-action-form');
  await form.waitFor({ state: 'visible', timeout: 90000 });
  await form.locator('select[name="action"]').selectOption(action);
  return tx(page, action, flow, form, fill ? () => fill(form) : undefined);
}
async function mutual() {
  const latest = await run.rpc('eth_getBlockByNumber', ['latest', false]);
  const expires = new Date((Number(BigInt(latest.timestamp)) + 7200) * 1000).toISOString().slice(0, 16);
  await lifecycle('client', '4', 'proposeMutual', 'mutual', async form => {
    await form.locator('[name="mutualRefund"]').fill('100');
    await form.locator('[name="grossPayout"]').fill('0');
    await form.locator('[name="mutualExpiry"]').fill(expires);
  });
  const accepted = await lifecycle('operator', '4', 'acceptMutual', 'mutual');
  assert.equal(String(accepted.state.status), '7', 'A full refund must read back Refunded, not Completed');
  console.log('MUTUAL_UI_FLOW_PASSED', '4', 'Refunded');
}
async function dispute() {
  await lifecycle('client', '3', 'openDispute', 'dispute');
  const resolved = await lifecycle('resolver', '3', 'resolveDispute', 'dispute', async form => {
    await form.locator('[name="grossPayout"]').fill('80');
    await form.locator('[name="decisionReason"]').fill('The submitted tool meets the core acceptance criteria. The remaining documentation work warrants a partial refund.');
    await form.locator('[name="evidenceReference"]').fill('https://example.com/review/tool-acceptance-checklist');
  });
  assert.equal(String(resolved.state.status), '6');
  console.log('DISPUTE_RESOLVER_UI_FLOW_PASSED', '3');
}
async function accountAction(action, flow, amount) {
  const done = submitted(flow, action);
  if (done) return done;
  const page = await run.login('operator');
  await nav(page, '/v2/account');
  const panel = page.getByTestId('account-form');
  await panel.waitFor({ state: 'visible' });
  if (amount !== undefined) await panel.locator('[name="amount"]').fill(amount);
  return run.tx(page, action, { flow, click: () => panel.locator(`button[data-action="${action}"]`).click() });
}
async function stake() {
  await accountAction('depositStake', 'stake', '2.5');
  await accountAction('withdrawStake', 'stake', '2.5');
  console.log('STAKE_DEPOSIT_WITHDRAW_UI_PASSED');
}
async function timeoutClaim(kind, jobId, deadlineKey) {
  const flow = 'timeout-' + kind;
  if (submitted(flow, kind)) return;
  const page = await run.login('client');
  await nav(page, '/v2/jobs/' + jobId);
  const form = page.getByTestId('job-action-form');
  await form.waitFor({ state: 'visible' });
  const options = await form.locator('select[name="action"] option').evaluateAll(nodes => nodes.map(n => n.value));
  const job = (await (await page.request.get(run.origin + '/api/v2/jobs/' + jobId)).json()).data;
  const deadline = BigInt(job[deadlineKey] ?? job.data?.[deadlineKey]);
  const latest = await run.rpc('eth_getBlockByNumber', ['latest', false]);
  if (BigInt(latest.timestamp) < deadline) {
    assert.equal(options.includes(kind), false, 'Timeout must not be advertised before its canonical deadline');
    assert.equal(BigInt(await run.rpc('eth_chainId')), 31337n);
    await run.rpc('evm_setNextBlockTimestamp', [Number(deadline + 1n)]);
    await run.rpc('evm_mine');
    run.steps.push({ flow, action: 'deadline-control', passed: true, evidence: 'Actual loopback EVM clock advanced for local timeout test only', fromBlock: latest.hash, fromTimestamp: String(BigInt(latest.timestamp)), deadline: String(deadline), targetTimestamp: String(deadline + 1n), actionAbsentBeforeDeadline: true, broadcastCount: 0 }); run.save();
  }
  const claimed = await lifecycle('client', jobId, kind, flow);
  assert.equal(String(claimed.state.status), '7');
  console.log('TIMEOUT_UI_CLAIM_PASSED', kind, jobId, 'Refunded');
}
async function recovery(flowPrefix = 'recovery') {
  for (const scenario of ['reload', 'disconnect', 'timeout']) {
    if (submitted(flowPrefix + '-' + scenario, 'withdrawStake')) continue;
    const page = await run.login('operator');
    await nav(page, '/v2/account');
    const form = page.getByTestId('account-form'); await form.waitFor({ state: 'visible' });
    await form.locator('[name="amount"]').fill('0.1');
    await run.recovery(page, { scenario, flowPrefix, click: () => form.locator('button[data-action="withdrawStake"]').click() });
    console.log('RECOVERY_UI_NO_DUPLICATE', scenario);
  }
}
async function timeouts() {
  await timeoutClaim('claimDeliveryTimeout', '2', 'deliveryDeadline');
  await timeoutClaim('claimOpenJobTimeout', '1', 'applyBy');
}

try {
  console.log('EDGE_ACTUAL_VERSION', run.version);
  if (phase === 'probe') {
    const page = await run.login('client');
    console.log('REAL_BROWSER_AUTHENTICATED', await page.getByTestId('wallet-signout').isVisible());
    await nav(page, '/v2/jobs/1');
    console.log('JOB_DETAIL_TEXT', (await page.locator('main').innerText()).slice(0, 1400));
    await page.screenshot({ path: path.join(run.stateDir, 'edge-probe.png'), fullPage: true });
    assert.equal(run.broadcasts.length, 0);
  } else if (phase === 'main' || phase === 'post') await main();
  else if (phase === 'mutual') await mutual();
  else if (phase === 'dispute') await dispute();
  else if (phase === 'stake') await stake();
  else if (phase === 'timeouts') await timeouts();
  else if (phase === 'recovery') await recovery();
  else if (phase === 'recovery-confirmed') await recovery('recovery-confirmed');
  else throw new Error('Unsupported explicit phase');
} catch (error) {
  console.error('BROWSER_ACCEPTANCE_FAILED', error.name, error.message.slice(0, 800));
  process.exitCode = 1;
} finally { await run.close(); }
