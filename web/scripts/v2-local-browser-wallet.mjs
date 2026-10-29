// Browser-only EIP-1193 test wallet. Signing/broadcast requests go directly
// from the browser to the guarded, unlocked local Hardhat node, never our API.
import assert from 'node:assert/strict';

export async function installLocalTestWallet(context, configuration) {
  const { rpcUrl, marketplace, vault, usdc, roles, role = 'client' } = configuration;
  assert.equal(rpcUrl, 'http://127.0.0.1:8545');
  for (const address of [marketplace, vault, usdc, ...Object.values(roles)]) {
    assert.match(address, /^0x[0-9a-fA-F]{40}$/);
  }
  assert.ok(Object.hasOwn(roles, role));
  await context.addInitScript(({ rpcUrl, marketplace, vault, usdc, roles, role }) => {
    const actorAddresses = new Set(Object.values(roles).map((address) => address.toLowerCase()));
    const contractAddresses = new Set([marketplace, vault, usdc].map((address) => address.toLowerCase()));
    const readMethods = new Set([
      'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash',
      'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionCount',
      'eth_getCode', 'eth_getStorageAt', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
      'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBalance', 'eth_getLogs',
    ]);
    let activeRole = role;
    let nextId = 0;
    let reportedChain = null;
    let rejectNext = null;
    const listeners = new Map();
    const audit = [];
    const failure = (code, message, data) => Object.assign(new Error(message), { code, ...(data ? { data } : {}) });
    const account = () => roles[activeRole];
    const emit = (name, value) => { for (const listener of listeners.get(name) || []) listener(value); };
    async function rpc(method, params = []) {
      const response = await fetch(rpcUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }, (_, value) => typeof value === 'bigint' ? '0x' + value.toString(16) : value),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw failure(-32000, 'LOCAL_WALLET_RPC_UNAVAILABLE');
      const payload = await response.json();
      if (payload.error) {
        const raw = payload.error.data;
        const data = typeof raw === 'string' && /^0x[0-9a-fA-F]*$/.test(raw) ? raw : typeof raw?.data === 'string' && /^0x[0-9a-fA-F]*$/.test(raw.data) ? raw.data : undefined;
        throw failure(payload.error.code || -32000, 'LOCAL_WALLET_RPC_REVERT', data);
      }
      return payload.result;
    }
    async function assertActualLocalChain(checkReported = true) {
      if (BigInt(await rpc('eth_chainId')) !== 31337n) throw failure(4901, 'LOCAL_CHAIN_GUARD_FAILED');
      if (checkReported && reportedChain !== null && BigInt(reportedChain) !== 31337n) throw failure(4901, 'REPORTED_CHAIN_MISMATCH');
    }
    const provider = {
      isMetaMask: true,
      isConnected: () => true,
      on(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); return provider; },
      removeListener(name, listener) { listeners.get(name)?.delete(listener); return provider; },
      async request({ method, params = [] }) {
        if (rejectNext === method) { rejectNext = null; audit.push({ method, outcome: 'rejected' }); throw failure(4001, 'User rejected the request.'); }
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
          await assertActualLocalChain(false);
          return [account()];
        }
        if (method === 'eth_chainId') return reportedChain ?? rpc(method, params);
        if (method === 'net_version') return String(BigInt(reportedChain ?? await rpc('eth_chainId')));
        if (method === 'wallet_getPermissions' || method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (method === 'wallet_switchEthereumChain') {
          if (BigInt(params?.[0]?.chainId ?? 0) !== 31337n) throw failure(4902, 'ONLY_LOCAL_HARDHAT_IS_ALLOWED');
          await assertActualLocalChain();
          emit('chainChanged', '0x' + (31337n).toString(16));
          return null;
        }
        if (method === 'personal_sign') {
          await assertActualLocalChain();
          if (params.length !== 2 || String(params[1]).toLowerCase() !== account().toLowerCase() || !/^0x(?:[0-9a-fA-F]{2})*$/.test(params[0])) throw failure(-32602, 'INVALID_LOCAL_PERSONAL_SIGN');
          audit.push({ method, account: account() });
          return rpc(method, params);
        }
        if (method === 'eth_signTypedData_v4') {
          await assertActualLocalChain();
          if (String(params[0]).toLowerCase() !== account().toLowerCase()) throw failure(-32602, 'TYPED_DATA_ACCOUNT_MISMATCH');
          const typed = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
          if (BigInt(typed?.domain?.chainId ?? 0) !== 31337n || String(typed?.domain?.verifyingContract).toLowerCase() !== marketplace.toLowerCase()) throw failure(4901, 'TYPED_DATA_DOMAIN_MISMATCH');
          audit.push({ method, account: account(), primaryType: typed.primaryType });
          return rpc(method, [params[0], JSON.stringify(typed)]);
        }
        if (method === 'eth_sendTransaction') {
          await assertActualLocalChain();
          if (params.length !== 1) throw failure(-32602, 'SINGLE_LOCAL_TRANSACTION_REQUIRED');
          const transaction = params[0];
          if (!transaction || !actorAddresses.has(String(transaction.from).toLowerCase()) || String(transaction.from).toLowerCase() !== account().toLowerCase()) throw failure(-32602, 'LOCAL_SENDER_MISMATCH');
          if (!contractAddresses.has(String(transaction.to).toLowerCase())) throw failure(-32602, 'LOCAL_TARGET_NOT_ALLOWED');
          if (BigInt(transaction.value || 0) !== 0n) throw failure(-32602, 'NONZERO_VALUE_NOT_ALLOWED');
          if (transaction.chainId !== undefined && BigInt(transaction.chainId) !== 31337n) throw failure(4901, 'TRANSACTION_CHAIN_MISMATCH');
          if (!/^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{2})*$/.test(transaction.data || '')) throw failure(-32602, 'LOCAL_CALLDATA_REQUIRED');
          const hash = await rpc(method, params);
          if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw failure(-32000, 'INVALID_LOCAL_TRANSACTION_HASH');
          audit.push({ method, from: transaction.from, to: transaction.to, selector: transaction.data.slice(0, 10), hash });
          return hash;
        }
        if (!readMethods.has(method)) throw failure(4200, 'LOCAL_WALLET_METHOD_NOT_ALLOWED');
        if ((method === 'eth_call' || method === 'eth_estimateGas') && !contractAddresses.has(String(params?.[0]?.to).toLowerCase())) throw failure(-32602, 'LOCAL_SIMULATION_TARGET_NOT_ALLOWED');
        return rpc(method, params);
      },
    };
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: false });
    Object.defineProperty(window, '__v2LocalTestWallet', {
      value: Object.freeze({
        audit: () => audit.map((entry) => ({ ...entry })),
        setRole(nextRole) {
          if (!Object.hasOwn(roles, nextRole)) throw failure(-32602, 'UNKNOWN_TEST_ROLE');
          activeRole = nextRole;
          emit('accountsChanged', [account()]);
        },
        reportWrongNetwork(enabled) { reportedChain = enabled ? '0x1' : null; emit('chainChanged', reportedChain ?? '0x' + (31337n).toString(16)); },
        rejectNextRequest(method) {
          if (!['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'].includes(method)) throw failure(-32602, 'INVALID_REJECTION_METHOD');
          rejectNext = method;
        },
      }),
      configurable: false,
    });
  }, { rpcUrl, marketplace, vault, usdc, roles, role });
}

export async function localWalletAudit(page) {
  return page.evaluate(() => window.__v2LocalTestWallet.audit());
}
