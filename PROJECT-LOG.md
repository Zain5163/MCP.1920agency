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

- **Tier 1.4 shipped: automatic credential refresh.** Threads made this concrete —
  its tokens last 60 days and can only be refreshed inside a window, after which
  the connection is gone entirely and the customer must reauthorise. Nothing about
  that failure is loud: posts simply start failing weeks later.

  `Provider.refresh` is optional, so a provider that omits it is declaring "my
  credentials do not expire" — which the runner treats as nothing to do rather
  than a failure. Meta correctly skips; Threads implements it.

  A failed refresh does **not** immediately mark the account dead. There are days
  left and the next run may succeed, so disabling a working account over one
  transient network error would be worse than the problem.

  The monitor gained a seventh check, and `AdsPilot-Refresh` runs daily at 04:00.
  **Verified by simulation**: set the authorisation to expire in 5 days (monitor
  raised a warning, refresh correctly skipped Meta), then to 2 days past expiry
  (refresh reported EXPIRED and exited 1), then restored and confirmed all seven
  checks green.

- **Account selection changed from per-platform to per-account.** Selecting by
  platform meant connecting three Facebook Pages and having no way to post to just
  one. Pinterest made it actively wrong — one authorisation yields many boards, and
  posting the same pin to every board is spam rather than reach. Now each account
  is selected individually, with select-all for convenience. Validation stays per
  platform, since two Pages share one set of rules.

- **Pinterest built.** A pin belongs to a **board**, not an account, so each board
  is its own connection and `platform_account_id` holds the board id. Modelling it
  the other way — one connection per profile, board chosen per post — would have
  needed a board field on every draft and interface in the system.

  Pinterest also splits text into a 100-character title and an 800-character
  description where our drafts have one body. The first line becomes the title and
  the rest the description, which is how people write anyway.

  ⚠️ **Recorded prominently because it is the dangerous one:** under Pinterest's
  **Trial access**, pins are sandbox entities visible only to their creator.
  Everything reports success — an id comes back, the URL resolves — while nobody
  else can see the pin. Standard Access requires a submitted video of the app in
  use.

  Its OAuth also authenticates with HTTP Basic rather than a secret in the body,
  unlike every Meta flow here, and it refreshes with a separate refresh token
  unlike Threads which refreshes using the access token itself. Both are tested.

### LinkedIn — built, unit-tested, never published for real

- Adapter, provider, capability record and 32 tests. Typecheck clean across 13
  workspaces, **371 tests across 10 suites, 0 failures.**
- **The author is a URN, and the URN carries the account type.**
  `urn:li:person:x` is a personal profile, `urn:li:organization:n` a company page.
  `platform_account_id` holds the whole URN, so no account-type column was needed
  — the same trick as Pinterest storing a board id. A bare id is rejected before
  any call, because LinkedIn answers one with an opaque 422.
- **⚠️ `commentary` is "little text", not plain text.** An unescaped reserved
  character — `( ) [ ] { } @ # * _ ~ < > | \` — does **not** error. LinkedIn
  drops the post from that character onward and still returns success. "Call us
  (today) on..." publishes as "Call us". `escapeLittleText` handles it and four
  tests cover it. **Unverified:** whether an escaped `#` still renders as a
  clickable hashtag. If hashtags come out as plain text, that is the cause.
- **LinkedIn is the only platform so far that will not fetch media.** Instagram,
  Threads and Pinterest are given a URL. LinkedIn issues a one-time upload URL and
  wants the bytes, so the adapter reads from disk or downloads first, then PUTs.
- A created post returns **201 with an empty body**; the id is in the
  `x-restli-id` response header. Every call needs `LinkedIn-Version` (YYYYMM,
  retired after about a year) and `X-Restli-Protocol-Version: 2.0.0`.
- **Organisation access is optional by design.** Without Community Management
  approval the organisation lookup 403s, which is the *expected* state for a new
  app — so it is swallowed and the tenant still gets their personal profile. A
  missing approval loses company pages, never the whole connection. Organisation
  scopes are only requested when `organizationAccess` is set, because asking
  without approval makes the dialog refuse outright and blocks personal posting
  too.
