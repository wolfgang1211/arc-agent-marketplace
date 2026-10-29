import { decodeIndexerLog, INDEXER_CHAIN_ID, INDEXER_EVENT_SOURCES } from '../indexer-events.mjs';
import { keccak256, hexToBytes } from 'viem';
import { createV2IndexerProjector } from './indexer-projection.mjs';
import { prepareV2Projection } from './indexer-projection.mjs';
import { createV2ChainReader } from './chain-reader.mjs';
import { ARC_TESTNET_PROFILE, assertV2Profile } from '../chain-profile.mjs';

const MAX_RANGE = 1000;
const MAX_BATCHES = 8;
// Keep the caller-owned transaction snapshot bounded by the store's 10,000-event limit.
const MAX_BLOCK_TRANSACTIONS = 10_000;
const DEFAULT_CHAIN_ID = Number(ARC_TESTNET_PROFILE.canonicalChainId);
const DEFAULT_MARKETPLACE = ARC_TESTNET_PROFILE.marketplace;
const DEFAULT_VAULT = ARC_TESTNET_PROFILE.vault;
const ALLOWED_RPC = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_getBlockReceipts', 'eth_getTransactionReceipt', 'eth_getCode', 'eth_getStorageAt', 'eth_call']);
const RETRYABLE = new Set([-32005, 413, 429]);
const hexQty = (n) => `0x${BigInt(n).toString(16)}`;
const parseQty = (value, label) => { if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) throw new Error(`invalid ${label}`); return BigInt(value); };
const parseDecimal = (value, label) => { if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`invalid ${label}`); return BigInt(value); };
const parseRpcQuantity = (value, label) => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value) ? parseDecimal(value, label) : parseQty(value, label);
};
const hash = (value, label) => { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`invalid ${label}`); return value.toLowerCase(); };
const SAFE_ERROR_MESSAGES = Object.freeze({
  INDEXER_RPC_FAILED: 'indexer RPC request failed',
  INDEXER_VALIDATION_FAILED: 'indexer validation failed',
});
const safeError = (code = 'INDEXER_RPC_FAILED') => {
  const error = new Error(SAFE_ERROR_MESSAGES[code] ?? SAFE_ERROR_MESSAGES.INDEXER_RPC_FAILED);
  error.code = code;
  return error;
};
const ownData = (value, key) => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
  try { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined; } catch { return undefined; }
};
const rpcCode = (error) => {
  const code = ownData(error, 'code');
  if (typeof code === 'number' && Number.isSafeInteger(code)) return code;
  const status = ownData(error, 'status');
  return typeof status === 'number' && Number.isSafeInteger(status) ? status : undefined;
};
const lowerHex = (value, label) => { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) throw new Error(`invalid ${label}`); return value.toLowerCase(); };
const sameHexArray = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => lowerHex(value, 'log hex') === lowerHex(right[index], 'log hex'));
export function snapshotTransactionHashes(value) {
  try {
    if (!Array.isArray(value)) throw new Error('invalid block transactions');
    const reportedLength = value.length;
    if (!Number.isSafeInteger(reportedLength) || reportedLength < 0 || reportedLength > MAX_BLOCK_TRANSACTIONS) throw new Error('invalid block transactions');
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') || lengthDescriptor.value !== reportedLength) throw new Error('invalid block transactions');
    const length = reportedLength;
    const result = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('invalid block transactions');
      result[index] = hash(descriptor.value, 'transaction hash');
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length' || (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length)) continue;
      throw new Error('invalid block transactions');
    }
    return Object.freeze(result);
  } catch {
    // Never inspect provider/proxy exception properties or invoke their getters.
    throw new Error('invalid block transactions');
  }
}
function ethereumLogsBloom(logs) {
  const bloom = new Uint8Array(256);
  for (const log of logs) for (const value of [log.address, ...(log.topics ?? [])]) {
    const bytes = hexToBytes(keccak256(hexToBytes(value)));
    for (let i = 0; i < 3; i += 1) { const bit = ((bytes[i * 2] << 8) | bytes[i * 2 + 1]) & 2047; bloom[255 - (bit >> 3)] |= 1 << (bit & 7); }
  }
  return `0x${Buffer.from(bloom).toString('hex')}`;
}
const isZeroBloom = (value) => value == null || /^0x0{512}$/i.test(value);
function sameLogPayload(left, right) {
  return ownData(left, 'removed') === false
    && ownData(right, 'removed') === false
    && hash(left.blockHash, 'log block hash') === hash(right.blockHash, 'log block hash')
    && parseRpcQuantity(left.blockNumber, 'log block number') === parseRpcQuantity(right.blockNumber, 'log block number')
    && hash(left.transactionHash, 'log transaction hash') === hash(right.transactionHash, 'log transaction hash')
    && parseRpcQuantity(left.transactionIndex, 'log transaction index') === parseRpcQuantity(right.transactionIndex, 'log transaction index')
    && parseRpcQuantity(left.logIndex, 'log index') === parseRpcQuantity(right.logIndex, 'log index')
    && String(left.address).toLowerCase() === String(right.address).toLowerCase()
    && sameHexArray(left.topics, right.topics)
    && lowerHex(left.data, 'log data') === lowerHex(right.data, 'log data');
}

