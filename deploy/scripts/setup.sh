#!/usr/bin/env bash
# AdsPilot: one-command setup (decision 0010). Same script on the Hetzner server,
# on this PC with Docker, or on a new host.
#
#   setup.sh                          Phase A: database stays on Supabase
#   setup.sh --db local               Phase B / new host: Postgres in this stack
#   setup.sh --db local --restore -   ... and fill it from a dump on stdin
#   setup.sh --db local --restore /path/file.dump
#
# Options
#   --db supabase|local   where the data lives (default: supabase)
#   --restore FILE|-      after the schema is built, load the data from a
#                         plaintext pg_dump custom-format file (or stdin). Backups
#                         are encrypted and only the owner's PC can decrypt them:
#                         stream one in with deploy/scripts/pull-backup.sh --send.
#   --point-env-local     with --db local: rewrite DATABASE_URL/DIRECT_URL in the env
#                         file to this stack's postgres (old file kept as
#                         adspilot.env.before-local-<time>). For a new host.
#   --migrate             Supabase only: also apply pending migrations there.
#                         Off by default; each migration needs the owner's approval.
#   --install-timers      install the systemd timers (backup, monitor, refresh,
#                         keepalive) and the logrotate rule
#   --no-start            prepare and build, but start nothing
#   --local-edge          on a machine without Raptor (this PC): create the edge
#                         network instead of requiring Raptor's
#
# What it never does: edit Caddy or Raptor's files, touch DNS, print a secret,
# or apply a migration to Supabase without --migrate.

# shellcheck source=common.sh
. "$(dirname "$0")/common.sh"

DB=supabase
RESTORE=""
MIGRATE_REMOTE=0
INSTALL_TIMERS=0
START=1
LOCAL_EDGE=0
POINT_LOCAL=0
while [ $# -gt 0 ]; do
  case $1 in
    --db) DB=${2:?}; shift 2 ;;
    --restore) RESTORE=${2:?}; shift 2 ;;
    --migrate) MIGRATE_REMOTE=1; shift ;;
    --point-env-local) POINT_LOCAL=1; shift ;;
    --install-timers) INSTALL_TIMERS=1; shift ;;
    --no-start) START=0; shift ;;
    --local-edge) LOCAL_EDGE=1; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done
case $DB in supabase|local) ;; *) die "--db must be supabase or local" ;; esac
[ -z "$RESTORE" ] || [ "$DB" = local ] || die "--restore needs --db local. Supabase is never overwritten by this script."

# --- 1. prerequisites ----------------------------------------------------------------
say "checking prerequisites"
command -v docker >/dev/null || die "Docker is not installed."
require_root_or_docker
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (Ubuntu: docker-compose-v2)."
cv=$(docker compose version --short 2>/dev/null || echo 0)
case $cv in
  1.*|2.[0-9].*|2.1[0-9].*) die "Docker Compose $cv is too old: 2.20 or newer is needed (depends_on.required)." ;;
esac
command -v openssl >/dev/null || die "openssl is missing."
command -v gpg >/dev/null || warn "gpg is missing: nightly backups cannot be encrypted until it is installed."
avail_kb=$(df -Pk "$(dirname "$ADSPILOT_HOME")" | awk 'NR==2 {print $4}')
[ "${avail_kb:-0}" -ge $((5 * 1024 * 1024)) ] || die "less than 5 GB free disk. Free space first (docker builder prune, with approval)."
if [ -r /proc/meminfo ]; then
  avail_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  [ "${avail_mb:-0}" -ge 900 ] || warn "only ${avail_mb} MB memory available; AdsPilot may need up to 1.4 GB."
fi

# --- 2. folders and files --------------------------------------------------------------
say "folders under $ADSPILOT_HOME"
mkdir -p "$ADSPILOT_HOME/env" "$BACKUP_DIR" "$ADSPILOT_HOME/logs/mcp" "$ADSPILOT_HOME/logs/worker" "$ADSPILOT_HOME/logs/tasks"
chmod 700 "$ADSPILOT_HOME/env" "$BACKUP_DIR"
# the containers run as uid 1000 (user "node" in the image)
chown -R 1000:1000 "$ADSPILOT_HOME/logs"
chmod 750 "$ADSPILOT_HOME/logs" "$ADSPILOT_HOME/logs/"*

[ -f "$APP_ENV" ] || die "$APP_ENV does not exist. Copy it from the PC first (deploy/README.md, step A3). Names: deploy/.env.example."
chown root:root "$APP_ENV" 2>/dev/null || true
chmod 600 "$APP_ENV"
missing=""
for k in DATABASE_URL DIRECT_URL VAULT_MASTER_KEY META_APP_ID META_APP_SECRET; do
  has_env "$k" || missing="$missing $k"
done
[ -z "$missing" ] || die "missing in $APP_ENV:$missing"
for k in META_ADS_ACCESS_TOKEN SUPABASE_SERVICE_ROLE_KEY OPENROUTER_API_KEY; do
  if has_env "$k"; then
    warn "$k is in the server env file but nothing on the server uses it. Remove it (least privilege)."
  fi
done
if grep -Eq "^[A-Z0-9_]+=([^'].*)?[$]" "$APP_ENV"; then
  warn "a value contains '\$' without single quotes; Docker Compose would try to expand it. Quote it: NAME='value'."
fi

if [ ! -s "$PG_PASSWORD_FILE" ]; then
  say "creating the database password (env/postgres_password)"
  openssl rand -hex 32 > "$PG_PASSWORD_FILE"
fi
# read by the postgres image's entrypoint as its own user (uid 70 in the alpine image)
chown 70:70 "$PG_PASSWORD_FILE" 2>/dev/null || true
chmod 400 "$PG_PASSWORD_FILE"

