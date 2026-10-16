const { expect } = require("chai");
const fs = require("fs");
const path = require("path");
const { LIMIT, checkBytes, measureCanonical } = require("../scripts/check-v2-size");

describe("V2 canonical runtime size gate", function () {
  it("accepts 24000 and rejects 24001 independently", function () {
    expect(() => checkBytes("boundary-accept", 24000)).to.not.throw();
    expect(() => checkBytes("boundary-reject", 24001)).to.throw(/exceeds 24000/);
    expect(LIMIT).to.equal(24000);
  });

  it("checks both fresh canonical artifacts and records build-info identity", function () {
    const result = measureCanonical();
    expect(result.artifacts.map((x) => x.name)).to.have.members(["AgentMarketplaceV2", "OperatorCollateralVaultV2"]);
    expect(result.artifacts.every((x) => x.runtimeBytes <= 24000)).to.equal(true);
    const infoDir = path.resolve(__dirname, "../artifacts-v2-runs50/build-info");
    const buildInfo = fs.readdirSync(infoDir).filter((x) => x.endsWith(".json"));
    const info = buildInfo.map((name) => JSON.parse(fs.readFileSync(path.join(infoDir, name), "utf8")))
      .find((candidate) => candidate.input.sources?.["contracts/AgentMarketplaceV2.sol"]);
    expect(info).to.not.equal(undefined);
    expect(info.solcVersion).to.equal("0.8.28");
    expect(info.input.settings.evmVersion).to.equal("cancun");
    expect(info.input.settings.optimizer.runs).to.equal(50);
  });
});