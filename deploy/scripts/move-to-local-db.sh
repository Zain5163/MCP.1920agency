#!/usr/bin/env bash
# Phase B (decision 0010): move AdsPilot's data from Supabase to the Postgres
# on this server, verify it row for row, and switch the MCP and worker to it.
# Needs the owner's approval and a short maintenance window.
#
#   move-to-local-db.sh --writers-stopped      do the move
#   move-to-local-db.sh --rollback             point everything back at Supabase
#
# --writers-stopped is the operator saying that nothing else writes to Supabase
# during the move: the PC's AdsPilot-Worker / -Monitor / -Refresh tasks are
# disabled, VS Code's local AdsPilot MCP and the dashboard are closed. This
# script stops the server's own MCP and worker itself.
#
# Supabase is only READ. It keeps every row, so it stays the fallback, and the
# encrypted backup taken first is a second one.
#
# What --rollback does NOT do: copy back rows written on this server after the
# switch (new posts, tool_calls). Roll back soon after the move, or move those
# rows by hand; deploy/README.md, "Rollback B".

# shellcheck source=common.sh
. "$(dirname "$0")/common.sh"

ACTION=""
case ${1:-} in
  --writers-stopped) ACTION=move ;;
  --rollback) ACTION=rollback ;;
  *) sed -n '2,19p' "$0"; exit 1 ;;
esac
require_root_or_docker

set_profiles() { sed -i "s/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=$1/" "$COMPOSE_ENV"; }

if [ "$ACTION" = rollback ]; then
  copy=$(ls -1t "$ADSPILOT_HOME"/env/adspilot.env.supabase-* 2>/dev/null | head -n 1 || true)
  [ -n "$copy" ] || die "no saved Supabase env file (env/adspilot.env.supabase-*)."
  say "stopping the MCP and the worker"
  dc stop mcp worker
  say "restoring $(basename "$copy") as the env file"
  cp -p "$APP_ENV" "$APP_ENV.local-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$copy" "$APP_ENV"
  chmod 600 "$APP_ENV"
  set_profiles ""
  dc up -d --wait mcp || die "the MCP did not become healthy on Supabase. Look at: dc.sh logs mcp"
  dc up -d worker
  say "back on Supabase. Postgres on this server is left as it is (stopped by: dc.sh --profile db stop postgres)."
  say "Then switch the PC back: its .env DATABASE_URL/DIRECT_URL to the Supabase values, tasks re-enabled."
  exit 0
fi

# --- move -----------------------------------------------------------------------------
[ "$(db_mode)" = remote ] || die "DATABASE_URL already points at this server's Postgres. Nothing to move."
[ -s "$PG_PASSWORD_FILE" ] || die "no $PG_PASSWORD_FILE (run setup.sh once)."

say "1/7 encrypted backup of Supabase first (the rollback point)"
"$DEPLOY_DIR/scripts/backup.sh"

say "2/7 stopping the server's MCP and worker"
dc stop mcp worker

stamp=$(date -u +%Y%m%dT%H%M%SZ)
saved="$APP_ENV.supabase-$stamp"
SRC_URL=$(libpq_url "$(env_value DIRECT_URL)")
[ -n "$SRC_URL" ] || die "DIRECT_URL is empty."
export SRC_URL

say "3/7 saving the Supabase env file as $(basename "$saved") and pointing the app at postgres"
point_env_at_local "supabase-$stamp"
set_profiles db

say "4/7 starting Postgres"
dc up -d --wait postgres || die "Postgres did not become healthy. Undo with --rollback."

say "5/7 copying the data (Supabase -> this server), verified by restore.sh"
pg_container '
pg_dump --dbname="$SRC_URL" --format=custom --schema=public --no-owner --no-acl --file=/tmp/move.dump
pg_restore --list /tmp/move.dump > /dev/null
cat /tmp/move.dump
rm -f /tmp/move.dump' SRC_URL \
  | "$DEPLOY_DIR/scripts/restore.sh" --into-local - \
  || die "the copy failed; nothing was started on the new database. Undo with --rollback."

say "6/7 comparing row counts table by table"
src_counts=$(printf '%s\n' "$COUNT_SQL" | pg_container 'psql "$SRC_URL" -At -F " " -f -' SRC_URL | grep -v '^_prisma_migrations ')
dst_counts=$(printf '%s\n' "$COUNT_SQL" | dc exec -T postgres psql -U adspilot -d adspilot -At -F ' ' -f - | grep -v '^_prisma_migrations ')
if [ "$src_counts" != "$dst_counts" ]; then
  echo "Supabase:"; echo "$src_counts"; echo "This server:"; echo "$dst_counts"
  die "row counts differ. Nothing was started on the new database. Undo with --rollback."
fi
echo "$dst_counts"
say "every table has the same number of rows"

say "7/7 starting the MCP and the worker on the server's database"
dc up -d --wait mcp || die "the MCP did not become healthy. Undo with --rollback."
dc up -d worker
dc ps
say "moved. Now: the checks in deploy/README.md B6, then switch the PC (B7)."
