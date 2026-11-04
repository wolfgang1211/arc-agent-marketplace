import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { installLocalTestWallet, localWalletAudit } from './v2-local-browser-wallet.mjs';

const require = createRequire(import.meta.url);
const playwrightModule = process.env.V2_PLAYWRIGHT_MODULE || path.join(os.homedir(), 'AppData/Local/hermes/hermes-agent/node_modules/playwright');
const { chromium } = require(playwrightModule);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(scriptDir, '../..');
const outDir = path.join(repo, 'contract/docs/v2-ui-screenshots/edge-current');
const origin = 'http://127.0.0.1:3104';
const stateDir = process.env.V2_LOCAL_UI_STATE;
if (!stateDir) throw new Error('V2_LOCAL_UI_STATE is required');
const manifestPath = path.join(stateDir, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
assert.equal(String(manifest.chainId), '31337');
assert.equal(manifest.rpcUrl, 'http://127.0.0.1:8545');
const viewports = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }];
const statuses = [
  { name: 'Open', label: 'Open' }, { name: 'InProgress', label: 'In progress' }, { name: 'Submitted', label: 'Submitted' },
  { name: 'RevisionPending', label: 'Revision pending' }, { name: 'Disputed', label: 'Disputed' }, { name: 'Completed', label: 'Completed' }, { name: 'Refunded', label: 'Refunded' },
];
const cases = [
  { case: 'jobs-list', route: '/v2/jobs', actor: 'client', expectedStatuses: statuses.map((x) => x.label) },
  ...statuses.map((status, index) => ({ case: `job${index + 1}${status.name}`, route: `/v2/jobs/${index + 1}`, actor: 'client', expectedStatus: status.label })),
  { case: 'new-form-empty', route: '/v2/jobs/new', actor: 'client' },
  { case: 'new-form-filled', route: '/v2/jobs/new', actor: 'client', filled: true },
  { case: 'accountclient', route: '/v2/account', actor: 'client', auth: true },
  { case: 'accountoperator', route: '/v2/account', actor: 'operator', auth: true },
  { case: 'resolverauthenticated', route: '/v2/resolver', actor: 'resolver', auth: true },
  { case: 'wallet-disconnected', route: '/v2/account', actor: 'client', disconnected: true },
  { case: 'wrong-network', route: '/v2/account', actor: 'client', wrongNetwork: true },
  { case: 'reader-unavailable', route: '/v2/jobs', actor: 'client', readerUnavailable: true },
];

const redact = (value) => String(value ?? '')
  .replace(/0x[0-9a-fA-F]{64,}/g, '[REDACTED_HEX]')
  .replace(/\b(?:Bearer\s+|token=|csrf=|session=|cookie=)[^\s,&;]+/gi, '[REDACTED_VALUE]')
  .replace(/\b(?:signature|sig|payload)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED_VALUE]');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileFor = (viewport, item) => `${String(viewports.indexOf(viewport) * cases.length + cases.indexOf(item) + 1).padStart(2, '0')}-${viewport.name}-${item.case}.png`;

async function rpc(method, params = []) {
  const response = await fetch(manifest.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`RPC_${method}_FAILED`);
  return body.result;
}
const latest = await rpc('eth_getBlockByNumber', ['latest', false]);
const chainId = await rpc('eth_chainId');
if (BigInt(chainId) !== 31337n) throw new Error('LOCAL_CHAIN_GUARD_FAILED');
const applyBy = new Date(Number(BigInt(latest.timestamp)) * 1000 + 2 * 86400000).toISOString().slice(0, 16);

await fs.mkdir(outDir, { recursive: true });
const ledgerPath = path.join(outDir, 'ledger.json');
const rows = [];
const failures = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 30000 });
const browserVersion = browser.version();
const ledgerPayload = () => ({ browser: { channel: 'msedge', headless: true, version: browserVersion, playwrightResolution: 'existing installation; explicit override or user-home fallback', viewportSet: viewports }, origin, localStateDirectoryVariable: 'V2_LOCAL_UI_STATE', chainId: '31337', anchorBlock: manifest.anchorBlock, latestBlockAtStart: { number: String(BigInt(latest.number)), hash: latest.hash }, rows, failures });
const flushLedger = () => fs.writeFile(ledgerPath, JSON.stringify(ledgerPayload(), null, 2) + '\n');

