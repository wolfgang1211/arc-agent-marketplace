import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { installLocalTestWallet, localWalletAudit } from './v2-local-browser-wallet.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/wolfgang/AppData/Local/hermes/hermes-agent/node_modules/playwright');
const dir = 'C:/Users/wolfgang/AppData/Local/hermes/cache/scratch/v2-local-ui-state';
const manifest = JSON.parse(fs.readFileSync(dir + '/manifest.json', 'utf8'));
const origin = 'http://127.0.0.1:3104';
const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 20000 });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installLocalTestWallet(context, { rpcUrl: manifest.rpcUrl, marketplace: manifest.pair.market, vault: manifest.pair.vault, usdc: manifest.pair.token, roles: manifest.roles, role: 'client' });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  page = await context.newPage();
  page.on('pageerror', (error) => console.error('LOCAL_UI_PAGE_ERROR', error.name, error.message));
  page.setDefaultTimeout(20000);
  await page.goto(origin + '/v2/account', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const health = await page.evaluate(async () => {
    const response = await fetch('/api/v2/health');
    return { status: response.status, body: await response.json() };
  });
  assert.equal(health.status, 200);
  assert.equal(health.body.source.chainId, 31337);
  assert.equal(health.body.data.status, 'healthy');
  assert.equal(health.body.data.stale, false);
  assert.equal(health.body.data.reader, 'available');
  const profile = await page.evaluate(async () => (await (await fetch('/api/v2/profile')).json()).profile);
  assert.equal(profile.chainId, '31337');
  assert.equal(profile.marketplace, manifest.pair.market);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
  const audit = await localWalletAudit(page);
  assert.equal(audit.filter((entry) => entry.method === 'personal_sign').length, 1);
  assert.equal(audit.filter((entry) => entry.method === 'eth_sendTransaction').length, 0);
  const form = await page.getByRole('heading', { name: 'Canonical policy (read-only)' }).count().catch(() => 0);
  const state = { kind: 'real-marketplace-browser-auth-only', browser: browser.version(), channel: 'msedge', headless: true, selectedProfile: profile.id, chainId: profile.chainId, canonicalHealth: health.body.data, authenticated: true, personalSignRequests: 1, transactionBroadcasts: 0, policyHeadingCount: form };
  fs.writeFileSync(dir + '/browser-auth-evidence.json', JSON.stringify(state, null, 2) + '\n');
  console.log(JSON.stringify(state, null, 2));
  console.log('FORM_CONTROLS', JSON.stringify(await page.locator('input,textarea,select,button').evaluateAll((nodes) => nodes.map((node) => ({ tag: node.tagName, name: node.name, type: node.type, label: node.closest('label')?.querySelector('span')?.textContent || node.textContent?.trim().slice(0, 100), disabled: node.disabled })) )));
} catch (error) {
  console.error('BROWSER_AUTH_ACCEPTANCE_FAILED', error.name, error.message);
  if (page) console.log('VISIBLE_UI_STATE', JSON.stringify(await page.locator('h1,h2,button,[role="alert"]').allTextContents()));
  throw error;
} finally { await browser.close(); }
