# AdsPilot — build order

Everything from `IDEAS.md`, ranked by **what depends on what** rather than by how
exciting it is. Build bottom-up: each tier assumes the one below it is solid.

Two rules apply at every tier, not just at the end:

1. **No feature is finished until its failures are catalogued.** Every new way to
   fail gets an entry in `packages/core/src/domain/resolutions.ts` with a cause and
   numbered fix steps. The tests enforce it — a thin entry fails the build.
2. **Nothing moves up a tier while the tier below has a known defect.** A missing
   feature is a gap; a broken foundation is a liability.

---

## Tier 0 — Fix what is already broken

_Nothing new should be built on top of a known defect._

| # | Item | Why it is tier 0 |
|---|---|---|
| 0.1 | **Cancel/edit a scheduled post from the dashboard** | A post scheduled by mistake **will publish**. The capability exists in the MCP server and data layer; the UI has no button. This is unrecoverable once it fires. |
| 0.2 | **Alert when the scheduler stops** | A silent worker looks identical to an empty queue. Every scheduled post fails silently and nobody finds out. |
| 0.3 | **Verify platform limits against live docs** | Every entry in `capabilities.ts` is `verified: false` — set from knowledge, not checked. A wrong limit is a confusing publish failure. |
| 0.4 | **Rotate the exposed database password** | Pasted into a chat transcript on 2026-09-24. |
| 0.5 | **Postgres RLS behind the app-layer scoping** | Defence in depth. Application scoping is tested and correct; RLS catches the case where a future query bypasses it. |

---

## Tier 1 — The account layer

_Everything above multiplies by the number of connected accounts. Getting this
wrong makes every later feature wrong in the same way._

| # | Item | Why here |
|---|---|---|
| 1.1 | **A platform adapter framework that makes adding a platform cheap** | **The real foundation for "any social media that exists".** Adding a platform should mean writing one adapter and one capability record — no changes to the UI, the queue, the vault or the publisher. Mostly true already; the remaining coupling needs finding and removing before a dozen platforms expose it. |
| 1.2 | **Connect multiple accounts from the dashboard and from the AI** | One Meta login often administers several Pages and businesses. Today only one is linked and adding another means a command. Everything else is multiplied by this. |
| 1.3 | **Account types beyond Pages** | Personal profiles, groups, channels, company pages. LinkedIn matters most — senior people post from their personal profile, and that is a different target type, not a different platform. |
| 1.4 | **Reconnect flow that reuses existing authorisation** | A token going stale must not mean starting from scratch. Already half-built: connections are marked `needs_reauth`, but nothing acts on it. |

---

## Tier 2 — The compose loop

_The thing people actually use every day. Worth being excellent before anything
clever is layered on._

| # | Item | Why here |
|---|---|---|
| 2.1 | **Carousels in the UI** | Selection order = card order, each file shown separately, count visible. The adapters already build carousels correctly; this is interface only. |
| 2.2 | **Platform preview** | Catches what validation cannot: bad truncation, wrong crop, a logo under an overlay. Depends on 2.1 — previewing a carousel needs carousels to exist. |
| 2.3 | **Per-platform text overrides in the UI** | Already in the engine (`overrides`), unreachable from the dashboard. One caption per platform, rather than the strictest limit governing all. |
| 2.4 | **Retry a failed target by hand** | A permanent failure currently needs the whole post recreating. |

---

## Tier 3 — Knowing what happened

_Only meaningful once there are several accounts and a steady flow of posts._

| # | Item | Why here |
|---|---|---|
| 3.1 | **User-facing activity log in the dashboard** | Users see what they did. Separate from internal telemetry — an ops log in front of a customer is an information leak. |
| 3.2 | **Performance data: likes, comments, clicks, impressions, CTR** | ⚠️ Needs **read** permissions, which are a different scope from publishing and need their own App Review for other people's accounts. Start that paperwork early even if the feature lands later. |
| 3.3 | **Ranking and charts across platforms** | Depends entirely on 3.2. |

---

## Tier 4 — Intelligence

_Deliberately above the compose loop. If the basics are shaky, AI output makes it
worse, not better._

| # | Item | Why here |
|---|---|---|
| 4.1 | **Caption from an image, with a rewrite button** | Build both together. Caption-generation alone invites publishing whatever the model produced first; rewrite is what makes it usable. **This is the cheap test of whether AI content is good enough here at all** — do it before committing to 4.2–4.4. |
| 4.2 | **Per-platform algorithm optimisation** | Rework one idea for what each platform rewards. |
| 4.3 | **Trending topic suggestions** | Start from a live topic rather than a blank box. |
| 4.4 | **Article and blog writing** | Long-form. Also the prerequisite for tier 5 CMS publishing being useful. |

---

## Tier 5 — Reach

_Cheap once tier 1.1 is genuinely solid. Expensive if it is not._

| # | Item | Notes |
|---|---|---|
| 5.1 | **More social platforms** | LinkedIn, X, TikTok, YouTube, Threads, Pinterest, and whatever comes next. Each is an adapter plus a capability record. Approval difficulty varies enormously — TikTok and LinkedIn company pages are the hard ones. |
| 5.2 | **Websites and CMS** | WordPress, Shopify, custom sites. A new **category**, not another social adapter: different auth, different content shape, different success criteria. |
| 5.3 | **Email marketing** | Explicitly deferred by the owner. Recorded so it is not lost. |

---

## Tier 6 — Design system

| # | Item | Notes |
|---|---|---|
| 6.1 | **Per-client AI design system, shipped as MCP skills** | The largest item by a wide margin: brand extraction, templating, rendering, quality control. A product in itself. **Gate it with research before any code**, the way `Ads-Platform` was gated — including permission to conclude "not worth it". |

---

## Why this order

**The two things that are genuinely foundational are 0.1–0.2 and 1.1–1.2.**

Tier 0 because building on a known defect means the defect ships with everything
after it. Tier 1 because both "any social media in one prompt" and "manage all my
businesses" are the *same* requirement: cheap adapters, and many accounts handled
uniformly. Get that wrong and every later feature is wrong per-platform and
per-account — which is a rewrite, not a fix.

Everything in tiers 2–6 is genuinely optional in a way tiers 0–1 are not. A
carousel UI is a missing feature. A silent scheduler is a liability.

**Most of tier 2 is interface work over machinery that already exists and is
tested** — carousels, overrides and cancellation are all implemented underneath.
That is the payoff from keeping one engine behind several doors, and it is why the
order above front-loads the parts that are hard to change later rather than the
parts that are visible.
