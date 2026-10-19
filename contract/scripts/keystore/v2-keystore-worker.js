const fs = require('fs');
const path = require('path');
const os = require('os');
const { Wallet } = require('ethers');
const roles = new Set(['deployer', 'owner', 'treasury', 'resolver', 'testOperator', 'testClient2', 'testClient']);
const root = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'keys', 'alphaboard-testnet');

async function loadRuntimeWallet(input) {
  if (!input || input.op !== 'decrypt' || !roles.has(input.role) || typeof input.password !== 'string') throw new Error('INVALID_REQUEST');
  const expectedFile = path.join(root, `${input.role}.keystore`);
  const actual = fs.realpathSync(expectedFile);
  if (path.relative(fs.realpathSync(root), actual).toLowerCase() !== `${input.role}.keystore`.toLowerCase()) throw new Error('KEYSTORE_PATH_REJECTED');
  const password = Buffer.from(input.password, 'latin1');
  input.password = '';
  try {
    const wallet = await Wallet.fromEncryptedJson(fs.readFileSync(actual, 'utf8'), password);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'roles-manifest.json'), 'utf8'));
    if (wallet.address.toLowerCase() !== manifest.roles[input.role].address.toLowerCase()) throw new Error('ADDRESS_MISMATCH');
    return wallet;
  } finally {
    password.fill(0);
  }
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  raw = '';
  const wallet = await loadRuntimeWallet(input);
  // This command only verifies decryption. It has no provider or transaction path.
  process.stdout.write(JSON.stringify({ ok: true, role: input.role, address: wallet.address, mode: 'offline-address-check' }));
}
if (require.main === module) main().catch(() => { process.stdout.write(JSON.stringify({ ok: false, error: 'KEYSTORE_LOAD_FAILED' })); process.exitCode = 1; });
module.exports = { loadRuntimeWallet };
