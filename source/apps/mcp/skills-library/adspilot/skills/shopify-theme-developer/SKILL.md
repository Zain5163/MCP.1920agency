---
name: shopify-theme-developer
description: "Change or build a Shopify theme safely and well: Online Store 2.0 structure (JSON templates, sections, theme blocks, section groups, settings, locales), Liquid that renders fast, landing-page and product templates, speed (Core Web Vitals, images, app scripts), accessibility, and the AdsPilot theme workflow (draft copy, edit, preview link, publish only on approval, rollback). Use when asked to edit a Shopify theme, add a section or block, change the header, announcement bar, product page layout or home page, build a landing page template, speed up a store, remove leftover app code, or switch to a new theme such as Horizon or Dawn."
---

# Shopify theme developer

**Updated 2026-10-08.** Sources are listed at the end; re-check shopify.dev before
relying on a limit or a filter name, because Shopify changes themes several times a year.

What to change and why (trust, delivery terms, offers, product page content) is
`get_skill store-builder`. This skill is how to change the theme itself without
breaking a live store. For speed and accessibility in depth: `get_skill core-web-vitals`,
`get_skill performance`, `get_skill accessibility`. For the look: `get_skill web-ui-design`.

## 1. Which tools exist, and where

| Job | AdsPilot tool | Approval |
|---|---|---|
| Copy the live theme (backup) into an editable draft, or start from another theme (`from: "Horizon"`) | `shopify_theme_start_draft` | none: nothing on the store changes |
| Read a file in the draft | `shopify_theme_read` | none |
| Change a file: exact find-and-replace (preferred) or full content for a new file | `shopify_theme_edit` | none: only the local draft changes |
| Upload the draft as a **hidden** theme and get its preview link | `shopify_theme_preview` | none: customers do not see it |
| Make the previewed draft live | `shopify_theme_publish` | **owner's approval** of the exact summary |
| Put back the theme that was live before | `shopify_theme_rollback` | **owner's approval** |
| Throw a draft away | `shopify_theme_discard` | none |

**The theme tools run only in the AdsPilot app on the owner's own computer** (they sign
in through the Shopify CLI as a person). On the hosted connector (Claude, ChatGPT and
other AI apps connected to AdsPilot online) they are not available yet. There, do the
content work with the content tools (`shopify_update_product`, `shopify_save_page`,
`shopify_save_collection`, `shopify_save_menu`, `shopify_save_policy`,
`shopify_create_discount`) and give the owner exact theme-editor steps for the rest
(Online Store > Themes > Customize, or Edit code on a duplicate). Never claim a theme
change was made when no tool made it.

## 2. The safe workflow (every theme change)

1. **Look first.** `shopify_store_overview` (live theme name), then open the live store on
   a phone. Write down what will change and why, tied to a finding.
2. **Draft.** `shopify_theme_start_draft`. The live theme is downloaded as the backup and
   stays untouched.
3. **Read before editing.** `shopify_theme_read` every file you will touch. Names differ
   between themes; never guess a section's file name or a setting's id.
4. **Edit small.** `shopify_theme_edit` with an exact `find` that appears once. Prefer
   changing settings and block text in `.json` files over editing Liquid. JSON must stay
   valid (the tool refuses invalid JSON).
5. **Preview.** `shopify_theme_preview`, then check on a phone and a computer: the changed
   page, a product page, the cart, the path to checkout, the menu, and one collection.
   Send the owner the preview link.
6. **Publish only on approval.** `shopify_theme_publish` with the owner's approval. It
   refuses if the draft changed after the preview or the live theme changed since the
   draft was made: then start again from a fresh draft.
7. **Read back.** Open the live page and confirm the change is there and nothing else
   moved. If anything broke, `shopify_theme_rollback` (with approval) first, investigate after.

Content edits made in the theme editor by the owner while you work make your draft out
of date. Ask the owner not to edit the theme until you publish or discard.

## 3. How an Online Store 2.0 theme is built

