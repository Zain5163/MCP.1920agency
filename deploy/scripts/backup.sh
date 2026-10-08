#!/usr/bin/env bash
# Nightly AdsPilot database backup (decision 0010), run by adspilot-backup.timer.
#
#   - pg_dump of the "public" schema (every AdsPilot table, including
#     _prisma_migrations), custom format, from wherever DIRECT_URL points:
#     Supabase in Phase A, this server's Postgres in Phase B;
#   - checked readable (pg_restore --list) before it is kept;
#   - encrypted with gpg to the PUBLIC key in env/backup-public.asc. The private
#     key exists only on the owner's PC (and its offline copy), so the server
#     can write backups but cannot read them;
#   - the plaintext exists only in a throwaway container's memory, never on disk;
#   - kept 14 days (KEEP_DAYS), never fewer than the 14 newest files;
#   - on failure: exit 1 (systemd shows it) and a Slack message, if
#     SLACK_WEBHOOK_URL is set, saying what failed (no data, no secret).
#
# The PC copies them to %USERPROFILE%\.social-publisher\backups\ with
# deploy/scripts/pc-backups.sh pull (outside the workspace and outside git).

# shellcheck source=common.sh
. "$(dirname "$0")/common.sh"

KEEP_DAYS=${KEEP_DAYS:-14}
KEEP_MIN=${KEEP_MIN:-14}
step="start"

notify_failure() {
  local url host
  url=$(env_value SLACK_WEBHOOK_URL 2>/dev/null || true)
  host=$(hostname)
  [ -n "$url" ] || return 0
  # the webhook address goes to curl through stdin, never on its command line
  printf 'url = "%s"\n' "$url" | curl -fsS -m 15 -K - -H 'content-type: application/json' \
    --data "{\"text\":\":warning: AdsPilot nightly backup FAILED on ${host} at step: ${step}. Nothing new was kept; older backups are untouched. Look at: journalctl -u adspilot-backup\"}" \
    >/dev/null || true
}
on_exit() {
  local rc=$?
  [ "$rc" -eq 0 ] || notify_failure
  rm -f "${tmp:-}"
  exit "$rc"
}
trap on_exit EXIT

step="prerequisites"
require_root_or_docker
command -v gpg >/dev/null || die "gpg is not installed."
[ -s "$BACKUP_PUBKEY" ] || die "no public key at $BACKUP_PUBKEY (deploy/README.md, step A6)."
[ -f "$APP_ENV" ] || die "no env file at $APP_ENV."
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

step="reading DIRECT_URL"
DUMP_URL=$(libpq_url "$(env_value DIRECT_URL)")
[ -n "$DUMP_URL" ] || die "DIRECT_URL is empty in $APP_ENV."
export DUMP_URL

mode=$(db_mode)
stamp=$(date -u +%Y-%m-%dT%H%MZ)
out="$BACKUP_DIR/adspilot-${mode}-${stamp}.dump.gpg"
tmp="$out.partial"

step="pg_dump"
say "dumping ($mode database) and encrypting to $(basename "$out")"
pg_container '
pg_dump --dbname="$DUMP_URL" --format=custom --compress=6 --schema=public \
  --no-owner --no-acl --file=/tmp/adspilot.dump
pg_restore --list /tmp/adspilot.dump > /dev/null
cat /tmp/adspilot.dump
rm -f /tmp/adspilot.dump' DUMP_URL \
  | gpg --batch --yes --quiet --no-tty --trust-model always \
        --recipient-file "$BACKUP_PUBKEY" --encrypt --output "$tmp"

step="size check"
size=$(stat -c %s "$tmp")
[ "$size" -gt 2048 ] || die "the encrypted dump is only $size bytes; something is wrong."
mv "$tmp" "$out"
chmod 600 "$out"
ln -sfn "$(basename "$out")" "$BACKUP_DIR/latest.dump.gpg"
say "kept $(basename "$out") ($size bytes)"

step="retention"
# newest first; never touch the KEEP_MIN newest, delete older ones past KEEP_DAYS
i=0
while IFS= read -r f; do
  i=$((i + 1))
  [ "$i" -le "$KEEP_MIN" ] && continue
  if [ -n "$(find "$f" -maxdepth 0 -mtime +"$((KEEP_DAYS - 1))")" ]; then
    rm -f -- "$f"
    say "removed old backup $(basename "$f")"
  fi
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'adspilot-*.dump.gpg' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)

step="disk check"
used=$(df -P "$BACKUP_DIR" | awk 'NR==2 {gsub("%","",$5); print $5}')
[ "${used:-0}" -lt 85 ] || { step="disk ${used}% full"; die "disk is ${used}% full."; }
say "backup done; disk ${used}% used"
