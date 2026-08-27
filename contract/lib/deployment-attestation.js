const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  AbiCoder,
  Interface,
  getAddress,
  hexlify,
  keccak256,
  toBeHex,
  zeroPadValue,
} = require("ethers");

const CONTRACT_SOURCE = "contracts/AgentMarketplace.sol";
const CONTRACT_NAME = "AgentMarketplace";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function rawBytecodeIdentity(bytecode, label = "bytecode") {
  assert.match(bytecode, /^0x(?:[0-9a-fA-F]{2})*$/, `${label} is not valid 0x-prefixed bytecode`);
  return {
    rawByteLength: (bytecode.length - 2) / 2,
    keccak256: keccak256(bytecode),
  };
}

function loadCompilerMetadata(root) {
  const directory = path.join(root, "artifacts", "build-info");
  const candidates = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(directory, name));

  for (const candidate of candidates) {
    const buildInfo = readJson(candidate);
    const contract = buildInfo.output?.contracts?.[CONTRACT_SOURCE]?.[CONTRACT_NAME];
    const source = buildInfo.output?.sources?.[CONTRACT_SOURCE];
    if (contract && source?.ast) {
      return {
        abi: contract.abi,
        ast: source.ast,
        deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
        immutableReferences: contract.evm.deployedBytecode.immutableReferences ?? {},
      };
    }
  }
  throw new Error(`No build-info entry found for ${CONTRACT_SOURCE}:${CONTRACT_NAME}`);
}

function collectImmutableVariables(ast) {
  const variables = new Map();

  function visit(node) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (node.nodeType === "VariableDeclaration" && node.mutability === "immutable") {
      variables.set(String(node.id), {
        id: String(node.id),
        name: node.name,
        type: node.typeDescriptions?.typeString,
        visibility: node.visibility,
      });
    }
    Object.values(node).forEach(visit);
  }

  visit(ast);
  return variables;
}

function flattenImmutableReferences(immutableReferences) {
  return Object.entries(immutableReferences)
    .flatMap(([id, references]) => references.map(({ start, length }) => ({ id, start, length })))
    .sort((a, b) => a.start - b.start);
}

function normalizeBytecode(bytecode, immutableReferences) {
  const bytes = Buffer.from(bytecode.slice(2), "hex");
  for (const { start, length } of flattenImmutableReferences(immutableReferences)) {
    bytes.fill(0, start, start + length);
  }
  return hexlify(bytes);
}

function encodeImmutableValue(type, value, length) {
  const encoded = AbiCoder.defaultAbiCoder().encode([type], [value]);
  const encodedBytes = (encoded.length - 2) / 2;
  assert.ok(length <= encodedBytes, `Immutable ${type} does not fit ${length} bytes`);
  return zeroPadValue(toBeHex(BigInt(encoded)), length);
}

function patchExpectedRuntime(template, immutableReferences, valuesById) {
  const bytes = Buffer.from(template.slice(2), "hex");
  for (const { id, start, length } of flattenImmutableReferences(immutableReferences)) {
    const encoded = valuesById.get(id);
    assert.ok(encoded, `Missing encoded value for immutable AST id ${id}`);
    const valueBytes = Buffer.from(encoded.slice(2), "hex");
    assert.equal(valueBytes.length, length, `Immutable AST id ${id} has the wrong encoded length`);
    valueBytes.copy(bytes, start);
  }
  return hexlify(bytes);
}

function assertRecordedTemplate(identity, metadata) {
  const variables = collectImmutableVariables(metadata.ast);
  assert.ok(variables.size > 0, "Contract AST contains no immutable variables");
  assert.equal(
    Object.keys(metadata.immutableReferences).length,
    variables.size,
    "Compiler immutableReferences must cover every immutable variable",
  );
  const templateIdentity = rawBytecodeIdentity(metadata.deployedBytecode, "compiler deployed bytecode");
  assert.deepEqual(
    templateIdentity,
    identity.build.deployedBytecode,
    "Clean compiler deployed bytecode does not match ARTIFACT-IDENTITY.json",
  );

  const normalized = rawBytecodeIdentity(
    normalizeBytecode(metadata.deployedBytecode, metadata.immutableReferences),
    "normalized deployed bytecode",
  );
  assert.deepEqual(
    normalized,
    identity.deploymentAttestation.normalizedDeployedBytecode,
    "Compiler immutable-normalized identity does not match ARTIFACT-IDENTITY.json",
  );
}

async function attestDeployment({ provider, address, root, identityPath }) {
  const identity = readJson(identityPath);
  const metadata = loadCompilerMetadata(root);
  assertRecordedTemplate(identity, metadata);

  const checkedAddress = getAddress(address);
  const chainId = (await provider.send("eth_chainId", [])).toLowerCase();
  assert.equal(
    chainId,
    identity.deploymentAttestation.expectedChainId.toLowerCase(),
    `Unexpected chainId ${chainId}; address rejected`,
  );

  const observedCode = (await provider.send("eth_getCode", [checkedAddress, "latest"])).toLowerCase();
  assert.notEqual(observedCode, "0x", "Address has no deployed code; address rejected");
  const observedIdentity = rawBytecodeIdentity(observedCode, "eth_getCode result");
  assert.equal(
    observedIdentity.rawByteLength,
    identity.build.deployedBytecode.rawByteLength,
    `Deployed byte length mismatch; address rejected`,
  );

  const variables = collectImmutableVariables(metadata.ast);
  const iface = new Interface(metadata.abi);
  const valuesById = new Map();
  const immutableValues = {};

  for (const id of Object.keys(metadata.immutableReferences)) {
    const variable = variables.get(id);
    assert.ok(variable, `No AST variable found for immutable id ${id}`);
    assert.equal(variable.visibility, "public", `Immutable ${variable.name} must have a public getter`);
    const fragment = iface.getFunction(variable.name);
    assert.ok(fragment && fragment.inputs.length === 0, `Immutable ${variable.name} needs a no-argument getter`);
    const result = await provider.send("eth_call", [
      { to: checkedAddress, data: iface.encodeFunctionData(fragment) },
      "latest",
    ]);
    const value = iface.decodeFunctionResult(fragment, result)[0];
    valuesById.set(
      id,
      encodeImmutableValue(fragment.outputs[0].type, value, metadata.immutableReferences[id][0].length),
    );
    immutableValues[variable.name] = typeof value === "bigint" ? value.toString() : String(value);
  }

  const expectedCode = patchExpectedRuntime(
    metadata.deployedBytecode,
    metadata.immutableReferences,
    valuesById,
  ).toLowerCase();
  const expectedIdentity = rawBytecodeIdentity(expectedCode, "reconstructed expected runtime");
  assert.equal(
    observedCode,
    expectedCode,
    `Deployed code differs from the immutable-patched compiler runtime; address rejected`,
  );
  assert.equal(observedIdentity.keccak256, expectedIdentity.keccak256);

  const blockTag = await provider.send("eth_blockNumber", []);
  return {
    accepted: true,
    chainId,
    blockTag,
    address: checkedAddress,
    rawByteLength: observedIdentity.rawByteLength,
    observedKeccak256: observedIdentity.keccak256,
    expectedKeccak256: expectedIdentity.keccak256,
    normalizedKeccak256: identity.deploymentAttestation.normalizedDeployedBytecode.keccak256,
    immutableValues,
  };
}

module.exports = {
  attestDeployment,
  collectImmutableVariables,
  flattenImmutableReferences,
  loadCompilerMetadata,
  normalizeBytecode,
  patchExpectedRuntime,
  rawBytecodeIdentity,
};
