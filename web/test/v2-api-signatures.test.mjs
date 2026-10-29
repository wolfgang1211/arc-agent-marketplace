import assert from 'node:assert/strict';
import test from 'node:test';
import { createV2SignatureVerifier } from '../lib/v2/server/api-signatures.mjs';
import { encodeFunctionResult } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const wallet = privateKeyToAccount(generatePrivateKey());
const blockTag = '0x2a';
const contract = '0x00000000000000000000000000000000000000c1';
const ABI = [{ type: 'function', name: 'isValidSignature', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'bytes' }], outputs: [{ type: 'bytes4' }] }];
function readerFactory(options = {}) { return { read: async () => ({ blockTag: options.toBlockTag ?? blockTag }) }; }

test('EOA verification signs against the actual viem account and pins eth_getCode', async () => {
  const message = 'v2 signature fixture';
  const signature = await wallet.signMessage({ message });
  const calls = [];
  const verifier = createV2SignatureVerifier({ readerFactory, transport: async (method, params) => { calls.push({ method, params }); if (method === 'eth_getCode') return '0x'; throw new Error('unexpected RPC'); } });
  assert.equal(await verifier.verifyWalletSignature({ wallet: wallet.address, message, signature }), true);
  assert.deepEqual(calls, [{ method: 'eth_getCode', params: [wallet.address, blockTag] }]);
});

test('ERC1271 calls the fixed selector with the pinned tag and rejects wrong magic/revert', async () => {
  const message = 'contract signature fixture';
  const signature = '0x1234';
  const calls = [];
  const valid = encodeFunctionResult({ abi: ABI, functionName: 'isValidSignature', result: '0x1626ba7e' });
  const verifier = createV2SignatureVerifier({ readerFactory, transport: async (method, params) => { calls.push({ method, params }); if (method === 'eth_getCode') return '0x6000'; if (method === 'eth_call') return valid; throw new Error('unexpected RPC'); } });
  assert.equal(await verifier.verifyWalletSignature({ wallet: contract, message, signature, blockTag }), true);
  assert.equal(calls[1].method, 'eth_call');
  assert.equal(calls[1].params[1], blockTag);
  assert.match(calls[1].params[0].data, /^0x1626ba7e/);

  const wrong = createV2SignatureVerifier({ readerFactory, transport: async (method) => method === 'eth_getCode' ? '0x6000' : encodeFunctionResult({ abi: ABI, functionName: 'isValidSignature', result: '0xffffffff' }) });
  await assert.rejects(() => wrong.readSignature(contract, '0x' + '11'.repeat(32), signature), /invalid magic/);
  const reverted = createV2SignatureVerifier({ readerFactory, transport: async (method) => { if (method === 'eth_getCode') return '0x6000'; throw new Error('revert'); } });
  await assert.rejects(() => reverted.readSignature(contract, '0x' + '11'.repeat(32), signature), /call failed/);
});

test('readSignature validates digest and block tag before making RPC calls', async () => {
  const verifier = createV2SignatureVerifier({ readerFactory, transport: async () => '0x' });
  await assert.rejects(() => verifier.readSignature(contract, 'not-a-digest', '0x12'), /invalid digest/);
  await assert.rejects(() => verifier.readSignature(contract, '0x' + '11'.repeat(32), '0x12', '0x00'), /invalid pinned block/);
});