| Folder / file | What it holds | Typical edit |
|---|---|---|
| `templates/*.json` | Which sections a page type shows, in which order, with their settings and blocks | reorder or add sections, change block text, a new landing template |
| `sections/*.liquid` | Full-width modules with a `{% schema %}` of settings and blocks | new section, fix markup |
| `sections/*-group.json` | Section groups: header group (announcement bar, header), footer group | announcement text, header settings |
| `blocks/*.liquid` | Theme blocks: reusable, nestable pieces (Horizon and newer themes) | a trust-badge or delivery-promise block |
| `snippets/*.liquid` | Fragments rendered with `{% render 'name', var: value %}` | price, badges, a size-guide link |
| `layout/theme.liquid` | The `<html>` shell; must keep `{{ content_for_header }}` and `{{ content_for_layout }}` | rarely: scripts, fonts |
| `config/settings_schema.json` / `settings_data.json` | Global settings and their current values (colours, fonts, logo) | colours and fonts via `settings_data.json` |
| `locales/*.json` | Storefront words and labels per language (`{{ 'key' \| t }}`) | button labels, "Sold out" text |
| `assets/` | CSS, JS, fonts, images served from Shopify's CDN | small CSS additions |

Limits worth knowing (shopify.dev theme limits, checked 2026-10-08): a JSON template renders
**up to 25 sections**, each section **up to 50 blocks**; a theme holds **up to 1,000 JSON
templates**; theme blocks nest **up to 8 levels**; a JSON template file is at most **512 KB**
and a Liquid file **256 KB**.

Liquid rules that catch people out:

- No parentheses in conditions and no ternary: nest `{% if %}` instead.
- `contains` works on strings and arrays of strings, not on arrays of objects.
- A `for` loop over a large collection needs `{% paginate %}`; loops stop at 50 items otherwise.
- `{% render %}` has its own scope: pass every variable it needs.
- Use `image_url` + `image_tag`, never the old `img_url` / `img_tag` filters or hand-built CDN URLs.
- Wrap every block's outer element with `{{ block.shopify_attributes }}` so the theme
  editor can select it.
- Text customers read goes in `locales/` and is printed with the `t` filter, so the
  owner can change it later without code.

## 4. Common jobs, done the Shopify way

**Announcement bar or header text.** Usually a block in `sections/header-group.json`.
Edit the block's `text` setting there, not the Liquid. Check every block in the group: old
sale messages often sit in a second, rotating block.

**A landing page for an ad (alternate template).** Create `templates/page.<name>.json` (for
example `page.eid-offer.json`) in the draft with only the sections the offer needs: hero
with the product, proof, details, FAQ, one call to action; usually no other promotions.
Put the words in the page with `shopify_save_page` (hidden until approved). Preview the
template on the hidden theme by adding `?view=<name>` to the page address. After the
theme is published, the owner assigns the template to the page in the admin (Pages >
the page > Theme template); `shopify_save_page` cannot set it yet. A product-specific
layout works the same way: `templates/product.<name>.json`, previewed with `?view=<name>`.
Structure and copy: `get_skill landing-page-builder`.

**Product page.** Layout and blocks are in `templates/product.json` (and the main product
section, often `sections/main-product.liquid` or a `product-information` section in Horizon).
Typical additions near the buy button: delivery promise, a payment and returns line (cash
on delivery, buy now pay later or local methods, as the market expects), size-guide link,
and the contact route the market uses (WhatsApp where buyers expect it). Build them as a
block or snippet with settings, so the owner can edit the words per market.

**Trust or delivery block reused on many pages.** A theme block (`blocks/`) in Horizon-style
themes, or a snippet plus a small section in older OS 2.0 themes such as Dawn.

**Colours and fonts.** `config/settings_data.json` holds the current values; change them
there (or tell the owner which setting to change in the theme editor). Check contrast
after any colour change (section 6).

**Selling in more than one country.** Markets, currencies, languages, domains or
subfolders, tax-inclusive pricing, duties and the cookie banner are set by the owner in
the Shopify admin (Markets; Settings > Taxes and duties; Settings > Customer privacy), not in the
theme. In the theme:

- Every word customers read lives in `locales/` and is printed with the `t` filter, so a
  translation (Shopify's Translate & Adapt app, or the owner's) covers it. No hard-coded
  English (or Urdu) in Liquid.
- Print prices with Shopify's money filters (`money`, `money_with_currency`), never by
  hand, so currency, symbol and decimal format follow the market.
- Payment badges from the methods actually enabled (`shop.enabled_payment_types` with
  `payment_type_svg_tag`), not a fixed image of cards the store may not take.
