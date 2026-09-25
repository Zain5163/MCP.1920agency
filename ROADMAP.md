# AdsPilot — build order

Everything from `IDEAS.md`, ranked by **what depends on what** rather than by how
exciting it is. Build bottom-up: each tier assumes the one below it is solid.

Two rules apply at every tier, not just at the end:

1. **No feature is finished until its failures are catalogued.** Every new way to
   fail gets an entry in `packages/core/src/domain/resolutions.ts` with a cause and
   numbered fix steps. The tests enforce it — a thin entry fails the build.
2. **Nothing moves up a tier while the tier below has a known defect.** A missing
   feature is a gap; a broken foundation is a liability.

## Status at a glance

Updated 2026-09-25. **This table is the source of truth for what is done.** Every
item carries a status; nothing is "in progress" without being written here.

| Tier | Item | Status |
|---|---|---|
| 0.1 | Cancel a scheduled post | ✅ done |
| 0.2 | Alert when the scheduler stops | ✅ done |
| 0.3 | Verify platform limits | ✅ done — Facebook and Instagram only |
| 0.4 | Rotate the exposed password | ✅ done |
| 0.5 | Lock down the Data API / RLS | ✅ done — found a live exposure |
| 1.1 | Adapter framework | ✅ **done.** Publishing and account discovery are both decoupled, enforced by an architecture test that scans the source. A `Provider` interface covers authorisation and discovery; `MetaProvider` implements it. Adding a platform is one provider + one adapter + one capability record. |
| 1.2 | Connect several accounts **from one authorisation** | ✅ done — e.g. five Facebook Pages from one Meta login, connected in the dashboard. **This is NOT "all platforms"** — see the platform track below. |
| 1.3 | Account types beyond Pages | ⬜ not started |
| 1.4 | Reconnect reusing authorisation | ✅ done — daily refresh task renews expiring authorisations; monitor warns before expiry and after; disconnect/re-enable from the Accounts page |
| 1.5 | Plan / entitlement model | 🔵 **next** — last item in tier 1 |
| 2.1 | Carousels in the UI | ✅ done — ordered picker with thumbnails, reorder and per-platform limits |
| 2.2 | Platform preview | ✅ done — per-platform tabs showing truncation and crop, driven by capability data not platform names |
| 2.3 | Per-platform text in the UI | ✅ done — opt-in per platform, blank means use the shared text |
| 2.4 | Retry a failed target | ✅ done — **tier 2 complete** |
| 3.x | Analytics and charts | ⬜ not started — needs new permissions |
| 4.x | AI captions and optimisation | ⬜ not started |
| 5.x | More platforms, CMS | ⬜ not started |
| 5b.x | Paid advertising | ⬜ not started |
| 6.1 | Design system | ⬜ not started — gate with research first |

**Ordering change, recorded 2026-09-25.** The owner observed that the dashboard had
not visibly changed despite tier 0 being complete — correctly, since tier 0 and 1
are infrastructure. Agreed order is now: **1.2, then tier 2 (carousels and
preview), then back to 1.1 and 1.3–1.5.**

This bends the bottom-up rule deliberately, and the reason it is safe: the
genuinely load-bearing parts — tenant scoping, the adapter contract, the
entitlement *model* — are either done or a single column. What remains in tier 1
is additive, not structural.

## Platform track — the separate thing

Adding a **platform** is different work from connecting several accounts within
one. This table is the honest state of each, and it is deliberately separate so
"multiple accounts" can never again be read as "all platforms".

Every platform has two costs. **Build** is the adapter and provider — that is
mine and it is now fast, because the framework holds. **Access** is approval,
audit or money — that is the owner's, it cannot be hurried, and for several
platforms it takes weeks.

**The approvals should start now, in parallel**, because they are the long pole.

