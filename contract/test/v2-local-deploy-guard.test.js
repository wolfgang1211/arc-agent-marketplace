const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const script = path.join(__dirname, '../scripts/v2-local-deploy-fixture.cjs');

function run(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => resolve({ code, stderr }));
  });
}

describe('local deploy fixture guard', function () {
  it('rejects a non-loopback target before opening a provider', async function () {
    const result = await run({ V2_LOCAL_MANIFEST_OUT: path.join(__dirname, 'manifest-should-not-exist.json'), V2_LOCAL_RPC_URL: 'https://rpc.testnet.arc.io' });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /127\.0\.0\.1/);
  });

  it('stops after eth_chainId when the loopback node is not 31337', async function () {
    const methods = [];
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        methods.push(body.method);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_chainId' ? '0x1' : null }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const result = await run({ V2_LOCAL_MANIFEST_OUT: path.join(__dirname, 'manifest-should-not-exist.json'), V2_LOCAL_RPC_URL: `http://127.0.0.1:${port}` });
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /eth_chainId is 31337/);
      assert.equal(methods.includes('eth_accounts'), false);
      assert.equal(methods.includes('eth_sendTransaction'), false);
      assert.equal(methods.includes('eth_chainId'), true);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
