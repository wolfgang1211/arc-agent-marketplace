import { chainDate, jobLifecycle } from "../../lib/job-lifecycle.mjs";

const STATE_LABELS = { confirmed: "Confirmed", pending: "Pending", "not-applicable": "Not applicable" };

export function JobLifecycle({ job, chainTimestamp, explorer, marketplace }) {
  const lifecycle = jobLifecycle(job, chainTimestamp);
  return (
    <details className="job-lifecycle">
      <summary>On-chain lifecycle</summary>
      <p className="muted">Contract-read evidence, not backend progress. Posting includes funding. Transition times and transaction hashes are not available from this snapshot.</p>
      {!lifecycle ? <p role="status">Lifecycle unavailable: unknown contract status.</p> : <>
        <ol className="lifecycle-steps" aria-label={`Job ${job.id} lifecycle`}>
          {lifecycle.steps.map((step) => <li key={step.key} data-state={step.state}>
            <div><strong>{step.label}</strong><span>{STATE_LABELS[step.state]}</span></div>
            {step.detail && <p>{step.detail}</p>}
          </li>)}
        </ol>
        {lifecycle.deadline && <p className="lifecycle-deadline">{lifecycle.deadline}</p>}
      </>}
      <a href={`${explorer}/address/${marketplace}`} target="_blank" rel="noopener noreferrer">View marketplace contract on explorer ↗</a>
    </details>
  );
}

export function RecentActivityView({ snapshot, loading, error, onRefresh, explorer, marketplace }) {
  return (
    <section className="card recent-activity" aria-labelledby="activity-heading">
      <div className="section-head">
        <div><div className="eyebrow small-eyebrow">On-chain activity</div><h2 id="activity-heading">Recent job activity</h2></div>
        <button className="ghost small" disabled={loading} onClick={onRefresh}>{loading ? "Refreshing…" : "Refresh activity"}</button>
      </div>
      <p className="muted">Latest six posted jobs, newest first, with their current contract status. This is not a latest-transition feed; older jobs may have more recent activity.</p>
      {loading ? <p role="status">Loading bounded on-chain activity…</p> : error ? <p role="alert">Activity unavailable. {error}</p> : !snapshot ? <p role="status">Activity unavailable.</p> : <>
        <p className="muted">Snapshot at <a href={`${explorer}/block/${snapshot.blockNumber}`} target="_blank" rel="noopener noreferrer">block {String(snapshot.blockNumber)} ↗</a> · {chainDate(snapshot.timestamp)}</p>
        {snapshot.jobs.length === 0 ? <p>No jobs posted on this deployment.</p> : <ol className="activity-list">
          {snapshot.jobs.map((job) => <li key={String(job.id)}>
            <strong>Job #{String(job.id)}</strong>
            <span>{jobLifecycle(job, snapshot.timestamp)?.statusLabel || "Unknown status"}</span>
            <small>Posted {chainDate(job.createdAt)}</small>
          </li>)}
        </ol>}
      </>}
      <a href={`${explorer}/address/${marketplace}`} target="_blank" rel="noopener noreferrer">Verify marketplace on explorer ↗</a>
    </section>
  );
}
