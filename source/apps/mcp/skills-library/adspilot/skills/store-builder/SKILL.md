---
name: store-builder
description: "Build, fix and improve a Shopify store so more visitors buy: audit it with real data, fix what costs the most sales first (trust, delivery and returns, product pages, sizes, offers, banners, speed), make the changes with AdsPilot's Shopify tools (product pages, store pages, discounts, theme drafts with preview and approved publish), check them three times, and measure the result against sales and ads. Use when asked to improve a store's conversion rate, set up or redesign a Shopify store, fix a product page, add an FAQ or size guide, change a banner, create a bundle or free-delivery offer, or when ads get clicks but the store does not sell. Works for any country: it asks which markets the store sells to and applies their payment, price, legal and consent rules from selling-by-country. References: page-by-page conversion checklists with sources, and cash-on-delivery stores (Pakistan, India, the Gulf and similar markets)."
---

# Store builder: a store that turns ad clicks into orders

Ads bring visitors; the store decides whether they buy. When cost per purchase rises
while the ads' click-through holds, the store is usually the cause. This skill is the
order of work and the safe way to change a live store with AdsPilot.

**First, the market.** Ask which countries the store sells to (and from where) if it is
not already known; never assume one. Then read `get_skill selling-by-country` and its
reference for each market: how people there pay, how prices and tax are shown, the
consumer law that changes pages (returns, discounts, order button, legal notice), and the
consent needed before any tracking. Everything below applies in every market; that skill
says what differs.

Also read: `get_skill cro` (page conversion principles), `copywriting` and
`copy-editing` (the words), `offers` (bundles and guarantees), `event-calendar`
(seasonal offers and banners), and `meta-account-manager` (the ads side). For theme
code and speed: `shopify-theme-developer`; for a page built for one ad or offer:
`landing-page-builder`; for the look: `web-ui-design`.

Reference files: `references/conversion-checklists.md` (home, collection, product page,
cart, checkout, trust and mobile checklists, with the evidence and its sources) and
`references/cash-on-delivery.md` (cash-on-delivery markets such as Pakistan, India and
the Gulf: delivery promise, WhatsApp, payments, refused parcels, cost per delivered order).

## 1. Measure before touching anything

1. `shopify_store_overview` and `shopify_store_audit`: thin product pages, sold-out
   items still listed, low margins, missing policies, missing FAQ / size guide / contact,
   active discount codes.
2. `shopify_sales` (up to 60 days): orders, average order, items per order, refunds,
   which source each order came from. Compare it with the ad platform's purchases.
3. The ad platform's funnel for the same period: landing page views, add to cart,
   checkout started, purchases (see `meta-account-manager/references/structure-and-metrics.md`).
   **The worst step tells you where to work:** few add-to-carts = the product page and
   offer; carts but few checkouts = surprise costs or delivery terms; checkouts but few
   purchases = the checkout and payment options.
4. Look at the live store yourself, on a phone first: banners and their dates, the
   delivery promise, the size selector, photos, how fast it loads.

Write the findings as a short list ranked by **expected effect on sales ÷ effort**, and
show it to the owner before changing anything.

## 2. What usually costs the most sales (fix in roughly this order)

