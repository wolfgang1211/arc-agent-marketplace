"use client";

import { useEffect, useState } from "react";
import { classifyJobExecutability, selectCurrentPreflight } from "../../lib/job-executability.mjs";

export function useJobExecutability(job, fetchImpl = globalThis.fetch) {
  const staticClassification = classifyJobExecutability(job);
  const [preflight, setPreflight] = useState(null);

  useEffect(() => {
    setPreflight(null);
    if (staticClassification.state !== "checking") return undefined;

    let active = true;
    const controller = new AbortController();
    const sourceUrl = staticClassification.request.sourceUrl;
    setPreflight({ sourceUrl, result: { state: "pending" } });
    Promise.resolve(fetchImpl("/api/source-preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceUrl }),
      cache: "no-store",
      signal: controller.signal,
    }))
      .then(async (response) => {
        const payload = await response.json();
        if (!active) return;
        if (response.ok && payload?.ok === true && Object.keys(payload).length === 1) {
          setPreflight({ sourceUrl, result: payload });
          return;
        }
        setPreflight({ sourceUrl, result: { reason: payload?.reason, retryable: payload?.retryable === true } });
      })
      .catch(() => {
        if (active) setPreflight({ sourceUrl, result: { state: "unavailable" } });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [fetchImpl, staticClassification.state, staticClassification.request?.sourceUrl]);

  const currentPreflight = selectCurrentPreflight(preflight, staticClassification.request);
  return staticClassification.state === "checking"
    ? classifyJobExecutability(job, currentPreflight)
    : staticClassification;
}

export function JobExecutability({ classification }) {
  if (!classification || classification.state === "hidden") return null;
  return (
    <div className={`job-executability job-executability-${classification.state}`} role="status">
      <strong>{classification.label}</strong>
      <span>{classification.reason}</span>
    </div>
  );
}
