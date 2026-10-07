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
