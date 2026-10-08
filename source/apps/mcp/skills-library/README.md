# Skills library

Third-party marketing skills, **served by the MCP server** to AI clients through
`list_skills` and `get_skill` (see `src/skills-library.ts`).

Different from `reference/ad-skills/`, which is source material nobody is served.
This folder **is** served, so what goes in it matters more.

## Contents

| Folder | Source | Licence | Commit | Skills |
|---|---|---|---|---|
| `adspilot/` | **Our own**, written and maintained here | AdsPilot's | in-repo | see below |
| `marketingskills/` | github.com/coreyhaines31/marketingskills | MIT | `dda3841f0b294e01e93b1541486beefbfab0915e` | 50 |
| `advertising-skills/` | github.com/realkimbarrett/advertising-skills | MIT (declared; see its NOTICE.md) | `45f4a4a1dabe24113193369b55b929b1de4ff04a` | 4 of 12 |
| `web-quality-skills/` | github.com/addyosmani/web-quality-skills | MIT | `afa8da942115f2961fdbfa80807ea0b232ff6c00` | 3 of 6 |
| `anthropic-skills/` | github.com/anthropics/skills (`frontend-design` only) | Apache-2.0 (the skill's own LICENSE.txt) | `683bc88e56f3e09ba94f7055977f3d3aa499f202` | 1 |

`marketingskills` was fetched 2026-09-30 at the owner's request, so future SEO,
WordPress and Google work starts from this knowledge rather than from new
research. **Updated 2026-10-06** from `5b2c000` to `dda3841`: same 50 skills, 76
files revised upstream (ads, ad-creative, ai-seo, copywriting, social and others).
Upstream `evals/` folders (test cases) and one HTML template are not copied,
because they are never served.

`advertising-skills` was added 2026-10-06 at the owner's request: *add what is
missing, drop what we already have*. Kept, because nothing served covers them as a
working tool:

| Skill | Why kept |
|---|---|
| `schwartz-awareness-mapper` | Awareness stages appear only inside a marketing-council advisor persona |
| `mechanism-builder` | "Unique mechanism" is only mentioned in passing in ad-creative |
| `conversion-path-builder` | Funnel choice by trust gap (call, lead magnet, VSL, quiz) |
| `full-funnel-campaign-orchestrator` | Chains the steps; dropped steps are redirected (below) |

Left out, because a deeper skill is already served. `get_skill` on any of these
names returns the replacement (`COVERED_ELSEWHERE` in `src/skills-library.ts`):
`avatar-extraction` → customer-research · `offer-extraction` → offers ·
`ad-angle-multiplier` and `scroll-stopping-creative` → ad-creative ·
`headline-matrix` → copywriting and ad-creative · `objection-crusher` → offers and cro ·
`generic-language-killer` → copy-editing · `performance-diagnosis` → the
`meta-performance` playbook.

`web-quality-skills` and `anthropic-skills` were added 2026-10-08 at the owner's
request for top-level website-building skills (Shopify stores, landing pages,
WordPress). Kept: `core-web-vitals`, `performance`, `accessibility` (nothing served
covered speed or WCAG 2.2 in depth) and `frontend-design` (visual direction and
the tells of machine-generated pages). Left out: `seo` (seo-audit, schema and ai-seo
cover it), `best-practices` (host-level headers), `web-quality-audit` (an
orchestrator), and every other anthropics/skills folder (not web-building, and
some are source-available only). Each folder's NOTICE.md records what was copied.
The full source survey, including what was read for knowledge only and why, is
`research/2026-10-08-web-store-skills-sources.md`.

## Our own skills (`adspilot/`)

Written for this server's tools, served under their own framing note, and edited
in place (unlike the vendored folders). They win over a third-party skill on the
same ground; a `get_playbook` playbook still wins on a platform's own rules.

- `meta-account-manager` (2026-10-08): daily management and scaling of a Meta
  e-commerce account. `references/research-2026-10.md` is dated online research with
  sources; `references/field-notes.md` collects lessons from real accounts, which the
  daily account runs append to.
- Website building (2026-10-08, owner's request; sources in
  `research/2026-10-08-web-store-skills-sources.md`):
  - `shopify-theme-developer`: Online Store 2.0 structure, Liquid, speed, accessibility,
    and the theme-draft workflow (theme tools are local-only).
  - `landing-page-builder`: pages for ad traffic by paid result, message match, forms,
    events, platform routes, test plan; `references/page-blueprints.md`.
  - `web-ui-design`: design system, hierarchy, WCAG 2.2 AA numbers, store conventions,
    machine-generated look to avoid.
  - `wordpress-site-builder`: WordPress and WooCommerce guidance; AdsPilot has no
    WordPress tools and the skill says so first; `references/woocommerce.md`.
  - `store-platform-choice`: Shopify vs WooCommerce vs others for a given business.
  - `store-builder` (made earlier for the Shopify tools) gained
    `references/conversion-checklists.md` and `references/cash-on-delivery.md`. A
    separate `shopify-store-cro` skill was proposed and **not** made: it would have
    repeated store-builder, so its content went there instead.
- **Never name a client** in these files: they are served to every user. A test
  fails if a known client name appears.

## Checked on arrival

Every file was scanned before being committed:

- phrases that try to override instructions ("ignore previous…", "you are now…")
- code that fetches and runs (`curl … | sh` and similar)
- hard-coded secrets
- hidden and direction-override Unicode characters

Result: **clean.** The only hits were an `rm -rf` in the upstream README's install
instructions (the README is not served) and a variable named `api_key` in a code
example.

Re-run 2026-10-06 on both libraries: **clean.** The only hit was a line in
`ads/references/audit-guardrails.md` warning the AI *against* following
"ignore previous instructions" found in fetched pages. New external references
upstream are links back to the repo, the official MCP Registry, and the
`hyperframes` and `mcp-publisher` CLIs named in documentation.

## Rules for this folder

- **Never edit files in place.** It is a faithful copy of a known commit.
- **Updating means:** fetch at a new commit, re-run the scan, read what changed,
  update the commit here and in `src/skills-library.ts`, commit.
- **Never add an unlicensed source.** A repository with no licence gives no
  permission to copy, however public it is. Read such sources for knowledge and
  write our own; do not copy their text.
- **Every skill is served under a framing note** telling the AI it is advice, not
  a control, and how to read references to files that only exist upstream.