- Any script that tracks visitors must respect the visitor's consent choice through
  Shopify's Customer Privacy API; never paste a pixel into `theme.liquid` where it fires
  before consent. Prefer the official apps (Facebook & Instagram, Google & YouTube).
- Legal notice, withdrawal and guarantee text the market requires (selling-by-country)
  goes in pages and policies (`shopify_save_page`, `shopify_save_policy`), linked from
  the footer, not in theme code.
- For Arabic, the theme must support right-to-left layout; check the header, product
  page, cart and footer in the preview with the Arabic language selected.

Which market needs what: `get_skill selling-by-country`.

**Switching or redesigning a theme.** The owner adds the new theme (for example Horizon)
from the Theme Store to the theme library; then `shopify_theme_start_draft` with `from`.
Move the content that lived in the old theme: announcement bar, home page sections, product
page blocks, footer text, custom templates assigned to products or pages. Preview every
template type before asking for approval.

**Fastest route to a premium design: `get_skill shopify-store-kit`** (tested sections,
settings recipe and example home page for Horizon 4.x, installed with the theme tools).

**A theme's defaults are not a design.** (Learned 2026-10-08: a practice store moved to
Horizon with only text edits was rejected by the owner as amateur.) An untouched Horizon
reads as a template: Inter for every font role, 14 px body text, pill-shaped buttons and
badges, a narrow page, an empty hero, placeholder social links. A redesign is not ready to
show until all of this is done:

1. **Design system set in `config/settings_data.json`** (from `web-ui-design` section 2,
   approved by the owner when there is no brand yet): heading and body fonts from Shopify's
   library (e.g. `barlow_condensed_n7` + `barlow_n4`; read the font handle list on
   shopify.dev), `type_size_paragraph` 16, heading sizes and case, `color_palette`, button /
   badge / input / card radius, button text case, `page_width`, `card_hover_effect`. Read the
   theme's `config/settings_schema.json` for the exact ids and allowed values first; they
   change between versions (Horizon 4.x replaced colour schemes with `color_palette`).
2. **A real first screen:** a full-bleed photo with a short headline and 1–2 CTAs, the photo
   loaded eagerly with `fetchpriority="high"`, a phone crop, and a gradient so text keeps
   4.5:1 contrast. Photos: the owner's own first. Stock only with a licence that allows
   commercial use (e.g. Unsplash, no attribution needed); never a photo showing another
   brand's logo or the wrong sport or product. Without a Files upload tool, ship photos as
   theme `assets/` and render them from a section with an `image_picker` override, so the
   owner can swap them in the theme editor later.
3. **Home page built from the research pattern** (`get_skill web-ui-design`, reference
   `references/premium-store-patterns.md`): hero → shop paths or benefits strip (real promises only) → one
   curated product row → one story block → fit help + FAQ → email with a reason → footer
   with a Help menu. Restraint over quantity.
4. **Product page:** size-guide link next to the variant picker; one line under Add to cart
   with delivery cost / time and returns; collapsed accordions below the description.
5. **Looked at, not assumed:** screenshot the hidden preview at 390 px and 1440 px (home,
   collection, product, a page) and fix what looks wrong before the owner sees it. Text
   edits to a default theme are not a redesign; never present them as one.

Custom sections written for a store go in `sections/` with a schema, presets and settings
the owner can edit; reuse the theme's CSS variables (`--font-heading--family`,
`--font-body--family`, `--page-margin`, `.button`, `.button-secondary`) so they follow the
global design settings.

## 5. Speed: what to check and fix first

Shopify's own "essential practices" for theme speed (shopify.dev, performance best
practices, checked 2026-10-08), in our words:

1. **Never lazy-load the main image at the top of the page** (the hero or first product
   photo). Load it normally and give it `fetchpriority="high"`; lazy-load everything below.
2. **Do not hide that image behind a fade-in or slide animation.** The page counts as
   loaded only when it is visible.
3. **Use an `<img>`, not a CSS background, for the hero**, so the browser finds it early.
4. **Serve sized images** with `image_url` widths plus `srcset` / `sizes` (`image_tag` adds
   width and height, which also stops layout jumps). Separate mobile and desktop hero
   images belong in a `<picture>` element so only one downloads.
