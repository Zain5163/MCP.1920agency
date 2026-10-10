# AdsPilot on the Hetzner server: deployment plan (Phase 3)

> **2026-10-10: settings live in `deploy/site.env`.** The domain, server, SSH user and key, server folder,
> compose project, edge network and gate folder are written once, in `site.env` (no secrets), and every script
> reads it through `scripts/site.sh`. The commands below show today's values (`mcp.1920agency.com`,
> `37.27.148.217`) for readability; the scripts never contain them. The gate's site file is rendered from
> `caddy/site.caddy.template`: `scripts/caddy-site.sh` prints it, `scripts/caddy-site.sh --upload` installs it as
> `/opt/gate/sites/<DOMAIN>.caddy`, validates the gate and reloads it (puts the old file back if the gate refuses).
> Compose gives the MCP `PUBLIC_BASE_URL=https://$DOMAIN`. Rename or move: `architecture/2026-10-10-central-config.md`.
>
> **2026-10-09: the server has a front gate.** Raptor's Caddy no longer serves other sites: `/opt/gate`
> (source: `AI-Automation/Server-Gate`) serves every domain. AdsPilot owns `/opt/gate/sites/mcp.1920agency.com.caddy`
> (rendered since 2026-10-10 from this repo's `caddy/site.caddy.template`, see above). The steps below that edit
> `/opt/raptor/site/deploy/Caddyfile` are history.


**Status (2026-10-08): kit built, NOTHING deployed.** No file on the server has
been changed, nothing installed, no DNS or credential touched. Every step below
waits for the owner's approval (AGENTS.md). The server was looked at read-only
on 2026-10-08 (what was seen: "Server today" below).

---

## Part 1: in plain words (what the owner approves)

### What changes

Today AdsPilot runs only on this PC. Scheduled posts go out only while the PC is
on and awake, and Windows cuts each publishing run off after 30 minutes.

After this plan, the **same server that runs Raptor Downloader** (Hetzner,
Helsinki) also runs:

1. **The hosted AdsPilot MCP** at `https://mcp.1920agency.com/mcp`. Any AI app
   (Claude, ChatGPT, ...) can connect to it from anywhere with an AdsPilot token.
   It offers posting, playbooks and skills. **Ads tools stay on this PC**
   (decision 0005), so nothing on the server can spend money.
2. **The scheduler (worker)**, which publishes scheduled posts around the clock,
   whether the PC is on or not. This removes today's biggest operational risk.
3. **The monitor, token refresh and keep-alive**, on timers, as on the PC today.
4. **A nightly encrypted backup** of the database, kept 14 days on the server and
   copied to this PC (outside the workspace and outside git). For the first time
   there is a copy of the data that does not depend on Supabase.

Two stages, so each can be checked before the next:

- **Stage A (first, lowest risk):** the data stays in Supabase, exactly where it
  is. Only the programs move. If anything goes wrong, stop the two containers and
  switch the PC's tasks back on; nothing is lost.
- **Stage B (later, decision 0010):** the data moves from Supabase (Singapore) to
  a database on the server (Helsinki), next to the programs, which makes every
  tool call faster and ends the dependency on Supabase's free tier. Only after a
  tested restore, in a short maintenance window, with Supabase kept untouched as
  the fallback.

### What changes for the owner

- The PC's `AdsPilot-Worker`, `AdsPilot-Monitor` and `AdsPilot-Refresh` tasks are
  switched off (not deleted) once the server's are proven. Switching them back on
  is the rollback.
- AI apps can be connected to `https://mcp.1920agency.com/mcp` with a token from
  the dashboard's Tokens page.
- Once a week (or whenever wanted) the PC pulls the backups with one command, and
  once a month a restore test proves they work.
- The owner keeps one new private key (for opening backups) and its passphrase,
  plus an offline copy. Without it the backups cannot be read.
- **Reconnecting while the Meta app is Live** (the 2026-10-02 "Can't load URL"):
  solved by the "bounce" (branch `https-callbacks`, 2026-10-08): Meta redirects
  to `https://mcp.1920agency.com/<path>`, the server's Caddy sends the browser
  straight on to the connect command on the PC. Built and unit-tested only; not
  yet exercised live (RULES R4). It needs the Caddy block reloaded and the owner
  checklist in "OAuth callbacks" below. Until then, reconnecting still needs the
  app in Development mode for a moment, as before.

### What it costs

| | Stage A | Stage B |
|---|---|---|
| Money | nothing extra (same server) | nothing extra |
| Memory (server has 3.8 GB, ~3.0 GB free today, no swap) | about 0.3 GB in use, capped at 0.9 GB | about 0.45 GB in use, capped at 1.4 GB |
| Disk (20 GB free today) | ~0.7 GB image + ~1 GB build cache | + database and backups, both small today (MB, not GB) |
| CPU (2 cores) | near zero when idle | near zero when idle |

### Risks, plainly

1. **Raptor shares the front door.** The web server (Caddy) belongs to Raptor's
   setup. Adding `mcp.1920agency.com` means one block added to Raptor's Caddy
   file and a restart of Caddy, which interrupts raptordownloader.com for a few
   seconds. Nothing else of Raptor changes.
2. **No swap on the server.** If Raptor converts a very large video while
   AdsPilot is busy, memory could run out. Every AdsPilot container has a hard
   memory cap; adding a 2 GB swap file is recommended (a separate approval).
3. **Stage A is slower per tool call:** server in Helsinki, database in
   Singapore. Each database query crosses the world (estimate 0.2 s each, not
   measured). Posting still works; Stage B removes this.
4. **First build has never been run** (Docker is not installed on this PC). The
   build steps were run on this PC, the image itself will first be built on the
   server; it is made to fail early and loudly if anything is missing.
5. **Stage B makes the PC depend on the server for data.** The PC's own
   AdsPilot (ads tools in VS Code, the dashboard, the connect command) then
   reaches the database through an SSH tunnel. If the tunnel is down, those stop
   working until it is up.
6. **Media files stay in Supabase Storage** in both stages. After Stage B,
   Supabase's free project must still be kept awake, or Instagram images break
   (see B0).
7. **Backups are only as good as the key.** Lose the private key and passphrase
   and every backup is unreadable. An offline copy is part of the plan.

### Rollback

- **Stage A:** `dc.sh down` on the server (stops the two containers), switch the
  PC tasks back on, remove the Caddy block. Data was never moved.
- **Stage B:** one command (`move-to-local-db.sh --rollback`) points the server
  back at Supabase, which was only read during the move. Posts written on the
  server after the move have to be copied back by hand (see "Rollback B").

---

## Part 2: technical

### Server today (read-only check, 2026-10-08)

| | |
|---|---|
| Host | Hetzner CX23, 2 vCPU, 3814 MB RAM (729 MB used, 3085 MB available), **no swap**, Ubuntu 26.04.1, kernel 7.0, UTC |
| Disk | 38 GB, 17 GB used, 20 GB free. Docker: images 10.1 GB, **build cache 11.5 GB (9.7 GB reclaimable)** |
| Docker | 29.1.3, Compose 2.40.3 |
| Running | `deploy-api-1` (Raptor API, 68 MB), `deploy-caddy-1` (Caddy 2, 21 MB), project `deploy` from `/opt/raptor/site/deploy` |
| Network | `deploy_internal` 172.30.0.0/24 (api .2, caddy .3), covered by Raptor's egress firewall. AdsPilot uses its own `adspilot_edge` (Caddy + MCP only) |
| Caddyfile | identical to Raptor's committed `site/deploy/Caddyfile` (sha256 matched); no `mcp.` block |
| Firewall | ufw: 22, 80, 443/tcp, 443/udp only |
| Tools | gpg, logrotate, systemd, curl, git present; `age` and `pg_dump` not installed (the kit needs neither: pg_dump runs in the postgres image) |
| /opt | `raptor`, `containerd` (no `adspilot` yet) |
| cron | Raptor's yt-dlp update at 04:15 |

Not checked (needs a write, or was not needed): building the image, Caddy's
validation of the new block, reaching Supabase from a container (IPv4 pooler).

### How the pieces are built

| File | What |
|---|---|
| `Dockerfile` | one image for all roles. Node 22 slim, pnpm 12.5.1, built from committed `source/` only. Packages are compiled to `dist/` (their `main`), apps run their `.ts` with `--experimental-strip-types`, as on the PC. Prisma's Linux engines are downloaded at build and checked. The dashboard is not included. Non-root (`node`, uid 1000), no secrets |
| `Dockerfile.dockerignore` | only `source/` and `deploy/docker/` enter the build; never `.env*`, `node_modules`, `dist` |
| `docker-compose.yml` | `mcp`, `worker`, optional `postgres` (profile `db`), one-shot `migrate` and `tasks` (profile `tools`). Memory caps, restart policies, healthchecks, json-file logs 10 MB x 5 |
| `site.env` | the deployment's settings, the one place for them: `DOMAIN`, `SERVER_HOST`, `SERVER_USER`, `SSH_KEY`, `GATE_DIR`, `ADSPILOT_HOME`, `COMPOSE_PROJECT`, `EDGE_NETWORK`, `OAUTH_BOUNCE_PORT`. No secrets. Read by `scripts/site.sh` (the environment wins) |
| `caddy/site.caddy.template` | AdsPilot's site file for the server's **front gate** (`/opt/gate/sites/<DOMAIN>.caddy`, see `AI-Automation/Server-Gate`), with the domain and bounce port as placeholders. `scripts/caddy-site.sh` renders it from `site.env`; `--upload` installs it, validates and reloads the gate. Never edit Raptor's files again |
| `.env.example` | every variable name the server needs, and the ones it must NOT have |
| `scripts/setup.sh` | one command: checks, folders, build, database (roles + `migrate deploy`, or a read-only `migrate status` on Supabase), optional restore, timers, start |
| `scripts/backup.sh` | nightly pg_dump, checked, gpg-encrypted to a public key, 14 days |
| `scripts/restore.sh` | `--test` (throwaway database) or `--into-local` |
| `scripts/pc-backups.sh` | on the PC: `pull`, `restore-test`, `restore-server` |
| `scripts/move-to-local-db.sh` | Stage B move with row-count check, and `--rollback` |
| `scripts/release.sh` | on the PC: later updates by `git archive`, one folder per release, `--rollback` |
| `scripts/dc.sh` | `docker compose` with the server's settings |
| `systemd/*` | timers: backup 02:30 UTC, monitor every 30 min, refresh 23:00 UTC (04:00 PKT), keep-alive Sun 04:00 UTC |
| `logrotate/adspilot` | the app's `events.jsonl` files: daily, 30 days, compressed |

**Worker: a loop, not a 5-minute drain.** `worker.ts` without `--once` is its
designed long-running mode: it polls every 15 s, beats a heartbeat each pass,
reclaims stale jobs when idle, and on SIGTERM finishes the job in flight
(`stop_grace_period: 5m`). The PC's `--once` every 5 minutes exists only
because Task Scheduler cannot keep a process alive, and it brings the 30-minute
cut-off with it. On the server the loop also publishes due posts within ~15 s
instead of up to 5 minutes late.

**Can the PC worker and the server worker run at the same time?** Yes, **while
both use the same database** (Stage A). `packages/db/src/queue.ts` claims a job
with one statement, `UPDATE jobs ... WHERE id = (SELECT ... FOR UPDATE SKIP
LOCKED)`, so two workers never take the same job; a running job's lock is
refreshed every minute and only reclaimed after 15 minutes without a refresh;
and a target that already has a platform post id is never published again.
So there is no need for a gap between switching the server on and the PC off.
**Never during Stage B's move**, when they could point at two different
databases: the same job would then exist twice. The move requires the PC tasks
off first (`--writers-stopped`).

**OAuth callbacks (the "bounce").** No app on the server serves them. The
routes (`/callback`, `/instagram/callback`, `/threads/callback`,
`/pinterest/callback`, `/linkedin/callback`, `/linkedin-page/callback`,
`/google/callback`) exist only in the one-shot listener of the PC's connect
commands (`source/apps/cli/src/callback-server.ts`, 127.0.0.1 only). The hosted
MCP serves only `/mcp` and `/health`.

Meta refuses `http://localhost` redirects while an app is Live ("Enforce
HTTPS"). So, with a redirect address of the https form:

1. `pnpm connect` / `pnpm connect:provider <name>` on the PC starts its listener
   on port 8787 (`OAUTH_CALLBACK_PORT`, optional, overrides it) and opens the
   provider's dialog with `redirect_uri=https://mcp.1920agency.com/<path>`. It
   prints one line saying the browser will come back through the server.
2. After approval the provider sends the browser to
   `https://mcp.1920agency.com/<path>?code=...&state=...`.
3. Caddy answers `302 Location: http://localhost:8787/<same path and query>`
   (`deploy/caddy/mcp.1920agency.com.caddy`, the `@oauth` block: GET only,
   exactly the seven paths above, nothing else matched).
4. The owner's browser delivers it to the listener on the same PC, which checks
   the path and `state` and exchanges the code exactly as with a localhost
   redirect. Nothing else changed: same state check, same token exchange, same
   vault.

The listener's port and path come from `source/apps/cli/src/callback-address.ts`:
for an `http://localhost` address, the address's own port (as before; a
conflicting `OAUTH_CALLBACK_PORT` is refused before the browser opens); for any
other host, `OAUTH_CALLBACK_PORT` or 8787. The path is always the redirect
address's path. A test (`source/apps/cli/test/callback-address.test.ts`) fails
if the Caddy matcher's paths and the `*_REDIRECT_URI` paths in `.env.example`
ever differ.

**Security review of the bounce.**

- **The code never stays on the server.** Caddy only answers with a redirect; no
  app reads the request, Caddy keeps no access log for this site (codes are in
  the query string), and the redirect carries `Cache-Control: no-store`. The code
  goes to the browser that asked for it, and from there only to `localhost`.
- **The code is useless on its own.** It is single-use, expires in minutes, is
  bound to the registered redirect address, and exchanging it needs the app
  secret, which is only in the PC's env file. The listener rejects any callback
  whose `state` is not the random value it generated for this run (CSRF), so a
  code an attacker obtained for their own account cannot be planted either.
- **Not an open redirect.** The target is fixed in the Caddyfile
  (`http://localhost:8787`), only seven exact paths match, and `{uri}` is always
  a path plus query, so it can never change the host. A crafted link can only
  send someone's browser to their own `localhost:8787`, where nothing is
  listening unless they are mid-connect themselves (and then the state check
  refuses it).
- **Residual risk, the same as with a plain localhost redirect:** another
  program on the PC already listening on 8787 during the connect window would
  receive the code. It would still need the app secret to use it, and the
  connect command fails loudly ("Something else is already using it") when it
  cannot take the port.
- **What the bounce does not do:** it cannot receive server-to-server calls
  (webhooks, Meta's deauthorize/data-deletion callbacks, Shopify's compliance
  webhooks), and it only works when the person approving the dialog uses a
  browser on the PC that runs the connect command.

### Paths on the server

| Path | What |
|---|---|
| `/opt/adspilot/releases/<commit>/` | `source/` and `deploy/` of one commit (from `git archive`) |
| `/opt/adspilot/app` | symlink to the current release |
| `/opt/adspilot/env/adspilot.env` | the secrets (root, 600; folder 700) |
| `/opt/adspilot/env/postgres_password` | Stage B database password (generated, 400) |
| `/opt/adspilot/env/backup-public.asc` | the backup PUBLIC key |
| `/opt/adspilot/compose.env` | compose settings, no secrets |
| `/opt/adspilot/backups/` | encrypted dumps (700) |
| `/opt/adspilot/logs/{mcp,worker,tasks}/` | the app's `events.jsonl` |
| volume `adspilot_pgdata` | Stage B database files |

All commands below run in **Git Bash on the PC**, from the repository root,
with (the values come from `deploy/site.env`):

```bash
. deploy/scripts/site.sh   # DOMAIN, SSH_TARGET, SSH_KEY_FILE, ADSPILOT_HOME ...
s() { ssh -i "$SSH_KEY_FILE" -o BatchMode=yes "$SSH_TARGET" "$@"; }; S=s   # the key path may contain spaces
ENVPC="$(cygpath -u "$USERPROFILE")/.social-publisher/.env"
```

---

### Stage A: first deploy, Supabase stays the database

**A0. Approvals needed** (owner): this plan; adding the `mcp.1920agency.com`
block to Raptor's Caddyfile and recreating Caddy (seconds of Raptor downtime);
a separate edge network `adspilot_edge` shared only by Raptor's Caddy and the
MCP (chosen over joining Raptor's `deploy_internal`, so the MCP cannot reach
Raptor's API). Optional, separate: a 2 GB swap file; `docker builder prune
--filter until=168h` to reclaim Raptor's old build cache. **All approved by the
owner on 2026-10-08.**

**A1. Merge and push.** Merge `phase3-deploy` into `master`; push to GitHub.

**A2. Upload the code.**

```bash
deploy/scripts/release.sh --upload-only            # -> /opt/adspilot/releases/<commit>
$S 'cd /opt/adspilot && ln -sfn releases/$(ls -1t releases | head -n1) app && ls -l app'
```

**A3. The server's env file**, copied from the PC's without the values being
shown: only the names the server uses (`.env.example`), CR characters dropped.

```bash
$S 'install -d -m 700 /opt/adspilot/env'
grep -E '^(DATABASE_URL|DIRECT_URL|VAULT_MASTER_KEY|META_APP_ID|META_APP_SECRET|META_API_VERSION|META_REDIRECT_URI|THREADS_APP_ID|THREADS_APP_SECRET|THREADS_REDIRECT_URI|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|GOOGLE_REDIRECT_URI|YOUTUBE_UPLOADS_AUDITED|YOUTUBE_DEFAULT_PRIVACY|YOUTUBE_CATEGORY_ID|SLACK_WEBHOOK_URL|POSTHOG_KEY|POSTHOG_HOST|UPGRADE_URL)=' "$ENVPC" \
  | tr -d '\r' | $S 'umask 077; cat > /opt/adspilot/env/adspilot.env'
$S 'cut -d= -f1 /opt/adspilot/env/adspilot.env'                          # names only
$S "sed -n 's/^DIRECT_URL=.*@\([^:/?]*\).*/\1/p' /opt/adspilot/env/adspilot.env"   # host only
```

If that host is `db.<ref>.supabase.co` (IPv6-only on the free plan), set
`DIRECT_URL` on the server to the **pooler's session-mode address** (Supabase
dashboard, Connect, "Session pooler", port 5432) by editing the file on the
server (`nano /opt/adspilot/env/adspilot.env`). Containers have no IPv6.

**A4. Setup and start.**

```bash
$S '/opt/adspilot/app/deploy/scripts/setup.sh'
```

Builds the image, checks Supabase's schema is current (read-only `migrate
status`; it stops if migrations are pending), starts `mcp` and `worker`, prints
the health answer. From here the PC worker and the server worker both run; that
is safe (see above).

**A5. Caddy.** In **Raptor's repo** (otherwise Raptor's next release removes
it), commit two changes: append `deploy/caddy/mcp.1920agency.com.caddy` to
`site/deploy/Caddyfile`, and in `site/deploy/docker-compose.yml` attach the
caddy service to the edge network (`networks: [internal, adspilot_edge]`, plus
`adspilot_edge: {external: true, name: adspilot_edge}` under `networks:`).
setup.sh (A4) has already created that network. Check first that the server's
two files still match the repo (sha256), then upload only those files,
validate, and recreate Caddy:

```bash
cd "/d/My AI Works/Websites/Raptor-Downloader/site"
git -c core.autocrlf=false archive HEAD deploy/Caddyfile deploy/docker-compose.yml | $S 'tar -x -C /opt/raptor/site'
$S 'cd /opt/raptor/site/deploy \
  && docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
  && docker compose up -d --force-recreate caddy'
for u in https://mcp.1920agency.com/health https://raptordownloader.com/ https://api.raptordownloader.com/health; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$u") $u"; done
curl -s https://mcp.1920agency.com/health        # {"ok":true,"database":"reachable",...}
curl -s -X POST https://mcp.1920agency.com/mcp   # 401 Unauthorized (correct without a token)
```

(The certificate is issued on the first request; give it a minute.)

**A6. Backups.** On the PC, once: a key pair whose private half never leaves
the PC.

```bash
gpg --quick-generate-key "AdsPilot backups" default default never   # asks for a passphrase
gpg --armor --export "AdsPilot backups" | $S 'cat > /opt/adspilot/env/backup-public.asc'
# offline copy of the PRIVATE key (USB drive or password manager, never the workspace):
gpg --armor --export-secret-keys "AdsPilot backups" > "<USB drive>/adspilot-backup-private.asc"
```

Then the first backup by hand, the pull, and the restore test:

```bash
$S '/opt/adspilot/app/deploy/scripts/backup.sh'
deploy/scripts/pc-backups.sh pull           # -> %USERPROFILE%\.social-publisher\backups\
deploy/scripts/pc-backups.sh restore-test   # decrypt here, restore into a throwaway DB there, row counts
```

The restore test is the proof that a backup counts (decision 0010: monthly).

**A7. Prove the server worker, then switch the PC's off.**

```bash
$S '/opt/adspilot/app/deploy/scripts/dc.sh logs --tail 20 worker'   # "polling every 15000ms"
$S 'docker inspect -f "{{.State.Health.Status}}" adspilot-worker-1'  # healthy
```

Then in PowerShell on the PC (reversible with `/ENABLE`):

```powershell
schtasks /Change /TN AdsPilot-Worker /DISABLE
```

and one real scheduled post **that the owner approves** (approval token as
always), due ~10 minutes later. Verified only when the server's log shows
`PUBLISHED` for it (RULES R4):

```bash
$S '/opt/adspilot/app/deploy/scripts/dc.sh logs --since 30m worker | grep -E "PUBLISHED|UPLOADED|FAILED"'
```

If it did not publish: `schtasks /Change /TN AdsPilot-Worker /ENABLE` and look
at the worker log.

**A8. Timers, then the PC's monitor and refresh off.**

```bash
$S '/opt/adspilot/app/deploy/scripts/setup.sh --install-timers'
$S 'systemctl list-timers "adspilot-*"'
$S 'systemctl start adspilot-monitor.service; journalctl -u adspilot-monitor -n 30 --no-pager'
```

```powershell
schtasks /Change /TN AdsPilot-Monitor /DISABLE
schtasks /Change /TN AdsPilot-Refresh /DISABLE
schtasks /Change /TN Social-Publisher-Keepalive /DISABLE
```

(The monitor's messages still say "Task Scheduler" and `run-worker-now.cmd`;
updating that wording is a small follow-up code change, RULES R1.)

**A9. Connect an AI app to the hosted MCP.** Create a token on the dashboard's
Tokens page (PC). Set `MCP_PUBLIC_URL=https://mcp.1920agency.com/mcp` in the
PC's env file so that page shows the hosted address. For Claude Code, at user
scope (the token is stored in `~/.claude.json`, outside the workspace):

```bash
claude mcp add --scope user --transport http adspilot-hosted https://mcp.1920agency.com/mcp --header "Authorization: Bearer <token>"
```

Then `check_usage` and `list_accounts` through it: Stage A is verified live.

**Later updates:** `deploy/scripts/release.sh` (refuses a dirty tree and pending
migrations; switches the release, restarts, checks the live health) and
`deploy/scripts/release.sh --rollback`.

**Rollback A:**

```bash
$S '/opt/adspilot/app/deploy/scripts/dc.sh down'      # stops mcp and worker; Supabase untouched
$S 'systemctl disable --now adspilot-backup.timer adspilot-monitor.timer adspilot-refresh.timer adspilot-keepalive.timer'
```

```powershell
schtasks /Change /TN AdsPilot-Worker /ENABLE; schtasks /Change /TN AdsPilot-Monitor /ENABLE
schtasks /Change /TN AdsPilot-Refresh /ENABLE; schtasks /Change /TN Social-Publisher-Keepalive /ENABLE
```

and remove the block from Raptor's Caddyfile (revert the commit, A5 again).

---

### Stage B: the data moves to Postgres on the server (decision 0010)

**B0. Decide first** (owner):

1. **Media.** Images and PDFs stay in Supabase Storage. After the move nothing
   writes to the Supabase database, so the free project may pause after 7 days
   and the media links would stop working. Either move media first (decision
   0010 Â§5: a folder served by Caddy, or Hetzner Object Storage / R2), or keep a
   weekly keep-alive pointed at Supabase. Which activity Supabase counts is not
   verified (RULES R7).
2. **How the PC reaches the data.** The PC's own AdsPilot (VS Code MCP with the
   ads tools, dashboard, connect command) needs the database. Recommended: an
   SSH tunnel, `127.0.0.1:15432` on the PC to `127.0.0.1:5432` on the server
   (Postgres is published on the server's loopback only, never to the
   internet), started at logon. Hardening for later: a dedicated tunnel-only SSH
   user instead of root.
3. **Window.** About 15 minutes in which nothing posts.

**B1. Rehearsal, no switch.** Stage A6's `pc-backups.sh restore-test` already
restores a real Supabase dump into a plain Postgres 17 with the roles and
`migrate deploy`. Run it once more right before B3; it must end with row counts.

**B2. Stop every other writer.** On the PC:

```powershell
schtasks /Change /TN AdsPilot-Worker /DISABLE    # already off since A7
```

Close VS Code (its AdsPilot MCP) and the dashboard.

**B3. Move** (backup first, then stop, switch, copy, compare every table's row
count, start):

```bash
$S '/opt/adspilot/app/deploy/scripts/move-to-local-db.sh --writers-stopped'
```

It refuses to start the MCP on the new database if any table's count differs.
The anon/authenticated roles are created NOLOGIN before `migrate deploy`,
because migrations `20260925010000_lock_down_data_api` and
`20261008120000_add_plans_and_usage` revoke from them; applied migrations are
never edited.

**B4. Verify** (R4): `https://mcp.1920agency.com/health` shows a latency of a
few ms; `check_usage` through the hosted MCP; one approved scheduled post
published by the server; then `backup.sh`, `pc-backups.sh pull`,
`pc-backups.sh restore-test` against the new database's dump.

**B5. Switch the PC.** Start the tunnel:

```bash
ssh -i ~/.ssh/raptor_hetzner -N -L 15432:127.0.0.1:5432 root@37.27.148.217
```

and point the PC's env file at it, without the password being shown (a copy of
the old file is kept next to it):

