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

test('explicit local profile keeps the manifest loopback endpoint and rejects a non-loopback witness', () => {
  const base = {
    chainId: '31337',
    pair: { market: '0x0000000000000000000000000000000000000001', vault: '0x0000000000000000000000000000000000000002', token: '0x0000000000000000000000000000000000000003', treasury: '0x0000000000000000000000000000000000000004' },
    runtime: { market: { address: '0x0000000000000000000000000000000000000001', bytes: 23908, rawHash: `0x${'11'.repeat(32)}` }, vault: { address: '0x0000000000000000000000000000000000000002', bytes: 4854, rawHash: `0x${'22'.repeat(32)}` } },
    deployments: [{ name: 'OperatorCollateralVaultV2', blockNumber: 2 }, { name: 'AgentMarketplaceV2', blockNumber: 3 }],
    anchorBlock: { number: 4, hash: `0x${'33'.repeat(32)}` },
    roles: {},
  };
  const profile = resolveV2ChainProfile({ env: { V2_CHAIN_PROFILE: 'local-hardhat' }, localManifest: { ...base, rpcUrl: 'http://127.0.0.1:49152' } });
  assert.equal(profile.rpcUrl, 'http://127.0.0.1:49152');
  assert.equal(profile.canonicalChainId, 31337n);
  assert.throws(() => resolveV2ChainProfile({ env: { V2_CHAIN_PROFILE: 'local-hardhat' }, localManifest: { ...base, rpcUrl: 'http://10.0.0.8:8545' } }), /invalid local V2 manifest witness/);
  assert.throws(() => resolveV2ChainProfile({ env: { V2_CHAIN_PROFILE: 'local-hardhat' }, localManifest: { ...base, rpcUrl: 'http://localhost:8545' } }), /invalid local V2 manifest witness/);
});

test('local development launcher cannot downgrade production to development', () => {
  const result = spawnSync(process.execPath, ['scripts/v2-local-browser-server.mjs'], { cwd, env: cleanEnv({ NODE_ENV: 'production', V2_CHAIN_PROFILE: 'local-hardhat' }), encoding: 'utf8', timeout: 4000 });
  assert.equal(result.error, undefined, 'launcher must reject before a child Next process can stay running');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forbidden/);
});
