module.exports = {
  apps: [
    {
      name: "arc-marketplace-listener",
      script: "src/index.mjs",
      cwd: __dirname,
      interpreter: "node",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
