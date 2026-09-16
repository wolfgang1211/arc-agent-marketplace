import { URL_SUMMARY_CATEGORY, parseUrlSummaryDescription } from "./url-summary-schema.mjs";
export { URL_SUMMARY_CATEGORY };
export const GAS_RESERVE_WEI = 20_000_000_000_000_000n;
export const MIN_REWARD = 5_000000n;
export const MAX_REWARD = 20_000000n;


export function hasGasReserve(balance, threshold = GAS_RESERVE_WEI) {
  return typeof balance === "bigint" && balance >= threshold;
}

export function parseEligibleJob(job) {
  if (typeof job?.status !== "number" || job.status !== 0) return reject("job_not_open");
  if (job?.category !== URL_SUMMARY_CATEGORY) return reject("unsupported_category");
  if (typeof job?.reward !== "bigint" || job.reward < MIN_REWARD || job.reward > MAX_REWARD) {
    return reject("reward_out_of_range");
  }

  return parseUrlSummaryDescription(job.description);
}

function reject(reason) {
  return { ok: false, reason };
}
