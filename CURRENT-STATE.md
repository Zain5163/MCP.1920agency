# What is built today

**Updated 2026-10-08.** This file lists only what exists now. Everything planned
is in `FUTURE-PLANS.md`. The history of how each piece was built and proven is in
`PROJECT-LOG.md`.

Three levels, kept apart on purpose:

- ✅ **Verified live**: proven against the real platform, with the proof in `PROJECT-LOG.md`.
- 🟡 **Built, not yet proven live**: code and tests exist, waiting on credentials or a real run.
- ⏸ **Blocked**: built or ready, waiting on someone else (see `WAITING-LIST.md`).

Working name: **AdsPilot**. It is being renamed because the name is taken (see
`research/2026-10-01-product-name.md`).

---

## 1. Social media posting

| Platform | State | Notes |
|---|---|---|
| Facebook Page | ✅ token restored 2026-10-02 | 4 real posts earlier. Reconnected with all permissions; 35 Pages connected. Posting not re-proven yet: switch the Meta app back to Live first |
| Instagram | ✅ token restored 2026-10-02 | 2 real posts earlier; 21 accounts connected |
| LinkedIn personal profile | ✅ | Text, image and video posts proven 2026-09-26, published at once. Scheduled text proven 2026-10-02: the first of 11 queued posts went out unattended at 15:30:11 PKT (`urn:li:share:7511734273188626432`) |
| LinkedIn scheduled image posts | 🟡 | Built and unit-tested only. The CLI puts the image in the media bucket when the post is scheduled, and the worker sends it to LinkedIn at the slot. Never run end to end; the LinkedIn approval script schedules image drafts this way |
| LinkedIn document posts (PDF carousels) | 🟡 2026-10-02 | Built and unit-tested only, checked against LinkedIn's docs (`research/2026-10-02-linkedin-documents.md`). `post --document <pdf> --title "..."`; the approval script can schedule the week-1 carousels with it (none approved yet). When LinkedIn will not say whether the PDF finished processing, the post still goes out but carries a notice to check that its pages show. No document has been posted for real; a scheduled one also needs the media bucket to accept PDFs (unchecked) |
| LinkedIn company page | ⏸ | Waiting on LinkedIn's approval |
| Threads, Pinterest | 🟡 | Code built; no credentials yet. Pinterest Trial access shows pins only to the owner |
| YouTube (Google connection) | 🟡 2026-10-02 | Built and unit-tested only: Google sign-in, resumable upload, title and AI disclosure, plus the fixes agreed in the 2026-10-02 review (`architecture/2026-10-02-review-findings.md`). Never connected or uploaded for real; needs the owner's Google Cloud steps (`SETUP.md` §8). Uploads stay private, and are reported as private, until the YouTube API audit passes. An upload taking over about an hour needs its own live test (`SETUP.md` §8) |
| Google Business Profile, TikTok, X | not built | See `FUTURE-PLANS.md` |

Around the posting:

| | State |
|---|---|
| Scheduling (worker runs every 5 minutes, retries with backoff) | ✅ |
| Cancel a scheduled post | ✅ |
| Media upload to storage | ✅ |
| Approval token before anything public | ✅ |
| Carousels, per-platform text, preview, retry a failed target (dashboard) | ✅ |
| Several accounts from one login (e.g. five Facebook Pages) | ✅ |
| Daily token refresh and expiry warnings | ✅ |
| Monitor asks Meta whether each Facebook/Instagram token still works (2026-10-02) | ✅ Caught both dead connections on its first run |
| Facebook Page management: comments, reviews, Messenger, insights | ✅ Read live on 1920 Agency 2026-10-02 |
| Replying to comments and messages, hiding, deleting | 🟡 Built and tested; not used live yet |
| Several accounts on one platform must be named before posting (`accounts`) | ✅ 2026-10-02 |

## 2. Meta ads

