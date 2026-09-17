"use client";

import { useEffect, useRef, useState } from "react";

const REASONS = Object.freeze({
  unsupported_delivery_uri: "This delivery is not a supported IPFS artifact.",
  unsupported_artifact_type: "Inline preview is not available for this job type.",
  malformed_artifact: "The result.json file is malformed.",
  artifact_schema_mismatch: "The artifact does not match the supported result schema.",
  job_binding_mismatch: "The artifact is not bound to this job and its acceptance criteria.",
  unsafe_url: "The artifact URL did not pass the public-network safety check.",
  unsafe_dns_answer: "The artifact host resolves to a private or reserved address.",
  response_too_large: "The artifact exceeds the 256 KiB preview limit.",
  unsupported_content_type: "The artifact is not served as JSON.",
});

export function DeliveryPreview({ job, fetchImpl = globalThis.fetch }) {
  const snapshot = `${job?.id}:${job?.status}:${job?.category}:${job?.description}:${job?.deliverableURI}`;
  const requestGeneration = useRef(0);
  const [state, setState] = useState({ status: "idle", snapshot });
  useEffect(() => {
    requestGeneration.current += 1;
    setState({ status: "idle", snapshot });
  }, [snapshot]);
  if (!job?.deliverableURI || job.category !== "url-summary-v1") return null;

  const load = async () => {
    if (state.status === "loading") return;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setState({ status: "loading", snapshot });
    try {
      const response = await fetchImpl("/api/delivery-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          id: String(job.id),
          category: job.category,
          description: job.description,
          deliverableURI: job.deliverableURI,
        }),
      });
      const payload = await response.json();
      if (generation !== requestGeneration.current) return;
      if (!response.ok || payload?.ok !== true || !payload.preview) {
        setState({ status: "error", snapshot, reason: payload?.reason, retryable: payload?.retryable === true });
        return;
      }
      setState({ status: "ready", snapshot, preview: payload.preview });
    } catch {
      if (generation === requestGeneration.current) {
        setState({ status: "error", snapshot, reason: "preview_unavailable", retryable: true });
      }
    }
  };

  const currentState = state.snapshot === snapshot ? state : { status: "idle" };

  return (
    <section className="delivery-preview" aria-label="Safe delivery preview">
      <div className="delivery-preview-heading">
        <div><strong>Safe result preview</strong><span>Validated JSON only. Remote HTML is never embedded.</span></div>
        {currentState.status !== "ready" && (
          <button className="ghost" type="button" disabled={currentState.status === "loading"} onClick={load}>
            {currentState.status === "loading" ? "Checking artifact…" : currentState.status === "error" && currentState.retryable ? "Retry preview" : "Load preview"}
          </button>
        )}
      </div>
      {currentState.status === "error" && (
        <p className="delivery-preview-error">{REASONS[currentState.reason] || "The artifact could not be safely previewed."} Use the canonical delivery link for manual review.</p>
      )}
      {currentState.status === "ready" && <PreviewContent preview={currentState.preview} />}
    </section>
  );
}

function PreviewContent({ preview }) {
  return (
    <div className="delivery-preview-content">
      <h4>{preview.title}</h4>
      <p>{preview.summary}</p>
      <div className="delivery-preview-columns">
        <div><strong>Key points</strong><ul>{preview.keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul></div>
        <div><strong>Limitations</strong>{preview.limitations.length ? <ul>{preview.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>None stated.</p>}</div>
      </div>
      <dl className="delivery-preview-provenance">
        <div><dt>Source claim</dt><dd><span className="delivery-preview-source">{preview.finalUrl}</span></dd></div>
        <div><dt>Fetched</dt><dd>{preview.fetchedAt}</dd></div>
        <div><dt>Source SHA-256</dt><dd><code>{preview.sourceSha256}</code></dd></div>
        <div><dt>Machine result</dt><dd><a href={preview.resultUri} target="_blank" rel="noreferrer">result.json</a></dd></div>
      </dl>
      <p className="delivery-preview-note">The hash and source metadata are artifact claims bound to this job. This preview does not independently prove factual correctness or source immutability.</p>
    </div>
  );
}
