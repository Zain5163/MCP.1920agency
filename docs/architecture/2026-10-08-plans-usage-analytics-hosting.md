# Plan: usage limits, analytics, accounts, hosting, backup, product site

**Date:** 2026-10-08. **Status:** agreed direction; phases below are the build
order. Owner's request in his words: the product should sell itself, and "if we
don't have analytics â€¦ customer logs, what they are doing, what they're calling,
we cannot enhance our product". Decisions: `docs/decisions/0009-free-and-premium-plans.md`.

## Owner's decisions (2026-10-08)

- Free: **200 MCP calls a month**. Premium: **$9 a month**, unlimited (fair use).
- Analytics: **PostHog Cloud EU**, plus every call logged in our own database.
- Hosting: the existing **Hetzner** server; address **a subdomain of
  1920agency.com** (e.g. `mcp.1920agency.com`) until the product name is final.
- **Everything lives in the workspace and in a private GitHub repo**, never only
  in temporary folders.

## Phase 0 â€” Safety first (now)

| Item | Detail |
|---|---|
| **GitHub backup** | The repo has **no remote** today: one laptop holds everything. Owner creates a **private** GitHub repository; it is added as `origin` and pushed (Git Credential Manager opens the browser login). Push after every session. Later: the other non-git folders (LinkedIn-Content-Ops, Social-Render, LinkedIn-Content-System) go into a second private "ops" repo |
| **Nothing only in temp** | Review evidence and research that lived in the scratchpad is copied into `docs/reviews/` and `docs/research/` in this repo |

## Phase 1 â€” Plans and usage metering (MCP side)

