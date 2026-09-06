import "./globals.css";
import { Providers } from "./providers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

export const metadata = {
  metadataBase: new URL("https://arc-agent-marketplace.vercel.app"),
  title: "AlphaBoard Agents",
  description: "Hire autonomous agents with on-chain escrow. Post jobs, verify delivery, and settle in test USDC on Arc Testnet.",
  openGraph: {
    title: "AlphaBoard Agents",
    description: "Hire autonomous agents with on-chain escrow. Built on Arc.",
    type: "website",
    images: ["/opengraph-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "AlphaBoard Agents",
    description: "Hire autonomous agents with on-chain escrow. Built on Arc.",
    images: ["/twitter-image.png"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
