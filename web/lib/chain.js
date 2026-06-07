import { defineChain } from "viem";

// Arc Testnet — verified against https://docs.arc.io/arc/references/connect-to-arc
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
      webSocket: ["wss://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: { name: "Arcscan Testnet", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

// Official Arc Testnet ERC-20 USDC (6 decimals).
// Verify at https://docs.arc.io/arc/references/contract-addresses
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
export const USDC_DECIMALS = 6;

export const EXPLORER = "https://testnet.arcscan.app";
export const FAUCET = "https://faucet.circle.com";
