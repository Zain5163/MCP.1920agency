# AdsPilot — start here

**If you are a new session, a new machine, or a new person: read this file first.**
Everything needed to continue is in this folder. Nothing important lives only in a
chat transcript.

---

## What this is

A publishing engine that posts to social platforms, driven three ways: an **MCP
server** (so any AI client can drive it), a **web dashboard**, and a **CLI**.

The product bet, in the owner's words: *give one MCP server to a person or company
and they no longer need to go anywhere else — or hire a whole team.*

Working and verified live (2026-10-02): posting to **Facebook, Instagram and
LinkedIn**, and **Meta ads** end to end (a real campaign ran at PKR 500/day).
The full list is `CURRENT-STATE.md`; everything planned is `FUTURE-PLANS.md`.

---

## Read in this order

| File | What it answers |
|---|---|
| **START-HERE.md** (this) | Where everything is |
| **CURRENT-STATE.md** | Everything built today, and what is proven live |
| **FUTURE-PLANS.md** | Everything planned and not built, in order |
| **PROJECT-CONTEXT.md** | Purpose, decisions, risks, current state |
| **PROJECT-LOG.md** | What was built and verified, in order, with dates |
| **ROADMAP.md** | What to build next, ranked by dependency |
| **IDEAS.md** | The backlog. Nothing here is committed |
| **NEXT-STEPS.md** | Known gaps and improvements |
| **SETUP.md** | Accounts and credentials — the parts only the owner can do |
| **decisions/** | Why each major choice was made, and what was rejected |
| **WAITING-LIST.md** | What is blocked on someone else, and what unblocks it |
| **RULES.md** | Standing rules for how this project is built |
| **research/** | What was checked, when, against what source |
| **reference/ad-skills/** | Third-party ad playbooks, licensed and pinned. Source material only |
| **source/apps/mcp/playbooks/** | Our own playbooks for 11 ad platforms, served to AI clients |
| **architecture/** | How the system is put together |

---

## Where things live

**In this folder — all code and documentation:**

```
source/            the monorepo (13 workspaces)
  packages/        core, adapters, publisher, vault, media, db,
                   auth, config, telemetry
  apps/            web (dashboard), mcp (server), worker (scheduler), cli
media/to-post/     drop files here to publish them
media/posted/      moved here after publishing
*.cmd              launchers that work around PowerShell's execution policy
```

**Outside this folder, deliberately — at `C:\Users\<you>\.social-publisher\`:**

```
.env               all credentials
logs/              operational logs
```

Two reasons they are outside: the workspace `AGENTS.md` forbids secrets inside it,
and **this folder is a git repository**. Keeping secrets physically outside means a
mistake in `.gitignore` still cannot leak them.

---

## Where settings live

"AdsPilot" is a working name and `mcp.1920agency.com` a temporary domain, so each
value that may change is written **once** (owner, 2026-10-10). A test
(`source/packages/config/test/central-config.test.ts`) fails if one is written
anywhere else. Full table and inventory: `architecture/2026-10-10-central-config.md`.

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
server-move steps: `architecture/2026-10-10-central-config.md` §2.

---

## Running it

```
start-dashboard.cmd          dashboard at http://localhost:3000
run-worker-now.cmd           publish anything due right now
source/apps/mcp              node --experimental-strip-types src/http-server.ts
source/apps/cli              connect.ts · status.ts · post.ts · create-user.ts
```

**After any code change, restart the dashboard.** `next start` loads the build into
memory once; a stale process serving old code has caused confusing failures more
than once. `start-dashboard-dev.cmd` hot-reloads instead.

On Windows, stop a server with PowerShell, not `pkill` — `pkill` fails silently
here and leaves the old process serving.

---

## Live infrastructure

| | |
|---|---|
| Database | Supabase Postgres. Migrations in `source/packages/db/prisma/migrations` |
| Media | Supabase Storage, public bucket `media` |
| Meta app | `Mysmadspilot` (renamed from Mysmadspilot 2026-10-02; same App ID), linked to the verified **1920 Agency** business portfolio |
| Scheduled tasks | `AdsPilot-Worker` every 5 min · `Social-Publisher-Keepalive` Sundays 09:00 |

The keep-alive exists because Supabase pauses free projects after 7 days of
inactivity. It cannot run while the machine is off, so a long break still means a
manual resume from the dashboard.

---

## Rules this project holds itself to

1. **Every error states its cause and the numbered steps to fix it.** Enforced by
   tests in `packages/core/src/domain/resolutions.ts` — a thin entry fails the build.
   This matters more than usual because the operator is often an AI: given a
   resolution it can act, given a raw platform code it invents a plausible fix.
2. **Credentials never exist outside a callback.** The vault has no `getToken()`,
   because a function that returns a secret eventually has it logged.
3. **Tenant scoping is structural, not remembered.** `TenantScope` injects
   `tenant_id` into every query and cannot be built without one. A test fails if
   anyone adds an escalation method.
4. **Nothing is "done" until it is verified against the real thing.** Publishing was
   proven by publishing. Cancellation was proven by cancelling, forcing the job due,
   and watching the worker skip it.
5. **Nothing moves up a roadmap tier while the tier below has a known defect.**

---

## Current state

See **`CURRENT-STATE.md`** (built and proven) and **`FUTURE-PLANS.md`** (planned).
Blocked items and who unblocks them: `WAITING-LIST.md`.