```bash
bak="$ENVPC.supabase-$(date +%Y%m%d-%H%M)"
cp "$ENVPC" "$bak"
PW=$($S 'cat /opt/adspilot/env/postgres_password')
LOCAL_URL="postgresql://adspilot:$PW@127.0.0.1:15432/adspilot" awk '
  /^DATABASE_URL=/ { print "DATABASE_URL=" ENVIRON["LOCAL_URL"]; next }
  /^DIRECT_URL=/   { print "DIRECT_URL=" ENVIRON["LOCAL_URL"]; next } { print }' \
  "$bak" > "$ENVPC"; unset PW
```

Then reopen VS Code; `check_usage` on the local MCP must work. Keep the PC's
tasks off: the server runs them.

**B6. Keep Supabase untouched** for at least two weeks as the fallback.

**Rollback B:**

```bash
$S '/opt/adspilot/app/deploy/scripts/move-to-local-db.sh --rollback'
cp "$ENVPC.supabase-<date>" "$ENVPC"      # the PC back to Supabase
```

Rows written on the server after the move (new posts, jobs, tool_calls) are
not in Supabase. Copy them back by hand (by `created_at` after the move time)
or accept losing them; the sooner the rollback, the fewer. This copy-back
procedure is not scripted and not tested.

---

### Day to day

