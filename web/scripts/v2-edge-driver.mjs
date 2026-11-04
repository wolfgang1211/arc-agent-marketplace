// Acceptance instrumentation forwards real traffic unchanged; it does not
// synthesize chain state, API success, canonical cursors or transaction receipts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { installLocalTestWallet } from './v2-local-browser-wallet.mjs';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export async function until(predicate, label, timeout = 90000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error('ACCEPTANCE_TIMEOUT:' + label); await sleep(50); }
}
export class EdgeAcceptance {
  constructor({ stateDir = process.env.V2_LOCAL_UI_STATE, origin = 'http://127.0.0.1:3104' } = {}) {
    assert.ok(stateDir, 'Explicit V2_LOCAL_UI_STATE is required');
    assert.equal(origin, 'http://127.0.0.1:3104');
    this.stateDir = stateDir;
    this.origin = origin;
    this.manifest = JSON.parse(fs.readFileSync(path.join(stateDir, 'manifest.json'), 'utf8'));
    assert.equal(String(this.manifest.chainId), '31337');
    assert.equal(this.manifest.rpcUrl, 'http://127.0.0.1:8545');
    this.pages = new Map();
    this.broadcasts = [];
    this.steps = [];
    this.pending = [];
    this.errors = [];
    const priorPath = path.join(stateDir, 'edge-acceptance.json');
    if (fs.existsSync(priorPath)) {
      const prior = JSON.parse(fs.readFileSync(priorPath, 'utf8'));
      assert.equal(prior.anchorBlock?.hash, this.manifest.anchorBlock.hash, 'Evidence belongs to another chain instance');
      this.broadcasts = prior.broadcasts || [];
      this.steps = prior.steps || [];
      this.errors = prior.errors || [];
    }
  }
  save() {
    fs.writeFileSync(path.join(this.stateDir, 'edge-acceptance.json'), JSON.stringify({ evidence: 'real UI + injected EIP-1193 + local EVM + server reader/indexer', chainId: '31337', origin: this.origin, pair: this.manifest.pair, anchorBlock: this.manifest.anchorBlock, broadcasts: this.broadcasts, steps: this.steps, errors: this.errors }, null, 2) + '\n');
  }
  async rpc(method, params = []) {
    const response = await fetch(this.manifest.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const body = await response.json();
    if (body.error) throw new Error('LOCAL_RPC_' + method + '_FAILED');
    return body.result;
  }
  async start() {
    assert.equal(BigInt(await this.rpc('eth_chainId')), 31337n);
    const playwrightModule = process.env.V2_PLAYWRIGHT_MODULE || path.join(os.homedir(), 'AppData/Local/hermes/hermes-agent/node_modules/playwright');
    const require = createRequire(import.meta.url);
    const { chromium } = require(playwrightModule);
    this.browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 20000 });
    this.version = this.browser.version();
    return this;
  }
  async role(role) {
    if (this.pages.has(role)) return this.pages.get(role).page;
    assert.ok(Object.hasOwn(this.manifest.roles, role));
    const context = await this.browser.newContext({ viewport: { width: 1440, height: 900 } });
    await installLocalTestWallet(context, { rpcUrl: this.manifest.rpcUrl, marketplace: this.manifest.pair.market, vault: this.manifest.pair.vault, usdc: this.manifest.pair.token, roles: this.manifest.roles, role });
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await context.route(this.manifest.rpcUrl, async route => {
      try {
        const request = route.request().postDataJSON();
        const upstream = await route.fetch();
        const response = await upstream.json();
        const gate = this.gate;
        if (request.method === 'eth_sendTransaction' && typeof response.result === 'string') {
          const tx = request.params[0];
          const record = { role, hash: response.result, from: tx.from, to: tx.to, selector: tx.data.slice(0, 10), chainId: '31337' };
          this.broadcasts.push(record);
          if (gate && tx.to.toLowerCase() !== this.manifest.pair.token.toLowerCase()) gate.hashes.add(record.hash.toLowerCase());
          this.save();
        }
        if (gate && request.method === 'eth_getTransactionReceipt' && gate.hashes.has(String(request.params[0]).toLowerCase()) && response.result) {
          gate.receipt = response.result;
          gate.receiptSeen = true;
          await gate.releaseReceipt.promise;
        }
        await route.fulfill({ response: upstream });
      } catch (error) { this.errors.push({ boundary: 'browser-rpc-instrumentation', name: error.name }); this.save(); await route.abort().catch(() => {}); }
    });
    await context.route('**/api/v2/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const interesting = url.pathname.startsWith('/api/v2/transactions/') || (request.method() === 'POST' && (url.pathname.endsWith('/preflight') || url.pathname === '/api/v2/jobs'));
      if (!interesting) return route.continue();
      try {
        const upstream = await route.fetch({ timeout: 90000 });
        const body = await upstream.json();
        const gate = this.gate;
        if (gate && request.method() === 'POST' && body.action === gate.action) {
          gate.intentId = body.intentId;
          gate.expected = body.expected;
          gate.preflightStatus = upstream.status();
        }
        if (gate && url.pathname.startsWith('/api/v2/transactions/') && body.intentId === gate.intentId && body.confirmed === true) {
          gate.readback = body;
          gate.readbackSeen = true;
          await gate.releaseReadback.promise;
        }
        if (gate && upstream.status() >= 400) gate.apiFailure = { status: upstream.status(), code: body.error };
        await route.fulfill({ response: upstream });
      } catch (error) { this.errors.push({ boundary: 'browser-api-instrumentation', name: error.name }); this.save(); await route.abort().catch(() => {}); }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    this.pages.set(role, { context, page });
    return page;
  }
  async login(role) {
    const page = await this.role(role);
    await page.goto(this.origin + '/v2/account', { waitUntil: 'domcontentloaded', timeout: 90000 });
    // The live badge is rendered from a client health request, not SSR text.
    await page.getByText('Live', { exact: true }).first().waitFor({ timeout: 90000 });
    const signedOut = page.getByTestId('wallet-signout');
    if (await signedOut.count() && await signedOut.isVisible()) return page;
    await page.getByTestId('wallet-connect').click();
    await page.getByTestId('wallet-signin').click();
    await signedOut.waitFor();
    return page;
  }
  async tx(page, action, { flow, fill, click } = {}) {
    assert.equal(this.gate, undefined, 'Only one instrumented action may execute at a time');
    const previous = this.steps.find(step => step.flow === flow && step.action === action && (step.passed || step.hashes?.length));
    assert.equal(previous, undefined, 'This flow action already succeeded or broadcast. Read-only reconciliation is required; do not resubmit.');
    const gate = { action, hashes: new Set(), releaseReceipt: deferred(), releaseReadback: deferred(), receiptSeen: false, readbackSeen: false };
    this.gate = gate;
    const before = this.broadcasts.length;
    try {
      if (fill) await fill();
      if (click) await click(); else await page.locator(`[data-action="${action}"]`).click();
      await until(() => gate.receiptSeen || gate.apiFailure, action + ':receipt');
      assert.equal(gate.apiFailure, undefined, JSON.stringify(gate.apiFailure));
      assert.equal(await page.getByTestId('v2-tx-success').count(), 0, 'Success shown before actual receipt delivery');
      gate.releaseReceipt.resolve();
      await until(() => gate.readbackSeen || gate.apiFailure, action + ':readback');
      assert.equal(gate.apiFailure, undefined, JSON.stringify(gate.apiFailure));
      assert.equal(await page.getByTestId('v2-tx-success').count(), 0, 'Success shown before actual canonical readback delivery');
      gate.releaseReadback.resolve();
      await page.getByTestId('v2-tx-success').first().waitFor({ state: 'visible', timeout: 90000 });
      assert.equal(gate.receipt.status, '0x1');
      assert.equal(gate.readback.confirmed, true);
      assert.equal(gate.readback.chainId, '31337');
      const result = { flow, action, passed: true, intentId: gate.intentId, hash: gate.receipt.transactionHash, blockNumber: String(BigInt(gate.receipt.blockNumber)), blockHash: gate.receipt.blockHash, receiptStatus: 'success', state: gate.readback.state, successAbsentBeforeReceipt: true, successAbsentBeforeReadback: true, broadcastCount: this.broadcasts.length - before };
      this.steps.push(result); this.save();
      return result;
    } catch (error) {
      const uiAlerts = await page.locator('[role="alert"], .v2-error').allTextContents();
      this.steps.push({ flow, action, passed: false, intentId: gate.intentId || null, hashes: [...gate.hashes], apiFailure: gate.apiFailure || null, uiAlerts: uiAlerts.map(text => text.replace(/0x[0-9a-fA-F]{64,}/g, '[REDACTED]').slice(0, 300)), reason: error.message.slice(0, 600), broadcastCount: this.broadcasts.length - before }); this.save();
      throw error;
    } finally { gate.releaseReceipt.resolve(); gate.releaseReadback.resolve(); this.gate = undefined; }
  }
  async recovery(page, { scenario, click, flowPrefix = 'recovery' }) {
    assert.ok(['reload', 'disconnect', 'timeout'].includes(scenario));
    assert.equal(this.gate, undefined);
    const flow = flowPrefix + '-' + scenario;
    const prior = this.steps.find(step => step.flow === flow && (step.passed || step.hashes?.length));
    assert.equal(prior, undefined, 'Review existing recovery evidence; never repeat its transaction');
    const gate = { action: 'withdrawStake', hashes: new Set(), releaseReceipt: deferred(), releaseReadback: deferred(), receiptSeen: false, readbackSeen: false };
    this.gate = gate;
    const before = this.broadcasts.length;
    const wallet = this.manifest.roles.operator;
    const nonceBefore = BigInt(await this.rpc('eth_getTransactionCount', [wallet, 'pending']));
    let timeoutObserved = false, disconnectObserved = false;
    try {
      await click();
      await until(() => gate.receiptSeen || gate.apiFailure, flow + ':actual-receipt');
      assert.equal(gate.apiFailure, undefined);
      assert.equal(await page.getByTestId('v2-tx-success').count(), 0);
      const pendingBefore = await page.evaluate(() => {
        const rows = [];
        for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (!key.startsWith('v2-wallet-intent:')) continue; try { const value = JSON.parse(localStorage.getItem(key)); rows.push({ intentId: value.intentId, hash: value.hash, status: value.status, action: value.action }); } catch {} }
        return rows;
      });
      assert.ok(pendingBefore.some(row => row.intentId === gate.intentId && gate.hashes.has(String(row.hash).toLowerCase())), 'Pending hash and server intent must exist before reload');
      if (scenario === 'timeout') {
        await page.locator('[data-state="timeout"]').waitFor({ state: 'visible', timeout: 160000 });
        timeoutObserved = true;
        assert.equal(this.broadcasts.length - before, 1, 'Receipt timeout must not resend');
      }
      if (scenario === 'disconnect') {
        await page.context().setOffline(true);
        gate.releaseReceipt.resolve();
        await page.locator('[role="alert"]').first().waitFor({ state: 'visible', timeout: 160000 });
        disconnectObserved = true;
        assert.equal(await page.getByTestId('v2-tx-success').count(), 0);
        assert.equal(this.broadcasts.length - before, 1, 'Network loss must not resend');
        await page.context().setOffline(false);
      }
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.getByText('Live', { exact: true }).first().waitFor({ timeout: 90000 });
      assert.equal(await page.getByTestId('v2-tx-success').count(), 0, 'Reload is not success evidence');
      gate.releaseReceipt.resolve();
      await until(() => gate.readbackSeen || gate.apiFailure, flow + ':resume-canonical-readback', 150000);
      assert.equal(gate.apiFailure, undefined);
      assert.equal(await page.getByTestId('v2-tx-success').count(), 0, 'Success cannot precede canonical readback');
      gate.releaseReadback.resolve();
      await page.getByTestId('v2-tx-success').first().waitFor({ state: 'visible', timeout: 90000 });
      const nonceAfter = BigInt(await this.rpc('eth_getTransactionCount', [wallet, 'pending']));
      assert.equal(nonceAfter - nonceBefore, 1n);
      assert.equal(this.broadcasts.length - before, 1);
      assert.equal(gate.receipt.status, '0x1');
      assert.equal(gate.readback.confirmed, true);
      const result = { flow, action: 'withdrawStake', scenario, passed: true, intentId: gate.intentId, hash: gate.receipt.transactionHash, blockHash: gate.receipt.blockHash, blockNumber: String(BigInt(gate.receipt.blockNumber)), state: gate.readback.state, nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), broadcastCount: 1, resumeSentTransactions: 0, timeoutObserved, disconnectObserved, successAbsentBeforeReceipt: true, successAbsentBeforeReadback: true, uiConfirmationVisible: await page.getByTestId('v2-tx-success').first().isVisible().catch(() => false) };
      this.steps.push(result); this.save(); return result;
    } catch (error) {
      this.steps.push({ flow, action: 'withdrawStake', passed: false, intentId: gate.intentId || null, hashes: [...gate.hashes], apiFailure: gate.apiFailure || null, reason: error.message.slice(0, 500), broadcastCount: this.broadcasts.length - before }); this.save(); throw error;
    } finally { await page.context().setOffline(false).catch(() => {}); gate.releaseReceipt.resolve(); gate.releaseReadback.resolve(); this.gate = undefined; }
  }
  async close() { await this.browser?.close(); this.save(); }
}
