const fs = require("fs");
const crypto = require("crypto");

function writeEvidence({ suite, names, outputPath, command, testFile }) {
  const source = ["contracts/AgentMarketplaceV2.sol", "contracts/OperatorCollateralVaultV2.sol"].map((file) => ({
    file,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  }));
  const testLines = fs.readFileSync(testFile, "utf8").split(/\r?\n/);
  const tests = new Map((suite.tests || []).map((test) => [test.title, test]));
  const findings = Object.entries(names).map(([finding, testFullName]) => {
    const test = tests.get(testFullName);
    return {
      finding,
      testFile,
      testFullName,
      testLine: testLines.findIndex((line) => line.includes(`it(names.${finding}`)) + 1,
      status: test?.state === "passed" ? "pass" : test?.state === "failed" ? "fail" : "pending",
      error: test?.err?.message || null,
    };
  });
  const out = { name: "v2-tur3-closure-evidence", command, findings, source };
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2) + "\n");
  return out;
}

module.exports = { writeEvidence };
