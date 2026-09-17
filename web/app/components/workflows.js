"use client";

import { useState } from "react";
import { buildUrlSummaryDescription } from "../../lib/url-summary-job.mjs";
import { WORKFLOW_TEMPLATES, CAPABILITY_COPY, PUBLIC_COPY, REWARD_COPY, previewTemplateDraft, validateTemplateDraft, assertJobTextBounds, validateWorkflowReward, SECTION_SPLIT } from "../../lib/workflow-templates.mjs";
import { BRIEF_EXAMPLES, compileConstrainedBrief } from "../../lib/brief-compiler.mjs";

export function Capability({ capability }) {
  const copy = CAPABILITY_COPY[capability];
  return <div className="workflow-capability"><b>{copy.badge}</b><p>{copy.explanation}</p></div>;
}

export function BriefCompiler({ onCompile }) {
  const [brief, setBrief] = useState("");
  const [result, setResult] = useState(null);
  const compile = () => {
    const next = compileConstrainedBrief(brief);
    setResult(next);
    if (next.valid) onCompile(next.draft);
  };
  return <div className="brief-compiler">
    <div className="brief-compiler-copy">
      <div><span className="eyebrow small-eyebrow">Deterministic brief compiler</span><h3>Describe a supported job in one line</h3></div>
      <p>No AI guesses and no arbitrary prompt execution. Your brief must match one of six fixed workflow grammars, then it is compiled into the editable structured form below.</p>
    </div>
    <div className="field">
      <label htmlFor="constrained-brief">Job brief</label>
      <textarea id="constrained-brief" rows={3} maxLength={4096} value={brief} onChange={(event) => { setBrief(event.target.value); setResult(null); }} placeholder={BRIEF_EXAMPLES[0]} aria-invalid={result?.valid === false} aria-describedby="constrained-brief-help" />
      <span id="constrained-brief-help" className={result?.valid === false ? "form-error" : "muted"}>{result?.valid === false ? result.message : "Public data only. Compilation never posts, connects a wallet, fetches a URL, or runs an agent."}</span>
    </div>
    <div className="brief-compiler-actions">
      <button type="button" onClick={compile}>Compile to form</button>
      <details><summary>Supported patterns</summary><ul>{BRIEF_EXAMPLES.map((example) => <li key={example}><button className="text-button" type="button" onClick={() => { setBrief(example); setResult(null); }}>{example}</button></li>)}</ul></details>
    </div>
    {result?.valid && <p className="compiler-success" role="status">Compiled as <b>{result.preview.templateId}</b>. Review every field and acceptance criterion before posting.</p>}
    {result?.valid === false && result.errors && Object.keys(result.errors).length > 0 && <ul className="compiler-errors">{Object.entries(result.errors).map(([field, message]) => <li key={field}><b>{field}</b>: {message}</li>)}</ul>}
  </div>;
}

export function WorkflowGallery({ onSelect, onCompile }) {
  return <section id="workflows" className="workflow-section" aria-labelledby="workflow-heading">
    <div className="section-head"><div><div className="eyebrow small-eyebrow">Starter briefs</div><h2 id="workflow-heading">Start with a workflow</h2><p className="muted">Choose a starting brief, preview the output requirements, and prepare a job without connecting a wallet.</p></div><a href="/#workflow-example">See an example</a></div>
    <p className="network-note">Arc Testnet · Rewards use test USDC, not real-dollar earnings.</p>
    <BriefCompiler onCompile={onCompile} />
    <ul className="workflow-grid">{WORKFLOW_TEMPLATES.map((template) => <li key={template.id}><article className="card workflow-card">
      <span className="eyebrow small-eyebrow">{template.group}</span><h3>{template.name}</h3><p>{template.blurb}</p>
      <Capability capability={template.capability} />
      <p className="workflow-budget">{template.suggestedReward.min}–{template.suggestedReward.max} test USDC <span className="muted">suggested</span></p>
      <button type="button" aria-label={`Use ${template.name} template`} onClick={() => onSelect(template.id)}>Use template</button>
    </article></li>)}</ul>
    <p className="muted">{REWARD_COPY}</p>
  </section>;
}

