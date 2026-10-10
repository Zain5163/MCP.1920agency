# Brand design systems (2026-10-10)

**Status: built and tested locally on branch `brand-systems`; not merged, not deployed.**
Owner's request (2026-10-10): one well-defined design system per brand that every AI (through
the MCP) and every person follows when designing anything (ad creatives, social posts,
carousels, pages, stores), viewable like documentation: navigation on the left, live examples
on the right, on our own server (`mcp.1920agency.com`), private.

## What exists

| Piece | Where |
|---|---|
| Brand format, loader, validator, contrast, access, signed links, viewer page | `source/packages/brands/src/` (package `@social-publisher/brands`) |
| JSON Schema for `brand.json` | `source/packages/brands/schema/brand.schema.json` |
| The four brands | `source/packages/brands/brands/<slug>/` |
| MCP tools `list_brands`, `get_brand`, `brand_viewer_link` | `source/apps/mcp/src/brand-tools.ts`, registered on both transports |
| Viewer route `GET /brands`, `/brands/<slug>`, `/brands/<slug>/files/<name>` | `source/apps/mcp/src/http-server.ts` → `packages/brands/src/route.ts` |
| Caddy | `deploy/caddy/mcp.1920agency.com.caddy`, `@brands` block (GET/HEAD, no-store, noindex) |
| Settings | `deploy/.env.example`: `BRAND_VIEW_SECRET`, `BRANDS_OWNER_TENANT_ID`, `PRODUCT_NAME` |

## The format: one folder per brand

```
source/packages/brands/brands/<slug>/
  brand.json       tokens: every value with a role and a source
  guidelines.md    the prose: one "## " section per viewer section
  assets/          the ORIGINAL logo files, unchanged (SHA-256 recorded in brand.json)
  fonts/           self-hosted fonts and their licence texts
```

**Why inside `source/packages/brands` and not at the repository root:** the server image is
built from `source/` only (`deploy/Dockerfile.dockerignore`), and the hosted MCP reads these
files at run time. As a workspace package the data ships with the code that reads it, the same
relative path works from `src/` (tests) and `dist/` (compiled), and the image needs no change.

