---
name: wordpress-site-builder
description: "Plan, build, fix and speed up a WordPress site or WooCommerce store for a business that runs ads: block themes versus classic themes and page builders, theme.json and patterns, landing pages, WooCommerce product, cart and checkout (block checkout, payments and tax display per country, cash on delivery, cookie consent, Meta pixel and Conversions API), plugins to keep or avoid, caching and Core Web Vitals, security and backups, and WP-CLI / REST API basics for developers. AdsPilot has no WordPress tools: this skill guides the AI and the owner, and every change is made by the owner or their developer. Use when the site is on WordPress or WooCommerce, or the user asks to build one."
---

# WordPress site builder

**Updated 2026-10-08.** Versions at that date: **WordPress 7.1.3** (security release,
6 Oct 2026), **WooCommerce 11.2**, PHP **8.3+** recommended. Re-check before quoting a version.

## 0. What AdsPilot can and cannot do here

AdsPilot has **no WordPress or WooCommerce tools**. It cannot log in to a WordPress site,
edit pages, install plugins or change settings. Say so at the start, then work as the
expert who writes the plan, the page content, the code snippets and the click-by-click
steps, which the owner or their developer carries out. Never claim a change was made on a
WordPress site, and never ask the user to paste a password or application password into
the chat.

What AdsPilot does help with on a WordPress business: ads (`get_playbook`), the pixel
(`check_ad_setup`, `create_pixel` where available), social posts, and the marketing skills.
Related skills: `landing-page-builder` (ad pages), `web-ui-design` (look and layout),
`cro` and `copywriting`, `seo-audit`, `schema` and `site-architecture` (search and
structure), `core-web-vitals` and `performance` (speed), `accessibility`.

## 1. Understand the site before advising

Ask for, or have the owner check in the admin (Dashboard > Updates, Appearance > Themes,
Plugins, Tools > Site Health):

1. WordPress, PHP and WooCommerce versions; the host; whether there is a staging site.
2. The theme: a **block theme** (has Appearance > Editor) or a **classic theme**; a page
   builder (Elementor, Divi, WPBakery and others) and which pages use it.
3. Plugins: the full list, which are active, when each was last updated.
4. Backups: what runs, where copies go, when one was last restored as a test.
5. For stores: payment methods, shipping zones, cart and checkout type (block or classic).
6. The goal: what result the ads pay for (see `campaign-setup`) and which page they land on.
7. The countries it sells to, the currency and the languages. Each market changes the
   payment methods, how prices and tax are shown, the legal pages and the consent banner:
   read `get_skill selling-by-country` and the market's reference before advising.

Site Health's "Critical issues" and outdated plugins come first: they are security risks.

## 2. Themes: what to build on

| Situation | Recommendation |
|---|---|
| New site, small business | A **block theme** (for example the default Twenty-series theme or a well-maintained block theme), styled through `theme.json` and the Site Editor; pages built from patterns |
| Working site on a classic theme or page builder | Keep it; fix speed, content and conversion. Rebuild only when it blocks the goal, and plan it as a project with a staging copy |
| Heavy page builder making pages slow | Rebuild the key landing and product pages with blocks first; leave the rest |
| A developer-built custom theme | Work with the developer; send them the plan and the checklists |

Block theme facts (developer.wordpress.org): `theme.json` (schema **version 3**, WordPress
6.6+) holds colours, fonts, spacing and layout widths; templates and template parts are
HTML files in `/templates` and `/parts`; PHP files in `/patterns` with a Title and Slug
header register as patterns automatically; style variations live in `/styles`. Put the
design system from `web-ui-design` into `theme.json`, so every page uses the same tokens.

**Patterns.** Build reusable sections (hero, benefits, proof, FAQ, call to action) as
patterns; use **synced patterns** for pieces that must stay identical everywhere (the
delivery and returns strip, the contact block). Landing pages: a template without the full
menu, assembled from those patterns (structure in `landing-page-builder`).

