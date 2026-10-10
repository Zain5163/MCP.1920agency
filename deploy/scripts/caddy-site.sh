#!/usr/bin/env bash
# The hosted MCP's site file for the server's front gate, rendered from
# deploy/caddy/site.caddy.template with the values in deploy/site.env.
# Runs on the OWNER'S PC in Git Bash.
#
#   deploy/scripts/caddy-site.sh            print the rendered file (changes nothing)
#   deploy/scripts/caddy-site.sh --upload   install it on the server as
#                                           $GATE_DIR/sites/$DOMAIN.caddy, validate
#                                           the gate's whole config, reload the gate.
#                                           Only with the owner's approval (AGENTS.md).
#
# WHY rendered here: the gate (AI-Automation/Server-Gate) is one Caddy for every
# site on the server, and its environment is not this project's to set, so
# Caddy's own {$VAR} placeholders cannot carry our domain. The domain is written
# once, in site.env; this script is the only thing that turns it into Caddy text.
#
# --upload keeps the previous file in $ADSPILOT_HOME/gate-backups/ and puts it
# back by itself if the gate refuses the new config, so a typo never takes the
# other sites on the server down. After a DOMAIN change the old domain's file is
# still in sites/ (it keeps serving the old address): the script lists it, and
# removing it is a separate, deliberate step once the new domain works.

set -Eeuo pipefail
# shellcheck source=site.sh
. "$(dirname "${BASH_SOURCE[0]}")/site.sh"
TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/caddy/site.caddy.template"

render() {
  local out
  out=$(sed -e "s|{{DOMAIN}}|$DOMAIN|g" -e "s|{{OAUTH_BOUNCE_PORT}}|$OAUTH_BOUNCE_PORT|g" "$TEMPLATE" | tr -d '\r')
  if printf '%s\n' "$out" | grep -q '{{'; then
    echo "STOPPED: the template has a placeholder site.env does not fill:" >&2
    printf '%s\n' "$out" | grep -n '{{' >&2
    exit 1
  fi
  printf '%s\n' "$out"
}

case ${1:-} in
  '')
    render
    ;;
  --upload)
    case $DOMAIN in
      *[!A-Za-z0-9.-]* | '') echo "STOPPED: DOMAIN \"$DOMAIN\" in site.env is not a plain host name." >&2; exit 1 ;;
    esac
    rs() { ssh -i "$SSH_KEY_FILE" -o BatchMode=yes "$SSH_TARGET" "$@"; }
    echo "== installing $GATE_DIR/sites/$DOMAIN.caddy on $SERVER_HOST =="
    # The new file is written beside the old one as *.caddy.new (the gate imports
    # only *.caddy), then moved into place, so the gate never reads half a file.
    render | rs "set -e
      sites=$GATE_DIR/sites; f=\$sites/$DOMAIN.caddy; keep=$ADSPILOT_HOME/gate-backups
      mkdir -p \$keep; chmod 700 \$keep
      backup=''
      if [ -f \$f ]; then backup=\$keep/$DOMAIN.caddy.\$(date -u +%Y%m%dT%H%M%SZ); cp -p \$f \$backup; fi
      cat > \$f.new; chmod 644 \$f.new; mv \$f.new \$f
      cd $GATE_DIR
      if ! docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null; then
        if [ -n \"\$backup\" ]; then cp -p \$backup \$f; else rm -f \$f; fi
        echo 'STOPPED: the gate refused the new file; the previous one is back. Nothing was reloaded.' >&2
        exit 1
      fi
      docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
      echo \"installed \$f\${backup:+ (previous kept as \$backup)}\"
      others=\$(grep -l 'Owner: AI-Automation/Social-Publisher' \$sites/*.caddy 2>/dev/null | grep -vx \"\$f\" || true)
      if [ -n \"\$others\" ]; then
        echo 'Also in sites/ from this project (an old domain?), still served:'
        echo \"\$others\"
        echo 'Remove it only once the new domain works, then reload the gate.'
      fi"
    echo "  $(curl -s -o /dev/null -w '%{http_code}' -m 20 "https://$DOMAIN/health" || true) https://$DOMAIN/health   (expect 200)"
    ;;
  *)
    sed -n '2,21p' "$0"
    exit 1
    ;;
esac
