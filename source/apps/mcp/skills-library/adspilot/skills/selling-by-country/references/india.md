# India

**Updated 2026-10-08.** Practical guidance, not legal advice: confirm anything binding
with an Indian lawyer. **V** = read on an official page or official text on 2026-10-08;
**R** = reported by a law firm, news or search summary; **U** = market knowledge, not
verified.

Cash-on-delivery handling (confirmation, refused parcels, cost per delivered order):
`get_skill { name: "store-builder", reference: "references/cash-on-delivery.md" }`.
Festivals and sale seasons (Diwali, marketplace sales): `get_skill event-calendar`.

## At a glance

| | |
|---|---|
| Currency | Indian rupee, ₹; Indian digit grouping: ₹1,29,999 and amounts in lakh (1,00,000) and crore (1,00,00,000) |
| Price display | **MRP inclusive of all taxes** on packaged goods (R); the total price as a single figure with a breakup of charges and tax (V) |
| Discounts | From **1 Jan 2027**, a reduced price must show the prior price = lowest price of the previous 30 days (V) |
| Returns | Return, refund, exchange and warranty terms disclosed; no refusing returns of defective, wrong or late goods (V) |
| Language | English and Hindi most common; regional languages by audience |
| How people pay | UPI dominant; cards, wallets, net banking, EMI, cash on delivery |
| Shopify Payments | Not available; use a local gateway (V) |

## How people pay, and what to show at checkout

- **UPI** processed about 24 billion transactions in September 2026 (NPCI figures via
  news, R). Show UPI (QR and app intent on mobile) first, then cards, net banking,
  wallets and EMI options.
- Cash on delivery remains common for e-commerce (U; no official share found). If
  offered, follow `cash-on-delivery.md`, including order confirmation before dispatch.
- Gateways such as Razorpay, PayU and Cashfree are commonly used with Shopify and
  WooCommerce (U); the owner chooses and configures them.
- Recurring payments use RBI e-mandates with extra authentication above a set limit, and
  cards are stored as tokens (U; confirm limits on rbi.org.in before building
  subscriptions).

## Prices, tax and discounts

- **Consumer Protection (E-Commerce) Rules, 2020** (V): sellers give the total price as a
  single figure with a breakup of all charges and tax; no price manipulation for
  unreasonable profit; no discrimination between buyers of the same class; no pre-ticked
  consent boxes.
- **Legal Metrology:** e-commerce listings of packaged goods show the mandatory
  declarations: manufacturer, packer or importer name and address, **country of origin**,
  generic name, net quantity, **MRP inclusive of all taxes**, best-before date where
  relevant, consumer-care details (R).
- **Amendment Rules 2026, from 1 Jan 2027** (V): show both the reduced price and the prior
  price (the lowest of the 30 days before the announcement); disclose sponsored listings;
  no manipulated search results; importer details and country of origin for imports.

## Consumer law that changes pages

- **Seller details** (E-Commerce Rules, V): legal name, address, website and customer-care
  contacts; a **grievance officer** with name, designation and contact details, who
  acknowledges complaints within 48 hours and resolves them within one month;
  marketplace sellers also give their GSTIN and PAN to the platform.
- Return, refund, exchange, warranty and delivery terms, including who pays return
  shipping, disclosed before purchase; no refusing returns or refunds for defective,
  spurious, mis-described or late goods (V).
- No cancellation charges unless the store bears similar charges when it cancels (V).
- **Dark patterns** (CCPA Guidelines, 30 Nov 2023) (V) — 13 banned: false urgency, basket
  sneaking, confirm shaming, forced action, subscription trap, interface interference,
  bait and switch, drip pricing, disguised advertisement, nagging, trick wording, SaaS
  billing, rogue malware. Platforms were asked to self-audit in 2025; from 1 Jan 2027 a
  yearly self-audit and a displayed compliance certificate are required (V). In June 2026
  the authority fined an education platform for a pre-selected donation at checkout,
  confirm-shaming and forced data sharing, saying consent "cannot be assumed through
  pre-selected options" (V).
- Fake reviews posted as consumers are prohibited (V).

## Privacy, cookies and tracking

- **Digital Personal Data Protection Act 2023** with the **DPDP Rules 2025** (notified
  13 Nov 2025) (V): clear, separate, purpose-specific consent notices; rights requests
  answered within 90 days; penalties up to ₹250 crore. Phases (R): consent-manager rules
  from 13 Nov 2026; notice, consent, security and breach duties from **13 May 2027**. A
  proposal to bring the main date forward was not gazetted when checked (R): re-check.
- Practice now: a privacy notice naming the tracking used; unticked consent boxes;
  tracking added only with the owner's approval.

## Accessibility

- No private-sector web-accessibility rule was checked for this reference. Target WCAG
  2.2 AA (web-ui-design); many buyers use low-cost Android phones on mobile data.

## Delivery, returns and trust

- Delivery times by city and pin code, the same everywhere; COD availability by pin code.
- Trust: grievance officer and customer-care details, real reviews, UPI and card badges,
  clear return terms.

## Language and localisation

- English for structure; Hindi or regional languages for key reassurance lines where the
  audience prefers them (ask the owner).
- Phone fields: +91 and 10-digit mobile numbers; address with pin code and state.
- Prices with ₹ and Indian grouping; let the platform format money.

## Ad-policy notes

- Read the platform playbook. Advertising standards (ASCI) and influencer disclosure rules
  apply; not checked for this reference.
- Meta special ad categories are optional for audiences outside the US, Canada and Europe
  (V); restricted goods and local law still apply.

## Page checklist

- [ ] Total price as one figure with charges and tax; MRP inclusive of taxes where it applies.
- [ ] Country of origin and mandatory declarations on listings.
- [ ] Seller details and grievance officer on the site.
- [ ] Return, refund, exchange, warranty and delivery terms before purchase.
- [ ] None of the 13 dark patterns; no pre-ticked boxes; no drip pricing.
- [ ] From 1 Jan 2027: 30-day lowest prior price on discounts; sponsored labels.
- [ ] UPI first at checkout; COD terms if offered.
- [ ] Privacy notice; DPDP consent notices ready for May 2027.

## Sources (checked 2026-10-08)

- Consumer Protection (E-Commerce) Rules, 2020 (official text, PRS mirror): https://prsindia.org/files/bills_acts/bills_parliament/2021/Consumer%20Protection%20(E-Commerce)%20Rules,%202020.pdf
- PIB, E-Commerce Amendment Rules 2026 (10 Sep 2026): https://www.pib.gov.in/PressReleasePage.aspx?PRID=2308759
- PIB, Dark Patterns Guidelines 2023: https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=1983994 ; self-audit advisory (2025): https://www.pib.gov.in/PressReleasePage.aspx?PRID=2134765 ; enforcement (June 2026): https://www.pib.gov.in/PressReleasePage.aspx?PRID=2268302
- CCPA self-audit declarations: https://www.doca.gov.in/ccpa/slef-audit-companies-dark-pattern.php
- Legal Metrology online declarations (law firm summary): https://www.lkslaw.com/insights/articles/aiming-greater-transparency-on-sale-of-packaged-commodity-online
- PIB, DPDP Rules 2025: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190655
- DPDP timeline proposal (Chambers): https://chambers.com/articles/meity-plans-to-cut-short-dpdp-compliance-timeline-and-notify-cross-border-restrictions-for-sdfs
- NPCI UPI statistics: https://www.npci.org.in/what-we-do/upi/product-statistics
- Shopify Payments supported countries: https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries
