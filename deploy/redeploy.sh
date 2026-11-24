#!/bin/bash
# Pulls latest main, rebuilds admin-web, restarts it under PM2. Run manually
# any time, or automatically by webhook-listener.js on every push to main.
#
# The build goes into .next-build, not .next. The running server keeps serving
# the old .next untouched while the build runs, and the new build replaces it
# only once it has succeeded. Building straight into .next wiped the live
# site's CSS/JS mid-deploy (and for good when a build failed), so pages loaded
# with no styling and the stylesheet answered 500.
#
# Everything sits inside { ... } so bash reads the whole script before running
# it: the git reset below rewrites this very file mid-run.
{
set -e
cd ~/app
# fetch + hard reset so local edits or history rewrites on the server never block a deploy
git fetch origin main
git reset --hard origin/main
cd admin-web
npm ci

rm -rf .next-build
NEXT_DIST_DIR=.next-build npm run build

# Keep the previous build's hashed CSS/JS next to the new ones, so a page that
# was opened just before the switch can still load its files.
if [ -d .next/static ]; then
  cp -rn .next/static/. .next-build/static/
fi
rm -rf .next-old
if [ -d .next ]; then mv .next .next-old; fi
mv .next-build .next
pm2 restart admin-web
exit 0
}
