const { expect } = require("chai");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEPLOYMENT_MODES,
  artifactIdentitySummary,
  deploymentRunPath,
  markDeploymentAttested,
  resolveDeploymentMode,
  writeDeploymentRunState,
} = require("../lib/deployment-modes");

describe("deployment mode selection and run state", function () {
  it("extracts non-empty creation and normalized runtime identities", function () {
    expect(artifactIdentitySummary({
      build: { creationBytecode: { keccak256: "0xcreation" } },
      deploymentAttestation: {
        normalizedDeployedBytecode: { keccak256: "0xruntime" },
      },
    })).to.deep.equal({
      creationKeccak256: "0xcreation",
      normalizedDeployedKeccak256: "0xruntime",
    });
    expect(() => artifactIdentitySummary({})).to.throw("Artifact identity is incomplete");
  });

  it("requires an explicit supported mode and has no default", function () {
    expect(() => resolveDeploymentMode({})).to.throw(
      "Select deploy:verification, deploy:live-testnet, or deploy:production explicitly",
    );
    expect(() => resolveDeploymentMode({ lifecycleEvent: "deploy" })).to.throw(
      "Select deploy:verification, deploy:live-testnet, or deploy:production explicitly",
    );
  });

  it("maps every mode to a distinct manifest", function () {
    expect(DEPLOYMENT_MODES).to.deep.equal({
      verification: { manifestFile: "DEPLOYMENT-MANIFEST.json" },
      "live-testnet": { manifestFile: "DEPLOYMENT-MANIFEST.live-testnet.json" },
      production: { manifestFile: "DEPLOYMENT-MANIFEST.production.json" },
    });
    for (const mode of Object.keys(DEPLOYMENT_MODES)) {
      expect(resolveDeploymentMode({ lifecycleEvent: `deploy:${mode}` }).mode).to.equal(mode);
    }
  });

  it("rejects conflicting explicit and lifecycle modes", function () {
    expect(() =>
      resolveDeploymentMode({
        explicitMode: "production",
        lifecycleEvent: "deploy:live-testnet",
      }),
    ).to.throw("Deployment mode conflict");
  });

  it("writes the explicit mode and manifest into an address-scoped run state", function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arc-deployment-mode-"));
    const address = "0x1000000000000000000000000000000000000001";
    const statePath = writeDeploymentRunState({
      root,
      mode: "live-testnet",
      state: {
        schemaVersion: 1,
        deploymentMode: "live-testnet",
        manifestFile: "DEPLOYMENT-MANIFEST.live-testnet.json",
        status: "UNATTESTED",
        contractAddress: address,
      },
    });
    expect(statePath).to.equal(deploymentRunPath(root, "live-testnet", address));
    expect(JSON.parse(fs.readFileSync(statePath, "utf8"))).to.include({
      deploymentMode: "live-testnet",
      manifestFile: "DEPLOYMENT-MANIFEST.live-testnet.json",
      status: "UNATTESTED",
      contractAddress: address,
    });
  });

  it("rejects a run state whose recorded mode or manifest disagrees", function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arc-deployment-mode-"));
    const state = {
      schemaVersion: 1,
      deploymentMode: "production",
      manifestFile: "DEPLOYMENT-MANIFEST.production.json",
      status: "UNATTESTED",
      contractAddress: "0x1000000000000000000000000000000000000001",
    };
    expect(() => writeDeploymentRunState({ root, mode: "live-testnet", state })).to.throw(
      "Run-state deployment mode mismatch",
    );
  });

  it("persists the attested manifest identity and verifies it by readback", function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arc-deployment-mode-"));
    const address = "0x1000000000000000000000000000000000000001";
    writeDeploymentRunState({
      root,
      mode: "live-testnet",
      state: {
        schemaVersion: 1,
        deploymentMode: "live-testnet",
        manifestFile: "DEPLOYMENT-MANIFEST.live-testnet.json",
        status: "UNATTESTED",
        contractAddress: address,
      },
    });

    const { state } = markDeploymentAttested({
      root,
      mode: "live-testnet",
      address,
      attestation: { accepted: true, observedKeccak256: "0x1234" },
    });
    expect(state.status).to.equal("ATTESTED");
    expect(state.attestation).to.deep.equal({
      manifestFile: "DEPLOYMENT-MANIFEST.live-testnet.json",
      accepted: true,
      observedKeccak256: "0x1234",
    });
    expect(JSON.parse(fs.readFileSync(deploymentRunPath(root, "live-testnet", address), "utf8")))
      .to.deep.equal(state);
  });
});