- **Data (one additive migration, applied only with the owner's approval):**
  - `tenants.plan` (`free` / `premium`), `plan_renews_at`.
  - `tool_calls`: one row per MCP call â€” tenant, user, tool, ok/error, error
    code, duration ms, MCP client name and version (from the MCP `initialize`
    request: Claude Code, Claude Desktop, ChatGPT, Cursorâ€¦), transport, created at.
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

## Phase 2 â€” Analytics and troubleshooting

- **PostHog Cloud EU**, server-side events from the MCP server and the worker:
  `mcp_call` (tool, ok, error code, duration, client, plan, industry),
  `limit_notice_shown`, `limit_reached`, `upgrade_clicked`, `signup`,
  `connect_started` / `connect_completed` / `connect_failed` (per platform),
  `publish_failed` (with the resolution code). Person = tenant id (no email to
  PostHog). Key in `.env` only.
- **Where users get stuck:** funnels in PostHog (signup â†’ first connect â†’ first
  post â†’ first ad â†’ upgrade); the `tool_calls` table answers "which tool fails,
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

### Phase 2 status: LIVE and verified 2026-10-08

Merged into master (`989def3`), running after the VS Code reload. The owner
confirmed in PostHog (EU) â†’ Activity an `mcp_call` with `plan: premium` and
`industry: agency` after `set_business_type` + one counted call (~05:30 PKT).
The hosted MCP and server worker (Phase 3, Stage A) carry the same key.

(Build notes from before the merge, kept for the record:)

**Industry (2026-10-08, branch `industry-column`): built, migration pending.**
The owner approved the column on 2026-10-08. `tenants.industry` (nullable text,
CHECK `tenants_industry_known` = `INDUSTRIES`, a core test keeps the SQL and TS
lists equal) in migration `20261008160000_add_tenant_industry`, **not applied**;
`TenantScope.usage()` returns it and `setIndustry(code)` writes it; the free
tool `set_business_type` (enum of the codes; "ask the user, never guess") sets
it; `check_usage` shows "Business type: â€¦" or "not set"; one line in
`SERVER_INSTRUCTIONS` tells the AI to ask once when it is not set. From the next
counted call after it is set, `mcp_call` carries `industry` and `$set` holds it
(fake-fetch test). The new Prisma client selects the column, so the migration
must be applied **before** this code runs against the live database.

Built and unit-tested (fakes only: no network, no database) on branch
`phase2-analytics`, from master `965032f`, in a separate worktree. **Not
merged, and nothing has been sent to PostHog.** It goes live only when the
branch is merged, the packages rebuilt and the MCP restarted (VS Code reload);
the worker picks it up on its next 5-minute run after the merge. With
`POSTHOG_KEY` absent everything below is a silent no-op. No migration, no new
dependency.

Gate on the branch: `pnpm -r build`, `pnpm -r typecheck`, and the nine suites
that need no database (`!auth`, `!db`): **1,008 passing, 0 failing** (52 new).
The architecture test (no platform names outside the adapters) passes.

| Piece | Where |
|---|---|
| `POSTHOG_KEY` (optional, public `phc_` key) and `POSTHOG_HOST` (default `https://eu.i.posthog.com`), read like every other key | `packages/config/src/env.ts` `analyticsConfig()` |
| The analytics client: fire-and-forget, batched (20 events or 10 s), bounded queue (1,000; beyond it new events are dropped and that is logged once), a failed batch is dropped not retried, never throws, 5 s request timeout, 3 s wait at shutdown | `packages/telemetry/src/analytics.ts` |
| Privacy guards in the client: distinct id must look like an id (an email or a name drops the event); allow-listed property names only; each value a short plain token (no URL, query string, email, free text or credential shape); `plan` and `industry` checked against their lists; `$geoip_disable` on every event; only a `phc_` key and an https host are used | same file; `packages/telemetry/test/analytics.test.ts` |
| `mcp_call`, `limit_reached`, `limit_notice_shown` next to `recordToolCall` | `apps/mcp/src/metering.ts` |
| `upgrade_clicked` | `apps/mcp/src/account-tools.ts` |
| `publish_failed` for a post published now (both transports) | `apps/mcp/src/publishing.ts` |
| `publish_failed` for a scheduled post (every failed attempt, with `will_retry`) | `apps/worker/src/analytics.ts`, `worker.ts` |
| One client per process, flushed when the MCP client disconnects, on SIGINT/SIGTERM, on a worker run's end and on `beforeExit` | `apps/mcp/src/server.ts`, `http-server.ts`, `apps/worker/src/worker.ts` |
| Industry list: `dentist`, `education`, `real_estate`, `ecommerce`, `tool_website`, `agency`, `other` | `packages/core/src/domain/industries.ts` (`INDUSTRIES`, `industryOf`) |
| `codeForFailure` moved from the MCP server to core, so the worker reports the same code the MCP reply shows | `packages/core/src/domain/resolutions.ts` (re-exported from `publishing.ts`) |

**Why a small fetch client, not posthog-node.** posthog-node is MIT and the
official SDK, but only one endpoint (`POST /batch/`) is used; the SDK's feature
flags, retry queue and person API are not. The guarantees the owner needs
(never throw, never block, bounded, flush on exit) are short code we own and
test with a fake fetch, and no third-party code is added to a process that holds
platform tokens. posthog-node remains a drop-in behind the same `Analytics`
interface if feature flags are ever wanted. Request format checked 2026-10-08
against https://posthog.com/docs/api/capture (`/batch/` with `api_key` and
`batch`); `$geoip_disable` per event is PostHog's documented server-side switch.

**Person profiles.** `$process_person_profile: true`: each tenant gets one
PostHog person, keyed by our opaque tenant id, so funnels and cohorts work per
account. The profile holds only `plan` and `industry` (`$set`), nothing that
identifies a person.

#### Events and their properties

