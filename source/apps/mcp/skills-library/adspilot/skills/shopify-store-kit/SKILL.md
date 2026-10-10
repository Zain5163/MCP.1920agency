---
name: shopify-store-kit
description: "A ready, tested premium store design for Shopify's Horizon theme (4.x): five sections (photo hero, benefits strip, featured product, story block, fit help + FAQ), a shared style file, a design-settings recipe (fonts, sizes, colours, corners) and an example home page, plus the product-page and header/footer changes. Install it with {{PRODUCT_NAME}}'s theme tools on a hidden copy, adapt colours, fonts, photos and copy to the business, check screenshots, then publish on approval. Use when asked to design, redesign or make a Shopify store look premium or professional, build a high-converting home page, or when a store looks like a default template."
---

# Shopify store kit: a premium Horizon store in one pass

**Updated 2026-10-08.** Built and checked on a practice store after the owner rejected a
"default Horizon plus new text" redesign as amateur. Design evidence:
`get_skill web-ui-design` reference `references/premium-store-patterns.md` (9 premium
brands studied section by section). Theme mechanics: `get_skill shopify-theme-developer`.
What to say and which store problems cost sales: `get_skill store-builder`.
The buyer's country (payment methods such as cash on delivery, prices and tax, consumer
law, consent before tracking): `get_skill selling-by-country`.

## What is in the kit

| File (reference path under `references/theme/`) | Installs as | What it is |
|---|---|---|
| `snippets/ap-kit-base.liquid` | `snippets/ap-kit-base.liquid` | Shared styles: page width, labels, display type, buttons; makes Shopify's "Buy it now" an outline so Add to cart is the only solid button. **Install first.** |
| `sections/ap-hero.liquid` | `sections/ap-hero.liquid` | Full-bleed photo hero: separate phone crop, eager-loaded main image, adjustable darkening for readable text, 1–2 buttons (full width on phones) |
| `sections/ap-benefits.liquid` | `sections/ap-benefits.liquid` | Up to 4 real promises with line icons (delivery, returns, cash on delivery, secure, size, quality, help). No cards |
| `sections/ap-feature.liquid` | `sections/ap-feature.liquid` | One product, large: photo, price, real option values from the store, one short owner line |
| `sections/ap-story.liquid` | `sections/ap-story.liquid` | Image beside a short reason to buy (care, craft, origin); dark by default |
| `sections/ap-help.liquid` | `sections/ap-help.liquid` | Fit help (size chart rows as blocks + guide link) beside FAQ accordions |
| `templates/index.example.json` | `templates/index.json` | A worked home page (a snowboard shop): hero → benefits → product list → featured → story → fit help + FAQ. **Every text and value in it is an example: replace all of it.** |
| `config/settings_data.recipe.json` | keys merged into `config/settings_data.json` → `current` | The design system: fonts, sizes, heading case, palette, corners, card effects |

Read any file with `get_skill { name: "shopify-store-kit", reference: "references/theme/sections/ap-hero.liquid" }`.
The text between the BEGIN and END lines is the file, unchanged.

Every section has colour settings and an `image_picker` override, so the owner can change
photos, words and colours later in Shopify's theme editor without code.

## Install ({{PRODUCT_NAME}} app on the owner's computer: the theme tools)

1. **Ask first for what only the owner knows**: logo or brand name, brand colours (if any),
   real promises (delivery time and cost, returns, cash on delivery), the products to
   feature, and photos. Without a brand, propose a palette and fonts from
   `references/niche-presets.md` and get a yes **before** building.
2. The owner adds **Horizon** from the Theme Store if it is not in the theme library.
   `shopify_store_overview` lists the themes.
3. `shopify_theme_start_draft` with `from: "Horizon"` (or without `from` if Horizon is live).
   Check `config/settings_schema.json` → `theme_info` says Horizon 4.x; the recipe uses
   4.x setting ids (`color_palette` replaced colour schemes in 4.0).
4. Install the files with `shopify_theme_edit` (full `content`), base snippet first, then the
   five sections. Do not change the code unless the store needs it; adapt through settings.
5. **Design settings**: read the draft's `config/settings_data.json`, merge the recipe's keys
   into `current` (adapted: fonts and palette from the presets), write it back. Keep every
   other key.
6. **Home page**: write `templates/index.json` from the example, replacing every text,
   link (`shopify://collections/<handle>`, `shopify://pages/<handle>`,
   `shopify://products/<handle>`), product, chart row and FAQ answer with the store's real
   facts. Keep Horizon's own `product-list` section for the product row (set its
   `collection`, and the card gallery `image_ratio` to `square` or `portrait`).
7. **Photos**: the owner's own first. Otherwise licensed stock that allows commercial use
   (e.g. Unsplash), checked by eye: the right product and sport, no other brand's logo,
   room for the headline. Crop a 16:9 desktop (~2000 px wide, ~300 KB) and a 4:5 phone
   version (~900 px), save them in the draft's `assets/` as `ap-hero-desktop.jpg`,
   `ap-hero-mobile.jpg`, `ap-story.jpg`, and set alt text. The owner can swap them in
   the theme editor later.
8. **Product page, header, footer, collection**: `references/product-and-chrome.md`.
9. `shopify_theme_preview`, then **look at screenshots** at 390 px and 1440 px of home,
   a collection, a product and a page (the `web-ui-design` hard gate). Horizon scrolls
   inside the page, so a plain "full page" capture shows one screen: let the document
   scroll on phone captures, and enlarge the window on desktop captures. Fix what looks
   wrong, preview again.
10. Send the owner the preview link and screenshots. `shopify_theme_publish` only on approval.

On the hosted connector (AI apps online) the theme tools are not available yet: give the
owner these steps, or do the content parts (pages, policies, menus, collections) with the
content tools and leave the theme to the owner's {{PRODUCT_NAME}} app.

## Adapting it

- **Copy**: headline 1–5 words, concrete; one-line subhead with a real fact (range,
  delivery, price level). No "elevate", "unlock", "seamless". Benefits only for promises the
  store keeps, and the same terms as the shipping and refund policies.
- **Colours**: one neutral base, one ink, one accent used only for small labels, sale badges
  and focus. Check 4.5:1 contrast for text. White text on bright accents usually fails.
- **Fonts**: from Shopify's font library only (handles like `barlow_condensed_n7`); two
  families at most. Presets in `references/niche-presets.md`.
- **Sections**: drop any that the business has nothing true to say for (no story without
  a real reason; no fit help for products without sizes). Never add testimonials, ratings or
  counters that are not real.

## Never

- Present a default theme with new text as a redesign.
- Leave example copy, example sizes or example promises in a store.
- Use a photo showing another brand's logo, or one you have not looked at.
- Publish without the owner seeing the preview.
