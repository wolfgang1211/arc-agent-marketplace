import MarketplacePage from "../../page";

export const metadata = {
  title: "Job Details | AlphaBoard Agents",
  description: "Inspect canonical job state, lifecycle, delivery evidence, and settlement actions.",
};

export default function JobDetailPage({ params }) {
  return <MarketplacePage surface="job-detail" jobId={params?.id} />;
}
