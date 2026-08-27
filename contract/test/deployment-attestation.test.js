const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const {
  AbiCoder,
  Interface,
  getAddress,
  toBeHex,
  zeroPadValue,
} = require("ethers");
const { getCompilersDir } = require("hardhat/internal/util/global-dir");
const {
  CompilerDownloader,
  CompilerPlatform,
} = require("hardhat/internal/solidity/compiler/downloader");
const { Compiler, NativeCompiler } = require("hardhat/internal/solidity/compiler");
const {
  attestDeployment,
  collectImmutableVariables,
  compilerMetadataFromBuildInfo,
  loadCompilerMetadata,
  patchExpectedRuntime,
  resolveManifest,
} = require("../lib/deployment-attestation");

const ROOT = path.resolve(__dirname, "..");
const IDENTITY_PATH = path.join(ROOT, "ARTIFACT-IDENTITY.json");
const HARDHAT_CHAIN_ID = "0x7a69";

function deploymentManifest(usdcAddress) {
  return {
    schemaVersion: 1,
    contract: "contracts/AgentMarketplace.sol:AgentMarketplace",
    expectedChainId: HARDHAT_CHAIN_ID,
    constructorArguments: [
      { name: "usdcAddress", type: "address", value: usdcAddress },
    ],
    immutableRules: [
      { name: "usdc", source: "constructorArgument", argument: "usdcAddress" },
      { name: "SLASH_SINK", source: "deployedAddress" },
    ],
  };
}

async function deployMarket(ethers, usdcAddress) {
  const Market = await ethers.getContractFactory("AgentMarketplace");
  const market = await Market.deploy(usdcAddress);
  await market.waitForDeployment();
  return market;
}

async function attestLocal(ethers, market, manifest, overrides = {}) {
  return attestDeployment({
    provider: overrides.provider ?? ethers.provider,
    address: await market.getAddress(),
    transactionHash: market.deploymentTransaction().hash,
    root: ROOT,
    identityPath: IDENTITY_PATH,
    manifest,
    metadata: overrides.metadata,
  });
}

function providerWithOverrides(provider, overrides) {
  return {
    async send(method, params) {
      if (method === "eth_getCode" && overrides.code) return overrides.code;
      if (method === "eth_getTransactionByHash" && overrides.transactionInput) {
        const transaction = await provider.send(method, params);
        return { ...transaction, input: overrides.transactionInput };
      }
      if (method === "eth_call" && overrides.calls) {
        const result = overrides.calls.get(params[0].data.toLowerCase());
        if (result) return result;
      }
      return provider.send(method, params);
    },
  };
}

function encodedSlot(type, value, length) {
  const encoded = AbiCoder.defaultAbiCoder().encode([type], [value]);
  return zeroPadValue(toBeHex(BigInt(encoded)), length);
}

function runtimeFor(metadata, valuesByName) {
  const variables = collectImmutableVariables(metadata.ast);
  const iface = new Interface(metadata.abi);
  const valuesById = new Map();
  for (const id of Object.keys(metadata.immutableReferences)) {
    const variable = variables.get(id);
    const fragment = iface.getFunction(variable.name);
    valuesById.set(
      id,
      encodedSlot(
        fragment.outputs[0].type,
        valuesByName[variable.name],
        metadata.immutableReferences[id][0].length,
      ),
    );
  }
  return patchExpectedRuntime(
    metadata.deployedBytecode,
    metadata.immutableReferences,
    valuesById,
  );
}

function findBuildInfo() {
  const directory = path.join(ROOT, "artifacts", "build-info");
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    const buildInfo = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    if (compilerMetadataFromBuildInfo(buildInfo)) return buildInfo;
  }
  throw new Error("AgentMarketplace build-info not found");
}

async function compileWithPinnedSolc(input) {
  const compilersDir = await getCompilersDir();
  const platform = CompilerDownloader.getCompilerPlatform();
  const downloader = CompilerDownloader.getConcurrencySafeDownloader(platform, compilersDir);
  let compiler = await downloader.getCompiler("0.8.28");
  if (!compiler) {
    const wasmDownloader = CompilerDownloader.getConcurrencySafeDownloader(
      CompilerPlatform.WASM,
      compilersDir,
    );
    compiler = await wasmDownloader.getCompiler("0.8.28");
  }
  expect(compiler, "Pinned solc 0.8.28 must be available after Hardhat compile").to.exist;
  const runner = compiler.isSolcJs
    ? new Compiler(compiler.compilerPath)
    : new NativeCompiler(compiler.compilerPath, compiler.version);
  return runner.compile(input);
}

