import { buildArtifact, pinArtifact } from "./artifact.mjs";
import { fetchEligibleSource } from "./safe-fetch.mjs";

export function createJobPreparer({ summarize, pinataJwt, gatewayBase, fetchSource = fetchEligibleSource, pin = pinArtifact, clock = () => new Date() }) {
  return async function prepareJob(job, request) {
    const source = await fetchSource(request.sourceUrl);
    const fetchedAt = clock().toISOString();
    const summary = await summarize({ source, language: request.language, maxWords: request.maxWords });
    const artifact = buildArtifact({
      jobId: job.id,
      sourceUrl: request.sourceUrl,
      source,
      request,
      summary,
      fetchedAt,
    });
    return pin({ artifact, pinataJwt, gatewayBase });
  };
}
