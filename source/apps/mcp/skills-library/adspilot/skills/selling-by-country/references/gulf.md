# Gulf: United Arab Emirates and Saudi Arabia

**Updated 2026-10-08.** Practical guidance, not legal advice: confirm anything binding
with a lawyer in the UAE or Saudi Arabia. **V** = read on an official page or the official
legal text on 2026-10-08; **R** = reported by a law firm, news or search summary (several
official legislation sites blocked automated reading); **Est.** = market or vendor data;
**U** = market knowledge, not verified.

Cash-on-delivery handling (confirmation calls, refused parcels, cost per delivered order):
`get_skill { name: "store-builder", reference: "references/cash-on-delivery.md" }`.
Seasons, Ramadan and national days: `get_skill event-calendar`.

## At a glance

| | UAE | Saudi Arabia |
|---|---|---|
| Currency | UAE dirham, AED (written "AED 99" or "99 AED"; Arabic د.إ) | Saudi riyal, SAR (written "SAR 99" or "99 SAR"; Arabic ر.س) |
| VAT | 5% (V); prices displayed **including VAT** (R) | 15% since 1 July 2020; prices displayed including VAT (R) |
| Language | Arabic required on invoices (V) and key consumer information (R); English widely used alongside | Arabic for product information and invoices (R) |
| Returns | No-return notices banned except custom-made and perishable goods (R); defective goods repaired, replaced or refunded | **7 days** to cancel after receiving an unused product, buyer pays return cost unless agreed (V) |
| Shopify Payments | Available (V) | Not available (V) |

Shopify's dynamic tax-inclusive pricing treats both as tax-inclusive markets (V).

## How people pay, and what to show at checkout

- **UAE:** cards, Apple Pay, BNPL **Tabby** and **Tamara** (Tamara: UAE, Saudi Arabia,
  Kuwait, Bahrain, V; Tabby: UAE-licensed, V). Cash on delivery is declining but still
  used; estimates of its share range from under 15% to under 30% (Est., sources disagree).
- **Saudi Arabia:** electronic payments were 85% of retail payments in 2025, driven by
  **mada** debit cards at the till and online (SAMA, V). Show mada first, then Visa and
  Mastercard, Apple Pay, STC Pay, Tabby and Tamara where offered (U), and cash on delivery
  if the owner offers it.
- Shopify Payments is not available in Saudi Arabia: use a local gateway app the owner
  chooses (check the Shopify App Store for mada support).

## Prices, tax and discounts

- Display every price **including VAT**: UAE fines for not doing so are reported at
  AED 5,000 per violation (R). Saudi: the e-commerce law requires the total price
  including all charges, taxes and delivery before purchase (V, art. 7).
- Discounts and "was" prices must be real. Sale events (White Friday, Yellow Friday,
  Ramadan and Eid sales, Dubai Shopping Festival) are in event-calendar.

## Consumer law that changes pages

**UAE** (Federal Law 15 of 2020 on Consumer Protection as amended, Cabinet Decision 66 of
2023; e-commerce law Federal Decree-Law 14 of 2023):

- Invoices in Arabic (other languages may be added) (V). Warranty information and
  mandatory label information also in Arabic (R).
- The law covers goods sold through e-commerce platforms registered in the UAE (V).
- No "no return, no exchange" notices except for custom-made or perishable goods; the
  return, exchange and refund policy shown in Arabic and English (R).
- Defective goods: the supplier replaces, repairs or refunds at its own cost (R).

**Saudi Arabia** (E-Commerce Law, Royal Decree M/126, 2019) (V):

- The store shows its name, contact information and **commercial registration name and
  number** (art. 6), and is entered in the Commercial Register (art. 15). Stores
  authenticate on the Saudi Business Center platform, which replaced Maroof (R).
- Before purchase: contract terms, total price with all charges, payment and delivery
  arrangements, and any warranty (art. 7); an itemised invoice with delivery date and
  place (art. 8).
- **Cancellation within 7 days** of receiving the product if it has not been used; the
  buyer pays the cost unless agreed otherwise; exceptions include customised products,
  opened media and software, newspapers and books (art. 13).
- If delivery is more than **15 days late**, the buyer may cancel for a refund unless a
  later date was agreed (art. 14).
- An online advert binds the seller as part of the contract and must name the product,
  the provider and contact details (art. 10).

## Privacy, cookies and tracking