| Event | Sent when | Properties |
|---|---|---|
| `mcp_call` | every MCP tool call, metered or free, both transports, next to the `tool_calls` row (sent even if that write fails) | `tool`, `ok`, `error_code` (catalogue code, failures only), `duration_ms`, `client_name`, `client_version`, `transport` (`stdio`/`http`), `plan` (absent for the free tools, which skip the plan read), `industry` (once it exists) |
| `limit_reached` | a Free call is refused at 200 | `tool`, `transport`, `plan`, `industry` |
| `limit_notice_shown` | a call's result carries a usage notice | `threshold` (the one said: 25â€¦99), `plan`, `industry` |
| `upgrade_clicked` | the `upgrade` tool is called (sent even if the plan cannot be read) | `plan`, `industry`, `transport`, `client_name`, `client_version` |
| `publish_failed` | a target fails: publish now (MCP) or a scheduled attempt (worker) | `platform`, `resolution_code` (catalogue code, or `adspilot:attachments_not_stored`), `source` (`publish_now`/`scheduled`), `will_retry` |

Every event: `distinct_id` = tenant id, `$lib` = `adspilot-server`,
`$process_person_profile` = true, `$geoip_disable` = true, and `$set` with
`plan`/`industry` when known.

#### Not built in this phase, and why

