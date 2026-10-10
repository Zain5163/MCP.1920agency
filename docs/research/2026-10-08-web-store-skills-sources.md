# Sources for the website-building skills (2026-10-08)

The owner asked (2026-10-08) for top-level skills so any AI connected to AdsPilot can
build and improve Shopify stores, landing pages and websites (WordPress/WooCommerce too)
for businesses that run ads. This note records every source looked at, its licence, and
whether its **text** was copied, adapted, or read for knowledge only.

**Licence rule applied** (AdsPilot is sold as a hosted SaaS): copy text only from MIT,
Apache-2.0, BSD, CC-BY/CC-BY-SA (with attribution) or CC0 sources, keeping their licence
and attribution. No licence, all-rights-reserved, non-commercial, GPL documentation, and
paid material: knowledge only, our own wording, cited by link. Facts, numbers, API names
and version numbers are not copyrightable and are used with a citation.

Confidence labels follow `docs/research/README.md`: **Verified** (seen on the live primary
page this day), **Reported** (secondary source), **Assumed**.

## 1. Agent-skill repositories

| Repository | Licence (evidence) | Commit / date | Used? | Notes |
|---|---|---|---|---|
| github.com/addyosmani/web-quality-skills | MIT (LICENSE, (c) 2026 Addy Osmani) | `afa8da942115f2961fdbfa80807ea0b232ff6c00`, 2026-08-24 | **Copied, unmodified**: `core-web-vitals`, `performance`, `accessibility` with references → `skills-library/web-quality-skills/` | Left out `seo` (overlaps seo-audit/schema/ai-seo), `best-practices` (host-level headers), `web-quality-audit` (orchestrator) |
| github.com/anthropics/skills | Repo has no single licence; `skills/frontend-design/LICENSE.txt` is Apache-2.0 | `683bc88e56f3e09ba94f7055977f3d3aa499f202`, 2026-10-05 | **Copied, unmodified**: `frontend-design` → `skills-library/anthropic-skills/` | Other folders not copied (not web-building; document skills are source-available only) |
| github.com/vercel-labs/web-interface-guidelines | MIT (LICENSE, (c) 2025 Vercel Labs) | `434b7f91364665f2f733b310ec54809bf8f37937`, 2026-10-05 | **Knowledge, credited** in web-ui-design | Not vendored: it is one AGENTS.md without a SKILL.md, and most of it overlaps accessibility and frontend-design; implementation rules (16 px inputs, never disable zoom, focus) were restated in our words |
| github.com/vercel-labs/agent-skills | **No licence file** at repo root | `063bee94c3f4df8453406c830b0a7df0f2860278`, 2026-08-28 | No | React/Next.js focused; no licence means no permission to copy |
| github.com/Shopify/shopify-ai-toolkit | MIT ((c) Shopify Inc.) | `26d0623f98a5f27c1e8449d0e230259879cd9257`, 2026-10-08 | **Knowledge, credited** in shopify-theme-developer | Not vendored: the skill depends on bundled scripts (`search_docs.mjs`, `validate.mjs`) and a telemetry hook that report prompts and code to shopify.dev; useless without them and a privacy concern when served to clients. Its Liquid conventions (theme folders, `{% render %}` scope, `image_url`/`image_tag`, `block.shopify_attributes`, no ternary/parentheses) informed our text |
| github.com/Shopify/dawn | Shopify's own licence: use only to develop Shopify themes ("All other uses … strictly prohibited") | n/a | Knowledge only | Not MIT despite older reports; no code copied |
| github.com/Shopify/horizon | Shopify's own licence, stricter than Dawn's (no derived themes anywhere) | n/a | Knowledge only | Skill warns against copying Dawn/Horizon code to other platforms |
| github.com/Shopify/theme-tools (Theme Check, Liquid language server) | MIT | n/a | Referenced (Theme Check) | Tool, not text |
| github.com/benjaminsehl/liquid-skills | **No licence** | n/a | No | Liquid fundamentals, standards, accessibility; knowledge only |
| github.com/jeffallan/claude-skills (`shopify-expert`) | MIT | main, 2026-10-03 | No | Generic and contains errors (mentions a Shopify `theme.json`, misuses `metafield_tag`) |
| github.com/mindrally/skills (`shopify-theme-development-guidelines`) | Apache-2.0 | main | No | Thin, generic lists |
| github.com/mrgoonie/claudekit-skills (`shopify`) | No LICENSE found at main | n/a | No | |
| github.com/WordPress/agent-skills (official, 18 skills) | **GPL-2.0-or-later** (LICENSE) | `3cf7f6f701300d80166cc0b7e6ebc667501c353d`, 2026-10-05 | Knowledge only | High quality but developer-facing (blocks, plugins, REST, WP-CLI, Playground); GPL text copied into our skills would have to be released under GPL when distributed |
| github.com/Automattic/agent-skills | Archived, moved to WordPress/agent-skills | `48d4aa2`, 2026-02-01 | No | |
| woocommerce/woocommerce `.ai/skills` (11 skills) | GPL-2.0+ | not fetched (API limit) | Knowledge only | For contributors to WooCommerce itself, not merchants |
| github.com/jezweb/claude-skills (`plugins/wordpress`, 3 skills) | MIT ((c) 2025 Jezweb) | `64965d9d9fc76ad2caeea2e27dd8d679ec7521b3`, 2026-10-05 | No | WP-CLI/REST/Elementor operations for an agent with server access; AdsPilot has no WordPress tools, so not useful yet. Candidate if WordPress tools are built |
| github.com/coreyhaines31/marketingskills | MIT | already vendored (`dda3841`) | Already served | `cro`, `copywriting`, `site-architecture`, `signup`, `popups`, `schema`, `seo-audit`, `analytics`, `ab-testing` cover the general CRO and copy ground; new skills link to them instead of repeating |

