// pm2 ecosystem for TARS production.
//
// Critical: kill_timeout = 300_000 (5 min) gives running agent jobs time to
// finish on `pm2 reload`. Without this, uvicorn is SIGKILL'd before lifespan
// shutdown drains in-flight agent tasks, and they show as "cancelled" with
// no PR/deploy.
//
// --timeout-graceful-shutdown matches kill_timeout so uvicorn itself doesn't
// force-exit before its lifespan shutdown runs.
//
// Bootstrap (once on the server):
//   pm2 delete tars-harness tars-web
//   pm2 start /opt/tars/infrastructure/pm2/ecosystem.config.js
//   pm2 save
//
// Subsequent deploys use `pm2 reload <name>` from deploy.sh as today.

module.exports = {
  apps: [
    {
      name: "tars-harness",
      cwd: "/opt/tars/apps/harness",
      script: "./.venv/bin/uvicorn",
      args: [
        "main:app",
        "--host", "0.0.0.0",
        "--port", "8000",
        "--timeout-graceful-shutdown", "270",
      ].join(" "),
      kill_timeout: 300000,    // pm2 waits 5 min before SIGKILL
      wait_ready: false,
      max_memory_restart: "2G",
      autorestart: true,
    },
    {
      name: "tars-web",
      cwd: "/opt/tars/apps/web/.next/standalone/apps/web",
      script: "./server.js",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOSTNAME: "0.0.0.0",
      },
      kill_timeout: 30000,     // web has no long-running tasks
      autorestart: true,
      max_memory_restart: "1G",
    },
  ],
}
