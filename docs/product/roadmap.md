# AdsPilot — roadmap (everything planned, and the build order)

**Merged 2026-10-10** from two root files that both answered "what next":
`FUTURE-PLANS.md` (part 1, everything planned, by area; its text last updated
2026-10-03) and `ROADMAP.md` (part 2, the build order by tier, with its history).
Both are kept in full below; nothing was dropped. Some lines are older than the
live state: where they disagree, `STATUS.md` (at the repo root) is right.

- What is being worked on now and the next five items: `STATUS.md` → "Next up".
- What exists today, built and proven: `docs/product/capabilities.md`.
- Ideas not yet chosen: `docs/product/ideas.md`.
- When an item is built and proven, it moves to `capabilities.md`; when it is
  chosen as one of the next five, it is listed in `STATUS.md`.

---

## Part 1 — What is planned (was FUTURE-PLANS.md)

**Updated 2026-10-03.** Everything here is **not built yet**, apart from a few
items that are built but not yet proven live, which say so. What exists today is
in `docs/product/capabilities.md`. Detail for each item is in part 2 below, the decision
records and the research files named beside it. When an item is built and
proven, it moves to `docs/product/capabilities.md` and out of here.

The aim, in the owner's words: one MCP a business connects once, which replaces a
marketing team. Any AI connected to it works like a top marketer without being
told how.

**Owner's order:** social posting first, then Meta ads, then Google, then
everything else. Nothing lower starts before the item above it works for 1920
Agency's own accounts.

---

### Product foundations, agreed 2026-10-08 (build in this order)

Full plan: `docs/architecture/2026-10-08-plans-usage-analytics-hosting.md`; plans: `docs/decisions/0009-free-and-premium-plans.md`.

0. **Safety:** private GitHub backup (none exists yet); nothing kept only in temp folders.
1. **Plans and usage:** Free 200 MCP calls a month, Premium $9; every call metered and logged; notices at 25/50/75/85/90/95/99% passed on by the user's AI; at 100% the upgrade message.
2. **Analytics:** PostHog Cloud EU + a `tool_calls` table: which tools, which AI client, errors, where users get stuck, by industry.
3. **Hosting on Hetzner** at a 1920agency.com subdomain: hosted MCP and the worker move to the server (posts stop depending on this PC; https OAuth callbacks).
4. **Accounts, checkout and the website** (docs on the Raptor pattern, daily articles and SEO on the SEO-Ops pattern).
5. **Self-improving expertise:** scheduled playbook refresh for every ad platform, tuned per industry from real usage.

### Next, in order

| # | What | Why now | Detail |
|---|---|---|---|
| — | ~~**Facebook Page management**~~ built 2026-10-02 (capabilities.md); was: read and reply to comments and reviews, hide spam, Messenger replies, insights | Owner's Page works without Meta review | part 2, 5b.7 |
| 2 | **Google Business Profile posting** | Owner's priority #1; waiting on Google's access form (up to 14 days) | `docs/architecture/google-suite-plan.md` |
| 3 | **YouTube: prove it live** | Built and unit-tested 2026-10-02 (capabilities.md 🟡), never run for real. Waits on the owner's Google Cloud steps (`SETUP.md` §8), then a first private upload; an upload that takes over about an hour stays unproven until one is tried. Uploads stay private until Google's audit passes | `docs/architecture/2026-10-02-youtube-build-spec.md` |
| 4 | **Search Console and Google Analytics** reads | | `docs/architecture/google-suite-plan.md` |
| 5 | **One-click tracking setup**: Tag Manager, GA4, Google Ads conversions, Search Console verified, events mapped; WordPress fully automatic, others one paste | | same |
| 6 | **Google Ads** with Keyword Planner | Needs Basic access; customer use waits on Google's answer about MCP "proxies" | same, WAITING-LIST #15 |

### Social posting

- Prove live what is built but only unit-tested (capabilities.md 🟡): YouTube,
  LinkedIn document posts and scheduled LinkedIn image posts.
