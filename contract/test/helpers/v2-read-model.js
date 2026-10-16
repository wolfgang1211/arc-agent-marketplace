const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Derive the read model from the compiler output; never trust a hand-written slot map.
const artifactRoot = process.env.V2_ARTIFACTS || "./artifacts-v2-runs50";
const infoDir = path.resolve(__dirname, "../..", artifactRoot, "build-info");
const infoPath = fs.readdirSync(infoDir).map((f) => path.join(infoDir, f)).find((f) => {
  const j = JSON.parse(fs.readFileSync(f, "utf8")); return !!j.output?.contracts?.["contracts/AgentMarketplaceV2.sol"]?.AgentMarketplaceV2?.storageLayout;
});
const layout = JSON.parse(fs.readFileSync(infoPath, "utf8")).output.contracts["contracts/AgentMarketplaceV2.sol"].AgentMarketplaceV2.storageLayout;
const jobsEntry = layout.storage.find((x) => x.label === "jobs");
const JOB_SLOT = BigInt(jobsEntry.slot);
const primitive = (type) => {
  if (type.startsWith("t_address")) return "address";
  if (type.startsWith("t_bool")) return "bool";
  if (type.startsWith("t_bytes32")) return "bytes32";
  const m = type.match(/t_(?:u?int)(\d+)/); if (m) return `uint${m[1]}`;
  if (type.startsWith("t_enum")) return "uint8";
  throw new Error(`unsupported storage type ${type}`);
};
const jobType = layout.types[layout.types[jobsEntry.type].value];
const FIELDS = jobType.members.map((m) => [m.label, Number(m.slot), Number(m.offset), primitive(m.type)]);
if (!FIELDS.some(([name]) => name === "resolver")) throw new Error("invalid AgentMarketplaceV2 storage layout");
const MASK = (bits) => (1n << BigInt(bits)) - 1n;
const readField = (word, offset, type) => {
  if (type === "bytes32") return ethers.zeroPadValue(ethers.toBeHex(word), 32);
  const bits = type === "address" ? 160 : type === "bool" ? 8 : Number(type.slice(4));
  const n = (word >> BigInt(offset * 8)) & MASK(bits);
  if (type === "address") return ethers.getAddress(ethers.zeroPadValue(ethers.toBeHex(n), 20));
  if (type === "bool") return n !== 0n;
  return n;
};
const mappingSlot = (id) => BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [id, JOB_SLOT])));

async function decodeJob(contract, id, blockTag = "latest") {
  const provider = contract.runner.provider;
  const base = mappingSlot(id);
  const words = new Map();
  const word = async (slot) => {
    if (!words.has(slot)) words.set(slot, BigInt(await provider.getStorage(await contract.getAddress(), base + BigInt(slot), blockTag)));
    return words.get(slot);
  };
  const out = {};
  for (const [name, slot, offset, type] of FIELDS) out[name] = readField(await word(slot), offset, type);
  return out;
}

function wrapMarket(contract) {
  if (contract.__v2ReadModel) return contract;
  const proxy = new Proxy(contract, {
    get(target, prop, receiver) {
      if (prop === "__v2ReadModel") return true;
      if (prop === "getJob") return (id, overrides) => decodeJob(target, id, overrides?.blockTag ?? "latest");
      if (prop === "canonicalTermsHash") return async (id, overrides) => (await decodeJob(target, id, overrides?.blockTag ?? "latest")).canonicalTermsHash;
      if (prop === "freeStake") return async (operator) => { const v = new ethers.Contract(await target.collateralVault(), ["function freeStake(address) view returns (uint256)"], target.runner.provider); return v.freeStake(operator); };
      if (prop === "reservedStake") return async (operator) => { const v = new ethers.Contract(await target.collateralVault(), ["function reservedStake(address) view returns (uint256)"], target.runner.provider); return v.reservedStake(operator); };
      if (prop === "stakeLiability") return async () => { const v = new ethers.Contract(await target.collateralVault(), ["function stakeLiability() view returns (uint256)"], target.runner.provider); return v.stakeLiability(); };
      if (prop === "requiredStake") return async (reward) => { const v = new ethers.Contract(await target.collateralVault(), ["function requiredStake(uint256) view returns (uint256)"], target.runner.provider); return v.requiredStake(reward); };
      if (prop === "applicationDigest") return async (t) => {
        const net = await target.runner.provider.getNetwork();
        return ethers.TypedDataEncoder.hash(
          { name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: net.chainId, verifyingContract: await target.getAddress() },
          { Application: [
            { name: "jobId", type: "uint256" }, { name: "operator", type: "address" }, { name: "termsHash", type: "bytes32" },
            { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" }, { name: "operatorNonce", type: "uint256" },
          ] }, t);
      };
      if (prop === "liabilities") return async () => target.creditsLiability();
      if (prop === "surplus") return async () => {
        const token = new ethers.Contract(await target.usdc(), ["function balanceOf(address) view returns (uint256)"], target.runner.provider);
        const v = new ethers.Contract(await target.collateralVault(), ["function stakeLiability() view returns (uint256)"], target.runner.provider);
        return (await token.balanceOf(await target.getAddress())) - ((await target.creditsLiability()) + (await target.escrowed()));
      };
      if (prop === "connect") return (...args) => wrapMarket(target.connect(...args));
      return Reflect.get(target, prop, receiver);
    },
  });
  return proxy;
}

module.exports = { wrapMarket, decodeJob };
