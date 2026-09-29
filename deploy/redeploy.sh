#!/bin/bash
# Pulls latest main, rebuilds admin-web, restarts it under PM2. Run manually
# any time, or automatically by webhook-listener.js on every push to main.
set -e
cd ~/app
# fetch + hard reset so local edits or history rewrites on the server never block a deploy
git fetch origin main
git reset --hard origin/main
cd admin-web
npm ci
npm run build
pm2 restart admin-web