- **Not implemented:** video (chunked upload with ETag tracking), and
  `Provider.refresh` — LinkedIn needs a separate refresh token that the interface
  cannot supply, and only approved apps get one at all. An unapproved app's token
  dies at 60 days and needs reauthorisation. Pinterest has the same gap. Wiring it
  in would make it look handled when it is not.

### 2026-09-26 — LinkedIn app created; three unknowns closed from the real console

Owner created the LinkedIn app **Mysmadspilot** and sent the Settings, Auth and
Products screens. Those resolved three things that had been guesses:

- **Page association is done.** The app is verified against *1920Agency™ Digital
  Marketing Agency* as of 2026-09-26. The "Standalone app" label is an app *type*,
  not an absence of a Page — an earlier concern that turned out to be nothing.
- **Access token TTL is 2 months (5,184,000 seconds)**, stated in the console.
  That is exactly the fallback already coded in `refreshWithToken`, so the
  assumption was right. No refresh product is offered on a self-serve app, so
  **a LinkedIn connection must be reauthorised every 60 days**. There is nothing
  to build that avoids this.
- **Community Management API cannot even be requested.** Its button is *disabled*
  on a verified app with a real company Page — not "apply and wait". Company-page
  posting is therefore not merely unapproved, it is unreachable on this app.

**Consequence to be honest about: LinkedIn posting will be as the owner
personally, not as the 1920 Agency page.** The adapter supports organisation URNs
and will work the day access exists; nothing needs rewriting. But the feature the
agency actually wants is not available today.

Reported and NOT verified: that Community Management and Sign In with OpenID
Connect cannot coexist on one app. If true, company-page posting needs a *second*
LinkedIn app rather than another product on this one. Recorded rather than acted
on, because acting on an unverified constraint is how the Threads mistake happened.

### ✅ Closed: generic provider authorisation — `pnpm connect:provider <name>`

Three platforms had a working adapter **and** provider that nobody could connect,
because account *discovery* was provider-driven from early on and account
*authorisation* never was: the connect command only knew Meta's dialog.

Fixed at the contract rather than in the command. `Provider` gained `redirectUri`,
`authUrl(state)` and `exchangeCode(code)`, implemented by all four providers, so
`connect-provider.ts` names no platform at all — a new one needs a provider file
and a registration line and nothing in the command.

- Meta and Threads both exchange **twice** (short-lived then long-lived). Skipping
  the second step yields a credential that dies within the hour, which looks like
  a successful connect until the next day. Both are handled in their provider.
- Scopes are read back out of the dialog URL rather than declared a second time,
  so the stored list cannot drift from what was actually requested.
- The Meta-only `pnpm connect` was left untouched. It is verified working, and
  replacing a verified path is a separate decision from adding one.
- **Verified by running it:** with no argument and with a bad argument it lists
  the configured providers and exits non-zero. It correctly showed `meta` and
  `linkedin` and omitted Threads and Pinterest, which have no credentials.
  The full authorisation round trip is NOT yet verified against a live platform.

### ⚠️ Latent mismatch found while doing this: `bluesky`

Core's `PLATFORMS` still lists `bluesky`, dropped from scope in decisions/0001
but kept because the validation tests use it as a fixture. Prisma's enum never
had it. A `bluesky` connection would therefore compile and fail at the database.
Nothing can reach that today — there is no Bluesky provider or adapter — so it is
recorded rather than fixed, because the fix means rewriting a verified test file
around a different fixture platform.

---

## 2026-09-26 — LinkedIn connected for real

`pnpm connect:provider linkedin` ran end to end: dialog, callback, token
exchange, `/v2/userinfo`, encrypted storage. `pnpm status` shows
`linkedin  Zain Usman (urn:li:person:vR9KXeWJtX)` — stored as the full person
URN, which is what the adapter authors posts as.

The authorisation expires **2026-11-25**, the 60-day window with no refresh
available. That date is real and will arrive.

