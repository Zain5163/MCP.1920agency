# Shopify connector for AdsPilot — build plan (awaiting the owner's yes)

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
