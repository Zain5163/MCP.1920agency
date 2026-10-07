#!/usr/bin/env bash
# docker compose for AdsPilot, with the server's settings file. Examples:
#   /opt/adspilot/app/deploy/scripts/dc.sh ps
#   /opt/adspilot/app/deploy/scripts/dc.sh logs --tail 100 worker
#   /opt/adspilot/app/deploy/scripts/dc.sh run --rm tasks src/monitor-cli.ts
# shellcheck source=common.sh
. "$(dirname "$0")/common.sh"
dc "$@"