**Publishing to LinkedIn is still unproven.** A connected account is not a
published post, and the riskiest thing on this platform — little-text escaping —
cannot be checked until something is published and read back.

**Found while doing it: the browser opener picked the wrong application.** Handing
the URL to the Windows system handler opened the *LinkedIn desktop app*, which
cannot complete a redirect to localhost, so the authorisation silently never
arrived. The URL printed to the console still worked when pasted into a browser.
Fixed by naming browser executables directly and falling back to the handler, and
the printed URL now says why a desktop app cannot be used. Same family as the
earlier `cmd /c start` bug: on Windows, "open this URL" is not one thing.

## 2026-09-26 — The policy layer: closing R11

Until today the only thing between a model's mistake and a public post was **a
sentence in a tool description** asking it to confirm. That is advice to the very
component being constrained, and it fails precisely when the model is confused —
the case that matters. Raised by an outside architecture review the owner brought
in; it was the one thing in that review we did not already have.

`packages/core/src/domain/policy.ts`, 26 tests.

- Actions are classified **low / medium / high**. Reads execute. Scheduling and
  cancelling execute and are audited — recoverable, not harmless. Publishing
  requires approval.
- **An unclassified action defaults to high.** An action nobody classified is far
  more likely to be new and unconsidered than harmless, so it fails closed. The
  test suite asserts this, because it is what keeps the layer trustworthy as the
  system grows.
- **Confirmation is a token, not a boolean.** A `confirm: true` flag would be set
  by the same model that composed the post — no check at all. The token is an HMAC
  over the canonical payload, so it cannot be invented, and a token for one post
  does not authorise different text. Editing a single character invalidates it.
- The secret is generated **per process**, so an approval cannot be replayed days
  later against a system that has moved on.
- The gate sits **after** validation (so the summary describes a post that would
  really go out) and **before** `createPost` (so "nothing has been sent" is
  literally true, not approximately true).
- Object key order does not change a token; **array order does**, because order is
  content.

**Spend ceilings are written and tested but wired to nothing**, because no ads
code exists. They are here so the first ads adapter has an obvious place to call
rather than an excuse to invent its own. A mismatched currency is refused rather
than converted: a wrong exchange rate silently multiplies a budget.

### ⚠️ Found while verifying: the two MCP transports had silently diverged

`tools.ts` carried the comment *"Defined once and shared by both transports — so
the two can never drift apart in what they allow."* **That was false.**
`http-server.ts` calls `registerTools`; `server.ts` (stdio) defines its own six
tools inline. They had already diverged — stdio additionally accepts local file
paths, and its `check_status` reports configuration and keep-alive age.

So gating only `tools.ts` would have left the **stdio transport ungated**, which is
the one used locally by a desktop AI client — the most likely path of all. The
gate was applied to both. The duplication itself is a real defect and is recorded
rather than fixed: merging them is a refactor of a working local server, and doing
it in the same change as the safety fix would have risked the thing being fixed.

The comment claiming they were shared was worse than no comment: it was the reason
the divergence went unnoticed.

### Verified live, not simulated

Spoke JSON-RPC to the **real stdio MCP server** and called `publish_post` targeting
the live LinkedIn connection with no confirm token.

- It returned `APPROVAL NEEDED — nothing has been sent` with the account, the full
  text and a token.
- **Nothing was published.**
- Database checked afterwards: **zero** rows matching the probe text, post count
  unchanged at 6, target count unchanged at 8. The refusal left no trace, so
  "nothing has been sent" is literally true rather than approximately true.

## 2026-09-26 — First LinkedIn post, and the escaping question answered

Owner approved publishing a real marketing post. It went out through the new
approval gate: called once without a token and refused, called again with the
token and published. `urn:li:share:7509614451189239808`.

The post was written to be genuinely publishable **and** to test the one thing
that could not be answered from documentation. It contained
`1920 Agency (a marketing and video editing studio):` early on and a trailing
`#ContentMarketing`.

Owner read the published text back in full. Two results:

- **No truncation at the `(`.** Had escaping been wrong, everything from that
  character onward would have vanished while the API still reported success.
  `escapeLittleText` is correct.
