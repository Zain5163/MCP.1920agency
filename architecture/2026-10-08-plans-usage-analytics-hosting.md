# Plan: usage limits, analytics, accounts, hosting, backup, product site

**Date:** 2026-10-08. **Status:** agreed direction; phases below are the build
order. Owner's request in his words: the product should sell itself, and "if we
don't have analytics … customer logs, what they are doing, what they're calling,
we cannot enhance our product". Decisions: `decisions/0009-free-and-premium-plans.md`.

## Owner's decisions (2026-10-08)

- Free: **200 MCP calls a month**. Premium: **$9 a month**, unlimited (fair use).
- Analytics: **PostHog Cloud EU**, plus every call logged in our own database.
- Hosting: the existing **Hetzner** server; address **a subdomain of
  1920agency.com** (e.g. `mcp.1920agency.com`) until the product name is final.
- **Everything lives in the workspace and in a private GitHub repo**, never only
  in temporary folders.

## Phase 0 — Safety first (now)

| Item | Detail |
|---|---|
| **GitHub backup** | The repo has **no remote** today: one laptop holds everything. Owner creates a **private** GitHub repository; it is added as `origin` and pushed (Git Credential Manager opens the browser login). Push after every session. Later: the other non-git folders (LinkedIn-Content-Ops, Social-Render, LinkedIn-Content-System) go into a second private "ops" repo |
| **Nothing only in temp** | Review evidence and research that lived in the scratchpad is copied into `reviews/` and `research/` in this repo |

## Phase 1 — Plans and usage metering (MCP side)

