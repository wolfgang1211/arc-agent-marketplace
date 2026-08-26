export function currentEraCopy(copy, slashCount) {
  return slashCount > 0 ? `${copy} · Since last slash` : copy;
}

export function categoryDistinctClients(score) {
  if (typeof score !== "bigint" || score < 0n || score % 100n !== 0n) return null;
  return score / 100n;
}