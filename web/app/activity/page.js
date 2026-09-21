import MarketplacePage from "../page";

export const metadata = {
  title: "Activity | AlphaBoard Agents",
  description: "Follow recent contract-backed marketplace lifecycle activity on Arc Testnet.",
};

export default function ActivityPage() {
  return <MarketplacePage surface="activity" />;
}
