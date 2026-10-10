> **Archived 2026-10-10. Superseded; kept as history, never deleted.** Paths in this file
> are the old layout (`decisions/` is now `docs/decisions/`, and so on). What is true now:
> `STATUS.md` and `START-HERE.md` at the repo root. Items still open here were carried into
> `STATUS.md`.

# Social Publisher — Project Context

## Purpose

Post and schedule content to every major social platform from one place — driven either
from chat (via an MCP server) or from a local web UI — without paying a third-party
scheduler. Connect an account once with OAuth, then publish text, images and video to
Facebook Pages, Instagram, YouTube, TikTok and others from a single command.

Built first as the owner's own tool. Architected multi-tenant from day one so it can
become a paid product without a rewrite.

## Current state

**CP-0 architecture agreed; `packages/core` built and tested. 2026-09-21.**

Built and verified this session:

- `architecture/01-wave1-architecture.md` — component layout, data model, adapter
  interface, publishing flow, error classification. Agreed before code, per the
  workspace rule and the `..\Ads-Platform` precedent.
- `source/packages/core` — domain types, error classification with jittered backoff,
  the adapter interface, the per-platform capability registry, and the shared
  validation engine. **33 tests passing, strict typecheck clean, builds.**
- `source/packages/vault` — envelope encryption (per-row DEK under a master KEK,
  tenant bound into the AEAD, versioned keys, rotation) and the token broker.
  **31 tests passing**, including cross-tenant replay, tamper detection and rotation.
- `SETUP.md` — the account and credential steps only the owner can do.

- `source/packages/config` — env loader reading `~/.social-publisher/.env`, outside the
  workspace per the AGENTS.md secrets rule. Hand-rolled parser so no third-party code
  touches the secrets file. **18 tests.**
- `source/packages/db` — Prisma schema (tenants, connections, posts, targets, jobs,
  media, audit log, heartbeat), client singleton, health check and keep-alive CLI.
  Schema validates; client generates.

- `source/packages/adapters` — Facebook Page adapter (text, single photo, multi-photo
  carousel, video) and Meta Graph error classification driven by Meta's own error
  codes rather than HTTP status. **20 tests** against a mocked Graph API.

- `source/packages/adapters` also contains the Facebook OAuth flow (dialog URL, CSRF
  state, code exchange, short-to-long-lived exchange, page listing, token debug).
  **22 further tests.**
- `source/apps/cli` — `connect` (one-shot localhost callback listener, stores one
  encrypted connection per Page) and `status` (config, database, keep-alive age,
  connected accounts).

- `source/packages/publisher` — the single publishing implementation. Validates all
  targets first, publishes them concurrently and independently, and always reports
  partial success rather than throwing on the first failure. **13 tests.**
- `source/apps/mcp` — MCP server over stdio with five tools: `check_status`,
  `list_accounts`, `validate_post`, `publish_post`, `list_posts`. Registered in
  `D:\My AI Works\.mcp.json`. Starts cleanly.

**137 tests passing across eight workspaces; strict typecheck clean on all eight.**

Not built: Instagram adapter, scheduler worker (scheduled posts are accepted by the
schema but nothing runs them yet). No platform has been contacted; nothing has been
published anywhere; **no migration has been run against a real database.**

### Live infrastructure as of 2026-09-24

- **Migration `20260924144138_init` applied** to the Supabase project. All eight
  tables exist. This is the first real change to a live service in this project.
- **Keep-alive registered** in Windows Task Scheduler as `Social-Publisher-Keepalive`,
  Sundays 09:00. Test-run succeeded (`LastTaskResult 0`); next run 2026-09-27.
- `pnpm status` reports the database reachable and 0 accounts connected.

### Two gotchas worth remembering

1. **Prisma needs `sslmode=require`** on Supabase connection strings. Without it
   Prisma reports *"Authentication failed"* even though the credentials are correct —
   a raw `pg` client with `rejectUnauthorized:false` connected fine with the very same
   string, which is how this was isolated. The misleading error cost real time.
2. **The transaction pooler (6543) is intermittently unreachable.** A `status` call
   failed seconds after a `keepalive` succeeded on the same URL, then worked on retry.
   Treat pooler connection errors as transient and retry rather than assuming
   misconfiguration. The worker's retry logic already classifies these correctly.

