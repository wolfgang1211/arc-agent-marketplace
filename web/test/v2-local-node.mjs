import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

export const CONTRACT_DIR = path.resolve(import.meta.dirname, '../../contract');

export function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function rpc(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || 'rpc');
  return body.result;
}

export async function startIsolatedNode() {
  const port = await freeLoopbackPort();
  if (port === 8545) throw new Error('refusing to reuse port 8545');
  const rpcUrl = `http://127.0.0.1:${port}`;
  const node = spawn(process.execPath, ['node_modules/hardhat/internal/cli/cli.js', 'node', '--config', 'hardhat.v2-ui-local.config.cjs', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: CONTRACT_DIR, detached: true, stdio: 'ignore' });
  let spawnError = null;
  node.once('error', error => { spawnError = error; });
  const started = Date.now();
  while (Date.now() - started < 30000) {
    if (spawnError) throw new Error('hardhat node spawn failed', { cause: spawnError });
    if (node.exitCode != null) throw new Error('hardhat node exited');
    try { if (await rpc(rpcUrl, 'eth_chainId') === '0x7a69') return { rpcUrl, node, port }; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopIsolatedNode(node);
  throw new Error('local chain did not start');
}

export function stopIsolatedNode(node) {
  if (!node?.pid || node.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(node.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try { process.kill(-node.pid, 'SIGTERM'); } catch { try { node.kill('SIGTERM'); } catch {} }
}

export function deployFixture(rpcUrl, manifestPath) {
  const deploy = spawn(process.execPath, ['node_modules/hardhat/internal/cli/cli.js', 'run', 'scripts/v2-local-deploy-fixture.cjs', '--no-compile', '--config', 'hardhat.v2.config.js', '--network', 'hardhat'], {
    cwd: CONTRACT_DIR,
    env: { ...process.env, V2_LOCAL_MANIFEST_OUT: manifestPath, V2_LOCAL_RPC_URL: rpcUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  deploy.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    deploy.on('exit', (code) => { if (code === 0) resolve(); else reject(new Error(stderr || 'local deployment failed')); });
  });
}

export { rpc as localRpc };
