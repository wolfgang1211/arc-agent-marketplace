import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startIsolatedNode, stopIsolatedNode, deployFixture, localRpc } from '../test/v2-local-node.mjs';
// Screenshot wallet deliberately has no transaction capability.
async function installReadOnlyWallet(context, manifest, role, disconnected) {
  await context.addInitScript(({ rpcUrl, account, disconnected }) => {
    const audit = JSON.parse(sessionStorage.getItem('qaAudit') || '[]'); const listeners = new Map(); let connected = !disconnected;
    const rpc = async (method, params = []) => { const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const b = await r.json(); if (b.error) throw new Error('LOCAL_RPC_FAILED'); return b.result; };
    const provider = { get selectedAddress() { return connected ? account : null; }, on: (name, fn) => listeners.set(name, fn), removeListener: (name) => listeners.delete(name), request: async ({ method, params = [] }) => {
      if (method === 'eth_sendTransaction' || method === 'eth_sendRawTransaction') { audit.push({ method }); throw new Error('SCREENSHOT_SEND_FORBIDDEN'); }
      if (BigInt(await rpc('eth_chainId')) !== 31337n) throw new Error('LOCAL_CHAIN_REQUIRED');
      if (method === 'eth_requestAccounts') { connected = true; listeners.get('accountsChanged')?.([account]); return [account]; }
      if (method === 'eth_accounts') return connected ? [account] : [];
      if (method === 'personal_sign') { if (!connected || params.length !== 2 || params[1].toLowerCase() !== account.toLowerCase() || !/^0x(?:[0-9a-fA-F]{2})+$/.test(params[0])) throw new Error('SIGNIN_BINDING_REQUIRED'); audit.push({ method }); sessionStorage.setItem('qaAudit', JSON.stringify(audit)); return rpc(method, params); }
      if (!['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getTransactionReceipt','eth_getTransactionByHash','eth_call','eth_getLogs','eth_getCode'].includes(method)) throw new Error('SCREENSHOT_METHOD_FORBIDDEN');
      return rpc(method, params);
    } };
    Object.defineProperty(window, 'ethereum', { value: provider });
    window.__qaAudit = () => audit.map(x => ({ ...x }));
  }, { rpcUrl: manifest.rpcUrl, account: manifest.roles[role], disconnected });
}
const localWalletAudit = (page) => page.evaluate(() => window.__qaAudit());

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repo = path.resolve(webRoot, '..');
const scratch = process.env.V2_LOCAL_UI_STATE;
if (!scratch) throw new Error('Explicit fresh V2_LOCAL_UI_STATE is required');
const outDir = path.join(repo, 'contract/docs/v2-ui-screenshots/edge-current');
const origin = 'http://127.0.0.1:3104';
const require = createRequire(import.meta.url);
const playwrightModule = process.env.V2_PLAYWRIGHT_MODULE || path.join(os.homedir(), 'AppData/Local/hermes/hermes-agent/node_modules/playwright');
const { chromium } = require(playwrightModule);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (value) => String(value ?? '').replace(/0x[0-9a-fA-F]{64,}/g, '[REDACTED_HEX]').replace(/(?:Bearer\s+|token=|csrf=|session=|cookie=)[^\s,&;]+/gi, '[REDACTED_VALUE]');
const viewports = { desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } };
const run = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, options);
  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr || `${command} exited ${code}`)));
});
async function waitHttp(url, timeout = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { try { const r = await fetch(url); if (r.ok) return; } catch {} await sleep(300); }
  throw new Error(`HTTP_READY_TIMEOUT:${url}`);
}
async function rpc(url, method, params = []) { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const b = await r.json(); if (b.error) throw new Error(`RPC_${method}_FAILED`); return b.result; }
async function inspect(page) {
  return page.evaluate(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const nodes = [...document.querySelectorAll('body *')].map((el) => ({ tag: el.tagName, text: (el.textContent || '').trim().slice(0, 100), rect: rect(el) })).filter((x) => x.rect.width > 0 && (x.rect.left < -1 || x.rect.right > innerWidth + 1));
    return { url: location.href, text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2600), fullText: document.body.innerText || '', overflow: { viewportWidth: innerWidth, documentScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, elements: nodes.slice(0, 12) }, statusLabels: [...document.querySelectorAll('.v2-status')].map((el) => el.textContent.trim()), walletAuthenticated: Boolean(document.querySelector('[data-testid="wallet-signout"]')) };
  });
}
async function fillForm(page) {
  const values = { reward: '12.50', deliveryDuration: '48', reviewDuration: '24', revisionDuration: '24', revisionLimit: '2', applyBy: '2026-12-15T17:00', title: 'Build a mobile-first landing page', description: 'Create a responsive product landing page with accessible navigation and a working contact form.', criteria: 'Responsive at 390px and 1440px.\nKeyboard accessible controls.' };
  for (const [name, value] of Object.entries(values)) await page.getByTestId(name).fill(value);
  while (await page.getByRole('button', { name: /^Remove / }).count()) await page.getByRole('button', { name: /^Remove / }).first().click();
  const chips = page.locator('input[data-testid="category"], input[data-testid="tags"]');
  await chips.nth(0).fill('Website'); await chips.nth(0).press('Enter'); await chips.nth(1).fill('landing-page,frontend'); await chips.nth(1).press('Enter');
  assert.equal(await page.locator('input[name=category]').inputValue(), 'Website');
  assert.equal(await page.locator('input[name=tags]').inputValue(), 'landing-page,frontend');
  assert.equal(await page.getByTestId('deliveryDuration').inputValue(), '48');
  assert.equal(await page.getByTestId('reviewDuration').inputValue(), '24');
  assert.equal(await page.getByTestId('revisionDuration').inputValue(), '24');
}
async function makeContext(browser, manifest, role, viewport, sendAttempts, disconnected) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 700 });
  await installReadOnlyWallet(context, manifest, role, disconnected);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    let body = null; try { body = route.request().postDataJSON(); } catch {}
    if (url.href === manifest.rpcUrl && (body?.method === 'eth_sendTransaction' || body?.method === 'eth_sendRawTransaction')) { sendAttempts.push(body.method); return route.abort(); }
    return route.continue();
  });
  return context;
}
async function signIn(page) {
  const target = page.url();
  await page.goto(origin + '/v2/account');
  await page.getByTestId('wallet-connect').click();
  await page.getByTestId('wallet-signin').click();
  await page.getByTestId('wallet-signout').waitFor({ state: 'visible', timeout: 60000 });
  await page.goto(target);
  await page.getByText('Live', { exact: true }).first().waitFor();
}
async function capture(browser, manifest, row, prepare) {
  const sendAttempts = [];
  const context = await makeContext(browser, manifest, row.role, viewports[row.viewport], sendAttempts, row.disconnected);
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  try {
    await page.goto(origin + row.route, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByText('Live', { exact: true }).first().waitFor({ state: 'visible', timeout: 90000 });
    if (prepare) await prepare(page);
    await sleep(900);
    if (row.slug.startsWith('operator-')) await page.getByTestId('delivery-form').waitFor();
    else assert.equal(await page.getByTestId('delivery-form').count(), 0);
    if (row.slug.includes('connected-approve')) await page.getByRole('button', { name: 'Approve', exact: true }).waitFor();
    if (row.disconnected) { assert.equal(await page.getByTestId('job-action-form').locator('p').count(), 1); await page.getByTestId('job-action-connect').waitFor(); }
    const observed = await inspect(page);
    assert.equal(observed.overflow.documentScrollWidth <= observed.overflow.viewportWidth, true, 'document horizontal overflow');
    assert.equal(observed.overflow.bodyScrollWidth <= observed.overflow.viewportWidth, true, 'body horizontal overflow');
    assert.equal(observed.overflow.elements.length, 0, 'element horizontal overflow');
    assert.equal(sendAttempts.length, 0, `transaction send attempt: ${sendAttempts.join(',')}`);
    const audit = await localWalletAudit(page);
    assert.equal(audit.filter(x => x.method.startsWith('eth_send')).length, 0);
    if (row.auth) { const authenticated = await page.evaluate(async () => (await (await fetch('/api/v2/auth/session')).json()).authenticated === true); assert.equal(authenticated, true); assert.ok(audit.some((entry) => entry.method === 'personal_sign'), 'sign-in personal_sign missing'); }
    if (row.assertText) assert.match(observed.fullText, row.assertText);
    const block = await rpc(manifest.rpcUrl, 'eth_getBlockByNumber', ['latest', false]);
    const filename = `qa001-${row.slug}-${row.viewport}.png`;
    await page.screenshot({ path: path.join(outDir, filename), fullPage: true });
    row.filename = filename; row.actualObservedState = redact(observed.text); row.statusLabels = observed.statusLabels; row.actualBlock = { number: String(BigInt(block.number)), hash: block.hash }; row.walletAuditMethods = audit.map((entry) => entry.method); row.transactionSendAttempts = sendAttempts; row.domOverflowMetrics = observed.overflow; row.status = 'captured';
    return row;
  } finally { await context.close(); }
}

let node; let next; let browser; let primaryError;
const rows = [
  { number: 1, slug: 'filled-chip-form-48-24-24utc', role: 'client', route: '/v2/jobs/new', viewport: 'desktop', prepare: (p) => fillForm(p) },
  { number: 2, slug: 'filled-chip-form-48-24-24utc', role: 'client', route: '/v2/jobs/new', viewport: 'mobile', prepare: (p) => fillForm(p) },
  { number: 3, slug: 'disconnected-next-connect', role: 'client', route: '/v2/jobs/1', viewport: 'desktop', disconnected: true, assertText: /Connect your wallet to see the next action\./ },
  { number: 4, slug: 'disconnected-next-connect', role: 'client', route: '/v2/jobs/1', viewport: 'mobile', disconnected: true, assertText: /Connect your wallet to see the next action\./ },
  { number: 5, slug: 'client-open-applications-empty-load', role: 'client', route: '/v2/jobs/1', viewport: 'desktop', auth: true, assertText: /No applications yet\./ },
  { number: 6, slug: 'operator-inprogress-delivery-visible', role: 'operator', route: '/v2/jobs/2', viewport: 'desktop', auth: true, assertText: /In progress|Submit delivery/ },
  { number: 7, slug: 'operator-revisionpending-delivery-visible', role: 'operator', route: '/v2/jobs/4', viewport: 'desktop', auth: true, assertText: /Revision pending|Submit revision/ },
  { number: 8, slug: 'client-submitted-delivery-hidden-connected-approve', role: 'client', route: '/v2/jobs/3', viewport: 'desktop', auth: true, assertText: /Submitted|Approve/ },
  { number: 9, slug: 'client-submitted-delivery-hidden-connected-approve', role: 'client', route: '/v2/jobs/3', viewport: 'mobile', auth: true, assertText: /Submitted|Approve/ },
  { number: 10, slug: 'operator-inprogress-delivery-visible', role: 'operator', route: '/v2/jobs/2', viewport: 'mobile', auth: true, assertText: /Submit delivery/ },
  { number: 11, slug: 'operator-revisionpending-delivery-visible', role: 'operator', route: '/v2/jobs/4', viewport: 'mobile', auth: true, assertText: /Submit revision/ },
  { number: 12, slug: 'client-open-applications-empty-load', role: 'client', route: '/v2/jobs/1', viewport: 'mobile', auth: true, assertText: /No applications yet\./ },
];
try {
  await fs.mkdir(scratch, { recursive: true }); await fs.mkdir(outDir, { recursive: true });
  const stateDir = scratch;
  assert.equal(fsSync.existsSync(path.join(stateDir, 'manifest.json')), false, 'Use a fresh state directory; never replay a seed');
  node = await startIsolatedNode();
  assert.notEqual(node.port, 8545); assert.match(node.rpcUrl, /^http:\/\/127\.0\.0\.1:\d+$/); assert.equal(BigInt(await rpc(node.rpcUrl, 'eth_chainId')), 31337n);
  const manifestPath = path.join(stateDir, 'manifest.json');
  const contractDir = path.join(repo, 'contract');
  await deployFixture(node.rpcUrl, manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.notEqual(manifest.rpcUrl, 'http://127.0.0.1:8545'); assert.equal(manifest.rpcUrl, node.rpcUrl); assert.equal(String(manifest.chainId), '31337');
  await run(process.execPath, [path.join(webRoot, 'scripts/v2-local-content-seed.mjs')], { cwd: contractDir, env: { ...process.env, HARDHAT_CONFIG: path.join(contractDir, 'hardhat.v2.config.js'), V2_LOCAL_UI_STATE: manifestPath, V2_LOCAL_RPC_URL: node.rpcUrl, V2_CHAIN_PROFILE: 'local-hardhat' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await run(process.execPath, ['scripts/v2-import-local-documents.mjs'], { cwd: webRoot, env: { ...process.env, V2_LOCAL_UI_STATE: stateDir, V2_CHAIN_PROFILE: 'local-hardhat', V2_LOCAL_RPC_URL: node.rpcUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  next = spawn(process.execPath, ['scripts/v2-local-browser-server.mjs'], { cwd: webRoot, env: { ...process.env, V2_CHAIN_PROFILE: 'local-hardhat', V2_LOCAL_UI_STATE: stateDir, PORT: '3104', NODE_ENV: 'development' }, detached: true, stdio: 'ignore', windowsHide: true });
  await waitHttp(origin + '/v2');
  browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 30000 });
  for (const row of rows) {
    const result = await capture(browser, manifest, row, async (page) => { if (row.prepare) await row.prepare(page); else if (row.slug === 'client-open-applications-empty-load') { await signIn(page); await page.getByRole('button', { name: 'Load applications', exact: true }).click(); await page.getByText('No applications yet.', { exact: true }).waitFor(); } else if (row.auth) await signIn(page); });
    console.log(`CAPTURED ${result.filename}`);
  }
} catch (error) { primaryError = error; console.error(`QA_FAILED ${redact(error.message)}`); }
finally {
  await browser?.close().catch(() => {});
  if (next?.pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(next.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-next.pid, 'SIGTERM'); } catch { next.kill('SIGTERM'); } } }
  if (node) stopIsolatedNode(node.node);
}

const ledger = { evidence: 'real UI + isolated local EVM + PGlite import', chainId: '31337', origin, rpcGuard: 'loopback-only; explicit manifest RPC; never 8545', browser: { channel: 'msedge', headless: true, version: browser?.version?.() || null, viewports }, rows: rows.map(({ prepare, ...row }) => row), failures: primaryError ? [{ error: redact(primaryError.message) }] : [], transactionSendAttempts: rows.flatMap((r) => r.transactionSendAttempts || []) };
await fs.writeFile(path.join(outDir, 'qa001-ledger.json'), JSON.stringify(ledger, null, 2) + '\n');
const indexPath = path.join(outDir, 'INDEX.md');
const prior = fsSync.existsSync(indexPath) ? await fs.readFile(indexPath, 'utf8') : '# V2 UI screenshots\n';
const section = `\n## QA001 — isolated loopback Edge regression (2026-11-04)\n\n- Chain: 31337 on an explicitly allocated loopback RPC port (never 8545).\n- Origin: ${origin}; browser: Microsoft Edge headless, existing installation.\n- Captures: ${rows.filter((r) => r.status === 'captured').length}/${rows.length}; transaction send attempts: ${ledger.transactionSendAttempts.length}.\n- Ledger: [qa001-ledger.json](./qa001-ledger.json)\n${rows.filter((r) => r.filename).map((r) => `- [${r.filename}](./${r.filename}) — ${r.slug}, ${r.viewport}, statuses=${(r.statusLabels || []).join('|')}`).join('\n')}\n`;
await fs.writeFile(indexPath, prior.split('## QA001')[0] + section);
if (primaryError || rows.some((r) => r.status !== 'captured')) process.exitCode = 1;
else console.log(JSON.stringify({ captured: rows.length, screenshots: rows.map((r) => r.filename), ledger: path.join(outDir, 'qa001-ledger.json'), rpc: node?.rpcUrl || null }));