| Area | What good looks like | AdsPilot tool |
|---|---|---|
| **Delivery and returns clarity** | One delivery promise everywhere (time, cost, free-delivery threshold); returns or exchange terms in plain words that meet at least the buyer's legal minimum (for example the 14-day withdrawal right in the EU and UK; see selling-by-country); the payment methods that market expects stated where they apply (cash on delivery, buy now pay later, local methods). Contradicting terms (two different free-delivery limits) cost trust | `shopify_save_policy` (refund, shipping), `shopify_save_page` (FAQ), theme draft (announcement bar, product page text) |
| **Out-of-date banners** | Banners match today's offer; an expired sale banner says "this store is not looked after" | theme draft: usually `sections/header-group.json` or `sections/announcement-bar.liquid` |
| **Product page photos** | Several photos per product: angles, detail, on-body/on-foot, scale. Clothing and footwear buyers judge fit and finish from photos | the store owner uploads; the audit lists products with fewer than 3 |
| **Size help** | A size guide next to the size selector, in every system the buyers use (for footwear: cm, EU, UK, US, local), and how the item fits | `shopify_save_page` (size guide) + theme draft (link near the selector in `templates/product.json` / the product section) |
| **Sold-out sizes** | Hidden or clearly marked; never advertised | the audit lists them; hide a sold-out product with `shopify_update_product` (status DRAFT), and stop the ads that show it |
| **Product descriptions** | What it is made of, how it fits, how to wear it, what makes it worth the price, care; in the buyer's words | `shopify_update_product` (with `copywriting`) |
| **Offer and basket size** | A reason to buy more than one (two-item price, free delivery above a threshold that sits above one item's price) | `shopify_create_discount` (minimum quantity or subtotal, always with an end date) |
| **Trust signals** | Real reviews and customer photos (only real ones), the payment and delivery badges buyers in that market recognise, contact details, and the contact route that market uses (WhatsApp in Pakistan, India and the Gulf; phone, email or chat in most card-first markets) | theme draft (a snippet near the add-to-cart button) |
| **FAQ** | Delivery time, payment options (cash on delivery where offered), returns or exchanges, sizes, care: answered in one place | `shopify_save_page` |
| **Country rules on the page** | Prices shown with or without tax as the market expects; "was" prices that meet its rule (EU: the lowest price of the last 30 days); legal notice details where required (Germany's Impressum); returns wording; no fake urgency. Details per market: `selling-by-country` | `shopify_save_page`, `shopify_save_policy`, theme draft; tax display and checkout settings are in the owner's admin |
| **Speed and mobile layout** | Fast on a mid-range phone on mobile data; the add-to-cart button visible without hunting | theme draft (large images, unused apps' scripts); measure before and after |
| **Public discount codes** | Codes meant for some customers are not listed where everyone can see them | theme draft or app settings; `shopify_end_discount` for codes that leaked |

Payment methods (cards, wallets, buy now pay later, local methods, cash on delivery),
tax display, markets and currencies, the cookie banner, shipping rates and checkout
settings are in the store owner's Shopify admin, not in AdsPilot's tools: say so and give
the steps.

## 3. Making changes safely (every change, every store)

- **Content** (products, pages, collections, menus, policies, discounts): the tool shows a before/after summary; nothing
  happens without the owner's approval; the current version is backed up; the result is read
  back. Pages are saved as hidden drafts unless publishing is approved.
- **Theme**: never edit the live theme. The theme tools work only in the AdsPilot app on
  the owner's computer; on the hosted connector, give the owner theme-editor steps instead
  (details in `shopify-theme-developer`).
  1. `shopify_theme_start_draft` (downloads the live theme as a backup, makes a copy);
  2. `shopify_theme_read`, then `shopify_theme_edit` with an exact find-and-replace;
  3. `shopify_theme_preview` → send the owner the preview link;
  4. `shopify_theme_publish` only after the owner has looked and approved;
  5. `shopify_theme_rollback` if anything goes wrong.
- **Where things live in the theme** (announcement bar, product page, home page, colours,
  words, new snippets), how to build a landing-page template, and speed fixes:
  `get_skill shopify-theme-developer`.
- Prefer changing settings and block text in `.json` files over editing Liquid code.
  Small, reversible edits beat a redesign.

## 4. Check three times before anything goes live

1. **Plan:** each change tied to a finding and to what the owner asked; prices, claims and
   terms checked against the live store and the business's real policies.
2. **Preview:** the preview link checked on a phone and a computer: the changed page, a
   product page, the cart, and the path to checkout. On a development store, place a test order.
3. **After publishing:** read back (the tools do), open the live page, and confirm the
   change is there and nothing else moved.

Never call a change done without reading it back.

## 5. Measure the result

Compare 7 and 14 days before and after, with the same ad spend where possible: add to
cart ÷ landing page views, checkout ÷ add to cart, purchases, average order, refunds and
returns, and refused deliveries in cash-on-delivery stores. One change at a time where you can, so the effect is attributable.
Keep what helps; roll back what hurts. Add a field note to the meta-account-manager skill
(`references/field-notes.md`) when the numbers prove something, without naming the business.

## 6. Building a new store

Ask first for what only the owner knows: the countries it will sell to and the currency;
the products (names, prices, sizes, real photos); delivery times and costs; the return or
exchange terms; payment methods; contact details; and the business details the market
requires on the site (legal name, address, registration or VAT number where required; see
selling-by-country). Never fill those in yourself. Then, in this order, each step approved by the owner:

1. **Theme:** for a premium look in one pass, install `get_skill shopify-store-kit` (Horizon
   sections, design settings, example home page). Otherwise:
   `shopify_theme_start_draft` with `from` set to one of Shopify's free themes
   already on the store (e.g. "Horizon"; the owner adds it from the Theme Store if missing),
   or without `from` to improve the current one. Edit colours, fonts, logo text, the home
   page and the announcement bar in the draft; preview; publish only after the owner looks.
2. **Products:** `shopify_create_product`, hidden as drafts first (`visible: false`): options
   such as Size, one variant per size with its price, a "was" price only if it is real, photos
   from public image URLs, a description written with `copywriting`. Make them visible with
   `shopify_update_product` (status ACTIVE) once the owner has checked them.
3. **Collections:** `shopify_save_collection`, hand-picked (e.g. "Boots", "Best sellers"),
   `publish: true` when ready.
4. **Pages:** `shopify_save_page`: FAQ, size guide, about, contact, delivery and returns.
5. **Policies:** `shopify_save_policy`: refund and shipping at least, in the owner's real
   terms and never below the market's legal minimum; privacy, terms and legal notice where
   the market needs them (selling-by-country). Recommend the owner has a local adviser
   check binding legal text.
6. **Menus:** `shopify_save_menu`: `main-menu` (home, the collections, FAQ, contact) and
   `footer` (policies, size guide, contact). Links: `collection:<handle>`, `page:<handle>`,
   `product:<handle>`, `policy:refund`, `home`, `catalog`, `search`, or an address.
7. **Offer:** `shopify_create_discount` for a clear first offer, always with an end date.
8. **The owner, in the admin:** payments (the methods buyers in that market expect, from
   selling-by-country), shipping rates, taxes (prices including tax where the market
   requires it), markets and currencies if it sells abroad, the cookie banner and privacy
   settings where required, stock quantities, the domain, and removing the store password.
9. **Test order** on a development store, then the three checks below, then ads.

Run `shopify_store_audit` at the end: it should come back with no high findings.

## Never

- Publish a theme, page or discount without the owner's approval of the exact change.
- Invent reviews, customer photos, ratings, stock levels or delivery promises.
- Edit the live theme directly, or leave a store with two different delivery terms.
- Leave a discount without an end date, or show a "was" price that breaks the market's
  rule (in the EU, the lowest price of the previous 30 days).
- Add a pixel, tag or tracking app without the consent set-up the market needs and the
  owner's approval.
- Tell the owner a store is "legally compliant": point out what the market's rules ask,
  with sources, and suggest a local lawyer for anything binding.
