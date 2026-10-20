import { encodeAbiParameters, keccak256, stringToHex, isAddress } from 'viem';

export const V2_TERMS_SCHEMA = keccak256(stringToHex('AlphaBoard.AgentMarketplaceV2.JobTerms.v2'));
const ADDRESS = { type: 'address' };
const UINT = { type: 'uint256' };
const U64 = { type: 'uint64' };
const B32 = { type: 'bytes32' };
const BOOL = { type: 'bool' };
const TYPES = [ADDRESS, ADDRESS, ADDRESS, UINT, UINT, ADDRESS, UINT, U64, U64, U64, U64, UINT, UINT, UINT, B32, { type: 'uint8' }, BOOL, U64, B32, B32, BOOL];
const FIELDS = ['token','vault','resolver','reward','feeBps','treasury','minReward','deliveryDuration','reviewDuration','revisionDuration','maxExtensionTotal','stakeFloor','stakeRound','collateralBps','schema','revisionLimit','unlimitedRevisions','applyBy','criteriaHash','descriptionHash','testJob'];

function integer(value, name) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`);
  if (typeof value !== 'bigint' && typeof value !== 'number') throw new TypeError(`${name} must be an integer`);
  if (typeof value === 'number' && !Number.isInteger(value)) throw new TypeError(`${name} must be an integer`);
  const n = BigInt(value); if (n < 0n) throw new RangeError(`${name} must be non-negative`); return n;
}
function bytes32(value, name) { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TypeError(`${name} must be bytes32`); return value; }
function address(value, name) { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new TypeError(`${name} must be address`); if (/[a-f]/.test(value.slice(2)) && /[A-F]/.test(value.slice(2)) && !isAddress(value, { strict: true })) throw new TypeError(`${name} must use a valid checksum`); return value; }
export function canonicalTermsHash(terms) {
  if (!terms || typeof terms !== 'object') throw new TypeError('terms required');
  const values = FIELDS.map((field) => {
    const value = terms[field];
    if (['token','vault','resolver','treasury'].includes(field)) return address(value, field);
    if (['schema','criteriaHash','descriptionHash'].includes(field)) return bytes32(value, field);
    if (field === 'unlimitedRevisions' || field === 'testJob') { if (typeof value !== 'boolean') throw new TypeError(`${field} must be bool`); return value; }
    if (field === 'revisionLimit') { const n = integer(value, field); if (n > 255n) throw new RangeError(`${field} overflow`); return n; }
    const n = integer(value, field); if (['deliveryDuration','reviewDuration','revisionDuration','maxExtensionTotal','applyBy'].includes(field) && n > 0xffffffffffffffffn) throw new RangeError(`${field} overflow`); return n;
  });
  return keccak256(encodeAbiParameters(TYPES, values));
}
