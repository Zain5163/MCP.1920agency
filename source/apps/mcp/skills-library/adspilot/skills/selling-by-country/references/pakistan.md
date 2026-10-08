# Pakistan

**Updated 2026-10-08.** Practical guidance, not legal advice: confirm anything binding with
a local lawyer. The detailed cash-on-delivery playbook (delivery promise, WhatsApp,
gateways, refused parcels, cost per delivered order) stays in
`get_skill { name: "store-builder", reference: "references/cash-on-delivery.md" }`; this
file adds the rest of the market and does not repeat it.

## At a glance

| | |
|---|---|
| Currency | Pakistani rupee, PKR; written "Rs" or "Rs." before the amount (Rs 4,999) |
| Number format | Comma thousands and a full stop for decimals in English; prices are usually whole rupees. Large amounts are often said in lakh (100,000) |
| Price display | One price the buyer pays for the product; delivery charge or free-delivery threshold shown before ordering |
| Language | English and Urdu; Roman Urdu (Urdu in Latin letters) is common in ads and chat. Urdu script is right to left |
| How people pay | Cash on delivery still dominant for online shopping; bank transfer, wallets (JazzCash, Easypaisa), Raast and cards growing |
| Contact | WhatsApp is expected on every product page and in the footer |

## How people pay, and what to show at checkout

- Cash on delivery as the default option, with any COD fee shown before checkout.
- Digital options through a payment app the owner installs: bank account, JazzCash,
  Easypaisa, Raast, cards. Shopify Payments is not available in Pakistan; stores use
  manual payment methods and third-party gateways (sources in `cash-on-delivery.md`).
- A small discount for paying online can cut refused parcels; measure delivered orders.

The latest official cash-on-delivery share found is about 90% (State Bank of Pakistan,
FY2017-18). The SBP's 2025 figure that 93% of online e-commerce **digital** payments went
through accounts and wallets is a share of digital payments, not a COD share. Use the
store's own courier report instead of either figure.

## Prices, tax and discounts

- Show the price the buyer pays. Ask the owner how their prices treat sales tax; do not
  add tax lines on your own.
- "Was" prices only if the item really sold at that price; Daraz 11.11, 12.12 and White
  Friday set what buyers compare against (event-calendar).
- Delivery charge or free-delivery threshold stated once, the same everywhere.

## Consumer law that changes pages

Consumer protection in Pakistan is provincial (for example the Punjab Consumer Protection
Act 2005, and acts in Sindh, Khyber Pakhtunkhwa, Balochistan and Islamabad). We have not
summarised their e-commerce duties here from official text; treat the following as good
practice, and ask a local lawyer for binding questions:

- Business name, phone, WhatsApp and a city or address on the site.
- Exchange and return terms in plain words: how many days, who pays return delivery, what
  condition. Say whether the parcel may be opened before paying (ask the owner; couriers
  differ).
- Delivery time by city or region, only the owner's real times.
- No fake countdowns, fake "people viewing" counters or invented stock.

## Privacy, cookies and tracking

No comprehensive personal data protection law was confirmed as in force for this
reference; a Personal Data Protection Bill has been under discussion for years. Good
practice until that changes:

- A privacy policy that says which data is collected at checkout (name, phone, address),
  why, and that Meta, Google or TikTok tracking is used for ads.
- Ask the owner before adding any pixel or tag; buyers' phone numbers and addresses are
  personal data and must not be shared beyond the courier and payment providers.

## Accessibility

No web-accessibility law for private shops was confirmed. Follow WCAG 2.2 AA anyway
(web-ui-design): many buyers shop on low-cost Android phones on mobile data, so large
tap targets, readable text and a fast first screen matter for sales.

## Delivery, returns and trust

- Couriers with Shopify apps include TCS, Leopards, PostEx, Trax, M&P and BlueEx; the owner
  picks by delivered rate per city (`cash-on-delivery.md`).
- Trust signals that work: WhatsApp contact, real customer photos and reviews, an
  Instagram or Facebook page with real activity, "check before you pay" where the courier
  allows it, and clear exchange terms.
- Order confirmation by WhatsApp or call before dispatch cuts refused parcels.

## Language and localisation

- English for the store's structure is normal; Urdu or Roman Urdu for key reassurance
  lines (delivery, COD, exchange) where the audience prefers it. Ask the owner.
- If any page is in Urdu script, it must be right to left with a font that renders Urdu
  properly (Nastaliq or Naskh); test it on a phone.
- Phone fields accept 03xx-xxxxxxx and +92 3xx xxxxxxx; address fields need area and city.

## Ad-policy notes

- Special and restricted categories apply in Pakistan as elsewhere (`campaign-setup`,
  `get_playbook meta-ads`).
- Seasonal and religious sensitivities (Muharram, Ramadan, national tribute days,
  Valentine's Day): `get_skill event-calendar`.

## Page checklist

- [ ] Cash on delivery stated near the buy button, in the FAQ and the shipping policy.
- [ ] Delivery time by city and the delivery charge or threshold, consistent everywhere.
- [ ] Exchange and return terms in plain words.
- [ ] WhatsApp link on product pages and in the footer, answered in working hours.
- [ ] Phone and address fields that fit Pakistani formats.
- [ ] Privacy policy that mentions ad tracking; tracking added only with the owner's approval.
- [ ] No fake urgency, fake reviews or invented stock.

## Sources (checked 2026-10-08)

- Shopify Payments supported countries: https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries
- State Bank of Pakistan and other COD sources: see `cash-on-delivery.md`, section Sources
- Punjab Consumer Protection Act 2005 (Punjab Code): http://punjabcode.punjab.gov.pk/
