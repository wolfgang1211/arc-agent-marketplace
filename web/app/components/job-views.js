"use client";

import { useEffect, useState } from "react";
import { JOB_VIEWS, JOB_VIEW_STATUSES, readJobView, jobViewHref } from "../../lib/job-views.mjs";

export function useJobView() {
  const [state, setState] = useState(() => readJobView());
  useEffect(() => {
    const restore = () => setState(readJobView(window.location.search));
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const update = (patch) => {
    const next = { ...state, ...patch };
    window.history.pushState(null, "", jobViewHref(window.location.href, next));
    setState(next);
  };
  return [state, update];
}

export function JobViewControls({ state, onChange, counts, dataStatus, connected }) {
  const count = (key) => !connected && state.view !== "marketplace" ? "—"
    : dataStatus === "loading" ? "…" : dataStatus === "error" ? "—" : counts[key];
  return (
    <div className="job-view-controls">
      <div className="job-view-options" role="group" aria-label="Job ownership">
        {Object.entries(JOB_VIEWS).map(([value, label]) => (
          <button key={value} className="ghost" aria-pressed={state.view === value}
            onClick={() => onChange({ view: value, page: 0 })}>{label}</button>
        ))}
      </div>
      <p className="muted job-view-scope">
        {state.view === "my-jobs" ? "Jobs created by your connected wallet. " : state.view === "my-work" ? "Jobs assigned to your connected wallet. " : "Public jobs from every wallet. "}
        Counts cover this on-chain page and the open-job filters only, not your entire history. Use Next to check more records.
      </p>
      <div className="job-view-options" role="group" aria-label="Job status">
        {Object.entries(JOB_VIEW_STATUSES).map(([value, label]) => (
          <button key={value} className="ghost" aria-pressed={state.status === value}
            onClick={() => onChange({ status: value })}>
            {label} <span className="job-view-count">{count(value === "all" ? "total" : value)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function JobViewEmpty({ state, connected, onConnect, connectDisabled, onReset }) {
  const needsWallet = state.view !== "marketplace" && !connected;
  return (
    <div className="empty-state" role="status">
      <h3>{needsWallet ? `Connect a wallet to view ${JOB_VIEWS[state.view]}` : "No matching jobs on this page"}</h3>
      <p>{needsWallet ? "Your view stays selected. Public jobs remain available in Marketplace without a wallet."
        : "Try another status, clear the open-job filters, or check the next on-chain page. This is not a full-history search."}</p>
      {needsWallet ? <button onClick={onConnect} disabled={connectDisabled}>Connect wallet</button>
        : <button className="ghost" onClick={onReset}>Clear job filters</button>}
    </div>
  );
}
