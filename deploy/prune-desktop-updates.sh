#!/bin/bash
# Deletes superseded desktop installers from the update folder, keeping only the
# version latest.yml currently advertises.
#
# Safe to run on every publish: electron-updater builds a differential update
# from the copy already installed on the client, not from an older file on the
# server, so nothing here is ever read again once latest.yml stops pointing at
# it. Each release is ~80 MB, so without this the folder grows forever.
#
# Usage, on the VPS, after scp-ing a new Setup exe + blockmap + latest.yml:
#   ./prune-desktop-updates.sh
#   pm2 restart admin-web
set -e

DIR="${1:-$HOME/app/admin-web/public/desktop-updates}"
cd "$DIR"

if [ ! -f latest.yml ]; then
  echo "No latest.yml in $DIR — refusing to guess which version is current." >&2
  exit 1
fi

CURRENT=$(grep -m1 '^version:' latest.yml | awk '{print $2}' | tr -d '\r')
if [ -z "$CURRENT" ]; then
  echo "Could not read a version out of latest.yml." >&2
  exit 1
fi

# Guard against a half-finished upload: latest.yml arriving before its exe
# would otherwise mean deleting every installer and serving none.
if ! ls -- *"$CURRENT"*.exe >/dev/null 2>&1; then
  echo "latest.yml says $CURRENT but no matching .exe is here — upload finished?" >&2
  exit 1
fi

echo "Keeping $CURRENT, removing everything older:"
removed=0
for f in *.exe *.exe.blockmap; do
  [ -e "$f" ] || continue
  case "$f" in
    *"$CURRENT"*) ;;
    *) echo "  rm $f"; rm -f -- "$f"; removed=$((removed + 1)) ;;
  esac
done

echo "Removed $removed file(s); $(du -sh . | cut -f1) remains in $DIR."
