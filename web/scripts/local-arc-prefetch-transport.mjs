const MAX_BLOCKS = 20;
const HEX_QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;

function blockNumber(method, params) {
  if (!['eth_getBlockByNumber', 'eth_getBlockReceipts'].includes(method) || !Array.isArray(params) || !HEX_QUANTITY.test(String(params[0]))) return null;
  if (method === 'eth_getBlockByNumber' && params[1] !== false) return null;
  return BigInt(params[0]);
}

export function createLocalArcPrefetchTransport({ transport, batchTransport, maxBlocks = MAX_BLOCKS, historicalCeiling = null, onFailure = () => {} } = {}) {
  if (typeof transport !== 'function' || typeof batchTransport !== 'function') throw new TypeError('prefetch transport requires transports');
  if (!Number.isSafeInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > MAX_BLOCKS) throw new TypeError('invalid prefetch block cap');
  let ceiling = historicalCeiling === null ? null : BigInt(historicalCeiling);
  const cache = new Map(); const consumed = new Set();
  let generation = 0; let queue = Promise.resolve(); let watchedSignal = null; let listener = null;
  const clear = () => {
    generation += 1; cache.clear(); consumed.clear();
    if (watchedSignal && listener) watchedSignal.removeEventListener('abort', listener);
    watchedSignal = null; listener = null;
  };
  const observe = (method, params, result) => {
    const number = method === 'eth_blockNumber' ? result : method === 'eth_getBlockByNumber' && ['latest', 'finalized', 'safe'].includes(params[0]) ? result?.number : null;
    if (typeof number === 'string' && HEX_QUANTITY.test(number)) ceiling = BigInt(number);
    return result;
  };
  const prefetch = async (start, signal) => {
    signal?.throwIfAborted();
    const token = generation; const remaining = ceiling - start;
    const count = remaining < BigInt(maxBlocks) ? Number(remaining) : maxBlocks;
    const requests = [];
    for (let i = 0; i < count; i += 1) requests.push({ method: 'eth_getBlockByNumber', params: [`0x${(start + BigInt(i)).toString(16)}`, false] });
    for (let i = 0; i < count; i += 1) requests.push({ method: 'eth_getBlockReceipts', params: [`0x${(start + BigInt(i)).toString(16)}`] });
    if (signal && watchedSignal !== signal) {
      if (watchedSignal && listener) watchedSignal.removeEventListener('abort', listener);
      watchedSignal = signal; listener = clear;
      signal.addEventListener('abort', listener, { once: true });
    }
    const results = await batchTransport(requests, signal);
    signal?.throwIfAborted();
    if (token !== generation) throw new Error('stale RPC prefetch generation');
    if (!Array.isArray(results) || results.length !== count * 2) throw new Error('invalid RPC prefetch cardinality');
    const next = new Map();
    for (let i = 0; i < count; i += 1) {
      const header = results[i]; const receipts = results[count + i]; const height = start + BigInt(i);
      if (!header || typeof header !== 'object' || !Array.isArray(header.transactions) || BigInt(header.number) !== height || !Array.isArray(receipts)) throw new Error('invalid RPC prefetch result');
      for (const [method, value] of [['eth_getBlockByNumber', header], ['eth_getBlockReceipts', receipts]]) {
        const key = `${method}:${height}`;
        if (!consumed.has(key)) next.set(key, value);
      }
    }
    cache.clear(); // retain only one bounded historical window
    for (const [key, value] of next) cache.set(key, value);
  };
  const run = async (method, params, signal) => {
    try {
      signal?.throwIfAborted();
      const height = blockNumber(method, params);
      if (height === null || ceiling === null || height >= ceiling) return observe(method, params, await transport(method, params, signal));
      const key = `${method}:${height}`;
      if (consumed.has(key)) return await transport(method, params, signal); // freshness/reorg barrier
      if (!cache.has(key)) await prefetch(height, signal);
      signal?.throwIfAborted();
      if (!cache.has(key)) throw new Error('missing RPC prefetch result');
      const result = cache.get(key); cache.delete(key); consumed.add(key);
      if (consumed.size > 4096) clear();
      return result;
    } catch (error) { clear(); onFailure(error); throw error; }
  };
  const wrapped = (method, params = [], signal) => {
    const result = queue.then(() => run(method, params, signal));
    queue = result.catch(() => {});
    return result;
  };
  wrapped.clear = clear;
  return wrapped;
}

export const LOCAL_ARC_PREFETCH_MAX_BLOCKS = MAX_BLOCKS;