---
name: landing-page-builder
description: "Plan, build and test a landing page for paid ad traffic, on Shopify, WordPress or plain HTML: pick the page type from the result the ad pays for (purchase, lead, WhatsApp chat, call), match the page to each ad, structure the first screen, forms and the call to action, keep it fast on phones, set up pixel and Conversions API events, and run a test plan. Use when asked to make a landing page, a sales page or offer page for an ad, a lead capture page, a page for a WhatsApp campaign, when ads get clicks but no results, or before sending traffic from a new campaign. Includes section-by-section blueprints in references/page-blueprints.md."
---

# Landing page builder (for ad traffic)

**Updated 2026-10-08.** Sources at the end. This skill is the build method. For the
principles of page conversion read `get_skill cro`; for the words, `copywriting`; for which
funnel fits the buyer's trust level (direct sale, lead magnet, call, quiz),
`conversion-path-builder`; for testing, `ab-testing`; for tracking in depth, `analytics`.
Do not repeat their advice here; apply it.

## 1. Start from the result the ad pays for

Use `get_skill campaign-setup` first: the campaign's objective, the conversion event and
the page must describe the same result. Then choose the page:

| The ad pays for | Page | The one action | Event that must fire |
|---|---|---|---|
| Online purchase (one product or a small range) | Product page, or a focused offer page that adds to cart | Add to cart → checkout | ViewContent, AddToCart, InitiateCheckout, Purchase |
| Online purchase, cash-on-delivery market | Product or offer page with an order form or a short checkout | Place the order | the same; Purchase on the thank-you page |
| A lead (service, high price, booking) | Lead page with a short form, or a Meta instant form (`create_lead_form`) when speed beats quality | Submit the form | Lead (on submit success, not on page view) |
| A WhatsApp or Messenger chat | Often **no page**: the ad opens the chat directly with a messaging objective. A page only when buyers need detail first | Tap "Chat on WhatsApp" | Contact (on the tap) |
| A phone call | Call page with tap-to-call | Tap the number | Contact |
| Sign-ups to an event or list | Short page with the date, value and a form | Register | CompleteRegistration or Lead |

If the page would only repeat the ad and the buyer needs no more information, a direct
route (instant form, chat, product page) usually beats a new page. Say so.

## 2. Ask before building (never invent these)

The offer and price; what is included; delivery or service area and times; payment
options; guarantee, exchange or refund terms; real proof (reviews, photos, client names
with permission, numbers the business can stand behind); the brand's logo, colours and
fonts; who answers leads or chats, and how fast; the ad or ads that will point here
(their headline, image and promise).

## 3. Message match, ad by ad

The visitor clicked a promise. The first screen must repeat it before saying anything new.

- [ ] The headline restates the ad's promise in the same words (offer, price or discount,
      product name). If three ads make three different promises, build three variants of
      the first screen, or one page per ad set.
- [ ] The first image shows the same product, person or scene as the ad.
- [ ] A discount, price or deadline in the ad appears on the page and in the cart, exactly.
- [ ] The ad's language and tone (Urdu, Roman Urdu, English) carry over.
- [ ] UTM parameters on every ad URL (`utm_source`, `utm_medium`, `utm_campaign`,
      `utm_content` per ad) so `shopify_sales` and analytics can attribute orders.

No controlled study gives a single "message match lifts conversion by X%" figure; treat it
as a strong practitioner rule and test it.

## 4. The first screen on a phone

About 83% of landing-page visits in Unbounce's 2024 benchmark came from mobile. Design for a
360–414 px wide screen first:

- [ ] Headline (the ad's promise), one line of support (who it is for, the main benefit or
      the proof), the image, and the call to action, all visible without scrolling.
- [ ] One primary action. Remove or reduce the site menu on dedicated landing pages; keep a
      way to contact the business.
- [ ] The trust line under the button: delivery time, cash on delivery or payment options,
      guarantee or exchange term, rating if real.
- [ ] Plain words at a reading level a 12-year-old follows: Unbounce found pages written at
      a 5th–7th grade level converted at 11.1%, 56% better than 8th–9th grade pages
      (vendor data, 2024).

The rest of the page follows the blueprint for its type (`references/page-blueprints.md`):
benefits, proof, details, objections answered (FAQ), the offer again, the action again.

## 5. Forms and order forms

- [ ] Only the fields the next step needs. For leads: name, phone or WhatsApp, and one
      qualifying question at most. For COD orders: name, phone, city, address, size/quantity.
      Baymard finds the average checkout shows 23.5 form elements where 12–14 suffice.
- [ ] Correct input types and autocomplete (`type="tel"`, `autocomplete="name"`, `tel`,
      `address-line1`), labels above fields, errors shown next to the field in plain words.
- [ ] Phone fields accept the formats people type (03xx…, +92…, spaces).
- [ ] After submit: a thank-you page or message that says what happens next and when
      ("We will WhatsApp you within 2 hours to confirm"). The conversion event fires there.
- [ ] Leads reach a person fast. A form nobody answers in hours wastes the ad spend.

## 6. Speed

Targets (web.dev, 75th percentile of real visits): LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.
A Deloitte study for Google found a 0.1 s faster mobile site lifted retail conversions by
8.4% (2019 data). Practical rules:

