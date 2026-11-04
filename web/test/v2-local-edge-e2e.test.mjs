import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Optional installed-browser launch smoke, not marketplace lifecycle evidence.
// Real lifecycle acceptance uses scripts/v2-browser-acceptance.mjs + local EVM.
const candidates = process.platform === 'win32' ? [
  path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.ProgramFiles || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
] : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'];
const edge = candidates.find(existsSync);
const modulePath = process.env.V2_PLAYWRIGHT_MODULE || path.join(os.homedir(), 'AppData/Local/hermes/hermes-agent/node_modules/playwright');
let chromium;
try { chromium = createRequire(import.meta.url)(modulePath).chromium; } catch {}
const skip = !edge ? 'No Edge executable found in inspected standard paths; optional launch smoke not run. No download.' : !chromium ? 'Existing Playwright module unavailable; optional launch smoke not run. No install or download.' : false;

test('installed Edge headless launch smoke; marketplace lifecycle acceptance is separate', { skip, timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: edge, headless: true, timeout: 20000 });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<main><h1>Installed Edge launch verified</h1></main>');
    assert.equal(await page.getByRole('heading').innerText(), 'Installed Edge launch verified');
    assert.match(browser.version(), /^\d+\./);
  } finally { await browser.close(); }
});