## 2. Documentation and research (cited, never copied)

| Source | Licence / reuse | Used for |
|---|---|---|
| shopify.dev (theme architecture, limits, alternate templates, performance best practices, accessibility, Theme Store requirements) | Proprietary; cite and paraphrase | Theme structure, 25 sections / 50 blocks / 1,000 templates / 8 nesting levels, `?view=` previews, performance essentials, Lighthouse 60 / 90 bar. **Verified** 2026-10-08 (pages fetched as `.md`) |
| help.shopify.com (manual payments, Shopify Payments countries, Meta data sharing levels, templates) | Proprietary; cite | COD as a manual method; Shopify Payments not in Pakistan; Standard/Enhanced/Maximum data sharing. **Verified** |
| web.dev (Core Web Vitals, LCP optimisation, "Milliseconds make millions") | Text CC-BY 4.0, code Apache-2.0 | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75; INP replaced FID on 12 Mar 2024; +8.4% retail conversions per 0.1 s (Deloitte/55, 2019 data). **Verified**. Restated, not copied |
| W3C WCAG 2.2 | W3C Document License (copy unmodified with attribution) | Criterion numbers and thresholds; Recommendation 5 Oct 2023. **Verified**. Restated |
| EUR-Lex, Directive 2019/882 (European Accessibility Act) | EU law, free reuse with acknowledgement | Applies from 28 Jun 2025; e-commerce in scope; micro-enterprise service exemption. **Verified** |
| Baymard Institute (cart abandonment list, checkout, product page, mobile, apparel sizing, in-scale images) | Proprietary; cite only | 70.22% average abandonment; reasons (extra costs ~40% …); 23.5 vs 12–14 form elements; 51% / 62% / 65% mediocre; 83% / 87% sizing info. **Verified**. A Statista listing of the same 2025 survey shows figures 1–2 points different; the skill says so |
| Unbounce Conversion Benchmark Report 2024 | Proprietary vendor data; cite only | 6.6% median landing page, 4.2% e-commerce, 83% mobile visits, reading level 5th–7th grade 11.1%. **Verified** on Unbounce's page; data period not stated |
| Google/SOASTA 2017 and DoubleClick 2016 speed statistics ("53% abandon after 3 s", "+32% bounce 1→3 s") | Proprietary | **Not used as evidence**: old, modelled, mostly publisher sites; the "+32%" figure is no longer on a live Google page |
| VWO navigation-removal case study; HubSpot/Imaginary Landscape form-length studies | Proprietary | **Not cited as numbers**: single, old cases. Message match and single CTA are stated as practitioner rules, not with an invented lift |
| Meta developer docs (pixel reference, CAPI deduplication, server event parameters) | Proprietary; cite | Standard events; Purchase needs value and currency; `event_id` dedup within 48 h; `event_time` ≤ 7 days. **Verified** |
| developer.wordpress.org handbooks, make.wordpress.org dev notes | GPL-2.0+ (Gutenberg, plugin handbook) or unclear (Theme/REST handbooks) | Versions and features: theme.json v3, patterns folder, fetchpriority 6.3, AVIF 6.5, speculative loading 6.8, Application Passwords 5.6, hardening guide. **Verified** for the linked pages; lazy-loading 5.5, WebP 5.8 and synced patterns 6.3 are **Reported** (well known, not re-fetched) |
| wordpress.org (versions, requirements, plugin listings) | GPL software; listings cited | WordPress 7.1.3 (6 Oct 2026); PHP 8.3+ recommended; WooCommerce 11.2; Meta for WooCommerce rating ~2.1/5. **Verified** |
| learn.wordpress.org | Reported CC BY-SA 4.0 (not seen on a live page) | Not used |
| WooCommerce docs (woocommerce.com © WooCommerce; developer.woocommerce.com GPL, with a v2/v3 inconsistency) | Knowledge only | Block checkout default 8.3; HPOS 8.2; Additional Checkout Fields API 8.9; product block editor removed in 11.0. **Verified** |
| wp-cli/handbook | MIT | Commands named in our words (not copied) |
| Patchstack, State of WordPress Security in 2026 | Proprietary; cite | 11,334 vulnerabilities in 2025, 91% plugins, 46% unpatched at disclosure. **Verified** |
| State Bank of Pakistan press releases (FY24, FY25); The News 2018 citing SBP FY2017-18 | Public documents; cite | ~90% COD (2018, latest official figure found); 93% of digital e-commerce payments via accounts/wallets (FY25) and why that is not a COD share. **Verified** |
| DataReportal Digital 2026 Pakistan | Proprietary; cite | 117 M internet users; ad reach by platform. **Verified** |
| COD return-to-origin rates (vendor blogs), WhatsApp user counts for Pakistan | Weak | Stated only as "industry estimates" (25–30% RTO); no WhatsApp user figure used |
| Shopify App Store listings (Safepay, courier apps) | Cite | Examples, marked as options for the owner to check |

## 3. What was built from this

See `source/apps/mcp/skills-library/README.md`. In short: three MIT skills and one
Apache-2.0 skill vendored unmodified; five skills of our own written
(`shopify-theme-developer`, `landing-page-builder`, `web-ui-design`,
`wordpress-site-builder`, `store-platform-choice`); `store-builder` extended with two
reference files instead of a duplicate `shopify-store-cro` skill.

## 4. Not checked / left open

- Shopify docs change quietly; the limits and performance list are a 2026-10-08 snapshot.
- Whether WPGraphQL has formally moved to a WordPress.org-owned listing (Reported only).
- A current, official cash-on-delivery share for Pakistan (none newer than 2018 found).
- `shopify_save_page` cannot set a page's template; landing-page templates need the owner
  to assign them in the admin. A `templateSuffix` option would remove that step.
- WordPress tools (read site health, pages, plugins; write pages through the REST API with
  an Application Password held in the vault, behind the same approval and backup rules)
  would let these skills act, not only advise. Not designed yet.
