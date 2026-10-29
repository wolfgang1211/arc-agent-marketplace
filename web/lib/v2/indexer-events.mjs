import manifest from './indexer-event-manifest.json' with { type: 'json' };
import { ARC_TESTNET_PROFILE, assertV2Profile } from './chain-profile.mjs';
import { decodeEventLog, encodeAbiParameters, encodeEventTopics, getAddress, keccak256, toBytes } from 'viem';

const MAX_UINT256 = (1n << 256n) - 1n;
export const INDEXER_CHAIN_ID = ARC_TESTNET_PROFILE.canonicalChainId;
const MAX_TOPICS = 4;
const SOURCES = Object.freeze(['marketplace', 'vault']);
const EMITTERS = Object.freeze(Object.fromEntries(SOURCES.map((source) => [source, getAddress(manifest.emitters[source])] )));
const HEX = /^0x[0-9a-fA-F]*$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

function reject() { throw new Error('INDEXER_EVENT_REJECTED'); }
function invalidLog() { throw new TypeError('invalid indexer log'); }
function dataDescriptor(value, key) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) invalidLog();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) invalidLog();
    return descriptor.value;
  } catch (error) { if (error instanceof TypeError && error.message === 'invalid indexer log') throw error; invalidLog(); }
}
function snapshotTopics(value) {
  let length;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) invalidLog();
    length = descriptor.value;
  } catch { invalidLog(); }
  if (!Array.isArray(value) || !Number.isSafeInteger(length) || length === 0 || length > MAX_TOPICS) reject();
  const result = new Array(length);
  for (let index = 0; index < length; index += 1) result[index] = dataDescriptor(value, String(index));
  try {
    for (const key of Reflect.ownKeys(value)) if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) reject();
  } catch { invalidLog(); }
  return result;
}
function snapshot(log) {
  try {
    if (log === null || typeof log !== 'object') reject();
    const prototype = Object.getPrototypeOf(log);
    if (prototype !== Object.prototype && prototype !== null) reject();
  } catch { invalidLog(); }
  return {
    address: dataDescriptor(log, 'address'),
    blockNumber: dataDescriptor(log, 'blockNumber'),
    blockHash: dataDescriptor(log, 'blockHash'),
    transactionHash: dataDescriptor(log, 'transactionHash'),
    transactionIndex: dataDescriptor(log, 'transactionIndex'),
    logIndex: dataDescriptor(log, 'logIndex'),
    removed: dataDescriptor(log, 'removed'),
    topics: snapshotTopics(dataDescriptor(log, 'topics')),
    data: dataDescriptor(log, 'data'),
  };
}
function hex(value, bytes) {
  if (typeof value !== 'string' || !HEX.test(value) || value.length % 2 !== 0 || (bytes !== undefined && value.length !== 2 + bytes * 2)) reject();
  return value;
}
function decimal(value, max = MAX_UINT256) {
  if (typeof value === 'bigint') { if (value < 0n || value > max) reject(); return value; }
  if (typeof value !== 'string' || !DECIMAL.test(value)) reject();
  const result = BigInt(value);
  if (result > max) reject();
  return result;
}
function metadata(log) {
  let normalized;
  try { normalized = getAddress(log.address); } catch { reject(); }
  return {
    address: normalized.toLowerCase(),
    blockNumber: decimal(log.blockNumber).toString(),
    blockHash: hex(log.blockHash, 32).toLowerCase(),
    transactionHash: hex(log.transactionHash, 32).toLowerCase(),
    transactionIndex: decimal(log.transactionIndex).toString(),
    logIndex: decimal(log.logIndex).toString(),
    removed: log.removed === false ? false : reject(),
  };
}
function signature(event) {
  return `${event.name}(${event.inputs.map((input) => input.type).join(',')})`;
}
function publicValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) if (!/^\d+$/.test(key)) result[key] = publicValue(child);
    return result;
  }
  return value;
}
function publicArgs(event, decoded) {
  const raw = publicValue(decoded);
  const result = {};
  for (const input of event.inputs) {
    const value = raw[input.name];
    if (value === undefined) reject();
    result[input.name] = input.type.startsWith('uint') && typeof value === 'number' ? String(value) : value;
  }
  return result;
}
const CATALOG = SOURCES.flatMap((source) => manifest.abis[source].map((event) => Object.freeze({ source, event, topic: keccak256(toBytes(signature(event))).toLowerCase() })));
const TOPIC_MAP = new Map(CATALOG.map((entry) => [entry.topic, entry]));