- **`connect_started` / `connect_completed` / `connect_failed`.** There is no
  single place a connection is made: three flows (`apps/cli/src/connect.ts` for
  Meta, `apps/cli/src/connect-provider.ts` for the others, and the web
  dashboard's `apps/web/src/app/accounts/actions.ts`) each upsert connections
  themselves and leave through several `process.exit` calls, which would drop a
  queued event unless each exit flushed first. The names are declared in the
  client's event list; they belong in the one connect service Phase 4's
  accounts work should create, so they are emitted once, in one place.
- **`signup`.** No signup flow exists yet (Phase 4). Declared, not emitted.
- **`tenants.industry`.** Not added in this phase (a migration needs the
  owner's approval). Since built on branch `industry-column`: see "Industry"
  at the top of this status.
- **Error-log collection on the server (30 days).** Belongs to Phase 3
  (hosting). The redacted logger is unchanged.

#### To go live (the parent session, after review)

1. Merge `phase2-analytics` into master (owner approval), then bring it into
   the checked-out branch.
2. In `source`: `pnpm install --frozen-lockfile --prefer-offline` (no new
   dependency), `pnpm --filter @social-publisher/db run generate` (expect the
   harmless EPERM while the MCP runs), `pnpm -r build`, `pnpm -r typecheck`.
3. Confirm `POSTHOG_KEY` is in `%USERPROFILE%\.social-publisher\.env` without
   printing it (for example `findstr /b /c:"POSTHOG_KEY=phc_" ... >nul && echo present`).
4. Reload VS Code (restarts the stdio MCP), call `check_usage` and one counted
   tool (e.g. `list_accounts`). Events go out within 10 seconds or when the MCP
   disconnects.
5. In PostHog (EU project) â†’ Activity: an `mcp_call` with `tool` =
   `list_accounts`, `distinct_id` = the owner's tenant id, `plan` = `premium`,
   and no other custom properties. Only then is Phase 2 "verified live" (R4).

### Phase 2b â€” PostHog MCP Analytics (`$mcp_tool_call`)

**VERIFIED LIVE 2026-10-08 ~13:00 PKT:** the owner's screenshot of PostHog
project 297949 â†’ MCP analytics shows Users 1, Sessions 2, Tool calls 17, error rate
0%, p95 latency 30 s (some tool calls are slow; to look into).

**Deployed 2026-10-08 ~11:45 PKT (owner asked for it).**
Merged into master (`10c829a`), installed and built on the PC (mcp tests 173/0),
released to the server (`10c829a34833`, `BUILD_SHA` set in the container). One
read-only `check_usage` call made through the hosted MCP at ~11:46 PKT; no send
errors in the server log. Verified only when the owner sees that
`$mcp_tool_call` (`$mcp_tool_name = check_usage`, person = tenant id) at
https://eu.posthog.com/project/297949/mcp-analytics/activity. The local stdio MCP
picks it up after a VS Code reload.

**Status 2026-10-08: built and unit-tested on branch `posthog-mcp-analytics`
(worktree), not merged, not deployed, no event sent.** The owner asked for
PostHog's MCP Analytics (project 297949, EU) on top of our own `mcp_call`,
which stays unchanged. This partly reverses "Why a small fetch client, not
posthog-node" above: MCP Analytics reads PostHog's own `$mcp_*` event shape,
which only its SDK produces, so third-party code now runs in the MCP process;
it is contained by the two allow-list filters below.

| Piece | Where |
|---|---|
| `@posthog/mcp` **0.22.1** (beta) + `posthog-node` **5.55.0**, pinned exactly. package.json says MIT for both (and for `@posthog/core` 1.57.1, `@posthog/types` 1.415.1); the LICENSE file they ship is the posthog-js repo's Apache-2.0 text, with MIT parts from AgentCat/MCPcat; both permissive. 0.22.2 was not used: it was younger than pnpm's minimum release age and needed exclusions in `pnpm-workspace.yaml` | `apps/mcp/package.json`; WHY comment in `apps/mcp/src/mcp-analytics.ts` |
| `instrument(server, posthog, options)` on every server, after metering, before any tool. No `POSTHOG_KEY` (or not `phc_`, or not https): not instrumented, silently | `mcp-analytics.ts` `instrumentMcpAnalytics`, called from `mcp-server.ts` `createAdsPilotServer` |
| Options: `context: false`, `enableConversationId: false`, `captureModel: false` (it would add an `llm_model` argument), `reportMissing: false`, `collectFeedback: false`, `enableExceptionAutocapture: false`, `shouldRecordInputKey: () => false`, plus `identify`, `eventProperties`, `beforeSend`, `serverBuild` | same |
| One posthog-node client per process (20 events or 10 s, queue 1,000, 5 s timeout, no retry, GeoIP off). Stdio: flushed when the client disconnects, shut down on SIGINT/SIGTERM and `beforeExit`. Hosted: shut down on SIGTERM (Docker stop, 15 s grace) | `server.ts`, `http-server.ts` |
| `serverBuild` = `BUILD_SHA` (docker-compose sets it from `ADSPILOT_TAG`, the release's 12-character SHA), else `git rev-parse --short=12 HEAD` on the PC; anything not a hex SHA is ignored | `resolveServerBuild`; `deploy/docker-compose.yml` |
| Tests: no-op without key; input schemas identical with and without instrumentation (both transports); one event per call through real posthog-node with a fake fetch, canary string never on the wire; metering counts once; every tool still metered once when instrumented; hosted stateless HTTP sends no `Mcp-Session-Id`; the filter on its own | `apps/mcp/test/mcp-analytics.test.ts` (16) |

**Composition with metering.** Metering wraps each handler at registration;
the SDK then wraps the stored registry entry (around the metered handler) and
the `tools/call` request handler. A call runs: SDK capture â†’ MCP argument
validation â†’ metered handler â†’ tool, so it is counted once and captured once.
With a key, the stored handler is the SDK's wrapper and the `METERED` mark is
one level in; the existing registration test builds without a key and is
unchanged, and the new test calls every stored handler on both transports with
instrumentation and checks each is recorded exactly once.

**Identity.** `distinct_id` = the tenant id from the meter's `account()`:
stdio, the owner's tenant (`currentScope`); hosted, the tenant behind the
request's API token (`identifyToken` in `http-server.ts` â†’ `identity.scope`).
No `$set` (plan and industry already reach the same person through
`mcp_call`). If the account cannot be resolved the event goes out under the
SDK's random session id with `$process_person_profile: false`.

**Error code.** Our tools report most failures as a normal result starting
`[CODE]`, which the SDK would count as a success. The filter reads the result
in memory the way metering does (`outcomeOf`) and sends the catalogue code as
`$mcp_error_type`; the result and the message are then dropped.

**Hosted, stateless.** Each request builds and instruments a fresh server on
the shared client, so `$session_id` is new per request (opaque, not useful as
a session); the client name on a tool call comes from the per-token memory
metering already uses (`eventProperties`). The SDK tries to mint an
`Mcp-Session-Id` token at `initialize` on stateless servers; with our SSE
responses it never reaches the wire (headers are written before the handler
runs), and a loopback test asserts no such header is sent.

**Not verified live (R4).** Nothing has been sent. Local Node is 22.19 while
the package declares `^20.20 || >=22.22`: it loads and every test passes on
22.19, but updating Node on the PC is advisable; the server image
(`node:22-bookworm-slim`) is a later 22.x. Docker is not on this PC, so the
image was not built; the Dockerfile's filtered `pnpm install
--frozen-lockfile` was run on a `git archive` copy and installs and imports
both packages.

**To verify live** (after merge, approval and release): with `POSTHOG_KEY`
set, call `check_usage` (read-only, free, never counted) once from Claude Code
on stdio and once through the hosted MCP; then open
https://eu.posthog.com/project/297949/mcp-analytics/activity and look for one
`$mcp_tool_call` per call with `$mcp_tool_name = check_usage`, the tenant id
as the person, and only the properties in the privacy notes below.

### Privacy notes (analytics)

Written so it can become the analytics part of the privacy policy.

**What AdsPilot sends to its analytics provider** (PostHog, EU data region):
- an opaque account id we generate (not your email, name or company);
- which AdsPilot tool was called, whether it succeeded, our own error code if
  it failed, and how long it took;
- the name and version of the AI app that called it (for example Claude Code),
  as that app reports itself, and whether it connected locally or over the
  internet;
- your plan (Free or Premium) and, once you have chosen one, your business
  category from a fixed list (dentist, education, real estate, e-commerce,
  tool website, agency, other);
- usage milestones: when a usage notice was shown and at which percentage, when
  the free limit was reached, when the upgrade link was asked for;
- when a post failed to go out: the platform (for example LinkedIn) and our
  error code, and whether it will be retried.

**What is never sent:** what you asked the AI to do (tool arguments); the text,
images or videos of your posts and ads; your social accounts' names or ids;
access tokens, keys or passwords; web addresses; your email, name, phone or
any other personal details; your location (location lookup is switched off on
every event); the platforms' own error messages, which can quote your post.

**MCP Analytics (PostHog's MCP pages).** Two further events about the same
calls, in PostHog's own format: `$mcp_tool_call` (one per tool call) and
`$mcp_initialize` (when an AI app connects). Each carries only:
- `$mcp_tool_name` and `$mcp_resource_name` (the same AdsPilot tool name;
  a name the AI app invents is sent as `unknown_tool`);
- `$mcp_is_error`, and on failure `$mcp_error_type` = our error code (for
  example `TOKEN_EXPIRED`, or `UNKNOWN`), never the error message;
- `$mcp_duration_ms`;
- `$mcp_client_name`, `$mcp_client_version` (as the AI app reports itself) and
  `$mcp_protocol_version`;
- `$mcp_server_name` (`adspilot`), `$mcp_server_version`, `$mcp_server_build`
  (the code version, a git commit id);
- `$session_id`, a random id the analytics library makes up (not tied to you);
- PostHog's fixed markers: `$mcp_source`, `$geoip_disable` (always true),
  `$process_person_profile` (only when no account id is known), and the
  library's own `$lib`, `$lib_version`, `$is_server`.

The person is the same opaque account id. Not sent, although the library
would by default: what the tool was asked (arguments), even the argument
names; what it answered; error messages and stack traces; the AI app's
browser-style "user agent" and vendor headers; a separate identify event that
would carry the whole request; the AI's stated intent and model name (those
are switched off, so no tool's inputs change).

**How it is enforced:** the analytics client accepts only a fixed list of
property names and drops anything else, and drops any value that is not a short
plain word or number. A test fails if a disallowed property can get through.
For MCP Analytics the same is done twice: a filter on every event the library
builds (`beforeSend`) keeps the two events and the properties above with
checked values, and the PostHog client repeats the allow-list just before
sending. A test puts a marker string in every tool argument and result and
fails if it appears anywhere in what would be sent.

**Our own records.** Separately, each tool call is recorded in our database
(the `tool_calls` table: tool, success or error code, duration, AI app, plan
counts) so we can count usage and help when something fails. It holds no
content of your posts, ads or requests either.

**Deletion.** On request, the account's analytics person and events are
deleted in PostHog (by the account id) along with its rows in our database.
(Done by hand today; there is no self-service deletion yet.)

## Phase 3 â€” Hosting on Hetzner

**Status 2026-10-08 ~05:55 PKT: Stage A DEPLOYED (owner approved A, swap +
build-cache prune, own edge network).** Release `cd6e265b3f94` in
`/opt/adspilot/releases/`, `app` linked to it; `setup.sh` built the image,
confirmed Supabase is current (read-only) and started `adspilot-mcp-1` and
`adspilot-worker-1`, both healthy. `https://mcp.1920agency.com/health` â†’ 200
(`database: reachable`, ~1.3 s to Singapore), `POST /mcp` without a token â†’ 401,
Let's Encrypt certificate issued. Raptor: Caddy attached to the new network
`adspilot_edge` (shared only with the MCP; the MCP cannot resolve Raptor's
`api`, checked), committed in Raptor's repo (`4188797`), previous files kept as
`/opt/raptor/*.before-mcp*`; raptordownloader.com and its API answered 200 after
the Caddy recreate. Swap 2 GB (swappiness 10); 9.7 GB build cache pruned (27 GB
free). Server env file holds only the names in `deploy/.env.example` (no Slack
webhook exists on the PC either). A6: the owner made the gpg key; the first
encrypted backup (52 KB) was made on the server and pulled to the PC
(restore test needs the owner's passphrase). **Not yet done:** A7 the first post published by the server worker (both
workers run; the PC task is switched off only after a server `PUBLISHED`), A8
timers (after A7, so monitor/refresh do not run twice), A9 connecting an AI
client to the hosted URL (needs a dashboard token). Then: the hosted OAuth
callback (Meta Live mode, Google, and the Shopify connector all need it).

**~07:25 PKT: OAuth over https LIVE** (owner approved): Raptor's Caddyfile
(`d00ef47`, pushed) written in place (backup `Caddyfile.bak-<time>`), validated
and `caddy reload`ed with no downtime. Checked: GET on the 7 callback paths â†’
302 to `http://localhost:8787<same path and query>` with `Cache-Control:
no-store`; `/callbackx` and POST `/callback` â†’ 404; `/health` 200; `/mcp` 401
without a token; Raptor's site and API 200. The owner added the https addresses
in the Meta (Facebook Login for Business, Instagram business login) and Google
consoles, keeping the localhost ones, and switched `META_`, `INSTAGRAM_`,
`THREADS_` and `GOOGLE_REDIRECT_URI` in the PC `.env`. **Verified ~09:30 PKT:**
`pnpm connect` (Facebook + linked Instagram) and `pnpm connect:provider google
youtube` both completed through the bounce; `list_accounts` shows every Page and
Instagram account ready and YouTube "RZR GaminG YT" ready. Two snags on the way,
for the next person: Meta's App domains field did not save until the domains
were entered as chips (`1920agency.com`, `mcp.1920agency.com`; checked via the
Graph API `app_domains` field), and the YouTube Data API v3 had to be enabled in
the Google Cloud project. The `.env` had the Google values under Google's own
labels ("Client ID"); renamed to `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
(backup kept). The server env now also has the three `GOOGLE_*` values so the
server worker can refresh YouTube access. Meta app stays in Development mode:
Live needs Business Verification (public_profile advanced access for Facebook
Login for Business), which belongs with Phase 4. Threads: not set up (needs the
Threads use case, unavailable on this Business-type app). Server worker: one
post published 09:00 PKT (queue 3 â†’ 2, 0 failed), but which worker sent it is
unknown (container logs were cleared by a recreate); the 15:30 post decides A7.

**2026-10-09 ~16:20 PKT: Stage A COMPLETE (A7 + A8).** The server worker
published both scheduled LinkedIn posts on 08 Oct by itself (15:30 PKT
`urn:li:share:7513908579028946944`, 22:00 PKT `urn:li:share:7514006763289980929`),
0 failed. Timers installed and enabled on the server (monitor every 30 min,
refresh 23:00 UTC, backup 02:30 UTC, keep-alive every 3 days at 04:00 UTC — the
owner's choice, two spare runs before Supabase's 7-day pause); monitor and
keep-alive test-run OK. The PC tasks AdsPilot-Worker, AdsPilot-Monitor,
AdsPilot-Refresh and Social-Publisher-Keepalive are **disabled** (not deleted;
`Enable-ScheduledTask` brings one back). Posting no longer needs the PC awake.
Since 09 Oct the server's front door is the shared gate (`/opt/gate`, source
`AI-Automation/Server-Gate`); AdsPilot owns `sites/mcp.1920agency.com.caddy` there.

**~10:30 PKT: backups proven restorable, hosted MCP verified.** The owner ran
`deploy/scripts/pc-backups.sh restore-test`: the 08 Oct backup was decrypted on
the PC and loaded into a throwaway Postgres on the server; all 10 migrations
applied on plain Postgres (the NOLOGIN roles worked) and every table restored
(posts 25, connections 57, jobs 20, targets 27, tenants 6, tool_calls 19 ...),
then the copy was deleted. A9 done: an AI client (Claude Code, "adspilot-hosted")
is connected to https://mcp.1920agency.com/mcp; `check_usage` answers Premium /
Agency and `list_shopify_stores` lists `1920-agency-test-store` connected through
the hosted Shopify flow.

Earlier the same day (kept for the record): the plan, costs, risks and every step are in
`deploy/README.md`: Stage A moves the MCP, the worker (as a loop) and the
timers to the server with Supabase kept as the database; Stage B moves the data
to Postgres on the server (decision 0010) after a tested restore. Findings that
change the picture below: (1) no app on the server serves the OAuth callbacks;
they are caught only by the PC's connect command on localhost:8787, so the
https redirect also needs a small CLI change (`OAUTH_CALLBACK_PORT`) before Meta
can be reconnected while Live; (2) the Caddyfile lives in Raptor's repo and must
get the `mcp.` block there, or Raptor's next release removes it; (3) the
Supabase roles are created NOLOGIN before `migrate deploy` on plain Postgres
instead of editing the applied migrations; (4) the PC and server workers may run
together while they share one database (`FOR UPDATE SKIP LOCKED`), never during
the Stage B move. Only compiled and smoke-started locally (no Docker on this
PC): the image has not been built yet.

- Server: Hetzner Cloud CX23, Helsinki, `37.27.148.217`, Docker Compose behind
  Caddy, already running Raptor Downloader (`Websites/Raptor-Downloader/site/deploy/README.md`).
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

## Phase 4 â€” Accounts and the website

- Signup and login (the auth package already has users, password hashing and API
  tokens), plan and billing state in the database, the per-user MCP token shown
  in the account page.
- Checkout through a merchant of record (Stripe does not onboard Pakistani
  businesses directly) â€” research first (0009 "Open").
- **Website:** TREG/Zernio style (`docs/product/roadmap.md`, "Website"); **guides/docs** on the
  Raptor Downloader pattern (`/docs`); **daily articles** and SEO on the
  SimpleOnlineCounter / SEO-Ops pattern (daily monitor + article queue +
  gated publisher), as a site registered in `AI-Automation/SEO-Ops`.

## Phase 5 â€” Expertise that improves itself

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

Phase 0 â†’ 1 â†’ 2 can run on this PC against the live database (one migration,
approved). Phase 3 needs the DNS record. Phase 4 needs the payment-provider
decision and the product name for the final domain.
