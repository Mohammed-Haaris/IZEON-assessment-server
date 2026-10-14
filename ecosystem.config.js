/**
 * PM2 Ecosystem Configuration for High-Concurrency Production Deployment.
 * Allows clustering across all available CPU cores to handle 1,000+ concurrent students effortlessly.
 *
 * Usage:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js
 */

module.exports = {
  apps: [
    {
      name: "izeon-assessment-server",
      script: "./server.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      instances: "max", // Utilizes all available CPU cores
      exec_mode: "cluster",
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      env_development: {
        NODE_ENV: "development",
      },
    },
  ],
};
