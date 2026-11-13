import { mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

function canonical(value) {
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function authorizationIdentity({ requestId, action, jobId, params, expiresAt }) {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(requestId) || typeof action !== 'string' || jobId === undefined || !Number.isSafeInteger(expiresAt)) throw new Error('AUTHORIZATION_ID_INVALID');
  return canonical({ requestId, action, jobId: String(jobId), params, expiresAt });
}

export const DEFAULT_AUTHORIZATION_DIRECTORY = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'state', 'alphaboard-v2-local-arc', 'authorizations');
export function createDurableAuthorizationLedger({ directory = DEFAULT_AUTHORIZATION_DIRECTORY } = {}) {
  async function claim(input) {
    const identity = authorizationIdentity(input);
    if (input.expiresAt <= Date.now()) throw new Error('CHAT_REQUEST_EXPIRED');
    await mkdir(directory, { recursive: true });
    const key = createHash('sha256').update(String(input.requestId)).digest('hex');
    const record = path.join(directory, `${key}.claim`);
    let file;
    try { file = await open(record, 'wx'); }
    catch (error) { if (error?.code === 'EEXIST') throw new Error('CHAT_REQUEST_ALREADY_USED'); throw error; }
    // Exclusive creation is the atomic claim. Even a partial/crashed claim is
    // fail-closed and cannot be reused. Never remove another process's lock.
    try { await file.writeFile(identity, 'utf8'); await file.sync(); }
    finally { await file.close(); }
    return Object.freeze({ identity, requestId: input.requestId });
  }
  return Object.freeze({ claim });
}
