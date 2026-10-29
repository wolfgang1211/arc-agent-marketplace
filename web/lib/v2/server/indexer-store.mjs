import { getAddress } from 'viem';
import { ARC_TESTNET_PROFILE, assertV2Profile } from '../chain-profile.mjs';
import assert from 'node:assert/strict';

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const MAX_UINT256 = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
const ZERO_HASH = `0x${'00'.repeat(32)}`;
const MAX_HEADERS = 1000;
const MAX_EVENTS = 10000;
const MAX_TOPICS = 4;
const ARC_CHAIN = 5042002;
const ARC_MARKETPLACE = '0xFA156B7A5205B123c8a22A807ba98405e36130f1';
const ARC_VAULT = '0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423';
const MAX_EVENT_NAME = 128;
const MAX_REORG_DEPTH = 32;
const MAX_SERIALIZED_BYTES = 8 * 1024 * 1024;
const MAX_DATA_BYTES = 1_000_000;
const MAX_LOG_INDEX = 2_147_483_647;

function fail(message) { throw new TypeError(message); }
class SnapshotValidationError extends TypeError {}
function snapshotFail(message) { throw new SnapshotValidationError(message); }
function text(value, label, max = 256) { if (typeof value !== 'string' || value.length === 0 || value.length > max) fail(`${label} must be a bounded string`); return value; }
function uint(value, label) {
  const valueText = text(value, label);
  if (!UINT.test(valueText) || BigInt(valueText) > MAX_UINT256) fail(`${label} must be a uint256 decimal string`);
  return valueText;
}
function hash(value, label) { const valueText = text(value, label); if (!HASH.test(valueText)) fail(`${label} must be a 32-byte hash`); return valueText.toLowerCase(); }
function address(value, label) { const valueText = text(value, label); if (!ADDRESS.test(valueText)) fail(`${label} must be an address`); try { return getAddress(valueText); } catch { fail(`${label} must be a valid checksum address`); } }
function stable(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) fail('payload must not contain cycles');
  seen.add(value);
  const result = Array.isArray(value) ? `[${value.map((item) => stable(item, seen)).join(',')}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key], seen)}`).join(',')}}`;
  seen.delete(value); return result;
}
function same(a, b) { try { return stable(a) === stable(b); } catch { return false; } }
function json(value, label) { let encoded; try { encoded = JSON.stringify(value ?? {}); } catch { fail(`${label} must be JSON-serializable`); } if (Buffer.byteLength(encoded, 'utf8') > MAX_SERIALIZED_BYTES) fail(`${label} exceeds the bounded payload size`); return encoded; }
function boundedArrayLength(value, label, maximum, required = true) {
  try {
    if (!Array.isArray(value)) {
      if (required) snapshotFail(`${label} must be an array`);
      return null;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!descriptor || descriptor.get || !Number.isSafeInteger(descriptor.value) || descriptor.value > maximum) snapshotFail(`${label} must contain at most ${maximum} entries`);
    return descriptor.value;
  } catch (error) {
    if (error instanceof SnapshotValidationError) throw error;
    throw new TypeError('invalid indexer input');
  }
}
function snapshotJson(value, label, state = { bytes: 0, nodes: 0, depth: 0 }, field = null) {
  const add = (bytes) => { state.bytes += bytes; if (state.bytes > MAX_SERIALIZED_BYTES) snapshotFail(`${label} exceeds the bounded payload size`); };
  const visit = (current, depth, fieldName = field) => {
    if (++state.nodes > 100_000 || depth > 32) snapshotFail(`${label} is too deeply nested or large`);
    if (current === null) { add(4); return null; }
    switch (typeof current) {
      case 'string': {
        if (fieldName === 'data' && depth === 2 && current.length > (MAX_DATA_BYTES * 2) + 2) snapshotFail(`${label}.data exceeds the bounded payload size`);
        let bytes = 2;
        for (let i = 0; i < current.length; i += 1) {
          const code = current.charCodeAt(i);
          bytes += code === 34 || code === 92 ? 2 : code < 32 ? 6 : Buffer.byteLength(current[i], 'utf8');
          if (bytes > MAX_SERIALIZED_BYTES) snapshotFail(`${label} exceeds the bounded payload size`);
        }
        add(bytes); return current;
      }
      case 'boolean': add(current ? 4 : 5); return current;
      case 'number':
        if (!Number.isFinite(current)) snapshotFail(`${label} must contain only finite JSON values`);
        add(Buffer.byteLength(String(current), 'utf8')); return current;
      case 'object': break;
      default: snapshotFail(`${label} must contain only JSON values`);
    }
    if (Array.isArray(current)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(current, 'length');
      if (!lengthDescriptor || lengthDescriptor.get || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value > 100_000) snapshotFail(`${label} must contain only bounded JSON arrays`);
      const keys = Reflect.ownKeys(current);
      if (keys.length !== lengthDescriptor.value + 1) snapshotFail(`${label} must contain only dense JSON arrays`);
      add(1); const result = [];
      for (let i = 0; i < lengthDescriptor.value; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(i));
        if (!descriptor || descriptor.get || descriptor.set) snapshotFail(`${label} must contain only data properties`);
        if (i) add(1); result.push(visit(descriptor.value, depth + 1));
      }
      if (lengthDescriptor.value) add(1); add(1); return result;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) snapshotFail(`${label} must contain only plain JSON objects`);
    const keys = Reflect.ownKeys(current);
    const result = Object.create(null); add(1); let first = true;
    for (const key of keys) {
      if (typeof key !== 'string') snapshotFail(`${label} must contain only JSON object keys`);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || descriptor.get || descriptor.set) snapshotFail(`${label} must contain only data properties`);
      if (!first) add(1); first = false;
      let keyBytes = 2;
      for (let i = 0; i < key.length; i += 1) {
        const code = key.charCodeAt(i);
        keyBytes += code === 34 || code === 92 ? 2 : code < 32 ? 6 : Buffer.byteLength(key[i], 'utf8');
      }
      add(keyBytes); add(1); result[key] = visit(descriptor.value, depth + 1, key);
    }
    add(1); return result;
  };
  try {
    return visit(value, state.depth);
  } catch (error) {
    if (error instanceof SnapshotValidationError) throw error;
    throw new TypeError('invalid indexer input');
  }
}
function streamFor(emitter, marketplace, vault) {
  const e = emitter.toLowerCase();
  if (e === marketplace.toLowerCase()) return { stream: 'marketplace', emitter };
  if (e === vault.toLowerCase()) return { stream: 'vault', emitter };
  fail('event emitter is outside the configured marketplace/vault');
}
function normalizeHeader(input, chainId) {
  const header = input ?? {};
  if (header.chainId !== undefined && (typeof header.chainId !== 'number' || header.chainId !== chainId)) fail('header chain does not match configured chain');
  if (!Number.isSafeInteger(header.transactionCount) || header.transactionCount < 0) fail('transactionCount must be a bounded non-negative integer');
  return {
    blockNumber: uint(header.blockNumber, 'blockNumber'),
    blockHash: hash(header.blockHash, 'blockHash'),
    parentHash: hash(header.parentHash, 'parentHash'),
    transactionCount: Number.isInteger(header.transactionCount) && header.transactionCount >= 0 ? header.transactionCount : 0,
    header: header.header ?? {},
  };
}
function normalizeEvent(input, marketplace, vault, chainId) {
  const event = input ?? {};
  if (event.chainId !== undefined && (typeof event.chainId !== 'number' || event.chainId !== chainId)) fail('event chain does not match configured chain');
  if (event.marketplace !== undefined && (typeof event.marketplace !== 'string' || event.marketplace.toLowerCase() !== marketplace.toLowerCase())) fail('event marketplace does not match configured marketplace');
  const emitter = address(event.emitter ?? event.address, 'emitter');
  const routed = streamFor(emitter, marketplace, vault);
  const topics = event.topics;
  if (!Array.isArray(topics) || topics.length > MAX_TOPICS || topics.some((topic) => typeof topic !== 'string' || !HASH.test(topic))) fail('topics must be a bounded array of 32-byte hashes');
  const data = text(event.data, 'data', (MAX_DATA_BYTES * 2) + 2);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(data) || Buffer.byteLength(data.slice(2), 'hex') > MAX_DATA_BYTES) fail('data must be bounded even-length hex');
  return {
    stream: routed.stream,
    emitter,
    blockNumber: uint(event.blockNumber, 'event blockNumber'),
    blockHash: hash(event.blockHash, 'event blockHash'),
    transactionHash: hash(event.transactionHash, 'transactionHash'),
    transactionIndex: Number.isInteger(event.transactionIndex) && event.transactionIndex >= 0 && event.transactionIndex <= MAX_LOG_INDEX ? event.transactionIndex : fail('transactionIndex must be a bounded non-negative integer'),
    logIndex: Number.isInteger(event.logIndex) && event.logIndex >= 0 && event.logIndex <= MAX_LOG_INDEX ? event.logIndex : fail('logIndex must be a bounded non-negative integer'),
    topics,
    data,
    decoded: event.decoded ?? {},
    eventName: text(event.eventName, 'eventName', MAX_EVENT_NAME),
  };
}
function cursorValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}
function normalizeCursor(value) {
  if (value == null) return null;
  const cursor = cursorValue(value);
  return { blockNumber: uint(cursor.blockNumber, 'cursor blockNumber'), blockHash: hash(cursor.blockHash, 'cursor blockHash') };
}
function cursorText(cursor) { return cursor ? JSON.stringify(cursor) : null; }

export function createV2IndexerStore({ db, profile = ARC_TESTNET_PROFILE, chainId = Number(profile.canonicalChainId), marketplace = profile.marketplace, vault = profile.vault, maxHeaders = MAX_HEADERS } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db is required');
  assertV2Profile(profile); if (chainId !== Number(profile.canonicalChainId)) throw new TypeError('profile chain mismatch');
  marketplace = address(marketplace, 'marketplace');
  vault = address(vault, 'vault');
  if (marketplace !== profile.marketplace || vault !== profile.vault) throw new TypeError('configured Arc chain and deployments are required');
  if (!Number.isInteger(maxHeaders) || maxHeaders < 1 || maxHeaders > MAX_HEADERS) throw new TypeError('maxHeaders must be between 1 and 1000');

  async function currentCursor(tx) {
    const result = await tx.query('SELECT cursor FROM v2_indexer_cursors WHERE chain_id=$1 AND marketplace=$2', [chainId, marketplace]);
    return result.rows.length ? normalizeCursor(result.rows[0].cursor) : null;
  }
  async function findBlock(tx, block) {
    return tx.query('SELECT block_number,block_hash,parent_hash,transaction_count,canonical,header FROM v2_indexer_blocks_fork WHERE chain_id=$1 AND stream=$2 AND block_number=$3 AND block_hash=$4', [chainId, block.stream ?? 'marketplace', block.blockNumber, block.blockHash]);
  }
  function validateHeaders(headers) {
    if (!Array.isArray(headers) || headers.length > maxHeaders) fail(`headers must contain at most ${maxHeaders} entries`);
    const normalized = headers.map((header) => normalizeHeader(header, chainId));
    for (let i = 1; i < normalized.length; i += 1) {
      if (BigInt(normalized[i].blockNumber) !== BigInt(normalized[i - 1].blockNumber) + 1n) fail('headers must be sorted and contiguous');
      if (normalized[i].parentHash.toLowerCase() !== normalized[i - 1].blockHash.toLowerCase()) fail('header parent continuity mismatch');
    }
    return normalized;
  }
  function validateEvents(events, headers) {
    if (!Array.isArray(events)) fail('events must be an array');
    if (events.length > MAX_EVENTS) fail(`events must contain at most ${MAX_EVENTS} entries`);
    const normalized = events.map((event) => normalizeEvent(event, marketplace, vault, chainId));
    let previous = null;
    for (const event of normalized) {
      if (previous && (BigInt(event.blockNumber) < BigInt(previous.blockNumber) || (event.blockNumber === previous.blockNumber && (event.transactionIndex < previous.transactionIndex || (event.transactionIndex === previous.transactionIndex && event.logIndex < previous.logIndex))))) fail('events must be sorted by block, transaction, and log index');
      previous = event;
      const header = headers.find((candidate) => candidate.blockNumber === event.blockNumber && candidate.blockHash.toLowerCase() === event.blockHash.toLowerCase());
      if (!header) fail('event does not belong to a supplied header');
    }
    return normalized;
  }
  async function insertBlock(tx, block) {
    const existing = await tx.query('SELECT block_number,block_hash,parent_hash,transaction_count,canonical,header FROM v2_indexer_blocks_fork WHERE chain_id=$1 AND stream=$2 AND block_number=$3 AND block_hash=$4', [chainId, 'marketplace', block.blockNumber, block.blockHash]);
    if (existing.rows.length) {
      const row = existing.rows[0];
      if (!same([row.parent_hash, String(row.transaction_count), row.header], [block.parentHash, String(block.transactionCount), block.header])) fail('conflicting block identity payload');
      if (!row.canonical) await tx.query('UPDATE v2_indexer_blocks_fork SET canonical=TRUE WHERE chain_id=$1 AND stream=$2 AND block_number=$3 AND block_hash=$4', [chainId, 'marketplace', block.blockNumber, block.blockHash]);
      return;
    }
    await tx.query('INSERT INTO v2_indexer_blocks_fork (chain_id,stream,block_number,block_hash,parent_hash,transaction_count,canonical,header) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)', [chainId, 'marketplace', block.blockNumber, block.blockHash, block.parentHash, block.transactionCount, json(block.header, 'header')]);
  }
  async function insertEvent(tx, event) {
    const existing = await tx.query('SELECT emitter,block_number,transaction_index,topics,data,decoded,event_name,canonical FROM v2_indexer_events_fork WHERE chain_id=$1 AND stream=$2 AND emitter=$3 AND block_hash=$4 AND transaction_hash=$5 AND log_index=$6', [chainId, event.stream, event.emitter, event.blockHash, event.transactionHash, event.logIndex]);
    if (existing.rows.length) {
      const row = existing.rows[0];
      if (!same([row.emitter, String(row.block_number), row.transaction_index, row.topics, row.data, row.decoded, row.event_name], [event.emitter, event.blockNumber, event.transactionIndex, event.topics, event.data, event.decoded, event.eventName])) fail('conflicting event identity payload');
      if (!row.canonical) await tx.query('UPDATE v2_indexer_events_fork SET canonical=TRUE WHERE chain_id=$1 AND stream=$2 AND emitter=$3 AND block_hash=$4 AND transaction_hash=$5 AND log_index=$6', [chainId, event.stream, event.emitter, event.blockHash, event.transactionHash, event.logIndex]);
      return;
    }
    await tx.query('INSERT INTO v2_indexer_events_fork (chain_id,stream,emitter,block_number,block_hash,transaction_hash,transaction_index,log_index,topics,data,decoded,event_name,canonical) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)', [chainId, event.stream, event.emitter, event.blockNumber, event.blockHash, event.transactionHash, event.transactionIndex, event.logIndex, JSON.stringify(event.topics), event.data, json(event.decoded, 'decoded'), event.eventName]);
  }
  async function applyBatch({ headers = [], events = [], logs, expectedCursor, previousCursor, nextCursor, reorgAncestor, initialVerifiedAnchor, projector } = {}) {
    boundedArrayLength(headers, 'headers', maxHeaders);
    headers = snapshotJson(headers, 'headers');
    const rawEvents = logs ?? events;
    boundedArrayLength(rawEvents, 'events', MAX_EVENTS);
    const copiedEvents = snapshotJson(rawEvents, 'events');
    const normalizedHeaders = validateHeaders(headers);
    const normalizedEvents = validateEvents(copiedEvents, normalizedHeaders);
    const requestedPrevious = normalizeCursor(previousCursor !== undefined ? previousCursor : expectedCursor);
    const hasExpectedCursor = previousCursor !== undefined || expectedCursor !== undefined;
    const requestedNext = normalizeCursor(nextCursor);
    if (!normalizedHeaders.length && requestedNext && (!requestedPrevious || !same(requestedNext, requestedPrevious))) fail('empty batches cannot advance without verified headers');
    return db.transaction(async (tx) => {
      const actual = await currentCursor(tx);
      if (hasExpectedCursor && !same(actual, requestedPrevious)) fail('stale or competing indexer cursor');
      const anchor = normalizeCursor(reorgAncestor);
      const initialAnchor = normalizeCursor(initialVerifiedAnchor);
      if (anchor) {
        if (!actual || BigInt(anchor.blockNumber) > BigInt(actual.blockNumber)) fail('reorg ancestor must be at or below cursor');
        if (BigInt(actual.blockNumber) - BigInt(anchor.blockNumber) > BigInt(MAX_REORG_DEPTH)) fail('reorg exceeds maximum depth; deep replay required');
        const ancestorRow = await tx.query("SELECT block_hash FROM v2_indexer_blocks_fork WHERE chain_id=$1 AND stream='marketplace' AND block_number=$2 AND block_hash=$3 AND canonical=TRUE", [chainId, anchor.blockNumber, anchor.blockHash]);
        if (!ancestorRow.rows.length) fail('reorg ancestor is not canonical at its exact height');
      }
      if (!actual && initialAnchor) {
        if (anchor) fail('cannot combine initial anchor and reorg ancestor');
        const existing = await tx.query("SELECT block_hash FROM v2_indexer_blocks_fork WHERE chain_id=$1 AND stream='marketplace' AND block_number=$2 AND block_hash=$3 AND canonical=TRUE", [chainId, initialAnchor.blockNumber, initialAnchor.blockHash]);
        if (!existing.rows.length) await tx.query("INSERT INTO v2_indexer_blocks_fork (chain_id,stream,block_number,block_hash,parent_hash,transaction_count,canonical,header) VALUES ($1,'marketplace',$2,$3,$4,0,TRUE,'{}')", [chainId, initialAnchor.blockNumber, initialAnchor.blockHash, ZERO_HASH]);
      }
      const base = anchor ?? initialAnchor ?? actual;
      const exactReplay = !anchor && !!actual && normalizedHeaders.length > 0 && same(actual, { blockNumber: normalizedHeaders.at(-1).blockNumber, blockHash: normalizedHeaders.at(-1).blockHash });
      if (exactReplay) {
        for (const header of normalizedHeaders) {
          const replay = await tx.query("SELECT parent_hash,transaction_count,header FROM v2_indexer_blocks_fork WHERE chain_id=$1 AND stream='marketplace' AND block_number=$2 AND block_hash=$3 AND canonical=TRUE", [chainId, header.blockNumber, header.blockHash]);
          if (!replay.rows.length || !same([replay.rows[0].parent_hash, String(replay.rows[0].transaction_count), replay.rows[0].header], [header.parentHash, String(header.transactionCount), header.header])) fail('historical replay conflicts with canonical history');
        }
      }
      if (normalizedHeaders.length && !exactReplay) {
        const first = normalizedHeaders[0];
        if (base && (BigInt(first.blockNumber) !== BigInt(base.blockNumber) + 1n || first.parentHash !== base.blockHash)) fail('header does not continue the verified cursor/ancestor');
        if (!base && BigInt(first.blockNumber) !== 0n) fail('initial header requires a verified anchor');
        if (!base && BigInt(first.blockNumber) === 0n && first.parentHash !== ZERO_HASH) fail('genesis header must use zero parent');
      }
      if (anchor) {
        await tx.query("UPDATE v2_indexer_blocks_fork SET canonical=FALSE WHERE chain_id=$1 AND stream='marketplace' AND canonical AND block_number>$2", [chainId, anchor.blockNumber]);
        await tx.query("UPDATE v2_indexer_events_fork SET canonical=FALSE WHERE chain_id=$1 AND canonical AND block_number>$2", [chainId, anchor.blockNumber]);
      }
      for (const header of normalizedHeaders) await insertBlock(tx, header);
      for (const event of normalizedEvents) await insertEvent(tx, event);
      if (projector !== undefined) {
        if (typeof projector !== 'function') fail('projector must be a function');
        await projector(tx, { events: normalizedEvents, rebuild: !!anchor });
      }
      let finalCursor = requestedNext;
      if (normalizedHeaders.length) {
        const last = normalizedHeaders.at(-1); const headerCursor = { blockNumber: last.blockNumber, blockHash: last.blockHash };
        if (finalCursor && !same(finalCursor, headerCursor)) fail('next cursor must equal last supplied verified header');
        finalCursor = headerCursor;
      } else if (anchor && (!finalCursor || !same(finalCursor, anchor))) finalCursor = anchor;
      if (finalCursor && actual && !anchor && BigInt(finalCursor.blockNumber) < BigInt(actual.blockNumber)) fail('cursor cannot rewind without a verified reorg');
      if (finalCursor && (!actual || anchor || !same(finalCursor, actual))) await tx.query('INSERT INTO v2_indexer_cursors (chain_id,marketplace,cursor) VALUES ($1,$2,$3) ON CONFLICT (chain_id,marketplace) DO UPDATE SET cursor=excluded.cursor', [chainId, marketplace, cursorText(finalCursor)]);
      return { cursor: finalCursor, headers: normalizedHeaders.length, events: normalizedEvents.length };
    });
  }
  return Object.freeze({
    applyBatch,
    ingestBatch: applyBatch,
    async cursor() { const result = await db.query('SELECT cursor FROM v2_indexer_cursors WHERE chain_id=$1 AND marketplace=$2', [chainId, marketplace]); return result.rows.length ? normalizeCursor(result.rows[0].cursor) : null; },
    async canonicalBlocks() { return (await db.query('SELECT * FROM v2_indexer_blocks_fork WHERE chain_id=$1 AND stream=\'marketplace\' AND canonical ORDER BY block_number', [chainId])).rows; },
    async rawEvents({ stream } = {}) { return (await db.query(`SELECT * FROM v2_indexer_events_fork WHERE chain_id=$1 ${stream ? 'AND stream=$2' : ''} ORDER BY block_number,transaction_index,log_index`, stream ? [chainId, stream] : [chainId])).rows; },
  });
}
export const createIndexerStore = createV2IndexerStore;
export { MAX_HEADERS, MAX_UINT256 };
