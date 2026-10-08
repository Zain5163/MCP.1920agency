---
name: store-platform-choice
description: "Help a business choose where to sell online before building anything: Shopify, WooCommerce (WordPress), a simpler site builder (Wix, Squarespace), a marketplace, or social selling with WhatsApp and Instagram, judged on their products, budget, skills, the countries they sell to and the payment methods buyers there use (cards, wallets, buy now pay later, local methods, cash on delivery), growth plans and how AdsPilot can help on each. Use when someone asks which platform to use, whether to move from one platform to another, or wants a store but has nothing yet."
---

# Choosing a store platform

**Updated 2026-10-08.** Platform prices and features change often: check the platform's
own pricing page before quoting a number, and never quote one from memory.

## 1. Questions to answer first

1. What is sold, how many products and variants (sizes, colours), and how often they change?
2. Who will run the store day to day, and how comfortable are they with technology?
3. Monthly budget for the platform, apps or plugins, hosting and a developer.
4. How buyers pay: cash on delivery, bank transfer, wallets, cards. Which gateways work in
   the business's country?
5. Where buyers come from: ads to a website, Instagram or TikTok, WhatsApp, marketplaces?
6. Plans for the next 12 months: more products, other countries, wholesale, subscriptions?
7. Is there an existing site, domain, product data, customers and search traffic to keep?
8. Which countries will it sell to now, and within 12 months? Where is the business
   registered? Each market changes payments, tax display, languages and legal pages: check
   them in `get_skill selling-by-country` before choosing.

## 2. The options

| Option | Fits when | Watch out for | AdsPilot today |
|---|---|---|---|
| **Shopify** | Most product businesses that want a store working quickly, with little maintenance; good themes, checkout and apps; scales well | Monthly plan plus app costs; Shopify Payments is not available in every country (on 2026-10-08 not in Pakistan, India or Saudi Arabia; available in the US, Canada, UK, much of the EU, Australia, New Zealand and the UAE; check the official list), and Shopify charges an extra transaction fee on orders paid through third-party gateways when Shopify Payments is not used (not on cash on delivery or other manual methods); theme code changes need care | **Connected**: store audit, sales, products, pages, collections, menus, policies, discounts, and theme drafts with preview and approved publish (theme tools in the local app). Skills: store-builder, shopify-theme-developer |
| **WooCommerce on WordPress** | A business that already has a WordPress site or content; wants full control and ownership; has a developer or a good managed host | Hosting, updates, backups and security are the owner's job; plugin quality varies (most WordPress vulnerabilities are in plugins); speed depends on hosting and theme | **Connected** (self-hosted, with an Application Password): site audit, pages and posts (drafts, publish on approval), media, WooCommerce product text and prices, backups and restore (`wordpress_connect_site`). Plugins, themes, settings and checkout stay with the owner or developer. Skill: wordpress-site-builder |
| **Wix, Squarespace and similar** | Small catalogue, a brochure site with a few products, an owner who wants to do everything visually | Fewer e-commerce features and integrations; harder to move away later | Guidance only (landing-page-builder, web-ui-design) |
| **Marketplace** (Amazon in many countries; regional ones such as Daraz in Pakistan, Flipkart in India, noon in the Gulf, Zalando in Europe, Etsy for handmade) | Testing demand without a store; reaching buyers who search marketplaces | Commission per sale, marketplace rules, no customer list, price competition next to rivals | Ads and content only |
| **Social selling** (Instagram or Facebook shop, WhatsApp Business catalogue, orders by chat) | Very small catalogue, made-to-order items, or the first weeks of a business | Manual order handling, no checkout, hard to measure sales from ads | Social posting and messaging-objective ads (campaign-setup) |

A common path: start with social selling or a marketplace to prove demand, move to Shopify
(or WooCommerce if there is already a WordPress site and a developer) when orders become
regular, and keep the marketplace as an extra channel.

## 3. Recommendation rules

- **No site yet, product business, runs ads:** Shopify, unless a clear reason points elsewhere.
  It is the platform AdsPilot can build and improve most completely (themes, menus,
  collections, policies, discounts as well as content).
- **Existing WordPress site with traffic and a developer:** add WooCommerce rather than
  starting over, and keep the content and search rankings. AdsPilot can connect to it
  (`wordpress_connect_site`) to audit it and improve pages and products, each change with the
  user's approval.
- **Existing store that works:** do not switch platforms to fix conversion; fix the pages,
  offer and speed first (store-builder, landing-page-builder). Switching costs months.
- **Any market:** the choice often depends on which payment gateways, couriers and tax
  tools integrate in that country. Check the platform's app or plugin directory for them
  before deciding, and the market's reference in `selling-by-country`.
- **Cash-on-delivery market** (Pakistan, India, the Gulf): any of the above handles cash on
  delivery; local courier and wallet integrations decide it.
- **Selling to several countries:** one store with Shopify Markets (or WooCommerce with
  multi-currency and translation plugins) usually beats one store per country, until a
  market needs its own legal entity, warehouse, brand or tax set-up. EU, UK, Australian
  and New Zealand buyers expect tax-inclusive prices and local payment methods; plan for
  that from the start.
- **Moving platforms:** plan redirects from every old product and page URL to the new one,
  move reviews and customer data where allowed, and run both until the new store has had
  a test order and the ad pixels fire correctly.

Write the recommendation as: the option, the two or three reasons from the answers above,
the first-month cost range the owner should check on the official pricing pages, and what
AdsPilot will do next on that platform.

## Sources (checked 2026-10-08)

- Shopify Payments supported countries: https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries
- Shopify manual payment methods (cash on delivery): https://help.shopify.com/en/manual/payments/manual-payments
- Shopify pricing (check current plans and fees): https://www.shopify.com/pricing
- WooCommerce: https://woocommerce.com/ and https://wordpress.org/plugins/woocommerce/
- Patchstack, State of WordPress Security in 2026: https://patchstack.com/whitepaper/state-of-wordpress-security-in-2026/
