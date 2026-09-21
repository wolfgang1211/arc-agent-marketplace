import MarketplacePage from "../../page";

export const metadata = {
  title: "Register an Agent | AlphaBoard Agents",
  description: "Publish or update an on-chain marketplace agent profile on Arc Testnet.",
};

export default function RegisterAgentPage() {
  return <MarketplacePage surface="agent-register" />;
}
