# Shopify connector for AdsPilot — build plan

_2026-10-08. Research: `research/2026-10-08-shopify-integration.md`._

## What it is for

The owner's brief: connect a business's Shopify store to AdsPilot so the AI can
**read** the store (to judge ads on real sales) and **improve and build** it into a
high-converting store, with the same approval safety as ads.

| Capability | Examples | Scopes |
|---|---|---|
| Read | Products, prices, compare-at prices, stock by size; orders, revenue, refunds, returns, cancellations; discount codes used; which ad/UTM each order came from | `read_products`, `read_inventory`, `read_orders` (60 days), `read_returns`, `read_discounts` |
| Improve content | Product descriptions and titles, size guides, collections, pages (FAQ, delivery, returns), navigation | `write_products`, `write_content` / pages, `write_online_store_navigation` |
| Improve the theme | Announcement bar, hero, trust badges, sticky add-to-cart, product-page sections, page speed fixes | `write_themes` (custom-distribution app; a public app needs a Shopify exemption) |
| Offers | Discount codes and automatic discounts (bundles, free delivery thresholds) | `write_discounts` |

Customer personal data (names, phones, addresses) is **not** requested: nothing above needs it.

## Safety (same principles as ads)

1. **Read is free; every write needs the owner's yes** on an exact summary (AdsPilot's
   existing approval token), and is logged.
2. **Theme changes never go to the live theme directly**: AdsPilot duplicates the live
   theme, edits the copy, sends a **preview link**, and publishes only on approval. The
   old live theme stays as the rollback.
3. **Content edits keep the previous version** (stored before the change) so any edit
   can be undone.
4. **Read-back after every write** (the three-check rule): the change is fetched back and
   compared with what was approved.
5. **Test on a development store first**: every tool is proven on a free dev store with
   test data before it touches a client's real store.

## Phases

| Phase | Builds | Needs |
|---|---|---|
| 0 | Dev store + the Shopify app record (Dev Dashboard / CLI) | Owner: dev account (done 2026-10-08), one browser login for the CLI |
| 1 | Connect a store (custom-distribution install link, OAuth, token in the vault); read tools; `shopify_store_audit` (conversion audit using the cro/copywriting skills against real store data) | A public https callback address (see below) |
| 2 | Write tools: content, discounts, theme-on-a-copy with preview and publish | Phase 1 proven on the dev store |
| 3 | Real-sales reconciliation: Meta purchases vs Shopify orders vs courier delivered/returned; true cost per delivered order in the daily report | Courier data (COD delivery status lives with the courier, not Shopify) |
| 4 | Public app for AdsPilot customers | Shopify review, expiring tokens, GDPR webhooks, and a written answer on Shopify's billing requirement |

## Open decision

**A public https address for the OAuth callback.** AdsPilot runs on the owner's PC.
During development the Shopify CLI provides a temporary tunnel (`shopify app dev`).
Real client stores need a stable address: the hosted AdsPilot server (already planned)
or a named Cloudflare tunnel. The same address also fixes Facebook reconnects in Live mode.

## First client

Muzaree. Its earlier theme work is in `Websites/Muzaree-Shopify` (an optimised theme
package, never uploaded); its rules: preview the full purchase flow before publishing,
never publish without explicit approval.

## Progress

- **2026-10-08, phase 0 done.** Owner created a developer account (org 239616792) and the
  development store `1920-agency-test-store` (17 test products, no orders). The app
  "1920 Agency Store Connector" was created with the Shopify CLI, configured (not embedded,
  read + approved-write scopes, no customer data) and deployed as version 2; config in
  `integrations/shopify-app`. Secret in `~/.social-publisher/.env` (SHOPIFY_CONNECTOR_*).
  Installed on the dev store by the owner. **Verified:** client-credentials token (24 h),
  GraphQL Admin 2026-10 read of shop, products, orders and themes.
- **Network note:** this PC's ISP route to Shopify edge `23.227.38.74` is dead (traceroute
  stops after the ISP hop), and every `*.myshopify.com` name resolves there; the
  neighbouring edge `23.227.38.69` works. The test used it. Do not hard-code an IP in
  AdsPilot: recheck, report to the ISP if it persists, and the hosted server avoids it.
- **Client credentials** works only for stores owned by the app's organisation (dev
  stores). Client stores (Muzaree) need the install link and OAuth, which needs the public
  https callback (open decision above).
- **2026-10-08, phase 1 (read) built and verified live** on the dev store through a fresh
  AdsPilot: `list_shopify_stores`, `shopify_store_overview`, `shopify_products`,
  `shopify_sales`, `shopify_store_audit` (client in `packages/adapters/src/shopify-admin.ts`).
  Scope `read_legal_policies` added (app version 3); the dev store must approve the update
  before policies can be read (the audit says so meanwhile). Next: phase 2 writes behind
  approvals; for Muzaree, the OAuth install path once a public https address exists.
- **2026-10-08: read_legal_policies granted** by the owner; the audit now reads policies.
- **2026-10-08, phase 2a (content and offers) built and verified live** on the dev store:
  `shopify_update_product`, `shopify_save_page` (hidden draft by default),
  `shopify_create_discount` (end date required; quantity or subtotal minimums, e.g. a
  two-pair offer), `shopify_end_discount` (no approval: stopping an offer never waits),
  `shopify_list_backups`, `shopify_restore_backup`. Each write: summary → owner's approval
  token (covers the change and the current content) → backup in
  `~/.social-publisher/shopify-backups/<shop>/` → change → read-back. The live test caught a
  bug (an implicit "start now" broke the approval token) that was fixed and re-verified.
  Next, phase 2b: theme changes on a duplicate theme with a preview link and approved publish.
- **2026-10-08, phase 2b (themes) built and verified live.** Theme writes through the app
  were refused ("needs write_themes and an exemption from Shopify"), so themes go through the
  Shopify CLI, which signs in as a person (owner login, collaborator, or a Theme Access
  password per store). Tools: `shopify_theme_start_draft` (download live = backup, editable
  copy), `shopify_theme_read`, `shopify_theme_edit` (exact find-and-replace or full content;
  JSON must stay valid; paths confined to theme folders), `shopify_theme_preview` (hidden
  theme + preview link), `shopify_theme_publish` (approval; refuses if the draft changed after
  preview or the live theme changed since the draft), `shopify_theme_rollback` (approval),
  `shopify_theme_discard`. Full flow run live on the dev store; store left as it was.
- **For phase 4 (public app):** apply for Shopify's theme exemption, or keep the CLI route.

