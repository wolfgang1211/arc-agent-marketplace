import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { installLocalTestWallet, localWalletAudit } from './v2-local-browser-wallet.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/wolfgang/AppData/Local/hermes/hermes-agent/node_modules/playwright');
const dir = 'C:/Users/wolfgang/AppData/Local/hermes/cache/scratch/v2-local-ui-state';
const manifest = JSON.parse(fs.readFileSync(dir + '/manifest.json', 'utf8'));
const attempt = JSON.parse(fs.readFileSync(dir + '/browser-post-evidence.json', 'utf8'));
const main = attempt.broadcasts.find((entry) => entry.to.toLowerCase() === manifest.pair.market.toLowerCase());
assert.ok(main?.hash);
const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 20000 });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installLocalTestWallet(context, { rpcUrl: manifest.rpcUrl, marketplace: manifest.pair.market, vault: manifest.pair.vault, usdc: manifest.pair.token, roles: manifest.roles, role: 'client' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto('http://127.0.0.1:3104/v2/account', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByText('Reader available', { exact: true }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  const readback = await page.evaluate(async ({ hash, intentId }) => {
    const response = await fetch('/api/v2/transactions/' + hash + '?intent=' + encodeURIComponent(intentId));
    return { status: response.status, body: await response.json() };
  }, { hash: main.hash, intentId: attempt.intentId });
  console.log('REAL_READBACK_DIAGNOSTIC', JSON.stringify(readback));
  assert.equal((await localWalletAudit(page)).filter((entry) => entry.method === 'eth_sendTransaction').length, 0);
  if (readback.status !== 200 || readback.body.ok !== true) throw new Error('ACTUAL_READBACK_NOT_CONFIRMED:' + readback.status + ':' + String(readback.body.error));
  const stored = { hash: main.hash, intentId: attempt.intentId, profileId: 'local-hardhat', chainId: '31337', wallet: manifest.roles.client, action: 'postJob' };
  await page.evaluate((stored) => localStorage.setItem(`v2-wallet-intent:${stored.profileId}:${stored.chainId}:${stored.wallet.toLowerCase()}:${stored.action}:${stored.intentId}`, JSON.stringify(stored)), stored);
  await page.goto('http://127.0.0.1:3104/v2/jobs/new', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByTestId('v2-tx-success').waitFor({ timeout: 30000 });
  const audit = await localWalletAudit(page);
  assert.equal(audit.filter((entry) => entry.method === 'eth_sendTransaction').length, 0);
  const evidence = { kind: 'real-browser-reload-resume-only', passed: true, hash: main.hash, intentId: attempt.intentId, readback: readback.body, resumeBroadcasts: 0 };
  fs.writeFileSync(dir + '/browser-post-resume.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
