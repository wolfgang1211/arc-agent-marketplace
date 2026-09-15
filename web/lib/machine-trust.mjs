// These are separate observations, never a rating or a success funnel.
export function machineTrust(snapshot) {
  if (!snapshot) return null;
  const { reputation, logs, fromBlock, toBlock } = snapshot;
  if (typeof fromBlock !== "bigint" || typeof toBlock !== "bigint" || fromBlock < 0n || toBlock < fromBlock
    || !Array.isArray(reputation) || reputation.length !== 5
    || reputation.some((value) => typeof value !== "bigint" || value < 0n)
    || !Array.isArray(logs)) return null;

  const unique = new Map();
  for (const log of logs) {
    if (!log || typeof log.blockNumber !== "bigint" || log.blockNumber < fromBlock || log.blockNumber > toBlock
      || !Number.isInteger(log.logIndex) || log.logIndex < 0 || !log.transactionHash
      || typeof log.args?.amount !== "bigint" || log.args.amount < 0n || log.removed) return null;
    const key = `${log.transactionHash}:${log.logIndex}`;
    const previous = unique.get(key);
    if (previous && (previous.blockNumber !== log.blockNumber || previous.args.amount !== log.args.amount)) return null;
    unique.set(key, log);
  }
  const events = [...unique.values()];
  const counterFromBlock = events.reduce((latest, log) => log.blockNumber > latest ? log.blockNumber : latest, fromBlock);
  return {
    deliveryQuality: { approved: reputation[2] },
    reliability: null, // Submission block timestamps are not tracked by this reader.
    integrity: {
      disputes: reputation[3],
      slashEvents: events.length,
      stakeLossEvents: events.filter((log) => log.args.amount > 0n).length,
      totalSlashed: events.reduce((sum, log) => sum + log.args.amount, 0n),
    },
    demand: { distinctClients: reputation[0] },
    window: { fromBlock, toBlock, counterFromBlock, afterSlash: events.length > 0 },
  };
}