### Outstanding security action

The database password was pasted in plaintext into a chat transcript on 2026-09-24
and **must be rotated**. After rotating, re-run `apps/cli` `set-db-password`.

The env file exists at `%USERPROFILE%\.social-publisher\.env` with a generated
`VAULT_MASTER_KEY`. **That key decrypts every stored credential — losing it means
reconnecting every account.** Supabase, Meta and R2 values are still blank.

### Verified 2026-09-23

- **Graph API pinned to v25.0** (released 2026-02-18, current when checked). v19 was
  deprecated 2026-05-21 and v20 on 2026-09-24. **`..\Meta-Ads-Publisher` still pins
  v23.0 and should be bumped.**
- Schema reviewed against the `supabase-postgres-best-practices` skill, which caught
  three real defects before the first migration: UUIDv4 primary keys (now v7, for
  index locality), four unindexed foreign keys, and camelCase column names that would
  have required quoted identifiers in the raw SQL job-queue query forever.

## Status 2026-09-24 — publishing, scheduling and a web UI all live

Three real posts published to the 1920 Agency Page and Instagram, one of them by the
scheduler with nobody present.

**Working end to end:** Facebook Pages, Instagram (feed/Reels/carousel), media upload
to Supabase Storage, encrypted token vault, Postgres job queue, scheduler worker, CLI,
MCP server, and a Next.js dashboard with HMAC session auth.

**Scheduled tasks registered:**
- `Social-Publisher-Keepalive` — Sundays 09:00, keeps the Supabase project from pausing
- `AdsPilot-Worker` — every 5 minutes, `--once`, drains the queue and exits.
  One-shot rather than long-running on purpose: a crashed one-shot recovers on the
  next tick, a crashed daemon stays dead until someone notices.

**Web UI** at `apps/web`, `next start -p 3000`. Password in `APP_PASSWORD`. Session is
an HMAC-signed httpOnly cookie derived from the vault key — verified in testing that a
valid signature is accepted and a single flipped character is rejected.

**Name:** AdsPilot (chosen 2026-09-24).

### Still not built

- Multi-user auth. One password, one tenant. The schema is multi-tenant throughout and
  the session cookie already carries a tenant id, so this is additive, not a reshape.
- AI content generation and the design system. Deliberately unstarted — see the
  caution in decisions/0001 about this being a separate product.
- Other platforms (X, LinkedIn, TikTok, YouTube). Adapters only; the engine is ready.

## Scope (revised 2026-09-23 — read decisions/0001 first)

After the owner challenged whether this was worth building at all, the scope was cut.
**MCP tool only: no web UI, no auth, no billing.** The justification for building rather
than buying Mixpost Pro ($299 one-time, does Wave 1 today) is the one thing no product
sells — driving publishing from chat. Bluesky was cut entirely as a wasted step.

### Prerequisites confirmed by the owner, 2026-09-21

- **Meta Business Verification is already complete** for the 1920 Agency portfolio.
  This removes the 8-14 week critical path assumed when this project was created.
  App Review becomes available as soon as there is a working app to demo.
- A spare domain and subdomain are available for R2 media hosting.
- An Instagram Business/Creator account is already linked to a Facebook Page.

Research completed so far (2026-09-21, this session, web-verified):

- Open-source prior art identified and licence-checked (Postiz AGPL-3.0, Mixpost Lite MIT)
- X/Twitter API moved to pay-per-use; cost modelled per user
- YouTube Data API quota mechanics confirmed (per-project, not per-user)
- Meta Advanced Access requirements for third-party publishing confirmed

Inherited from `..\Ads-Platform` CP-0 (2026-09-10) — **reuse, do not redo**:

- `research/03-security-architecture.md` — multi-tenant OAuth token vault. Directly
  applicable; the threat model is the same minus the money-spending blast radius.
- `research/02-platform-access-and-approval.md` — Meta App Review and Business
  Verification mechanics, including the 4 May 2026 changes.
- `research/04-infrastructure-and-cost.md` — hosting and LLM cost modelling.

## Scope

**Wave 1 (no App Review required — own accounts, Standard Access):** Facebook Pages,
Instagram, plus the no-approval platforms (Bluesky, Mastodon, Telegram, Discord, Threads).

**Wave 2 (audit/review required):** YouTube, TikTok.

