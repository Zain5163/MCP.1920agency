# What is built today

**Updated 2026-10-02.** This file lists only what exists now. Everything planned
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
| Facebook Page | ✅ | Text, images, video; 4 real posts on 1920 Agency |
| Instagram | ✅ | 2 real posts |
| LinkedIn personal profile | ✅ | Text, image and video posts, all proven 2026-09-26 |
| LinkedIn company page | ⏸ | Waiting on LinkedIn's approval |
| Threads, Pinterest | 🟡 | Code built; no credentials yet. Pinterest Trial access shows pins only to the owner |
| Google Business Profile, YouTube, TikTok, X | not built | See `FUTURE-PLANS.md` |

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
| Performance reading with suggestions (spend, results, cost, frequency, CTR) | ✅ No ROAS or breakdowns yet |
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
| Tests | ✅ 613 passing, 13 workspaces typecheck clean |

## 6. Automations running on this PC

| Task | When | What |
|---|---|---|
| `AdsPilot-Worker` | every 5 min | Publishes scheduled posts |
| `AdsPilot-Refresh` / `AdsPilot-Monitor` | daily | Renews tokens, warns on problems |
| `Social-Publisher-Keepalive` | Sundays | Stops the free database pausing |
| `LinkedIn-Content-Drafts` | 07:00 daily | Writes LinkedIn drafts. **Never posts**; the owner approves each one with `approve-linkedin-posts.cmd` (in `AI-Automation\LinkedIn-Content-Ops`) |

They run only while this PC is on.

## 7. Content and research done

- LinkedIn strategy, 14-day calendar and 18 drafts (2–8 October), in
  `Marketing-and-Content\LinkedIn-Content-System`.
- Research: competitors, product name, Google suite, Conversions API,
  personal-profile posting, LinkedIn (`research/`).
- Google suite plan with the owner's checklist (`architecture/google-suite-plan.md`).
- Decisions 0001–0008 (`decisions/`).

---

## Known gaps in what is built

- Every Facebook/Instagram limit is checked; other platforms' limits are from
  documentation, not tested live.
- `get_ad_performance` has no revenue, ROAS, breakdowns or trends.
- Facebook Pages: posting only. No comments, inbox or insights yet.
- Ads tools work only on the owner's own account (single-tenant by design until
  per-customer ad accounts exist).
- Everything runs only while this PC is on.