if [ ! -f "$COMPOSE_ENV" ]; then
  say "writing $COMPOSE_ENV (compose settings, no secrets)"
  {
    echo "# AdsPilot compose settings. No secrets in this file."
    echo "ADSPILOT_HOME=$ADSPILOT_HOME"
    echo "EDGE_NETWORK=deploy_internal"
    echo "ADSPILOT_TAG=latest"
    echo "COMPOSE_PROFILES="
  } > "$COMPOSE_ENV"
fi
if [ "$DB" = local ]; then
  sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=db/' "$COMPOSE_ENV"
else
  sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/' "$COMPOSE_ENV"
fi
chmod 644 "$COMPOSE_ENV"

if [ "$POINT_LOCAL" = 1 ]; then
  [ "$DB" = local ] || die "--point-env-local needs --db local."
  if [ "$(db_mode)" != local ]; then
    say "pointing DATABASE_URL and DIRECT_URL at the postgres service"
    point_env_at_local "before-local-$(date -u +%Y%m%dT%H%M%SZ)"
  fi
fi
mode=$(db_mode)
if [ "$DB" = local ] && [ "$mode" != local ]; then
  die "--db local, but DATABASE_URL does not point at the postgres service. Set DATABASE_URL and DIRECT_URL to
  postgresql://adspilot:<contents of env/postgres_password>@postgres:5432/adspilot
(or run again with --point-env-local, which does it without showing the password)."
fi
if [ "$DB" = supabase ] && [ "$mode" = local ]; then
  die "--db supabase, but DATABASE_URL points at the postgres service on this server."
fi

# --- 3. the edge network (Raptor's Caddy) ------------------------------------------------
edge=$(sed -n 's/^EDGE_NETWORK=//p' "$COMPOSE_ENV")
if ! docker network inspect "$edge" >/dev/null 2>&1; then
  if [ "$LOCAL_EDGE" = 1 ]; then
    docker network create "$edge" >/dev/null
  else
    die "network $edge not found. On the Hetzner server it is Raptor's (deploy_internal); is Raptor running?"
  fi
fi

# --- 4. build ----------------------------------------------------------------------------------
say "building the image (a few minutes the first time)"
# every service runs this one image (adspilot:$ADSPILOT_TAG); building it once is enough
dc build mcp

# --- 5. database --------------------------------------------------------------------------------
if [ "$DB" = local ]; then
  say "starting Postgres"
  dc up -d --wait postgres || die "Postgres did not become healthy. Look at: dc.sh logs postgres"
  say "creating the roles anon and authenticated (NOLOGIN), if missing"
  # Migrations 20260925010000_lock_down_data_api and 20261008120000_add_plans_and_usage
  # REVOKE from Supabase's two roles. On plain Postgres those roles do not exist and
  # the migration would fail, so they are created first, unable to log in, with no
  # grants. Applied migrations are never edited.
  dc exec -T postgres psql -v ON_ERROR_STOP=1 -U adspilot -d adspilot -q <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;
SQL
  say "prisma migrate deploy"
  dc run --rm -T migrate migrate deploy </dev/null
else
  if [ "$MIGRATE_REMOTE" = 1 ]; then
    say "prisma migrate deploy on Supabase (--migrate given)"
    dc run --rm -T migrate migrate deploy </dev/null
  else
    say "checking the Supabase schema is up to date (read-only)"
    if ! dc run --rm -T migrate migrate status </dev/null; then
      die "migrate status failed or migrations are pending. Pending migrations are applied only with the owner's approval (--migrate). If it could not connect: DIRECT_URL must be the pooler's session-mode address (IPv4), see deploy/.env.example."
    fi
  fi
fi

# --- 6. optional restore ---------------------------------------------------------------------------
if [ -n "$RESTORE" ]; then
  say "loading the data from the dump"
  if [ "$RESTORE" = - ]; then
    "$DEPLOY_DIR/scripts/restore.sh" --into-local -
  else
    "$DEPLOY_DIR/scripts/restore.sh" --into-local "$RESTORE"
  fi
fi

# --- 7. timers ---------------------------------------------------------------------------------------
if [ "$INSTALL_TIMERS" = 1 ]; then
  say "installing systemd timers and logrotate"
  command -v systemctl >/dev/null || die "systemd is not available on this machine."
  for unit in "$DEPLOY_DIR"/systemd/*.service "$DEPLOY_DIR"/systemd/*.timer; do
    sed "s#/opt/adspilot#$ADSPILOT_HOME#g" "$unit" > "/etc/systemd/system/$(basename "$unit")"
    chmod 644 "/etc/systemd/system/$(basename "$unit")"
  done
  sed "s#/opt/adspilot#$ADSPILOT_HOME#g" "$DEPLOY_DIR/logrotate/adspilot" > /etc/logrotate.d/adspilot
  chmod 644 /etc/logrotate.d/adspilot
  systemctl daemon-reload
  systemctl enable --now adspilot-backup.timer adspilot-monitor.timer adspilot-refresh.timer adspilot-keepalive.timer
  [ -f "$BACKUP_PUBKEY" ] || warn "no backup key at $BACKUP_PUBKEY yet: the nightly backup will stop with a message until it exists."
fi

# --- 8. start -------------------------------------------------------------------------------------------
if [ "$START" = 1 ]; then
  say "starting the MCP and the worker"
  dc up -d --wait mcp || die "the MCP did not become healthy. Look at: dc.sh logs --tail 100 mcp"
  dc up -d worker
  dc ps
  say "health from inside the MCP container:"
  dc exec -T mcp node -e "fetch('http://127.0.0.1:8080/health').then(r=>r.text()).then(t=>console.log(t))"
fi

say "done. Next: deploy/README.md (Caddy block, then the checks)."
