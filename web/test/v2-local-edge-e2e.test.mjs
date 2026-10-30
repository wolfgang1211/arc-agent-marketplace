import { accessSync, constants } from 'node:fs';
import test from 'node:test';

const candidates = ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'];
function edgePath() {
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); return candidate; } catch {}
  }
  return null;
}

const edge = edgePath();
test('installed Edge headless Playwright acceptance', { skip: edge ? false : 'Edge is not installed in this environment. The browser end-to-end flow was not run and no browser was downloaded.' }, async () => {
  if (!edge) return;
  throw new Error('Edge is present, but the Playwright acceptance harness has not been executed in this process.');
});
