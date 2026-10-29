import { getAddress, isAddress } from 'viem';

const ARC_CHAIN_ID = 5042002n;
const LOCAL_CHAIN_ID = 31337n;
const ARC_RPC_URL = 'https://rpc.testnet.arc.io';
const LOCAL_RPC_URL = 'http://127.0.0.1:8545';
const ARC_MARKETPLACE = '0xFA156B7A5205B123c8a22A807ba98405e36130f1';
const ARC_VAULT = '0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423';
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const ARC_TREASURY = '0xd520bee785a4b6bea15c94f20f640aaad00088ab';
const LOCAL_MANIFEST_PATH = null; // The Node-only loader resolves the user's scratch directory.
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function address(value, label) { if (typeof value !== 'string' || !ADDRESS.test(value) || !isAddress(value)) throw new TypeError(`${label} must be an address`); return getAddress(value); }
function hash(value, label) { if (typeof value !== 'string' || !HASH.test(value)) throw new TypeError(`${label} must be a 32-byte hash`); return value.toLowerCase(); }
function uint(value, label) { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a safe integer`); return value; }
function envValue(env, key) { return env && Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined; }
function localRequested(env) { return envValue(env, 'V2_CHAIN_PROFILE') === 'local-hardhat'; }
function hasVercel(env) { return Boolean(envValue(env, 'VERCEL') || envValue(env, 'VERCEL_ENV') || envValue(env, 'VERCEL_URL')); }

export const ARC_TESTNET_PROFILE = freeze({
  id: 'arc-testnet', name: 'arc-testnet', chainId: ARC_CHAIN_ID, canonicalChainId: ARC_CHAIN_ID, rpcUrl: ARC_RPC_URL,
  marketplace: address(ARC_MARKETPLACE, 'marketplace'), vault: address(ARC_VAULT, 'vault'), usdc: address(ARC_USDC, 'usdc'), treasury: address(ARC_TREASURY, 'treasury'),
  deployBlocks: freeze({ marketplace: 68072744, vault: 68072734 }),
  initialAnchor: freeze({ blockNumber: 68072733, blockHash: null }),
  eip712: freeze({ name: 'AlphaBoard Agent Marketplace V2', version: '1', chainId: ARC_CHAIN_ID, verifyingContract: address(ARC_MARKETPLACE, 'marketplace') }),
  authDomain: 'AlphaBoard V2', localTestConfig: null,
});

function localProfile(manifest) {
  if (!manifest || manifest.chainId !== '31337' || manifest.rpcUrl !== LOCAL_RPC_URL) throw new Error('invalid local V2 manifest witness');
  const pair = manifest.pair ?? {}, runtime = manifest.runtime ?? {};
  const marketplace = address(pair.market, 'local marketplace'); const vault = address(pair.vault, 'local vault'); const usdc = address(pair.token, 'local usdc'); const treasury = address(pair.treasury, 'local treasury');
  if (runtime.market?.address?.toLowerCase() !== marketplace.toLowerCase() || runtime.vault?.address?.toLowerCase() !== vault.toLowerCase()) throw new Error('local manifest pair mismatch');
  if (runtime.market?.bytes !== 23908 || runtime.vault?.bytes !== 4854) throw new Error('local manifest runtime length mismatch');
  const deployments = manifest.deployments ?? [];
  const deployment = (name) => deployments.find((row) => row?.name === name)?.blockNumber;
  const vaultBlock = uint(deployment('OperatorCollateralVaultV2'), 'local vault deployment'); const marketBlock = uint(deployment('AgentMarketplaceV2'), 'local marketplace deployment');
  if (vaultBlock === undefined || marketBlock === undefined) throw new Error('local deployment witness missing');
  const anchor = manifest.anchorBlock ?? {};
  const anchorNumber = uint(anchor.number, 'local anchor number');
  if (anchorNumber < Math.max(vaultBlock, marketBlock)) throw new Error('local anchor precedes deployment');
  hash(anchor.hash, 'local anchor hash');
  const normalized = { marketplace: runtime.market?.normalizedHash, vault: runtime.vault?.normalizedHash };
  if (normalized.marketplace !== undefined && !HASH.test(normalized.marketplace)) throw new Error('invalid local marketplace normalized hash');
  if (normalized.vault !== undefined && !HASH.test(normalized.vault)) throw new Error('invalid local vault normalized hash');
  return freeze({ id: 'local-hardhat', name: 'local-hardhat', chainId: LOCAL_CHAIN_ID, canonicalChainId: LOCAL_CHAIN_ID, rpcUrl: LOCAL_RPC_URL, marketplace, vault, usdc, treasury,
    deployBlocks: freeze({ marketplace: marketBlock, vault: vaultBlock }), initialAnchor: freeze({ blockNumber: 0, blockHash: null }),
    proofAnchor: freeze({ blockNumber: anchorNumber, blockHash: hash(anchor.hash, 'local anchor hash') }),
    runtime: freeze({ marketplace: freeze({ bytes: runtime.market.bytes, rawHash: hash(runtime.market.rawHash, 'local marketplace raw hash'), ...(normalized.marketplace ? { normalizedHash: normalized.marketplace.toLowerCase() } : {}) }), vault: freeze({ bytes: runtime.vault.bytes, rawHash: hash(runtime.vault.rawHash, 'local vault raw hash'), ...(normalized.vault ? { normalizedHash: normalized.vault.toLowerCase() } : {}) }) }),
    eip712: freeze({ name: 'AlphaBoard Agent Marketplace V2', version: '1', chainId: LOCAL_CHAIN_ID, verifyingContract: marketplace }), authDomain: 'AlphaBoard V2 Local',
    localTestConfig: freeze({ token: usdc, treasury, roles: freeze({ ...(manifest.roles ?? {}) }) }),
  });
}

export function assertV2Profile(profile) {
  if (!profile || (profile.name !== 'arc-testnet' && profile.name !== 'local-hardhat')) throw new TypeError('invalid V2 profile');
  if (typeof profile.canonicalChainId !== 'bigint' || !/^https?:\/\//.test(profile.rpcUrl) || !isAddress(profile.marketplace) || !isAddress(profile.vault) || !isAddress(profile.usdc) || !isAddress(profile.treasury)) throw new TypeError('invalid V2 profile');
  if (profile.name === 'local-hardhat' && profile.rpcUrl !== LOCAL_RPC_URL) throw new TypeError('invalid local V2 RPC');
  if (profile.name === 'local-hardhat' && profile.canonicalChainId !== LOCAL_CHAIN_ID) throw new TypeError('invalid local V2 chain');
  if (profile.name === 'arc-testnet' && (profile.canonicalChainId !== ARC_CHAIN_ID || profile.marketplace.toLowerCase() !== ARC_MARKETPLACE.toLowerCase() || profile.vault.toLowerCase() !== ARC_VAULT.toLowerCase())) throw new TypeError('invalid Arc V2 profile');
  for (const key of ['marketplace', 'vault']) uint(profile.deployBlocks?.[key], `deployBlocks.${key}`);
  uint(profile.initialAnchor?.blockNumber, 'initialAnchor.blockNumber');
  if (profile.initialAnchor.blockHash !== null && !HASH.test(profile.initialAnchor.blockHash)) throw new TypeError('invalid initial anchor hash');
  if (!profile.eip712 || profile.eip712.chainId !== profile.canonicalChainId || profile.eip712.verifyingContract.toLowerCase() !== profile.marketplace.toLowerCase()) throw new TypeError('invalid EIP712 profile');
  return profile;
}
export function assertV2ProfileEnvironment(env = {}) { if (localRequested(env) && (env.NODE_ENV === 'production' || hasVercel(env))) throw new Error('local V2 profile is forbidden in production/Vercel'); return env; }
export function resolveV2ChainProfile({ env = (typeof process !== 'undefined' ? process.env : {}), localManifest } = {}) {
  assertV2ProfileEnvironment(env);
  const selected = envValue(env, 'V2_CHAIN_PROFILE');
  if (selected !== undefined && selected !== 'arc-testnet' && selected !== 'local-hardhat') throw new Error('unknown V2_CHAIN_PROFILE');
  if (!localRequested(env)) return ARC_TESTNET_PROFILE;
  if (!localManifest) throw new Error('local V2 profile requires an explicit manifest');
  return assertV2Profile(localProfile(localManifest));
}
export function toPublicV2Profile(profile) { assertV2Profile(profile); return freeze({ id: profile.name, name: profile.name, chainId: profile.canonicalChainId.toString(), rpcUrl: profile.rpcUrl, marketplace: profile.marketplace, vault: profile.vault, usdc: profile.usdc, treasury: profile.treasury, deployBlocks: profile.deployBlocks, initialAnchor: profile.initialAnchor, eip712: { ...profile.eip712, chainId: profile.eip712.chainId.toString() }, authDomain: profile.authDomain }); }
export const V2_LOCAL_MANIFEST_PATH = LOCAL_MANIFEST_PATH;
export const V2_PROFILE_CONSTANTS = freeze({ ARC_CHAIN_ID, LOCAL_CHAIN_ID, LOCAL_RPC_URL });