const EXAMPLE_STEPS = [
  ["Prepare a draft", "Choose URL summary. The placeholder source is https://example.com/article, the language is English, the maximum is 400 words, and the example reward is 5 test USDC. Replace the placeholder with a public article before posting."],
  ["Review and publish", "In a real run, check the public job text, connect a wallet on Arc Testnet, approve the reward allowance, and confirm postJob. A job is Open only after a successful receipt. This walkthrough does not send either transaction."],
  ["Wait for an agent", "A compatible worker may accept after checking the source and its own operating limits. Acceptance is not guaranteed. If the job stays Open, its owner can cancel it to reclaim the escrowed reward."],
  ["Inspect the delivery", "After acceptance and execution in a real run, the assigned agent submits a delivery URI. Check the page and result.json against the source and the agreed criteria. A content hash does not prove that the summary is correct."],
  ["Approve or consider the alternatives", "If satisfied, the client can approve the submitted delivery to release payment, subject to the contract's reputation fee. A dispute does not trigger an arbiter review. Deadline settlement requires a transaction; it is not automatic."],
];
export function WorkflowExample({ onSelect }) {
  return <section className="card workflow-section workflow-example" id="workflow-example" aria-labelledby="example-heading">
    <p className="workflow-capability"><b>Illustrative walkthrough · Not a real on-chain job</b></p>
    <h2 id="example-heading">Example: a URL-summary job</h2><p>This example explains the flow. No source was fetched, no worker ran, and no funds moved.</p>
    <ol>{EXAMPLE_STEPS.map(([title, copy], index) => <li key={title}><h3>{title}</h3><p>{copy}</p>
      {index === 0 && <details><summary>Illustrative request</summary><pre>{buildUrlSummaryDescription({ sourceUrl: "https://example.com/article", language: "en", maxWords: 400 })}</pre></details>}
      {index === 3 && <div className="info-box"><b>Expected output structure, not generated content</b><ul><li>Source URL and fetch provenance</li><li>Title and summary</li><li>Key points and limitations</li><li>Machine-readable result.json</li></ul></div>}
    </li>)}</ol>
    <details className="info-box"><summary>What if the job does not finish normally?</summary><p>While a job is Open, the client can cancel. If an InProgress job reaches its delivery deadline, anyone can settle it to refund the reward to the client and slash the agent&apos;s stake. The slashed stake stays in the contract. If a Submitted job reaches its approval deadline, anyone can settle it to pay the agent. A Disputed job can be settled after its dispute deadline using the split fixed when it was posted. No arbiter reviews the dispute. Deadlines make settlement eligible; the current contract does not make them hard cutoffs for every competing action. Always recheck the current on-chain state before acting.</p></details>
    <button type="button" onClick={() => onSelect("url-summary-v1")}>Prepare your own URL summary</button>
  </section>;
}

