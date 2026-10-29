import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from '../../contract/node_modules/ethers/lib.commonjs/index.js';
import { keccak256 } from 'viem';
import proof from '../lib/v2/runtime-abi-proof.json' with { type: 'json' };
import manifest from '../lib/v2/indexer-event-manifest.json' with { type: 'json' };
import contractManifest from '../lib/v2/contract-manifest.json' with { type: 'json' };

const OLD_FINAL2_HASH = '0x6b4e076706147e23409ed83a6414723ab7926dfa0fd16b1e46f3accde8b77afe';
const expected = {
  marketplace: { build: '4753ec82c34e978ab8d57e5b9a84686d6ed97bdb2e19ef503c4999a94bb6ea31', artifact: '20b84d17546c867a5b5d636537d16a1238638a5dc3b475d40d706d85315155e8', runtimeBytes: 23908, hash: '0x7d24e8ddcdcb8b42aa93c453c363ad0b25f259e38362d5a11df3d5a87ed45166' },
  vault: { build: '7b906c45043419597eaa714d996cc5ffb5e9df1b5c21bf48f822bdf432817d7f', artifact: '3044c40fa10ed18f7e29d89e4964c5bb0ead960d72e11e5d88adc2811790c40f', runtimeBytes: 4854, hash: '0xc11a1314025fca9eb4fb196c6cae0d6dfc53bc847a675f56cbed5204f015ef5f' },
};

function normalizedRuntime(contract) {
  const bytes = Buffer.from(contract.compiledRuntimeBytecode.slice(2), 'hex');
  for (const ranges of Object.values(contract.immutableReferences)) for (const { start, length } of ranges) bytes.fill(0, start, start + length);
  return bytes;
}
function eventAbi(source, name) { return manifest.abis[source].find((event) => event.name === name); }
function sample(input, index) {
  if (input.type === 'address') return `0x${String(index + 1).padStart(40, '0')}`;
  if (input.type === 'uint256') return String(9007199254740993n + BigInt(index));
  if (input.type === 'uint64') return String(18446744073709551610n - BigInt(index));
  if (input.type === 'uint8') return 7;
  if (input.type === 'bytes32') return `0x${String(index + 1).padStart(64, '0')}`;
  if (input.type === 'bool') return index % 2 === 0;
  throw new Error(`unsupported fixture type ${input.type}`);
}

test('runtime proof independently hashes to both checked-in deployment pins', () => {
  for (const [name, metadata] of Object.entries(expected)) {
    const contract = proof.contracts[name];
    assert.equal(contract.buildInfo.sha256, metadata.build);
    assert.equal(contract.artifact.sha256, metadata.artifact);
    assert.equal(contract.runtimeBytes, metadata.runtimeBytes);
    assert.equal(keccak256(normalizedRuntime(contract)), metadata.hash);
    assert.equal(contract.normalizedRuntimeKeccak256, metadata.hash);
    assert.equal(contract.normalizedRuntimeKeccak256, contractManifest.runtimeHashes.arc[name === 'marketplace' ? 'marketplaceNormalized' : 'vaultNormalized']);
    assert.equal(manifest.canonical.buildInfo[name].sha256, metadata.build);
  }
  assert.notEqual(OLD_FINAL2_HASH, expected.marketplace.hash, 'old final2 runtime must remain a counterexample');
});

test('proof ABI is the exact source of the 44-event decoder manifest', () => {
  const marketplaceEvents = proof.contracts.marketplace.abi.filter((item) => item.type === 'event');
  const vaultEvents = proof.contracts.vault.abi.filter((item) => item.type === 'event');
  assert.deepEqual(manifest.abis.marketplace, marketplaceEvents);
  assert.deepEqual(manifest.abis.vault, vaultEvents);
  assert.equal(marketplaceEvents.length + vaultEvents.length, 44);
  assert.equal(eventAbi('marketplace', 'OperatorFaultDeclared').inputs.map((x) => `${x.name}:${x.type}:${x.indexed}`).join(','), 'jobId:uint256:true,operator:address:true,slashedAmount:uint256:false');
  assert.equal(eventAbi('marketplace', 'OwnershipTransferStarted').inputs.map((x) => `${x.name}:${x.type}:${x.indexed}`).join(','), 'previousOwner:address:true,newOwner:address:true');
});

test('new deployed event descriptors round-trip through the full ABI', () => {
  for (const name of ['OperatorFaultDeclared', 'OwnershipTransferStarted']) {
    const abi = eventAbi('marketplace', name);
    const iface = new Interface([abi]);
    const args = abi.inputs.map(sample);
    const encoded = iface.encodeEventLog(iface.getEvent(name), args);
    const decoded = iface.decodeEventLog(name, encoded.data, encoded.topics);
    assert.deepEqual(abi.inputs.map((input) => String(decoded[input.name])), args.map(String));
  }
});

test('runtime proof rejects a swapped/wrong-build witness instead of trusting metadata', () => {
  const witness = structuredClone(proof.contracts.marketplace);
  const bytes = Buffer.from(witness.compiledRuntimeBytecode.slice(2), 'hex');
  bytes[0] ^= 1;
  witness.compiledRuntimeBytecode = `0x${bytes.toString('hex')}`;
  assert.notEqual(keccak256(normalizedRuntime(witness)), witness.normalizedRuntimeKeccak256);
  assert.notEqual(keccak256(normalizedRuntime(witness)), expected.marketplace.hash);
});

test('current canonical storage pins retain jobs at 11 and mutual at 21', () => {
  assert.deepEqual(contractManifest.storage, { jobs: 11, listedHouse: 15, testClient: 16, resolverPolicy: 17, mutual: 21 });
  const entries = proof.contracts.marketplace.storageLayout.storage;
  assert.equal(entries.find((entry) => entry.label === 'jobs').slot, '11');
  assert.equal(entries.find((entry) => entry.label === 'mutual').slot, '21');
  assert.equal(entries.find((entry) => entry.label === 'listedHouse').slot, '15');
});
