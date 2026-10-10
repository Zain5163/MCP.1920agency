# WooCommerce store checklist (for ad traffic)

**Updated 2026-10-08** (WooCommerce 11.2). Page-level conversion advice is shared with
Shopify stores and lives in one place: `get_skill store-builder`, references
`conversion-checklists.md` and `cash-on-delivery.md`. This file adds only what is specific
to WooCommerce.

**What {{PRODUCT_NAME}} can do here** (every change with the user's approval on an exact summary,
the previous version saved first, the result read back): read products with
`woocommerce_products`; change a product's name, descriptions, regular and sale price and
sale dates with `woocommerce_update_product` (variable products are priced per variation);
put an earlier version back with `wordpress_restore_backup`. The approval summary states
the store currency and whether WooCommerce prices are entered including or excluding tax
(the `woocommerce_prices_include_tax` setting): before approving a price, check it against
the market's rule in `selling-by-country` (tax-inclusive shelf prices in the UK, EU,
Australia, New Zealand and the Gulf; a "was" price that was really charged, in the EU the
lowest of the last 30 days). Product changes need a Shop Manager or Administrator login.
Everything in the settings table below (checkout, payments, tax, shipping, coupons) is
done by the owner or developer, on staging first; {{PRODUCT_NAME}} gives the steps.

## Settings that decide whether ad traffic buys

| Area | Where (WooCommerce admin) | Good setting |
|---|---|---|
| Guest checkout | Settings > Accounts & Privacy | Allow checkout without an account |
| Checkout type | Pages > Checkout (block or `[woocommerce_checkout]` shortcode) | Checkout block for new stores; keep classic only if a needed plugin requires it |
| Checkout fields | Block checkout settings in the Site Editor; extra fields through the Additional Checkout Fields API (8.9+) | Only what delivery needs; phone required only if couriers call |
| Payments | Settings > Payments | The methods buyers in that market expect (`get_skill selling-by-country`): cards and wallets, buy now pay later, local methods, or cash on delivery (built in, with any fee stated) in COD markets |
| Tax | Settings > Tax (enable taxes in Settings > General) | "Prices entered with tax" and "Display prices in the shop" set to include tax where the market expects it (UK, EU, Australia, New Zealand, the Gulf); tax added at checkout in the US and Canada; rates per country or state |
| Final order button | Checkout block settings | Wording that says the order means paying where the market requires it (EU and UK; "zahlungspflichtig bestellen" in Germany) |
| Privacy and consent | Settings > Accounts & Privacy (privacy policy page); a consent plugin | Privacy policy page set; pixel and analytics blocked until consent where the market requires it |
| Shipping | Settings > Shipping > zones | Rates and times by zone, matching the product page and the shipping policy |
| Free shipping threshold | A "Free shipping" method with a minimum order amount | Above one item's price, shown on the cart |
| Coupons | Marketing > Coupons | Always with an expiry date; not listed publicly unless meant for everyone |
| Stock | Products > Inventory | Out-of-stock variations hidden or clearly marked (Settings > Products > Inventory) |
| Store notice | Site Editor or Customizer, depending on theme | Today's offer only; remove when it ends |
| Order storage | Settings > Advanced > Features | High-Performance Order Storage on, all plugins compatible |

## Product pages

- Variable products: one attribute per choice buyers make (Size, Colour); a variation per
  combination with its own price, stock and image.
- Gallery: 4–6 photos including scale and detail; the main image not lazy-loaded.
- Short description (next to the price) carries the delivery, payment and exchange line;
  the long description carries materials, fit and care (`woocommerce_update_product`, with
  `copywriting`; never invent specifications).
- Size guide: a page linked next to the variation selector (`wordpress_save_content` as a
  draft, then `wordpress_publish_content`).
- Reviews: WooCommerce's built-in product reviews, "verified owner" label on; real only.
- Related products and cross-sells set by hand for best sellers.

## Speed, store-specific

- Cart, checkout and My Account must never be page-cached; most caching plugins and hosts
  exclude them automatically, check anyway.
- Cart fragments (the mini-cart refresh script) can slow every page; block themes and
  current WooCommerce versions handle this better, so check before adding a plugin to
  disable it.
- Product image sizes set in the theme or Settings to the sizes actually shown.
- A persistent object cache (Redis or Memcached) helps admin and checkout speed on larger stores.

## Tracking

- "Meta for WooCommerce" (by Meta): pixel, Conversions API and catalogue sync. Test in
  Events Manager's test events: ViewContent on product, AddToCart, InitiateCheckout,
  Purchase on the order-received page with value and currency, each once.
- Google: Google's official "Google for WooCommerce" listing or Site Kit, one tag only.
- UTM parameters on every ad link, and WooCommerce's order attribution (Orders list, "Origin")
  to compare orders with what the ad platforms report.

## Cash-on-delivery stores

- Enable Cash on delivery in Settings > Payments, choose the shipping methods it applies to,
  and write the instructions buyers see (for example "Pay the courier in cash. We will call
  or WhatsApp to confirm before dispatch.").
- Order status: COD orders arrive as "Processing"; the owner marks them "Completed" on
  delivery. Refused parcels should be marked cancelled or refunded so sales reports are honest.
- Everything else (delivery promise, WhatsApp, confirmation, cost per delivered order):
  `store-builder` reference `cash-on-delivery.md`.

## Selling to several countries

- Currencies and languages need plugins (a multi-currency plugin and a translation
  plugin); choose maintained ones, one of each, and check they add `hreflang` links
  between language versions.
- EU stores selling across borders above the EU threshold charge the buyer's country's VAT
  (One-Stop Shop); tax rates per country go in Settings > Tax. Rules and sources:
  `selling-by-country`, reference `european-union.md`.
- Policies, legal notice and returns wording per market: `selling-by-country`.

## Sources (checked 2026-10-08; cited, not copied)

- {{PRODUCT_NAME}} connector research (WooCommerce REST v3 with Application Passwords, the tax setting): the {{PRODUCT_NAME}} team's WordPress connector research note (2026-10-08), kept with the product's internal documents

- WooCommerce 11.0 release: https://developer.woocommerce.com/2026/08/04/woocommerce-11-0/
- Cart and Checkout blocks default since 8.3, HPOS default since 8.2: https://developer.woocommerce.com/2023/10/10/woocommerce-8-2-0-released/
- Additional checkout fields API: https://developer.woocommerce.com/docs/block-development/cart-and-checkout-blocks/how-to-additional-checkout-fields-guide/
- Meta for WooCommerce on wordpress.org: https://wordpress.org/plugins/facebook-for-woocommerce/
