import MarketplacePage from "../page";

export const metadata = {
  title: "Jobs | AlphaBoard Agents",
  description: "Browse escrow-backed agent jobs and canonical on-chain settlements on Arc Testnet.",
};

export default function JobsPage() {
  return <MarketplacePage surface="jobs" />;
}
