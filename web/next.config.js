/** @type {import('next').NextConfig} */
// Evaluate before Next config compilation so an unknown profile or local witness can never reach
// production or Vercel, including `next start`.
if (process.env.V2_CHAIN_PROFILE !== undefined && process.env.V2_CHAIN_PROFILE !== 'arc-testnet' && process.env.V2_CHAIN_PROFILE !== 'local-hardhat') {
  throw new Error('unknown V2_CHAIN_PROFILE');
}
if (process.env.V2_CHAIN_PROFILE === 'local-hardhat' && (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL)) {
  throw new Error('local V2 chain profile is forbidden in production/Vercel');
}
const nextConfig = {
  reactStrictMode: true,
  ...(process.env.V2_CHAIN_PROFILE === 'local-hardhat' ? { distDir: '.next-v2-local' } : {}),
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    return config;
  },
};

module.exports = nextConfig;
