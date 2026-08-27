const { SigningKey, Wallet } = require("ethers");

const PRIVATE_KEY_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/;
const SECP256K1_ORDER = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

function normalizePrivateKey(raw) {
  if (typeof raw !== "string" || !PRIVATE_KEY_PATTERN.test(raw)) {
    throw new Error(
      "PRIVATE_KEY must be exactly 64 hexadecimal characters, with an optional 0x prefix; its value is never logged.",
    );
  }

  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  const scalar = BigInt(normalized);
  if (scalar === 0n || scalar >= SECP256K1_ORDER) {
    throw new Error(
      "PRIVATE_KEY has the correct length but is outside the valid secp256k1 scalar range; its value is never logged.",
    );
  }
  try {
    new SigningKey(normalized);
  } catch {
    throw new Error(
      "PRIVATE_KEY has the correct length but is not a valid secp256k1 private key; its value is never logged.",
    );
  }
  return normalized;
}

function assertSufficientDeploymentBalance({
  balance,
  estimatedGas,
  maxFeePerGas,
  safetyMultiplier = 2n,
}) {
  const estimatedCost = estimatedGas * maxFeePerGas;
  const required = estimatedCost * safetyMultiplier;
  if (balance < required) {
    throw new Error(
      `Insufficient deployer native balance: need at least ${required} wei for the deployment estimate and safety reserve, have ${balance} wei. No transaction was sent.`,
    );
  }
  return { estimatedCost, required };
}

async function runDeploymentPreflight({
  provider,
  factory,
  constructorArgs,
  expectedChainId,
  rawPrivateKey,
}) {
  // Validate the secret before the first RPC request. Never print or return it.
  const normalizedPrivateKey = normalizePrivateKey(rawPrivateKey);
  const wallet = new Wallet(normalizedPrivateKey);

  const network = await provider.getNetwork();
  if (network.chainId !== expectedChainId) {
    throw new Error(
      `RPC chainId ${network.chainId} does not match expected Arc Testnet chainId ${expectedChainId}. No transaction was sent.`,
    );
  }
  const blockNumber = await provider.getBlockNumber();
  const balance = await provider.getBalance(wallet.address);
  const deployRequest = await factory.getDeployTransaction(...constructorArgs);
  const estimatedGas = await provider.estimateGas({
    ...deployRequest,
    from: wallet.address,
  });
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (maxFeePerGas == null) {
    throw new Error("RPC did not return gas pricing. No transaction was sent.");
  }
  const costs = assertSufficientDeploymentBalance({
    balance,
    estimatedGas,
    maxFeePerGas,
  });

  return {
    chainId: network.chainId,
    blockNumber,
    deployerAddress: wallet.address,
    balance,
    estimatedGas,
    maxFeePerGas,
    ...costs,
  };
}

module.exports = {
  normalizePrivateKey,
  assertSufficientDeploymentBalance,
  runDeploymentPreflight,
};
