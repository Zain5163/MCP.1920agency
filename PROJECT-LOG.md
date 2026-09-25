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

- **Tier 0.4 done:** database password rotated by the owner after its exposure in a
  chat transcript. Connection verified afterwards; both social accounts intact.
- **Tier 0.3 done: platform limits verified against live documentation.** Facebook
  and Instagram now carry a verification date rather than `false`. Three errors found:
  - Instagram's publishing rate limit is **100 posts per 24h, not 50** — the 50
    figure is stale and widely repeated. Corrected in the adapter's quota default.
  - Instagram requires an aspect ratio between **4:5 and 1.91:1**, and **we were not
    checking it at all**. Outside that range, container creation fails with an error
    that reads like a permissions problem. Now validated before anything is queued,
    with the image's actual dimensions and the accepted range in the message.
  - Meta's docs state **JPEG only** for Instagram, listing PNG as unsupported — yet a
    PNG published successfully on 2026-09-25. Recorded rather than enforced: rejecting
    something that demonstrably works would be worse than the documented risk.
  - Facebook's text limit is widely cited as 63,206 but Meta publishes no exact
    figure, and secondary sources also say 50,000. Left as-is and noted as
    approximate — it is far beyond any realistic caption either way.

  Unknown dimensions **warn rather than block**, because wrongly rejecting a valid
  post is worse than a late failure.

**Tier 0 is complete.**

- **Tier 1.2 and 1.1 shipped together.** Added `ProviderAuth` so the long-lived
  user token is stored, letting the dashboard list and connect Pages without
  another trip through OAuth. **The architecture test then caught the Accounts
  page I had just written hardcoding `facebook_page` and `instagram`** — the
  tempting fix was an allowlist entry, which is the erosion the test exists to
  stop. Built the `Provider` abstraction instead, closing 1.1 early. Adding a
  platform is now one provider, one adapter, one capability record.
  *Also worth recording: 1.2 was committed before the tests were checked and had
  two failures. The "verify before claiming done" rule is this project's own and
  it was broken.*
- **Tier 2.1 shipped: carousels in the UI.** An ordered picker with thumbnails,
  move up/down, per-item removal, and a live count against the strictest limit of
  the selected platforms. Order shown is order published — proven by a test that
  asserts the child containers reach Instagram in the given sequence.
  Found and fixed a latent bug on the way: the web action skipped hosting for
  Facebook-only posts and produced media with neither a URL nor a file path. The
  browser has bytes in memory and no path an adapter could read, so media from the
  dashboard is now always hosted — which also makes the immediate and scheduled
  paths identical.

- **Tier 2.2 shipped: platform preview.** Tabs per selected account showing how the
  post will actually look — where the caption is cut, how media is cropped, and
  carousel position.

  The design problem was that preview is inherently platform-specific while the
  architecture test forbids platform names in the UI. Resolved by making the
  differences **data**: a `PreviewStyle` on each capability record carries the
  truncation point, caption position, media fit and accent colour. The preview
  component renders from that and never learns which platform it is drawing.

  Worth knowing what it reveals: **Instagram cuts a caption at ~125 characters,
  Facebook at ~400.** A caption that reads well on one can lose its point on the
  other, and nothing in validation catches that.

- **Tier 2.3 shipped: per-platform captions.** One caption everywhere was governed
  by the strictest limit, so the platform with the most room got the shortest post
  — and the preview had just made visible that the *same* words land differently
  where Instagram cuts at ~125 characters and Facebook at ~400.

  Overrides are opt-in per platform and blank means "use the shared text", so the
  common case stays one box. The preview shows whichever text will actually
  publish, and the publish button blocks on an over-length override rather than
  letting the server refuse it.

  The engine already supported `overrides`; this made them reachable. Tests assert
  each platform validates against its own text, that an over-length override still
  fails, and that a platform without one falls back correctly.

- **Bug found by testing rather than assuming.** The owner re-authorised, and the
  provider auth row existed but held no credential. Cause: the vault's store only
  knows how to read and write `connections`, and a provider authorisation lives in
  its own table — so `connect.ts` created the row and then threw trying to save the
  token. Fixed with a separate `providerAuthCredentialStore`. Two explicit stores
  rather than one that guesses which table an id belongs to, because guessing costs
  a query on every credential read and quietly does the wrong thing on a collision.
  Verified afterwards by discovering real Pages through the stored authorisation.

- **Tier 2.4 shipped: retry a failed target. Tier 2 is complete.** A permanent
  failure previously meant recreating the whole post.

  Retry resets attempts and clears the recorded error, so the retry gets a full
  backoff budget and a stale message cannot be mistaken for a new one. It reuses
  the existing job row rather than accumulating one per attempt.

  **A published target is never retried** — including one that failed but carries a
  platform post id, because if the platform accepted it, it went out. Re-running
  would post a second copy, which is worse than the failure it might be fixing.
  Tested against the real database, including that another tenant cannot retry
  someone else's target.

- **Dashboard clarity, from owner feedback on the live UI.** Two real gaps:

  **Accounts were ambiguous.** "1920 Agency" appeared with no indication of which
  platform it was, in the accounts panel, the account picker, published tags,
  scheduled rows and failure rows. Added a platform badge everywhere an account is
  named, with the label as capability data (`accountLabel`: "Facebook Page",
  "Instagram") so a new platform gets a badge by adding data rather than editing
  the UI. Tests assert every previewable platform declares one and that labels are
  distinct — a shared label would defeat the purpose.

  **The preview only ever showed the first image.** Useless for a carousel, where
  the point is checking each slide crops correctly and reads in order. Added
  arrows, clickable dots, a thumbnail strip, and a live "2/3" counter.

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
