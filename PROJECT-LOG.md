# AdsPilot — project log

A record of what was actually built and verified, in order. Kept so that work does
not depend on a chat transcript surviving.

**"Verified" means exercised against the real thing**, not that it compiled. Where
something was only compiled or only unit-tested, it says so.

---

## 2026-09-21 — Research and architecture

- Project created after research into whether to build at all. Prior art checked and
  licence-verified: **Postiz** (AGPL-3.0 — its network clause would force
  open-sourcing any commercial fork) and **Mixpost** (Lite MIT, Pro $299 one-time).
- Inherited three research documents from `..\Ads-Platform` CP-0 rather than
  redoing them: token vault security architecture, Meta approval mechanics,
  infrastructure costs.
- **Decided: build in TypeScript rather than fork Postiz** — see `decisions/0001`.
- **Decided: bring-your-own API keys** as the pricing model, because platform API
  costs are per-app rather than per-user. X charges ~$0.20 per post containing a
  link, which makes a cheap unlimited plan structurally loss-making.

## 2026-09-23 — Scope cut, then foundations

- Owner challenged whether this was worth building. Honest review concluded that
  **for posting 1920 Agency's own content, buying Mixpost Pro would beat building**.
  The build is justified only by the MCP angle, which nothing else sells.
  Scope cut to **MCP-first, no UI**. Bluesky dropped as a wasted step.
  (`decisions/0001`)
- **Supabase kept over Neon**, with a mandatory weekly keep-alive. (`decisions/0002`)
- Built `packages/core` (validation, error classification), `packages/vault`
  (envelope encryption), `packages/config`, `packages/db` (Prisma schema).
- Schema reviewed against the `supabase-postgres-best-practices` skill, which
  caught three real defects **before the first migration**: UUIDv4 primary keys
  (changed to v7 for index locality), four unindexed foreign keys, and camelCase
  column names that would have required quoted identifiers in the raw SQL queue
  query forever.

## 2026-09-24 — First real posts, then the platform

- **Migration applied** to Supabase. Keep-alive registered in Task Scheduler.
- Facebook Page adapter built. Graph API version corrected from a stale v21.0 to
  **v25.0** after checking the changelog.
- **First real post published** to the 1920 Agency Page.
- Instagram adapter built (feed, Reels, carousel). Supabase Storage upload added,
  because Instagram fetches media from a URL and cannot accept an upload.
- **First Instagram post published.** A real bug surfaced: Supabase signals a
  duplicate upload as **HTTP 400 with `"statusCode":"409"` in the body**, not an
  actual 409, so the duplicate check missed it.
- Scheduler worker built. **Verified by scheduling a post and watching it publish
  unattended** — worker started 17:27, published 17:28 with nobody present.
- `AdsPilot-Worker` registered to run every 5 minutes. One-shot rather than a
  daemon: a crashed one-shot recovers on the next tick, a crashed daemon stays dead.
- Web dashboard built (Next.js 15, React 19), later converted to **Tailwind v4**.
- Error catalogue added — every failure carries cause and numbered fix steps, with
  tests that fail if an entry is thin or if something is marked both retryable and
  needing a human.
- Telemetry added: JSONL plus Slack, redaction on everything, and a test proving a
  failing sink cannot break the caller.
- **Tenant isolation** built as `TenantScope` and tested against the real database.
  Found a real bug: deleting a tenant silently half-failed, because
  `targets.connection_id` is `onDelete: Restrict` and blocks the cascade. Replaced
  with an ordered delete — which is also what account closure needs.
- Owner/admin roles via `AdminScope`: no escalation path from a tenant scope, a
  reason required, and the audit entry written into **the account being opened**
  rather than the operator's.
- Real accounts: scrypt password hashing from Node's own crypto, with a test that
  measures login timing and fails if an unknown email is rejected faster than a
  wrong password.
- **Hosted MCP over HTTP** with per-user bearer tokens. Verified live: no token and
  bad token both 401, real token returns the account's connections.
- Token management page in the dashboard.

## 2026-09-25 — First campaign post, and tier 0

- **Published a real campaign post** (video editing services creative, caption
  written here) to Facebook and Instagram in one command.
- Fixed the dashboard crashing with "a client-side exception has occurred". Cause:
  `toLocaleString()` in server-rendered output — Node formats with the server's
  locale, the browser with the user's, and React 19 treats the mismatch as fatal.
  All dates now use a deterministic UTC formatter.
  **Correction worth recording:** this was reported as fixed twice before it was.
  `pkill` fails silently on Windows, so the old server kept serving and the
  verification was meaningless. Use PowerShell to stop processes here.
- `media/to-post` and `media/posted` added as a standing drop folder.
- `IDEAS.md` and `ROADMAP.md` written — every idea ranked by dependency.
- **Tier 0.1 shipped: cancel a scheduled post from the dashboard.** Verified by
  scheduling a real post, cancelling it, forcing its job due, and running the
  worker — which reported `queued=0` and published nothing.

- **Tier 0.2 shipped: health monitoring.** Six checks — scheduler alive, overdue
  posts, stalled jobs, broken connections, recent failures, database keep-alive.
  Every problem reports what to do about it, not just that it happened.
  **Verified by breaking it on purpose**: aged the worker heartbeat by 2 hours and
  the keep-alive to 6.5 days, confirmed both raised CRITICAL with the right remedy
  and exit code 2, then restored and confirmed it returned to healthy with exit 0.
- `AdsPilot-Monitor` registered to run every 30 minutes. Runs **separately from the
  worker on purpose** — a worker cannot be trusted to report that it is not running.
- Roadmap updated: entitlement/plan model added at tier 1.5 (subscription tiers are
  like `tenant_id` — cheap now, a rewrite later), and merging `Meta-Ads-Publisher`
  rather than rebuilding it recorded as 5b.0.

- **Tier 0.5 shipped: Data API locked down.** While enabling RLS, found a **live
  critical exposure**: Prisma creates tables in the `public` schema, Supabase grants
  `anon` and `authenticated` full privileges there by default, and PostgREST serves
  them over HTTPS. The `anon` key is public by design — it is meant to be embedded
  in browser JavaScript. Anyone holding it could read and write `connections`
  (encrypted OAuth credentials), `users` (password hashes) and `api_tokens`.
  Confirmed by querying `information_schema.role_table_grants`: both roles held
  ALL privileges on every table. Grants revoked, default privileges revoked so new
  tables do not inherit them, and RLS enabled on all 13 tables as a second layer.
  Verified after: zero grants remain, all 13 tables have RLS, and the application,
  media uploads and all 286 tests still pass.

---

## Verified live, not just tested

| What | How it was proven |
|---|---|
| Facebook publishing | 4 real posts on the 1920 Agency Page |
| Instagram publishing | 2 real posts |
| Media upload | Real file uploaded, public URL fetched back |
| Scheduling | Post published unattended by the worker |
| Cancellation | Cancelled, job forced due, worker skipped it, `platform_post_id` null |
| Hosted MCP auth | 401 without a token, real data with one |
| Tenant isolation | Two real tenants; cross-access refused |
| Session security | Valid signature accepted, one flipped character rejected |
| Health monitoring | Broke it deliberately; both failures caught with correct remedy and exit code |
| Data API lockdown | Grants queried before and after; zero remain, RLS on all 13 tables, app unaffected |

## Test coverage

**286 tests across 13 workspaces, strict typecheck clean.** The database and auth
tests run against the real Supabase instance and clean up after themselves —
cross-tenant isolation cannot be meaningfully proven against a mock.
