import "./v2.css";
import V2Shell from "./_components/v2-shell";
export const metadata = { title: "AlphaBoard V2 · Local preview", description: "Black V2 marketplace preview on Arc Testnet." };
export default function V2Layout({ children }) { return <V2Shell>{children}</V2Shell>; }