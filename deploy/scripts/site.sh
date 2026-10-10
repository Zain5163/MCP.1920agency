# shellcheck shell=bash
# Loads deploy/site.env, the one file that says where this deployment runs
# (domain, server, SSH key, fixed server paths). Sourced, never run on its own:
# by common.sh on the server, and directly by the PC-side scripts (release.sh,
# pc-backups.sh, caddy-site.sh).
#
# WHY a loader instead of `. site.env`: the values are plain text (no quotes, no
# $VARS), so sourcing would let a stray character run as shell; and a variable
# already in the environment must win (systemd sets ADSPILOT_HOME), which plain
# sourcing would silently overwrite.

SITE_ENV=${SITE_ENV:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/site.env}

load_site_env() {
  local file=$1 line key value
  if [ ! -f "$file" ]; then
    printf 'STOPPED: %s is missing. It holds the domain and server settings (see START-HERE.md, "Where settings live").\n' "$file" >&2
    exit 1
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case $line in '' | '#'*) continue ;; esac
    key=${line%%=*}
    value=${line#*=}
    case $key in
      '' | [0-9]* | *[!A-Za-z0-9_]*)
        printf 'STOPPED: %s: "%s" is not a NAME=value line.\n' "$file" "$line" >&2
        exit 1
        ;;
    esac
    # The environment wins: a one-off override, or ADSPILOT_HOME from systemd.
    [ -n "${!key+x}" ] && continue
    case $value in '~/'*) value="$HOME/${value#\~/}" ;; esac
    printf -v "$key" '%s' "$value"
    # shellcheck disable=SC2163
    export "$key"
  done < "$file"
  local required
  for required in DOMAIN SERVER_HOST SERVER_USER SSH_KEY ADSPILOT_HOME COMPOSE_PROJECT EDGE_NETWORK GATE_DIR OAUTH_BOUNCE_PORT; do
    if [ -z "${!required:-}" ]; then
      printf 'STOPPED: %s has no value for %s.\n' "$file" "$required" >&2
      exit 1
    fi
  done
}

load_site_env "$SITE_ENV"

# ssh/scp target, kept overridable by the names the scripts accepted before.
SSH_TARGET=${ADSPILOT_HOST:-$SERVER_USER@$SERVER_HOST}
SSH_KEY_FILE=${ADSPILOT_SSH_KEY:-$SSH_KEY}
