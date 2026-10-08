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

## How users connect their own store from Claude, ChatGPT or any AI (hosted, self-service)

The goal (owner, 2026-10-08): a user who has AdsPilot connected in their AI app logs in
to their Shopify store once and then works on it from the chat.

**What the user does:** adds AdsPilot as a connector in Claude, ChatGPT or another MCP
client (`mcp.1920agency.com`, signs in to AdsPilot) → says "connect my Shopify store" →
AdsPilot replies with a Shopify install link → the user approves the permissions in
Shopify → back in the chat, every Shopify tool works on their store. Changes still show a
summary and wait for the user's "yes" in the chat.

**What has to be built (in order):**

| Step | What | Status |
|---|---|---|
| 1 | Public https address | Done by the hosting work: `mcp.1920agency.com` |
| 2 | Server-side install flow: `/shopify/install` → Shopify consent → `/shopify/callback` on the server exchanges the code with the app secret (kept only on the server) | To build. Not the PC bounce: the redirect lands in the *user's* browser, so the server must finish it |
| 3 | Per-user store token, encrypted in the vault, tied to the user's AdsPilot account | To build (the vault exists) |
| 4 | Shopify tools registered on the hosted server, reading the user's own token and store list | To build (today they are local-only, using the owner's settings) |
| 5 | Theme changes for hosted users: a Theme Access password per user (stored in the vault; the server runs the CLI with it), or Shopify's theme exemption | To decide |
| 6 | Distribution: a **public app** (Shopify review, $19 fee, expiring tokens, mandatory privacy webhooks, protected-data approval) | Business decision first: Shopify staff said public apps must bill through Shopify |

**Before the public app**, the owner's own clients (such as Muzaree) can be connected
today-style: the client gives the agency staff or collaborator access, the owner installs
the custom-distribution app in his own browser, and the existing redirect bounce through
`mcp.1920agency.com` delivers the code to his PC. One custom app is needed per client store.
- **2026-10-08, hosted self-service connection built (commit d313b9e); DEPLOYED ~09:45 PKT, release 0b0afef62b86 (see deploy/README.md, "Shopify self-service"). End-to-end connect from a hosted AI client not yet verified.** (Original note:)
  `shopify_connect_store` → Shopify consent → `/shopify/callback` on the server (Shopify HMAC +
  AdsPilot-signed state, code exchanged with the server-only secret for an expiring offline
  token, stored encrypted per account in provider_auths/vault) → all read and change tools on the
  user's own stores; `shopify_disconnect_store`. Theme tools stay local. App config v5 redirects to
  `https://mcp.1920agency.com/shopify/callback`. Deploy needs: server env (SHOPIFY_CONNECTOR_*,
  PUBLIC_BASE_URL), `/opt/adspilot/data/shopify-backups`, release, Caddy reload. Until the app is
  public (Shopify review), only development stores of the organisation can install it this way.

- **2026-10-08, deploy prepared (not run).** Step-by-step commands for another chat:
  `deploy/README.md`, section "Shopify self-service: deploy steps". Raptor's Caddyfile has the
  `@shopify` route committed (Raptor repo cffbb2e); setup.sh now creates the backups folder.
  Owner's question answered: the callback address is already set in the Shopify app (toml v5,
  deployed); the owner's PC `.env` has the keys, the server needs its own copy (step 1).

## Public app or not (recommendation, 2026-10-08)

Stay a development/custom app for now. Self-service from Claude/ChatGPT for any merchant needs
a public app, but apply only after: the hosted flow is proven on the dev store; the mandatory
privacy webhooks and `app/uninstalled` are built; a privacy policy page exists; and Shopify has
answered in writing whether AdsPilot (sold mainly outside Shopify) must bill Shopify merchants
through Shopify Billing. Listing choice when applying: unlisted public app first (install by
link, no App Store page), App Store listing later.

## Owner decisions, 2026-10-08 (later)