`brand.json` sections: `sources`, `colors` (id, name, hex, role, use), `contrastPairs` (fg, bg,
use = text | large-text | ui | decorative | avoid), `gradients`, `typography` (families with
files and licence, a type scale), `spacing`, `radii`, `shadows`, `layout`, `logo` (files with
checksum and background, clear space, minimum size, do and don't, licence, or a `placeholder`
when no logo exists), `imagery`, `icons`, `voice` (rules, say/avoid examples, `neverOnCreative`),
`adCreatives` (rules, placements with safe zones, the sample's style and copy), `socialTemplates`,
`components`, `motion`, plus `ownership` and `approval`.

**Provenance is mandatory.** Every value names a `source`. A source of kind `proposed` means
"not approved"; the viewer badges those values *Proposed · owner to confirm*, `get_brand` tells
the AI to get the owner's yes before they appear in published work, and a brand's `status`
(`imported`, `mixed`, `proposed`) must agree with its sources (checked).

### What the validator checks (start-up and tests)

- The schema (`validate.ts`: a strict JSON Schema subset that refuses any keyword it does not
  enforce, so the schema cannot quietly rely on an unchecked rule). Unknown fields fail; CSS
  values cannot contain `; { } < >`; asset paths cannot leave the brand folder.
- Meaning: sources declared, every colour/gradient/font/logo/placement reference resolves, every
  `text` pair ≥ 4.5:1 and `large-text`/`ui` ≥ 3:1 (WCAG 2.2, computed), `avoid` pairs really
  fail, documented ratios reproduced (1920's four), component labels ≥ 4.5:1 on their fill,
  1:1, 4:5 and 9:16 placements present, the sample never uses a `neverOnCreative` word.
- Files: logo checksums unchanged, font files present, licence text beside every shipped font.
- `guidelines.md` has every section and no others.

The hosted MCP loads every brand before it listens: a broken brand stops it at start-up.

## Where each brand's values came from

| Brand | Status | Sources |
|---|---|---|
| **1920 Agency** | mixed | `Websites/1920-agency/design-system/BRAND-DESIGN-SYSTEM.md` v1.3 and `tokens.css`; the locked homepage `prototypes/growth-modern-fusion/` (wins on conflicts, per FOUNDATION-LOCK.md: CTA gradient `125deg #7B2CBF→#602295`, hero text `#FFF→#C77DFF 85%`); original logo kit (checksums match its `sources.json`); the site's `manrope.woff2` (OFL). Proposed: the ad canvas, the ad recipe and the carousel template. |
| **PSX Ascend** | mixed | Approved v2.0 `docs/PSX_DESIGN_SYSTEM.md` and `app/globals.css`; the original logo `public/media/logos/brand/psx-ascend-logo.webp` (the only logo allowed); `public/fonts/geist-variable.woff2` (OFL). The v3 candidate, the brand handbook and the social playbook are marked **proposed** because their own sources call them candidates. |
| **Muzaree** | proposed | Live store (2026-10-10): the two logo files from its CDN, unchanged, and its fonts Jost and Poppins; the 5 Sep theme export (`#222222`, `#414141`, `#C79A2B`, `#282828`, black 40px-radius buttons); the February winning ads (backdrop colours sampled) and the round-2 remakes (gold `#CDA65C`, cream `#EEE8DE`, Playfair Display); paid-media rules (footwear only, ≥ PKR 5,599, true discounts). |
| **The product** | proposed | The dashboard's `apps/web/src/app/globals.css`; the name research; RULES. No logo on purpose: a dashed text placeholder clearly marked "name not final". |

**Social-Render is not 1920 Agency.** `AI-Automation/Social-Render/templates/brand.css` renders
the owner's *personal* brand (Zain Usman: navy `#081B2D`, teal `#14D1C8`, Geist). Only its
formats, story safe zones (top 250, bottom 340), minimum text sizes (34/24 px) and never-on-image
list were reused for 1920; a test checks no personal-brand colour leaked in. A personal-brand
design system could be added as a fifth brand from `Websites/Zain-Personal-Branding` if wanted.

### Findings recorded (nothing was changed in the source projects)

- PSX: the site's 12px eyebrow green `#3A9C2A` is 3.41:1 on Paper, under AA. New work uses Ink or
  Muted on light surfaces (recorded as an `avoid` pair).
- Product: the dashboard's button labels (white on `#7C5CFF`) are 4.35:1, under AA for normal
  text. Proposed Action violet `#6A4AF0` (5.45:1).
- Muzaree: theme gold `#C79A2B` is 2.60:1 on white (lines and icons only); the mint and pink theme
  labels are off-palette; the gold logo file is only 300px wide (ask the client for a larger one).
- 1920: the guide and the homepage disagree on the CTA and hero-text gradients; the homepage wins.

## How the AI uses it

1. The server instructions (every client, on connect) say: before designing anything for a
   business, call `list_brands`, then `get_brand` (section `ad-creatives` for ads); use only its
   colours, fonts, logo files and voice; never draw, retype or recolour a logo; get the owner's yes
   before anything proposed is published.
2. Our own skills say the same at the point of work: `web-ui-design`, `landing-page-builder`,
   `store-builder`, `shopify-store-kit`, `shopify-theme-developer`, `campaign-setup`,
   `meta-account-manager`. Third-party skills get it in their framing note.
3. `get_brand { brand, section?, parts? }` returns the usage rules first (logo files, proposed
   sources, forbidden words, approval rule), then each section's guidelines and its JSON tokens
   (contrast pairs with computed ratios). On the local transport it also gives the logo files'
   paths, so a renderer can use them; the hosted answer never shows server paths.
4. `brand_viewer_link { brand?, hours? }` gives the person a private link (below).

All three are read-only, counted against the plan like every tool (metering), on both transports.

## The viewer and its access model

`/brands/<slug>` is a documentation page: sidebar (Overview, Colours, Typography, Logo, Layout
and spacing, Components, Imagery and icons, Voice and copy, Ad creatives, Social templates,
Downloads) and, per section, the guidelines (collapsible) and live examples drawn from the tokens:
swatches with computed contrast and pass/fail, type specimens in the brand's own fonts, logo files
on their backgrounds with the clear-space outline and the minimum size, spacing bars, radii,
shadows, components (buttons, cards, chips, inputs, links, badges) on their surfaces, the sample ad
in every placement (1:1, 4:5, 9:16, plus 1200×628 for PSX) with the safe zone dashed, a sample
two-slide social post, and download links. Phone-width layout (the sidebar becomes a scrollable
row), light and dark chrome via `prefers-color-scheme`. One page for all brands (`/brands`) when
the link covers all of them.

**Private:**

- A page is served only for a link made by `brand_viewer_link`: `?t=v1.<payload>.<HMAC-SHA256>`
  over `{brand or "*", tenant, expiry}` with `BRAND_VIEW_SECRET` (≥ 32 chars). 24 h by default,
  7 days at most; tokens claiming longer are refused. No server state, so links survive restarts;
  rotating the secret revokes all of them.
- Every view re-checks that the link's tenant owns the brand (`ownership.tenant`: a tenant id, or
  `owner` = `BRANDS_OWNER_TENANT_ID`). Unset owner = nobody sees owner brands (fail closed).
- Any failure (no link, expired, forged, other tenant, other brand, unknown file) is the same 404
  page that names no brand. There is no unauthenticated index.
- Headers: `Cache-Control: no-store, private`, `X-Robots-Tag: noindex, nofollow, noarchive`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and a CSP of `default-src 'none'` with
  only inline styles and `data:` fonts and images. The page has no script at all and loads nothing
  from anywhere: fonts and logos are inlined (each logo once, as a CSS class).
- Downloads are by exact name from an allow-list (brand.json, guidelines.md, the logo files, the
  font licences); font files themselves are not offered for download.
- Caddy: GET/HEAD only, no-store, noindex; the site keeps no access log.

## Tenancy, now and later

Today the four brands are the owner's agency brands, all `"tenant": "owner"`. A customer's brand
later is a folder with its tenant id in `ownership.tenant`; that tenant alone lists, reads and
views it (tests prove another tenant sees nothing and cannot tell a brand exists). When brands
are created by customers rather than committed by us, the storage moves to the database behind
the same `brandsFor/brandFor` functions; the tools and the route do not change.

## How to add a brand

1. Make `source/packages/brands/brands/<slug>/` (slug: lower-case words and hyphens).
2. Copy the **original** logo files into `assets/` unchanged; record each file's SHA-256, size and
   background. No logo yet? Use a `placeholder` and no files.
3. Copy fonts into `fonts/` with their licence text (`OFL-<Name>.txt`). Subset only fonts without
   a Reserved Font Name; ship RFN fonts (e.g. Playfair Display) unmodified.
4. Write `brand.json` (start from a sibling; `$schema` points at the schema for editor help).
   Every value gets a `source`; anything not taken from an approved source uses a `proposed` one.
5. Write `guidelines.md` with exactly the eleven `## ` sections.
6. `pnpm --filter @social-publisher/brands test`. Fix what it reports (contrast, references,
   checksums). Then the full gate.

## How to update a brand

Edit `brand.json` and `guidelines.md` together, bump `version` and `updated`, keep the source
of every changed value accurate, run the tests, commit. A logo file is never edited: a new logo
is a new file with a new checksum, added only with the brand owner's approval.

## Approval rules

- **PSX Ascend:** anything published with it, and any change to this design system, goes to
  **Jeff, Dan and Rick** for review by email from rana@psxascend.ai first (the AI drafts the
  email; Rana sends it). Only the original logo file or plain text, never a typeset wordmark.
- **1920 Agency:** changes to colours, type, logo or signature graphics are a new version of the
  approved foundation and need the owner's explicit yes.
- **Muzaree:** everything is proposed until the owner confirms it, and the client for the logo,
  colours and type. Ads still need the owner's yes on every new ad.
- **The product:** nothing is approved; no logo and no working name on anything public until the
  owner chooses the name.
- A design made with any brand is never published by this feature; posting and ads keep their own
  approval tokens.

## Not done / next

- **Not deployed.** Go-live: set `BRAND_VIEW_SECRET` (and the same value in the PC's `.env`),
  `BRANDS_OWNER_TENANT_ID` and optionally `PRODUCT_NAME` in `/opt/adspilot/env/adspilot.env`;
  release the image (`deploy/scripts/release.sh`); upload `deploy/caddy/mcp.1920agency.com.caddy`
  to `/opt/gate/sites/` and reload the gate (`cd /opt/gate && docker compose exec -T caddy caddy
  reload --config /etc/caddy/Caddyfile`); then check `/brands` is 404 without a link and a link
  from the hosted `brand_viewer_link` opens on a phone.
- `PRODUCT_NAME` moves to the central settings module (branch `central-config`) once merged
  (TODO in `brand-tools.ts` and `load.ts`).
- Social-Render could read `brand.json` instead of its own `brand.css` to render any brand.
- Muzaree needs a larger gold logo master from the client; PSX still lacks vector/reversed logos.