```bash
$S '/opt/adspilot/app/deploy/scripts/dc.sh ps'
$S '/opt/adspilot/app/deploy/scripts/dc.sh logs --tail 100 mcp'
$S 'tail -n 50 /opt/adspilot/logs/worker/events.jsonl'
$S 'systemctl list-timers "adspilot-*"; ls -lh /opt/adspilot/backups'
$S 'docker stats --no-stream'
```

### Open items (not in this kit)

- The OAuth bounce: merge `https-callbacks`, reload Caddy with the `@oauth`
  block, then the owner checklist below. Not exercised live yet (R4).
- Monitor wording that still mentions Task Scheduler (R1).
- Media storage choice (decision 0010 Â§5) before or with Stage B.
- Pin the Node and Postgres images by digest after the first good build.
- Rate limiting on `/mcp` (stock Caddy has none; every unauthenticated request
  costs one token lookup in the database).

### OAuth over https: the owner checklist

Meta enforces https only while the app is Live, which is the case this solves.
Order matters: **console first, then the env file, then reconnect.** Changing the
env file first makes the provider refuse the dialog ("URL blocked" / "Can't load
URL"), because the address is not registered yet.

**Step 0, once, before any provider (not the owner's part).**

1. Branch `https-callbacks` merged into `master` on the PC. The connect commands
   run from `source/apps/cli/src`, so nothing has to be rebuilt for them.
2. The `@oauth` block live in Raptor's Caddy. The block from
   `deploy/caddy/mcp.1920agency.com.caddy` goes into Raptor's repo
   (`Websites/Raptor-Downloader/site/deploy/Caddyfile`, between the
   AdsPilot marker and the end of the file), committed there, then uploaded and
   **reloaded** (no restart, no downtime for raptordownloader.com). Caddy's
   Caddyfile is a single-file bind mount, so the file on the server must be
   rewritten **in place** (same inode); `tar -x` or `sed -i` replace the file and
   the running container would keep reading the old one:

   ```bash
   cd "/d/My AI Works/Websites/Raptor-Downloader/site"
   git -c core.autocrlf=false archive HEAD deploy/Caddyfile | tar -xO \
     | $S 'cp /opt/raptor/site/deploy/Caddyfile /opt/raptor/site/deploy/Caddyfile.bak-$(date +%Y%m%d-%H%M) \
           && cat > /opt/raptor/site/deploy/Caddyfile'
   $S 'cd /opt/raptor/site/deploy \
     && docker compose exec -T caddy grep -c "@oauth {" /etc/caddy/Caddyfile \
     && docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
     && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile'
   ```

   Then check (no real code involved; `x` and `y` are placeholders):

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'https://mcp.1920agency.com/callback?code=x&state=y'
   #   302 http://localhost:8787/callback?code=x&state=y
   curl -s -o /dev/null -w '%{http_code}\n' 'https://mcp.1920agency.com/callbackx'          # 404
   curl -s -o /dev/null -w '%{http_code}\n' -X POST 'https://mcp.1920agency.com/callback'   # 404
   curl -s https://mcp.1920agency.com/health                                                 # ok
   for u in https://raptordownloader.com/ https://api.raptordownloader.com/health; do
     echo "$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$u") $u"; done                    # 200 200
   ```

   Rollback: `cat` the `.bak-*` copy back the same way and reload again.

**Then, per provider, the owner** (one provider at a time; the localhost address
stays registered next to the new one, so switching back is just the env value):

| # | Provider | Developer console: where | Add exactly | PC env value to change | Reconnect with (in `source/apps/cli`) |
|---|---|---|---|---|---|
| 1 | Facebook Pages (+ the Instagram accounts linked to them) | developers.facebook.com, the Meta app (Mysmadspilot): **Facebook Login for Business, Settings, Valid OAuth Redirect URIs**. Keep "Enforce HTTPS" and "Use Strict Mode for redirect URIs" on. | `https://mcp.1920agency.com/callback` | `META_REDIRECT_URI` | `pnpm connect` |
| 1b | (same app) | **App settings, Basic, App domains**, only if Meta still shows "The domain of this URL isn't included in the app's domains" | `1920agency.com` | none | |
| 2 | Threads | the Meta app: **Use cases, Access the Threads API, Customize, Settings, Redirect Callback URLs** | `https://mcp.1920agency.com/threads/callback` | `THREADS_REDIRECT_URI` | `pnpm connect:provider threads` |
| 3 | Instagram direct login (only if `INSTAGRAM_APP_ID` is in use; accounts linked to a Page come with step 1) | the Meta app: **Instagram, API setup with Instagram login, Set up Instagram business login, Business login settings, OAuth redirect URIs** | `https://mcp.1920agency.com/instagram/callback` | `INSTAGRAM_REDIRECT_URI` | `pnpm connect:provider instagram` |
| 4 | Google / YouTube (optional) | console.cloud.google.com, project `gen-lang-client-0046538567`: **Google Auth Platform, Clients**, the Web application client, **Authorized redirect URIs**. Google may add `1920agency.com` to Branding, Authorized domains; that is expected. | `https://mcp.1920agency.com/google/callback` | `GOOGLE_REDIRECT_URI` | `pnpm connect:provider google youtube` |
| - | Pinterest, LinkedIn (both apps) | no change: they accept localhost today. If ever needed, the bounce already covers `/pinterest/callback`, `/linkedin/callback`, `/linkedin-page/callback`. | | | |

For each row:

1. **Console:** add the address next to the existing `http://localhost:8787/...`
   one (do not remove that one) and **Save**.
2. **Env file:** in `%USERPROFILE%\.social-publisher\.env` on the PC, change only
   the value of the named variable from `http://localhost:8787/<path>` to
   `https://mcp.1920agency.com/<path>`, same path, no trailing slash. The owner
   edits this file; no agent edits or prints it. `OAUTH_CALLBACK_PORT` stays
   unset (8787 is where the bounce points).
3. **Reconnect** with the command in the table. The terminal shows "Your browser
   will come back through mcp.1920agency.com, which sends it straight on to this
   PC (localhost:8787)". After approving, the browser visits
   `mcp.1920agency.com` for a moment and lands on the green "Connected" page on
   localhost; the terminal ends with "Done. N ... connected". Verified only then
   (R4), and `list_accounts` shows the accounts as not needing reauth.
4. **If it fails:** put the env value back to the localhost form; Meta then
   needs Development mode for that one reconnect, as before. A 404 page from
   `mcp.1920agency.com` means the Caddy block is not live (Step 0); "URL
   blocked" or "Can't load URL" means the console address was not saved or is
   not character-for-character the same as the env value.

The server's own env file also holds copies of `META_REDIRECT_URI`,
`THREADS_REDIRECT_URI` and `GOOGLE_REDIRECT_URI` (A3). They need no change: a
redirect address is used only in the dialog and the code exchange, and both
happen in the PC's connect commands (token refreshes do not send it).

### Shopify: can its install callback use the bounce?

Read with `research/2026-10-08-shopify-integration.md` and
`architecture/2026-10-08-shopify-connector-plan.md`; no Shopify code is part of
this change.

- **The dev store needs no callback at all.** It is owned by the app's own
  organisation, so phase 1 already gets its token by the client-credentials
  grant (verified live 2026-10-08). Nothing to bounce.
- **Rehearsing the OAuth install on the dev store: the bounce could serve it,
  with conditions.** It works only if (a) a connect command on the PC starts the
  authorisation itself (`https://<shop>/admin/oauth/authorize?...&state=...`)
  and listens, as the other providers do; (b) `/shopify/callback` is added to
  the Caddy `@oauth` paths and `https://mcp.1920agency.com/shopify/callback` to
  `[auth] redirect_urls` in `integrations/shopify-app/shopify.app.toml` (and,
  possibly, `application_url` on the same host; not verified); (c) the command
  verifies Shopify's `hmac` with the app secret, the `state`, and that `shop` is
  a `*.myshopify.com` name before exchanging the code; (d) the owner clicks
  Install in a browser on that PC.
- **Client stores (Muzaree, phase 1 proper) need a server-side handler.** The
  custom-distribution install link is opened by the merchant, in the merchant's
  own browser: the bounce would send their browser to *their* `localhost:8787`,
  where nothing listens. The install link also starts at Shopify (it loads the
  app's `application_url` with `shop` and `hmac`, not a code with our `state`),
  so there is no waiting CLI to hold the state. And Shopify's webhooks
  (`app/uninstalled`, the three compliance webhooks, order webhooks) are
  server-to-server POSTs that a browser redirect can never receive. So:
  `/shopify/install` and `/shopify/callback` (and the webhook endpoints) served
  by the hosted MCP on `mcp.1920agency.com`, which verifies HMAC and state,
  exchanges the code on the server and writes the offline token to the vault.
  The bounce is at most a stopgap for an install the owner performs himself on
  this PC with staff access to the store.

### Shopify self-service: deploy steps (DEPLOYED 2026-10-08)

**Deployed 2026-10-08 ~09:45 PKT** (owner approved): server env gained the two
`SHOPIFY_CONNECTOR_CLIENT_*` names, `/opt/adspilot/data/shopify-backups` created
(uid 1000), `release.sh` released `0b0afef62b86`. The `@shopify` Caddy block was
already live: Raptor's `cffbb2e` was HEAD when the OAuth bounce was uploaded in
place and reloaded (no recreate needed). Checked: `/shopify` 200, `/shopify/callback`
400 (unsigned), `/health` 200, `/mcp` 401, Raptor 200. **Not yet verified end
to end:** `shopify_connect_store` from an AI app on the hosted URL (needs a
dashboard token and a client pointed at https://mcp.1920agency.com/mcp).

Code: commit d313b9e (`source/apps/mcp/src/shopify-hosted.ts`), plan in
`architecture/2026-10-08-shopify-connector-plan.md`. The Shopify app (config
version 5, `integrations/shopify-app/shopify.app.toml`) already sends users to
`https://mcp.1920agency.com/shopify/callback`; nothing to set in Shopify. Until
this deploy, that address answers 404, which only matters to a user who tries
to connect: the owner's PC tools do not use it.

**Approvals needed** (owner): the server env change, the release, and recreating
Raptor's Caddy (a few seconds of raptordownloader.com downtime).

All in Git Bash on the PC, with `S` and `ENVPC` as above.

1. **Server env**: add the app's two keys, copied without showing them. Not
   `SHOPIFY_CONNECT_ADDRESS` (a workaround for this PC's ISP only).
   `PUBLIC_BASE_URL` is not needed: it defaults to `https://mcp.1920agency.com`.

   ```bash
   $S 'grep -c "^SHOPIFY_CONNECTOR_" /opt/adspilot/env/adspilot.env || true'     # expect 0
   grep -E '^SHOPIFY_CONNECTOR_CLIENT_(ID|SECRET)=' "$ENVPC" | tr -d '\r' \
     | $S 'umask 077; cat >> /opt/adspilot/env/adspilot.env'
   $S 'cut -d= -f1 /opt/adspilot/env/adspilot.env | grep SHOPIFY'               # names only
   ```

2. **Backups folder** (the container runs as uid 1000; setup.sh now makes it
   too, but release.sh does not run setup.sh):

   ```bash
   $S 'install -d -o 1000 -g 1000 -m 700 /opt/adspilot/data/shopify-backups'
   ```

3. **Release** (refuses only if `source/` or `deploy/` has uncommitted changes;
   PROJECT-LOG.md and WAITING-LIST.md do not block it):

   ```bash
   deploy/scripts/release.sh
   ```

4. **Caddy**: the `@shopify` block is committed in Raptor's repo (cffbb2e,
   identical to `deploy/caddy/mcp.1920agency.com.caddy`). Check the server's
   copy is still the previous commit's, then upload, validate, recreate:

   ```bash
   cd "/d/My AI Works/Websites/Raptor-Downloader/site"
   git show cffbb2e~1:deploy/Caddyfile | sha256sum; $S 'sha256sum /opt/raptor/site/deploy/Caddyfile'   # must match
   git -c core.autocrlf=false archive HEAD deploy/Caddyfile | $S 'tar -x -C /opt/raptor/site'
   $S 'cd /opt/raptor/site/deploy \
     && docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
     && docker compose up -d --force-recreate caddy'
   for u in https://mcp.1920agency.com/health https://raptordownloader.com/ https://api.raptordownloader.com/health; do
     echo "$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$u") $u"; done
   ```

5. **Checks**:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://mcp.1920agency.com/shopify            # 200 (info page)
   curl -s -o /dev/null -w '%{http_code}\n' https://mcp.1920agency.com/shopify/callback   # 400 (unsigned)
   ```

   Then end to end, from an AI app connected to the hosted AdsPilot:
   `shopify_connect_store` with `1920-agency-test-store.myshopify.com` â†’ open the
   link â†’ Install â†’ the page says "connected" â†’ `list_shopify_stores` and
   `shopify_store_audit` work. `shopify_disconnect_store` afterwards if wanted.

**Rollback**: `deploy/scripts/release.sh --rollback`; for Caddy, re-upload
`git show cffbb2e~1:deploy/Caddyfile` the same way. The two env lines can stay
(unused by the older release).

**Not covered yet**: `backup.sh` dumps the database only, so
`/opt/adspilot/data/shopify-backups` (earlier versions of users' products and
pages) is not in the encrypted backups. Fine for the test store; add it before
real customers connect.
