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

Working and verified live: **Facebook Pages and Instagram**. Six posts published,
one of them by the scheduler with nobody present.

---

## Read in this order

| File | What it answers |
|---|---|
| **START-HERE.md** (this) | Where everything is |
| **PROJECT-CONTEXT.md** | Purpose, decisions, risks, current state |
| **PROJECT-LOG.md** | What was built and verified, in order, with dates |
| **ROADMAP.md** | What to build next, ranked by dependency |
| **IDEAS.md** | The backlog. Nothing here is committed |
| **NEXT-STEPS.md** | Known gaps and improvements |
| **SETUP.md** | Accounts and credentials — the parts only the owner can do |
| **decisions/** | Why each major choice was made, and what was rejected |
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
| Meta app | `SMMM-Agent`, linked to the verified **1920 Agency** business portfolio |
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

## Current state, honestly

**Working:** Facebook and Instagram publishing, media upload, scheduling with
retry and backoff, encrypted credentials, error catalogue, telemetry with
redaction, tenant isolation, owner/admin roles, real login, hosted MCP with
per-user tokens, token management, cancel scheduled posts.

**Known gaps** (also in `NEXT-STEPS.md`):

- Nothing alerts if the scheduler stops. A silent worker looks like an empty queue.
- Every platform limit in `capabilities.ts` is `verified: false` — from knowledge,
  not checked against live documentation.
- Postgres RLS is designed but not written as migrations.
- The database password was exposed in a chat transcript on 2026-09-24 and
  **still needs rotating**.
- `APP_PASSWORD` remains in the env file and is no longer used.

**Not built:** everything in tiers 2–6 of `ROADMAP.md`.
