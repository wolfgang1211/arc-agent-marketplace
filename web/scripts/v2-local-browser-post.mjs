import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { installLocalTestWallet, localWalletAudit } from './v2-local-browser-wallet.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/wolfgang/AppData/Local/hermes/hermes-agent/node_modules/playwright');
const directory = 'C:/Users/wolfgang/AppData/Local/hermes/cache/scratch/v2-local-ui-state';
const manifest = JSON.parse(fs.readFileSync(directory + '/manifest.json', 'utf8'));
const evidencePath = directory + '/browser-post-evidence.json';
const previous = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : null;
if (previous?.broadcasts?.some((entry) => entry.to?.toLowerCase() === manifest.pair.market.toLowerCase())) throw new Error('POST_ALREADY_BROADCAST_USE_READ_ONLY_RESUME_NOT_REPOST');
if (previous?.intentId && previous.broadcasts?.length) {
  const historyPath = directory + '/browser-post-attempt-' + previous.intentId + '.json';
  if (!fs.existsSync(historyPath)) fs.writeFileSync(historyPath, JSON.stringify(previous, null, 2) + '\n', { flag: 'wx' });
}
const evidence = { kind: 'real-marketplace-browser-post', passed: false, broadcasts: [], intentId: null, assertions: [] };
const save = () => fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 20000 });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installLocalTestWallet(context, { rpcUrl: manifest.rpcUrl, marketplace: manifest.pair.market, vault: manifest.pair.vault, usdc: manifest.pair.token, roles: manifest.roles, role: 'client' });
  await context.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto('http://127.0.0.1:3104/v2/account', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByText('Reader available', { exact: true }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  await page.getByRole('link', { name: 'New job', exact: true }).click();
  await page.getByText('Canonical policy (read-only)', { exact: true }).waitFor();
  const chainTimestamp = await page.evaluate(async () => {
    const block = await window.ethereum.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
    return Number(BigInt(block.timestamp));
  });
  const applyBy = new Date((chainTimestamp + 86400) * 1000).toISOString().slice(0, 16);
  for (const [label, value] of [
    ['Reward (USDC)', '2'], ['Delivery duration (seconds)', '86400'], ['Review duration (seconds)', '86400'], ['Revision duration (seconds)', '43200'], ['Revision limit', '2'],
    ['Apply by (UTC)', applyBy], ['Title', 'Build a browser-game quest assistant'],
    ['Description', 'Create a local browser-game assistant that tracks quest progress and exports a concise activity log. Keep all actions visible and require confirmation before changing game state.'],
    ['Criteria (one per line)', 'Track completed quests without duplicate entries\nExport the activity log as a JSON file\nProvide a short setup guide and a reproducible demo'],
  ]) await page.getByLabel(label, { exact: false }).fill(value);
  await page.getByLabel('Public draft', { exact: true }).check();
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v2/jobs' && response.request().method() === 'POST');
  await page.locator('[data-action="postJob"]').click();
  const response = await responsePromise;
  const prepared = await response.json();
  if (response.status() !== 201 && response.status() !== 200) throw new Error('POST_PREFLIGHT_FAILED:' + response.status() + ':' + String(prepared.error));
  evidence.intentId = prepared.intentId;
  evidence.expected = prepared.expected;
  evidence.profileId = 'local-hardhat';
  evidence.chainId = '31337';
  evidence.wallet = manifest.roles.client;
  evidence.action = 'postJob';
  evidence.assertions.push('actual UI submit produced server-owned local postJob intent');
  assert.equal(prepared.transaction.to.toLowerCase(), manifest.pair.market.toLowerCase());
  assert.equal(prepared.transaction.chainId, '31337');
  assert.equal(prepared.allowance.requiredAmount, '2000000');
  assert.equal(prepared.allowance.spender.toLowerCase(), manifest.pair.market.toLowerCase());
  save();
  await page.getByTestId('v2-tx-success').waitFor({ state: 'visible', timeout: 120000 });
  evidence.broadcasts = (await localWalletAudit(page)).filter((entry) => entry.method === 'eth_sendTransaction' && entry.hash);
  assert.ok(evidence.broadcasts.length >= 1);
  const main = evidence.broadcasts.find((entry) => entry.to.toLowerCase() === manifest.pair.market.toLowerCase());
  assert.ok(main);
  const readback = await page.evaluate(async ({ hash, intent }) => {
    const result = await fetch('/api/v2/transactions/' + hash + '?intent=' + encodeURIComponent(intent));
    return { status: result.status, body: await result.json() };
  }, { hash: main.hash, intent: evidence.intentId });
  assert.equal(readback.status, 200);
  assert.equal(readback.body.ok, true);
  assert.equal(readback.body.confirmed, true);
  assert.equal(readback.body.intentId, evidence.intentId);
  evidence.readback = readback.body;
  evidence.jobId = readback.body.state.jobId;
  evidence.assertions.push('visible success follows actual wallet broadcast, receipt and server canonical readback');
  evidence.passed = true;
  save();
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  if (page) {
    evidence.broadcasts = (await localWalletAudit(page).catch(() => [])).filter((entry) => entry.method === 'eth_sendTransaction' && entry.hash);
    evidence.visibleState = await page.locator('[role="alert"],[data-testid="v2-tx-state"]').allTextContents();
  }
  evidence.failure = { name: error.name, message: error.message };
  save();
  console.error('BROWSER_POST_FAILED', JSON.stringify(evidence));
  throw error;
} finally { await browser.close(); }
