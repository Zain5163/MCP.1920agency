# Central configuration: every value that may change, in one place

**2026-10-10. Built and tested on branch `central-config`; merged into master and included in release `142423d` the same day.**

The owner (2026-10-10): *"use a dynamic variable / environment variable so in
future we don't need to change everywhere — change only one thing, at one place,
like in env files."*

"AdsPilot" is a working name, the final product name is not chosen, and the
domain `mcp.1920agency.com` is temporary. Before this change the name was written
out in about 250 lines across 85 files, the domain in code, scripts, Caddy and
compose, and the server address and SSH key in two scripts each.

---

## 1. Where settings live (the answer in one table)

| Value | Its one home | How the rest get it |
|---|---|---|
| Product name (`AdsPilot`) | `PRODUCT_NAME` in `PRODUCT_DEFAULTS`, `source/packages/config/src/product.ts` | `productName()`; our own skills and playbooks write `{{PRODUCT_NAME}}`, filled in when served; dashboard `<Wordmark />` |
| Product slug (`adspilot`: MCP server name, client-config key, `<slug>://` resource URIs, log prefixes) | `PRODUCT_SLUG`, same object | `productSlug()` |
| Company (`1920 Agency`) | `COMPANY_NAME`, same object | `companyName()` (first workspace's name), `shopifyAppName()` = "<company> Store Connector" |
| OAuth listener port (8787) | `OAUTH_CALLBACK_PORT`, same object | `DEFAULT_OAUTH_CALLBACK_PORT`; `deploy/site.env` `OAUTH_BOUNCE_PORT` must equal it (tested) |
| MCP port (8080) | `MCP_PORT`, same object | `mcpPort()`; compose sets it for the container |
| OAuth redirect addresses | each `*_REDIRECT_URI` in the env file, else `OAUTH_REDIRECT_BASE` (default `http://localhost:8787`) + the path in `OAUTH_REDIRECT_PATHS` (product.ts) | `oauthRedirectUri(name)`; existing explicit values win, so the owner's env file works unchanged |
| Public address of the hosted server | `DOMAIN` in `deploy/site.env` | compose sets `PUBLIC_BASE_URL=https://$DOMAIN` for the MCP; code reads `publicBaseUrl()` (no default in code) |
| MCP address shown on the Tokens page | `MCP_PUBLIC_URL`, else `PUBLIC_BASE_URL/mcp`, else `http://localhost:8080/mcp` | `mcpPublicUrl()` |
| Upgrade link | `UPGRADE_URL` (env, unset until checkout exists) | `upgradeUrl()` |
| Server address, SSH user, SSH key | `SERVER_HOST`, `SERVER_USER`, `SSH_KEY` in `deploy/site.env` | `deploy/scripts/site.sh` → `$SSH_TARGET`, `$SSH_KEY_FILE` (release.sh, pc-backups.sh, caddy-site.sh). `ADSPILOT_HOST` / `ADSPILOT_SSH_KEY` still override |
| Server folder (`/opt/adspilot`), compose project, edge network | `ADSPILOT_HOME`, `COMPOSE_PROJECT`, `EDGE_NETWORK` in `deploy/site.env` | `common.sh` (via `site.sh`), `dc.sh -p`, `setup.sh`; systemd units and logrotate are rendered from `ADSPILOT_HOME` by `setup.sh --install-timers` (as before) |
| The gate (`/opt/gate`) | `GATE_DIR` in `deploy/site.env` | `caddy-site.sh --upload` |
| Gate site file (`sites/<DOMAIN>.caddy`) | rendered from `deploy/caddy/site.caddy.template` + `deploy/site.env` | `deploy/scripts/caddy-site.sh` (prints) / `--upload` (installs, validates, reloads, restores the old file if the gate refuses it) |
| Secrets | unchanged: `%USERPROFILE%\.social-publisher\.env` (PC), `$ADSPILOT_HOME/env/adspilot.env` (server) | never in `site.env` or the repo |
| PostHog host | `DEFAULT_POSTHOG_HOST`, `packages/config/src/env.ts` (already single before this) | `analyticsConfig()` |

**Precedence (runtime):** process environment, then `~/.social-publisher/.env`,
then the default in `PRODUCT_DEFAULTS`. **Precedence (scripts):** a variable
already in the environment, then `deploy/site.env`.

### Why the two homes are split

- *What the product is called* is runtime text in many apps, so it is one typed
  module that every app and package imports (`@social-publisher/config`). Read
  lazily (a function call), never at import, so tests and one-off overrides work.
- *Where it runs* is deployment: the scripts run in Git Bash on the PC and in
  bash on the server, where no Node is installed outside containers. A plain
  `NAME=value` file that bash can read and the tests can parse is the single
  source; the runtime gets the domain from it through compose
  (`PUBLIC_BASE_URL`), so the domain is written in no code at all.
- **Why the Caddy file is rendered, not `{$DOMAIN}`:** Caddy's env placeholders
  are read from the Caddy process's environment. The gate (`/opt/gate`,
  `AI-Automation/Server-Gate`) is one Caddy for every site on the server; its
  compose file sets no environment and is not this project's to change. So
  `caddy-site.sh` renders our one site file from the template. Checked: the
  rendered file has exactly the same directives as the live
  `sites/mcp.1920agency.com.caddy` (only header comments differ).

