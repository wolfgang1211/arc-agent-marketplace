import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/wolfgang/AppData/Local/hermes/hermes-agent/node_modules/playwright');

const baseUrl = 'http://127.0.0.1:3102/v2/jobs/new';
const outputDir = 'C:/Users/wolfgang/arc-agent-marketplace/arc-agent-marketplace/contract/docs/v2-ui-screenshots/edge-current';
const metricsPath = `${outputDir}/local-arc-checkbox-metrics.json`;
const captures = [
  { name: 'desktop', width: 1440, height: 1000, file: `${outputDir}/local-arc-checkbox-desktop.png` },
  { name: 'mobile', width: 390, height: 844, file: `${outputDir}/local-arc-checkbox-mobile.png` },
];

fs.mkdirSync(outputDir, { recursive: true });
const metrics = [];
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 30000 });
  for (const capture of captures) {
    const context = await browser.newContext({ viewport: { width: capture.width, height: capture.height }, deviceScaleFactor: 1 });
    await context.route('**/*', (route) => {
      if (route.request().method() !== 'GET') return route.abort('blockedbyclient');
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const form = page.locator('[data-testid="job-creation-form"]');
    await form.waitFor({ state: 'visible', timeout: 30000 });
    const checkbox = form.locator('input[type="checkbox"]');
    const checkboxCount = await checkbox.count();
    assert.equal(checkboxCount, 1, `${capture.name}: expected one public checkbox`);
    await checkbox.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForFunction(() => {
      const input = document.querySelector('[data-testid="job-creation-form"] input[type="checkbox"]');
      return input instanceof HTMLInputElement && input.checked;
    }, undefined, { timeout: 10000 });
    await checkbox.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);

    const data = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="job-creation-form"] input[type="checkbox"]');
      const label = input?.closest('label');
      const text = label?.querySelector('span');
      const inputRect = input?.getBoundingClientRect();
      const textRect = text?.getBoundingClientRect();
      const formRect = document.querySelector('[data-testid="job-creation-form"]')?.getBoundingClientRect();
      return {
        checkboxCount: document.querySelectorAll('[data-testid="job-creation-form"] input[type="checkbox"]').length,
        showPublicChecked: input?.checked === true,
        inputNormal18x18: inputRect?.width === 18 && inputRect?.height === 18,
        checkboxBoundingBox: inputRect ? { x: inputRect.x, y: inputRect.y, width: inputRect.width, height: inputRect.height } : null,
        labelText: text?.textContent?.trim() || '',
        labelGapPx: inputRect && textRect ? Math.round((textRect.left - inputRect.right) * 100) / 100 : null,
        formVisible: Boolean(formRect && formRect.width > 0 && formRect.height > 0),
        checkboxInViewport: Boolean(inputRect && inputRect.top >= 0 && inputRect.bottom <= window.innerHeight),
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        overflow: document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth,
      };
    });
    assert.equal(data.formVisible, true, `${capture.name}: real form not visible`);
    assert.equal(data.checkboxCount, 1, `${capture.name}: checkbox disappeared`);
    assert.equal(data.showPublicChecked, true, `${capture.name}: public checkbox is not checked`);
    assert.equal(data.inputNormal18x18, true, `${capture.name}: checkbox is not 18x18`);
    assert.equal(data.checkboxInViewport, true, `${capture.name}: checkbox is not in viewport after scroll`);
    await page.screenshot({ path: capture.file, fullPage: false, animations: 'disabled' });
    metrics.push({ ...capture, ...data, url: page.url(), browserChannel: 'msedge', headless: true });
    await context.close();
  }
  const result = { captured: metrics.length, metrics };
  fs.writeFileSync(metricsPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
}
