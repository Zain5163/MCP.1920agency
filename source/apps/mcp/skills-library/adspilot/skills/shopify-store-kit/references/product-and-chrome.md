# Product page, header, footer and collection changes (Horizon 4.x)

Applied on top of the kit sections. All edits are to JSON templates in the theme draft;
read each file first (block ids differ between installs) and keep every key you do not change.

## Product page (`templates/product.json`, section `main`, static block `product-details`)

Blocks inside `product-details` are listed in its `block_order`; add new `text` blocks to
its `blocks` and insert their ids into that order:

1. **Size-guide link right after the variant picker** (Baymard: buyers miss a guide that
   is anywhere else):
   `{"type": "text", "settings": {"text": "<p><a href=\"/pages/size-guide\">Size guide</a>: find your size</p>", "width": "100%", "type_preset": "rte"}}`
   Only for products with sizes or fit.
2. **One line right after `buy-buttons`** with the real delivery cost/time and returns:
   `{"type": "text", "settings": {"text": "<p><strong>Free delivery over $X</strong> · Ships in N working days · 30-day returns</p>", "width": "100%", "type_preset": "rte"}}`
   Use the store's real terms; for cash-on-delivery markets say so here.
3. **Accordions after the description** (Horizon `accordion` block with `_accordion-row`
   children, each holding a `text` block): "Delivery & returns" (with a link to
   `/policies/refund-policy`) and "Care" or "Materials". Rows closed by default.
4. **Price larger**: the `price` block inside the title group: `type_preset: "custom"`,
   `font: "var(--font-subheading--family)"`, `font_size: "1.5rem"` (allowed sizes are
   listed in `blocks/price.liquid`).
5. **Recommendations**: section `product-recommendations`: set the card gallery
   `image_ratio` to `square`; heading text e.g. "Pair it with".

The kit's base snippet already turns Shopify's "Buy it now" into an outline button.

## Header and announcement (`sections/header-group.json`)

- Announcement bar: **one** steady message with the real delivery and returns promise (do
  not rotate offers; phone users miss them). Block `_announcement`: `text`,
  `text_color`, `case: "uppercase"`, `letter_spacing: "loose"`; section
  `background_color` = the ink colour.
- Header settings: `show_country: false` and `show_language: false` for a single-market store.
- Menu `main-menu`: built with `shopify_save_menu` (home, main collections, size guide,
  FAQ, contact).
- Logo: the owner's logo file, or at least the real brand name as the store name
  (Shopify admin, Settings → Store details). Never leave a test or placeholder store name.

## Footer (`sections/footer-group.json`)

- Email sign-up heading with a reason to join, e.g. "First tracks" / "New arrivals and
  restocks. About one email a month."; `email-signup` block `border_radius: 2` to match the
  square buttons.
- Add a `menu` block (`settings.menu: "footer"`, `heading: "Help"`) to the footer block
  order. Build the `footer` menu with `shopify_save_menu` (FAQ, size guide, shipping,
  returns, privacy, contact).
- Remove the `social-links` block unless the store has real accounts; Horizon's defaults
  link to the platforms' home pages.

## Collection page (`templates/collection.json`)

- Every `_product-card-gallery` block: `image_ratio: "square"` (or `"portrait"` for tall
  products like boards, bottles, clothing on models). Mixed ratios make rows ragged.
- Collection descriptions are set with `shopify_save_collection`; keep them to one or two
  sentences with a real reason to buy.
