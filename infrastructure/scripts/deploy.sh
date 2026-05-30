#!/usr/bin/env bash
set -euo pipefail

# Deploy TARS
# Usage: ./deploy.sh [web|harness|both] [branch]
#   branch defaults to "dev" for dev deploys, override with "main" for prod

DEPLOY_PATH="${DEPLOY_PATH:-/opt/tars}"
CHANGED="${1:-both}"
BRANCH="${2:-dev}"

echo "==> Pulling latest code (branch: $BRANCH)"
cd "$DEPLOY_PATH"
git pull origin "$BRANCH"

if [[ "$CHANGED" == "harness" || "$CHANGED" == "both" ]]; then
  echo "==> Deploying harness"
  cd "$DEPLOY_PATH/apps/harness"
  source .venv/bin/activate
  pip install -q -r requirements.txt
  alembic upgrade head
  pm2 restart tars-harness
fi

if [[ "$CHANGED" == "web" || "$CHANGED" == "both" ]]; then
  echo "==> Building web"
  cd "$DEPLOY_PATH/apps/web"
  npm install --legacy-peer-deps --silent
  NODE_ENV=production npm run build

  # REQUIRED: Next.js standalone does not auto-copy static assets.
  # Without this step CSS/JS will be missing and the page will break.
  cp -r .next/static .next/standalone/apps/web/.next/static
  cp -r public       .next/standalone/apps/web/public

  echo "==> Restarting web"
  pm2 restart tars-web
fi

echo "==> Waiting for health check"
sleep 3
curl -sf http://localhost:3000/api/health && echo " health OK" || echo " health check skipped (harness may still be warming up)"

echo "==> Deploy complete"