export function createV2Indexer({ db, transport, store, readerFactory, projector, profile = ARC_TESTNET_PROFILE, initialAnchor = null, chainId = Number(profile.canonicalChainId), marketplace = profile.marketplace, vault = profile.vault, batchSize = MAX_RANGE, maxBatches = 1, confirmations = 32, retries = 2, timeoutMs = 5000, totalBudgetMs = 60000, sleep = async () => {} } = {}) {
  if (!db || typeof transport !== 'function' || !store) throw new TypeError('indexer requires db, transport, and store');
  assertV2Profile(profile); if (chainId !== Number(profile.canonicalChainId) || marketplace.toLowerCase() !== profile.marketplace.toLowerCase() || vault.toLowerCase() !== profile.vault.toLowerCase()) throw new TypeError('configured Arc deployment mismatch');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_RANGE) throw new TypeError('batchSize must be between 1 and 1000');
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > MAX_BATCHES) throw new TypeError('maxBatches must be between 1 and 8');
  if (!Number.isSafeInteger(confirmations) || confirmations < 0) throw new TypeError('confirmations must be a safe non-negative integer');
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 5) throw new TypeError('retries must be between 0 and 5');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(totalBudgetMs) || totalBudgetMs < 1 || totalBudgetMs > 60000) throw new TypeError('invalid RPC budget');
  const project = projector ?? createV2IndexerProjector({ profile, chainId, marketplace });
  let health = { status: 'starting', finalityMode: 'unverified', buffer: confirmations, cursor: null, indexedBlock: null, indexedHash: null, head: null, safeHead: null, lag: null, lastSyncedAt: null, stale: true, gap: null, code: null, reason: null };
  const started = () => Date.now();
  let budgetStart = null;
  async function rpc(method, params = [], budget = budgetStart ?? started()) {
    if (!ALLOWED_RPC.has(method)) throw safeError();
    const remaining = totalBudgetMs - (Date.now() - budget);
    if (remaining <= 0) throw safeError();
    let attempt = 0;
    while (true) {
      const ms = Math.min(timeoutMs, remaining);
      let timer; let settled = false; let callFinished = false;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      try {
        const call = Promise.resolve().then(() => transport(method, params, controller?.signal)).finally(() => { callFinished = true; });
        const result = await Promise.race([call, new Promise((_, reject) => { timer = setTimeout(() => { controller?.abort(); reject(safeError()); }, ms); })]);
        settled = true; clearTimeout(timer);
        if (result === undefined || result === null) throw safeError();
        return result;
      } catch (error) {
        clearTimeout(timer);
        const code = rpcCode(error);
        if (code === -32602 || code === -32000) { const unsupported = safeError('INDEXER_RPC_FAILED'); unsupported.code = code; throw unsupported; }
        if (!callFinished || !RETRYABLE.has(code) || attempt >= retries) { const failure = safeError(); failure.code = code; throw failure; }
        await sleep(2 ** attempt * 10); attempt += 1;
      }
    }
  }
  async function finalHead() {
    const head = parseQty(await rpc('eth_blockNumber'), 'head');
    for (const tag of ['finalized', 'safe']) {
      try {
        const block = await rpc('eth_getBlockByNumber', [tag, false]);
        if (block?.number && block?.hash) return { number: parseQty(block.number, 'finalized number'), tag, hash: hash(block.hash, 'finalized hash'), head };
      } catch (error) {
        if (rpcCode(error) !== -32602 && rpcCode(error) !== -32000) throw error;
      }
    }
    const number = head > BigInt(confirmations) ? head - BigInt(confirmations) : 0n;
    return { number, tag: 'confirmations', hash: null, head };
  }
  async function readHeaders(from, to) {
    const headers = []; let parent = null;
    for (let n = from; n <= to; n += 1n) {
      const block = await rpc('eth_getBlockByNumber', [hexQty(n), false]);
      if (!block || parseQty(block.number, 'block number') !== n) throw new Error('RPC returned inconsistent block');
      const transactionHashes = snapshotTransactionHashes(block.transactions);
      if (typeof block.logsBloom !== 'string' || !/^0x[0-9a-fA-F]{512}$/.test(block.logsBloom)) throw new Error('invalid logs bloom');
      const item = { blockNumber: n.toString(), blockHash: hash(block.hash, 'block hash'), parentHash: hash(block.parentHash, 'parent hash'), transactionCount: transactionHashes.length, header: { timestamp: block.timestamp ?? null, transactions: transactionHashes, logsBloom: block.logsBloom.toLowerCase() } };
      if (parent && item.parentHash !== parent) throw new Error('header parent continuity mismatch');
      parent = item.blockHash; headers.push(item);
    }
    return headers;
  }
  function normalizeRpcLog(raw) {
    const quantity = (value, label) => {
      if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) return value;
      return parseQty(value, label).toString();
    };
    if (ownData(raw, 'removed') !== false) throw new Error('removed log in queried range');
    return { ...raw, blockNumber: quantity(raw.blockNumber, 'log block'), transactionIndex: quantity(raw.transactionIndex, 'transaction index'), logIndex: quantity(raw.logIndex, 'log index') };
  }
  async function getLogsRange(address, from, to) {
    try { return await rpc('eth_getLogs', [{ address, fromBlock: hexQty(from), toBlock: hexQty(to) }]); }
    catch (error) {
      if (!RETRYABLE.has(error?.code) || from >= to) throw error;
      const middle = from + ((to - from) / 2n);
      const left = await getLogsRange(address, from, middle);
      const right = await getLogsRange(address, middle + 1n, to);
      return [...left, ...right];
    }
  }
  async function readLogs(from, to) {
    const all = [];
    for (const address of [marketplace, vault]) {
      const logs = await getLogsRange(address, from, to);
      if (!Array.isArray(logs)) throw new Error('RPC returned invalid logs');
      for (const raw of logs) all.push(normalizeRpcLog(raw));
    }
    all.sort((a, b) => Number(parseRpcQuantity(a.blockNumber, 'log block') - parseRpcQuantity(b.blockNumber, 'log block')) || Number(parseRpcQuantity(a.transactionIndex, 'transaction index') - parseRpcQuantity(b.transactionIndex, 'transaction index')) || Number(parseRpcQuantity(a.logIndex, 'log index') - parseRpcQuantity(b.logIndex, 'log index')));
    const seen = new Map(); const decoded = [];
    for (const raw of all) {
      if (parseRpcQuantity(raw.blockNumber, 'log block') < from || parseRpcQuantity(raw.blockNumber, 'log block') > to) throw new Error('log outside requested range');
      const d = decodeIndexerLog(raw, { chainId: profile.canonicalChainId, profile });
      const key = `${d.source}:${d.address}:${d.blockHash}:${d.transactionHash}:${d.logIndex}`;
      const event = { stream: d.source, emitter: d.address, blockNumber: d.blockNumber, blockHash: d.blockHash, transactionHash: d.transactionHash, transactionIndex: Number(parseDecimal(d.transactionIndex, 'transaction index')), logIndex: Number(parseDecimal(d.logIndex, 'log index')), topics: raw.topics, data: raw.data, decoded: { args: d.args }, eventName: d.event };
      const prior = seen.get(key);
      if (prior) {
        if (!sameLogPayload(prior.raw, raw) || prior.event.eventName !== event.eventName) throw new Error('conflicting log identity');
        continue;
      }
      seen.set(key, { raw, event });
      decoded.push(event);
    }
    return decoded;
  }
  async function verifyCompleteness(headers, events) {
    const queriedByBlock = new Map();
    for (const event of events) { const list = queriedByBlock.get(event.blockNumber) ?? []; list.push(event); queriedByBlock.set(event.blockNumber, list); }
    for (const header of headers) {
      const queried = queriedByBlock.get(header.blockNumber) ?? [];
      if (header.transactionCount === 0) { if (queried.length || !isZeroBloom(header.header.logsBloom)) throw new Error('zero-transaction block completeness mismatch'); continue; }
      let receipts; try { receipts = await rpc('eth_getBlockReceipts', [hexQty(BigInt(header.blockNumber))]); } catch { throw new Error('indexer receipt completeness unavailable'); }
      if (!Array.isArray(receipts) || receipts.length !== header.transactionCount) throw new Error('indexer receipt completeness mismatch');
      const receiptLogs = [], receiptByKey = new Map(), queriedByKey = new Map();
      let previousLogIndex = -1n;
      for (let index = 0; index < receipts.length; index += 1) {
        const receipt = receipts[index];
        if (hash(receipt.blockHash, 'receipt block hash') !== header.blockHash || parseRpcQuantity(receipt.blockNumber, 'receipt block number').toString() !== header.blockNumber || hash(receipt.transactionHash, 'receipt transaction hash') !== header.header.transactions[index]) throw new Error('receipt transaction ordering mismatch');
        if (receipt.transactionIndex !== undefined && parseRpcQuantity(receipt.transactionIndex, 'receipt transaction index') !== BigInt(index)) throw new Error('receipt transaction ordering mismatch');
        if (!Array.isArray(receipt.logs)) throw new Error('receipt logs unavailable');
        for (const raw of receipt.logs) {
          // Canonical receipt metadata is a required, exact binding. In particular,
          // an omitted `removed` is not equivalent to the canonical false value.
          if (typeof raw?.removed !== 'boolean' || raw.removed !== false) throw new Error('removed log in canonical range');
          if (parseRpcQuantity(raw.blockNumber, 'receipt log block number') !== BigInt(header.blockNumber)
            || hash(raw.blockHash, 'receipt log block hash') !== header.blockHash
            || hash(raw.transactionHash, 'receipt log transaction hash') !== header.header.transactions[index]
            || parseRpcQuantity(raw.transactionIndex, 'receipt log transaction index') !== BigInt(index)) throw new Error('receipt log binding mismatch');
          const logIndex = parseRpcQuantity(raw.logIndex, 'receipt log index');
          if (logIndex <= previousLogIndex) throw new Error('receipt log ordering mismatch');
          previousLogIndex = logIndex;
          receiptLogs.push(raw);
          if (typeof raw.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(raw.address)) throw new Error('invalid receipt log emitter');
          const emitter = raw.address.toLowerCase();
          // Header bloom covers ALL logs, but getLogs queries only our pinned
          // pair. Token transfers and unrelated contracts are not missing V2 events.
          if (emitter !== marketplace.toLowerCase() && emitter !== vault.toLowerCase()) continue;
          const key = `${hash(raw.transactionHash, 'receipt transaction hash')}:${logIndex.toString()}`;
          if (receiptByKey.has(key) && !sameLogPayload(receiptByKey.get(key), raw)) throw new Error('conflicting receipt log identity');
          receiptByKey.set(key, raw);
        }
      }
      for (const event of queried) {
        const key = `${hash(event.transactionHash, 'queried transaction hash')}:${parseRpcQuantity(event.logIndex, 'queried log index').toString()}`;
        if (queriedByKey.has(key) && !sameLogPayload(queriedByKey.get(key), event)) throw new Error('conflicting log identity');
        queriedByKey.set(key, event);
      }
      if (receiptByKey.size !== queriedByKey.size) throw new Error('receipt/getLogs completeness mismatch');
      for (const [key, raw] of receiptByKey) {
        const event = queriedByKey.get(key);
        if (!event || !sameLogPayload({ ...event, address: event.emitter, removed: false }, raw)) throw new Error('receipt/getLogs completeness mismatch');
      }
      if (header.header.logsBloom !== null && header.header.logsBloom !== undefined && lowerHex(header.header.logsBloom, 'logs bloom') !== ethereumLogsBloom(receiptLogs)) throw new Error('logs bloom mismatch');
    }
  }
  async function attest(expectedBlockNumber = null) {
    const factory = readerFactory ?? ((options) => createV2ChainReader(options));
    const expectedTag = expectedBlockNumber === null ? null : hexQty(expectedBlockNumber);
    // Only the reader's head query is pinned. All other RPC calls retain their
    // original parameters, so the reader's own snapshot/hash guards remain in force.
    const pinnedTransport = expectedTag === null ? transport : async (method, params, signal) => { const value = await transport(method, method === 'eth_blockNumber' ? [] : params, signal); return method === 'eth_blockNumber' ? expectedTag : value; };
    const reader = await factory({ transport: pinnedTransport, profile, chainId: profile.canonicalChainId, marketplace: profile.marketplace, vault: profile.vault, toBlockTag: expectedTag });
    if (!reader || typeof reader.read !== 'function' || reader.verify === true || typeof reader.attest === 'function') throw new Error('indexer reader attestation failed');
    const snapshot = await reader.read();
    if (!snapshot || snapshot.chainId !== profile.canonicalChainId || typeof snapshot.blockTag !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(snapshot.blockTag) || typeof snapshot.blockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(snapshot.blockHash) || !/^0x[0-9a-fA-F]{64}$/.test(snapshot.hashes?.marketplaceNormalized ?? '') || !/^0x[0-9a-fA-F]{64}$/.test(snapshot.hashes?.vaultNormalized ?? '')) throw new Error('indexer reader attestation failed');
    if (expectedBlockNumber !== null && parseQty(snapshot.blockTag, 'snapshot block tag') !== expectedBlockNumber) throw new Error('indexer reader attestation failed');
    return snapshot;
  }
  async function syncOnce() {
    budgetStart = started();
    const currentBefore = await store.cursor();
    try {
      const chain = parseQty(await rpc('eth_chainId'), 'chain id');
      if (chain !== profile.canonicalChainId) throw new Error('chain mismatch');
      const final = await finalHead();
      const current = await store.cursor();
      health = { ...health, finalityMode: final.tag, buffer: final.tag === 'confirmations' ? confirmations : 0, cursor: current, head: final.head == null ? null : final.head.toString(), safeHead: final.number.toString() };
      let reorgAncestor = null;
      if (current) {
        const currentBlock = await rpc('eth_getBlockByNumber', [hexQty(BigInt(current.blockNumber)), false]);
        if (!currentBlock?.hash || hash(currentBlock.hash, 'cursor block hash') !== current.blockHash) {
          const canonical = await store.canonicalBlocks();
          const candidates = canonical.filter((row) => row.canonical !== false && BigInt(row.block_number) <= BigInt(current.blockNumber)).sort((a, b) => Number(BigInt(b.block_number) - BigInt(a.block_number))).slice(0, 33);
          for (const row of candidates) {
            const n = BigInt(row.block_number);
            if (BigInt(current.blockNumber) - n > 32n) continue;
            const rpcBlock = await rpc('eth_getBlockByNumber', [hexQty(n), false]);
            if (rpcBlock?.hash && hash(rpcBlock.hash, 'ancestor hash') === String(row.block_hash).toLowerCase()) { reorgAncestor = { blockNumber: n.toString(), blockHash: String(row.block_hash).toLowerCase() }; break; }
          }
          if (!reorgAncestor) throw new Error('reorg exceeds maximum depth or no common ancestor');
        }
      }
      if (current && !reorgAncestor && BigInt(current.blockNumber) >= final.number) {
        await attest(final.number);
        health = { ...health, status: 'healthy', indexedBlock: current.blockNumber, indexedHash: current.blockHash, lag: Number(final.number - BigInt(current.blockNumber)), lastSyncedAt: new Date().toISOString(), stale: false, gap: null, code: null, reason: null };
        return { status: 'healthy', cursor: current, finality: final, headers: 0, events: 0 };
      }
      let anchor = current;
      if (!anchor) {
        const supplied = initialAnchor;
        const configuredAnchor = profile.initialAnchor?.blockNumber ?? 0;
        const suppliedAnchor = supplied?.blockNumber ?? configuredAnchor;
        if (supplied && String(supplied.blockNumber) !== String(configuredAnchor)) throw new Error('initial anchor mismatch');
        const anchorBlock = await rpc('eth_getBlockByNumber', [hexQty(suppliedAnchor), false]);
        if (!anchorBlock?.hash) throw new Error('invalid initial anchor');
        const anchorHash = hash(anchorBlock.hash, 'initial anchor hash');
        if (supplied && anchorHash !== hash(supplied.blockHash, 'initial anchor hash')) throw new Error('initial anchor mismatch');
        anchor = { blockNumber: String(suppliedAnchor), blockHash: anchorHash };
      }
      let from = reorgAncestor ? BigInt(reorgAncestor.blockNumber) + 1n : BigInt(anchor.blockNumber) + 1n; let totalHeaders = 0; let totalEvents = 0; let batches = 0; let expectedCursorForBatch = current;
      while (from <= final.number && batches < maxBatches) {
        const to = from + BigInt(batchSize) - 1n > final.number ? final.number : from + BigInt(batchSize) - 1n;
        const headers = await readHeaders(from, to); const events = await readLogs(from, to); await verifyCompleteness(headers, events);
        const snapshot = await attest(to);
        if (hash(snapshot.blockHash, 'snapshot block hash') !== headers.at(-1).blockHash) throw new Error('projection source block mismatch');
        const prepared = await prepareV2Projection({ snapshot, events, profile, canonicalHistory: reorgAncestor ? (await store.rawEvents()).filter((e) => e.canonical !== false && BigInt(e.block_number) <= BigInt(reorgAncestor.blockNumber)).map((e) => ({ stream: e.stream, emitter: e.emitter, blockNumber: String(e.block_number), blockHash: String(e.block_hash), transactionHash: String(e.transaction_hash), transactionIndex: Number(e.transaction_index), logIndex: Number(e.log_index), topics: e.topics, data: e.data, decoded: e.decoded, eventName: e.event_name })) : null, chainId: Number(profile.canonicalChainId), marketplace: profile.marketplace, trustedFixedConfig: { chainId: Number(profile.canonicalChainId), marketplace: profile.marketplace } });
        // Recheck the pinned source immediately before opening the atomic store
        // transaction. The original cursor is also passed as the store CAS.
        const sourceBlock = await rpc('eth_getBlockByNumber', [hexQty(to), false]);
        if (!sourceBlock?.hash || hash(sourceBlock.hash, 'source block hash') !== headers.at(-1).blockHash) throw new Error('projection source block changed');
        const projectorWithPrepared = (tx, context) => project(tx, { ...context, prepared, rebuild: Boolean(reorgAncestor && batches === 0) });
        await store.applyBatch({ expectedCursor: expectedCursorForBatch ?? undefined, reorgAncestor: reorgAncestor && batches === 0 ? reorgAncestor : undefined, initialVerifiedAnchor: !expectedCursorForBatch && batches === 0 ? anchor : undefined, headers, events, projector: projectorWithPrepared });
        expectedCursorForBatch = { blockNumber: headers.at(-1).blockNumber, blockHash: headers.at(-1).blockHash };
        totalHeaders += headers.length; totalEvents += events.length; batches += 1; from = to + 1n;
      }
      const cursor = await store.cursor();
      const catchingUp = from <= final.number;
      const gap = catchingUp ? { from: from.toString(), to: final.number.toString(), reason: 'pending_verified_range' } : null;
      health = { ...health, status: catchingUp ? 'catching_up' : 'healthy', cursor, indexedBlock: cursor?.blockNumber ?? null, indexedHash: cursor?.blockHash ?? null, lag: cursor ? Number(final.number - BigInt(cursor.blockNumber)) : null, lastSyncedAt: new Date().toISOString(), stale: catchingUp, gap, code: null, reason: null };
      return { status: health.status, cursor, finality: final, headers: totalHeaders, events: totalEvents };
    } catch (error) {
      const failedFrom = currentBefore ? (BigInt(currentBefore.blockNumber) + 1n).toString() : null;
      health = { ...health, status: 'degraded', reason: 'indexer sync failed', code: 'INDEXER_RPC_FAILED', stale: true, cursor: currentBefore, gap: failedFrom ? { from: failedFrom, to: null, reason: 'pending_verified_range' } : null, lastFailedRange: failedFrom ? { from: failedFrom } : null };
      return { status: 'degraded', cursor: currentBefore, error: safeError() };
    } finally { budgetStart = null; }
  }
  return Object.freeze({ syncOnce, health: () => ({ ...health }) });
}

export const createIndexer = createV2Indexer;