async function contextFor(viewport, item, sendAttempts) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, isMobile: viewport.width < 700 });
  await installLocalTestWallet(context, { rpcUrl: manifest.rpcUrl, marketplace: manifest.pair.market, vault: manifest.pair.vault, usdc: manifest.pair.token, roles: manifest.roles, role: item.actor });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.href === manifest.rpcUrl) {
      let body = null;
      try { body = request.postDataJSON(); } catch {}
      if (body?.method === 'eth_sendTransaction' || body?.method === 'eth_sendRawTransaction') { sendAttempts.push(body.method); return route.abort(); }
    }
    if (item.readerUnavailable && url.pathname.startsWith('/api/v2/')) return route.abort();
    return route.continue();
  });
  return context;
}

async function authenticate(page, item) {
  if (!item.auth && !item.wrongNetwork) return false;
  if (item.wrongNetwork) await page.evaluate(() => window.__v2LocalTestWallet.reportWrongNetwork(true));
  const connect = page.getByRole('button', { name: 'Connect wallet', exact: true });
  await connect.waitFor({ state: 'visible', timeout: 90000 });
  await connect.click();
  if (item.wrongNetwork) return false;
  const signIn = page.getByRole('button', { name: 'Sign in with wallet', exact: true });
  await signIn.waitFor({ state: 'visible', timeout: 30000 });
  await signIn.click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor({ state: 'visible', timeout: 90000 });
  return true;
}

async function fillMeaningfulForm(page) {
  const values = {
    title: 'Build a mobile-first landing page',
    description: 'Create a responsive product landing page with a clear headline, three feature cards, accessible navigation, and a working contact form. Deliver source code and a runnable local setup.',
    criteria: 'Responsive at 390px and 1440px.\nAll controls work with a keyboard.\nContact form validates input; setup documented.',
    category: 'Website',
    tags: 'landing-page,frontend,accessibility',
    reward: '12.50',
    deliveryDuration: '48',
    reviewDuration: '24',
    revisionDuration: '24',
    revisionLimit: '2',
    applyBy,
  };
  for (const [name, value] of Object.entries(values)) {
    const locator = page.locator(`input[name="${name}"], textarea[name="${name}"], select[name="${name}"]`).first();
    await locator.waitFor({ state: 'attached', timeout: 30000 });
    await locator.fill(value);
  }
  for (let index = 0; index < 3; index += 1) await page.locator('select').nth(index).selectOption('hours');
}

async function inspect(page) {
  return page.evaluate(({ applyBy }) => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const nodes = [...document.querySelectorAll('body *')];
    const overflow = nodes.map((el) => ({ tag: el.tagName, cls: String(el.className || '').slice(0, 120), rect: rect(el) }))
      .filter((x) => x.rect.width > 0 && (x.rect.left < -1 || x.rect.right > innerWidth + 1)).slice(0, 20);
    const metrics = [...document.querySelectorAll('.v2-metrics')].map((el) => ({ text: (el.textContent || '').trim().slice(0, 300), rect: rect(el), children: [...el.children].map(child => rect(child)).filter(r => r.width > 0 && r.height > 0) }));
    const metricsOverlap = metrics.some(metric => metric.children.some((a, i) => metric.children.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)));
    const labelCandidates = [...document.querySelectorAll('label, dt, th, [data-testid]')].map((el) => ({ text: (el.textContent || '').trim().replace(/\s+/g, ' '), rect: rect(el) })).filter((x) => x.rect.width > 0);
    const findLabel = (keyword) => labelCandidates.filter((x) => new RegExp(`^${keyword}(?:\\s*\\*)?$`, 'i').test(x.text)).sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))[0];
    const reward = findLabel('reward');
    const category = findLabel('category');
    const overlap = reward && category && reward.rect.left < category.rect.right && reward.rect.right > category.rect.left && reward.rect.top < category.rect.bottom && reward.rect.bottom > category.rect.top;
    const inputs = [...document.querySelectorAll('input[name], textarea[name], select')].map((el) => ({ name: el.name, value: el.value, type: el.type || el.tagName.toLowerCase(), selectedText: el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent?.trim() : undefined, visible: rect(el).width > 0 && rect(el).height > 0 }));
    const visibleText = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
    const applyInput = document.querySelector('input[name="applyBy"]');
    return { url: location.href, title: document.title, visibleText: visibleText.slice(0, 2400), fullText: visibleText, statusLabels: [...document.querySelectorAll('.v2-status')].map((el) => el.textContent.trim()), overflow: { documentScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, viewportWidth: innerWidth, elements: overflow }, v2Metrics: metrics, rewardCategoryOverlap: Boolean(overlap) || metricsOverlap, rewardRect: reward?.rect || null, categoryRect: category?.rect || null, inputs, selectedUnits: inputs.filter((x) => x.type === 'select-one'), applyByVisible: Boolean(applyInput && applyInput.value === applyBy && rect(applyInput).width > 0 && rect(applyInput).height > 0), walletAuthenticated: Boolean(document.querySelector('[data-testid="wallet-signout"]')), readerStatus: document.querySelector('[aria-label^="Reader status:"]')?.getAttribute('aria-label') || null };
  }, { applyBy });
}

