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

### Phase 1 status: LIVE and verified 2026-10-08

- 2026-10-08 ~02:45 PKT: migration `20261008120000_add_plans_and_usage` applied
  to the live database with the owner's approval (`migrate status` showed it as
  the only pending one). `phase1-usage` was fast-forwarded into the checked-out
  branch, which another session had switched to `own-skills` seconds earlier;
  `own-skills` was merged into master at ~03:35 PKT (owner approved) and pushed.
  Packages rebuilt, typecheck green. The live SQL test (`packages/db/test/usage.test.ts`,
  two throwaway tenants) passed 6/6 and now runs with the db suite.
- **Verified live ~03:20 PKT:** the owner ran the Premium line below in the
  Supabase SQL editor and reloaded VS Code; `check_usage` answered "Plan: Premium
  (unlimited use, fair use applies) / Calls this month: 2", so calls are being
  recorded and counted. The Premium line, for any rebuild: `UPDATE tenants SET plan = 'premium' WHERE id = (SELECT id FROM tenants ORDER BY created_at LIMIT 1);`
  (the local server uses the oldest tenant, `currentScope` in `context.ts`).
- ~03:35 PKT: migration `20261008140000_lock_down_provider_auths` applied
  (owner approved): `provider_auths` (encrypted Google sign-in grants) was the
  one table without row level security, because it was created after the
  2026-09-25 lockdown. `list_accounts` and `check_usage` worked afterwards.
- `prisma generate` hit EPERM on the query engine DLL because the running MCP
  holds it; the generated client code was written and the engine file is
  byte-identical, so nothing was missing. Expect this whenever the MCP is
  running; reload VS Code first if a Prisma version ever changes.

| Piece | Where |
|---|---|
| Plan rules (200 calls, thresholds, notice and limit wording, UTC reset, https-only `UPGRADE_URL` with a plain-words fallback) | `packages/core/src/domain/plans.ts`; `USAGE_LIMIT_REACHED` in the error catalogue |
| Schema: `tenants.plan` (enum, default `free`), `tenants.plan_renews_at`, `tool_calls`, `usage_months` | `packages/db/prisma/schema.prisma` |
| Migration (**applied 2026-10-08**; additive; RLS on, Data API grants revoked on the new tables) | `packages/db/prisma/migrations/20261008120000_add_plans_and_usage/migration.sql` |
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

**Left:** set `UPGRADE_URL` once the Polar checkout exists (until then the
texts say checkout is not open yet).

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
- **Skills learned in use become product skills** (owner, 2026-10-08): what we
  learn running real accounts (e.g. the Muzaree work, which started AdsPilot's
  own skills library on branch `own-skills`) and what works for users is written
  into skills and playbooks, so every user benefits. Learning from users uses
  patterns only (objective, budget range, industry, result), never one user's ads,
  copy or data shown to another; the privacy policy says so, and the owner
  approves each skill or playbook change before it ships.
- **Troubleshooting from the call log:** `tool_calls` shows which tool failed,
  for whom, with which error code and AI client, so support can see a user's
  problem without asking them to describe it.

## Order and dependencies

Phase 0 → 1 → 2 can run on this PC against the live database (one migration,
approved). Phase 3 needs the DNS record. Phase 4 needs the payment-provider
decision and the product name for the final domain.
