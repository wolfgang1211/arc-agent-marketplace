const { expect } = require("chai");
const path = require("node:path");
const {
  AbiCoder,
  Interface,
  keccak256,
  toBeHex,
  zeroPadValue,
} = require("ethers");
const {
  attestDeployment,
  collectImmutableVariables,
  loadCompilerMetadata,
  patchExpectedRuntime,
} = require("../lib/deployment-attestation");

const ROOT = path.resolve(__dirname, "..");
const IDENTITY_PATH = path.join(ROOT, "ARTIFACT-IDENTITY.json");
const ADDRESS = "0x1000000000000000000000000000000000000001";
const USDC = "0x3600000000000000000000000000000000000000";

function encodedSlot(type, value, length) {
  const encoded = AbiCoder.defaultAbiCoder().encode([type], [value]);
  return zeroPadValue(toBeHex(BigInt(encoded)), length);
}

function fixture() {
  const metadata = loadCompilerMetadata(ROOT);
  const variables = collectImmutableVariables(metadata.ast);
  const iface = new Interface(metadata.abi);
  const valuesByName = { usdc: USDC, SLASH_SINK: ADDRESS };
  const valuesById = new Map();
  const calls = new Map();

  for (const id of Object.keys(metadata.immutableReferences)) {
    const variable = variables.get(id);
    const fragment = iface.getFunction(variable.name);
    const value = valuesByName[variable.name];
    if (value === undefined) throw new Error(`Missing test value for ${variable.name}`);
    valuesById.set(
      id,
      encodedSlot(fragment.outputs[0].type, value, metadata.immutableReferences[id][0].length),
    );
    calls.set(
      iface.encodeFunctionData(fragment).toLowerCase(),
      iface.encodeFunctionResult(fragment, [value]),
    );
  }

  const expectedCode = patchExpectedRuntime(
    metadata.deployedBytecode,
    metadata.immutableReferences,
    valuesById,
  );
  return { calls, expectedCode };
}

function fakeProvider(code, calls) {
  return {
    async send(method, params) {
      if (method === "eth_chainId") return "0x4cef52";
      if (method === "eth_getCode") return code;
      if (method === "eth_blockNumber") return "0x1234";
      if (method === "eth_call") {
        const result = calls.get(params[0].data.toLowerCase());
        if (!result) throw new Error(`Unexpected getter call ${params[0].data}`);
        return result;
      }
      throw new Error(`Unexpected RPC method ${method}`);
    },
  };
}

describe("deployment bytecode attestation", function () {
  it("accepts an exact immutable-patched runtime without a deployment", async function () {
    const { calls, expectedCode } = fixture();
    const result = await attestDeployment({
      provider: fakeProvider(expectedCode, calls),
      address: ADDRESS,
      root: ROOT,
      identityPath: IDENTITY_PATH,
    });

    expect(result.accepted).to.equal(true);
    expect(result.chainId).to.equal("0x4cef52");
    expect(result.address).to.equal(ADDRESS);
    expect(result.observedKeccak256).to.equal(keccak256(expectedCode));
    expect(result.expectedKeccak256).to.equal(result.observedKeccak256);
    expect(result.immutableValues).to.deep.equal({ usdc: USDC, SLASH_SINK: ADDRESS });
  });

  it("rejects same-length mismatched deployed code without a deployment", async function () {
    const { calls, expectedCode } = fixture();
    const firstByte = expectedCode.slice(2, 4) === "00" ? "01" : "00";
    const mismatchedCode = `0x${firstByte}${expectedCode.slice(4)}`;

    let error;
    try {
      await attestDeployment({
        provider: fakeProvider(mismatchedCode, calls),
        address: ADDRESS,
        root: ROOT,
        identityPath: IDENTITY_PATH,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.include("address rejected");
    expect(mismatchedCode.length).to.equal(expectedCode.length);
  });
});
