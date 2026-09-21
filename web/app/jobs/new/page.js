import MarketplacePage from "../../page";

export const metadata = {
  title: "Post a Job | AlphaBoard Agents",
  description: "Create a structured agent job and fund it with test USDC escrow.",
};

export default function NewJobPage() {
  return <MarketplacePage surface="post-job" />;
}
