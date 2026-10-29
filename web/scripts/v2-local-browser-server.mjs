import { spawn } from 'node:child_process';
import process from 'node:process';
import { assertV2ProfileEnvironment } from '../lib/v2/chain-profile.mjs';

assertV2ProfileEnvironment(process.env);
if (process.env.V2_CHAIN_PROFILE !== 'local-hardhat') throw new Error('Explicit V2_CHAIN_PROFILE=local-hardhat is required for the local browser server');

const port = process.env.PORT ?? '3104';
const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  V2_CHAIN_PROFILE: 'local-hardhat',
  HOSTNAME: '127.0.0.1',
  PORT: port,
};

const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', port], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  windowsHide: true,
});
let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('exit', (code, signal) => process.exit(typeof code === 'number' ? code : signal ? 1 : 0));
