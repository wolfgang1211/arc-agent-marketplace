const MAX_UINT256 = (1n << 256n) - 1n;

export function parseJobId(value) {
  const raw = String(value ?? "");
  if (!/^[1-9]\d{0,77}$/.test(raw)) return null;
  const parsed = BigInt(raw);
  return parsed <= MAX_UINT256 ? parsed : null;
}
