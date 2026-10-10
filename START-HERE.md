# AdsPilot — start here

**If you are a new session, a new machine, or a new person: read this file first.**
Everything needed to continue is in this repository and the places this file names.
Nothing important lives only in a chat transcript.

Internal codename: **`adspilot`** (decision 0011). "AdsPilot" is a working name: the
public name is not chosen yet (`WAITING-LIST.md` #14) and will be added as a label
only. Folders, the server, containers, timers and MCP keys keep their names.

---

## What this is

One MCP server that lets any AI run a business's social posting, paid ads and
marketing: posting, Meta ads, account setup, playbooks for 11 ad platforms,
Shopify and WordPress tools, skills, brand design systems. It is driven three ways:
the **MCP server** (local and hosted), a **web dashboard**, and a **CLI**.

The product bet, in the owner's words: *give one MCP server to a person or company
and they no longer need to go anywhere else — or hire a whole team.*

---

## Read in this order

1. **START-HERE.md** (this file): what it is, where every part lives, how to run it.
2. **STATUS.md**: the one status file. Live now, in progress, next up, waiting, recently
   done, known problems.
3. **RULES.md**: the owner's standing rules for how this project is built.
4. **docs/README.md**: the document shelves (product, decisions, architecture, runbooks,
   research, reviews, policies, reference, brand, archive) and what goes on each.

Then, as needed:

| File | What it answers |
|---|---|
| `PROJECT-LOG.md` | What was built and verified, in order, with dates (append-only history) |
| `WAITING-LIST.md` | What is blocked on someone else, and what unblocks it (to be folded into `STATUS.md`) |
| `SETUP.md` | Accounts and credentials: the parts only the owner can do |
| `docs/product/capabilities.md` | The full matrix of what is built and what is proven live |
| `docs/product/roadmap.md` | Everything planned, and the build order by tier |
| `docs/product/ideas.md` | The idea backlog. Nothing here is committed |
| `docs/product/glossary.md` | The product's many names, and what each one is |
| `deploy/README.md` | The server: release, rollback, backups, restore |

---

## The ecosystem map (checked 2026-10-10)

**git** = its own repository · **LIVE** = something running depends on it today.

```
D:\My AI Works\
├─ .mcp.json ............................ registers the LOCAL MCP "social-publisher" →
│                                          node ...\Social-Publisher\source\apps\mcp\src\server.ts   LIVE
│
├─ AI-Automation\
│  ├─ Social-Publisher\ .................. THIS REPO, the product. git → GitHub Zain5163/MCP.1920agency (master).
│  │  ├─ source\ ......................... pnpm monorepo: apps mcp, worker, web, cli; packages core, adapters,
│  │  │                                     publisher, vault, media, db, auth, config, telemetry, brands;
│  │  │                                     skills-library + playbooks served to AIs. LIVE (server and local MCP)
│  │  ├─ deploy\ ......................... Dockerfile, compose, release.sh / backups / restore, systemd timers,
│  │  │                                     the gate site file. LIVE on the server
│  │  ├─ integrations\shopify-app\ ....... Shopify app config (Shopify CLI). LIVE app
│  │  ├─ media\ .......................... to-post / posted / generated
│  │  ├─ docs\ ........................... every document, on fixed shelves (docs/README.md)
│  │  └─ *.cmd ........................... launchers: start-dashboard(-dev), run-worker-now, check-status, connect-accounts
│  │
│  ├─ MCP-Tooling\ ....................... git → Zain5163/MCP.1920agency-Tooling. The product's backup repo:
│  │                                        mirror\ = copies made by sync.sh (LinkedIn ops and content, Social-Render,
│  │                                        Muzaree-Paid-Media, memory notes, scheduled-task XML). Not live
│  ├─ LinkedIn-Content-Ops\ .............. LIVE: task LinkedIn-Content-Drafts 07:00 (drafts only);
│  │                                        approve-linkedin-posts.cmd → this repo's CLI. Never posts without the owner's y
│  ├─ Social-Render\ ..................... JSON spec → brand PNG/PDF. On demand; never posts
│  ├─ Muzaree-Paid-Media\ ................ CLIENT. LIVE: tasks Muzaree-Ads-Daily 11:00 and Muzaree-Ads-Check (odd hours),
│  │                                        headless Claude using the local MCP's read tools
│  ├─ Server-Gate\ ....................... git, no remote yet. Source of /opt/gate, the server's front door for
│  │                                        every domain. LIVE
│  ├─ Prospect-Engine\, PSX-Email-Outreach\   incubators, meant to become product features
│  └─ _archive\Meta-Ads-Publisher\, _archive\Ads-Platform\   predecessors, read-only history
│
├─ Marketing-and-Content\
│  ├─ LinkedIn-Content-System\ ........... the owner's own marketing: strategy, calendar, drafts, posts log. LIVE
│  └─ Brands\README.md ................... index of every brand kit (kits live in source/packages/brands/brands/)
│
└─ Websites\
   ├─ Muzaree-Shopify\ ................... CLIENT: theme package. Client store not touched
   ├─ 1920-agency\design-system\ ......... 1920 Agency brand foundation, locked v1.0
   └─ Zain-Personal-Branding\ ............ personal-brand site and coded design system

Outside the workspace, on this PC
  %USERPROFILE%\.social-publisher\          SECRETS: .env and backups, ad-accounts.json, Shopify stores and themes,
                                            store and DB backups. Never in git (AGENTS.md). Path is CONFIG_DIR in code
  %USERPROFILE%\.claude.json                user-level MCP "adspilot-hosted" → https://mcp.1920agency.com/mcp
  %USERPROFILE%\.claude\projects\d--My-AI-Works\memory\   Claude's memory notes (rules and pointers only)
  %USERPROFILE%\.ssh\raptor_hetzner         the SSH key release.sh and the backups use (SSH_KEY in deploy/site.env)

Server (Hetzner; address, user and folders in deploy/site.env)
  /opt/adspilot   app → releases/<commit>, releases, backups, data, env, logs           LIVE
                  containers adspilot-mcp-1, adspilot-worker-1;
                  systemd adspilot-{monitor,refresh,backup,keepalive}.timer
  /opt/gate       the shared front door (Caddy) for every domain; our site file is
                  sites/mcp.1920agency.com.caddy (rendered from deploy/caddy/site.caddy.template)   LIVE
  /opt/raptor     Raptor Downloader (another project)

Windows scheduled tasks
  AdsPilot-Worker / -Monitor / -Refresh, Social-Publisher-Keepalive   DISABLED on purpose (the server does it;
                                                                       the PC is the fallback)
  LinkedIn-Content-Drafts   07:00 daily        Muzaree-Ads-Daily 11:00 daily        Muzaree-Ads-Check every 2 h (odd hours)
```

Zones: the **product** (this repo and MCP-Tooling), **shared infrastructure**
(Server-Gate), **our own marketing** (LinkedIn-Content-System, brands), **clients run
with the product** (Muzaree), **incubators** and **predecessors**. Client data stays in
the client folder; lessons reach the product only as anonymous patterns.

### One product, many names

| Where | Name used |
|---|---|
| Internal codename (docs, server, Docker, systemd, skills) | `adspilot` |
| Working product name (public name not chosen) | AdsPilot |
| Folder on the PC | `Social-Publisher` |
| GitHub | `MCP.1920agency`, `MCP.1920agency-Tooling` |
| Local MCP key and tool prefix | `social-publisher`, `mcp__social-publisher__*` |
| Hosted MCP key | `adspilot-hosted` |
| Secrets folder | `~/.social-publisher` |
| Packages | `@social-publisher/*` |
| Domain (temporary) | `mcp.1920agency.com` |

Full list: `docs/product/glossary.md`. Do not rename any of these to "tidy up": tool
names, task names and paths are cited by running automation.

---

## Where settings live

"AdsPilot" is a working name and `mcp.1920agency.com` a temporary domain, so each
value that may change is written **once** (owner, 2026-10-10). A test
(`source/packages/config/test/central-config.test.ts`) fails if one is written
anywhere else. Full table and inventory: `docs/architecture/2026-10-10-central-config.md`.

| What | The one place |
|---|---|
| Product name, slug, company; OAuth and MCP ports | `PRODUCT_DEFAULTS` in `source/packages/config/src/product.ts` (env vars `PRODUCT_NAME`, `PRODUCT_SLUG`, `COMPANY_NAME` override it on one machine) |
| Domain, server, SSH user and key, server folder, compose project, gate folder | `deploy/site.env` (committed, no secrets) |
| Secrets | `%USERPROFILE%\.social-publisher\.env` (PC), `/opt/adspilot/env/adspilot.env` (server) |

In code use `productName()`, `companyName()`, `publicBaseUrl()` and the rest from
`@social-publisher/config`; in our own skills write `{{PRODUCT_NAME}}`; in deploy
scripts use `$DOMAIN`, `$SSH_TARGET` and the rest from `deploy/scripts/site.sh`.

**Rename the product:** change `PRODUCT_NAME` (and `PRODUCT_SLUG` / `COMPANY_NAME`
if wanted) in `product.ts`, run the tests, commit, then `deploy/scripts/release.sh`
(with approval) and restart the PC's dashboard and MCP. A company change also needs
`name` in `integrations/shopify-app/shopify.app.toml` and `shopify app deploy` (the
tests say so).

**Change the domain:** DNS first; change `DOMAIN` in `deploy/site.env`; update the
URLs in `integrations/shopify-app/shopify.app.toml` (the tests say so) and run
`shopify app deploy`; commit; then, with approval, `deploy/scripts/caddy-site.sh
--upload` and `deploy/scripts/release.sh`; then the provider consoles and the PC's
`*_REDIRECT_URI` values (`deploy/README.md`, "OAuth over https"). Details and the
server-move steps: `docs/architecture/2026-10-10-central-config.md` §2.

---

## Running it

```
start-dashboard.cmd          dashboard at http://localhost:3000
run-worker-now.cmd           publish anything due right now (the server normally does this)
source/apps/mcp              node --experimental-strip-types src/http-server.ts
source/apps/cli              connect.ts · status.ts · post.ts · create-user.ts
deploy/scripts/release.sh    ship source + deploy to the server (owner's approval first)
```

**After any code change, restart the dashboard.** `next start` loads the build into
memory once; a stale process serving old code has caused confusing failures more
than once. `start-dashboard-dev.cmd` hot-reloads instead. Shared packages load from
their compiled `dist/` (not in git): after changing a package's `src`, build it.

On Windows, stop a server with PowerShell, not `pkill` — `pkill` fails silently
here and leaves the old process serving.

---

## Live infrastructure

| | |
|---|---|
| Hosted MCP and worker | Hetzner server, `https://mcp.1920agency.com` (Stage A since 2026-10-09) |
| Database | Supabase Postgres (Stage B, onto the server, not started). Migrations in `source/packages/db/prisma/migrations` |
| Media | Supabase Storage, public bucket `media` |
| Backups | Nightly encrypted database and store backups on the server, copied to the PC; restore proven 2026-10-08 |
| Meta app | `Mysmadspilot`, linked to the verified **1920 Agency** business portfolio |
| Analytics | PostHog Cloud EU |

---

## Rules this project holds itself to

The full list with the owner's words is `RULES.md`. The five that matter most:

1. **Every error states its cause and the numbered steps to fix it.** Enforced by
   tests in `packages/core/src/domain/resolutions.ts` — a thin entry fails the build.
2. **Credentials never exist outside a callback.** The vault has no `getToken()`.
3. **Tenant scoping is structural, not remembered.** `TenantScope` injects
   `tenant_id` into every query and cannot be built without one.
4. **Nothing is "done" until it is verified against the real thing.**
5. **Nothing moves up a roadmap tier while the tier below has a known defect.**

---

## Keeping this current

A session that changes anything adds a dated entry to `PROJECT-LOG.md` and updates
the affected lines of `STATUS.md`. If a part moves, update the map above. Memory notes
keep only rules and pointers ("resume from STATUS.md"), never a second copy of the
status. After product work: push this repo and run `bash ../MCP-Tooling/sync.sh`.