| Platform | Build | Access needed | Status |
|---|---|---|---|
| Facebook Pages | ✅ | none beyond the app | **publishing** |
| Instagram | ✅ | none beyond the app | **publishing** |
| Threads | ✅ | Meta app with the Threads use case — **no review** | waiting on app config |
| **Pinterest** | ✅ | ⚠️ **Trial access = sandbox.** Pins are visible only to you until Standard Access, which needs a submitted video | adapter built, awaiting app credentials |
| **LinkedIn** | ✅ | Personal profile: self-serve "Share on LinkedIn", **no review**. Company pages need Community Management API approval, granted sparingly | adapter built, awaiting app credentials |
| **YouTube** | ⬜ | ⚠️ Audit for quota. Default is ~6 uploads/day **shared across all customers** | not started |
| **TikTok** | ⬜ | ⚠️ Audit. **Until it passes, posts are private/self-only** | not started |
| **X** | ⬜ | ⚠️ **Costs money** — pay-per-use, ~$0.20 per post containing a link | not started |

Two of these carry consequences worth deciding before building, not after:

- **YouTube's quota is per project, not per customer.** 10,000 units a day at
  1,600 per upload is about six uploads *in total*, until an audit raises it.
- **X is the only platform that costs per post.** At ~$0.20 for a post with a
  link, a customer posting daily costs about $6/month on X alone — which is why
  the pricing model was set to bring-your-own-key.

### ⚠️ The blocker all three new platforms share: there is no way to authorise them

Threads, Pinterest and LinkedIn all have a working adapter **and** a working
provider — but `pnpm connect` still only knows how to run Meta's OAuth dialog.
Account *discovery* is fully provider-driven; account *authorisation* is not.

So the honest state is: three platforms can publish, and nobody can connect them.
That is one generic `pnpm connect <provider>` command — build an auth URL from the
named provider, catch the callback, store the authorisation — and it unblocks
every platform at once rather than one at a time. **It is now worth more than the
next adapter**, and it is the next thing to build.

---

## Tier 0 — Fix what is already broken

_Nothing new should be built on top of a known defect._

| # | Item | Why it is tier 0 |
|---|---|---|
| ~~0.1~~ | ~~**Cancel a scheduled post from the dashboard**~~ **DONE 2026-09-25** | A post scheduled by mistake **will publish**. The capability exists in the MCP server and data layer; the UI has no button. This is unrecoverable once it fires. |
| ~~0.2~~ | ~~**Alert when the scheduler stops**~~ **DONE 2026-09-25** | A silent worker looks identical to an empty queue. Every scheduled post fails silently and nobody finds out. |
| ~~0.3~~ | ~~**Verify platform limits against live docs**~~ **DONE 2026-09-25** | Facebook and Instagram verified. Found three errors: Instagram's rate limit is **100/24h not 50**, aspect ratio must be **4:5 to 1.91:1** and was not checked at all, and the docs say **JPEG only** though PNG demonstrably works. Other platforms remain `verified: false` until used. |
| ~~0.4~~ | ~~**Rotate the exposed database password**~~ **DONE 2026-09-25** | Rotated by the owner; connection verified afterwards. |
| ~~0.5~~ | ~~**Postgres RLS behind the app-layer scoping**~~ **DONE 2026-09-25** | **Found a live critical hole while doing it:** `anon` and `authenticated` had full read/write on every table, including encrypted credentials, password hashes and token hashes — and the `anon` key is public by design. Grants revoked, RLS enabled on all 13 tables. |

---

## Tier 1 — The account layer

_Everything above multiplies by the number of connected accounts. Getting this
wrong makes every later feature wrong in the same way._