- **The escaped `#` rendered as a normal hashtag, no backslash visible.** This
  had been an open question with no documented answer, carried as *reported,
  unverified* since the adapter was written. LinkedIn unescapes little text on
  display, so the rule is simply: escape everything, it round-trips.

That moves LinkedIn from "adapter built" to **proven end to end** — authorise,
discover, store encrypted, gate, publish, read back correct.

Still not checked: media upload, video, rate limits, and whether the
3,000-character limit counts graphemes or UTF-16 units.

## 2026-09-26 — LinkedIn image upload proven

Second real post, this time with a local PNG: `urn:li:share:7509616982338461696`.

This exercised the path that makes LinkedIn different from every other platform
built so far. Instagram, Threads and Pinterest are handed a URL and fetch the
file themselves. LinkedIn issues a **single-use upload URL** and expects the
bytes, so the adapter reads the file from disk and PUTs it, then references the
returned image URN in the post. All three calls — initializeUpload, the binary
PUT, and the post — succeeded against the live API.

Notably this worked **without any object storage**. The file came straight off
local disk, which is the same property Facebook has and Instagram does not.

Also fixed: the stdio tool described `localPath` as "Facebook only", which had
been true when it was written and silently became wrong the day the LinkedIn
adapter landed. A stale hint in a tool description is read by an AI as fact, so
it would have stopped a model ever attaching a local file to a LinkedIn post.

**Video is still not implemented.** LinkedIn video uses a different endpoint with
chunked upload and ETag tracking; the adapter refuses video with an explanation
rather than failing partway through an upload.

## 2026-09-26 — LinkedIn video upload built (not yet published live)

Seven tests. 403 across 10 suites, 13 workspaces typecheck clean.

Video is a **different endpoint** from images, not a variation on it:

1. `POST /rest/videos?action=initializeUpload` with the exact byte count. LinkedIn
   replies with a *list* of byte ranges and a URL for each — 4 MB per part.
2. A PUT per range. **Each response carries an `ETag` that must be kept.**
3. `POST /rest/videos?action=finalizeUpload` with those ETags in order plus the
   upload token.

Design notes worth keeping:

- `fileSizeBytes` must be the **real** length, so the media is read before
  initialising. A declared size that disagrees yields instructions that do not
  match the file. A test asserts a wrong declared size is ignored.
- A missing ETag **stops the upload** rather than finalising. Finalising without
  every part risks silently producing a broken video, which is worse than an
  error. A test asserts `finalizeUpload` is never reached in that case.
- Under 4 MB the instruction list has one entry, so a small video looks
  deceptively like the image flow. Tested with 1, 2 and 3 parts so the multi-part
  path is not left to a lucky first upload.
- Parts upload in sequence, so a failure names the part that failed.
- **A post carries images OR one video, never both.** LinkedIn has no container
  that mixes them and the error it returns does not hint that the mixture was the
  problem, so the adapter refuses it up front.

**NOT verified live.** Per R4 this is "it compiled and the tests pass", nothing
more. The workspace holds no video that is safe to publish: everything found is
client footage, unreviewed personal footage, or third-party reference material
(someone else's copyrighted upload). Choosing one unilaterally to post publicly
would have been reckless, so the owner nominates the file.

## Verified live, not just tested

| What | How it was proven |
|---|---|
| LinkedIn authorisation | Connected 2026-09-26; person URN stored; visible in `pnpm status` |
| LinkedIn publishing | Real post published 2026-09-26 through the approval gate, `urn:li:share:7509614451189239808` |
| Little-text escaping | Same post: text with `(` `)` survived intact, escaped `#` rendered as a clean hashtag |
| LinkedIn image upload | Real image post 2026-09-26, `urn:li:share:7509616982338461696` — the two-step upload works |
| The approval gate | Refused without a token and published with one, on a real irreversible action |
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

**371 tests across 10 suites and 13 workspaces, strict typecheck clean.** The database and auth
tests run against the real Supabase instance and clean up after themselves —
cross-tenant isolation cannot be meaningfully proven against a mock.
