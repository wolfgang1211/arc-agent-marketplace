import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from '../../contract/node_modules/ethers/lib.commonjs/index.js';
import { decodeIndexerLog, decodeCollateralPolicy, decodeClockPack, decodeCounters, INDEXER_CHAIN_ID } from '../lib/v2/indexer-events.mjs';
import manifest from '../lib/v2/indexer-event-manifest.json' with { type: 'json' };

const MARKET = manifest.emitters.marketplace;
const VAULT = manifest.emitters.vault;
const addr = '0x1111111111111111111111111111111111111111';
const addr2 = '0x2222222222222222222222222222222222222222';
const hash = '0x' + 'ab'.repeat(32);
const vals = { uint256: '9007199254740993000000007', uint64: '18446744073709551615', uint8: 255 };
const decode = (log, options = {}) => decodeIndexerLog(log, { chainId: INDEXER_CHAIN_ID, ...options });

function eventAbi(abi, name) { return abi.find((x) => x.type === 'event' && x.name === name); }
function oracle(abi, name, args) {
  const iface = new Interface(abi);
  const encoded = iface.encodeEventLog(iface.getEvent(name), args);
  return { topics: encoded.topics, data: encoded.data };
}
function argsFor(event) {
  return event.inputs.map((input, i) => {
    if (input.type === 'address') return i % 2 ? addr2 : addr;
    if (input.type === 'bytes32') return hash;
    if (input.type === 'bool') return i % 2 === 0;
    if (input.type === 'uint8') return 7;
    if (input.type === 'uint64') return vals.uint64;
    if (input.type === 'uint256') return vals.uint256;
    throw new Error(`fixture type ${input.type}`);
  });
}

for (const [source, abi, emitter] of [['marketplace', manifest.abis.marketplace, MARKET], ['vault', manifest.abis.vault, VAULT]]) {
  for (const event of abi) {
    test(`${source}/${event.name} decodes ethers event log`, () => {
      const args = argsFor(event);
      const encoded = oracle(abi, event.name, args);
      const result = decode({ address: emitter, topics: encoded.topics, data: encoded.data, blockNumber: '9007199254740993000000007', blockHash: hash, transactionHash: hash, transactionIndex: '3', logIndex: '4', removed: false });
      assert.equal(result.source, source);
      assert.equal(result.event, event.name);
      for (const input of event.inputs) {
        const value = result.args[input.name];
        assert.notEqual(value, undefined);
        if (input.type.startsWith('uint')) assert.match(value, /^\d+$/);
      }
    });
  }
}

test('packed JobTerms collateralPolicy uses exact Solidity bit offsets', () => {
  const value = (BigInt('18446744073709551615') | (BigInt('12345678901234567890') << 64n) | (0xdeadbeefn << 128n) | (0xabcdn << 160n)).toString();
  assert.deepEqual(decodeCollateralPolicy(value), { maxExtensionTotal: '18446744073709551615', floor: '12345678901234567890', round: '3735928559', bps: '43981' });
});

test('packed JobState clockPack and counters preserve all nonzero fields', () => {
  const clock = (1n | (2n << 64n) | (3n << 128n) | (4n << 192n)).toString();
  assert.deepEqual(decodeClockPack(clock), { deliveryDeadline: '1', reviewDeadline: '2', correctionDeadline: '3', repairDeadline: '4' });
  const counters = (5n | (6n << 8n) | (7n << 16n) | (8n << 24n) | (1n << 88n)).toString();
  assert.deepEqual(decodeCounters(counters), { accessReports: '5', disputeCount: '6', reviewingCount: '7', disputeTimeUsed: '8', pending: true });
});

test('rejects wrong emitter, unknown event, malformed topology, and ERC20 Transfer', () => {
  const event = eventAbi(manifest.abis.marketplace, 'OperatorRegistered');
  const encoded = oracle(manifest.abis.marketplace, event.name, [addr]);
  for (const log of [
    { address: VAULT, topics: encoded.topics, data: encoded.data },
    { address: MARKET, topics: ['0x' + '00'.repeat(32)], data: '0x' },
    { address: MARKET, topics: encoded.topics.slice(0, 1), data: encoded.data },
    { address: MARKET, topics: ['0xddf252ad' + '00'.repeat(28)], data: '0x' },
  ]) assert.throws(() => decode({ ...log, blockNumber: '1', blockHash: hash, transactionHash: hash, transactionIndex: '0', logIndex: '0', removed: false }), /INDEXER_EVENT_REJECTED/);
});

test('preserves uint256 stateVersion and uint128-scale values without JS precision loss', () => {
  const event = eventAbi(manifest.abis.marketplace, 'JobState');
  const max = ((1n << 256n) - 1n).toString();
  const encoded = oracle(manifest.abis.marketplace, event.name, [max, max, 7, max, max, max, vals.uint64]);
  const result = decode({ address: MARKET, topics: encoded.topics, data: encoded.data, blockNumber: max, blockHash: hash, transactionHash: hash, transactionIndex: '0', logIndex: '0', removed: false });
  assert.equal(result.args.stateVersion, max);
  assert.equal(result.args.clockPack, max);
  assert.equal(result.args.counters, max);
});