| # | Item | Why here |
|---|---|---|
| 1.1 | **A platform adapter framework that makes adding a platform cheap** | **The real foundation for "any social media that exists".** Adding a platform should mean writing one adapter and one capability record — no changes to the UI, the queue, the vault or the publisher. Mostly true already; the remaining coupling needs finding and removing before a dozen platforms expose it. |
| 1.2 | **Connect multiple accounts from the dashboard and from the AI** | One Meta login often administers several Pages and businesses. Today only one is linked and adding another means a command. Everything else is multiplied by this. |
| 1.3 | **Account types beyond Pages** | Personal profiles, groups, channels, company pages. LinkedIn matters most — senior people post from their personal profile, and that is a different target type, not a different platform. |
| 1.5 | **Plan and entitlement model** | Free / paid tiers, e.g. one flat plan at ~$20 covering everything. **Belongs here, not at billing time.** Entitlements are like `tenant_id`: one column now, a rewrite later. Every feature that will ever be gated needs something to ask, and features built before that exists get gating bolted on inconsistently. Billing itself can come much later — the *model* cannot. |
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
| 5.1a | **Threads** | 🟡 adapter and provider built and tested; needs a Meta app with the Threads use case and its own credentials before it can publish. **Correction:** this was estimated as nearly free because "it is Meta" — wrong. Threads has its own host, OAuth, scopes and token lifecycle. |
| 5.1 | **More social platforms** | LinkedIn, X, TikTok, YouTube, Threads, Pinterest, and whatever comes next. Each is an adapter plus a capability record. Approval difficulty varies enormously — TikTok and LinkedIn company pages are the hard ones. |
| 5.2 | **Websites and CMS** | WordPress, Shopify, custom sites. A new **category**, not another social adapter: different auth, different content shape, different success criteria. |
| 5.3 | **Email marketing** | Explicitly deferred by the owner. Recorded so it is not lost. |

---

## Tier 5b — Paid advertising

_Added 2026-09-25. Publish and manage **ads**, not just organic posts: Meta, Google,
TikTok, Amazon, and others._

| # | Item | Notes |
|---|---|---|
| 5b.0 | **Merge `Meta-Ads-Publisher` into this MCP server** | Owner's decision, 2026-09-25: do not rebuild. That project is already account-agnostic, validated, and publishes paused. The work is porting its Python publishing logic into an adapter behind this engine's interfaces, so ads inherit the vault, tenant scoping, audit log and error catalogue rather than carrying their own. |
| 5b.1 | **Meta Ads** | `..\..\Meta-Ads-Publisher` already exists, is account-agnostic, and publishes paused with a separate activation step. **Connect it rather than rebuild it.** Its API version is pinned at v23.0 and needs bumping to v25.0. |
| 5b.2 | **Google Ads** | Per the inherited access research, the easiest of the majors: ~2–4 weeks for Basic access, gated on brand verification of the GCP project. |
| 5b.3 | **TikTok Ads** | Audit plus business verification. 3–8 weeks. |
| 5b.4 | **Amazon Ads** | Marginal for a solo developer — the Tool Provider path needs Partner Network vetting. Weeks to months. |

**Why ads are a tier of their own, not more adapters.**

Organic publishing and paid advertising look similar and are not. Three differences
decide the design:

1. **Ads spend money.** A bug in organic publishing posts the wrong caption. A bug
   in ads publishing spends real budget. `Meta-Ads-Publisher` already answers this
   correctly — it publishes everything **paused**, and activation is a separate
   command requiring the literal word `ACTIVATE`. That pattern should hold here.
2. **The object model is deeper.** A post is content plus targets. An ad is
   campaign → ad set → creative → ad, with budgets, schedules, audiences and
   objectives. It does not fit `PostDraft` and should not be forced to.
3. **Approval is harder and slower.** Ads permissions are a different, stricter
   review than publishing permissions on every platform.

**Prerequisite:** the money-safety rules need to exist before any ads code —
mandatory paused creation, explicit activation, a spend ceiling, and an audit entry
for anything that could cost money. Those belong in the deterministic layer, never
in an AI decision. This is the single place where the "AI proposes, a deterministic
validator authorises" principle from `..\..\Ads-Platform` matters most.

_Sits at 5b rather than earlier because it inherits everything below it — accounts,
scheduling, error handling, tenant isolation, audit. Building it before those are
solid would mean building the riskiest feature on the weakest foundation._

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
