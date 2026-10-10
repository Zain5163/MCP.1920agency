# shellcheck shell=bash disable=SC2034
# Shared by every script in deploy/scripts. Sourced, never run on its own.
#
# Secret handling rule for all of these scripts: a value read from the env file
# is only ever captured into a variable and handed to a container through the
# environment (docker run -e NAME, without the value on the command line). It is
# never echoed, logged or written anywhere else.

set -Eeuo pipefail
umask 077

# Domain, server and fixed server names come from deploy/site.env, the one place
# for them (ADSPILOT_HOME, COMPOSE_PROJECT, EDGE_NETWORK, DOMAIN, ...).
# shellcheck source=site.sh
. "$(dirname "${BASH_SOURCE[0]}")/site.sh"

DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
COMPOSE_ENV="$ADSPILOT_HOME/compose.env"
APP_ENV="$ADSPILOT_HOME/env/adspilot.env"
PG_PASSWORD_FILE="$ADSPILOT_HOME/env/postgres_password"
BACKUP_DIR="$ADSPILOT_HOME/backups"
BACKUP_PUBKEY="$ADSPILOT_HOME/env/backup-public.asc"
PG_IMAGE=${PG_IMAGE:-postgres:17-alpine}
# Compose names its network <project>_<network>: project $COMPOSE_PROJECT, network "adspilot".
APP_NETWORK=${COMPOSE_PROJECT}_adspilot

say()  { printf '== %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf 'STOPPED: %s\n' "$*" >&2; exit 1; }

# docker compose with this deployment's settings file. The project name comes
# from site.env (the same "adspilot" the compose file names itself), and DOMAIN is
# exported by site.sh, so compose builds the MCP's PUBLIC_BASE_URL from it.
dc() {
  if [ -f "$COMPOSE_ENV" ]; then
    docker compose -p "$COMPOSE_PROJECT" --env-file "$COMPOSE_ENV" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
  fi
}

# Prints the value of NAME from the app env file, unquoted, to stdout.
# Callers capture it into a variable; it must never reach the terminal.
env_value() {
  local v
  v=$(sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$APP_ENV" | tail -n 1)
  v=${v%"${v##*[![:space:]]}"}
  case $v in
    \"*\") v=${v#\"}; v=${v%\"} ;;
    \'*\') v=${v#\'}; v=${v%\'} ;;
  esac
  printf '%s' "$v"
}

has_env() { [ -n "$(env_value "$1")" ]; }

# A Prisma connection string as libpq (pg_dump, psql) accepts it: Prisma-only
# query parameters such as pgbouncer=true make libpq refuse the whole URL.
libpq_url() {
  local url=$1 base query out="" p
  base=${url%%\?*}
  if [ "$base" = "$url" ]; then printf '%s' "$url"; return; fi
  query=${url#*\?}
  local -
  set -f
  local IFS='&'
  for p in $query; do
    case ${p%%=*} in
      pgbouncer|connection_limit|pool_timeout|schema|statement_cache_size|socket_timeout|pgbouncer_mode) ;;
      *) out=${out:+$out&}$p ;;
    esac
  done
  printf '%s' "$base${out:+?$out}"
}

# "local" when the app points at the postgres service on this server, else "remote" (Supabase).
db_mode() {
  case "$(env_value DATABASE_URL)" in
    *@postgres:5432/*|*@postgres/*) echo local ;;
    *) echo remote ;;
  esac
}

ensure_app_network() {
  docker network inspect "$APP_NETWORK" >/dev/null 2>&1 || dc up --no-start >/dev/null
}

# Runs a shell snippet in a throwaway postgres container on the AdsPilot network,
# with /tmp in memory. Connection strings reach it only through exported
# variables named in "$@" after the snippet (docker run -e NAME).
pg_container() {
  local script=$1; shift
  local envs=() name
  for name in "$@"; do envs+=(-e "$name"); done
  ensure_app_network
  docker run --rm -i --network "$APP_NETWORK" --tmpfs /tmp:size=512m "${envs[@]}" "$PG_IMAGE" sh -ec "$script"
}

require_root_or_docker() {
  docker info >/dev/null 2>&1 || die "Docker is not reachable. Run as root (or a user in the docker group)."
}

# Exact row count of every AdsPilot table, one "table count" line each.
COUNT_SQL="SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text::bigint
  FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1;"

# Points DATABASE_URL and DIRECT_URL in the app env file at this stack's postgres
# service, keeping a copy of the previous file as $APP_ENV.<suffix>. The password
# comes from env/postgres_password and is never printed (awk reads it from its
# environment, not its command line).
point_env_at_local() {
  local suffix=$1
  [ -s "$PG_PASSWORD_FILE" ] || die "no $PG_PASSWORD_FILE."
  cp -p "$APP_ENV" "$APP_ENV.$suffix"
  chmod 600 "$APP_ENV.$suffix"
  LOCAL_URL="postgresql://adspilot:$(cat "$PG_PASSWORD_FILE")@postgres:5432/adspilot" awk '
    /^[[:space:]]*DATABASE_URL[[:space:]]*=/ { print "DATABASE_URL=" ENVIRON["LOCAL_URL"]; d = 1; next }
    /^[[:space:]]*DIRECT_URL[[:space:]]*=/   { print "DIRECT_URL=" ENVIRON["LOCAL_URL"]; r = 1; next }
    { print }
    END { if (!d) print "DATABASE_URL=" ENVIRON["LOCAL_URL"]; if (!r) print "DIRECT_URL=" ENVIRON["LOCAL_URL"] }
  ' "$APP_ENV.$suffix" > "$APP_ENV.new"
  chmod 600 "$APP_ENV.new"
  mv "$APP_ENV.new" "$APP_ENV"
  [ "$(db_mode)" = local ] || die "the env file was not switched to the local database."
}
