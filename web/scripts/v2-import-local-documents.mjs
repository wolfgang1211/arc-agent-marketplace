// Seed metadata import only. No canonical rows, health or chain writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { getV2LocalRuntime } from '../lib/v2/server/api-runtime.mjs';
import { documentHash } from '../lib/v2/ui-actions.mjs';
assert.equal(process.env.V2_CHAIN_PROFILE, 'local-hardhat');
const stateDir = process.env.V2_LOCAL_UI_STATE;
assert.ok(stateDir);
const serverRunning = await new Promise(resolve => { const socket = net.connect(3104, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
assert.equal(serverRunning, false, 'Stop the owned Next server before opening its PGlite database');
const seed = JSON.parse(fs.readFileSync(path.join(stateDir, 'seed-content.json'), 'utf8'));
const runtime = await getV2LocalRuntime();
try {
  assert.equal(runtime.profile.canonicalChainId, 31337n);
  assert.equal(runtime.profile.marketplace.toLowerCase(), seed.pair.market.toLowerCase());
  const snap = await runtime.readerFactory().read();
  const verified = [];
  for (const item of seed.jobs) {
    const j = await snap.readJob(BigInt(item.jobId));
    assert.equal(j.client.toLowerCase(), item.client.toLowerCase());
    assert.equal(j.canonicalTermsHash.toLowerCase(), item.termsHash.toLowerCase());
    assert.equal(j.descriptionHash.toLowerCase(), documentHash(item.document.description).toLowerCase());
    assert.equal(j.criteriaHash.toLowerCase(), documentHash(item.document.criteria).toLowerCase());
    const result = await fetch(seed.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [item.receiptHash] }) });
    const receipt = (await result.json()).result;
    assert.equal(receipt.status, '0x1');
    assert.equal(receipt.from.toLowerCase(), item.client.toLowerCase());
    assert.equal(receipt.to.toLowerCase(), runtime.profile.marketplace.toLowerCase());
    assert.equal(receipt.blockHash.toLowerCase(), item.postReceipt.blockHash.toLowerCase());
    verified.push({ ...item, actualStatus: Number(j.status), actualVersion: String(j.stateVersion) });
  }
  await runtime.db.transaction(async db => {
    for (const item of verified) {
      const id = `local-seed:${runtime.profile.marketplace.toLowerCase()}:${item.jobId}`;
      const hash = documentHash(item.document);
      const previous = await db.query('SELECT content_hash,content FROM v2_job_documents WHERE id=$1', [id]);
      if (previous.rows.length) {
        assert.equal(previous.rows[0].content_hash, hash);
        if (typeof previous.rows[0].content === 'string') {
          assert.deepEqual(JSON.parse(previous.rows[0].content), item.document);
          await db.query('UPDATE v2_job_documents SET content=$1 WHERE id=$2 AND content_hash=$3', [item.document, id, hash]);
        } else assert.deepEqual(previous.rows[0].content, item.document);
        continue;
      }
      await db.query('INSERT INTO v2_job_documents(id,chain_id,marketplace,job_id,version,content_hash,content,visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, '31337', runtime.profile.marketplace, item.jobId, 1, hash, item.document, 'public']);
    }
  });
  for (const item of verified) {
    const rows = await runtime.db.query('SELECT content,visibility FROM v2_job_documents WHERE id=$1', [`local-seed:${runtime.profile.marketplace.toLowerCase()}:${item.jobId}`]);
    assert.equal(rows.rows[0]?.visibility, 'public');
    assert.deepEqual(rows.rows[0]?.content, item.document);
  }
  await runtime.syncOnce();
  const health = runtime.getHealth();
  assert.equal(health.status, 'healthy');
  assert.equal(health.stale, false);
  fs.writeFileSync(path.join(stateDir, 'seed-import-evidence.json'), JSON.stringify({ chainId: '31337', health, jobs: verified.map(x => ({ jobId: x.jobId, title: x.document.title, category: x.document.category, status: x.actualStatus, stateVersion: x.actualVersion, receiptHash: x.receiptHash })) }, null, 2));
  console.log('SEED_METADATA_VERIFIED_AND_IMPORTED', JSON.stringify(verified.map(x => ({ jobId: x.jobId, status: x.actualStatus, category: x.document.category }))));
} finally { await runtime.db.close(); }