---

## 2. To rename the product, or move the domain

### Rename the product (and/or the company)

1. `source/packages/config/src/product.ts`: change `PRODUCT_NAME` (and
   `PRODUCT_SLUG` if the lower-case name should change; `COMPANY_NAME` if the
   company changes). Nothing else in the code.
2. In `source`: `pnpm -r build && pnpm -r typecheck && pnpm -r --filter
   "!@social-publisher/auth" --filter "!@social-publisher/db" test`. The guard
   test (`packages/config/test/central-config.test.ts`) then fails on any place
   that still writes the old name or company, with the file, line and what to
   use instead.
3. If the **company** changed, the Shopify app record is an external
   registration the test checks: change `name` in
   `integrations/shopify-app/shopify.app.toml` and run `shopify app deploy` there
   (owner approval). Optionally `package.json`'s package name there.
4. Commit, then (with approval) `deploy/scripts/release.sh` for the server and
   restart the dashboard/MCP on the PC. Messages, tool descriptions, server
   instructions, served skills, the dashboard, the Shopify connect page and the
   WordPress user agent all show the new name.
5. Not renamed, on purpose (see §4): Windows task names, server folder and
   container names, the skills folder `adspilot/`, stored codes, the session
   cookie. Changing those is a migration, not a rename.

To *try* a name on one machine without committing: `PRODUCT_NAME=...` in that
machine's env file.

### Move to another domain

1. DNS: point the new domain at the server (`SERVER_HOST`).
2. `deploy/site.env`: change `DOMAIN`. Nothing else in the repository.
3. Tests (as above). They fail until the Shopify app record agrees: change
   `application_url` and `redirect_urls` in
   `integrations/shopify-app/shopify.app.toml` and `shopify app deploy` (owner).
