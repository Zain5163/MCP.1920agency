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

## 2026-09-27 — Fixed the memory defect before using video for anything

Owner asked whether the MCP could compress video. Answering that surfaced a
defect in code written hours earlier, and R9 says nothing new is built on top of
a known defect, so it was fixed first.

`#readMedia` read the **entire file into one buffer**, then sliced it into 4 MB
parts. A 400 MB video meant 400 MB of RAM in one allocation; several concurrent
uploads on a worker would be an out-of-memory crash, not a slow upload.

Replaced with a `MediaSource` that reads one range at a time from disk. A URL is
streamed to a temporary file first rather than buffered, which trades disk for
RAM on purpose. The temp file is removed when the source closes, including on a
failure partway through a multi-part upload.

**A short read is now an error.** It means the file changed while it was being
uploaded, and sending the padding would upload silent corruption rather than
failing — the same class of problem as LinkedIn's text truncation, and worth
the same refusal to paper over.

That strictness immediately **caught unrealistic byte ranges in this project's
own video tests**. They had passed only because the in-memory version returned
empty slices without complaint. A stricter implementation finding bad fixtures
is the test suite doing its job late rather than never.

A new test uses a real 10 MB file and asserts each PUT carries only its own 4 MB
range. Memory cannot be measured in a unit test, so it asserts the observable
consequence instead.

Also: both LinkedIn providers now register and list correctly — `linkedin` and
`linkedin_page` — confirmed by running the connect command. The page app cannot
authorise yet; Community Management is **Review in progress**.

## 2026-09-26 — Video published for real, and a URN surprise

`Day 2.mp4`, 5.2 MB, published to the live profile. State `published`, id
`urn:li:ugcPost:7509704322323222529`. Verified from the database rather than from
the console output, because "it printed success" and "the row says published"
are different claims.

So the whole chunked path works against the real API: initializeUpload, a PUT per
byte range with its ETag captured, finalizeUpload, then the post. And it works
**streaming from disk** — the memory fix landed before this ran, so this is the
first upload that never held the file in one buffer.

### ⚠️ Video posts return a DIFFERENT URN type

| Post kind | URN returned |
|---|---|
| Text | `urn:li:share:...` |
| Image | `urn:li:share:...` |
| **Video** | **`urn:li:ugcPost:...`** |

Nothing here assumes the prefix, so nothing broke. But anything written later
that parses or matches on `urn:li:share:` — analytics, deletion, comment
lookups — would silently miss every video post. Recorded now, while it is cheap.

### The approval gate has now guarded three real publishes

Text, image and video. Every one refused first, summarised, then executed only
with a token covering that exact content.

### Note on how this ran

The publish was blocked for the assistant by the harness safety classifier as a
real-world transaction, so the owner ran the script themselves. Worth recording
rather than hiding: the control worked as intended, and routing around it was
not attempted.

## 2026-09-27 — The ads domain model (tier 5b begins)

Architecture before integration, per AGENTS.md. No adapter yet; a model, a
decision record and 26 tests first, because getting the shape wrong is only
expensive once two platforms exist.

`decisions/0003-ads-domain-model.md`, `packages/core/src/domain/ads.ts`.

### ⚠️ "Campaign" means different things on different platforms

| Ours | Meta | LinkedIn | Holds |
|---|---|---|---|
| Campaign | Campaign | **Ad Campaign Group** | objective |
| AdSet | Ad Set | **Ad Campaign** | budget, schedule, audience |
| Ad | Ad | **Creative** | the creative |

**LinkedIn's "Campaign" is Meta's "Ad Set".** Anyone reading both sets of docs in
the same week will conflate them, and the failure is putting a budget on the
wrong object — which either does nothing or spends at the wrong level. The
domain uses our own names; adapters translate.

### Decisions worth restating

- **Money is integer minor units.** `money(10.5, 'USD')` throws, and the error
  says to write `1050`. Floats are convenient and wrong for budgets.
- **Mixed currencies are refused, never converted.** A wrong exchange rate
  silently multiplies a budget. One ad account holds one currency, so a mix
  means an ad set is wrong and guessing which is worse than refusing.
