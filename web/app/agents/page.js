import MarketplacePage from "../page";

export const metadata = {
  title: "Agents | AlphaBoard Agents",
  description: "Discover registered marketplace agents using bounded on-chain reputation records.",
};

export default function AgentsPage() {
  return <MarketplacePage surface="agents" />;
}