4. Commit. With approval: `deploy/scripts/caddy-site.sh --upload` (installs
   `/opt/gate/sites/<new domain>.caddy`, validates the gate, reloads; it lists the
   old domain's file, which keeps serving until removed), then
   `deploy/scripts/release.sh` (the MCP gets the new `PUBLIC_BASE_URL`; the
   health check uses the new domain).
5. Outside this repo (cannot be done from here): the provider consoles' redirect
   addresses (Meta, Threads, Instagram, Google: `deploy/README.md` "OAuth over
   https", same table with the new domain), the PC env file's `*_REDIRECT_URI`
   values that use the bounce (or one `OAUTH_REDIRECT_BASE=https://<new domain>`
   if they are removed), `MCP_PUBLIC_URL` if set, and every AI client configured
   with the old `https://<old domain>/mcp`.
6. When the new domain works: remove the old `sites/<old domain>.caddy` on the
   gate and reload it.

### Move to another server

`deploy/site.env`: `SERVER_HOST` (and `SERVER_USER`, `SSH_KEY`, `GATE_DIR` if they
differ), then `deploy/README.md` Stage A on the new host. Keep `ADSPILOT_HOME`,
`COMPOSE_PROJECT` and `EDGE_NETWORK` unless building fresh.

---

## 3. Inventory (2026-10-10, before the change)

Scope: `source/` (packages, apps, served skills; `node_modules`, `dist`, `.next`
and the four vendored skill libraries skipped), `deploy/`, `integrations/
shopify-app` (record files), the root `.env.example` and `*.cmd`. Historical
docs (PROJECT-LOG, research, reviews, decisions) were not counted as places to
change.

### Counts (lines containing the value)

| Value | Lines / files | By kind |
|---|---|---|
| `AdsPilot` (display name) | 251 / 85 | source code 106 (34 of them comments or identifiers, left as they are), our served skills 67 (69 mentions, 24 files), deploy 33, docs 26, tests 11, launchers 4, Shopify app record 3, env template 1 |
| `adspilot` (lower case) | 160 / 35 | server infrastructure names (folder, compose project, networks, volume, units, image, backup files, DB user), stored codes, cookie, skills folder, resource URIs, MCP server name, temp prefix |
| `1920 Agency` / `1920-agency` | 44 / 24 | tests 31 (fixture account names), source 6, Shopify app record 5, docs 1, deploy 1 |
| `mcp.1920agency.com` | 70 / 16 | docs 41, tests 14, deploy 8, source 3, Shopify app record 2, env templates 2 |
| `37.27.148.217` | 5 / 4 | release.sh, pc-backups.sh, Caddy comment, deploy README |
| SSH key `raptor_hetzner` | 4 / 3 | release.sh, pc-backups.sh, deploy README |
| `/opt/adspilot` | 62 / 13 | scripts, compose defaults, systemd units, logrotate, docs |
| `localhost:8787` | 51 / 17 | redirect defaults in CLI, worker, dashboard, adapters; Caddy; env templates; tests; docs |
| port 8080 | 16 / 11 | MCP default port, Tokens page default, compose, healthchecks |
| `eu.i.posthog.com` | 14 / 7 | one default (env.ts), error-message examples, tests |

### Value by value

| Value | Where it was | Kind | Now |
|---|---|---|---|
| Product name in messages, errors, tool descriptions, server instructions, prompts | adapters (safe-http, wordpress, shopify-oauth, openrouter `X-Title`), core (plans), mcp (13 files), worker monitor-cli | user-facing text | `productName()` |
| Product name in served skills | `skills-library/adspilot/**` (md, liquid comments) | user-facing text | `{{PRODUCT_NAME}}`, rendered by `readSkillText` (own library only) |
| Product name in the dashboard | layout title, 5 pages' `Ads<span>Pilot</span>` | user-facing text | `productName()`, `<Wordmark />` (server component; login form split so it receives the wordmark) |
| WordPress user agent `AdsPilot-WordPress-Connector/1.0` | adapters/wordpress.ts | runtime | `ua()` from `productName()` |
| MCP server name `adspilot`, `adspilot://` URIs, `[adspilot]` log prefix, client-config key | mcp-server.ts, playbooks.ts, skills-library.ts, server.ts, context.ts, TokenManager | user-facing identifier | `productSlug()` |
| Windows task names `AdsPilot-Worker`, `AdsPilot-Refresh` | db/monitor.ts | live identifier | `FIXED_NAMES` in product.ts (do not follow a rename) |
| Company `1920 Agency` as first tenant name | cli connect.ts, connect-provider.ts | runtime | `companyName()` |
| Shopify app name "1920 Agency Store Connector" | adapters/shopify-admin.ts | user-facing text | `shopifyAppName()` |
| Company as an example account name | core/targets.ts | user-facing text | the user's own first account name |
| Domain default `https://mcp.1920agency.com` | mcp/shopify-hosted.ts | runtime | `publicBaseUrl()`; compose sets it from `DOMAIN` |
| Domain in release health check | release.sh | deploy | `$DOMAIN` |
| Domain in the gate site file | deploy/caddy/mcp.1920agency.com.caddy | deploy | `site.caddy.template` + `caddy-site.sh` |
| Domain in `PUBLIC_BASE_URL=`, `MCP_PUBLIC_URL` notes | deploy/.env.example, .env.example | docs/template | pointers to `deploy/site.env` |
| Server IP, SSH user, key path | release.sh, pc-backups.sh | deploy | `deploy/site.env` via `site.sh` |
| `/opt/adspilot` | common.sh default, release.sh `H=`, pc-backups.sh remote dirs | deploy | `ADSPILOT_HOME` in site.env |
| Compose project `adspilot`, network `adspilot_adspilot`, edge `adspilot_edge` | compose `name:`, common.sh, setup.sh | deploy | `COMPOSE_PROJECT`, `EDGE_NETWORK` in site.env (`dc.sh -p`); compose keeps the same names as fallbacks (tested equal) |
| Bounce port 8787 | Caddy, callback-address.ts, redirect defaults | runtime + deploy | `OAUTH_CALLBACK_PORT` (product.ts) = `OAUTH_BOUNCE_PORT` (site.env), tested |
| Redirect URI defaults `http://localhost:8787/<path>` | connect.ts, connect-provider.ts, refresh-cli.ts, web engine.ts, google-provider.ts | runtime | `oauthRedirectUri()` / `OAUTH_REDIRECT_PATHS` |
| `MCP_PORT` 8080, `UPGRADE_URL`, `MCP_PUBLIC_URL` reads | http-server.ts, server.ts, tokens page | runtime | `mcpPort()`, `upgradeUrl()`, `mcpPublicUrl()` |
| Product name in systemd descriptions, backup Slack alert, setup messages, launcher echo lines | deploy/systemd, backup.sh, setup.sh, *.cmd | operator text | neutral wording (the unit names `adspilot-*` already identify them) |
| Shopify app `name`, `application_url`, `redirect_urls` | integrations/shopify-app/shopify.app.toml | external registration | left (Shopify reads this file); a test fails unless it matches `DOMAIN` and the company |
| Google project id, Meta app name | deploy/README.md, START-HERE.md | docs | left (console identifiers, not used by code) |
| Supabase region (Singapore), server location (Helsinki) | docs, compose comment | docs | left (description, not configuration) |
| `D:\My AI Works` guard in pc-backups.sh | pc-backups.sh | safety check | left (refuses to write backups into the workspace) |
| `%USERPROFILE%\.social-publisher` | env.ts `CONFIG_DIR` (single), pc-backups.sh | runtime | already single in code; the folder name is a fixed identifier |
| Version strings (`createAdsPilotServer('0.3.0' / '0.2.0')`, Node 22, pnpm 12.5.1, images) | hosted-server.ts, local-server.ts, Dockerfile | code | left: they change with the code, not with a rename or a move |
| PostHog host | env.ts | runtime | already single (`DEFAULT_POSTHOG_HOST`) |

---

## 4. Left as they are, and why

- **Live identifiers** (do not follow a rename; renaming is a migration): server
  folder `/opt/adspilot`, compose project and containers `adspilot-*`, networks
  `adspilot_adspilot` / `adspilot_edge`, volume `adspilot_pgdata`, database user
  and name `adspilot`, image `adspilot:<tag>`, systemd units `adspilot-*`, backup
  files `adspilot-*.dump.gpg`, the gpg key "AdsPilot backups", Windows tasks
  `AdsPilot-*` (in `FIXED_NAMES`), the skills folder `skills-library/adspilot/`,
  stored codes `adspilot:notice` / `adspilot:attachments_not_stored`, the HMAC
  label `adspilot-shopify-state-v1` (changing it voids every open connect link),
  the session cookie `adspilot_session`, API token prefix `adsp_`, PostHog `$lib:
  'adspilot-server'` (would split the analytics series), `Symbol.for('adspilot.*')`.
- **Code identifiers and comments**: `createAdsPilotServer` and 34 lines of
  comments in `src` still say the working name. They are not shown to anyone; the guard
  skips comments in code and scripts on purpose (prose, not values).
- **Third-party skills** (marketingskills, advertising-skills, web-quality-skills,
  anthropic-skills): served exactly as pinned; their text is theirs.
- **Docs and history**: PROJECT-LOG, research, reviews, decisions,
  `deploy/README.md` (a runbook whose commands show today's values; its top note
  points here). Rewriting history to a placeholder would make it wrong about the
  past.
- **Tests**: assert today's defaults or use fixture names (e.g. a Facebook Page
  called "1920 Agency"). The three that spelled the product name now read the
  setting; the whole suite passes with `PRODUCT_NAME`, `PRODUCT_SLUG` and
  `COMPANY_NAME` overridden.
- **The Server-Gate project** (`AI-Automation/Server-Gate`): its comments name
  `sites/mcp.1920agency.com.caddy`; not ours to edit.

---

## 5. The guard

`source/packages/config/test/central-config.test.ts`:

- scans every package's and app's `src` (comments stripped), our served skills
  and playbooks (whole text), `deploy/` except its README (comments stripped in
  scripts, compose and units; templates and env examples whole), the root
  `*.cmd` and `.env.example`;
- fails on the product name (whole word), the split wordmark, the company (also
  as `1920agency` / `1920-agency`), the domain, the server address or the SSH key
  file name anywhere but `product.ts` and `site.env`, and says what to use;
- proves itself: the scan must include named files, and planted literals must be
  caught;
- checks agreement where a second file cannot read the source: bounce port =
  listener port, the Caddy template renders with no placeholder left, compose's
  fallbacks equal site.env, the Shopify app record is on `DOMAIN` with the
  company's app name.

Also `packages/config/test/product.test.ts` (defaults, env precedence, derived
addresses, redirect URIs, rendering, the wordmark split) and
`apps/cli/test/callback-address.test.ts` (Caddy paths = `.env.example` paths =
`OAUTH_REDIRECT_PATHS`; template port = site.env = listener).

---

## 6. Status

- Branch `central-config`, 2026-10-10. Gate green: build, typecheck, 1,253 tests
  in the eleven suites that need no database (1,233 before; +20). Every changed
  script passes `bash -n`; `site.sh` exercised locally (values, environment
  override, `common.sh` network name); `caddy-site.sh` rendered and compared with
  the live file (same directives).
- **Not verified live (RULES R4):** no release has run with the new `dc.sh`/
  compose (`PUBLIC_BASE_URL` from `DOMAIN`), and `caddy-site.sh --upload` has
  never run. The first `release.sh` after merging is the check: `/health` 200
  on the domain, and `shopify_connect_store` still returns a link on
  `https://<DOMAIN>/shopify/callback`.
- Nothing on the server, DNS, the gate or the owner's env file was changed.