function sameHex(left, right) { return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase(); }
function verifyCanonicalEncoding(event, decoded, topics, data) {
  const indexed = event.inputs.filter((input) => input.indexed);
  const nonIndexed = event.inputs.filter((input) => !input.indexed);
  const values = event.inputs.map((input) => decoded.args[input.name]);
  const encodedTopics = encodeEventTopics({ abi: [event], eventName: event.name, args: values.filter((_, index) => event.inputs[index].indexed) });
  if (encodedTopics.length !== topics.length) reject();
  for (let index = 0; index < topics.length; index += 1) if (!sameHex(encodedTopics[index], topics[index])) reject();
  const encodedData = encodeAbiParameters(nonIndexed.map((input) => ({ type: input.type })), nonIndexed.map((input) => decoded.args[input.name]));
  if (!sameHex(encodedData, data) || indexed.length + 1 !== topics.length) reject();
}

export function decodeIndexerLog(rawLog, context) {
  try {
    if (context === null || typeof context !== 'object') reject();
    const profile = context.profile ?? ARC_TESTNET_PROFILE; assertV2Profile(profile);
    if (typeof context.chainId !== 'bigint' || context.chainId !== profile.canonicalChainId) reject();
    const log = snapshot(rawLog);
    const meta = metadata(log);
    const emitter = getAddress(log.address);
    const configuredEmitters = { marketplace: getAddress(profile.marketplace), vault: getAddress(profile.vault) };
    const source = SOURCES.find((candidate) => configuredEmitters[candidate] === emitter);
    if (!source) reject();
    const topics = log.topics;
    for (const topic of topics) hex(topic, 32);
    const entry = TOPIC_MAP.get(topics[0].toLowerCase());
    if (!entry || entry.source !== source) reject();
    const indexedCount = entry.event.inputs.filter((input) => input.indexed).length;
    if (topics.length !== indexedCount + 1) reject();
    const data = hex(log.data);
    const dataWords = entry.event.inputs.filter((input) => !input.indexed).length;
    if (data.length !== 2 + dataWords * 64) reject();
    const decoded = decodeEventLog({ abi: [entry.event], data, topics, strict: true });
    verifyCanonicalEncoding(entry.event, decoded, topics, data);
    return Object.freeze({ ...meta, source, event: entry.event.name, args: Object.freeze(publicArgs(entry.event, decoded.args)) });
  } catch (error) { if (error instanceof TypeError && error.message === 'invalid indexer log') throw error; reject(); }
}

function packed(value) { return decimal(value); }
function field(value, bits, shift) { return ((value >> shift) & ((1n << BigInt(bits)) - 1n)).toString(); }
export function decodeCollateralPolicy(value) {
  const packedValue = packed(value);
  return { maxExtensionTotal: field(packedValue, 64, 0n), floor: field(packedValue, 64, 64n), round: field(packedValue, 32, 128n), bps: field(packedValue, 16, 160n) };
}
export function decodeClockPack(value) {
  const packedValue = packed(value);
  return { deliveryDeadline: field(packedValue, 64, 0n), reviewDeadline: field(packedValue, 64, 64n), correctionDeadline: field(packedValue, 64, 128n), repairDeadline: field(packedValue, 64, 192n) };
}
export function decodeCounters(value) {
  const packedValue = packed(value);
  return { accessReports: field(packedValue, 8, 0n), disputeCount: field(packedValue, 8, 8n), reviewingCount: field(packedValue, 8, 16n), disputeTimeUsed: field(packedValue, 64, 24n), pending: ((packedValue >> 88n) & 1n) === 1n };
}
export const INDEXER_EVENT_SOURCES = Object.freeze({
  marketplace: EMITTERS.marketplace.toLowerCase(),
  vault: EMITTERS.vault.toLowerCase(),
});
