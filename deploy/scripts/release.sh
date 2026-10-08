#!/usr/bin/env bash
# Upload committed AdsPilot code to the server and (re)start it. Runs on the
# OWNER'S PC in Git Bash, from anywhere inside the repository. Only with the
# owner's approval (AGENTS.md: deployment needs explicit approval).
#
#   deploy/scripts/release.sh               upload HEAD, build, restart, check
#   deploy/scripts/release.sh --upload-only upload HEAD into a new release folder, nothing else
#   deploy/scripts/release.sh --rollback    switch back to the previous release
#
# How (the Raptor pattern): `git archive HEAD source deploy` is unpacked into a
# NEW folder /opt/adspilot/releases/<commit>, and /opt/adspilot/app is switched
# to it. A fresh folder per release, so a file deleted in git (a migration, say)
# is really gone on the server. The image is tagged with the commit, so the
# previous one stays available for --rollback. No GitHub login on the server.
#
# It refuses to start code whose migrations are not yet applied to the database
# (`prisma migrate status`); applying them is a separate, approved step.

set -Eeuo pipefail
HOST=${ADSPILOT_HOST:-root@37.27.148.217}
KEY=${ADSPILOT_SSH_KEY:-$HOME/.ssh/raptor_hetzner}
H=/opt/adspilot
rs() { ssh -i "$KEY" -o BatchMode=yes "$HOST" "$@"; }

cd "$(git rev-parse --show-toplevel)"
MODE=${1:-release}

if [ "$MODE" = --rollback ]; then
  rs "set -e
    cur=\$(readlink -f $H/app); prev=\$(cat $H/releases/.previous 2>/dev/null || true)
    [ -n \"\$prev\" ] && [ -d \"$H/releases/\$prev\" ] || { echo 'no previous release recorded' >&2; exit 1; }
    ln -sfn releases/\$prev $H/app
    sed -i \"s/^ADSPILOT_TAG=.*/ADSPILOT_TAG=\$prev/\" $H/compose.env
    echo \$(basename \"\$cur\") > $H/releases/.previous
    $H/app/deploy/scripts/dc.sh up -d --wait mcp && $H/app/deploy/scripts/dc.sh up -d worker
    echo \"rolled back to \$prev\""
  exit 0
fi

if [ -n "$(git status --porcelain -- source deploy)" ]; then
  echo "Refusing to release: commit the changes under source/ and deploy/ first." >&2
  git status --short -- source deploy >&2
  exit 1
fi
sha=$(git rev-parse --short=12 HEAD)
echo "== uploading $sha (source/ and deploy/ as committed) =="
rs "mkdir -p $H/releases && rm -rf $H/releases/$sha.partial && mkdir $H/releases/$sha.partial"
git -c core.autocrlf=false archive HEAD source deploy | rs "tar -x -C $H/releases/$sha.partial"
rs "set -e; cd $H/releases
    if [ -d $sha ]; then rm -rf $sha.partial; else mv $sha.partial $sha; fi
    chmod 755 $sha"
[ "$MODE" = --upload-only ] && { echo "uploaded to $H/releases/$sha (not switched)"; exit 0; }

echo "== building the image adspilot:$sha =="
rs "set -e
    cd $H/releases/$sha/deploy
    ADSPILOT_TAG=$sha ./scripts/dc.sh build mcp 2>&1 | tail -n 5"

echo "== checking the database schema matches this code (read-only) =="
if ! rs "ADSPILOT_TAG=$sha $H/releases/$sha/deploy/scripts/dc.sh run --rm -T migrate migrate status </dev/null"; then
  echo "STOPPED: migrations are pending (or the database is unreachable). Nothing was switched." >&2
  echo "Apply them only with the owner's approval, then run this again." >&2
  exit 1
fi

echo "== switching to $sha and restarting =="
rs "set -e
    cur=\$(readlink -f $H/app 2>/dev/null || true)
    [ -n \"\$cur\" ] && basename \"\$cur\" > $H/releases/.previous
    ln -sfn releases/$sha $H/app
    sed -i 's/^ADSPILOT_TAG=.*/ADSPILOT_TAG=$sha/' $H/compose.env
    $H/app/deploy/scripts/dc.sh up -d --wait mcp
    $H/app/deploy/scripts/dc.sh up -d worker
    # keep the newest 3 releases
    cd $H/releases && ls -1dt */ | tail -n +4 | xargs -r rm -rf
    # and only their images: each release adds a ~0.7 GB image (2026-10-08 the
    # disk went from 27% to 59% in one day of releases). Old build cache too.
    keep=\$(ls -1 $H/releases)
    for t in \$(docker images adspilot --format '{{.Tag}}'); do
      echo \"\$keep\" | grep -qx \"\$t\" || docker rmi \"adspilot:\$t\" >/dev/null 2>&1 || true
    done
    docker builder prune -f --filter until=72h >/dev/null 2>&1 || true"

echo "== checking the live MCP =="
code=000
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 https://mcp.1920agency.com/health || true)
  [ "$code" = 200 ] && break
  sleep 2
done
echo "  $code https://mcp.1920agency.com/health"
[ "$code" = 200 ] || { echo "Live check failed. Roll back with: deploy/scripts/release.sh --rollback" >&2; exit 1; }
echo "Released $sha."
