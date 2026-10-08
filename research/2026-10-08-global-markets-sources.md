# Sources for the selling-by-country skill (2026-10-08)

The owner (2026-10-08): the website and store skills must work "not only for Pakistan —
overall the world, every country: UK, USA, Germany, Australia, New Zealand, wherever users
can run ads". This note records how the market rules were sourced, what was decided, and
what is still open. The skill itself is
`source/apps/mcp/skills-library/adspilot/skills/selling-by-country/`.

## Decision: a separate skill, one reference per market

A shared `store-builder/references/markets.md` was considered and rejected. `get_skill`
serves a reference only through the skill that owns it, and the country rules are needed
by landing pages, WordPress sites, campaign set-up and theme work as much as by Shopify
stores; a separate skill is also listed by `list_skills`, so an AI asked about "selling in
Germany" finds it. One reference file per market keeps each read small. The existing
`store-builder/references/cash-on-delivery.md` stays where it is (other skills link to it)
and is linked from `pakistan.md`, `india.md` and `gulf.md`.

Markets covered: United States, Canada, United Kingdom, European Union (Germany, France,
Netherlands, Spain, Italy), Australia, New Zealand, Gulf (UAE, Saudi Arabia), India,
Pakistan. Each reference has the same sections (at a glance, payments, prices and tax,
consumer law, privacy and tracking, accessibility, delivery and trust, language, ad
policy, checklist, sources) so markets can be compared.

## How the facts were gathered

Six research passes on 2026-10-08 (US+Canada, UK, EU, Australia+NZ, Gulf+India+Pakistan,
platform facts), preferring official government and regulator pages (eur-lex,
legislation.gov.uk, gov.uk/CMA, ICO, FCA, ASA, ftc.gov, cppa.ca.gov, ada.gov, canada.ca,
Competition Bureau, CAI Québec, OQLF, ontario.ca, ACCC, OAIC, RBA, ASIC, consumerprotection.govt.nz,
comcom.govt.nz, privacy.org.nz, ird.govt.nz, u.ae, tax.gov.ae, SAMA, the Saudi E-Commerce
Law's official translation, PIB, gesetze-im-internet.de, service-public.fr, CNIL, AGCM,
BOE) and the platforms' own help pages (Shopify, Google, Meta, WooCommerce, Afterpay,
Tamara, Tabby).

Confidence labels in the references: **V** = read on the live official page that day
(the research's "Verified"); **R** = reported (law firm, news or search summary — often
because the official site blocked automated reading: accc.gov.au, ato.gov.au,
humanrights.gov.au, aph.gov.au, legislation.govt.nz, oag.ca.gov, leginfo.legislature.ca.gov,
ecfr.gov, federalregister.gov, uaelegislation.gov.ae, mc.gov.sa, sdaia.gov.sa, npci.org.in
and meity.gov.in all refused or failed); **Est.** = vendor or industry data; **U** = market
knowledge. Two points were re-checked directly by the writing session: the UK order-button
wording (Consumer Contracts Regulations 2013, reg 14(3)–(4)) and Rome I art. 6; also
Shopify's Customer Privacy API page and the `payment_type_svg_tag` Liquid filter.

## Licences

All text is our own wording. Laws and regulator guidance are cited and paraphrased; no
text was copied from any source. Payment-share figures from proprietary reports (Global
Payments/Worldpay, EHI, Currence, UK Finance, Australia Post, Mordor Intelligence) are cited
as facts with their source, not copied.

## Key findings that changed recently (worth re-checking first)

| Market | Finding | Status |
|---|---|---|
| US | FTC "click-to-cancel" rule vacated by the 8th Circuit on 8 July 2025; FTC advance notice of new rulemaking March 2026; no new rule by Oct 2026 | V (ANPRM), R (vacatur date) |
| US | California CCPA threshold $26.625 M; CPPA rules from 1 Jan 2026 / 1 Jan 2027 | V |
| UK | DMCC Act direct CMA enforcement since 6 April 2025; subscription regime announced for January 2027 | V |
| UK | Data (Use and Access) Act cookie exceptions (analytics) in force 5 Feb 2026; ads still need consent | V |
| UK | BNPL regulated by the FCA from 15 July 2026 | V |
| EU | Withdrawal button (art. 11a CRD) applies from 19 June 2026; Germany § 356a BGB | V |
| EU | Green-transition directive bans generic green claims from 27 Sept 2026 | V |
| EU | ODR platform closed 20 July 2025; €3 per-item duty on low-value parcels from 1 July 2026 | V |
| EU | Meta and Google stopped political/social-issue ads in the EU from October 2025 | V |
| AU | Card surcharges banned on eftpos, Mastercard, Visa from 1 Oct 2026 | V |
| AU | Unfair Trading Practices Act 2026 (dark patterns, drip pricing, subscriptions) from 1 July 2027 | R |
| NZ | IPP 3A in force 1 May 2026 | V |
| India | E-Commerce Amendment Rules 2026 from 1 Jan 2027 (30-day prior price, yearly dark-pattern self-audit) | V |
| India | DPDP Rules notified 13 Nov 2025; main duties 13 May 2027 (a proposal to shorten is pending) | V / R |
| UAE | PDPL executive regulations still not issued (some websites wrongly say they were) | R |
| Pakistan | Personal Data Protection Bill still pending in Parliament | R |

## Not checked / left open

- Official text for: California SB 478 and AB 2863; Ontario internet-agreement sections;
  QST rate; Cabinet Decision 66/2023 (UAE) article wording; Saudi Arabic-language article;
  RBI e-mandate and tokenisation limits; Punjab Consumer Protection Act sections.
- Meta's health-and-wellness lower-funnel restrictions (scope in 2026), and an explicit
  Meta statement that Conversions API events must follow consent (only implied by the
  Business Tools Terms).
- Whether Quebec's French-language website rule reaches sellers based outside Quebec.
- The EAA harmonised standard (EN 301 549 v4.1.1) citation in the Official Journal.
- No official payment-mix data for New Zealand, Pakistan (latest SBP COD share is 2018) or
  India's COD share.
- `event-calendar` has no dated sections for Canada, Australia or New Zealand; the skill
  now says so and tells the AI to confirm local dates.
- Markets not covered (Singapore, South Africa, Brazil, others): the skill tells the AI to
  say so and research from official sources first.
