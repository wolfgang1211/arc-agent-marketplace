import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

test('status must not present path existence as accepted live execution', () => {
 const result = spawnSync('python', [fileURLToPath(new URL('../scripts/v2-local-arc-secure-executor.py', import.meta.url)), '--status'], { encoding:'utf8', timeout:10000 });
 assert.equal(result.status, 0);
 const status = JSON.parse(result.stdout);
 assert.equal(status.executionAccepted, false);
 assert.equal(status.status, 'blocked');
 assert.equal(status.blocker, 'LIVE_EXECUTION_NOT_ACCEPTED');
});

test('worker remains blocked before DPAPI and has no web ethers Wallet import', async () => {
 const worker = await readFile(new URL('../scripts/v2-local-arc-secure-executor-worker.mjs', import.meta.url), 'utf8');
 assert.doesNotMatch(worker, /from ['"]ethers['"]/);
 assert.match(worker, /LIVE_EXECUTION_NOT_ACCEPTED/);
 const result = spawnSync('node', [fileURLToPath(new URL('../scripts/v2-local-arc-secure-executor-worker.mjs', import.meta.url))], { input: '{}', encoding: 'utf8', timeout:10000 });
 assert.equal(result.status, 1);
 assert.equal(result.stdout, '{"ok":false,"error":"SECURE_EXECUTION_FAILED"}');
});