**Wave 3 (uncertain approval):** LinkedIn organization pages, X.

**Out of scope for now:** analytics dashboards, inbox/comment management, AI caption
generation. Publishing reliability is the product; features come after it works.

## Decisions

- **Build our own in TypeScript, not fork Postiz.** Postiz is AGPL-3.0: its network
  clause would force us to open-source our modifications the moment we sell access.
  Chosen by the user 2026-09-21 over self-hosting Postiz or buying Mixpost Pro.
  Postiz and Mixpost Lite (MIT) may be read as reference; no AGPL code is copied.
- **Bring-your-own API keys as the pricing model.** Customers connect their own
  X/YouTube developer credentials; we sell the software, scheduling and UI. Chosen
  2026-09-21 because platform API costs are per-app, not per-user, which makes a cheap
  "unlimited" plan structurally loss-making (see Risks). The token schema must support
  either our app's credentials or the tenant's from the first migration.
- **MCP-first, no web UI.** See `decisions/0001-mcp-first-no-ui.md`. Taken after an
  explicit worth-it review; the UI is deferred, not cancelled.
- **Supabase, with a mandatory weekly keep-alive.** See
  `decisions/0002-supabase-with-keepalive.md`. Free projects pause after 7 days of low
  activity; the keep-alive runs from Windows Task Scheduler like the SEO-Ops task.
- **TypeScript end to end.** One language across UI, API, workers and MCP server; the
  MCP SDK is strongest in TS. Note this diverges from `..\Meta-Ads-Publisher`, which is
  Python — that tool stays as it is; this is a separate product.
- **Multi-tenant schema from line one**, even while the owner is the only tenant.
  Retrofitting `tenant_id` is a rewrite. Same reasoning as Ads-Platform.
- **The MCP server is a client of the same API the UI uses**, never a parallel
  implementation.
- **Tokens never stored in this workspace**, per the workspace safety rule. Vault design
  inherits from `..\Ads-Platform\research\03-security-architecture.md`.

## Risks

- **X/Twitter economics break cheap unlimited pricing.** Pay-per-use is $0.015 per post
  but **$0.20 if the post contains a link**. 30 link-posts/month = $6.00/user for X
  alone. Verified 2026-09-21 from secondary sources; **confirm against X's official
  pricing page before any pricing commitment.**
- **YouTube quota is per-project, shared across all tenants.** 10,000 units/day at 1,600
  units per upload = ~6 uploads/day for the entire customer base. A quota extension
  requires passing a compliance audit and is granted only for the stated use case.
- **Meta approval is the long pole.** Advanced Access for `pages_manage_posts` and
  `instagram_content_publish` requires App Review *and* Business Verification. Estimates
  found this session suggest ~20 days per review cycle with multiple cycles common;
  Ads-Platform's own verified research put the comparable Marketing API path at 8–14
  weeks. Plan for months, not weeks. Business Verification should be submitted first
  because it blocks everything downstream.
  *Note: content publishing should be easier than ads — it has no equivalent of the
  Marketing API Access Tier second gate, and the tokens cannot spend money. Unverified;
  confirm in CP-0.*
- **Instagram and TikTok pull media from a public HTTPS URL** rather than accepting an
  upload. Object storage with a public read path is mandatory, not optional.
- **Local toolchain gaps.** Node 22.19.0, npm 10.9.3 and git are installed. **pnpm and
  Docker are not.** Either install them or choose a stack that does not need them
  (npm workspaces; hosted Postgres/Redis instead of local containers).
- **Reliability is the product.** Silent post failures are the main reason people churn
  from schedulers. Retry, backoff and visible failure state are CP-1 requirements, not
  polish.

## Next actions

1. Decide the CP-0 research questions that are genuinely new (the rest are inherited):
   - Confirm Meta content-publishing review path differs from the ads path
   - Confirm X pay-per-use pricing against the official page
   - Confirm TikTok Content Posting API audit requirements for public (non-private) posts
2. Write `checkpoints/CHECKPOINTS.md`, modelled on Ads-Platform's gates.
3. Write `architecture/` — data model, adapter interface, token vault boundary, queue design.
4. Only then scaffold code, starting with Facebook Pages + Instagram on the owner's own accounts.
5. Submit Meta Business Verification in parallel with step 3, since it blocks Wave 1 productisation.