| | State |
|---|---|
| Plan → check → preview → create paused → approve → activate → read results | ✅ First real campaign ran on "1920Agency 10" at PKR 500/day (2026-09-30), Meta approved the ad; the owner paused it 2026-10-01 |
| Up to 5 texts, 5 headlines, 5 descriptions per ad, rotated by Meta | ✅ |
| Image and video ads, every shape (1:1, 4:5, 9:16, 1.91:1), served per placement | ✅ |
| Videos up to 4 GB, uploaded in chunks | ✅ |
| Instant lead forms, created from the AI | ✅ |
| Real previews of the ad before it exists | ✅ |
| Website pixel on every ad, whatever the goal | ✅ Fixed 2026-09-30 after the owner spotted it |
| Spend ceilings: PKR 10,000/day, 300,000/month, minimum 500 (owner's) | ✅ Refuses to spend if no ceiling is set |
| Performance reading with suggestions (spend, results, cost, frequency, CTR) | ✅ |
| **Performance team** (2026-10-02): analyst with ROAS, placements, age/gender, period vs period, scale/keep/cut/wait per ad; auditor; budget, on/off and placement changes behind approval | ✅ Reading verified live on the owner's account; the change tools are tested but have not been used on a real ad yet |
| `meta-performance` playbook and `review_meta_account` workflow (five roles) | ✅ |
| Activity log: who changed what and when (`get_ad_activity`) | ✅ Verified live 2026-10-02 |
| Traffic campaigns optimise for landing page views when a pixel exists | 🟡 Built and tested; not yet created on a real account |
| Meta's AI enhancements off by default | ✅ |
| Account setup check: Page, business, ad account, payment, pixel, pixel firing | ✅ Verified read-only on the owner's account |
| Create business, ad account, pixel for someone new | 🟡 Built with approval; never run for real |
| Pause a campaign at once, no approval needed | ✅ |

## 3. Expertise served to any AI

| | State |
|---|---|
| Connection instructions telling every AI to read the playbook first and apply it | ✅ |
| Playbooks with a section per goal: Meta, Google, Microsoft, TikTok, Snapchat, Pinterest, LinkedIn, X, Reddit, Amazon, Telegram | ✅ Only Meta can launch from the server; the rest are planning and copy |
| Stale-playbook warning after 90 days | ✅ |
| 50 marketing skills (copywriting, SEO, CRO, pricing, launch…) | ✅ MIT-licensed, pinned |
| Prompts: launch a Meta campaign, write ad copy | ✅ |

## 4. AI image generation

| | State |
|---|---|
| `generate_ad_images` via OpenRouter, 1:1, 4:5, 9:16, cost recorded per image | 🟡 Key works and the daily cap is $2, but the OpenRouter account has **$0 credit** |

## 5. Platform underneath

| | State |
|---|---|
| MCP server: local (all tools) and hosted (posting, playbooks, skills; per-user tokens) | ✅ |
| Web dashboard (Next.js), CLI, worker | ✅ |
| Encrypted credential vault, tenant isolation, owner/admin roles, login | ✅ |
| Error catalogue: every error says why and how to fix it | ✅ |
| Audit log of every action | ✅ |
| Database lockdown (RLS on all tables) | ✅ |
| Free and Premium plans, usage metering on every MCP tool, `check_usage` and `upgrade` (decision 0009) | ✅ 2026-10-08 Live: migration applied (owner approved), live SQL test 6/6, owner's tenant on Premium, `check_usage` verified after the MCP restart. Upgrade link waits for Polar. See `architecture/2026-10-08-plans-usage-analytics-hosting.md` "Phase 1 status" |
| Call log (`tool_calls`: tool, ok/error code, duration, AI client, transport; never content) | ✅ Live 2026-10-08: calls recorded (verified via `check_usage`) |
| Product analytics to PostHog Cloud EU: `mcp_call`, `limit_reached`, `limit_notice_shown`, `upgrade_clicked`, `publish_failed` (Phase 2) | ✅ 2026-10-08 Live: owner saw `mcp_call` with plan premium and industry agency in PostHog EU. Connect/signup events wait for Phase 4 |
| Connect and signup events (`connect_*`, `signup`) | ⬜ Not built: three separate connect flows and no signup yet; to be emitted from Phase 4's single connect service |
| Hosting on the Hetzner server (Phase 3): hosted MCP at `mcp.1920agency.com`, worker as a loop, timers, nightly encrypted backups, optional Postgres (decision 0010) | ✅ 2026-10-09 **Stage A complete**: hosted MCP, worker and all timers run on the server (posts published by the server since 08 Oct, 0 failed); PC tasks disabled; nightly encrypted backups (database + store backups) with PC copies and a proven restore. Stage B (database onto the server) not started |
| Industry categories (dentist, education, real_estate, ecommerce, tool_website, agency, other) | ✅ 2026-10-08 Live: column `tenants.industry` (migration 20261008160000, owner-approved, live SQL test 10/10), free tool `set_business_type` (the AI asks, never guesses), carried on every analytics event once set |
| Tests | ✅ 827 passing on 2026-10-03 in the eight suites that need no database (after the package-side review fixes); 13 workspaces typecheck clean. The auth and db suites (89 more at their last run, 2026-10-02) use the live database, so they are run only at quiet times until they have a test database (`FUTURE-PLANS.md`) |

## 6. Automations running on this PC

| Task | When | What |
|---|---|---|
| `AdsPilot-Worker` | every 5 min | Publishes scheduled posts. Windows stops a run after 30 minutes, and the task does not wake the PC |
| `AdsPilot-Refresh` / `AdsPilot-Monitor` | daily | Renews tokens, warns on problems |
| `Social-Publisher-Keepalive` | Sundays | Stops the free database pausing |
| `LinkedIn-Content-Drafts` | 07:00 daily | Writes LinkedIn drafts. **Never posts**; the owner approves each one with `approve-linkedin-posts.cmd` (in `AI-Automation\LinkedIn-Content-Ops`) |

They run only while this PC is on.

## 7. Content and research done

- LinkedIn strategy, 14-day calendar and 18 drafts (2–8 October), in
  `Marketing-and-Content\LinkedIn-Content-System`. 11 text posts were approved and
  queued on 2026-10-02 and the first went out that day; 7 are still drafts (that
  folder's `PROJECT-CONTEXT.md` says why).
- Research: competitors, product name, Google suite, Conversions API,
  personal-profile posting, LinkedIn, LinkedIn documents, YouTube API facts,
  Meta's official MCPs (`research/`).
- Google suite plan with the owner's checklist (`architecture/google-suite-plan.md`).
- The YouTube and LinkedIn-documents build spec, and its review with the fix agreed
  for each finding (`architecture/2026-10-02-*.md`).
- Decisions 0001–0008 (`decisions/`).

---

## Known gaps in what is built

- Every Facebook/Instagram limit is checked; other platforms' limits are from
  documentation, not tested live.
- Ads tools work only on the owner's own account (single-tenant by design until
  per-customer ad accounts exist).
- Everything runs only while this PC is on.
- A scheduled upload that takes more than 30 minutes cannot finish: Windows stops
  the worker's run and the job starts over from the beginning (`SETUP.md` §8).
  Very large videos are published now instead.
- If the Google OAuth client's secret is changed or the client is deleted, every
  Google refresh fails (`invalid_client`, `deleted_client`), and the vault marks
  each YouTube channel as needing reconnection when it next refreshes, although
  fixing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` would be enough. The
  2026-10-02 review's fixes do not cover this.
