import { decodeFunctionResult, encodeFunctionData, getAddress, hashMessage, verifyMessage } from 'viem';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const BLOCK = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const MAGIC = '0x1626ba7e';
const ERC1271_ABI = [{
  type: 'function', name: 'isValidSignature', stateMutability: 'view',
  inputs: [{ name: 'hash', type: 'bytes32' }, { name: 'signature', type: 'bytes' }],
  outputs: [{ name: 'magicValue', type: 'bytes4' }],
}];

function address(value, label = 'wallet') {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw new TypeError(`invalid ${label}`);
  try { return getAddress(value); } catch { throw new TypeError(`invalid ${label}`); }
}
function digest(value) { if (typeof value !== 'string' || !HASH.test(value)) throw new TypeError('invalid digest'); return value.toLowerCase(); }
function signature(value) { if (typeof value !== 'string' || !HEX.test(value)) throw new TypeError('invalid signature'); return value; }
function blockTag(value) { if (typeof value !== 'string' || !BLOCK.test(value)) throw new TypeError('invalid pinned block'); return value; }

export function createV2SignatureVerifier({ transport, readerFactory } = {}) {
  if (typeof transport !== 'function' || typeof readerFactory !== 'function') throw new TypeError('signature verifier requires transport and readerFactory');

  async function pinnedRead(requestedBlockTag) {
    const requested = requestedBlockTag === undefined ? undefined : blockTag(requestedBlockTag);
    const reader = await readerFactory(requested === undefined ? {} : { toBlockTag: requested });
    if (!reader || typeof reader.read !== 'function') throw new Error('signature reader unavailable');
    const snapshot = await reader.read();
    const pinned = blockTag(snapshot?.blockTag);
    if (requested !== undefined && pinned !== requested) throw new Error('signature snapshot changed');
    return pinned;
  }

  async function readSignatureAtPinned(operator, messageDigest, rawSignature, pinned, knownCode) {
    const wallet = address(operator, 'operator');
    const hash = digest(messageDigest);
    const sig = signature(rawSignature);
    let code = knownCode;
    if (code === undefined) try { code = await transport('eth_getCode', [wallet, pinned]); } catch { throw new Error('signature code unavailable'); }
    if (typeof code !== 'string' || !HEX.test(code)) throw new Error('signature code unavailable');
    if (code === '0x') return false;
    const data = encodeFunctionData({ abi: ERC1271_ABI, functionName: 'isValidSignature', args: [hash, sig] });
    let result;
    try { result = await transport('eth_call', [{ to: wallet, data }, pinned]); } catch { throw new Error('ERC1271 call failed'); }
    if (typeof result !== 'string' || !HEX.test(result)) throw new Error('ERC1271 call failed');
    let decoded;
    try { decoded = decodeFunctionResult({ abi: ERC1271_ABI, functionName: 'isValidSignature', data: result }); } catch { throw new Error('ERC1271 call failed'); }
    if (typeof decoded !== 'string') throw new Error('ERC1271 call failed');
    if (decoded.toLowerCase() !== MAGIC) throw new Error('ERC1271 invalid magic');
    return true;
  }

  async function readSignature(operator, messageDigest, rawSignature, requestedBlockTag) {
    const pinned = await pinnedRead(requestedBlockTag);
    return readSignatureAtPinned(operator, messageDigest, rawSignature, pinned);
  }

  async function verifyWalletSignature({ wallet, message, signature: rawSignature, blockTag: requestedBlockTag } = {}) {
    const operator = address(wallet);
    const sig = signature(rawSignature);
    const pinned = await pinnedRead(requestedBlockTag);
    let code;
    try { code = await transport('eth_getCode', [operator, pinned]); } catch { throw new Error('signature code unavailable'); }
    if (typeof code !== 'string' || !HEX.test(code)) throw new Error('signature code unavailable');
    if (code === '0x') {
      return (await verifyMessage({ address: operator, message, signature: sig })) === true;
    }
    return readSignatureAtPinned(operator, hashMessage(message), sig, pinned, code);
  }

  return Object.freeze({ verifyWalletSignature, readSignature });
}

export { MAGIC as ERC1271_MAGIC };
