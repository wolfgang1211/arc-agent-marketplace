const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config();

const ROOT = path.resolve(__dirname, "..");
const statePath = path.join(ROOT, "deployment-runs", "arc-testnet-verification.json");
const reportPath = path.join(ROOT, "deployment-runs", "arc-testnet-verification-report.md");
const artifactPath = path.join(ROOT, "artifacts", "contracts", "AgentMarketplace.sol", "AgentMarketplace.json");
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const rpc = process.env.ARC_TESTNET_RPC_URL || state.rpcUrl;
const provider = new ethers.JsonRpcProvider(rpc);
const tokenAbi = ["function balanceOf(address) view returns (uint256)"];
const tokenAddress = "0x3600000000000000000000000000000000000000";
const txUrl = (hash) => `https://testnet.arcscan.app/tx/${hash}`;
const fmt6 = (raw) => ethers.formatUnits(raw, 6);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function row(values) {
  return `| ${values.join(" | ")} |`;
}

async function main() {
  const network = await provider.getNetwork();
  assert(network.chainId === 5042002n, `wrong chain ${network.chainId}`);
  const code = await provider.getCode(state.deployment.address);
  assert(code !== "0x", "deployment has no code");

  const market = new ethers.Contract(state.deployment.address, artifact.abi, provider);
  const token = new ethers.Contract(tokenAddress, tokenAbi, provider);
  const receiptMismatches = [];
  for (const record of state.scenarios.transactions) {
    const receipt = await provider.getTransactionReceipt(record.hash);
    if (!receipt) receiptMismatches.push(`${record.label}: missing receipt`);
    else if (receipt.status !== 1 || String(receipt.gasUsed) !== record.actualGas || Number(receipt.blockNumber) !== Number(record.blockNumber)) {
      receiptMismatches.push(`${record.label}: status/gas/block mismatch`);
    }
  }
  assert(receiptMismatches.length === 0, receiptMismatches.join("; "));

  const deployReceipt = await provider.getTransactionReceipt(state.deployment.transactionHash);
  assert(deployReceipt?.status === 1, "deployment receipt not successful");
  assert(String(deployReceipt.gasUsed) === state.deployment.actualGasUsed, "deployment gas mismatch");

  const funding = state.scenarios.findings.find((x) => x.name === "funding-preflight");
  const [historicNative, historicErc20] = await Promise.all([
    provider.getBalance(funding.deployer, funding.blockNumber),
    token.balanceOf(funding.deployer, { blockTag: funding.blockNumber }),
  ]);
  assert(historicNative.toString() === funding.nativeRaw, "historic funding native balance mismatch");
  assert(historicErc20.toString() === funding.erc20Raw, "historic funding ERC-20 balance mismatch");

  const expectedStatuses = { happy: 4n, donation: 4n, timeoutDelivery: 6n, timeoutApproval: 7n, timeoutDispute: 8n };
  const observedJobs = {};
  for (const [name, expected] of Object.entries(expectedStatuses)) {
    const id = BigInt(state.scenarios.jobs[name].id);
    const job = await market.jobs(id);
    assert(job.status === expected, `${name} status expected ${expected}, got ${job.status}`);
    observedJobs[name] = { id: id.toString(), status: job.status.toString(), reward: job.reward.toString() };
  }

  const agentAddress = state.scenarios.agentAddress;
  const [agent, reputation, categoryReputation, slashSink, feeSink, jobCount, contractBalance, deployerNative, deployerErc20, agentNative, agentErc20, latest] = await Promise.all([
    market.getAgent(agentAddress),
    market.getAgentReputation(agentAddress),
    market.getReputationByCategory(agentAddress, "verification"),
    market.slashSinkBalance(),
    market.reputationFeeSinkBalance(),
    market.jobCount(),
    token.balanceOf(state.deployment.deployer || "0x571780eaE1681Ccec73195D83D0c6DFd4c3cd696"),
    provider.getBalance("0x571780eaE1681Ccec73195D83D0c6DFd4c3cd696"),
    token.balanceOf("0x571780eaE1681Ccec73195D83D0c6DFd4c3cd696"),
    provider.getBalance(agentAddress),
    token.balanceOf(agentAddress),
    provider.getBlock("latest"),
  ]);
  const actualContractBalance = await token.balanceOf(state.deployment.address);
  const paged = await market.getJobsPaged(0, 10);

  assert(!agent.registered && agent.stake === 0n, "agent should be unregistered with zero stake after slash");
  assert(reputation.every((x) => x === 0n), "global reputation was not reset");
  assert(categoryReputation === 0n, "category reputation was not reset");
  assert(slashSink === 100_000000n, `slash sink mismatch ${slashSink}`);
  assert(feeSink === 500000n, `fee sink mismatch ${feeSink}`);
  assert(actualContractBalance === 105_500000n, `contract balance mismatch ${actualContractBalance}`);
  assert(jobCount === 5n && paged[0].length === 5 && paged[1] === 5n, "pagination/job count mismatch");
  assert(state.scenarios.status === "COMPLETED", `state status ${state.scenarios.status}`);
  assert(state.blocklist.status === "NOT_VERIFIED", "blocklist status changed");

  const lines = [];
  lines.push("# Arc Testnet Verification Run Report", "");
  lines.push(`- Chain ID: \`${network.chainId}\``);
  lines.push(`- Verification contract: \`${state.deployment.address}\``);
  lines.push(`- Run state: **${state.scenarios.status}**`);
  lines.push(`- Verified live receipts: **${state.scenarios.transactions.length}/${state.scenarios.transactions.length}**`);
  lines.push(`- Latest verification block: \`${latest.number}\` (timestamp \`${latest.timestamp}\`)`);
  lines.push(`- Blocklist: **${state.blocklist.status}**`);
  lines.push("- Verification address was not written to frontend, Vercel, demo, or announcements.", "");

  lines.push("## Funding and Arc gas asset gate", "");
  const gate = state.scenarios.findings.find((x) => x.name === "arc-native-erc20-equivalence");
  lines.push(`- Starting deployer native balance: **${funding.nativeUsdc} USDC** (18-decimal raw \`${funding.nativeRaw}\`)`);
  lines.push(`- Starting deployer ERC-20 balance: **${funding.erc20Usdc} USDC** (6-decimal raw \`${funding.erc20Raw}\`)`);
  lines.push(`- Second wallet before spending: native raw \`${gate.beforeSpend.nativeRaw}\`, ERC-20 raw \`${gate.beforeSpend.erc20Raw}\`; exact scale equality: **${gate.beforeSpend.scaledEqual}**.`);
  lines.push(`- Second-wallet probe transfer: [\`${gate.probeTx}\`](${txUrl(gate.probeTx)}), receipt status **${gate.probeReceiptStatus}**, actual fee wei \`${gate.probeActualFeeWei}\`.`);
  lines.push("- Finding: on this Arc Testnet run, ERC-20 funding credited the same native gas asset and the funded wallet successfully paid gas.", "");

  lines.push("## Deployment", "");
  lines.push(row(["Step", "Transaction", "Status", "Estimated gas", "Actual gas"]));
  lines.push(row(["---", "---", "---:", "---:", "---:"]));
  lines.push(row(["verification deploy", `[${state.deployment.transactionHash}](${txUrl(state.deployment.transactionHash)})`, state.deployment.receiptStatus, state.deployment.estimatedGas, state.deployment.actualGasUsed]));
  lines.push("", "## Scenario transactions", "");
  lines.push(row(["Step", "Transaction", "Status", "Estimated gas", "Actual gas", "Deviation"]));
  lines.push(row(["---", "---", "---:", "---:", "---:", "---:"]));
  for (const tx of state.scenarios.transactions) {
    lines.push(row([tx.label, `[${tx.hash}](${txUrl(tx.hash)})`, tx.receiptStatus, tx.estimatedGas, tx.actualGas, tx.gasDeviation || "n/a"]));
  }

  lines.push("", "## Expected reverts", "");
  lines.push(row(["Check", "RPC method", "Block", "Timestamp", "Observed"]));
  lines.push(row(["---", "---", "---:", "---:", "---"]));
  for (const failure of state.scenarios.expectedFailures) {
    lines.push(row([failure.label, failure.kind, failure.blockNumber, failure.blockTimestamp, failure.expectedRevert]));
  }

  lines.push("", "## Terminal chain state", "");
  lines.push(row(["Job", "ID", "Status enum", "Reward raw"]));
  lines.push(row(["---", "---:", "---:", "---:"]));
  for (const [name, job] of Object.entries(observedJobs)) lines.push(row([name, job.id, job.status, job.reward]));
  lines.push("");
  lines.push(`- Slash sink: **${fmt6(slashSink)} USDC**`);
  lines.push(`- Reputation fee sink: **${fmt6(feeSink)} USDC**`);
  lines.push(`- Contract ERC-20 balance: **${fmt6(actualContractBalance)} USDC** = 100 slashed stake + 5 donation + 0.5 reputation fee.`);
  lines.push(`- Agent: registered=\`${agent.registered}\`, stake=\`${fmt6(agent.stake)}\`, global reputation all zero, category reputation=\`${categoryReputation}\`.`);
  lines.push(`- Jobs: \`getJobsPaged(0,10)\` returned ${paged[0].length}; total ${paged[1]}.`);
  lines.push(`- Final deployer balance: native **${ethers.formatEther(deployerNative)}**, ERC-20 **${fmt6(deployerErc20)}**.`);
  lines.push(`- Final agent balance: native **${ethers.formatEther(agentNative)}**, ERC-20 **${fmt6(agentErc20)}**.`, "");

  lines.push("## Scope limits", "");
  lines.push("- Circle blocklist behavior: **NOT_VERIFIED**.");
  lines.push("- Epoch re-registration after slash: **LOCAL_ONLY**; it was not run live because it requires another irreversible 100 USDC stake.");
  lines.push("- The donation scenario proves internal accounting is independent of unsolicited ERC-20 balance, not Circle blocklist behavior.");
  lines.push("- This run does not authorize or perform a production deployment, frontend address change, Vercel deployment, or push.", "");

  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`);
  console.log(JSON.stringify({
    accepted: true,
    verifiedReceipts: state.scenarios.transactions.length,
    expectedReverts: state.scenarios.expectedFailures.length,
    jobs: observedJobs,
    slashSink: slashSink.toString(),
    feeSink: feeSink.toString(),
    contractBalance: actualContractBalance.toString(),
    deployerNative: deployerNative.toString(),
    deployerErc20: deployerErc20.toString(),
    agentNative: agentNative.toString(),
    agentErc20: agentErc20.toString(),
    reportPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
