# Store conversion checklists, page by page

**Updated 2026-10-08.** Use with the store-builder skill: run `shopify_store_audit` and
`shopify_sales` first, find the weakest funnel step, then work through the checklist for
that page. Numbers carry their source; Baymard Institute and Unbounce figures are cited,
not copied (their research is proprietary). Re-check a figure before quoting it to a client.

## What the evidence says, in one table

| Finding | Number | Source |
|---|---|---|
| Average documented cart abandonment | **70.22%** (average of 50 studies) | Baymard, cart abandonment list, updated 2025-09 |
| Top reason for leaving at checkout (US shoppers, excluding "just browsing") | extra costs (delivery, tax, fees): **~40%** | Baymard 2025 survey |
| Next reasons | delivery too slow ~20%; did not trust the site with card details ~19%; forced account ~18%; checkout too long ~17%; errors ~17%; returns policy ~13%; could not see total cost upfront ~12%; not enough payment methods ~9% | Baymard 2025 (a Statista listing of the same survey shows figures 1–2 points different) |
| Checkout form size | average US checkout shows **23.5 form elements**; a good one needs **12–14** (7–8 fields) | Baymard |
| Product pages | **51%** of 344 large sites have mediocre or worse product page UX | Baymard product page benchmark |
| Mobile | **62%** of top mobile sites are mediocre or worse | Baymard mobile benchmark |
| Size information | **83%** of desktop / **87%** of mobile apparel sites give too little | Baymard, apparel size information |
| Images "in scale" | **42%** of test users tried to judge size from photos; 28% of sites had no in-scale image (2017 study) | Baymard, in-scale images |
| Speed and sales | 0.1 s faster mobile pages: **+8.4%** retail conversions (37 brands, 2019 data) | Deloitte/55 for Google, on web.dev |
| Landing page medians | e-commerce landing pages convert at a **4.2%** median; mobile brings ~2.5× the traffic but converts ~18% less | Unbounce Conversion Benchmark Report 2024 (vendor data) |

Avoid "53% leave if a page takes 3 seconds": it is a 2016 Google study of mostly publisher
sites, not shops.

## Home page (for visitors who arrive without a product in mind)

- [ ] First screen says what the store sells, to whom, and the main reason to buy here
      (delivery time, price level, quality, cash on delivery). One line each, no slogans.
- [ ] Best sellers or the main collections visible within one scroll on a phone.
- [ ] Announcement bar shows **today's** offer and the delivery promise; nothing expired.
- [ ] Search works and finds products by the words customers use (sizes, colours, local names).
- [ ] Contact route visible (WhatsApp or phone) in the header or footer.

## Collection pages

- [ ] Product cards show photo, name, price, "was" price only if real, and sold-out state.
- [ ] Filters for what buyers choose by (size, price, colour, type); sold-out sizes not shown
      as available.
- [ ] Sort by best selling as default for ad traffic; new arrivals when the season changes.
- [ ] 2 columns of cards on mobile, with the price readable without zooming.
- [ ] Collections made with `shopify_save_collection`, sorted by what sells (from `shopify_sales`).

## Product page (most ad traffic lands here)

Above the fold on a phone:

- [ ] Main photo loads at once; at least 4–6 photos: front, back/side, detail, in use or on
      body/foot, and one that shows scale.
- [ ] Name, price, and the variant selector (size, colour) with sold-out variants marked.
- [ ] One clear buy button; it stays reachable (sticky on mobile is fine if it does not cover
      content or the focused field).
- [ ] One line under the button with the delivery promise, payment options (including cash on
      delivery where offered) and the exchange or return term.

Below:

- [ ] Description in the buyer's words: material, fit, how to use or wear, care, what is
      in the box. Short paragraphs or bullets (`shopify_update_product`, with `copywriting`).
- [ ] Size guide linked next to the size selector, in every size system buyers use, plus
      "fits true to size / runs small" advice (`shopify_save_page` for the guide).
- [ ] Real reviews and customer photos only. Never invent ratings or counts.
- [ ] FAQ answers the objections that stop orders: delivery time by city, cash on delivery,
      exchange process, original or copy, warranty.
- [ ] Related products or "complete the look" to raise basket size.
- [ ] SEO title and description set (`shopify_update_product`).

## Cart

- [ ] Shows the total including delivery as early as possible (surprise costs are the
      first reason people leave). If delivery is free above a threshold, show how far the
      cart is from it.
- [ ] Easy to change quantity or size, remove an item, and return to shopping.
- [ ] Discount field present but quiet, so it does not send buyers off to hunt for codes.
- [ ] The offer created with `shopify_create_discount` (minimum quantity or subtotal, always
      with an end date) is applied and visible in the cart.

## Checkout (settings live in the owner's Shopify admin)

AdsPilot's tools do not change checkout settings. Give the owner these steps:

- [ ] Guest checkout allowed (customer accounts optional).
- [ ] Only the fields needed for delivery; phone required where couriers call before delivery.
- [ ] Payment options buyers expect in that country (see `cod-and-pakistan.md`).
- [ ] Shipping rates by zone with honest delivery times; the same terms as the policy pages
      (`shopify_save_policy`) and the product page.
- [ ] A test order placed on a development store, or a real one refunded, before ads run.

## Trust

- [ ] Contact details that work: WhatsApp, phone, email, and a city or address.
- [ ] Refund/exchange and shipping policies written in plain words (`shopify_save_policy`),
      linked in the footer (`shopify_save_menu`).
- [ ] About page with real people, real photos, how long the business has run.
- [ ] Social proof that can be checked: Instagram link, real reviews, order counts only if true.
- [ ] No fake countdown timers, fake "12 people are viewing" counters or invented scarcity.
      They break trust and, in many countries, consumer law.

## Mobile and speed

- [ ] Test on a real mid-range Android phone on mobile data, not only a desktop browser.
- [ ] Text at least 16 px; tap targets large enough (see web-ui-design); no horizontal scroll.
- [ ] Popups delayed or small; never covering the product on arrival.
- [ ] Apps the store does not use removed; speed work done through shopify-theme-developer.

## Sources

- Baymard Institute: https://baymard.com/lists/cart-abandonment-rate, https://baymard.com/research/checkout-usability,
  https://baymard.com/research/product-page, https://baymard.com/research/mcommerce-usability,
  https://baymard.com/blog/apparel-size-information, https://baymard.com/blog/in-scale-product-images
- Deloitte and 55 for Google, "Milliseconds make millions": https://web.dev/case-studies/milliseconds-make-millions
- Unbounce Conversion Benchmark Report: https://unbounce.com/conversion-benchmark-report/
- Shopify Help Center, manual payment methods and checkout settings: https://help.shopify.com/en/manual/payments/manual-payments
