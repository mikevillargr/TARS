#!/bin/bash
set -e
cd /opt/tars/apps/web
npm run build
cp -r .next/static .next/standalone/apps/web/.next/static
cp -r public .next/standalone/apps/web/public
pm2 restart tars-web
