const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  AbiCoder,
  Interface,
  getAddress,
  getCreateAddress,
  hexlify,
  keccak256,
  toBeHex,
  zeroPadValue,
} = require("ethers");

const CONTRACT_SOURCE = "contracts/AgentMarketplace.sol";
const CONTRACT_NAME = "AgentMarketplace";
const CONTRACT_ID = `${CONTRACT_SOURCE}:${CONTRACT_NAME}`;

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

function compilerMetadataFromBuildInfo(buildInfo) {
  const contract = buildInfo.output?.contracts?.[CONTRACT_SOURCE]?.[CONTRACT_NAME];
  const source = buildInfo.output?.sources?.[CONTRACT_SOURCE];
  if (!contract || !source?.ast) return null;
  return {
    abi: contract.abi,
    ast: source.ast,
    creationBytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    immutableReferences: contract.evm.deployedBytecode.immutableReferences ?? {},
  };
}

function loadCompilerMetadata(root) {
  const directory = path.join(root, "artifacts", "build-info");
  const candidates = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(directory, name));

  for (const candidate of candidates) {
    const metadata = compilerMetadataFromBuildInfo(readJson(candidate));
    if (metadata) return metadata;
  }
  throw new Error(`No build-info entry found for ${CONTRACT_ID}`);
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
  const creationIdentity = rawBytecodeIdentity(metadata.creationBytecode, "compiler creation bytecode");
  assert.deepEqual(
    creationIdentity,
    identity.build.creationBytecode,
    "Clean compiler creation bytecode does not match ARTIFACT-IDENTITY.json",
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

function constructorFragment(abi) {
  const fragment = abi.find((entry) => entry.type === "constructor");
  return fragment ?? { inputs: [] };
}

function resolveManifest(manifest, metadata, deployedAddress) {
  assert.equal(manifest.schemaVersion, 1, "Unsupported deployment manifest schemaVersion");
  assert.ok(
    manifest.mode === "verification" || manifest.mode === "production",
    "Deployment manifest mode must be verification or production",
  );
  assert.equal(manifest.contract, CONTRACT_ID, "Deployment manifest targets the wrong contract");
  assert.match(manifest.expectedChainId, /^0x[0-9a-fA-F]+$/, "Manifest expectedChainId is invalid");
  assert.ok(Array.isArray(manifest.constructorArguments), "Manifest constructorArguments must be an array");
  assert.ok(Array.isArray(manifest.immutableRules), "Manifest immutableRules must be an array");

  const constructor = constructorFragment(metadata.abi);
  assert.equal(
    manifest.constructorArguments.length,
    constructor.inputs.length,
    "Manifest must define every constructor argument exactly once",
  );
  const argumentsByName = new Map();
  constructor.inputs.forEach((input, index) => {
    const rule = manifest.constructorArguments[index];
    assert.equal(rule.name, input.name, `Constructor argument ${index} name mismatch`);
    assert.equal(rule.type, input.type, `Constructor argument ${input.name} type mismatch`);
    assert.ok(!argumentsByName.has(rule.name), `Duplicate constructor argument rule ${rule.name}`);
    argumentsByName.set(rule.name, rule.value);
  });

  const variables = collectImmutableVariables(metadata.ast);
  const referencedByName = new Map();
  for (const id of Object.keys(metadata.immutableReferences)) {
    const variable = variables.get(id);
    assert.ok(variable, `Unknown compiler immutable AST id ${id}`);
    assert.ok(variable.name, `Compiler immutable AST id ${id} has no name`);
    assert.ok(!referencedByName.has(variable.name), `Duplicate compiler immutable name ${variable.name}`);
    referencedByName.set(variable.name, { id, variable });
  }

  const rulesByName = new Map();
  for (const rule of manifest.immutableRules) {
    assert.ok(rule && typeof rule.name === "string", "Immutable manifest rule needs a name");
    assert.ok(!rulesByName.has(rule.name), `Duplicate immutable manifest rule ${rule.name}`);
    assert.ok(referencedByName.has(rule.name), `Unknown immutable manifest rule ${rule.name}`);
    rulesByName.set(rule.name, rule);
  }
  assert.equal(
    rulesByName.size,
    referencedByName.size,
    "Manifest must define exactly one rule for every compiler immutable",
  );

  const expectedById = new Map();
  const effectiveConfig = {};
  for (const [name, { id, variable }] of referencedByName) {
    const rule = rulesByName.get(name);
    assert.ok(rule, `Missing immutable manifest rule ${name}`);
    let value;
    if (rule.source === "constructorArgument") {
      assert.ok(argumentsByName.has(rule.argument), `Immutable ${name} references unknown constructor argument`);
      value = argumentsByName.get(rule.argument);
    } else if (rule.source === "deployedAddress") {
      value = deployedAddress;
    } else if (rule.source === "literal") {
      value = rule.value;
    } else {
      assert.fail(`Immutable ${name} has unsupported manifest source ${rule.source}`);
    }
    assert.notEqual(value, undefined, `Immutable ${name} manifest value is missing`);
    expectedById.set(id, { name, variable, value });
    effectiveConfig[name] = String(value);
  }

  return {
    mode: manifest.mode,
    constructorTypes: constructor.inputs.map((input) => input.type),
    constructorValues: constructor.inputs.map((input) => argumentsByName.get(input.name)),
    effectiveConfig,
    expectedById,
  };
}

async function attestDeployment({
  provider,
  address,
  transactionHash,
  root,
  identityPath,
  manifestPath,
  manifest,
  metadata,
}) {
  const identity = readJson(identityPath);
  const compilerMetadata = metadata ?? loadCompilerMetadata(root);
  assertRecordedTemplate(identity, compilerMetadata);

  const checkedAddress = getAddress(address);
  const deploymentManifest = manifest ?? readJson(manifestPath);
  const resolved = resolveManifest(deploymentManifest, compilerMetadata, checkedAddress);
  if (manifestPath) {
    assert.equal(
      deploymentManifest.expectedChainId.toLowerCase(),
      identity.deploymentAttestation.expectedChainId.toLowerCase(),
      "Deployment manifest chainId does not match governed artifact identity",
    );
  }
  const chainId = (await provider.send("eth_chainId", [])).toLowerCase();
  assert.equal(
    chainId,
    deploymentManifest.expectedChainId.toLowerCase(),
    `Unexpected chainId ${chainId}; address rejected`,
  );

  assert.ok(transactionHash, "Deployment transaction hash is required");
  const transaction = await provider.send("eth_getTransactionByHash", [transactionHash]);
  assert.ok(transaction, "Deployment transaction was not found");
  assert.equal(transaction.to, null, "Attested transaction is not contract creation");
  assert.equal(
    getCreateAddress({ from: transaction.from, nonce: BigInt(transaction.nonce) }),
    checkedAddress,
    "Deployment transaction does not create the attested address",
  );
  const encodedArguments = AbiCoder.defaultAbiCoder().encode(
    resolved.constructorTypes,
    resolved.constructorValues,
  );
  const expectedInput = `${compilerMetadata.creationBytecode}${encodedArguments.slice(2)}`.toLowerCase();
  assert.equal(
    (transaction.input ?? transaction.data).toLowerCase(),
    expectedInput,
    "Deployment transaction input does not match governed creation bytecode and constructor arguments",
  );

  const observedCode = (await provider.send("eth_getCode", [checkedAddress, "latest"])).toLowerCase();
  assert.notEqual(observedCode, "0x", "Address has no deployed code; address rejected");
  const observedIdentity = rawBytecodeIdentity(observedCode, "eth_getCode result");
  assert.equal(
    observedIdentity.rawByteLength,
    identity.build.deployedBytecode.rawByteLength,
    "Deployed byte length mismatch; address rejected",
  );

  const iface = new Interface(compilerMetadata.abi);
  const valuesById = new Map();
  const immutableValues = {};
  for (const [id, expected] of resolved.expectedById) {
    const { name, variable, value } = expected;
    assert.equal(variable.visibility, "public", `Immutable ${name} must have a public getter`);
    const fragment = iface.getFunction(name);
    assert.ok(fragment && fragment.inputs.length === 0, `Immutable ${name} needs a no-argument getter`);
    assert.equal(fragment.outputs.length, 1, `Immutable ${name} getter must have one output`);
    const result = await provider.send("eth_call", [
      { to: checkedAddress, data: iface.encodeFunctionData(fragment) },
      "latest",
    ]);
    const observedValue = iface.decodeFunctionResult(fragment, result)[0];
    assert.equal(
      AbiCoder.defaultAbiCoder().encode([fragment.outputs[0].type], [observedValue]),
      AbiCoder.defaultAbiCoder().encode([fragment.outputs[0].type], [value]),
      `Immutable getter ${name} does not match manifest effective config`,
    );
    const length = compilerMetadata.immutableReferences[id][0].length;
    valuesById.set(id, encodeImmutableValue(fragment.outputs[0].type, value, length));
    immutableValues[name] = typeof observedValue === "bigint" ? observedValue.toString() : String(observedValue);
  }

  const expectedCode = patchExpectedRuntime(
    compilerMetadata.deployedBytecode,
    compilerMetadata.immutableReferences,
    valuesById,
  ).toLowerCase();
  const expectedIdentity = rawBytecodeIdentity(expectedCode, "reconstructed expected runtime");
  assert.equal(
    observedCode,
    expectedCode,
    "Deployed code differs from the manifest-patched compiler runtime; address rejected",
  );
  assert.equal(observedIdentity.keccak256, expectedIdentity.keccak256);

  const blockTag = await provider.send("eth_blockNumber", []);
  return {
    accepted: true,
    mode: resolved.mode,
    chainId,
    blockTag,
    address: checkedAddress,
    transactionHash,
    rawByteLength: observedIdentity.rawByteLength,
    observedKeccak256: observedIdentity.keccak256,
    expectedKeccak256: expectedIdentity.keccak256,
    normalizedKeccak256: identity.deploymentAttestation.normalizedDeployedBytecode.keccak256,
    constructorArguments: Object.fromEntries(
      deploymentManifest.constructorArguments.map((argument) => [argument.name, String(argument.value)]),
    ),
    immutableValues,
  };
}

module.exports = {
  attestDeployment,
  collectImmutableVariables,
  compilerMetadataFromBuildInfo,
  flattenImmutableReferences,
  loadCompilerMetadata,
  normalizeBytecode,
  patchExpectedRuntime,
  rawBytecodeIdentity,
  resolveManifest,
};