## 3. WooCommerce for ad traffic

Full checklists in `references/woocommerce.md`. The essentials:

- **Checkout**: new stores use the **Cart and Checkout blocks** (default since WooCommerce
  8.3). Older checkout-field plugins that use the classic `woocommerce_checkout_fields`
  filter do not change the block checkout; check each plugin before switching.
- **Payments**: the methods buyers in that market expect (selling-by-country): cards and
  wallets through a payment plugin, buy now pay later, local methods (for example iDEAL in
  the Netherlands, UPI in India), or **cash on delivery**, a built-in method
  (WooCommerce > Settings > Payments) for COD markets. State COD and any fee on product
  pages; follow `store-builder/references/cash-on-delivery.md` for delivery promise,
  WhatsApp and refused-parcel advice.
- **Tax display**: WooCommerce > Settings > Tax decides whether prices are entered and
  shown with tax. Show prices including tax where the market expects it (UK, EU,
  Australia, New Zealand, the Gulf); in the US and Canada tax is usually added at checkout.
- **Consent**: where the market requires consent before tracking (EU, UK and others in
  selling-by-country), a consent plugin must block the pixel and analytics until the
  visitor agrees, and Google tags need Consent Mode. Ask the owner before adding any tracking.
- **Product pages**: the same checklist as Shopify (store-builder's
  `references/conversion-checklists.md`): photos, price, variations, delivery and
  return line by the button, size guide, real reviews.
- **Meta tracking**: the "Meta for WooCommerce" plugin (slug `facebook-for-woocommerce`,
  maintained by Meta) installs the pixel and sends Conversions API events and syncs the
  catalogue. Its wordpress.org rating is low (about 2.1/5 in Oct 2026) with complaints about
  performance: test it on staging, then confirm in Events Manager that Purchase is not
  counted twice. Do not also add a second pixel plugin.
- **Orders storage**: High-Performance Order Storage is the default since 8.2; plugins
  that are not compatible show a warning in WooCommerce > Settings > Advanced > Features.

## 4. Plugins: fewer, maintained, single-purpose

Patchstack counted **11,334** new WordPress vulnerabilities in 2025; **91%** were in plugins,
9% in themes, and almost none in core; 46% had no fix when disclosed. Every plugin is code
that can break the site or let an attacker in.

- Keep: plugins updated in the last few months, with many active installs, doing one clear
  job. Remove inactive plugins entirely (deactivated code can still be attacked).
- Avoid: nulled (pirated) themes and plugins, abandoned plugins, several plugins doing the
  same job (two SEO plugins, two cache plugins, two pixels), "all-in-one" bundles used for
  one feature, and speed plugins that only hide problems from test tools.
