#!/usr/bin/env bash
# Restore an AdsPilot dump (pg_dump custom format, PLAINTEXT) on the server.
#
#   restore.sh --test FILE|-         load it into a throwaway Postgres, print the
#                                    row count of every table, delete it again.
#                                    Touches nothing that is running. (Monthly test.)
#   restore.sh --into-local FILE|-   load it into this stack's own Postgres
#                                    (Phase B, or rebuilding a server). Refuses
#                                    when AdsPilot's tables already hold rows,
#                                    unless --replace is given AND CONFIRM_REPLACE=yes.
#
# Backups on the server are encrypted to a key whose private half is only on
# the owner's PC, so a restore is fed from the PC, decrypted there and streamed
# over SSH (deploy/scripts/pc-backups.sh restore-test | restore-server).
#
# How: the schema is built by `prisma migrate deploy` (with Supabase's anon and
# authenticated roles created first, NOLOGIN), then only the DATA is loaded from
# the dump, all tables in one transaction with triggers off, leaving out the
# dump's _prisma_migrations rows (migrate deploy wrote its own). A dump made by
# newer code than this release fails cleanly instead of loading half.

# shellcheck source=common.sh
. "$(dirname "$0")/common.sh"

MODE=""
INPUT=""
REPLACE=0
while [ $# -gt 0 ]; do
  case $1 in
    --test) MODE="test"; INPUT=${2:?}; shift 2 ;;
    --into-local) MODE="local"; INPUT=${2:?}; shift 2 ;;
    --replace) REPLACE=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done
[ -n "$MODE" ] || die "say --test or --into-local (see --help)"
require_root_or_docker
case $INPUT in
  *.gpg|*.asc) die "this file is encrypted. Decrypt it on the PC and stream it: deploy/scripts/pc-backups.sh" ;;
esac
[ "$INPUT" = - ] || [ -s "$INPUT" ] || die "no such dump: $INPUT"

ROLES_SQL="DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END \$\$;"

ROWS_SQL="SELECT coalesce(sum((xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text::bigint), 0)
  FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations';"

TRUNCATE_SQL="DO \$\$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
    EXECUTE format('TRUNCATE TABLE public.%I CASCADE', t);
  END LOOP;
END \$\$;"

# Runs inside the target Postgres container: data only, one transaction.
LOAD_SH='pg_restore --list /tmp/restore.dump | grep -v " TABLE DATA public _prisma_migrations " > /tmp/restore.list
pg_restore --data-only --disable-triggers --no-owner --no-acl --exit-on-error --single-transaction \
  -U adspilot -d adspilot -L /tmp/restore.list /tmp/restore.dump
rm -f /tmp/restore.dump /tmp/restore.list'

# exec_pg <docker exec target args...> -- runs psql/sh in the target container
if [ "$MODE" = test ]; then
  name="adspilot-restore-test-$$"
  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  export POSTGRES_PASSWORD
  cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  ensure_app_network
  say "starting a throwaway Postgres ($name), data in memory"
  docker run -d --name "$name" --network "$APP_NETWORK" \
    --tmpfs /var/lib/postgresql/data:size=1g --tmpfs /tmp:size=512m \
    -e POSTGRES_USER=adspilot -e POSTGRES_DB=adspilot -e POSTGRES_PASSWORD \
    --memory 512m "$PG_IMAGE" >/dev/null
  # TCP answers only once initialisation has finished (the init server is socket-only)
  for _ in $(seq 1 60); do
    docker exec "$name" psql -h 127.0.0.1 -U adspilot -d adspilot -Atqc 'SELECT 1' >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$name" psql -h 127.0.0.1 -U adspilot -d adspilot -Atqc 'SELECT 1' >/dev/null || die "the throwaway Postgres did not start"
  psql_in() { docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U adspilot -d adspilot -q "$@"; }
  sh_in()   { docker exec -i "$name" sh -ec "$1"; }
  DATABASE_URL="postgresql://adspilot:${POSTGRES_PASSWORD}@${name}:5432/adspilot"
else
  [ "$(db_mode)" = local ] || die "--into-local needs DATABASE_URL pointing at this stack's postgres service (Phase B). Supabase is never written by this script."
  dc ps --status running postgres | grep -q postgres || die "the postgres service is not running (dc.sh up -d postgres)."
  psql_in() { dc exec -T postgres psql -v ON_ERROR_STOP=1 -U adspilot -d adspilot -q "$@"; }
  sh_in()   { dc exec -T postgres sh -ec "$1"; }
  DATABASE_URL=$(env_value DATABASE_URL)
fi
DIRECT_URL=$DATABASE_URL
export DATABASE_URL DIRECT_URL

say "roles anon and authenticated (NOLOGIN), then migrate deploy"
printf '%s\n' "$ROLES_SQL" | psql_in
# </dev/null: stdin may be the dump itself, which must not be read by this step
dc run --rm -T --no-deps -e DATABASE_URL -e DIRECT_URL migrate migrate deploy </dev/null

existing=$(printf '%s\n' "$ROWS_SQL" | psql_in -At)
if [ "${existing:-0}" != 0 ]; then
  if [ "$REPLACE" = 1 ] && [ "${CONFIRM_REPLACE:-}" = yes ]; then
    warn "emptying $existing existing rows (--replace, CONFIRM_REPLACE=yes)"
    printf '%s\n' "$TRUNCATE_SQL" | psql_in
  else
    die "the target already holds $existing rows. Nothing was changed. To replace them: take a backup, then --replace with CONFIRM_REPLACE=yes."
  fi
fi

say "loading the data"
if [ "$INPUT" = - ]; then
  sh_in 'cat > /tmp/restore.dump'
else
  sh_in 'cat > /tmp/restore.dump' < "$INPUT"
fi
sh_in "$LOAD_SH"

say "rows per table after the restore"
printf '%s\n' "$COUNT_SQL" | psql_in -At -F ' '
say "restore ($MODE) finished"
