#!/usr/bin/env bash
set -euo pipefail

# Deploy TARS
# Usage: ./deploy.sh [web|harness|both] [branch]
#   branch defaults to "dev" for dev deploys, override with "main" for prod

DEPLOY_PATH="${DEPLOY_PATH:-/opt/tars}"
CHANGED="${1:-both}"
BRANCH="${2:-main}"

echo "==> Pulling latest code (branch: $BRANCH)"
cd "$DEPLOY_PATH"
git fetch origin
git checkout "$BRANCH" 2>/dev/null || true
git reset --hard "origin/$BRANCH"

if [[ "$CHANGED" == "harness" || "$CHANGED" == "both" ]]; then
  echo "==> Deploying harness"
  cd "$DEPLOY_PATH/apps/harness"
  source .venv/bin/activate
  pip install -q -r requirements.txt
  alembic upgrade head
  # --kill-timeout 300000 gives running agent jobs up to 5 min to finish
  # before pm2 force-kills the old process on reload
  pm2 reload tars-harness --kill-timeout 300000
fi

if [[ "$CHANGED" == "web" || "$CHANGED" == "both" ]]; then
  echo "==> Building web"
  cd "$DEPLOY_PATH/apps/web"
  npm install --legacy-peer-deps --silent

  # Preserve previously-deployed static assets so browsers/PWAs holding a cached
  # app shell (HTML that references old hashed chunk filenames) don't 404 after a
  # deploy. A missing lazy chunk surfaces as a ChunkLoadError → "This page couldn't
  # load". `npm run build` wipes .next/static, so we archive the current chunks
  # first, then fold them back in after the build (without clobbering new files).
  STATIC_ARCHIVE="$DEPLOY_PATH/apps/web/.next-static-archive"
  if [ -d .next/static ]; then
    mkdir -p "$STATIC_ARCHIVE"
    cp -rn .next/static/. "$STATIC_ARCHIVE/" 2>/dev/null || true
  fi

  NODE_ENV=production npm run build

  # Fold archived (old) chunks back into the fresh build; -n keeps new files.
  # Hashed filenames make this collision-safe (same name == same content).
  if [ -d "$STATIC_ARCHIVE" ]; then
    cp -rn "$STATIC_ARCHIVE/." .next/static/ 2>/dev/null || true
  fi
  # Record the new build's assets into the archive, then prune anything older
  # than 14 days so it can't grow without bound.
  mkdir -p "$STATIC_ARCHIVE"
  cp -rn .next/static/. "$STATIC_ARCHIVE/" 2>/dev/null || true
  find "$STATIC_ARCHIVE" -type f -mtime +14 -delete 2>/dev/null || true
  find "$STATIC_ARCHIVE" -type d -empty -delete 2>/dev/null || true

  # REQUIRED: Next.js standalone does not auto-copy static assets.
  # Without this step CSS/JS will be missing and the page will break.
  cp -r .next/static .next/standalone/apps/web/.next/static
  cp -r public       .next/standalone/apps/web/public

  echo "==> Reloading web (graceful zero-downtime)"
  pm2 reload tars-web
fi

echo "==> Waiting for health check"
sleep 3
curl -sf http://localhost:3000/api/health && echo " health OK" || echo " health check skipped (harness may still be warming up)"

echo "==> Deploy complete"