- One of each: SEO, caching, forms, backups, security (or the host's own), image
  optimisation if the host does not do it, and cookie consent where the market requires it.

## 5. Speed

Targets: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at the 75th percentile (web.dev). WordPress
core already lazy-loads images (since 5.5), adds `fetchpriority="high"` to the likely main
image (6.3), supports WebP (5.8) and AVIF (6.5, if the server can process it), and
prefetches likely next pages with speculative loading (6.8). On top of that:

1. **Page caching** (the host's, or one caching plugin) for logged-out visitors; exclude
   cart, checkout and account pages (WooCommerce sets this for most caches).
2. **Persistent object cache** (Redis or Memcached) for WooCommerce stores, if the host offers it.
3. **Images**: upload at the size used, compressed, in WebP or AVIF; the hero not lazy-loaded.
4. **Page builders and plugins**: the usual cause of slow pages. Check which plugins load
   scripts on every page; rebuild the ad landing pages with blocks if a builder is heavy.
5. **Hosting**: PHP 8.3+, HTTP/2 or 3, a CDN; cheap shared hosting is often the bottleneck.
6. The **Performance Lab** plugin (WordPress Performance Team) for testing upcoming features
   on staging.

Measure on PageSpeed Insights (mobile) before and after, and label lab versus real-user data.

## 6. Security and backups (minimum standard)

From the official hardening guide (developer.wordpress.org, Advanced Administration):

- [ ] WordPress core, theme and plugins updated; automatic updates for minor releases.
- [ ] Two-step login for every administrator (the "Two Factor" plugin or the host's).
- [ ] Each person has their own account with the lowest role that works; no shared admin login.
- [ ] `define( 'DISALLOW_FILE_EDIT', true );` in `wp-config.php` so the dashboard cannot edit
      plugin or theme code.
- [ ] Integrations use **Application Passwords** (since 5.6), one per app, revoked when unused;
      never the admin's real password.
- [ ] Daily backups of files and database stored off the server, and a restore tested.
- [ ] HTTPS everywhere; the admin email monitored.

## 7. For developers: WP-CLI and the REST API

Give these to the owner's developer; AdsPilot does not run them.

- **WP-CLI** (on the server, after a backup): `wp core update`, `wp plugin list --update=available`,
  `wp plugin update --all`, `wp theme list`, `wp search-replace 'http://old' 'https://new' --dry-run`,
  `wp db export`, `wp cache flush`. Always on staging first; `--dry-run` where it exists.
- **REST API**: `/wp-json/wp/v2/` for posts, pages and media; WooCommerce under `/wp-json/wc/v3/`.
  Authenticate with an Application Password over HTTPS. Read-only uses first.
- **WPGraphQL**: a plugin adding a GraphQL API, used by headless front ends; announced as a
  future canonical WordPress plugin in Oct 2024. Only for headless builds.

## 8. Check three times

1. **Plan**: every change tied to a finding and the ad goal; prices, terms and claims from the owner.
2. **Staging**: the owner or developer applies it on staging; check phone and desktop, a
   test order or form, the pixel events in Events Manager, page speed.
3. **Live**: after the owner pushes it live (with a fresh backup), repeat the test order or
   form and the event check.

## Never

- Claim AdsPilot changed a WordPress site, or invent a WordPress tool.
- Ask for passwords, application passwords or database credentials in the chat.
- Recommend nulled themes or plugins, or editing a live site without a backup.
- Invent reviews, prices or delivery promises, or legal text (legal notice, VAT numbers,
  withdrawal terms): the owner supplies the facts, and a local adviser checks anything binding.

## Sources (checked 2026-10-08; WordPress and WooCommerce documentation is GPL or
unlicensed, so it is cited and paraphrased, never copied)

- WordPress releases and requirements: https://wordpress.org/news/category/releases/, https://wordpress.org/about/requirements/
- theme.json reference: https://developer.wordpress.org/block-editor/reference-guides/theme-json-reference/theme-json-living/
- Registering patterns: https://developer.wordpress.org/themes/patterns/registering-patterns/
- Hardening guide: https://developer.wordpress.org/advanced-administration/security/hardening/
- Application Passwords: https://developer.wordpress.org/advanced-administration/security/application-passwords/
- Image performance in 6.3 (fetchpriority): https://make.wordpress.org/core/2023/07/13/image-performance-enhancements-in-wordpress-6-3/
- AVIF in 6.5: https://make.wordpress.org/core/2024/02/23/wordpress-6-5-adds-avif-support/
- Speculative loading in 6.8: https://make.wordpress.org/core/2025/03/06/speculative-loading-in-6-8/
- Patchstack, State of WordPress Security in 2026: https://patchstack.com/whitepaper/state-of-wordpress-security-in-2026/
- WooCommerce block checkout fields: https://developer.woocommerce.com/docs/block-development/cart-and-checkout-blocks/how-to-additional-checkout-fields-guide/
- Meta for WooCommerce: https://wordpress.org/plugins/facebook-for-woocommerce/
- WP-CLI handbook (MIT): https://make.wordpress.org/cli/handbook/