- **Billing: through Shopify** (Shopify Billing API, recurring app charge), not AdsPilot's own
  billing, "for the time being". Build it when the public app is prepared; price per plan still
  to set. Shopify's revenue share applies.
- **Public app:** yes, once it works end to end (deploy → test on the dev store → privacy
  webhooks → privacy page → submit). Muzaree: nothing is touched until the client gives access.
- **First, prove the AI can build a store**, on the practice store.

## Phase 2c: building a store (built 2026-10-08, live test pending)

New tools (`source/apps/mcp/src/shopify-build-tools.ts`), each summary → approval → backup →
change → read-back, local and hosted: `shopify_create_product` (options, a variant per size,
"was" price, photos from https URLs, collections; draft by default; stock untracked),
`shopify_save_collection` (hand-picked, exact product list, publish), `shopify_save_menu`
(short links: collection:/page:/product:/policy:/home/catalog/search/URL),
`shopify_save_policy` (refund, shipping, privacy, terms, contact). `shopify_update_product` now
also sets status (hide a sold-out product). `shopify_theme_start_draft` takes `from` (start from
another theme, e.g. Horizon: a redesign). `shopify_restore_backup` restores collections, menus
and policies too.

New scopes (app config v6, NOT yet released to Shopify): `read_publications`,
`write_publications` (new products and collections onto the Online Store), `write_legal_policies`.
After the release the dev store must approve the update. Checked against the live 2026-10 schema
by introspection (collections now use `collection:` inputs and `collectionByIdentifier`;
`collectionAddProducts` no longer exists, so membership uses productUpdate collectionsToJoin/Leave).
- **Before the public listing (found 2026-10-08):** a merchant who installs from the Shopify
  admin or App Store lands on `/shopify` without an AdsPilot account link (only
  `shopify_connect_store` from the chat links one). Today that page explains the step (commit
  4f972f5). For review, Shopify expects the app to take the merchant straight into the app after
  install: add a sign-in / sign-up step on that page that links the install to an AdsPilot account.
- **2026-10-08, VERIFIED END TO END (hosted self-service).** App config v6 released (scopes +
  read/write_publications, write_legal_policies). From Claude Code connected to
  `https://mcp.1920agency.com/mcp` with a dashboard token (`adspilot-hosted`):
  `shopify_connect_store` → owner approved in Shopify → callback page "connected" →
  `list_shopify_stores` lists the practice store for that account; `shopify_store_overview` and
  `shopify_store_audit` (including policies) work through the stored, encrypted per-account token.
  Next: the store-building rehearsal on the practice store, then the public-app checklist.

## Rehearsal on the practice store, through the hosted AdsPilot (2026-10-08)

Built with the store-builder, conversion-checklists, shopify-theme-developer and web-ui-design
skills; every change approved by the owner, read back, backed up:
round 1: sold-out board hidden; shipping and refund policies; FAQ page; "Snowboards" collection
(11 boards, on the Online Store). Round 2: size guide page; main menu (6) and footer (8) menus;
code TWOBOARDS (10% off 2+ items, ends 2026-11-30). Audit: 8 findings → 3, and the 3 left need
the owner (real photos, real product specs, costs). Product descriptions deliberately not
rewritten: no invented specs. Theme step (Horizon redesign on a hidden copy) still to do; runs
from the PC's AdsPilot.

Found and fixed: approval summaries for Shopify changes said "Nothing becomes public" (each
Shopify action now has its own consequence sentence); `shopify_products` now shows handles.

**Open design issue: approvals and hosted releases.** The approval key is made per server
process, so every release of the hosted server invalidates all customers' pending approvals
(happened twice during the rehearsal: releases 332c6c5 and 48f107d). Not a quick fix: the
per-process key also backs `ApprovalLedger` (apps/mcp/src/approvals.ts), the in-memory record
that stops a used publish approval from posting twice. A stable key with a time window would
let a used token work again after a restart. Proper fix: a stable key (derived from a server
secret) + expiry window + the used-token ledger in the database. Until then: avoid releasing
while a customer is mid-approval, and expect "approval needed" again after a release.
