#!/bin/bash
set -e
cd /opt/tars

echo "[deploy] Pulling latest dev..."
git pull origin dev

echo "[deploy] Restarting harness..."
pm2 restart tars-harness

echo "[deploy] Building + restarting web..."
bash /opt/tars/deploy-web.sh

echo "[deploy] Done."
pm2 list
