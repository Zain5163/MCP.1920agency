---
name: selling-by-country
description: "Make a store, landing page or website right for the country it sells to: the United States, Canada, the United Kingdom, the European Union (with Germany, France, Netherlands, Spain and Italy specifics), Australia, New Zealand, the Gulf (UAE, Saudi Arabia), India and Pakistan. Per market, with official sources: how people pay and what to show at checkout (cards, wallets, buy now pay later, iDEAL, UPI, mada, cash on delivery), how prices and tax are shown, currency and number formats, the consumer law that changes pages (returns and withdrawal rights, discount and 'was' prices, order-button wording, legal notice, reviews, fake urgency, subscriptions), privacy and cookie consent before any pixel or tag, accessibility law, delivery and returns norms, trust signals, language, and ad-policy notes. Use before building or changing any store, product page, landing page, checkout, policy page or tracking, whenever a country, currency or language comes up, and when a business starts selling abroad."
---

# Selling by country

**Updated 2026-10-08.** One method and one reference per market. The other website skills
(store-builder, landing-page-builder, shopify-theme-developer, web-ui-design,
wordpress-site-builder, store-platform-choice) and campaign-setup send you here to find
out what differs in the buyer's country. The conversion and design advice in those skills
holds everywhere; this skill adds payments, prices, law, privacy and local expectations.

**This is practical guidance, not legal advice.** Each rule carries its official source
and date. Laws change and depend on the business's facts: tell the owner to confirm
anything binding (legal notices, terms, withdrawal and guarantee wording, privacy notices,
subscription flows, tax registration) with a local lawyer or adviser. Never tell an owner
that a page "is compliant"; say which rules apply and what was done about each.

## 1. First decide the market (never assume one)

