// Read-only local diagnostic. This is NOT browser/E2E acceptance evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getV2LocalRuntime } from '../lib/v2/server/api-runtime.mjs';
assert.equal(process.env.V2_CHAIN_PROFILE, 'local-hardhat');
const file = new URL('../lib/v2/server/api-private.mjs', import.meta.url);
let source = fs.readFileSync(file, 'utf8').replace(/from '([^']+)'/g, (_, specifier) => `from '${specifier.startsWith('.') ? new URL(specifier, file).href : import.meta.resolve(specifier)}'`);
const boundary = 'catch(e) { const code=e instanceof PrivateError';
assert.ok(source.includes(boundary));
source = source.replace(boundary, `catch(e) { const m=String(e.message); const safe=/^Cannot read properties of (undefined|null) \\(reading '[A-Za-z_$]+'\\)$/.test(m)||/^[A-Za-z_$][\\w.$]* is not (defined|a function)$/.test(m); globalThis.__v2PrivateDiagnostic={name:e.name,summary:safe?m:'REDACTED',frames:String(e.stack).split('\\n').slice(1).map(line=>(line.match(/at (?:async )?([A-Za-z_$][\\w.$]*)/)||[])[1]).filter(Boolean).slice(0,4)}; const code=e instanceof PrivateError`);
const { createV2PrivateApi } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const runtime = await getV2LocalRuntime();
try {
  const wallet = JSON.parse(fs.readFileSync(new URL('manifest.json', 'file:///' + process.env.V2_LOCAL_UI_STATE.replaceAll('\\', '/') + '/'), 'utf8')).roles.operator;
  const handler = createV2PrivateApi({ db: runtime.db, profile: runtime.profile, auth: { authenticateRequest: async () => ({ wallet }) }, readerFactory: runtime.readerFactory, getHealth: runtime.getHealth, origin: 'http://127.0.0.1:3104' });
  const response = await handler(new Request('http://127.0.0.1:3104/api/v2/jobs/8/application-context'));
  console.log('PRIVATE_READ_ONLY_PROBE', response.status, globalThis.__v2PrivateDiagnostic || { status: 'no exception' });
  if (response.status === 200) { const body = await response.json(); console.log('CONTEXT_CHAIN', body.domain.chainId, 'JOB', body.message.jobId); }
} finally { await runtime.db.close(); }
