#!/usr/bin/env bash
set -euo pipefail

# Deploy TARS to production (standalone process mode)
# Usage: ./deploy.sh [web|harness|both]

DEPLOY_PATH="${DEPLOY_PATH:-/opt/tars}"
CHANGED="${1:-both}"

echo "==> Pulling latest code"
cd "$DEPLOY_PATH"
git pull origin main

if [[ "$CHANGED" == "harness" || "$CHANGED" == "both" ]]; then
  echo "==> Deploying harness"
  cd "$DEPLOY_PATH/apps/harness"
  source .venv/bin/activate
  pip install -q -r requirements.txt
  alembic upgrade head
  screen -S harness -X quit 2>/dev/null || true
  screen -dmS harness bash -c "cd $DEPLOY_PATH/apps/harness && source .venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000 2>&1 | tee $DEPLOY_PATH/harness.log"
fi

if [[ "$CHANGED" == "web" || "$CHANGED" == "both" ]]; then
  echo "==> Building web"
  cd "$DEPLOY_PATH/apps/web"
  npm install --legacy-peer-deps --silent
  NODE_ENV=production npm run build

  # Required: copy static assets into standalone output directory
  cp -r .next/static .next/standalone/apps/web/.next/static
  cp -r public       .next/standalone/apps/web/public

  echo "==> Restarting web"
  screen -S web -X quit 2>/dev/null || true
  screen -dmS web bash -c "cd $DEPLOY_PATH/apps/web/.next/standalone/apps/web && HOSTNAME=0.0.0.0 PORT=3000 HARNESS_URL=http://localhost:8000 node server.js 2>&1 | tee /var/log/tars-web.log"
fi

echo "==> Waiting for health check"
sleep 5
curl -sf https://tarsmv.duckdns.org/api/health || (echo "Health check failed" && exit 1)

echo "==> Deploy complete"