Ask, or confirm from what you already have (the ad account's target countries, the
store's currency and shipping zones, the domain), and confirm with the owner:

1. **Which countries are the buyers in?** Where will the store ship, or the service be
   offered? Consumers, businesses, or both?
2. **Where is the business registered**, and is it registered for VAT, GST or sales tax
   anywhere? (This decides the tax lines and the legal notice.)
3. **Currency and language(s)** of the store and the ads.
4. **Payment methods available to this business** (they depend on where it is
   registered and its gateway), and the ones buyers in the market expect.
5. **Platform:** Shopify, WooCommerce or another, and whether it sells subscriptions.
6. **Tracking:** which pixels, tags and analytics are or will be on the site, and whether
   there is a consent banner.
7. **Size:** staff and turnover, because some rules exempt small businesses (for example
   the EU Accessibility Act exempts micro-enterprises providing services; Australia's
   Privacy Act exempts most businesses with turnover of AUD 3 million or less).

Write it as one line before building:
**"<Business> sells <what> to <consumers/businesses> in <countries>, from <country of
registration>, priced in <currency>, paid by <methods>, on <platform>."**

When a business directs its selling at consumers in a country (local language, currency,
domain, shipping there, ads targeted there), that country's mandatory consumer rules
usually apply even if the business is elsewhere (in the EU: Rome I Regulation, Art. 6).
So the reference to read is the **buyer's** market, and for several markets, each one.

## 2. Read the reference for each market

`get_skill { name: "selling-by-country", reference: "references/<file>" }`

| Market | Reference | Most often wrong on a new store |
|---|---|---|
| United States | `references/united-states.md` | fake urgency and fake reviews; subscription sign-up and cancellation; "Do not sell or share" link; promised shipping times |
| Canada | `references/canada.md` | French for Quebec; sales tax shown; anti-spam consent on sign-up forms |
| United Kingdom | `references/united-kingdom.md` | prices without VAT; mandatory fees left out of the headline price; 14-day cancellation wording; cookies set before consent |
| European Union (Germany, France, Netherlands, Spain, Italy) | `references/european-union.md` | "was" price not the 30-day lowest; order-button wording; legal notice (Impressum); withdrawal information and button; product-safety details; cookie consent; local payment methods |
| Australia | `references/australia.md` | "no refunds" wording; prices not showing the single total price; card surcharges |
| New Zealand | `references/new-zealand.md` | "no refunds" wording; GST-exclusive prices to consumers |
| Gulf (UAE, Saudi Arabia) | `references/gulf.md` | prices without VAT; Arabic and right-to-left; local methods (mada, Tabby, Tamara); cash on delivery |
| India | `references/india.md` | total price and seller details on listings; dark patterns; UPI at checkout; cash on delivery |
| Pakistan | `references/pakistan.md` (and store-builder's `cash-on-delivery.md`) | cash-on-delivery terms; WhatsApp; delivery promise by city |

Every reference has the same sections, so you can compare markets: at a glance; how
people pay; prices, tax and discounts; consumer law that changes pages; privacy, cookies
and tracking; accessibility; delivery, returns and trust; language and localisation;
ad-policy notes; a page checklist; sources.

A market not listed (for example Singapore, South Africa, Brazil): say it is not covered
yet, apply the general rules below, research that country's consumer, privacy and tax
rules from official sources before giving specifics, and label anything unverified.

## 3. Rules that hold in every market

- **Show the full price honestly.** The price a buyer sees first includes every
  compulsory charge the market requires in it (tax in the UK, EU, Australia, New Zealand
  and the Gulf; all mandatory fees nearly everywhere). Delivery costs shown before the
  last step.
- **Discounts are real.** A "was" price was actually charged (and in the EU is the lowest
  price of the previous 30 days); a deadline is real and ends when it says; stock and
  "people viewing" claims are true or absent.
- **Reviews are real.** Never write, buy, filter out or invent reviews or ratings.
- **The buyer knows who they deal with:** business name, contact details and address (and
  the registration or VAT number where required) are easy to find.
- **Returns and guarantees state at least the legal minimum** for that market, never less.
- **Ask before adding tracking**, and set up consent where the market requires it
  (section 4).
- **Accessible pages:** WCAG 2.2 AA is the safe target everywhere (web-ui-design).
- **The ad and the page tell the same story**, and the page meets the ad platform's
  landing page rules (each platform's `get_playbook`).

## 4. Tracking and consent: what to ask before adding any pixel or tag

Tracking pixels (Meta, Google, TikTok and others) and analytics collect personal data.
Before adding or changing any of them, ask the owner, in plain words:

1. Which markets do visitors come from? (Decides whether consent is needed first.)
2. Is there a consent banner or consent tool already, and does it block tags until the
   visitor agrees? On Shopify: the owner's Customer privacy settings; on WordPress: a
   consent plugin.
3. Does the privacy policy name the ad platforms and analytics the site uses?
4. On Shopify, which Meta data-sharing level is chosen (Standard, Enhanced, Maximum)?
5. May I add <tag> to <pages>, which will send <events> to <platform>? (Wait for yes.)

Then apply the market's rule:

| Market | Before tracking |
|---|---|
| EU, UK | Consent **before** non-essential cookies, pixels and analytics fire; rejecting as easy as accepting; Google tags with Consent Mode; Meta pixel held until consent |
| US | Privacy notice; in states with privacy laws (California and others), a "Do Not Sell or Share My Personal Information" route that also honours the browser's Global Privacy Control signal, because ad pixels count as "sharing" |
| Canada | Meaningful consent under federal law; in Quebec, tracking technologies off by default unless the visitor turns them on |
| Australia, New Zealand | Privacy notice that names the tracking and its purpose; no general cookie-banner law, but regulators expect openness about pixels |
| Gulf, India, Pakistan | Privacy notice; the market reference gives the status of each data-protection law |

The Conversions API (server-side events) is still tracking: send events only for
visitors whose consent allows it where consent is required. Details and sources are in
each market's reference.

## 5. Selling to several markets from one store

- **Shopify:** the owner sets up Markets (countries, currencies, languages, domains or
  subfolders), tax-inclusive pricing per market, duties, payment methods and the cookie
  banner in the admin. Shopify adds `hreflang` links between market versions itself.
  Translation: Shopify's Translate & Adapt app or another the owner chooses. Theme side:
  `shopify-theme-developer`, "Selling in more than one country".
- **WooCommerce:** multi-currency and translation plugins, tax per country, and an EU
  VAT set-up where relevant: `wordpress-site-builder`, `references/woocommerce.md`.
- **Separate language versions** need `hreflang` links (Google Search Central,
  "Localized versions of your pages") and real translation by someone fluent, not raw
  machine output on legal or checkout text.
- **Where rules differ**, either show each market its own version (prices with or without
  tax, its own returns page) or meet the strictest market's rule everywhere where that is
  harmless (real "was" prices, no fake urgency, clear order button).
- **Policies per market:** one returns policy can cover several markets only if it meets
  the most generous legal minimum among them, or states the differences.

## 6. Ad-policy notes that affect landing pages

Do not repeat the playbooks; read them: `get_playbook meta-ads` (and google-ads,
tiktok-ads and others) and `get_skill campaign-setup`. Points that vary by country:

- **Special and restricted categories.** Ads about credit and financial products,
  employment, housing, and social issues, elections or politics have targeting limits and
  extra checks on Meta and Google; health, alcohol, gambling and weight-loss are
  restricted and vary by country.
- **Political and social-issue ads in the EU:** Meta and Google stopped serving them in
  the EU from October 2025 (see `european-union.md`).
- **Destination rules:** platforms reject landing pages that do not work, cannot be
  crawled, hide the business's identity or misrepresent the offer; shopping ads need
  visible return, shipping and contact information.
- **Local language:** ad and landing page in the same language.

## Never

- Assume the business sells in Pakistan, or in any country, without asking.
- Tell an owner that a page or policy is "compliant" or "legal", or state a legal
  conclusion without its source; recommend a local lawyer for anything binding.
- Invent legal details: company names, addresses, registration or VAT numbers, licence
  numbers, mediator names, guarantee terms. Ask the owner.
- Copy another store's terms, policies or legal notice.
- Add a pixel, tag or tracking app without the market's consent set-up and the owner's
  approval. Every change to a store still goes through the tools' approval and read-back.
- Quote a number (tax rate, threshold, fine) that the reference does not source; label
  estimates as estimates.
