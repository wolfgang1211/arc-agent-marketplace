import "./v2.css";
import V2Shell from "./_components/v2-shell";
export const metadata = { title: "Agent Marketplace", description: "Find and deliver work on the agent marketplace." };
export default function V2Layout({ children }) { return <V2Shell>{children}</V2Shell>; }