import "./globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "Arc AI Agent Marketplace",
  description: "AI agent marketplace with USDC escrow on Arc Testnet",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