- Google Business Profile: posts, reviews and replies, insights (UK, Europe, Pakistan).
- YouTube beyond upload: analytics (its own consent, later), YouTube's own
  scheduled publish time once the audit passes, and resuming an interrupted upload
  where it stopped rather than from the beginning (needs the upload session stored,
  which is a database change).
- TikTok, X, Threads (credentials), Pinterest (Standard access), LinkedIn company page.
- Comments and inbox management on every platform, not only Facebook.
- Analytics and charts in the dashboard.
- AI captions and per-platform optimisation.

### Meta ads

After comparing with Meta's own MCP servers (docs/research/2026-10-02-meta-official-mcps.md):

- **Signal health**: event match quality and the Conversions API, so the auditor sees weak tracking.
- **WhatsApp inbox and templates**: the owner's ads are mostly WhatsApp conversation campaigns; the same AI should answer the leads they create.
- **A/B tests and conversion lift** with Meta's split-test objects.
- **Webhooks** for new comments and messages, so the Page tools can alert instead of being asked.

- Performance team, next steps: a scheduled weekly review that writes a report
  for approval; creative-level (asset) breakdowns; launching the creative
  strategist's new ads straight from its proposals.
- Competitor ad research from the Ad Library: full data for ads shown in the EU
  and UK; elsewhere the user shares links or screenshots for analysis. "What
  works" inferred from how long an ad runs and how many versions exist.
- Catalog (product feed) ads and messaging ads (WhatsApp, Messenger), which the
  playbook currently says are not built.
- Conversions API alongside the pixel; the Meta pixel installed through the same
  Tag Manager container as Google.
- Reconnect Facebook without switching the app to Development: an https login callback (hosted server or 1920agency.com), and real Terms of Service and data-deletion pages before App Review.
- Serving customers: Meta App Review for business and ads permissions, per-customer
  ad accounts (decision 0005), then the setup tools for people with no account.

### Google

Full plan, phases and the owner's checklist: `docs/architecture/google-suite-plan.md`.
Business Profile → YouTube → Search Console and Analytics → tracking setup →
Google Ads and Keyword Planner. Indexing requests are limited by Google to job and
livestream pages; Search Console sitemaps and inspection are used instead.

### Other ad networks

Microsoft, TikTok, LinkedIn (access granted), Amazon, Snapchat, Pinterest, X,
Reddit, Telegram. Each playbook is already written; each needs its own developer
approval and adapter. Rule: no platform launches without its playbook (decision 0008).

### The whole marketing MCP

- SEO: keywords, rank tracking, backlinks, site audits, schema (provider data,
  bring-your-own-key or a gateway).
- AI visibility: how a brand shows up in ChatGPT, Claude, Gemini, Perplexity.
- WordPress and other CMS: publish and edit pages and posts.
- Trends, people and company data (needs a data-protection decision first).
- Video editing tools (Premiere, After Effects, DaVinci).
- Slack for approvals and alerts (workspace preference).
- Per-client design system (gated by research first).
- Serve only the playbook section a task needs, to protect the expertise
  (decision 0008).

### Platform underneath

- **A test database for the database tests.** The `auth` and `db` suites run
  against the live Supabase database. On 2026-10-02 running them starved the live
  publisher's connection pool, so until they have a database of their own they are
  left out of routine test runs and run only at quiet times.

### Business and launch

