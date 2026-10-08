#!/usr/bin/env bash
# Runs on the OWNER'S PC (Git Bash), never on the server.
#
#   pc-backups.sh pull                  copy the server's new encrypted backups to
#                                       %USERPROFILE%\.social-publisher\backups\
#   pc-backups.sh restore-test [FILE]   decrypt FILE here (default: the newest
#                                       local backup) and stream it to the server's
#                                       restore.sh --test: a throwaway database,
#                                       row counts, then deleted. The monthly test.
#   pc-backups.sh restore-server [FILE] [--replace]
#                                       decrypt and load it into the server's own
#                                       Postgres (Phase B / rebuilding a server).
#
# The backups folder is outside D:\My AI Works and outside git on purpose: a dump
# holds customer data and encrypted credentials (decision 0010, AGENTS.md).
# Decrypting needs the private key "AdsPilot backups" in this PC's gpg keyring
# and its passphrase; gpg asks for it. The plaintext only ever flows through the
# pipe to the server, never into a file here.

set -Eeuo pipefail
HOST=${ADSPILOT_HOST:-root@37.27.148.217}
KEY=${ADSPILOT_SSH_KEY:-$HOME/.ssh/raptor_hetzner}
REMOTE_DIR=/opt/adspilot/backups
REMOTE_SCRIPTS=/opt/adspilot/app/deploy/scripts
KEEP_LOCAL=${KEEP_LOCAL:-60}

profile=${USERPROFILE:-$HOME}
command -v cygpath >/dev/null 2>&1 && profile=$(cygpath -u "$profile")
LOCAL_DIR="$profile/.social-publisher/backups"
case "$LOCAL_DIR" in
  */"My AI Works"/*) echo "STOPPED: the backups folder must be outside D:\\My AI Works." >&2; exit 1 ;;
esac

rs() { ssh -i "$KEY" -o BatchMode=yes "$HOST" "$@"; }

newest_local() {
  ls -1t "$LOCAL_DIR"/adspilot-*.dump.gpg 2>/dev/null | head -n 1
}

cmd=${1:-}
shift || true
case $cmd in
  pull)
    mkdir -p "$LOCAL_DIR"
    chmod 700 "$LOCAL_DIR" 2>/dev/null || true
    got=0
    for name in $(rs "cd $REMOTE_DIR && ls -1 adspilot-*.dump.gpg 2>/dev/null" || true); do
      [ -f "$LOCAL_DIR/$name" ] && continue
      scp -q -i "$KEY" -o BatchMode=yes "$HOST:$REMOTE_DIR/$name" "$LOCAL_DIR/$name.partial"
      mv "$LOCAL_DIR/$name.partial" "$LOCAL_DIR/$name"
      echo "pulled $name"
      got=$((got + 1))
    done
    # keep the newest KEEP_LOCAL here
    ls -1t "$LOCAL_DIR"/adspilot-*.dump.gpg 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))" | while IFS= read -r f; do
      rm -f -- "$f"; echo "removed old local copy $(basename "$f")"
    done
    echo "$got new backup(s); folder: $LOCAL_DIR"
    [ -n "$(newest_local)" ] || { echo "STOPPED: no backup on this PC." >&2; exit 1; }
    ;;
  restore-test|restore-server)
    file=${1:-}
    [ -n "$file" ] && [ "${file#--}" = "$file" ] && shift || file=$(newest_local)
    [ -n "$file" ] && [ -f "$file" ] || { echo "STOPPED: no backup file (run: pc-backups.sh pull)." >&2; exit 1; }
    if [ "$cmd" = restore-test ]; then
      remote="$REMOTE_SCRIPTS/restore.sh --test -"
    else
      extra=""
      if [ "${1:-}" = --replace ]; then extra="--replace"; remote_env="CONFIRM_REPLACE=yes "; fi
      remote="${remote_env:-}$REMOTE_SCRIPTS/restore.sh --into-local - $extra"
    fi
    echo "decrypting $(basename "$file") here and streaming it to the server ($cmd)"
    gpg --decrypt --quiet "$file" | rs "$remote"
    ;;
  *)
    sed -n '2,18p' "$0"
    exit 1
    ;;
esac
