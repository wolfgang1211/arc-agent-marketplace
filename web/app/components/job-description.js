import { parseUrlSummaryDescription, URL_SUMMARY_CATEGORY } from "../../lib/url-summary-schema.mjs";

export function JobDescription({ description = "", category }) {
  if (category === URL_SUMMARY_CATEGORY) {
    const parsed = parseUrlSummaryDescription(description);
    return <>
      <h3>URL summary</h3>
      {parsed.ok ? <>
        <p>Source: {parsed.request.sourceUrl}</p>
        <p>Language: {parsed.request.language} · Maximum summary words: {parsed.request.maxWords}</p>
        {parsed.request.schemaVersion === 2 ? <div className="criteria-box">
          <span>Acceptance criteria recorded on-chain · Request v2</span>
          <ol>{parsed.request.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ol>
          <p>Requirements only, not a verification verdict.</p>
        </div> : <p className="info-box">Legacy request v1: acceptance criteria were not recorded in the request. No v2 criteria are inferred.</p>}
      </> : <p className="info-box">Unsupported or malformed URL-summary request. Acceptance criteria cannot be interpreted safely.</p>}
      <details><summary>View exact on-chain text</summary><pre>{description}</pre></details>
    </>;
  }
  const [task, criteria] = String(description).split("\n\nAcceptance criteria:\n");
  return <><h3>{task || description}</h3>{criteria && <div className="criteria-box"><span>Acceptance criteria</span><p>{criteria}</p></div>}</>;
}
