import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { scratchDir } from './scratch-dir.mjs';
import { deployFixture, startIsolatedNode, stopIsolatedNode } from './v2-local-node.mjs';
import { resolveV2ChainProfile } from '../lib/v2/chain-profile.mjs';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createReadOnlyV2Transport, defaultV2ReaderFactory } from '../lib/v2/server/api-runtime.mjs';
import { createV2Indexer } from '../lib/v2/server/indexer.mjs';
import { createV2IndexerStore } from '../lib/v2/server/indexer-store.mjs';
import manifestAbi from '../lib/v2/action-manifest.json' with { type: 'json' };

const CLIENT_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const DAY = 86400n;
const U = 1_000_000n;
const ERC20 = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }];

test('real indexer sync projects a chain job and supplies freshness without hand-written canonical rows', { timeout: 180000 }, async () => {
  const dir = await mkdtemp(path.join(scratchDir(), 'v2-indexer-sync-'));
  const manifestPath = path.join(dir, 'manifest.json');
  const started = await startIsolatedNode();
  let db;
  try {
    await deployFixture(started.rpcUrl, manifestPath);
    const localManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const profile = resolveV2ChainProfile({ env: { V2_CHAIN_PROFILE: 'local-hardhat' }, localManifest });
    db = await createPgliteDb({ dataDir: path.join(dir, 'pg') });
    await migrate(db);
    const transport = createReadOnlyV2Transport({ profile });
    const store = createV2IndexerStore({ db, profile });
    const readerFactory = (options = {}) => defaultV2ReaderFactory({ ...options, profile });
    const indexer = createV2Indexer({ db, profile, transport, store, readerFactory, confirmations: 0, maxBatches: 8, batchSize: 1000 });
    const first = await indexer.syncOnce();
    assert.equal(first.status, 'healthy', JSON.stringify({ result: first, health: indexer.health() }, (_, value) => typeof value === 'bigint' ? value.toString() : value));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM v2_jobs')).rows[0].n, 0);
    const client = privateKeyToAccount(CLIENT_KEY);
    const walletClient = createWalletClient({ account: client, chain: hardhat, transport: http(started.rpcUrl) });
    const publicClient = createPublicClient({ chain: hardhat, transport: http(started.rpcUrl) });
    const head = await publicClient.getBlock();
    const post = manifestAbi.contracts.marketplace.abi.find((item) => item.name === 'postJob');
    await walletClient.writeContract({ address: profile.usdc, abi: ERC20, functionName: 'approve', args: [profile.marketplace, 10n * U] });
    const hash = await walletClient.writeContract({ address: profile.marketplace, abi: [post], functionName: 'postJob', args: [10n * U, head.timestamp + 2n * DAY, DAY, DAY, 12n * 3600n, 2, false, `0x${'11'.repeat(32)}`, `0x${'22'.repeat(32)}`, false] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const second = await indexer.syncOnce();
    assert.equal(second.status, 'healthy', JSON.stringify(second, (_, value) => typeof value === 'bigint' ? value.toString() : value));
    const jobs = await db.query('SELECT job_id, status, source_block, source_hash FROM v2_jobs ORDER BY job_id');
    assert.equal(jobs.rows.length, 1);
    assert.equal(String(jobs.rows[0].job_id), '1');
    assert.equal(String(jobs.rows[0].source_block), receipt.blockNumber.toString());
    assert.equal(String(jobs.rows[0].source_hash).toLowerCase(), receipt.blockHash.toLowerCase());
    const health = indexer.health();
    assert.equal(health.status, 'healthy');
    assert.equal(health.stale, false);
    assert.equal(health.gap, null);
    assert.equal(health.cursor != null, true);
  } finally {
    if (db) await db.close();
    stopIsolatedNode(started.node);
    await rm(dir, { recursive: true, force: true });
  }
});
