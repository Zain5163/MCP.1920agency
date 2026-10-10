# Cash-on-delivery stores (with Pakistan specifics)

**Updated 2026-10-08.** For stores where many buyers pay the courier at the door: Pakistan,
much of South Asia, the Gulf, parts of Africa and Latin America. In these markets the
conversion problem has two halves: getting the order, and getting the order **accepted at
the door**. A store that maximises orders but ships parcels that come back loses money on
both delivery legs.

This file is one market pattern, not the default. The rest of each market's rules
(prices and tax, consumer law, privacy, payments) are in `get_skill selling-by-country`:
references `pakistan.md`, `india.md` and `gulf.md`. In card-first markets (the US, Canada,
the UK, the EU, Australia, New Zealand) buyers expect cards, wallets and buy now pay later;
do not add cash on delivery there unless the owner asks for it.

## What is known (and how well)

| Fact | Confidence | Source |
|---|---|---|
| Shopify Payments is not available in Pakistan; stores use cash on delivery and third-party gateways | Verified | help.shopify.com, Shopify Payments supported countries |
| Cash on delivery is a built-in "manual payment method" on Shopify; such orders stay unpaid until the merchant marks them paid | Verified | help.shopify.com, manual payments |
| About **90%** of Pakistan's e-commerce transactions were cash on delivery | Verified, but **2018** (State Bank of Pakistan annual review FY2017-18, reported by The News) | No newer official COD share found |
| Digital payments are growing fast: account and wallet channels made **93%** of online e-commerce **digital** payments in FY25 | Verified (SBP press release, 3 Nov 2025) | This is a share of digital payments, **not** evidence that COD fell to a few percent |
| COD parcels refused or returned ("RTO") commonly **25–30%**, sometimes over 40% | **Industry estimate only** (gateway and logistics vendors' blogs, 2025–2026) | No primary dataset; use the store's own courier report instead |
| Pakistan: 117 M internet users; Meta ads reach ~53 M on Facebook, ~22 M on Instagram; TikTok ~80 M adults | Verified (DataReportal Digital 2026 Pakistan, Oct 2025 data) | Ad-reach figures are platform estimates |

The store's own numbers beat every figure above: ask for the courier's delivered / returned
report for the last 30–60 days and compare with `shopify_sales` (orders, cancellations).

## Page and offer checklist for COD buyers

- [ ] "Cash on delivery available" stated on the product page next to the buy button, in
      the FAQ, and in the shipping policy (`shopify_save_policy`), with any COD fee shown
      before checkout (an unexpected fee at checkout is the top abandonment reason).
- [ ] Delivery time by city or region in days ("Karachi, Lahore, Islamabad: 2–3 working
      days; other cities: 3–5"), the same everywhere it appears. Only the owner's real times.
- [ ] Delivery charge or free-delivery threshold stated once, consistently; the threshold
      sits above one item's price so it lifts the basket (`shopify_create_discount`, free
      shipping above a minimum, with an end date).
- [ ] Exchange and return terms in plain words: how many days, who pays the return
      delivery, what condition. Buyers in COD markets fear being stuck with a wrong size.
- [ ] Can the buyer open the parcel before paying? If the courier allows it, saying so
      raises trust; if not, say how exchanges work instead. Ask the owner; never assume.
- [ ] WhatsApp contact on every product page and in the footer (a link to `https://wa.me/<number>`),
      answered within working hours. Many buyers confirm before ordering.
- [ ] Prices in the local currency with no conversion surprises; Urdu or the buyers'
      language for key terms where the audience prefers it (ask the owner).
- [ ] Phone number required at checkout (couriers call), address fields that fit local
      addresses (area, city), and a note field for directions.
- [ ] For digital payment, the gateways Pakistani buyers use (bank account, JazzCash,
      Easypaisa, Raast, cards) through a Shopify payment app the owner chooses. Safepay
      lists Shopify apps; check the App Store for current options. The owner installs and
      configures payments in the admin: {{PRODUCT_NAME}} cannot.

## Reducing refused deliveries (the other half of conversion)

These are owner operations, outside {{PRODUCT_NAME}}'s tools. Recommend them, do not claim them:

1. **Order confirmation** by WhatsApp message or call before dispatch, especially for first
   orders and high-value carts. Unconfirmed orders are held, not shipped.
2. **Clear product truth**: photos and size guide that match what arrives. Wrong size and
   "not as pictured" are the usual refusal reasons.
3. **Fast dispatch**: the longer the wait, the more buyers change their mind.
4. **Courier choice by city**, using the store's own delivered-rate per courier. Courier
   integration apps for Shopify in Pakistan list TCS, Leopards, PostEx, Trax, M&P, BlueEx
   and others; the owner picks.
5. **Small prepayment incentive** (for example a discount for paying online) tested against
   order volume; measure delivered orders, not placed orders.

## Measuring a COD store honestly

- Cost per **delivered** order = ad spend ÷ delivered orders, not ÷ purchases reported by Meta.
- Meta's Purchase event fires when the order is placed; refused parcels still count there.
  Report both numbers to the owner (see meta-account-manager for the ads side).
- Track per change: order rate (orders ÷ sessions), confirmation rate, delivered rate.
  A change that raises orders but lowers delivered rate may lose money.

## Sources

- Shopify Payments supported countries: https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries
- Shopify manual payment methods (COD): https://help.shopify.com/en/manual/payments/manual-payments
- The News, 20 Oct 2018, citing SBP FY2017-18: https://www.thenews.com.pk/print/382936-online-shopping-up-94-percent-to-rs40-billion-in-fy2018
- State Bank of Pakistan press release, 3 Nov 2025: http://www.sbp.org.pk/assets/documents/press-release/Pr-03-Nov-2025.pdf
- DataReportal, Digital 2026 Pakistan: https://datareportal.com/reports/digital-2026-pakistan
- Safepay on the Shopify App Store: https://apps.shopify.com/safepay-checkout-onsite
- Courier apps (examples): https://apps.shopify.com/universal-courier-pakistan, https://apps.shopify.com/logistaan
