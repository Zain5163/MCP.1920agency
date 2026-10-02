# Meta's own MCP servers, against ours

**Checked 2026-10-02**, at the owner's request. Sources: Meta's MCP pages
(developers.facebook.com/documentation/mcp and its three sub-pages, plus the Ads
MCP overview under ads-commerce/ads-ai-connectors), and two independent guides
(adadvisor.ai, adsuploader.com). Meta's pages list categories more than exact
tool names, so tool-level detail below is partly from those guides.

---

## What Meta offers

| Server | Endpoint | What it does | Status |
|---|---|---|---|
| **Ads MCP** | `mcp.facebook.com/ads` | Reporting; create and edit campaigns, ad sets, ads; catalogs; signal and dataset health; Help Center search; A/B tests and conversion lift studies; activity logs | Launched 2026-04-29 |
| **Social Technologies ("DevTools") MCP** | `mcp.facebook.com/devtools` | For developers: app settings, App Review status, compliance, API health and rate limits, webhooks (list, manage, test), API changelog, docs search. 11 tools | Beta |
| **WhatsApp Business Tools MCP** | `mcp.facebook.com/whatsapp_business_tools` | WhatsApp accounts, phone number onboarding, message templates, webhooks, sending messages (free text inside 24 hours, templates outside), system user tokens | Beta, gradual rollout |

All three: Meta-hosted, OAuth with the user's Meta login, scopes chosen at
consent. Work with Claude, ChatGPT, Codex, Cursor. Bound by Meta Platform Terms.

What the guides report about the Ads MCP's limits:

- **Writes are live and hard to undo.** No draft mode, no undo; "keep a human in
  the loop for anything that moves real money."
- **No spend ceiling of its own**, no paused-by-default guarantee, no approval step.
- **Creative must be a URL**, not a file on the computer.
- **No multi-tenancy**: agencies bolt per-client scoping and logs on top.
- **No business logic**: it creates what it is told; it does not check that
  placements have the right asset, naming, UTMs, or that the plan is sound.
- Token lasts about 60 days.

## Where we stand

| | Meta Ads MCP | Ours |
|---|---|---|
| Create campaigns, ad sets, ads | ✅ live at once | ✅ **created paused**, activation separate |
| Approval before spend | ✗ (the AI's own judgement) | ✅ token tied to the exact plan |
| Spend ceiling (day/month, minimum) | ✗ | ✅ refuses with none set |
| Validation before creating | ✗ | ✅ limits, duplicates, dynamic-creative rule, learning budget |
| Real preview before creating | ? | ✅ `preview_ad` |
| Local image/video files, chunked up to 4 GB | ✗ URLs | ✅ |
| One ad per shape, per placement | not stated | ✅ asset customisation |
| Expertise (playbooks, goals, five-role team) | ✗ | ✅ 12 playbooks |
| Reporting | ✅ | ✅ with ROAS, placements, demographics, fatigue, verdicts |
| Account audit | ✗ | ✅ |
| **Activity log** | ✅ | ✅ **added today** (`get_ad_activity`) |
| **Signal / dataset health** (event match quality) | ✅ | ✗ partial: `check_ad_setup` sees if the pixel fires |
| **A/B tests, conversion lift** | ✅ | ✗ |
| **Catalogs** | ✅ | ✗ |
| Help Center search | ✅ | ✗ no public API; playbooks and web search instead |
| WhatsApp | ✅ separate server | ✗ |
| Other platforms (Google, LinkedIn, TikTok…) | ✗ Meta only | ✅ posting live on several; playbooks for 11 |
| Organic posting, comments, inbox | ✗ | ✅ (Page tools waiting on the reconnect) |
| Multi-tenant, audit log | ✗ | ✅ |

## Decisions

1. **We keep our own write path to Meta.** Customers' spending goes through our
   approval, ceiling and validation, which Meta's server does not have. We do not
   proxy Meta's MCP.
2. **Positioning:** Meta gives an AI the keys to the ad account; we give it the
   judgement and the brakes, on every platform, not one. Being honest about this
   is also a selling point: an AI connected to Meta's server alone can spend.
3. **Close the gaps worth closing**, in order:
   - Activity log: **done 2026-10-02**.
   - **Signal health**: event match quality and the Conversions API (already
     researched, IDEAS L). The auditor should see weak tracking.
   - **WhatsApp**: the owner's account runs mostly WhatsApp conversation
     campaigns (149 conversations in 30 days). A WhatsApp inbox and templates
     would let the same AI answer the leads the ads create.
   - **A/B tests** with Meta's split-test objects, for the creative strategist.
   - **Catalogs**, with e-commerce and catalog ads.
4. **For building, not for customers:** the DevTools MCP is worth connecting to
   Claude Code on the owner's machine. It shows App Review status, permissions
   and webhooks — exactly what was missing when the Page tokens broke today —
   and webhooks are how comment and message alerts will arrive later.

## Risks

- Meta can widen its own server. Our moat is the guardrails, the expertise, and
  being cross-platform, not access to the API.
- Meta's servers are beta; their tools may change.