- **Choose the product name**: first choice Mahir, then Hamkar, Markwala. Check
  trademarks, domains and handles first (WAITING-LIST #14).
- **Pricing**: flat $6–7 a month to post everywhere; third-party usage in credits
  at 3× cost; marketing possibly limited by plan; ad spend never marked up
  (decision 0007). Needs a credit ledger and per-customer settings.
- **Website** in the style of TREG and Zernio, with the animated "Turn X into
  [role]" heading and Zernio-style pricing (part 2, "Website").
- **LinkedIn build-in-public**: the 6-week arc from teaser to name reveal,
  waitlist and launch (`Marketing-and-Content\LinkedIn-Content-System\STRATEGY.md`).
  Weekly batch approval or full automation once drafts prove reliable; approval
  in Slack later.
- Run the server somewhere always-on, so nothing depends on this PC being awake.

### Waiting on the owner

The live list is `WAITING-LIST.md`. The main ones: OpenRouter credit, the
Google Cloud OAuth client and access applications, the product name, the
LinkedIn profile update, and reviewing the LinkedIn drafts.

---

## Part 2 — Build order by tier (was ROADMAP.md)

Everything from `docs/product/ideas.md`, ranked by **what depends on what** rather than by how
exciting it is. Build bottom-up: each tier assumes the one below it is solid.

Two rules apply at every tier, not just at the end:

1. **No feature is finished until its failures are catalogued.** Every new way to
   fail gets an entry in `packages/core/src/domain/resolutions.ts` with a cause and
   numbered fix steps. The tests enforce it — a thin entry fails the build.
2. **Nothing moves up a tier while the tier below has a known defect.** A missing
   feature is a gap; a broken foundation is a liability.

### Owner's priorities (set 2026-09-30)

In this order, and nothing further down starts before the item above it is
working for 1920 Agency's own accounts:

1. **Social media automation**: publishing to every connected platform,
   **including Google Business Profile** posts. The owner's reasoning: many
   businesses in Pakistan skip it, but in the UK and Europe it is where local
   customers look first.
2. **Meta ads**: plan, write, create, approve, launch and read results from one
   prompt. *Built and verified against the sandbox on 2026-09-30. It still needs
   one real campaign run end to end.*
3. **Google Ads.**
4. Everything in "The whole marketing MCP" below.

**AI image generation: decided and built 2026-09-30.** OpenRouter, paid per
image, with a daily cap. Needs the owner's OpenRouter key and a daily budget in
the env file. Pricing is in `docs/decisions/0007`.

---

### Status at a glance

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

### Platform track — the separate thing

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
| Facebook *personal profiles* | ❌ | **Impossible.** `publish_actions` was removed in 2018 and never replaced — no approval grants it | will not be built |
| Instagram (via a Facebook Page) | ✅ | none beyond the app | **publishing** |
| Instagram (direct, **no Page needed**) | ✅ | its own Instagram app id and secret | adapter and provider built, awaiting credentials |
| Threads | ✅ | Meta app with the Threads use case — **no review** | waiting on app config |
| **Pinterest** | ✅ | ⚠️ **Trial access = sandbox.** Pins are visible only to you until Standard Access, which needs a submitted video | adapter built, awaiting app credentials |
| **LinkedIn** | ✅ | Personal profile: self-serve, **no review** — done. Company pages need Community Management API, whose request button is **disabled outright** on a verified app | **text, image and video all published live 2026-09-26**; posting as a person — page app awaiting Community Management review |
| **YouTube** | ⬜ | ⚠️ Audit for quota. Default is ~6 uploads/day **shared across all customers** | not started |
| **TikTok** | ⬜ | ⚠️ Audit. **Until it passes, posts are private/self-only** | not started |
| **X** | ⬜ | ⚠️ **Costs money** — pay-per-use, ~$0.20 per post containing a link | not started |

Two of these carry consequences worth deciding before building, not after:

- **YouTube's quota is per project, not per customer.** 10,000 units a day at
  1,600 per upload is about six uploads *in total*, until an audit raises it.
- **X is the only platform that costs per post.** At ~$0.20 for a post with a
  link, a customer posting daily costs about $6/month on X alone — which is why
  the pricing model was set to bring-your-own-key.

#### ~~⚠️ The blocker all three new platforms share: there is no way to authorise them~~ **DONE 2026-09-26**

Closed by `pnpm connect:provider <name>`. `Provider` now covers authorisation as
well as discovery, so the command names no platform. What follows is the original
entry, kept because it explains why the contract changed.



Threads, Pinterest and LinkedIn all have a working adapter **and** a working
provider — but `pnpm connect` still only knows how to run Meta's OAuth dialog.
Account *discovery* is fully provider-driven; account *authorisation* is not.

So the honest state is: three platforms can publish, and nobody can connect them.
That is one generic `pnpm connect <provider>` command — build an auth URL from the
named provider, catch the callback, store the authorisation — and it unblocks
every platform at once rather than one at a time. **It is now worth more than the
next adapter**, and it is the next thing to build.

---

### Tier 0 — Fix what is already broken

_Nothing new should be built on top of a known defect._

| # | Item | Why it is tier 0 |
|---|---|---|
| ~~0.1~~ | ~~**Cancel a scheduled post from the dashboard**~~ **DONE 2026-09-25** | A post scheduled by mistake **will publish**. The capability exists in the MCP server and data layer; the UI has no button. This is unrecoverable once it fires. |
| ~~0.2~~ | ~~**Alert when the scheduler stops**~~ **DONE 2026-09-25** | A silent worker looks identical to an empty queue. Every scheduled post fails silently and nobody finds out. |
| ~~0.3~~ | ~~**Verify platform limits against live docs**~~ **DONE 2026-09-25** | Facebook and Instagram verified. Found three errors: Instagram's rate limit is **100/24h not 50**, aspect ratio must be **4:5 to 1.91:1** and was not checked at all, and the docs say **JPEG only** though PNG demonstrably works. Other platforms remain `verified: false` until used. |
| ~~0.4~~ | ~~**Rotate the exposed database password**~~ **DONE 2026-09-25** | Rotated by the owner; connection verified afterwards. |
| ~~0.5~~ | ~~**Postgres RLS behind the app-layer scoping**~~ **DONE 2026-09-25** | **Found a live critical hole while doing it:** `anon` and `authenticated` had full read/write on every table, including encrypted credentials, password hashes and token hashes — and the `anon` key is public by design. Grants revoked, RLS enabled on all 13 tables. |

---

### Tier 1 — The account layer

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

### Tier 2 — The compose loop

_The thing people actually use every day. Worth being excellent before anything
clever is layered on._

| # | Item | Why here |
|---|---|---|
| 2.1 | **Carousels in the UI** | Selection order = card order, each file shown separately, count visible. The adapters already build carousels correctly; this is interface only. |
| 2.2 | **Platform preview** | Catches what validation cannot: bad truncation, wrong crop, a logo under an overlay. Depends on 2.1 — previewing a carousel needs carousels to exist. |
| 2.3 | **Per-platform text overrides in the UI** | Already in the engine (`overrides`), unreachable from the dashboard. One caption per platform, rather than the strictest limit governing all. |
| 2.4 | **Retry a failed target by hand** | A permanent failure currently needs the whole post recreating. |

---

### Tier 3 — Knowing what happened

_Only meaningful once there are several accounts and a steady flow of posts._

| # | Item | Why here |
|---|---|---|
| 3.1 | **User-facing activity log in the dashboard** | Users see what they did. Separate from internal telemetry — an ops log in front of a customer is an information leak. |
| 3.2 | **Performance data: likes, comments, clicks, impressions, CTR** | ⚠️ Needs **read** permissions, which are a different scope from publishing and need their own App Review for other people's accounts. Start that paperwork early even if the feature lands later. |
| 3.3 | **Ranking and charts across platforms** | Depends entirely on 3.2. |

---

### Tier 4 — Intelligence

_Deliberately above the compose loop. If the basics are shaky, AI output makes it
worse, not better._

| # | Item | Why here |
|---|---|---|
| 4.1 | **Caption from an image, with a rewrite button** | Build both together. Caption-generation alone invites publishing whatever the model produced first; rewrite is what makes it usable. **This is the cheap test of whether AI content is good enough here at all** — do it before committing to 4.2–4.4. |
| 4.2 | **Per-platform algorithm optimisation** | Rework one idea for what each platform rewards. |
| 4.3 | **Trending topic suggestions** | Start from a live topic rather than a blank box. |
| 4.4 | **Article and blog writing** | Long-form. Also the prerequisite for tier 5 CMS publishing being useful. |

---

### Tier 5 — Reach

_Cheap once tier 1.1 is genuinely solid. Expensive if it is not._

| # | Item | Notes |
|---|---|---|
| 5.1a | **Threads** | 🟡 adapter and provider built and tested; needs a Meta app with the Threads use case and its own credentials before it can publish. **Correction:** this was estimated as nearly free because "it is Meta" — wrong. Threads has its own host, OAuth, scopes and token lifecycle. |
| 5.1 | **More social platforms** | LinkedIn, X, TikTok, YouTube, Threads, Pinterest, and whatever comes next. Each is an adapter plus a capability record. Approval difficulty varies enormously — TikTok and LinkedIn company pages are the hard ones. |
| 5.2 | **Websites and CMS** | WordPress, Shopify, custom sites. A new **category**, not another social adapter: different auth, different content shape, different success criteria. |
| 5.3 | **Email marketing** | Explicitly deferred by the owner. Recorded so it is not lost. |

---

### Tier 5b — Paid advertising

_Added 2026-09-25. Publish and manage **ads**, not just organic posts: Meta, Google,
TikTok, Amazon, and others._

| # | Item | Notes |
|---|---|---|
| 5b.0 | **Merge `Meta-Ads-Publisher` into this MCP server** | Owner's decision, 2026-09-25: do not rebuild. That project is already account-agnostic, validated, and publishes paused. The work is porting its Python publishing logic into an adapter behind this engine's interfaces, so ads inherit the vault, tenant scoping, audit log and error catalogue rather than carrying their own. |
| 5b.1 | **Meta Ads** | `..\..\Meta-Ads-Publisher` already exists, is account-agnostic, and publishes paused with a separate activation step. **Connect it rather than rebuild it.** Its API version is pinned at v23.0 and needs bumping to v25.0. |
| 5b.1a | **LinkedIn Ads** | **Advertising API Development Tier GRANTED 2026-09-27** on the personal app. This is the first ads platform with access already in hand, so it is the cheapest place to prove the ads object model — campaign → ad set → creative → ad — against a real API. Standard Tier needs a working implementation first, so building is the path to more access rather than the other way round. |
| 5b.2 | **Google Ads** | **Updated 2026-10-01:** developer tokens were retired 2026-09-09; access levels now sit on the Google Cloud project. Basic needs brand verification (2–3 business days), then is often granted within hours; Keyword Planner needs Basic. **Google's 2026-08-31 policy bans MCP servers that solely re-expose Google Ads to others ('programmatic proxies').** The owner's own accounts are exempt; customer-facing Google Ads waits for Google's written answer. Plan: `docs/architecture/google-suite-plan.md`. |
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

#### 5b.5 — Set up people who have no ad account (owner's request, 2026-09-30)

So a customer with nothing but a Facebook login can still run ads through
AdsPilot. Checked against Meta's documentation on 2026-09-30:

| Needed to run ads | Can AdsPilot create it? | How |
|---|---|---|
| A Facebook user account | **No** — the person makes it themselves | — |
| A Facebook Page | **No** — Meta has no public API for it | Guide them with a direct link, then detect the Page when it exists |
| A business portfolio (Business Manager) | **Yes** | `POST /{user-id}/businesses` (needs `business_management`, and a published Page) |
| An ad account | **Yes, up to 5 per business by API** | `POST /{business-id}/adaccount` with name, currency, time zone, end advertiser |
| A pixel / dataset | **Yes, one per ad account** | `POST /act_{id}/adspixels` with a name |
| A payment method | **No** — card or funding is added in Meta's own screens | Guide them with a link; detect when billing is set, and refuse to activate until it is |
| Pixel on their website | Partly | Give them the code, or install it via the WordPress MCP when that exists |

**BUILT 2026-09-30** (local server): `check_ad_setup` reads what exists and says
what is missing and who does it, including whether the pixel is actually
receiving website events. `create_business`, `create_ad_account` and
`create_pixel` each need their own approval, and their approval says they are
permanent. The Page and payment steps come back as direct links. Verified live
(read-only) on the owner's account: all six steps found. Nothing has been
created with them yet.

**Before it can serve other people:** Meta App Review for `business_management`
and `ads_management` at advanced access, and decision 0005's customer
connection flow. Until then it can only act on the owner's own businesses.

#### 5b.6 — Expert by default, on every ad platform (owner's direction, 2026-09-30)

The aim, in the owner's words: whichever AI a customer connects should work like
a **top media buyer, performance marketer and e-commerce ad manager** without
the customer telling it how. See `docs/decisions/0008`.

- **Done 2026-09-30:** the server now sends connection `instructions` telling
  every AI to read the platform playbook before any ad work and apply it
  unprompted. The Meta playbook gained a section per goal: leads, sales and
  e-commerce, traffic, awareness, messaging, local.
- **Every new ad platform ships with its playbook**, written before or with the
  adapter, never after. **Written 2026-09-30, each with a section per goal:**
  Meta, Google, Microsoft, TikTok, Snapchat, Pinterest, LinkedIn, X, Reddit,
  Amazon, Telegram. Only Meta can be launched from the server; the others are
  planning and copy until their adapters exist.
- **Kept current:** each playbook carries an "Updated" date and its sources. Past
  90 days the server itself puts a warning on top when an AI reads it, telling
  the AI to check the platform's current documentation first. Facts the writers
  could not confirm from official pages are marked "unverified" in the text
  (notably Telegram, X and Reddit, whose help sites would not load).
- **Advice, never control.** Anything that must hold stays in code (decision 0006).

#### 5b.7 — Meta beyond publishing: Pages, competitor research, a performance team (owner, 2026-10-01)

**Facebook Pages.** Today the connection asks only for `pages_show_list`,
`pages_read_engagement`, `pages_manage_posts`: posting works, nothing else.
Possible with more permissions (each needs Meta App Review before customers can
use it; the owner's own Page works now in development mode):

| Feature | Permission |
|---|---|
| Read comments, visitor posts, reviews ("recommendations") | `pages_read_user_content` |
| Reply to, hide, delete comments; reply to reviews | `pages_manage_engagement` |
| Messenger inbox replies (24-hour window rule) | `pages_messaging` |
| Page and post insights | `read_insights` / `pages_read_engagement` |
| Scheduled posts, edit or delete posts | `pages_manage_posts` (already granted) |

Comment replies are public and go through the approval layer; hiding spam can
be lower risk.

**Competitor ad research (Ad Library).** Checked 2026-10-01: the Ad Library API
returns ordinary business ads **only for ads shown in the EU or UK** (with an EU
reach figure, never spend). Everywhere else, including Pakistan and the Gulf, it
returns political and issue ads only; those ads are visible on the website but
not through the API, and scraping it breaks Meta's terms. "Which ads work" is
inferred, never reported: ads running 30+ days, many variants of one idea, and
fresh copies of an old winner are the usual signals of a profitable ad.

**A performance team, not just a playbook.** Today: the playbook knows the
method; `get_ad_performance` reads spend, results, cost per result, frequency
and CTR per ad. Missing for top-level media buying: revenue and **ROAS**
(`action_values`, `purchase_roas`), breakdowns (placement, age, gender,
platform), day-by-day trends for fatigue, account-level audit, and decisions
(scale, cut, reallocate, refresh creative) proposed as approvable actions.
Design: data tools first, then role skills (auditor, analyst, creative
strategist, media buyer, reporter) and a master workflow that runs them in
order. The connected AI plays the roles; clients with sub-agents can run them
in parallel. Every change still goes through approval and the spend ceiling.

---

### Tier 6 — Design system

| # | Item | Notes |
|---|---|---|
| 6.1 | **Per-client AI design system, shipped as MCP skills** | The largest item by a wide margin: brand extraction, templating, rendering, quality control. A product in itself. **Gate it with research before any code**, the way `Ads-Platform` was gated — including permission to conclude "not worth it". |

---

### The whole marketing MCP (later, in the owner's words: "all built in")

_Recorded 2026-09-30 so none of it has to be re-described. Competitor research in
`docs/research/2026-09-30-competitors.md`._

The end state is **one MCP server that a business connects to once and that
replaces a marketing team**: every social platform, every ad network, SEO, the
website, analytics, and the tools a video agency uses. Expertise ships with each
area (see the 50-skill library, already served), and every action that is public
or spends money goes through the approval layer.

| Area | What it means | Notes |
|---|---|---|
| **Google Ads** | Search, Performance Max, YouTube ads | Developer token with Basic access; playbook already written |
| **More ad networks** | Microsoft, TikTok, LinkedIn (access granted), Amazon, Pinterest, Snapchat, X, Telegram | Each needs its own developer approval, and ships with its own playbook (5b.6) |
| **Ad libraries** | Competitor creatives: Meta Ad Library, Google Ads Transparency, TikTok Creative Center, LinkedIn Ad Library (granted) | Read-only; low risk; strong for pitching clients |
| **SEO** | Keyword and rank tracking, backlinks and authority, site audits, schema | Data comes from providers (DataForSEO, Semrush, Moz and others). The skills library already covers the method |
| **AI visibility** | How a brand shows up in ChatGPT, Claude, Gemini and Perplexity answers | The `ai-seo` skill is already served |
| **Trends** | Google Trends, trending topics, trending audio | Feeds content ideas |
| **WordPress and CMS** | Publish and edit pages and posts, SEO fields, media | A WordPress MCP; Shopify and others later |
| **Google Business Profile** | Posts, reviews, replies, insights | Local businesses; high value in Pakistan |
| **YouTube** | Upload, metadata, channel analytics | Quota audit needed (see platform track) |
| **Measurement** | GA4, Search Console, conversion APIs | Conversions API researched (ideas.md L) |
| **People and company data** | Enrichment and buying signals, for B2B prospecting | Needs a data-protection decision first, as ideas.md L3 does |
| **Messaging** | Slack messages and approvals | Slack is already the preferred ops surface |
| **Video editing** | Premiere Pro, After Effects, DaVinci Resolve | An After Effects MCP ("Prism") already exists in this workspace's tooling. Worth studying before building |

**Two ways to supply the data-heavy areas (SEO, enrichment, trends),** to decide
when they come up:

- **Bring your own key**: the customer connects their own Semrush or DataForSEO
  account. Simple, and no reselling.
- **A TREG-style gateway**: we hold provider accounts and resell calls at a small
  or zero markup. Easier for customers, but it is a different business with
  provider contracts and billing. **TREG's code cannot be used for this.** Its
  licence forbids offering it as a hosted service.

---

### Website (later)

The owner wants the public site in the style of treg.to, and also likes
**Zernio's** site, especially how its pricing is laid out. **Style, not code.**
TREG's licence forbids reusing its code in a hosted product, and its markup, text
and images are its own. The ideas below are patterns and are ours to use.

**Hero, with a rotating role headline:**

> Turn **[Claude / ChatGPT / Claude Code / any AI]** into your
> **[social media manager / Meta ads buyer / SEO expert / content writer / lead-gen SDR]**

- The left-hand word (the AI) and the right-hand word (the role) animate in turn.
- **The artwork below changes with the role.** Social media manager shows the
  platform icons (Facebook, Instagram, LinkedIn, TikTok, YouTube, X, Pinterest,
  Threads). Ads buyer shows Meta and Google Ads. SEO expert shows a rankings chart.
- Under the headline: **one setup line**, TREG-style. For example: *"add AdsPilot to
  your AI: https://.../llms.txt"*, so the AI configures itself.

**Then, in order:**

1. **What it connects**: a grid of every platform, grouped (Social, Ads, SEO,
   Website, Analytics, Video), with "live" and "coming" marked honestly.
2. **The safety story**: nothing public or paid happens without your approval,
   shown as the real approval screen with its cost summary and preview. **This is
   the differentiator against every competitor** (see the research note).
3. **Expertise built in**: the playbooks and skills, shown as the roles above.
4. **One job, end to end**: "run my lead generation ads" as a real transcript.
5. **Pricing**: a **flat $6–7 subscription** to post everywhere; third-party usage
   (images, X, data calls) paid in **credits at 3× cost**; marketing possibly
   limited by plan; ad spend never marked up. The owner's decision; see
   `docs/decisions/0007`. Laid out in Zernio's style.
6. **Docs, GitHub and community** in the footer.

The website is built only after social publishing and Meta ads are working for
1920 Agency. A site that promises things the product cannot yet do would be worse
than no site.

---

### Why this order

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
