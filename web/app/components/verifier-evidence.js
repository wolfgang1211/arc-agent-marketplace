"use client";

import { useEffect, useRef, useState } from "react";
import { keccak256, stringToHex } from "viem";
import { REPORT_LIMIT, REPORT_WARNING, VERDICT_COPY, validateVerifierReport } from "../../lib/verifier-report.mjs";

export function VerifierEvidenceResult({ result }) {
  if (!result) return null;
  if (!result.ok) return <p role="status">{result.reason}</p>;
  const report = result.report;
  return <div className="verifier-result" role="status">
    <strong>Advisory evidence only</strong>
    <p>Signature and supplied bindings match. Not an on-chain acceptance or a validated protocol assessment.</p>
    <dl>
      <dt>Verifier-reported outcome</dt><dd>{VERDICT_COPY[report.verdict]}</dd>
      <dt>Selected verifier (ECDSA signature)</dt><dd>{report.verifier}</dd>
      <dt>Job</dt><dd>{report.jobId}</dd>
      <dt>Artifact URI (not fetched)</dt><dd>{report.artifactURI}</dd>
      <dt>Artifact SHA-256 (user-supplied comparison)</dt><dd>{report.artifactSha256}</dd>
      <dt>Criteria keccak256 (user-supplied comparison)</dt><dd>{report.criteriaHash}</dd>
    </dl>
    <p>{REPORT_WARNING}</p>
    <p>Address separation does not prove independent ownership. Signature recovery proves key control, not account type. No criteria, artifact bytes, assignment consent, deployment code, publication timing or challenge history were verified. A mutable URL may now serve different bytes.</p>
  </div>;
}

// Only public job data flows in. No transaction callbacks or wallet access.
// Parent keys this inspector by the entire displayed job snapshot so a refresh
// cannot show evidence validated for a different URI, role, status or request.
export function VerifierEvidence({ job, chainId, marketplace }) {
  const [draft, setDraft] = useState({ report: "", verifier: "", artifactSha256: "", criteriaHash: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const update = (key, value) => {
    generation.current++;
    setBusy(false);
    setResult(null);
    if (key === "report" && (value.length > REPORT_LIMIT || new TextEncoder().encode(value).length > REPORT_LIMIT)) {
      setDraft((current) => ({ ...current, report: "" }));
      setResult({ ok: false, reason: "Report exceeds 16 KiB. Nothing was inspected or truncated." });
      return;
    }
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const inspect = async () => {
    const current = ++generation.current;
    setResult(null);
    setBusy(true);
    const outcome = await validateVerifierReport(draft.report, {
      chainId: String(chainId), marketplace, jobId: job.id.toString(),
      client: job.client, producer: job.agent,
      requestHash: keccak256(stringToHex(job.description)), artifactURI: job.deliverableURI,
      verifier: draft.verifier, artifactSha256: draft.artifactSha256, criteriaHash: draft.criteriaHash,
    });
    if (generation.current === current) { setResult(outcome); setBusy(false); }
  };
  return <details className="verifier-evidence">
    <summary>Inspect optional verifier evidence</summary>
    <p>{REPORT_WARNING}</p>
    <p>Local preview only, disabled until you inspect a report. No upload, fetch, wallet signature, payment or automatic settlement. Existing approval, dispute and timeout actions remain unchanged.</p>
    <p>Choose the verifier and supply independently obtained artifact SHA-256 and criteria keccak256 digests. Copying these from the report does not independently validate its evidence. This does not activate the proposed verifier protocol.</p>
    <label>Selected verifier address<input value={draft.verifier} maxLength={42} onChange={(e) => update("verifier", e.target.value)} placeholder="0x…" spellCheck={false} /></label>
    <label>Expected artifact SHA-256<input value={draft.artifactSha256} maxLength={66} onChange={(e) => update("artifactSha256", e.target.value)} placeholder="0x + 64 hex characters" spellCheck={false} /></label>
    <label>Expected criteria keccak256<input value={draft.criteriaHash} maxLength={66} onChange={(e) => update("criteriaHash", e.target.value)} placeholder="0x + 64 hex characters" spellCheck={false} /></label>
    <label>Verifier report JSON (verifier-report-v1, maximum 16 KiB)<textarea value={draft.report} rows={6} onChange={(e) => update("report", e.target.value)} spellCheck={false} /></label>
    <div className="verifier-controls"><button type="button" disabled={busy || !draft.report || !draft.verifier || !draft.artifactSha256 || !draft.criteriaHash} onClick={inspect}>{busy ? "Checking signature…" : "Inspect report locally"}</button>
      <button type="button" className="ghost" onClick={() => { generation.current++; setDraft({ report: "", verifier: "", artifactSha256: "", criteriaHash: "" }); setResult(null); setBusy(false); }}>Clear evidence</button></div>
    <VerifierEvidenceResult result={result} />
  </details>;
}
