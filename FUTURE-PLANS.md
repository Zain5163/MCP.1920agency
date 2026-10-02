# What is planned

**Updated 2026-10-02.** Everything here is **not built yet**. What exists today is
in `CURRENT-STATE.md`. Detail for each item is in `ROADMAP.md`, the decision
records and the research files named beside it. When an item is built and
proven, it moves to `CURRENT-STATE.md` and out of here.

The aim, in the owner's words: one MCP a business connects once, which replaces a
marketing team. Any AI connected to it works like a top marketer without being
told how.

**Owner's order:** social posting first, then Meta ads, then Google, then
everything else. Nothing lower starts before the item above it works for 1920
Agency's own accounts.

---

## Next, in order

| # | What | Why now | Detail |
|---|---|---|---|
| — | ~~**Facebook Page management**~~ built 2026-10-02 (CURRENT-STATE); was: read and reply to comments and reviews, hide spam, Messenger replies, insights | Owner's Page works without Meta review | ROADMAP 5b.7 |
| 2 | **Google Business Profile posting** | Owner's priority #1; waiting on Google's access form (up to 14 days) | `architecture/google-suite-plan.md` |
| 3 | **YouTube posting** | Uploads stay private until Google's audit passes | same |
| 4 | **Search Console and Google Analytics** reads | | same |
| 5 | **One-click tracking setup**: Tag Manager, GA4, Google Ads conversions, Search Console verified, events mapped; WordPress fully automatic, others one paste | | same |
| 6 | **Google Ads** with Keyword Planner | Needs Basic access; customer use waits on Google's answer about MCP "proxies" | same, WAITING-LIST #15 |

## Social posting

- Google Business Profile: posts, reviews and replies, insights (UK, Europe, Pakistan).
- YouTube: upload, metadata, analytics.
- TikTok, X, Threads (credentials), Pinterest (Standard access), LinkedIn company page.
- Comments and inbox management on every platform, not only Facebook.
- Analytics and charts in the dashboard.
- AI captions and per-platform optimisation.

## Meta ads

After comparing with Meta's own MCP servers (research/2026-10-02-meta-official-mcps.md):

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
- Serving customers: Meta App Review for business and ads permissions, per-customer
  ad accounts (decision 0005), then the setup tools for people with no account.

## Google

Full plan, phases and the owner's checklist: `architecture/google-suite-plan.md`.
Business Profile → YouTube → Search Console and Analytics → tracking setup →
Google Ads and Keyword Planner. Indexing requests are limited by Google to job and
livestream pages; Search Console sitemaps and inspection are used instead.

## Other ad networks

Microsoft, TikTok, LinkedIn (access granted), Amazon, Snapchat, Pinterest, X,
Reddit, Telegram. Each playbook is already written; each needs its own developer
approval and adapter. Rule: no platform launches without its playbook (decision 0008).

## The whole marketing MCP

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

## Business and launch

- **Choose the product name**: first choice Mahir, then Hamkar, Markwala. Check
  trademarks, domains and handles first (WAITING-LIST #14).
- **Pricing**: flat $6–7 a month to post everywhere; third-party usage in credits
  at 3× cost; marketing possibly limited by plan; ad spend never marked up
  (decision 0007). Needs a credit ledger and per-customer settings.
- **Website** in the style of TREG and Zernio, with the animated "Turn X into
  [role]" heading and Zernio-style pricing (ROADMAP "Website").
- **LinkedIn build-in-public**: the 6-week arc from teaser to name reveal,
  waitlist and launch (`Marketing-and-Content\LinkedIn-Content-System\STRATEGY.md`).
  Weekly batch approval or full automation once drafts prove reliable; approval
  in Slack later.
- Run the server somewhere always-on, so nothing depends on this PC being awake.

## Waiting on the owner

The live list is `WAITING-LIST.md`. The main ones: OpenRouter credit, the
Google Cloud OAuth client and access applications, the product name, the
LinkedIn profile update, and reviewing the LinkedIn drafts.
