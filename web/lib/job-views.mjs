import { getJobStatusCounts, JOB_STATUS_BUCKETS } from "./timeout-recovery.mjs";

export const JOB_VIEWS = { marketplace: "Marketplace", "my-jobs": "My Jobs", "my-work": "My Work" };
export const JOB_VIEW_STATUSES = { all: "All statuses", open: "Open", active: "In progress", settled: "Settled" };
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function readJobView(search = "") {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  const status = params.get("status");
  const rawPage = params.get("page") || "0";
  const page = /^\d{1,8}$/.test(rawPage) ? Number(rawPage) : 0;
  return {
    view: Object.hasOwn(JOB_VIEWS, view) ? view : "marketplace",
    status: Object.hasOwn(JOB_VIEW_STATUSES, status) ? status : "all",
    page,
  };
}

export function jobViewHref(href, state) {
  const url = new URL(href);
  for (const [key, fallback] of [["view", "marketplace"], ["status", "all"], ["page", 0]]) {
    if (state[key] === fallback) url.searchParams.delete(key);
    else url.searchParams.set(key, String(state[key]));
  }
  return `${url.pathname}${url.search}#jobs`;
}

export function selectJobView(jobs, { view = "marketplace", status = "all" }, address) {
  const wallet = String(address || "").toLowerCase();
  const scoped = view === "marketplace" ? jobs : jobs.filter((job) =>
    wallet && wallet !== ZERO_ADDRESS && String(job[view === "my-jobs" ? "client" : "agent"] || "").toLowerCase() === wallet);
  return {
    counts: getJobStatusCounts(scoped),
    jobs: status === "all" ? scoped : scoped.filter((job) => JOB_STATUS_BUCKETS[Number(job.status)] === status),
  };
}
