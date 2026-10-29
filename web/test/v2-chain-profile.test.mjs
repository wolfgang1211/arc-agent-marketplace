import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARC_TESTNET_PROFILE, resolveV2ChainProfile, toPublicV2Profile } from '../lib/v2/chain-profile.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const cleanEnv = (extra = {}) => {
  const env = { ...process.env };
  for (const key of ['V2_CHAIN_PROFILE', 'NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL']) delete env[key];
  return { ...env, ...extra };
};
const nextConfig = (extra) => spawnSync(process.execPath, ['-e', 'require("./next.config.js")'], { cwd, env: cleanEnv(extra), encoding: 'utf8', timeout: 15000 });

test('default and explicit arc-testnet preserve the accepted Arc profile', () => {
  assert.equal(resolveV2ChainProfile({ env: {} }), ARC_TESTNET_PROFILE);
  assert.equal(resolveV2ChainProfile({ env: { V2_CHAIN_PROFILE: 'arc-testnet' } }), ARC_TESTNET_PROFILE);
  assert.equal(ARC_TESTNET_PROFILE.rpcUrl, 'https://rpc.testnet.arc.io');
  assert.equal(ARC_TESTNET_PROFILE.canonicalChainId, 5042002n);
  assert.equal(ARC_TESTNET_PROFILE.initialAnchor.blockNumber, 68072733);
  const publicProfile = toPublicV2Profile(ARC_TESTNET_PROFILE);
  assert.equal(publicProfile.id, 'arc-testnet');
  assert.equal(publicProfile.chainId, '5042002');
  assert.equal(Object.hasOwn(publicProfile, 'localTestConfig'), false);
  assert.doesNotThrow(() => JSON.stringify(publicProfile));
});

for (const extra of [
  { NODE_ENV: 'production' },
  { VERCEL: '1' },
  { VERCEL_ENV: 'preview' },
  { VERCEL_ENV: 'production' },
  { VERCEL_ENV: 'development' },
  { VERCEL_URL: 'example.vercel.app' },
]) {
  test('local profile rejects deployment environment ' + JSON.stringify(extra), () => {
    assert.throws(() => resolveV2ChainProfile({ env: { V2_CHAIN_PROFILE: 'local-hardhat', ...extra } }), /forbidden/);
    const result = nextConfig({ V2_CHAIN_PROFILE: 'local-hardhat', ...extra });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /forbidden/);
  });
}

test('Next accepts explicit Arc and rejects unknown profile without exposing its value', () => {
  assert.equal(nextConfig({ V2_CHAIN_PROFILE: 'arc-testnet', NODE_ENV: 'production' }).status, 0);
  const invalid = nextConfig({ V2_CHAIN_PROFILE: 'INVALID_PROFILE_SENTINEL' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /unknown V2_CHAIN_PROFILE/);
  assert.doesNotMatch(invalid.stderr.split('\n').filter((line) => line.startsWith('Error:')).join('\n'), /INVALID_PROFILE_SENTINEL/);
});

test('local development launcher cannot downgrade production to development', () => {
  const result = spawnSync(process.execPath, ['scripts/v2-local-browser-server.mjs'], { cwd, env: cleanEnv({ NODE_ENV: 'production', V2_CHAIN_PROFILE: 'local-hardhat' }), encoding: 'utf8', timeout: 4000 });
  assert.equal(result.error, undefined, 'launcher must reject before a child Next process can stay running');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forbidden/);
});