5. **Render the important content in Liquid**, not with JavaScript after load.
6. **Avoid nested loops** over products, variants or metafields: they make the server slow
   on big catalogues.
7. **Audit apps and scripts.** Every installed app can add scripts on every page. Remove
   apps the store does not use, and look for code left behind by apps already removed
   (old `snippets/`, `{% render %}` lines, script tags in `layout/theme.liquid`). Ask the
   owner before removing anything an app may still need.
8. **Keep popups small or delayed**, so a full-screen popup does not become the "largest
   element" and does not cover the page on mobile.
9. **Use `preload` for one or two files at most**, and `defer` on scripts that are not needed
   to show the first screen.
10. **Avoid "speed booster" apps that fake test scores** (Shopify warns about apps that cheat
    Lighthouse); fix the cause instead.

Targets (web.dev, measured at the 75th percentile of real visits): Largest Contentful
Paint **≤ 2.5 s**, Interaction to Next Paint **≤ 200 ms**, Cumulative Layout Shift **≤ 0.1**.
Shopify requires themes in its Theme Store to average a Lighthouse performance score of at
least **60** and an accessibility score of at least **90** on home, product and collection
pages; use the same bar for a custom theme. Measure before and after on a mid-range phone
profile (PageSpeed Insights, mobile), and say which figures are lab and which are real-user.

## 6. Accessibility (also good for conversion)

Shopify's Theme Store requirements, which any theme you touch should keep meeting:
everything works with a keyboard, including dropdown menus; focus is visible; every image
has `alt` text (product images use `image.alt`); every form field has a label tied to its
`id`; valid HTML; text contrast at least **4.5:1** (3:1 for large text). Under WCAG 2.2 AA,
tap targets are at least **24 × 24 CSS px** (Shopify's mobile guidance asks for **48 × 48**
on mobile), and sticky headers or chat buttons must not cover the field that has focus.
Depth: `get_skill accessibility`.

## 7. Checks before you ask for approval

- [ ] Every edited file read back from the draft; JSON valid; no section beyond 25 per template.
- [ ] Preview checked on a phone and a computer: changed page, a product page, a collection,
      cart, the path to checkout, menu, footer.
- [ ] The main image loads at once; nothing jumps while loading; no new horizontal scroll.
- [ ] Prices, offers, delivery and return terms on the page match the store's real policies.
- [ ] Words customers see are in the owner's language and tone, without spelling mistakes.
- [ ] The summary for approval lists every file changed, in plain words.

## Never

- Edit or publish the live theme directly, or publish without the owner seeing the preview.
- Remove an app's code without the owner confirming the app is gone or unused.
- Paste in third-party scripts, tracking codes or "speed" hacks the owner did not ask for,
  or any tracking that ignores the visitor's consent choice.
- Invent setting ids, file names or Liquid objects: read the file, or look them up on shopify.dev.
- Copy code from Shopify's Dawn or Horizon themes into another platform: their licence
  allows use only for building Shopify themes.

## Sources (checked 2026-10-08)

- Shopify, performance best practices for themes: https://shopify.dev/docs/storefronts/themes/best-practices/performance
- Shopify, JSON templates and theme limits: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates and https://shopify.dev/docs/storefronts/themes/architecture/limits
- Shopify, alternate templates and the `view` parameter: https://shopify.dev/docs/storefronts/themes/architecture/templates/alternate-templates
- Shopify, theme blocks: https://shopify.dev/docs/storefronts/themes/architecture/blocks/theme-blocks
- Shopify, Theme Store requirements (Lighthouse 60 / 90, accessibility rules): https://shopify.dev/docs/storefronts/themes/store/requirements
- Shopify, theme accessibility best practices: https://shopify.dev/docs/storefronts/themes/best-practices/accessibility
- Shopify, Customer Privacy API: https://shopify.dev/docs/api/customer-privacy
- Shopify, Liquid `shop.enabled_payment_types` and `payment_type_svg_tag`: https://shopify.dev/docs/api/liquid/objects/shop
- web.dev, Core Web Vitals thresholds: https://web.dev/articles/vitals
- W3C, WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Liquid conventions also informed by Shopify's AI Toolkit (MIT), github.com/Shopify/shopify-ai-toolkit at 26d0623.
