const assert = require("node:assert/strict");

const EXPECTED_TIMEOUTS = Object.freeze({
  verification: Object.freeze({
    deliveryTimeout: "600",
    approvalTimeout: "900",
    disputeTimeout: "1200",
  }),
  production: Object.freeze({
    deliveryTimeout: "2592000",
    approvalTimeout: "2592000",
    disputeTimeout: "2592000",
  }),
});

function assertDeploymentManifest(manifest, expectedMode = manifest?.mode) {
  assert.ok(EXPECTED_TIMEOUTS[expectedMode], `Unsupported deployment mode ${expectedMode}`);
  assert.equal(manifest?.mode, expectedMode, `Deployment manifest mode must be ${expectedMode}`);
  assert.ok(Array.isArray(manifest.constructorArguments), "Manifest constructorArguments must be an array");

  const values = new Map();
  for (const argument of manifest.constructorArguments) {
    assert.ok(!values.has(argument.name), `Duplicate constructor argument ${argument.name}`);
    values.set(argument.name, String(argument.value));
  }

  const actualTimeouts = Object.fromEntries(
    Object.keys(EXPECTED_TIMEOUTS[expectedMode]).map((name) => {
      assert.ok(values.has(name), `Missing constructor argument ${name}`);
      return [name, values.get(name)];
    }),
  );

  if (expectedMode === "verification") {
    assert.ok(
      new Set(Object.values(actualTimeouts)).size > 1,
      "Verification deployment timeouts must not all be equal",
    );
  }

  assert.deepEqual(
    actualTimeouts,
    EXPECTED_TIMEOUTS[expectedMode],
    `${expectedMode} deployment timeout configuration mismatch`,
  );
  return actualTimeouts;
}

module.exports = {
  EXPECTED_TIMEOUTS,
  assertDeploymentManifest,
};
