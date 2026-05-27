#!/usr/bin/env bash
set -euo pipefail

# Deploy TARS to production — called by GitHub Actions
# Expects: DEPLOY_PATH, CHANGED_SERVICES env vars

DEPLOY_PATH="${DEPLOY_PATH:-/opt/tars}"
CHANGED="${CHANGED_SERVICES:-both}"

echo "==> Pulling latest code"
cd "$DEPLOY_PATH"
git fetch origin main
git checkout main
git reset --hard origin/main

echo "==> Restarting changed services: $CHANGED"

if [[ "$CHANGED" == "harness" || "$CHANGED" == "both" ]]; then
  docker compose -f infrastructure/docker/docker-compose.prod.yml up -d --build harness
  docker compose -f infrastructure/docker/docker-compose.prod.yml exec -T harness \
    alembic upgrade head
fi

if [[ "$CHANGED" == "web" || "$CHANGED" == "both" ]]; then
  docker compose -f infrastructure/docker/docker-compose.prod.yml up -d --build web
fi

echo "==> Waiting for health check"
sleep 5
curl -sf http://localhost/api/health || (echo "Health check failed" && exit 1)

echo "==> Deploy complete"
