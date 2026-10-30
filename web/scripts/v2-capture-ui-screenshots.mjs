import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startIsolatedNode, stopIsolatedNode } from '../test/v2-local-node.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '..');
const outDir = path.join(repoRoot, 'contract/docs/v2-ui-screenshots');
const chrome = '/usr/local/bin/google-chrome';

function run(command, args, options) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => child.on('exit', (code) => code === 0 ? resolve(stderr) : reject(new Error(stderr || `${command} exited ${code}`))));
}

async function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  let seq = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => socket.close() };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const stateDir = await mkdtemp(path.join(tmpdir(), 'v2-ui-state-'));
  const started = await startIsolatedNode();
  let chromeProc;
  let nextProc;
  try {
    await run(process.execPath, ['scripts/v2-local-visual-setup.cjs'], { cwd: path.join(repoRoot, 'contract'), env: { ...process.env, V2_LOCAL_RPC_URL: started.rpcUrl, V2_LOCAL_UI_STATE: stateDir } });
    const port = 3104;
    nextProc = spawn(process.execPath, ['scripts/v2-local-browser-server.mjs'], { cwd: webRoot, env: { ...process.env, V2_CHAIN_PROFILE: 'local-hardhat', V2_LOCAL_UI_STATE: stateDir, PORT: String(port), NODE_ENV: 'development' }, stdio: 'ignore', detached: true });
    const origin = `http://127.0.0.1:${port}`;
    const ready = Date.now();
    while (Date.now() - ready < 90000) {
      try { const response = await fetch(`${origin}/v2`); if (response.ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    chromeProc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9223', `--user-data-dir=${path.join(stateDir, 'chrome')}`], { stdio: 'ignore' });
    let version;
    const debugReady = Date.now();
    while (Date.now() - debugReady < 20000) {
      try { version = await (await fetch('http://127.0.0.1:9223/json/version')).json(); break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!version?.webSocketDebuggerUrl) throw new Error('Chrome DevTools endpoint did not start');
    const browser = await cdp(version.webSocketDebuggerUrl);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const target = await (await fetch('http://127.0.0.1:9223/json/list')).json();
    const page = target.find((item) => item.id === targetId);
    const session = await cdp(page.webSocketDebuggerUrl);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    const shots = [];
    async function shoot(name, route, viewport, prepare) {
      await session.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 700 });
      await session.send('Page.navigate', { url: `${origin}${route}` });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (prepare) await session.send('Runtime.evaluate', { expression: prepare, awaitPromise: true });
      await new Promise((resolve) => setTimeout(resolve, 800));
      const image = await session.send('Page.captureScreenshot', { format: 'png' });
      const file = `${name}-${viewport.width}x${viewport.height}.png`;
      await writeFile(path.join(outDir, file), Buffer.from(image.data, 'base64'));
      shots.push({ file, route, viewport: `${viewport.width}x${viewport.height}` });
    }
    const desktop = { width: 1440, height: 900 };
    const mobile = { width: 390, height: 844 };
    const jobs = await (await fetch(`${origin}/api/v2/jobs`)).json();
    const items = jobs.data?.items ?? [];
    for (const viewport of [desktop, mobile]) {
      const suffix = viewport.width === 1440 ? 'desktop' : 'mobile';
      await shoot(`home-jobs-${suffix}`, '/v2', viewport);
      await shoot(`jobs-${suffix}`, '/v2/jobs', viewport);
      await shoot(`new-job-empty-${suffix}`, '/v2/jobs/new', viewport);
      await shoot(`new-job-filled-${suffix}`, '/v2/jobs/new', viewport, `(() => { const values = ['12.50','86400','86400','43200','2','Screenshot job','Summarize the linked source.','The summary covers the source link.']; const fields = [...document.querySelectorAll('input, textarea')]; fields.forEach((field, index) => { if (values[index] == null) return; const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set; setter?.call(field, values[index]); field.dispatchEvent(new Event('input', { bubbles: true })); }); return fields.length; })()`);
      for (const item of items) await shoot(`job-${item.jobId}-${String(item.status).toLowerCase()}-${suffix}`, `/v2/jobs/${item.jobId}`, viewport);
      await shoot(`account-${suffix}`, '/v2/account', viewport);
      await shoot(`resolver-${suffix}`, '/v2/resolver', viewport);
    }
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.ethereum = { request: async ({ method }) => { if (method === "eth_requestAccounts" || method === "eth_accounts") return ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"]; if (method === "eth_chainId") return "0x1"; throw new Error("unsupported"); } };' });
    for (const viewport of [desktop, mobile]) {
      const suffix = viewport.width === 1440 ? 'desktop' : 'mobile';
      await shoot(`wrong-network-${suffix}`, '/v2/account', viewport, `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('Connect wallet')); button?.click(); return true; })()`);
    }
    stopIsolatedNode(started.node);
    await new Promise((resolve) => setTimeout(resolve, 6000));
    for (const viewport of [desktop, mobile]) {
      const suffix = viewport.width === 1440 ? 'desktop' : 'mobile';
      await shoot(`reader-stale-${suffix}`, '/v2', viewport);
    }
    await writeFile(path.join(outDir, 'index.json'), `${JSON.stringify({ capturedWith: 'installed Google Chrome headless, not Edge', shots, jobCount: items.length }, null, 2)}\n`);
    session.close();
    browser.close();
    console.log(JSON.stringify({ shots: shots.length, jobs: items.length, outDir }));
  } finally {
    stopIsolatedNode(started.node);
    if (nextProc?.pid) { try { process.kill(-nextProc.pid, 'SIGTERM'); } catch { nextProc.kill('SIGTERM'); } }
    if (chromeProc?.pid) chromeProc.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