test('rejects malformed metadata without JS numeric coercion', () => {
  const event = eventAbi(manifest.abis.marketplace, 'OperatorRegistered');
  const encoded = oracle(manifest.abis.marketplace, event.name, [addr]);
  assert.throws(() => decode({ address: MARKET, topics: encoded.topics, data: encoded.data, blockNumber: 1, blockHash: hash, transactionHash: hash, transactionIndex: '0', logIndex: '0', removed: false }), /INDEXER_EVENT_REJECTED/);
});

test('requires the fixed chain binding and rejects coercion or wrong chain', () => {
  const event = eventAbi(manifest.abis.marketplace, 'OperatorRegistered');
  const encoded = oracle(manifest.abis.marketplace, event.name, [addr]);
  const log = { address: MARKET, topics: encoded.topics, data: encoded.data, blockNumber: '1', blockHash: hash, transactionHash: hash, transactionIndex: '0', logIndex: '0', removed: false };
  assert.throws(() => decodeIndexerLog(log), /INDEXER_EVENT_REJECTED/);
  assert.throws(() => decodeIndexerLog(log, { chainId: '5042002' }), /INDEXER_EVENT_REJECTED/);
  assert.throws(() => decodeIndexerLog(log, { chainId: 5042002 }), /INDEXER_EVENT_REJECTED/);
  assert.throws(() => decodeIndexerLog(log, { chainId: 5042003n }), /INDEXER_EVENT_REJECTED/);
  assert.equal(decodeIndexerLog(log, { chainId: 5042002n }).event, event.name);
});

test('snapshots descriptors without invoking getters and hides proxy failures', () => {
  const event = eventAbi(manifest.abis.marketplace, 'OperatorRegistered');
  const encoded = oracle(manifest.abis.marketplace, event.name, [addr]);
  let getterCalls = 0;
  const log = { address: MARKET, topics: encoded.topics, data: encoded.data, blockNumber: '1', blockHash: hash, transactionHash: hash, transactionIndex: '0', logIndex: '0', removed: false };
  Object.defineProperty(log, 'data', { get() { getterCalls += 1; return encoded.data; } });
  assert.throws(() => decode(log), /invalid indexer log/);
  assert.equal(getterCalls, 0);
  const proxy = new Proxy(log, { getOwnPropertyDescriptor() { throw new Error('secret getter failure'); } });
  assert.throws(() => decode(proxy), (error) => error instanceof TypeError && error.message === 'invalid indexer log');
});

test('rejects oversized topics before numeric descriptor access', () => {
  const event = eventAbi(manifest.abis.marketplace, 'OperatorRegistered');
  const encoded = oracle(manifest.abis.marketplace, event.name, [addr]);
  let numericReads = 0;
  const topics = new Proxy({ length: 5 }, { getOwnPropertyDescriptor(target, key) { if (/^\\d+$/.test(String(key))) numericReads += 1; return Reflect.getOwnPropertyDescriptor(target, key); } });
  const log = { address: MARKET, topics, data: encoded.data, blockNumber: '1', blockHash: hash, transactionHash: hash, transactionIndex: '0', logIndex: '0', removed: false };
  assert.throws(() => decode(log), /INDEXER_EVENT_REJECTED/);
  assert.equal(numericReads, 0);
});

test('rejects noncanonical numeric topic keys without invoking accessors', () => {
  const event = eventAbi(manifest.abis.marketplace, 'OperatorRegistered');
  const encoded = oracle(manifest.abis.marketplace, event.name, [addr]);
  const topics = [...encoded.topics];
  let getterCalls = 0;
  for (const key of ['00', '01']) Object.defineProperty(topics, key, {
    configurable: true,
    enumerable: false,
    get() { getterCalls += 1; return encoded.topics[Number(key)]; },
  });
  const log = { address: MARKET, topics, data: encoded.data, blockNumber: '1', blockHash: hash, transactionHash: hash, transactionIndex: '0', logIndex: '0', removed: false };
  assert.throws(() => decode(log), (error) => error instanceof TypeError && error.message === 'invalid indexer log');
  assert.equal(getterCalls, 0);
});

test('rejects noncanonical trailing ABI data and extra topics', () => {
  const event = eventAbi(manifest.abis.marketplace, 'OperatorRegistered');
  const encoded = oracle(manifest.abis.marketplace, event.name, [addr]);
  const base = { address: MARKET, topics: encoded.topics, data: encoded.data, blockNumber: '1', blockHash: hash, transactionHash: hash, transactionIndex: '0', logIndex: '0', removed: false };
  assert.throws(() => decode({ ...base, data: `${encoded.data}${'00'.repeat(32)}` }), /INDEXER_EVENT_REJECTED/);
  assert.throws(() => decode({ ...base, topics: [...encoded.topics, hash] }), /INDEXER_EVENT_REJECTED/);
});