- **Data (one additive migration, applied only with the owner's approval):**
  - `tenants.plan` (`free` / `premium`), `plan_renews_at`.
  - `tool_calls`: one row per MCP call — tenant, user, tool, ok/error, error
    code, duration ms, MCP client name and version (from the MCP `initialize`
    request: Claude Code, Claude Desktop, ChatGPT, Cursor…), transport, created at.
    **Never** the call's content, tokens or personal data.
  - `usage_months`: tenant, month, calls, the notice thresholds already shown.
- **Metering:** one wrapper around every tool registration (both transports),
  so no tool can be added unmetered. It records the call, increments the month,
  and attaches the threshold notice (25/50/75/85/90/95/99%) to that call's result.
  At 100% on Free, calls return the limit message (reset date + upgrade link)
  and do no work. Free account tools (`check_usage`, `upgrade`) are never counted.
- **Server instructions** gain one line: when a result carries a usage notice,
  tell the user in plain words.
- **New tools:** `check_usage` (calls used, left, reset date, plan) and
  `upgrade` (the link; until checkout exists, a waitlist/contact link).
- Local stdio use by the owner is the owner's tenant on Premium (never blocked).

### Phase 1 status: built 2026-10-08, migration not applied

Built and unit-tested on branch `phase1-usage` (not merged, not pushed). **Not
live**: nothing is metered until the migration is applied and the branch merged,
in that order. Only compiled and unit-tested (RULES R4); no call has been
metered against the real database yet.

| Piece | Where |
|---|---|
| Plan rules (200 calls, thresholds, notice and limit wording, UTC reset, https-only `UPGRADE_URL` with a plain-words fallback) | `packages/core/src/domain/plans.ts`; `USAGE_LIMIT_REACHED` in the error catalogue |
| Schema: `tenants.plan` (enum, default `free`), `tenants.plan_renews_at`, `tool_calls`, `usage_months` | `packages/db/prisma/schema.prisma` |
| Migration (written, **not applied**; additive; RLS on, Data API grants revoked on the new tables) | `packages/db/prisma/migrations/20261008120000_add_plans_and_usage/migration.sql` |
| Tenant-scoped reads and writes: `usage(month)`, `recordToolCall` (log + atomic upsert-increment in one transaction), `markNoticesShown` | `packages/db/src/tenant-scope.ts` |
| One wrapper on every tool, both transports; `check_usage` and `upgrade` | `apps/mcp/src/metering.ts`, `mcp-server.ts` (the only place a server is built), `account-tools.ts` |
| Stdio tool set as a function / hosted composition | `apps/mcp/src/local-server.ts`, `hosted-server.ts` |

**How "every tool" is guaranteed.** `createAdsPilotServer` installs metering on
the server before any tool exists, by wrapping the SDK's `tool()` and
`registerTool()`; the experimental task-tool route is refused. A test builds the
real stdio (39 tools) and hosted (12 tools) sets and fails if any handler is not
metered, and fails if any other `src` file constructs an `McpServer`.

**Failure behaviour.** If usage cannot be read, the call runs (fail open) and
this is logged; if the call cannot be recorded, the result goes back unchanged
and this is logged. On stdio the log goes to stderr, the log file and Slack.

**Client name.** From the MCP `initialize` request (`getClientVersion()`). The
hosted transport is stateless, so the client is remembered per API token id in
memory; after a restart it is unknown until the client next initializes.

**To make it live (owner's approval needed for step 2):**

1. `UPGRADE_URL` (optional) in `%USERPROFILE%\.social-publisher\.env`: an https
   checkout or waitlist link. Without it the texts say checkout is not open yet.
2. Apply the migration, **before** merging: the new Prisma client selects
   `tenants.plan`, so new code on the old schema breaks every tool that reads a
   tenant. Old code on the new schema is fine. From `source/packages/db`:
   `node --env-file="%USERPROFILE%\.social-publisher\.env" node_modules/prisma/build/index.js migrate status`,
   then the same with `migrate deploy`.
3. Put the owner's own tenant on Premium, so local use is never blocked. The
   local server uses the oldest tenant (`currentScope` in `context.ts`):
   `SELECT id, name, created_at, plan FROM tenants ORDER BY created_at LIMIT 3;`
   then `UPDATE tenants SET plan = 'premium' WHERE id = '<that id>';`
4. Merge `phase1-usage`, rebuild, restart the MCP server, then run
   `pnpm --filter @social-publisher/db run test:usage` at a quiet time (live-DB
   test of the SQL, kept out of the default run until the migration exists) and
   rename it to `usage.test.ts`.
5. Verify live: call any tool, then `check_usage`; one `tool_calls` row and a
   count of 1 in `usage_months` should exist.

## Phase 2 — Analytics and troubleshooting

- **PostHog Cloud EU**, server-side events from the MCP server and the worker:
  `mcp_call` (tool, ok, error code, duration, client, plan, industry),
  `limit_notice_shown`, `limit_reached`, `upgrade_clicked`, `signup`,
  `connect_started` / `connect_completed` / `connect_failed` (per platform),
  `publish_failed` (with the resolution code). Person = tenant id (no email to
  PostHog). Key in `.env` only.
- **Where users get stuck:** funnels in PostHog (signup → first connect → first
  post → first ad → upgrade); the `tool_calls` table answers "which tool fails,
  for whom, with which error" directly, and the existing error catalogue codes
  make every failure countable.
- **Error logs:** the existing telemetry logger keeps writing redacted JSON;
  on the server it is collected per day and kept 30 days.
- **Industry categories:** each tenant records its business type (dentist,
  education, real estate, e-commerce, tool websites, agency, other) at signup or
  first use; every event carries it, so usage and results can be read per
  industry and playbooks tuned per industry.
- **Privacy:** a privacy policy that says what is recorded; no content of posts
  or ads in analytics; deletion on request.

## Phase 3 — Hosting on Hetzner

- Server: Hetzner Cloud CX23, Helsinki, `37.27.148.217`, Docker Compose behind
  Caddy, already running Raptor Downloader (`Websites/FreeVideoDownloaderOnline/site/deploy/README.md`).
- Add the hosted MCP (`apps/mcp/src/http-server.ts`) and the worker as two more
  containers; Caddy routes `mcp.1920agency.com` to the MCP. Owner adds one DNS
  `A` record for the subdomain.
- This also gives the https OAuth callbacks Meta and Google need in Live mode
  (the 2026-10-02 Facebook "Can't load URL" problem), so reconnecting no longer
  needs the app switched to Development.
- The worker moves to the server, so scheduled posts no longer depend on this PC
  being awake (today's biggest operational risk).
- The local copy stays the development copy; the server only runs committed
  code, deployed by `git archive` as Raptor is.
- 4 GB is enough for MCP + worker + Raptor at first; watch memory.

## Phase 4 — Accounts and the website

- Signup and login (the auth package already has users, password hashing and API
  tokens), plan and billing state in the database, the per-user MCP token shown
  in the account page.
- Checkout through a merchant of record (Stripe does not onboard Pakistani
  businesses directly) — research first (0009 "Open").
- **Website:** TREG/Zernio style (ROADMAP "Website"); **guides/docs** on the
  Raptor Downloader pattern (`/docs`); **daily articles** and SEO on the
  SimpleOnlineCounter / SEO-Ops pattern (daily monitor + article queue +
  gated publisher), as a site registered in `AI-Automation/SEO-Ops`.

## Phase 5 — Expertise that improves itself

- Playbooks for every ad platform are refreshed on a schedule (the 90-day
  freshness warning already exists): a monthly job checks each platform's
  changelog and proposes playbook edits for approval.
- `tool_calls` + outcomes show which playbook sections lead to failures or
  rejected ads; those sections are improved first.
- Per-industry guidance (dentist, education, real estate, e-commerce, tool
  websites) added to the playbooks as the data shows what each industry runs.

## Order and dependencies

Phase 0 → 1 → 2 can run on this PC against the live database (one migration,
approved). Phase 3 needs the DNS record. Phase 4 needs the payment-provider
decision and the product name for the final domain.