- [ ] The hero image is a real `<img>`, sized for phones, not lazy-loaded, with
      `fetchpriority="high"`; every image below is lazy-loaded and has width and height.
- [ ] No sliders or autoplay video in the first screen; one image or a short muted video
      with a poster image.
- [ ] Few scripts: the ad platform's pixel, analytics, and the chat button. No page-builder
      bloat, no unused apps.
- [ ] Test on PageSpeed Insights (mobile) and on a real mid-range phone on mobile data.

Depth: `get_skill core-web-vitals` and `get_skill performance`.

## 7. Tracking (before any ad points here)

- Meta: the pixel plus the Conversions API, with the same `event_id` on the browser and
  server copy of each event so Meta removes duplicates (it matches within 48 hours).
  Purchase needs `value` and `currency`; catalogue ads need `content_ids`.
  `check_ad_setup` says whether the pixel exists and receives events; `create_pixel`
  creates one (approval needed, cannot be deleted).
- Shopify: the "Facebook & Instagram" sales channel sets up the pixel and, at the
  "Enhanced" or "Maximum" data-sharing level, the Conversions API; the merchant chooses the
  level and discloses it in the privacy policy.
- WordPress/WooCommerce: the "Meta for WooCommerce" plugin installs the pixel and sends
  Conversions API events; check it does not double-count purchases.
- Plain HTML: the pixel snippet plus the event call on the success step; a server-side
  Conversions API needs a developer or a tag-manager server container.
- Other platforms (Google, TikTok, Snapchat): their tag and the matching event; see the
  platform's playbook (`get_playbook`).
- Fire Lead or Purchase on **success** only (thank-you page or confirmed submit), never on
  the button click or page load. Test with the platform's test-events tool before launch.

## 8. Building it, by platform

**Shopify.** Two routes:

1. A **page** with the content in HTML: `shopify_save_page` (hidden until approved, then
   `publish: true`). Fast to make, but it uses the theme's page template, so the site
   header and footer stay.
2. A **dedicated template** for a focused layout: `templates/page.<name>.json` or
   `templates/product.<name>.json` in a theme draft (`shopify_theme_start_draft`,
   `shopify_theme_edit`, `shopify_theme_preview` with `?view=<name>`, publish on approval).
   The owner then assigns the template to the page or product in the admin. Theme tools
   run only in the local AdsPilot app; on the hosted connector, give the owner the
   theme-editor steps. Method: `get_skill shopify-theme-developer`.

For a single product, the product page itself, improved (`shopify_update_product`,
`store-builder`), is often the best landing page: the cart and reviews already work.
An offer that needs a code or bundle: `shopify_create_discount` (always with an end date).

**WordPress.** A page built with the block editor and patterns, on a template without the
full menu, or a landing-page plugin already on the site. AdsPilot has no WordPress tools:
write the content and the steps, and the owner or developer builds it. See
`get_skill wordpress-site-builder`.

**Plain HTML.** One file, inline critical CSS, system or one self-hosted font, images in
WebP or AVIF with fallbacks, the form posting to a service the owner controls. Hosting and
publishing are the owner's; AdsPilot does not host pages.

## 9. Check three times, then test

1. **Plan check:** page type matches the campaign objective and event; every claim, price
   and term comes from the owner; the first screen matches each ad.
2. **Preview check:** on a phone and a computer: first screen, form or cart, success page,
   the event in the test-events tool, page speed.
3. **Live check:** after publishing (approved), open the live URL from the ad's preview
   (`preview_ad` where available), submit a test lead or order, confirm the event, then
   delete the test lead or cancel the test order.

**Test plan.** One change at a time, the biggest first: offer or headline, then first
image, then form length or call to action, then proof. Decide in advance the metric
(conversion rate on the result the ad pays for), the minimum sample (see `ab-testing`), and
the run time (at least one full week). Small stores rarely have traffic for true A/B tests:
then run before/after periods with the same ad spend and report it as such.

## Never

- Invent reviews, ratings, "people viewing" counters, fake countdowns or stock levels.
- Publish a page, template or discount without the owner's approval of the exact content.
- Promise delivery times, guarantees or prices the owner has not confirmed.
- Fire a conversion event on a page view or a click.
- Copy a competitor's page text or images.

## Sources (checked 2026-10-08)

- Unbounce, Conversion Benchmark Report 2024 (vendor data, medians): https://unbounce.com/conversion-benchmark-report/
- Baymard Institute, checkout form elements: https://baymard.com/lists/cart-abandonment-rate
- web.dev, Core Web Vitals and LCP optimisation: https://web.dev/articles/vitals, https://web.dev/articles/optimize-lcp
- Deloitte and 55 for Google, "Milliseconds make millions": https://web.dev/case-studies/milliseconds-make-millions
- Meta, pixel standard events and deduplication: https://developers.facebook.com/docs/meta-pixel/reference, https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events
- Shopify Help Center, Meta data sharing levels: https://help.shopify.com/en/manual/promoting-marketing/analyze-marketing/meta-data-sharing
- Shopify, alternate templates and `?view=`: https://shopify.dev/docs/storefronts/themes/architecture/templates/alternate-templates
