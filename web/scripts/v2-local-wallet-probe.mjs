import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { verifyMessage, verifyTypedData } from 'viem';
import { installLocalTestWallet, localWalletAudit } from './v2-local-browser-wallet.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/wolfgang/AppData/Local/hermes/hermes-agent/node_modules/playwright');
const stateDir = 'C:/Users/wolfgang/AppData/Local/hermes/cache/scratch/v2-local-ui-state';
const manifest = JSON.parse(fs.readFileSync(stateDir + '/manifest.json', 'utf8'));
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  response.end('<!doctype html><title>Local wallet fixture probe</title><p>Local EIP-1193 fixture probe, not marketplace UI E2E.</p>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
const checks = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 20000 });
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    return route.continue();
  });
  await installLocalTestWallet(context, { rpcUrl: manifest.rpcUrl, marketplace: manifest.pair.market, vault: manifest.pair.vault, usdc: manifest.pair.token, roles: manifest.roles, role: 'operator' });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port);
  const initial = await page.evaluate(async () => ({ chain: await window.ethereum.request({ method: 'eth_chainId' }), accounts: await window.ethereum.request({ method: 'eth_requestAccounts' }) }));
  assert.equal(BigInt(initial.chain), 31337n);
  assert.deepEqual(initial.accounts, [manifest.roles.operator]);
  checks.push('actual loopback RPC chain and selected unlocked test account');
  const nonceBefore = await page.evaluate((address) => window.ethereum.request({ method: 'eth_getTransactionCount', params: [address, 'latest'] }), manifest.roles.operator);
  const message = 'V2 local EIP-1193 fixture probe, not UI E2E';
  const signature = await page.evaluate(async ({ address, message }) => {
    const bytes = new TextEncoder().encode(message);
    const hex = '0x' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return window.ethereum.request({ method: 'personal_sign', params: [hex, address] });
  }, { address: manifest.roles.operator, message });
  assert.equal(await verifyMessage({ address: manifest.roles.operator, message, signature }), true);
  checks.push('real Hardhat personal_sign verified against original UTF-8 message');
  const types = { Application: [
    { name: 'jobId', type: 'uint256' }, { name: 'operator', type: 'address' }, { name: 'termsHash', type: 'bytes32' },
    { name: 'validAfter', type: 'uint64' }, { name: 'validBefore', type: 'uint64' }, { name: 'nonceEpoch', type: 'uint256' }, { name: 'operatorNonce', type: 'uint256' },
  ] };
  const typed = {
    domain: { name: 'AlphaBoard Agent Marketplace V2', version: '1', chainId: 31337, verifyingContract: manifest.pair.market },
    primaryType: 'Application', types,
    message: { jobId: '1', operator: manifest.roles.operator, termsHash: manifest.jobs[0].final.canonicalTermsHash, validAfter: '0', validBefore: '9999999999', nonceEpoch: '0', operatorNonce: '0' },
  };
  const typedSignature = await page.evaluate(({ address, typed }) => window.ethereum.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typed)] }), { address: manifest.roles.operator, typed });
  assert.equal(await verifyTypedData({ ...typed, address: manifest.roles.operator, signature: typedSignature }), true);
  checks.push('real local Application EIP-712 signature independently recovered');
  const wrongDomain = { ...typed, domain: { ...typed.domain, chainId: 5042002 } };
  const wrongDomainError = await page.evaluate(async ({ address, typed }) => {
    try { await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typed)] }); return null; }
    catch (error) { return { code: error.code, message: error.message }; }
  }, { address: manifest.roles.operator, typed: wrongDomain });
  assert.equal(wrongDomainError?.message, 'TYPED_DATA_DOMAIN_MISMATCH');
  checks.push('Arc typed-data domain rejected before signing');
  const rawSendError = await page.evaluate(async () => {
    try { await window.ethereum.request({ method: 'eth_sendRawTransaction', params: ['0x'] }); return null; }
    catch (error) { return error.code; }
  });
  assert.equal(rawSendError, 4200);
  checks.push('raw-transaction and unknown methods denied');
  const targetError = await page.evaluate(async ({ from, to }) => {
    try { await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to, data: '0x12345678', value: '0x0' }] }); return null; }
    catch (error) { return error.message; }
  }, { from: manifest.roles.operator, to: manifest.roles.observer });
  assert.equal(targetError, 'LOCAL_TARGET_NOT_ALLOWED');
  checks.push('non-profile transaction target rejected before broadcast');
  await page.evaluate(() => window.__v2LocalTestWallet.reportWrongNetwork(true));
  assert.equal(await page.evaluate(() => window.ethereum.request({ method: 'eth_chainId' })), '0x1');
  assert.deepEqual(await page.evaluate(() => window.ethereum.request({ method: 'eth_accounts' })), [manifest.roles.operator]);
  const wrongNetworkSendError = await page.evaluate(async ({ from, to }) => {
    try { await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to, data: '0x12345678', value: '0x0' }] }); return null; }
    catch (error) { return error.message; }
  }, { from: manifest.roles.operator, to: manifest.pair.market });
  assert.equal(wrongNetworkSendError, 'REPORTED_CHAIN_MISMATCH');
  await page.evaluate(() => window.__v2LocalTestWallet.reportWrongNetwork(false));
  checks.push('wrong-network fixture permits account reads but forbids sends');
  const nonceAfter = await page.evaluate((address) => window.ethereum.request({ method: 'eth_getTransactionCount', params: [address, 'latest'] }), manifest.roles.operator);
  assert.equal(nonceAfter, nonceBefore);
  const audit = await localWalletAudit(page);
  assert.equal(audit.filter((entry) => entry.method === 'eth_sendTransaction' && entry.hash).length, 0);
  checks.push('account nonce unchanged, zero transaction broadcasts');
  const evidence = { kind: 'browser-wallet-fixture-only-not-marketplace-e2e', channel: 'msedge', headless: true, browserVersion: browser.version(), passed: checks.length, failed: 0, checks, transactions: 0, downloaded: false };
  fs.writeFileSync(stateDir + '/wallet-probe.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
