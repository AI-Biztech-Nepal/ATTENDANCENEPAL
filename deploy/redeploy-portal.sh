#!/bin/bash
# Second Attendance instance for AIBIZTECH, built from the aibiztech-embed branch. The existing admin-web in ~/app (and its
# push-to-main auto-deploy) is left alone. Runs on port 3100; the portal serves it under /attendance.
# First time: git clone <this repo> ~/app-portal && cd ~/app-portal && git checkout aibiztech-embed, then create admin-web/.env.local
# (see deploy/README-portal.md). After that run:  bash ~/app-portal/deploy/redeploy-portal.sh
set -e
cd ~/app-portal
git fetch origin aibiztech-embed
git reset --hard origin/aibiztech-embed
cd admin-web
[ -f .env.local ] || { echo "Missing admin-web/.env.local - see deploy/README-portal.md"; exit 1; }
npm ci
npm run build
pm2 describe attendance-portal >/dev/null 2>&1 \
  && pm2 restart attendance-portal \
  || pm2 start npm --name attendance-portal -- start -- -p 3100
pm2 save
echo "attendance-portal is running on 127.0.0.1:3100"