- **UAE:** the Personal Data Protection Law (Federal Decree-Law 45 of 2021) is in force
  and requires consent for processing with limited exceptions (V), but its **executive
  regulations had not been issued** as of September 2026 (R, several law firms); some
  websites wrongly say they were. No specific cookie rule was found. Dubai's DIFC and Abu
  Dhabi's ADGM free zones have their own data laws.
- **Saudi Arabia:** the Personal Data Protection Law is fully enforceable since
  14 Sept 2024; consent is one of its legal bases, and SDAIA has published privacy-notice
  guidance (R).
- Practice for both: a privacy notice (Arabic and English) naming the tracking used; ask
  the owner before adding pixels; consent before marketing messages.

## Accessibility

- No private-sector web-accessibility law was checked for this reference. Target WCAG
  2.2 AA, including right-to-left layouts (web-ui-design).

## Delivery, returns and trust

- Fast delivery is expected in the main cities; state times by emirate or city.
- Order confirmation calls or WhatsApp messages before dispatching COD orders.
- Trust: Arabic and English pages, local phone and WhatsApp, real reviews, Tabby or Tamara
  badges, the Saudi commercial registration details visible.

## Language and localisation

- Arabic pages right to left (`dir="rtl"`, `lang="ar"`), with an Arabic-capable font;
  check product, cart and checkout pages in Arabic.
- Phone fields: +971 (UAE), +966 (Saudi Arabia); addresses by emirate or city and area.
- Western digits are common online; follow the owner's existing brand practice.

## Ad-policy notes

- **UAE advertiser permit:** from 31 Jan 2026, people in the UAE who publish ads or
  promotional content on social media (paid or unpaid) need a Media Council advertiser
  permit; scope for a brand posting on its own account is not confirmed (R). Ask the
  owner whether they or their creators hold one.
- Meta special ad categories are optional for audiences outside the US, Canada and Europe
  (V); restricted goods and local law still apply.
- Ramadan and religious sensitivities: event-calendar section 6.

## Page checklist

- [ ] Prices include VAT, in AED or SAR; total with delivery before ordering.
- [ ] Arabic invoice and Arabic product information; Arabic and English return policy (UAE).
- [ ] Saudi: commercial registration name and number, 7-day cancellation, 15-day late-delivery rule.
- [ ] No "no return, no exchange" (UAE).
- [ ] mada (Saudi), Tabby and Tamara where offered; COD terms clear if offered.
- [ ] Right-to-left Arabic layout checked on a phone.
- [ ] Privacy notice; tracking only with the owner's approval.

## Sources (checked 2026-10-08)

- UAE Federal Tax Authority, VAT: https://tax.gov.ae/en/taxes/vat.aspx ; VAT-inclusive prices (WAM, Gulf News): https://www.wam.ae/en/article/hszr6ptm-fta-businesses-must-display-vat-inclusive-prices ; https://gulfnews.com/your-money/taxation/businesses-must-display-prices-inclusive-of-vat-1.2187508
- UAE government portal, consumer protection: https://u.ae/en/information-and-services/justice-safety-and-the-law/consumer-protection
- Clyde & Co, UAE consumer protection changes (2023): https://www.clydeco.com/en/insights/2023/10/changes-to-the-uae-consumer-protection-law-what-yo
- UAE data protection laws: https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws ; Ashurst, July 2026 update: https://www.ashurstperkinscoie.com/en/insights/data-bytes-67-your-emea-data-privacy-update-for-july-2026/
- UAE advertiser permit (Pinsent Masons): https://www.pinsentmasons.com/out-law/news/uae-influencer-licence-deadline-looms
- Saudi E-Commerce Law (official English translation): https://misa.gov.sa/app/uploads/2025/07/E-Commerce-Law.pdf
- ZATCA, VAT: https://zatca.gov.sa/en/RulesRegulations/VAT/Pages/default1.aspx
- SAMA, e-payments 2025: https://www.sama.gov.sa/en-us/mediacenter/news/pages/news-1139.aspx
- Saudi PDPL (Clyde & Co): https://www.clydeco.com/en/insights/2024/09/saudi-arabia-s-personal-data-protection-law-become
- Shopify Payments supported countries: https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries ; dynamic tax-inclusive pricing: https://help.shopify.com/en/manual/international/pricing/dynamic-tax-inclusive-pricing
- Tamara partners: https://tamara.co/en-ae/partners ; Tabby business: https://tabby.ai/en-AE/business
- UAE COD trend (estimates): https://www.mordorintelligence.com/industry-reports/united-arab-emirates-ecommerce-market/market-trends