- **Everything is created PAUSED, with no option to skip it.** An option to skip
  a safety rule is the safety rule not existing. A wrongly-created paused
  campaign costs nothing; a wrongly-created live one spends while you work out
  what happened.
- **Targeting no country is an error, not a warning.** An untargeted ad set
  spends money on an audience nobody chose.
- **No end date warns rather than blocks.** Legitimate for always-on work, and
  the easiest way to overspend, so the approval summary calls it out explicitly.
- **The approval summary leads with the MONTHLY figure.** 50/day reads as small;
  1500/month is the number that changes minds.

### The policy layer now covers money

`activate_campaign` and `update_budget` are high risk and marked as spending.
`create_ad_plan` is high risk but does **not** spend — it commits a budget that
one further action starts. `pause_campaign` is medium: refusing to stop spending
quickly would be worse than pausing wrongly.

A test proves a token approving a 50/day activation does **not** authorise the
same campaign at 500/day.

**Nothing is wired to LinkedIn yet.** Next is reading — list ad accounts and
performance — which is useful alone, carries no financial risk, and proves auth
and pagination before anything can spend.

## 2026-09-27 — Meta Ads: ported the guardrails, did not rebuild them

Owner reprioritised: Meta Ads before LinkedIn Ads, because *"barely few people
run ads on [LinkedIn]… mostly meta is the most important."* Correct, and LinkedIn
Ads moved to `WAITING-LIST.md` rather than being dropped.

Found `AI-Automation\Meta-Ads-Publisher` — a 1,436-line Python tool the owner
built and validated offline on 2026-09-10, never connected to a live account.
The roadmap's own decision (5b.0) was **connect it, do not rebuild it**, so the
first work here was reading it rather than writing.

The valuable part is not the API code — it is `validate.py`, which encodes real
advertising judgement. Ported to `meta-ads-guardrails.ts` with 24 tests.

### The rule worth the whole exercise

**The learning-phase budget floor**, and it is *derived* rather than chosen:

> Meta needs roughly 50 conversions per week per ad set to leave the learning
> phase. So the floor is `CPA × 50 ÷ 7`. At a 20.00 CPA that is **142.86/day**.

Deriving it means the number and the reason cannot drift apart — change the CPA
and the floor follows. Most advertisers run far below it, and it is the single
biggest reason small-budget campaigns underperform: below the floor delivery
stays unstable and cost per result is materially worse however good the creative
is. The warning quotes the actual numbers and how many times short the budget is.

It is a **warning, not an error**, and a test asserts that. It is a judgement
call, and a guardrail that blocks a legitimate choice gets switched off.

### Other judgement encoded, not invented

- Fewer than 3 ads per ad set is not a creative test; more than 6 and Meta
  starves them of impressions.
- More than 3 ad sets fragments budget and slows every one out of learning.
- Interest stacking on a conversion ad set now usually loses to broad targeting.
- Mixing conversion events in one campaign splits the pixel's signal.
- Special ad categories (housing, employment, credit, politics) force age and
  gender back to defaults. **A legal restriction, not a preference.**
- 125 characters before "See more"; 40 before a headline truncates.
- An explicitly empty `urlTags` is a deliberate choice to disable attribution and
  is surfaced; an absent one is a default and is not.

### Model change: budget level

`campaign` (Meta's CBO) versus `adset`. **Setting both is an error on Meta**, not
a preference, and the error Meta returns does not say so. Caught locally now,
with a message that names the fix. `totalDailyBudget` respects the level rather
than summing absent ad set figures and reporting zero for a campaign that spends
every day.

**Nothing calls the Meta API yet.** This runs before anything is created, so a
bad plan costs nothing to discover.

## 2026-09-27 — Consolidated the ads work into this project

Owner's instruction: everything under one project, our hierarchy, our
conventions — *"this should not look like another outsider… use it as our own
product."* So the ads work stops being a port and becomes part of the codebase.

Taken and rewritten as ours:

- **Guardrails** (`meta-ads-guardrails.ts`) — the advertising judgement. Comments
  now explain *why* each rule exists rather than where it came from, which is
  better documentation anyway: a reader needs the reasoning, not the history.
- **Naming and attribution** (`meta-ads-naming.ts`) — 15 tests.

### The UTM detail that is easy to destroy

Meta's dynamic parameters — `{{campaign.name}}`, `{{adset.name}}` — are filled by
**Meta at click time**, so the braces must survive intact. Interpolating them on
our side looks correct, produces a working URL, and freezes the names at creation
time — so the moment anything is renamed, attribution silently points at the old
name. A test asserts the placeholders stay literal.

Related: an explicitly empty `urlTags` is **honoured**, not replaced. Someone
turning attribution off is making a decision; overriding it would be ignoring
them. Absent means "generate them", empty means "no".

### Naming is not cosmetic

An account full of *Campaign 1 - Copy (2)* cannot be reasoned about by a person
or by an AI. Names encode objective, audience, country, optimisation, format and
iteration, and ad set names distinguish **broad from targeted** — the first thing
anyone compares in a report.

### Recorded rather than built

`IDEAS.md` section K, so nothing is lost when the old folder is retired:
ad policy review status (**an ad can be created successfully and rejected hours
later** — the same failure-that-reports-success shape as Pinterest's sandbox),
dry run, resuming a partial failure instead of duplicating a campaign, briefs as
reusable files, and scheduled monitoring with rules.

**Not done:** `AI-Automation\Meta-Ads-Publisher` still exists and has not been
touched. Deleting or moving another project's folder needs explicit approval, so
it waits for one.

## 2026-09-27 — Instagram without a Facebook Page

Owner's observation, and a good one: *"most of the time people directly create
business account through their Instagram."* Those businesses could not connect
at all, and "you need a Facebook Page you do not want" is not a reason anyone
accepts.

Checked before building, per R7 — secondary sources contradicted each other, so
Meta's own documentation settled it: *"This API setup does not require a
Facebook Page to be linked to the Instagram professional account."*

`decisions/0004`, `instagram-provider.ts`, 13 tests.

### The architectural problem, and why it was small

`PublishService` holds `Map<Platform, PlatformAdapter>` — **one adapter per
platform, by construction**. Two Instagram adapters do not fit, and making them
fit would mean platform branching in the publisher, which the architecture test
forbids.

Solved by letting the adapter choose its host from the connection. The
information was already stored: `providerAuthId` points at the authorisation
that created the connection. It simply was never carried through. So
`Connection` gained `providerKey`, populated from an existing relation —
**no schema change**.

`providerKey` is an opaque string in core and is never interpreted there. Only
the adapter reads it, so no platform knowledge leaks.

### Not a second platform, deliberately

An `instagram_direct` platform value was rejected: it is the same Instagram
account reached differently. A customer seeing two Instagrams in a list would
reasonably ask which one is theirs.

Inferring the host from scopes was also rejected — it works today and breaks
silently whenever a scope name changes, and the failure is a request to the
wrong host that reads like an auth problem.

### Details that will bite someone otherwise

- **Two token exchanges.** The first returns a token lasting about an hour.
  Stopping there gives a connection that works while you test it and is dead by
  morning. Same trap as Meta and Threads.
- **This token expires and refreshes**; a Page token does not. So this provider
  implements `refresh` and Meta's does not, and the existing refresh runner
  needed no changes.
- **Its own app id and secret**, shown on the Instagram product page, not the
  Meta app id. Different numbers entirely.
- **Scopes are comma-separated** here, space-separated on LinkedIn. Four
  platforms, three conventions, each rejecting the others unhelpfully.
- The old `business_*` scope names were retired 2025-01-27. A test asserts the
  current ones.

**Not verified live** — no Instagram app credentials configured yet.

## 2026-09-27 — The Meta ads client: campaigns that cannot spend

`meta-ads.ts`, 14 tests. Campaign → ad set → creative → ad, all created **PAUSED**,
with no option to change that.

### `review` cannot touch the API, by construction

Separate method from `create`, and a test asserts it makes **zero** network
calls. This is what an AI calls before asking a person to approve, so it must be
impossible for it to have side effects. It merges the platform-neutral checks
with the Meta guardrails and returns errors, warnings and the summary together.

### A partial failure reports what exists

Objects are created top down because each needs the id above it, so a failure at
step three leaves a half-built campaign — and re-running creates a **second** one
rather than resuming. Until that is fixed (IDEAS K3) the error names the campaign
id, states that everything is paused and nothing is spending, and says to delete
it before retrying. A test asserts all three.

### Details carried over deliberately

- Budgets in **minor units as strings** — Meta's format, and the reason money is
  integer cents throughout.
- `promoted_object` carries pixel and event: that pair is what the algorithm
  optimises toward. Without them a conversion goal is a request Meta cannot act on.
- `error_user_msg` is preferred over `message` when Meta sends it. It is usually
  far better — *"your ad account is not authorised to run ads in this country"*
  against *"Invalid parameter"*.
- Advantage+ placements and advantage audience on by default; manual placement
  lists lose to them in most accounts.

**Nothing has touched a real ad account.** Needs an ad account id and a token
with `ads_management` — the Page token used for publishing is not enough.

## 2026-09-27 — First contact with the real Meta Marketing API

Owner created a **sandbox ad account** (`1548198627338649`, PKR, Asia/Karachi)
and a token with `ads_management`. Read-only check first: account reachable,
status ACTIVE, 0 spent.

### ⚠️ A sandbox ad account is the fourth failure-that-reports-success

Meta's own wording: *"These ad accounts don't require a payment method and the
ads you create **won't run**."* Campaigns are created, ids come back, everything
succeeds, and nothing ever delivers.

Same shape as Pinterest Trial access, TikTok pre-audit, and LinkedIn's silent
truncation. Written into the env file so a future session cannot mistake a
sandbox success for a working campaign.

### Four real API rules, none of which were in the ported code

Every one came from an actual rejection, and each is now a test:

1. **`is_adset_budget_sharing_enabled` is mandatory** when budgets sit on ad
   sets. Meta refuses the campaign outright, and the error names the field but
   not that it applies only in this case.
2. **Attribution windows depend on the optimisation goal.** A 7-day click window
   is only valid for conversion goals. Optimising for clicks allows *(1, 0)*
   only — the click *is* the outcome. Now sent only for conversion goals, so
   Meta applies its own default elsewhere and cannot reject it.
3. **Advantage audience and a narrowed age range conflict.** With it on, Meta
   treats age as a *suggestion*; narrowing is refused with “you can add a lower
   maximum age as a suggestion instead”, which never names the cause. And the
   flag is **mandatory** — omitting it is also refused. So it is always sent,
   explicitly `1` by default and `0` when an age range was chosen deliberately.
4. **The ads `instagram_actor_id` is not the publishing Instagram id.** They
   look alike; `17841452630711887` publishes fine and is rejected here. Left
   unset, ads run as the Page, which is valid.

This is the argument for raw HTTP over the Business SDK making itself: every one
of those was diagnosed from Meta's own message, verbatim, in one read.

### Where it stopped

**Campaign and ad set create successfully. The creative does not:**

> *Ads creative post was created by an app that is in development mode. It must
> be in public to create this ad.*

App Mode is **Development**. Creating ad creatives needs it Live. That is the
owner's switch, not a code problem.

### Left behind, needing cleanup

Five paused campaigns and two ad sets in the sandbox, from the retries. All
PAUSED, in a sandbox, so nothing can spend — but it is clutter, and it is
exactly the duplication IDEAS K3 exists to stop: re-running builds a new
campaign rather than resuming.

## 2026-09-28 — System User token works; the creative needs an asset assignment

Owner published the app and created a System User token. Two env keys existed
briefly — the working token under a new name, the failing one under the name the
code reads — so the code kept using the broken one. Consolidated to a single key;
two sources of truth for a credential is a bug waiting to happen.

Campaign and ad set now create cleanly. The creative fails with:

> *You don't have the required permission to access this profile* (code 10)

Not a code problem. A creative references the **Page**, and a System User only
reaches assets explicitly assigned to it in Business Manager. The ad account was
granted; the Page was not.

### The bigger question, answered: `decisions/0005`

The owner asked how customers would grant access. The honest answer is that the
thing being set up **does not scale to customers at all**.

A System User token is a **non-expiring credential with full spending power**.
Asking a customer to create one and paste it into a form is a request no
customer should agree to, and holding it would be a liability we chose.

Customers use **Facebook Login for Business**: they click Connect, see Meta's own
dialog, choose which ad accounts to include, and can revoke it themselves without
speaking to us. Same `Provider` contract already used for Pages, LinkedIn and
Instagram — nothing structural changes.

**The gate:** `ads_management` on someone else's account needs Meta **App
Review** — business verification, a screencast of it working, a written case per
permission, and Meta's judgement. Until then it works only where the authorising
person already has a role, which is exactly why the owner's account works and a
customer's would not.

Review requires a **working** integration to demonstrate, so building is the path
to access rather than the other way round.

One thing recorded as needing to change: `MetaAdsClient` takes its account and
token at construction from environment variables. That is single-tenant by
design and must become per-call before any customer touches it.

## 2026-09-28 — Diagnosing the creative failure properly

The creative kept failing with *“You don't have the required permission to access
this profile”* (code 10) after the Page was assigned to the System User. Rather
than guess again, queried what the token can actually reach:

| Question | Answer |
|---|---|
| Who is this token? | `122102498205487991` — **“Sandbox Ad Account Owner”** |
| What Pages can it see? | `102223309294786`, `tasks=ADVERTISE` only |
| Can it read the Page's name? | No — returns `undefined` |
| What Pages will the ad account promote? | **`[]` — empty** |

Two findings, and the second is the cause.

**The token is not the Business Manager System User.** It is a synthetic identity
created by the sandbox quickstart. Assigning the Page to *Mysmadspilot* was the
right action and had no effect on *this* token, because it belongs to a different
principal.

**`promote_pages` on the sandbox ad account is empty.** A creative names a Page,
and the ad account will not accept one it has no association with — even though
the Page was ticked in the sandbox creation dialog. Business Manager asset
assignment and the ad account's own Page association are **separate things**, and
satisfying one does not satisfy the other.

Worth recording as a method rather than a fact: four attempts were spent guessing
from error messages before asking the API what it could see. Three queries
answered it. **Meta's permission errors name the symptom, never the principal or
the missing association**, so with any code 10 the first move is to ask who the
token is and what it can reach.

## 2026-09-30 — First complete Meta ad campaign, created paused

Campaign `120330000132891215`, ad set `120330000132892015`, three creatives and
three ads, in the sandbox ad account. **Read back from Meta afterwards** rather
than trusted from our own output:

| Object | status / effective_status |
|---|---|
| Campaign | PAUSED / PAUSED |
| Ad set | PAUSED / PAUSED, 500000 paisa (PKR 5,000/day), LINK_CLICKS |
| 3 ads | PAUSED / **IN_PROCESS** |

`IN_PROCESS` on the ads is Meta's policy review running. It is the state IDEAS K1
is about: an ad can pass creation and still be rejected hours later. Now observed
for real, not just predicted.

### What unblocked it

The owner generated a System User token, but it was saved as a **bare line with
no key**, under a label, so the env loader skipped it and kept reading the old
sandbox token. Moved onto `META_ADS_ACCESS_TOKEN`. `debug_token` now reports
**SYSTEM_USER, expires never**, identity *Mysmadspilot*, with full tasks on the
Page — against *Sandbox Ad Account Owner* with `ADVERTISE` only before. That
difference was the whole of the creative failure.

### ⚠️ A cross-cutting bug, found by a network blip

One run dropped with `ECONNRESET` and came back labelled **permanent**. Node's
`fetch` throws `TypeError: fetch failed` and puts the network error in `cause`;
`classifyNetworkError` read only the top level. So **every dropped connection on
every platform was classified permanent and never retried by the worker** —
including scheduled Facebook posts. It now walks the cause chain, with a depth
limit against cycles. Four tests, one reproducing exactly what fetch throws.

The partial-failure wrapper in the ads client also forced `permanent`, hiding the
same thing a second time. It now keeps the underlying class.

### Left for the owner

- **Orphan campaigns** from the retries, all PAUSED in a sandbox. Deletion
  awaiting approval. This is IDEAS K3 made concrete: every retry built a new
  campaign rather than resuming.
- The token carries **43 permissions** including WhatsApp messaging and Page
  inbox access, and never expires. Ads need six. Recommended regenerating with
  only those; owner's decision.

## 2026-09-30 — Ads in the MCP server: an AI can plan, create and start campaigns

Five tools on the local server, verified by driving the real stdio server over
JSON-RPC against the live account:

| Tool | Risk | Verified live |
|---|---|---|
| `review_ad_plan` | low | priced the plan: PKR 5,000/day, ~150,000/month, no problems |
| `get_campaign_status` | low | read the real campaign: 3 ads `PENDING_REVIEW` |
| `create_ad_plan` | high, gated | **refused** — no spend ceiling configured |
| `activate_campaign` | high, gated | **refused** — no spend ceiling configured |
| `pause_campaign` | medium, no gate | unit-tested only |

### Three gates, in this order, for anything that can spend

1. **Validation** — refused outright if it would fail at Meta or is illegal.
2. **The spend ceiling** — checked against **everything the account already
   spends**, not just this campaign. Ten campaigns at 5,000 a day is 50,000,
   whatever each looks like alone. `committedDailySpendMinor` reads active
   campaigns and ad sets and counts each budget once, since CBO and ABO put it at
   opposite levels.
3. **Approval** — a token over the exact plan. For activation the token covers
   the campaign **and its budget**, so a budget changed between approval and
   execution invalidates it.

### The ceiling fails closed

With no `META_ADS_DAILY_LIMIT` / `META_ADS_MONTHLY_LIMIT` set, nothing that can
spend runs, and the refusal says exactly what to add. **There is no default.** Any
default would be a number the software chose on the owner's behalf, and a
ceiling nobody chose is not a ceiling. Keys added to the env file empty.

### Lifecycle details worth keeping

- **Activation switches the campaign on LAST**, after its ads and ad sets. It is
  the master switch, so there is never a moment where part of a campaign runs.
- **Activation refuses if Meta rejected any ad.** Otherwise it would start
  spending on a campaign that cannot deliver them.
- **Pausing touches only the campaign, and has no approval gate.** It is the one
  switch that stops everything at once, and stopping spend must never wait on a
  confirmation round trip: a wrong pause costs delivery, a slow one costs money.
- `status` reads `effective_status`, not `status`. An ad can be `ACTIVE` and
  `DISAPPROVED` — switched on and not running. Review feedback is kept so a
  rejection can be shown with its reason rather than as a quiet campaign.

### Deliberately local-only

Registered on the stdio server, **not** the hosted one. The account and token come
from the owner's environment, which is single-tenant by construction. The hosted
server gets these once ad accounts are stored per tenant (decision 0005).

515 tests, 13 workspaces typecheck clean.

## 2026-09-30 — One-prompt campaigns: variants, shapes, skills built in

Owner's goal: *"the user just says run my lead generation ads, and any AI tool
launches everything through our MCP, the best way possible."* Decision 0006
splits it: **the AI writes, the server knows (playbooks), the server enforces
(code).** No model call of our own — no cost, no key, no vendor imposed.

### Creative, verified against the live API

Up to 5 primary texts, 5 headlines, 5 descriptions, 10 images and 10 videos per
ad (Meta's documented `asset_feed_spec` limits, enforced as errors). Files carry
an aspect ratio and each placement is served the shape that fits.

Three rules found only by being refused, now tests:

1. **Text variants and placement-specific files cannot share a creative** —
   *"Multiple bodies assets cannot be applied to rule no. 1"*. An ad asking for
   both is split into one ad per text, each keeping every shape.
2. **`standard_enhancements` is deprecated and refused.** Enhancements are
   named individually. Read back from Meta: **all ~85 report `OPT_OUT`**.
3. **A 1:1 supplied beside a 4:5 was uploaded and never served.** Found only by
   reading the creative back; it now gets the square placements.

Also: video upload with processing polling and a chosen or preferred
thumbnail (100 MB cap until chunked upload); instant-form leads needing no pixel
or landing page; long copy no longer treated as the problem, only where the hook
sits. Creatives can be created and previewed standalone, which is how all of
this was tested without leaving more half-built campaigns.

### Skills built in — Meta, Google, TikTok

Researched, licence-checked, and saved to `reference/ad-skills/` at pinned
commits (59 files, MIT and Apache-2.0) so it is never re-researched. Our own
playbooks in `source/apps/mcp/playbooks/`, served on **both** servers three ways
— resources, prompts (`launch_meta_campaign`, `write_ad_copy`), and a
`get_playbook` tool, because tools are the one thing every client supports.

Left out on purpose: an unlicensed repo, and third-party advice to use a VPN to
sign up to TikTok from an unsupported country.

Google and TikTok playbooks state up front that **this server cannot launch
those platforms yet**, so an AI plans and writes for them but never claims a
campaign exists.

### Budgets — and a conflict in the owner's own limits

Set: PKR 1,000–10,000/day, PKR 100,000/month, and a new **daily minimum**.

Testing them found the ceilings inconsistent for open-ended campaigns: 10,000 a
day left running is 300,000 a month, so the effective always-on ceiling is
~3,333/day. Also found our side assumed every campaign runs 30 days. **The
monthly check now uses the real duration**, so a 7-day campaign at 10,000/day
(70,000 total) is allowed and an open-ended one is not.

### Two misleading lines in the approval summary, fixed

The figure a person approves on has to be the real one:

- A two-week campaign was summarised as *"roughly 150,000 per month"*. It now
  says *"runs about 14 days: roughly 70,000 in total"*.
- Every approval said *"This is public and cannot be undone"* — true of
  publishing, false of a paused campaign. The sentence now comes from the
  action's policy.

Verified by driving the real stdio server: resources, prompts, `get_playbook`,
a 5-text / 3-shape plan reviewed as 5 ads, a below-minimum budget refused, and
the approval request — stopping there, since approving is the owner's.

547 tests, 13 workspaces typecheck clean.

## 2026-09-30 — The Meta gaps, closed

Owner: *"I want them built first … we don't want anything left behind."* Every
item listed as not built for Meta, except image generation, which needs a
provider decision.

| Built | Verified live |
|---|---|
| **Preview of the real ad**, without creating it (`generatepreviews`) | Feed, Instagram Feed and Stories links for both single-shape and three-shape ads |
| Preview **inside the approval** for `create_ad_plan` | Shown in the approval message from the real server |
| **Performance reading** with suggestions (`get_ad_performance`) | Live call succeeds; the campaign has never run so reports nothing, as expected |
| **Instant forms from a prompt** (`create_lead_form`) | Form `1854997695681367` created on the Page, read back ACTIVE with Higher Intent on; a lead creative using it accepted |
| **Chunked video upload**, streamed from disk, up to 4 GB | `Day 2.mp4` uploaded in chunks and accepted in 41 s including processing |

Details worth keeping:

- **The preview shows the ad that will exist, not the one requested.** A request
  with five texts and three shapes becomes five ads; previewing the request
  would render an ad nobody sees. Caught in the live output and fixed.
- **Performance suggests, never acts.** Enough data means ~3× the target cost
  spent; without a target no cost verdict is given at all, because there is
  nothing honest to compare against.
- **Forms act with the Page's own token**, fetched with the system user's. Higher
  Intent by default; more than three custom questions refused; https privacy
  policy required.
- **One video path, always chunked.** The small-file shortcut held the whole file
  in memory; Meta names each next byte range, and a stalled server cannot loop
  forever.

Clutter left in the sandbox and on the Page, for the owner: one test lead form
(`AdsPilot test form - safe to archive`) and several standalone creatives. None
public, none spending.

Also, at the owner's decision: the TikTok VPN note is back in the playbook,
stated with its risk and the safer alternative.

564 tests, 13 workspaces typecheck clean.

## Verified live, not just tested

| What | How it was proven |
|---|---|
| LinkedIn authorisation | Connected 2026-09-26; person URN stored; visible in `pnpm status` |
| LinkedIn publishing | Real post published 2026-09-26 through the approval gate, `urn:li:share:7509614451189239808` |
| Little-text escaping | Same post: text with `(` `)` survived intact, escaped `#` rendered as a clean hashtag |
| Meta ad campaign, end to end | Campaign, ad set, 3 creatives, 3 ads created PAUSED and read back from Meta 2026-09-30 |
| LinkedIn image upload | Real image post 2026-09-26, `urn:li:share:7509616982338461696` — the two-step upload works |
| LinkedIn VIDEO upload | Real video post 2026-09-26, `urn:li:ugcPost:7509704322323222529` — chunked upload, ETags and finalize all work against the live API |
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