try {
  await flushLedger();
  for (const viewport of viewports) {
    for (const item of cases) {
      const filename = fileFor(viewport, item);
      const sendAttempts = [];
      const context = await contextFor(viewport, item, sendAttempts);
      const page = await context.newPage();
      let authDone = false;
      try {
        await page.goto(origin + (item.auth && item.route === '/v2/resolver' ? '/v2/account' : item.route), { waitUntil: 'domcontentloaded', timeout: 90000 });
        await sleep(1200);
        if (item.disconnected) {
          // Deliberately leave the real wallet unconnected; no synthetic account state is installed.
          await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        } else {
          authDone = await authenticate(page, item);
          if (item.auth && item.route === '/v2/resolver') {
            await page.goto(origin + item.route, { waitUntil: 'domcontentloaded', timeout: 90000 });
            await sleep(1200);
          }
        }
        if (item.filled) await fillMeaningfulForm(page);
        await sleep(item.readerUnavailable ? 2500 : 800);
        if (item.expectedStatuses) await page.locator('.v2-list-item').nth(6).waitFor({ state: 'visible', timeout: 30000 });
        if (item.expectedStatus) await page.locator('.v2-status').first().waitFor({ state: 'visible', timeout: 30000 });
        const observed = await inspect(page);
        if (observed.overflow.documentScrollWidth > observed.overflow.viewportWidth || observed.overflow.bodyScrollWidth > observed.overflow.viewportWidth || observed.overflow.elements.length) throw new Error('UNEXPECTED_HORIZONTAL_OVERFLOW');
        assert.equal(observed.rewardCategoryOverlap, false, 'METRICS_OR_REWARD_CATEGORY_OVERLAP');
        if (item.expectedStatuses) for (const label of item.expectedStatuses) assert.match(observed.fullText, new RegExp(`\\b${label.replace(' ', '\\s+')}\\b`), `missing rendered status ${label}`);
        if (item.expectedStatus) assert.ok(observed.statusLabels.includes(item.expectedStatus), `wrong rendered status for ${item.case}`);
        if (item.filled) {
          const byName = Object.fromEntries(observed.inputs.map((input) => [input.name, input]));
          for (const [name, value] of Object.entries({ reward: '12.50', deliveryDuration: '48', reviewDuration: '24', revisionDuration: '24', revisionLimit: '2', applyBy })) assert.equal(byName[name]?.value, value, `filled value mismatch: ${name}`);
          assert.deepEqual(observed.selectedUnits.map((x) => x.selectedText), ['Hours', 'Hours', 'Hours']);
          assert.equal(observed.applyByVisible, true, 'filled apply-by date is not visible');
        }
        if (item.disconnected) assert.match(observed.visibleText, /No wallet is connected\./);
        if (item.wrongNetwork) assert.match(observed.visibleText, /network|chain/i, 'wrong-network state not rendered');
        if (item.readerUnavailable) assert.ok(observed.readerStatus !== 'Reader status: Live' || /unable to read|unavailable|error|failed/i.test(observed.visibleText), 'reader fault state not rendered');
        assert.equal(sendAttempts.length, 0, `blocked transaction attempt observed: ${sendAttempts.join(',')}`);
        const block = await rpc('eth_getBlockByNumber', ['latest', false]);
        const audit = await localWalletAudit(page);
        if (item.auth) { assert.equal(authDone, true, `authenticated ${item.case} flow not completed`); if (item.route === '/v2/resolver') assert.ok(!/Wallet session required/.test(observed.visibleText), 'resolver authenticated state not rendered'); else assert.ok(audit.some((entry) => entry.method === 'personal_sign'), `authenticated ${item.case} signature not observed`); }
        rows.push({ filename, viewport: `${viewport.width}x${viewport.height}`, route: item.route, case: item.case, actor: item.actor, expectedStatus: item.expectedStatus || item.expectedStatuses || null, actualObservedState: redact(observed.visibleText), actualBlock: { number: String(BigInt(block.number)), hash: block.hash }, browserVersion, capturedAt: new Date().toISOString(), domOverflowMetrics: observed.overflow, v2Metrics: observed.v2Metrics, rewardCategoryOverlap: observed.rewardCategoryOverlap, inputs: item.filled ? observed.inputs : undefined, selectedUnits: item.filled ? observed.selectedUnits : undefined, applyByVisible: item.filled ? observed.applyByVisible : undefined, walletAuthenticated: authDone || observed.walletAuthenticated || audit.some((entry) => entry.method === 'personal_sign'), readerStatus: observed.readerStatus, walletAuditMethods: audit.map((entry) => entry.method), transactionSendAttempts: sendAttempts, observedUrl: observed.url, readerUnavailableFaultInjection: Boolean(item.readerUnavailable), status: 'captured' });
        await page.screenshot({ path: path.join(outDir, filename), fullPage: true });
        await flushLedger();
        console.log(`CAPTURED ${filename}`);
      } catch (error) {
        failures.push({ filename, viewport: `${viewport.width}x${viewport.height}`, route: item.route, case: item.case, actor: item.actor, error: redact(error.message), transactionSendAttempts: sendAttempts });
        await flushLedger();
        console.error(`FAILED ${filename}: ${redact(error.message)}`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await flushLedger();
  await browser.close();
}

const expected = viewports.length * cases.length;
const unique = new Set(rows.map((r) => r.filename));
if (rows.length !== expected || unique.size !== expected) console.error(`COUNT_MISMATCH expected=${expected} captured=${rows.length} unique=${unique.size}`);
const indexLines = [
  '# V2 UI screenshots — Microsoft Edge current', '',
  `Real local captures from installed Microsoft Edge via Playwright (version ${browserVersion}, channel: msedge, headless: true) against \`${origin}\` / chain 31337.`,
  '',
  '**Visual acceptance remains pending Yusuf + Claude.** `reader-unavailable` is an explicit request-abort fault injection for `/api/v2/**`; it does not fabricate response JSON or mutate state.',
  '',
  `- Requested: ${expected}`,
  `- Captured: ${rows.length}`,
  `- Failed: ${failures.length}`,
  `- Ledger: [ledger.json](./ledger.json)`, '',
];
for (const row of rows) indexLines.push(`- [${row.filename}](./${row.filename}) — ${row.viewport}, ${row.case}, actor=${row.actor}${row.readerUnavailableFaultInjection ? ', **network-unreachable fault injection**' : ''}`);
if (failures.length) { indexLines.push('', '## Failed cases'); for (const f of failures) indexLines.push(`- ${f.filename}: ${f.error}`); }
await fs.writeFile(path.join(outDir, 'INDEX.md'), indexLines.join('\n') + '\n');
console.log(JSON.stringify({ expected, captured: rows.length, unique: unique.size, failed: failures.length, outDir, index: path.join(outDir, 'INDEX.md'), ledger: ledgerPath }));
if (failures.length || rows.length !== expected || unique.size !== expected) process.exitCode = 1;
