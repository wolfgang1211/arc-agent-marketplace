const path = require("node:path");
const {
  EXPECTED_TIMEOUTS,
  assertDeploymentManifest,
} = require("../lib/deployment-manifest");

const root = path.resolve(__dirname, "..");
const manifests = {
  verification: require(path.join(root, "DEPLOYMENT-MANIFEST.json")),
  production: require(path.join(root, "DEPLOYMENT-MANIFEST.production.json")),
};

for (const [mode, manifest] of Object.entries(manifests)) {
  assertDeploymentManifest(manifest, mode);
}

console.log(
  "Deployment manifests verified:",
  `verification=${Object.values(EXPECTED_TIMEOUTS.verification).join("/")}`,
  `production=${Object.values(EXPECTED_TIMEOUTS.production).join("/")}`,
);
