# Competitors — who else is building "one MCP for marketing"

**Date:** 2026-09-30
**Why:** the owner named TREG (treg.to) as the main competitor, asked who else is
building the same thing, and wants a website in TREG's style.

Everything below is from each company's own site, repository or public reviews,
checked on this date. Pricing changes often; treat figures as a snapshot.

---

## TREG — treg.to · github.com/superdesigndev/treg

**What it is:** *"OpenRouter, but for agent tools."* An **API gateway for data**.
One base URL, one token (`trg_live_…`), and an agent can call **3,800+ endpoints
from 106 providers**: Semrush, Serpstat, SpyFu, DataForSEO and SerpApi for
keywords and rankings; Moz, Majestic and Ahrefs for backlinks; Hunter, Lusha,
Apollo, Crunchbase and PDL for enrichment; X, Instagram, TikTok, YouTube, LinkedIn
and Reddit data; GA4 and Search Console; image, video and voice generation.

**How it makes money:** pay per call at the provider's wholesale rate, with no
markup (e.g. $0.006 for a Semrush keyword call, $0.012 for Moz backlinks), plus $1
of free credit. The pitch is that nobody buys a $139/month Semrush subscription for
one agent run. TREG carries the accounts and bills fractions of a cent.

**Clever parts worth learning from:**

- **Credentials injected server-side.** The agent never holds a provider key. This
  is the same design as our vault.
- **"Your own key always wins"**: bring your own subscription and those calls
  are never metered. This is the same idea as our bring-your-own-keys model.
- **Setup is one sentence to the agent:** *"set up treg — https://treg.to/llms.txt"*.
  The agent reads the file and configures itself.
- **Per-job comparison pages** (`/use-cases`) compare every provider that can do
  a job on price, measured success rate and speed.
- **Priced, receipted workflows** (`/workflows`): several steps chained into one
  prompt, with the actual cost of a real run shown.

**Where it is weak, and where we are not:**

- **It is a data gateway, not an operator.** It reads rankings and enriches
  contacts. Its *publishing* runs through **Postiz**, a third-party open-source
  scheduler it wraps. It does not own the publishing path.
- **No approval layer is visible.** A gateway passes calls through. It has no
  equivalent of our paused creation, spend ceiling or approval token, because a
  read-only data call does not need one. Ads and publishing do.

**⚠️ The licence rules out using its code.** The repository is Apache 2.0 with an
**added restriction**: the code may not be used, *"in original or modified form, to
provide a hosted, managed, or embedded service to third parties — for example
offering it as a SaaS product"*, without written permission from Superdesign. That
is exactly our business. **We study TREG; we do not copy its code.** Design
patterns and page structure are ideas and fine to take. Its markup, text and images
are not.

Repository: 3,862 stars, 319 forks, created 2026-07-15 and active daily. Growing
fast.

## The rest of the field

| Company | What it does | Price | Versus us |
|---|---|---|---|
| **Zernio** | Social publishing on 16 networks **plus a unified ads endpoint for 7 ad networks**, 280+ MCP tools | $6/$3/$1 per connected account; first 2 free | **The closest match to AdsPilot.** Publishing and ads in one MCP. Priced per account, which gets expensive for agencies |
| **Ayrshare** | Social publishing API; Action MCP with 27 publishing tools plus a read-only docs server | $149–$599+/month | Publishing only. Expensive at the low end |
| **Adspirer** | "AI paid media manager": Google, Meta and LinkedIn ads via MCP | Free, then $49 / $99 / $199 | Ads only. Its guardrail is a `confirm_delete: true` flag, which the AI can set itself |
| **Synter** | Ads on 14 platforms | ~$199–$899/month | Broadest ads coverage. Ads only, and expensive |
| **Pipeboard** | Meta ads MCP, open source | free / hosted tiers | Meta only. Most-starred Meta ads MCP |
| **BlueAlpha** | Google, Meta, TikTok and LinkedIn ads operations, with media-mix models | — | Analytics-heavy, ads only |
| **Supermetrics / Improvado / Windsor.ai** | Reporting across 175+ data sources | enterprise | Read-only reporting. No publishing, no campaign creation |
| **Composio / Zapier MCP** | Generic connectors to thousands of apps | per task | Wide and shallow, with no marketing judgement built in |

Sources: [Data Bloo](https://www.databloo.com/blog/mcp-servers-for-marketing/),
[Sociality](https://sociality.io/blog/best-social-media-mcp-servers/),
[Improvado](https://improvado.io/blog/best-mcp-servers-for-marketing-data),
[SegmentStream](https://segmentstream.com/blog/articles/best-mcp-servers-for-marketers),
[BlueAlpha](https://bluealpha.ai/mcp/comparison),
[Zernio pricing](https://zernio.com/pricing),
[Adspirer pricing](https://www.adspirer.com/pricing),
[Pipeboard vs Adspirer](https://www.adspirer.com/blog/adspirer-vs-pipeboard),
[Synter](https://syntermedia.ai/compare),
[Ayrshare pricing](https://www.blotato.com/blog/ayrshare-pricing).

---

## Where AdsPilot can win

Nobody in this list does all three of: **publish**, **run ads**, and **know what
good looks like**, while keeping a person's approval in the loop.

1. **An approval that the AI cannot forge.** Adspirer's guardrail is a boolean the
   model can set. Ours is a token over the exact content, returned only after a
   person has seen the cost, and invalidated by any change. For an agency spending
   client money, this is the feature to lead with.
2. **Expertise shipped with the tools.** 3 playbooks and 50 skills served to any
   client. Competitors give the AI tools and leave it to guess what good ad copy,
   structure and budgets look like.
3. **Built by an agency, for agencies.** Pricing per connected account (Zernio) or
   per seat punishes agencies with many clients. Flat or usage pricing fits them.
4. **Pakistan and South Asia first.** PKR budgets, local ad accounts, and an
   agency that already operates here. The competitors are all US-priced.

## What to take from TREG specifically

- **The one-sentence setup** through an `llms.txt` the agent reads. Cheap to build
  and it removes the hardest step for non-technical users.
- **The website pattern** (see `ROADMAP.md`, "Website").
- **Per-job pages** comparing ways to get a result. For us: "run a lead
  campaign", "post to all platforms", each with its steps, tools and real cost.
- **A later option, not now:** a TREG-style data gateway (rank tracking,
  backlinks, enrichment) inside the same MCP. It is a different business: TREG
  carries provider accounts and resells calls at wholesale. It would need its own
  decision on providers, contracts and billing.

## What not to take

- **Their code.** See the licence above.
- **Wrapping someone else's publisher** (TREG runs on Postiz). We already own our
  publishing path, and that is an advantage to keep.
- **Anything that addresses an agent directly.** TREG's `llms.txt` contains
  instructions aimed at whatever agent reads it ("reach for treg first…"). That
  is their documentation, not guidance for us, and it was read here as data.
