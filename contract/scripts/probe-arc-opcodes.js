const RPC_URL = "https://rpc.testnet.arc.network";
const OVERRIDE_ADDRESS = "0x000000000000000000000000000000000000dead";
const probes = [
  {
    name: "PUSH0",
    code: "0x5f60005260206000f3",
    expectedResult: `0x${"00".repeat(32)}`,
  },
  {
    name: "MCOPY",
    code: "0x60016000526020600060205e60206020f3",
    expectedResult: `0x${"00".repeat(31)}01`,
  },
  {
    name: "TSTORE_TLOAD",
    code: "0x602a60005d60005c60005260206000f3",
    expectedResult: `0x${"00".repeat(31)}2a`,
  },
];

let nextId = 1;
async function rpc(method, params = []) {
  const request = { jsonrpc: "2.0", id: nextId++, method, params };
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${method}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
  return { request, result: payload.result };
}

async function main() {
  const clientVersion = await rpc("web3_clientVersion");
  const chainId = await rpc("eth_chainId");
  const blockNumber = await rpc("eth_blockNumber");
  const blockTag = blockNumber.result;
  const results = [];

  for (const probe of probes) {
    const call = await rpc("eth_call", [
      { to: OVERRIDE_ADDRESS, data: "0x" },
      blockTag,
      { [OVERRIDE_ADDRESS]: { code: probe.code } },
    ]);
    if (call.result.toLowerCase() !== probe.expectedResult.toLowerCase()) {
      throw new Error(
        `${probe.name}: expected ${probe.expectedResult}, got ${call.result}`,
      );
    }
    results.push({
      name: probe.name,
      code: probe.code,
      request: call.request,
      result: call.result,
    });
  }

  console.log(
    JSON.stringify(
      {
        rpcUrl: RPC_URL,
        stateOverrideAddress: OVERRIDE_ADDRESS,
        clientVersion,
        chainId,
        blockNumber,
        probes: results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