describe("deployment bytecode attestation", function () {
  it("accepts a real local Hardhat deployment against explicit expectations", async function () {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    const market = await deployMarket(ethers, await usdc.getAddress());
    const result = await attestLocal(
      ethers,
      market,
      deploymentManifest(await usdc.getAddress()),
    );

    expect(result.accepted).to.equal(true);
    expect(result.address).to.equal(await market.getAddress());
    expect(result.transactionHash).to.equal(market.deploymentTransaction().hash);
    expect(result.constructorArguments.usdcAddress).to.equal(await usdc.getAddress());
    expect(result.immutableValues).to.deep.equal({
      usdc: await usdc.getAddress(),
      SLASH_SINK: await market.getAddress(),
    });
    expect(result.observedKeccak256).to.equal(result.expectedKeccak256);
  });

  it("rejects a real deployment configured with the wrong USDC", async function () {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const expectedUsdc = await MockUSDC.deploy();
    const wrongUsdc = await MockUSDC.deploy();
    const market = await deployMarket(ethers, await wrongUsdc.getAddress());

    await expect(
      attestLocal(ethers, market, deploymentManifest(await expectedUsdc.getAddress())),
    ).to.be.rejectedWith("constructor arguments");
  });

  it("rejects a self-consistent wrong SLASH_SINK instead of trusting its getter", async function () {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    const market = await deployMarket(ethers, await usdc.getAddress());
    const metadata = loadCompilerMetadata(ROOT);
    const wrongSlashSink = "0x2000000000000000000000000000000000000002";
    const code = runtimeFor(metadata, {
      usdc: await usdc.getAddress(),
      SLASH_SINK: wrongSlashSink,
    });
    const iface = new Interface(metadata.abi);
    const slashGetter = iface.getFunction("SLASH_SINK");
    const calls = new Map([
      [
        iface.encodeFunctionData(slashGetter).toLowerCase(),
        iface.encodeFunctionResult(slashGetter, [wrongSlashSink]),
      ],
    ]);

    await expect(
      attestLocal(ethers, market, deploymentManifest(await usdc.getAddress()), {
        provider: providerWithOverrides(ethers.provider, { code, calls }),
      }),
    ).to.be.rejectedWith("SLASH_SINK does not match manifest");
  });

  it("rejects a one-byte runtime tamper", async function () {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    const market = await deployMarket(ethers, await usdc.getAddress());
    const code = await ethers.provider.send("eth_getCode", [await market.getAddress(), "latest"]);
    const firstByte = code.slice(2, 4) === "00" ? "01" : "00";
    const tampered = `0x${firstByte}${code.slice(4)}`;

    await expect(
      attestLocal(ethers, market, deploymentManifest(await usdc.getAddress()), {
        provider: providerWithOverrides(ethers.provider, { code: tampered }),
      }),
    ).to.be.rejectedWith("address rejected");
    expect(tampered.length).to.equal(code.length);
  });

  it("rejects a missing immutable manifest entry", async function () {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    const market = await deployMarket(ethers, await usdc.getAddress());
    const manifest = deploymentManifest(await usdc.getAddress());
    manifest.immutableRules = manifest.immutableRules.filter(({ name }) => name !== "usdc");

    await expect(attestLocal(ethers, market, manifest)).to.be.rejectedWith(
      "exactly one rule for every compiler immutable",
    );
  });

  it("rejects a wrong constructor argument in creation transaction input", async function () {
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    const market = await deployMarket(ethers, await usdc.getAddress());
    const transaction = await ethers.provider.send("eth_getTransactionByHash", [
      market.deploymentTransaction().hash,
    ]);
    const lastByte = transaction.input.slice(-2) === "00" ? "01" : "00";
    const wrongInput = `${transaction.input.slice(0, -2)}${lastByte}`;

    await expect(
      attestLocal(ethers, market, deploymentManifest(await usdc.getAddress()), {
        provider: providerWithOverrides(ethers.provider, { transactionInput: wrongInput }),
      }),
    ).to.be.rejectedWith("constructor arguments");
  });

  it("maps shifted immutable AST IDs from an alternate compiled source set", async function () {
    this.timeout(120000);
    const canonical = loadCompilerMetadata(ROOT);
    const buildInfo = findBuildInfo();
    const alternateInput = {
      ...buildInfo.input,
      sources: {
        "contracts/000AstIdShift.sol": {
          content:
            "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.28; contract AstIdShift { uint256 immutable marker; constructor() { marker = 1; } }",
        },
        ...buildInfo.input.sources,
      },
    };
    const output = await compileWithPinnedSolc(alternateInput);
    const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
    expect(errors).to.deep.equal([]);
    const alternate = compilerMetadataFromBuildInfo({ output });
    expect(alternate).to.not.equal(null);
    expect(Object.keys(alternate.immutableReferences)).to.not.deep.equal(
      Object.keys(canonical.immutableReferences),
    );

    const deployedAddress = "0x1000000000000000000000000000000000000001";
    const usdcAddress = "0x3600000000000000000000000000000000000000";
    const resolved = resolveManifest(
      deploymentManifest(usdcAddress),
      alternate,
      deployedAddress,
    );
    expect([...resolved.expectedById.values()].map(({ name }) => name).sort()).to.deep.equal([
      "SLASH_SINK",
      "usdc",
    ]);
    expect(resolved.effectiveConfig).to.deep.equal({
      usdc: usdcAddress,
      SLASH_SINK: getAddress(deployedAddress),
    });
  });

  it("rejects duplicate and unknown immutable manifest rules", function () {
    const metadata = loadCompilerMetadata(ROOT);
    const address = "0x1000000000000000000000000000000000000001";
    const manifest = deploymentManifest("0x3600000000000000000000000000000000000000");
    manifest.immutableRules.push({ ...manifest.immutableRules[0] });
    expect(() => resolveManifest(manifest, metadata, address)).to.throw(
      "Duplicate immutable manifest rule usdc",
    );

    manifest.immutableRules = [
      ...deploymentManifest("0x3600000000000000000000000000000000000000").immutableRules,
      { name: "UNKNOWN", source: "literal", value: 1 },
    ];
    expect(() => resolveManifest(manifest, metadata, address)).to.throw(
      "Unknown immutable manifest rule UNKNOWN",
    );
  });
});