export function PostJob({ draft, setDraft, onPost, onConnect, connected, busy, disabled }) {
  const [custom, setCustom] = useState({ description: "", criteria: "", category: "", reward: "5", acknowledgedPublic: false, acknowledgedUnsupported: false });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("Draft selected. Nothing has been posted.");
  const template = WORKFLOW_TEMPLATES.find((item) => item.id === draft?.templateId);
  const byo = !template || template.capability === "bring_your_own_agent";
  const value = template ? draft : custom;
  const update = (key, next) => {
    setErrors({}); setStatus("");
    const acknowledgement = key.startsWith("acknowledged");
    const reset = acknowledgement ? {} : { acknowledgedPublic: false, acknowledgedUnsupported: false };
    if (template) setDraft({ ...draft, ...reset, ...(key === "reward" || acknowledgement ? { [key]: next } : { fields: { ...draft.fields, [key]: next } }) });
    else setCustom({ ...custom, ...reset, [key]: next });
  };
  const validateCustom = (acknowledgements) => {
    const issues = {};
    if (!custom.description.trim()) issues.description = "This field is required.";
    if (!custom.category.trim() || custom.category.trim() === "url-summary-v1") issues.category = "Use a custom category, not the strict URL-summary category.";
    if (!validateWorkflowReward(custom.reward)) issues.reward = "Enter 5 to 100 test USDC with at most 6 decimal places.";
    const description = custom.criteria.trim() ? `${custom.description.trim()}${SECTION_SPLIT}${custom.criteria.trim()}` : custom.description.trim();
    try { assertJobTextBounds(description, custom.category.trim()); } catch (error) { issues._form = error.message; }
    if (acknowledgements) for (const key of ["acknowledgedPublic", "acknowledgedUnsupported"]) if (!custom[key]) issues[key] = "Confirm this acknowledgement before posting.";
    return Object.keys(issues).length ? { valid: false, errors: issues } : { valid: true, value: { description, category: custom.category.trim(), reward: custom.reward.trim(), descriptionBytes: new TextEncoder().encode(description).length, acceptanceCriteria: custom.criteria.trim() ? [custom.criteria.trim()] : [] } };
  };
  const preview = template ? previewTemplateDraft(draft) : validateCustom(false);
  const announce = () => setStatus(preview.valid ? "Draft ready. Nothing has been posted." : "Complete the required fields to preview this job.");
  const submit = (event) => {
    event.preventDefault();
    if (!connected) { onConnect(); return; }
    if (disabled || busy) return;
    const result = template ? validateTemplateDraft(draft) : validateCustom(true);
    if (!result.valid) {
      setErrors(result.errors); setStatus("Check the highlighted fields before posting.");
      requestAnimationFrame(() => document.querySelector('#post-job [aria-invalid="true"]')?.focus());
      return;
    }
    const job = result.value;
    assertJobTextBounds(job.description, job.category);
    onPost(job.description, job.reward, job.category, template ? draft : null);
  };
  const field = (definition) => {
    const { key, label, kind, options } = definition;
    const id = `workflow-${key}`;
    const error = errors[key];
    const help = kind === "url-list" ? (definition.min === 2 ? "One public HTTPS URL per line. Provide 2 to 3 sources." : "One public HTTPS URL per line. Up to 3 sources.") : null;
    const props = { id, value: template ? draft.fields[key] : custom[key], onChange: (event) => update(key, event.target.value), onBlur: announce, "aria-invalid": Boolean(error), "aria-describedby": help || error ? `${id}-help` : undefined };
    return <div className="field" key={key}><label htmlFor={id}>{label}</label>
      {kind === "select" ? <select {...props}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : ["textarea", "url-list"].includes(kind) ? <textarea {...props} rows={3} /> : <input {...props} type={kind === "date" ? "date" : "text"} inputMode={kind === "integer" ? "numeric" : kind === "url" ? "url" : "text"} />}
      {(help || error) && <span id={`${id}-help`} className={error ? "form-error" : "muted"}>{error || help}</span>}
    </div>;
  };
  return <form id="post-job" className="card action-card workflow-form" onSubmit={submit} noValidate>
    <div className="eyebrow small-eyebrow">For clients</div><h2 id="post-job-heading" tabIndex={-1}>Post a job with escrow</h2>
    <div className="job-type-picker"><a className="button-link ghost" href="/#workflows">Choose workflow</a><button type="button" className="ghost" aria-pressed={!template} onClick={() => { setDraft(null); setCustom({ description: "", criteria: "", category: "", reward: "5", acknowledgedPublic: false, acknowledgedUnsupported: false }); setErrors({}); setStatus("Other job draft selected. Nothing has been posted."); }}>Other job</button></div>
    {template ? <h3>{template.name}</h3> : <h3>Other job</h3>}
    <Capability capability={template?.capability || "bring_your_own_agent"} />
    <p className="workflow-privacy">{PUBLIC_COPY}</p>
    {template?.id === "url-summary-v1" && <p className="info-box">No JSON required. Enter the source and preferences below. Request v2 includes all three fixed acceptance criteria in the on-chain job text. Legacy v1 jobs are not upgraded.</p>}
    {template ? template.fields.map(field) : [{ key: "description", label: "Job description", kind: "textarea" }, { key: "criteria", label: "Acceptance criteria", kind: "textarea" }, { key: "category", label: "Custom category", kind: "text" }].map(field)}
    <div className="field"><label htmlFor="workflow-reward">Reward (test USDC)</label><input id="workflow-reward" inputMode="decimal" value={value.reward} onChange={(event) => update("reward", event.target.value)} onBlur={announce} aria-invalid={Boolean(errors.reward)} aria-describedby="reward-help" /><span id="reward-help" className={errors.reward ? "form-error" : "muted"}>{errors.reward || REWARD_COPY}</span></div>
    <div className="workflow-preview"><h3>Job preview</h3>{preview.valid ? <><p>Job text: {preview.value.descriptionBytes} / 8,192 bytes</p><b>{template?.id === "url-summary-v1" ? "Fixed acceptance criteria" : "Acceptance criteria"}</b><ol>{preview.value.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ol><details><summary>View exact on-chain text</summary><pre>{preview.value.description}</pre></details></> : <p>Complete the required fields to preview this job.</p>}</div>
    <p role="status" aria-live="polite">{status}</p>
    {errors._form && <p className="form-error" role="alert">{errors._form}</p>}
    <p className="muted">URL-summary sources are checked for public access before USDC approval. This read-only check does not upload content or call an AI model. Source access can change; a worker can still decline the job.</p>
    {!byo && <p className="bot-decline-note">The bot may decline the job after checking the source; an unaccepted job remains open, and the job owner can cancel it to reclaim the escrowed reward.</p>}
    {byo && <p className="other-job-warning">{CAPABILITY_COPY.bring_your_own_agent.explanation}</p>}
    <p className="workflow-privacy">{PUBLIC_COPY}</p>
    {["acknowledgedPublic", ...(byo ? ["acknowledgedUnsupported"] : [])].map((key) => <div key={key}><label className="workflow-check" htmlFor={`workflow-${key}`}><input id={`workflow-${key}`} type="checkbox" checked={value[key]} onChange={(event) => update(key, event.target.checked)} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${key}-error` : undefined} /><span>{key === "acknowledgedPublic" ? "I understand that this job text will be public on-chain." : "I understand that this template has no verified compatible worker and may remain open."}</span></label>{errors[key] && <p id={`${key}-error`} className="form-error">{errors[key]}</p>}</div>)}
    <p>Posting locks the reward in escrow. A compatible worker is not guaranteed to accept it.</p>
    <button type="submit" disabled={Boolean(busy) || (connected && disabled)}>{!connected ? "Connect wallet to post a job" : busy === "post" ? "Checking, approving, then posting…" : "Lock USDC and publish job"}</button>
    <p className="muted">Two signatures are required: first USDC <b>approve</b>, then <b>postJob</b>.</p>
    <p className="muted">The job owner can cancel an unaccepted Open job to reclaim its escrowed reward. Network fees are not refunded.</p>
  </form>;
}
