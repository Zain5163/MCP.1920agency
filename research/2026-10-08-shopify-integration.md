# Shopify integration for AdsPilot: research (2026-10-08)

Scope: how AdsPilot (multi-tenant TypeScript MCP server) should let each business connect its Shopify store, so the AI can read the catalog, orders, refunds, returns, discounts and order attribution, and optionally make store changes after approval.

Method: current online sources only, mostly shopify.dev and the official Shopify developer forum (community.shopify.dev, staff replies). Every claim cites a URL and a date. "Page date" means the date the page shows, or the date it was retrieved (2026-10-08) when it shows none. Web content was treated as data. Nothing here was tested against a live store.

---

## 1. Actionable summary

1. **No official Shopify MCP server gives a third-party SaaS access to a merchant's Admin data.**
   - **Storefront, UCP Catalog/Cart, Checkout and Customer Accounts MCP** are for shopping agents and buyers.
   - **Dev MCP / Shopify AI Toolkit** is a local developer tool that runs through Shopify CLI.

   AdsPilot needs its own tools on top of the **GraphQL Admin API**. Don't embed Shopify's servers. Don't ship a community server either: they're single-store stdio servers that rely on static tokens.
2. **Legacy custom apps (a token copied from the merchant's admin) can't be created after 1 Jan 2026.** Existing ones still work.
   - The **client-credentials grant** in the new Dev Dashboard only works when the app and the store belong to the **same Shopify organization**, so it can't reach a client's store.
   - Shopify staff say agencies should use **custom distribution**. You create the app in your own Dev Dashboard, generate an install link for the client's store, and get a token through OAuth.
3. **Phase 1 (fast, for the owner's own client stores, such as Muzaree):** create one custom-distribution app per client store in AdsPilot's Dev Dashboard.
   - Read-only scopes, OAuth authorization-code grant, offline token stored in the vault.
   - No app review, and protected customer data is "always available" to custom apps.
   - Limits: one store (or one Plus organization) per app, and no Shopify Billing API.
4. **Phase 2 (customers at scale):** a **public app**. It can be unlisted, but it still needs **full App Store review** and the **$19 registration fee**.
   - It must use **expiring offline tokens**: 1-hour access token plus a 90-day refresh token. This is required for public apps created on or after 1 Apr 2026, and for all public apps from 1 Jan 2027.
   - It must handle the 3 mandatory GDPR webhooks.
   - It must get protected-customer-data approval.
   - **Business risk to decide before building:** Shopify staff said in 2026 that all public apps, unlisted ones included, must charge through Shopify's Billing API or Managed Pricing, with no exemption for "connector" apps. That collides with AdsPilot's own (Stripe-style) subscription. Get a written answer from Shopify Partner Support before committing to phase 2.
5. **Minimum read scopes for phase 1:**
   - `read_products`, `read_inventory`, `read_orders` (orders from the last 60 days only), `read_returns`, `read_discounts`.
   - Optional: `read_all_orders` (older history; needs Shopify approval), `read_reports` (ShopifyQL), `read_locations`.
   - Avoid Level-2 customer fields (name, email, phone, address). Ad reconciliation doesn't need them, and that keeps the compliance burden at Level 1.
6. **Optional write scopes** (behind AdsPilot's approval gate):
   - `write_products` for descriptions.
   - `write_discounts` for discount codes.
   - `write_themes` for announcement-bar text. A public app also needs a Shopify exemption for this, so prefer a theme app extension or metafield-driven block in phase 2.
7. **Attribution** comes from `Order.customerJourneySummary`: first and last visit, UTM parameters, landing page, referrer URL, source, and `daysToConversion`. Check `ready` before trusting it.
   - For COD stores in Pakistan, "delivered" and "returned to origin" usually live in the courier's system, not in Shopify. True cost per delivered order needs courier data, or fulfillment events that the courier app writes back.

### Phase-1 merchant steps (fastest compliant path)
AdsPilot does steps 1–3 once per client store. The merchant (store owner) does steps 4–5.
1. **AdsPilot:** in the Dev Dashboard (dev.shopify.com, under AdsPilot's own organization), create the app "AdsPilot – <Client>". Set the scopes from section 3 and the redirect URL `https://<adspilot-host>/shopify/callback`.
2. **AdsPilot:** in the app's **Distribution** card, choose **Custom distribution**. This can't be changed later. Enter the client's `xxx.myshopify.com` domain and click **Generate link**.
3. **AdsPilot:** if order or customer fields come back `null` or `ACCESS_DENIED`, request protected customer data under **API access requests**. Forum posts in 2025–26 say this card sometimes only appears in the Partner Dashboard.
4. **Merchant:** open the install link while logged in as the store owner (or a staff member with app-install permission). Review the read-only permissions and click **Install**.
5. **Merchant:** nothing else. No password, API key or token is shared with AdsPilot. They can revoke access at any time in **Settings → Apps**.
6. **AdsPilot:** the callback exchanges the code for an **offline** access token. Verify the HMAC and `state`, store the token encrypted in the vault keyed by tenant and shop, and query `currentAppInstallation.accessScopes` to record which scopes were actually granted. Then subscribe to webhooks.

---

## 2. Official and community Shopify MCP servers

| Server | What it does | Admin data? | Auth | Licence / reuse by a third-party SaaS | Source (date) |
|---|---|---|---|---|---|
| **Dev MCP / Shopify AI Toolkit** | Searches Shopify docs and API schemas, validates GraphQL, Liquid and UI extensions, and prepares or runs "supported store-management tasks through Shopify CLI's authenticated store context". Comes as plugins, agent skills, or a local Dev MCP server. Needs Node 18+. | Only through Shopify CLI's store context for the developer running it. Not a hosted API for other merchants. | Docs part needs no auth. Store tasks use the CLI login. | MIT, repo `Shopify/shopify-ai-toolkit`, no pull requests accepted, telemetry on by default. You could run it as a coding aid, but it isn't designed to be embedded as a multi-tenant data connector. | shopify.dev/docs/apps/build/ai-toolkit (retrieved 2026-10-08); github.com/Shopify/shopify-ai-toolkit (retrieved 2026-10-08); open-sourced 9 Apr 2026 per askphill.com / gamut.so (2026) |
| (AI Toolkit change) | "AI Toolkit skills have been consolidated to `shopify`" (action required) | | | | shopify.dev/changelog, entry 2026-09-25 |
| **Storefront MCP** (old `https://{shop}/api/mcp`) | Catalog search and cart for shopping agents. **Deprecated in favour of the Universal Commerce Protocol (UCP).** Catalog moved to UCP on 22 Apr 2026, with old tools maintained until 15 Jun 2026. Old cart tools maintained until 31 Aug 2026. Store policy/FAQ search stays on `/api/mcp`. | No. Public storefront data only. | Public, per shop. | Any agent can call it, but it's useless for orders and revenue. | shopify.dev/docs/apps/build/storefront-mcp (retrieved 2026-10-08); shopify.dev/changelog/storefront-mcp-cart-tools-are-being-deprecated-in-favour-of-ucp-cart-mcp (2026); weaverse.io UCP migration post (2026) |
| **UCP Catalog / Cart MCP** (`https://{shop}/api/ucp/mcp`) | `search_catalog`, `lookup_catalog`, `get_product`, `create_cart`, `get_cart`, `update_cart`, `cancel_cart`. An agent profile is required in every request. | No | Agent profile | For buying agents, not merchant analytics. | shopify.dev/docs/apps/build/storefront-mcp (retrieved 2026-10-08) |
| **Checkout MCP** | Agent checkout. Every request must be authenticated or signed. WebMCP support for checkout was announced 2026-09-28. | No | Signed requests | Buying agents | shopify.dev/docs/agents/carts-and-checkout/checkout-mcp (retrieved 2026-10-08); shopify.dev/changelog (2026-09-28) |
| **Customer Accounts MCP** | A *buyer's* own orders, tracking and returns. | Only the logged-in customer's data | OAuth 2.0 authorization code with PKCE (customer login). Needs a custom domain, protected-customer-data compliance, and scopes such as `customer_read_orders`. | Buyer-side only. Not usable for merchant reporting. | shopify.dev/docs/apps/build/storefront-mcp/servers/customer-account (retrieved 2026-10-08) |

**Community servers (not Shopify-maintained):**
- **GeLi2001/shopify-mcp** — MIT, TypeScript, about 238 stars, 31 tools covering products, customers, orders, draft orders, metafields, inventory and tags. Defaults to Admin API 2026-01. Auth is either client credentials (Dev Dashboard app in the *same organization*) or a legacy `shpat_` token. **Single store per stdio process**, so it isn't multi-tenant. Source: github.com/GeLi2001/shopify-mcp (retrieved 2026-10-08).
- Other admin wrappers, e.g. `A1-x-Tech/mcp-shopify-admin` and `slackermafia-shopify-admin` on pulsemcp.com, appear in directories (pulsemcp.com, retrieved 2026-10-08). Their licence and maintenance weren't checked.
- **Conclusion:** use these as reference code at most. AdsPilot should implement its own Shopify tools inside its existing MCP server, using its vault and approval flow.

There's no official hosted "Admin MCP" for third-party SaaS use as of 2026-10-08. The directory and guide articles above describe admin-data MCP servers only as community projects (peliqan.io and mcp.directory, 2026). This is a negative finding from searching, not a Shopify statement.

---

## 3. Admin API access options for a multi-tenant app (2026)

### 3.1 Auth methods (shopify.dev/docs/apps/build/authentication-authorization, retrieved 2026-10-08)
- **Shopify managed installation:** scopes are declared in `shopify.app.toml` and Shopify handles approval.
- **Token exchange:** for *embedded* apps. The ID/session token is exchanged for an access token without a redirect.
- **Authorization code grant:** "for apps that run outside the Shopify admin". This is the path for AdsPilot, which isn't embedded.
- **Client credentials grant:** "only works when the app and the store belong to the same Shopify organization". Tokens last 24 hours (`expires_in` 86399). It "can't reach a store outside your organization, including a client's store." Source: shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant (retrieved 2026-10-08).
- **Online vs offline tokens:** online tokens are tied to a staff member's session. Offline tokens are for background jobs. AdsPilot needs **offline**.

### 3.2 Expiring offline tokens
- Expiring offline tokens: the access token lasts **1 hour** (`expires_in` 3600) and the refresh token **90 days**. "Every refresh returns a new access token and a new refresh token." Source: shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens (retrieved 2026-10-08).
- Required for **public apps created on or after 1 Apr 2026**. Apps not affected: older public apps (until 2027), "custom apps created at any time", and "apps created by merchants either in the Dev Dashboard or in the Shopify admin". Source: shopify.dev/changelog/expiring-offline-access-tokens-required-for-public-apps-april-1-2026 (posted 2026-03-20).
- **All public apps** from 1 Jan 2027. Source: shopify.dev/changelog/expiring-offline-access-tokens-required-for-all-public-apps-as-of-january-1-2027 (2026).
- "More resilient refreshes for expiring offline access tokens". Source: shopify.dev/changelog, entry 2026-08-28.
- **Design implication:** build the vault for rotating access and refresh tokens from day 1, even though phase-1 custom apps may still get non-expiring tokens.

### 3.3 Custom apps and the Dev Dashboard
- From **1 Jan 2026**, new legacy custom apps can't be created in the merchant admin. Existing ones and their tokens keep working. Source: community.shopify.dev/t/…/26798 (staff replies 2025-12-05 and 2026-01-09).
- Partners can still create one in a client-transfer store *before* the transfer.
- Distribution page wording: the "Shopify admin" option is "no longer available for new apps". Source: shopify.dev/docs/apps/launch/distribution (retrieved 2026-10-08).
- The new Dev Dashboard was announced as "your command center for building". Source: shopify.dev/changelog, entry 2026-09-25.
- **Merchant-created Dev Dashboard app:** Settings → Apps → Develop apps → Build apps in Dev Dashboard → Create app → install, then copy the Client ID and secret. The token then comes from client credentials. Source: help.sarasanalytics.com and docs.villatheme.com setup guides (retrieved 2026-10-08).
  - This *works* technically, because the app and store share the merchant's organization.
  - But AdsPilot would be holding the merchant's client secret. That's the "token sharing" pattern Shopify is moving away from.
  - Staff told agencies to use custom distribution instead: "You create the app in your own Dev Dashboard, select Custom distribution, and send the merchant an install link." Source: community.shopify.dev/t/dev-dashboard-limitations-for-custom-app-developers/31640 (KyleG-Shopify, 2026-02-24).
  - Keep this only as a fallback.
- `shopify app execute` mutations are "limited to dev stores regardless of permissions". Source: same thread (2026-02-27). The CLI/AI Toolkit route isn't a production data path for client stores.
- The authorization code grant gives "a permanent, non-expiring offline token" for custom apps. A hosted callback endpoint is required even for one store. Source: community.shopify.dev/t/custom-app-credentials/27460 (Donal-Shopify, 2025-12-17 and 2025-12-23).

### 3.4 Distribution and review (shopify.dev/docs/apps/launch/distribution and …/select-distribution-method, retrieved 2026-10-08)
- **Custom distribution:**
  - Covers one store, or multiple stores in the same Plus organization.
  - "There's no app review, and you can't use the Billing API."
  - The distribution method can't be changed later.
  - The install link is generated per store domain.
- **Public (listed or unlisted / "limited visibility"):**
  - Needed for multiple unrelated merchants.
  - Unlisted public apps "will still need to be reviewed and you'll still need to pay the $19 registration fee" and must meet all requirements. Source: community.shopify.dev/t/…/19060 (Liam-Shopify, 2025-07-14).
  - App Bridge/embedding is "not a hard requirement" (same thread, 2025-07-18).
- **Billing:** "All public apps, including unlisted ones distributed via direct install link, must use the Billing API or Managed Pricing for any charges." Limited-visibility exemptions are no longer granted, and there's no exemption for data-connector use cases. Source: community.shopify.dev/t/…/32021 (Donal-Shopify 2026-04-02, staff 2026-06-26, KyleG-Shopify 2026-07-16).
  - **This is a material commercial constraint for AdsPilot's phase 2.**
- **App Store checklist highlights:**
  - "Your app should immediately authorize using OAuth before any other steps occur".
  - Request minimal scopes.
  - "Use Shopify App Pricing to charge for your app".
  - Source: shopify.dev/docs/apps/launch/app-requirements-checklist (retrieved 2026-10-08).

### 3.5 Protected customer data (shopify.dev/docs/apps/launch/protected-customer-data, retrieved 2026-10-08)
- **Orders are protected data:** "Orders, draft orders, abandoned checkouts, refunds, transactions… that relate to a single customer."
- **Level 1 (any protected data):**
  - Process the minimum data.
  - Tell merchants what you process.
  - Limit use to stated purposes.
  - Respect consent.
  - Have a data protection agreement (DPA).
  - Set retention periods.
  - Encrypt in transit and at rest.
- **Level 2 (name, address, email, phone):** adds:
  - Encrypted backups.
  - Separate test and production environments.
  - Data-loss prevention.
  - Limited staff access.
  - Strong passwords.
  - Access logs.
  - An incident response policy.
- **Availability:**
  - Custom app: "Always available" for both levels.
  - Public app: review required.
  - Admin-created custom app: Level 2 "varies by plan".
  - Development stores need no review.
- **What happens without approval:**
  - Unapproved fields are redacted and come back `null` with errors.
  - The request flow is Partner Dashboard → Apps → API access requests → Protected customer data access, then reasons, fields, data protection details, and review (public apps).
  - Forum reports from 2025–26 say the request card can be missing in the new Dev Dashboard, causing `ACCESS_DENIED`. The workaround is the Partner Dashboard. Source: community.shopify.dev/t/…/16527 and /t/…/31802 (2025–2026).
- **Recommendation:** request Level 1 only. Don't query customer name, email, phone or address. Use customer GID, order counts and `customerOrderIndex` for new-vs-returning analysis.

### 3.6 Versioning (shopify.dev/docs/api/usage/versioning, retrieved 2026-10-08)
- A new version ships quarterly, at 17:00 UTC on the first day of the quarter.
- Each version is supported for at least 12 months, with at least 9 months of overlap.
- **Latest stable is 2026-10**, released 2026-10-01 and accessible until 2027-10-16. **2027-01** is the release candidate.
- Requests for a retired version "fall forward" to the oldest supported version.
- **Recommendation:** pin `2026-10` in config and upgrade each quarter.

### 3.7 Rate limits (shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits, retrieved 2026-10-08)
- Cost-based leaky bucket, per app per store.
- Restore rate: Standard 100 points/s, Advanced 200, Plus 1,000, Enterprise 2,000.
- A single query can't exceed 1,000 points.
- Inputs are capped at 250 items.
- **Bulk operations** have no per-query cost or rate cap. Use them for historical order backfills (also staff-recommended in thread 31640, 2026-02).

### 3.8 Webhooks
- Topics confirmed in the 2026-10 webhook reference: `orders/create`, `orders/updated`, `orders/cancelled`, `orders/paid`, `orders/fulfilled`, `refunds/create`, `returns/request`, `returns/approve`, `returns/close`, `products/update`, `inventory_levels/update`, `discounts/create`, `app/uninstalled`. Source: shopify.dev/docs/api/webhooks/latest (retrieved 2026-10-08).
- Order and refund webhooks carry protected data, so the same approval rules apply.
- Treat webhooks as hints and reconcile with periodic GraphQL pulls. The delivery-guarantee wording wasn't captured from the page; standard practice is idempotent handlers keyed on the webhook ID.
- **Mandatory compliance webhooks:** `customers/data_request`, `customers/redact`, `shop/redact`.
  - Respond with a 2xx.
  - Verify the HMAC and return `401` when it's invalid.
  - Act within 30 days.
  - `shop/redact` arrives 48 h after uninstall.
  - The page frames these as required for apps distributed through the App Store. Implement them anyway in phase 1: cheap, and phase 2 needs them.
  - Source: shopify.dev/docs/apps/build/compliance/privacy-law-compliance (retrieved 2026-10-08).

---

## 4. Scopes

Source for scope contents: shopify.dev/docs/api/usage/access-scopes (retrieved 2026-10-08).

| Use case | Scope | Notes |
|---|---|---|
| Products, variants, prices, compare-at prices, collections | `read_products` | Product, ProductVariant, Collection |
| Inventory by variant and location | `read_inventory` (+ `read_locations` for location names) | InventoryItem, InventoryLevel |
| Orders, line items, transactions, refunds, fulfillments, cancellations, discount codes applied, attribution (`customerJourneySummary`) | `read_orders` | **Only the last 60 days.** `customerJourneySummary` requires `read_orders` (shopify.dev …/objects/CustomerJourneySummary, 2026-10). |
| Order history older than 60 days | `read_all_orders` | "Shopify approval required". Request it in the dashboard alongside `read_orders`. |
| Returns (requests, reverse logistics) | `read_returns` | Return, ReverseDelivery, ReverseFulfillmentOrder |
| Discount definitions (codes, rules, usage) | `read_discounts` (`read_price_rules` is legacy PriceRule) | |
| ShopifyQL analytics (sessions, sales reports) | `read_reports` | `shopifyqlQuery` |
| Shopify-side marketing events, if any | `read_marketing_events` | Optional |
| **Write:** product descriptions, SEO text | `write_products` | Can also change price or status; restrict at tool level to description fields |
| **Write:** create or pause discount codes | `write_discounts` | Revenue risk; enforce caps on value and duration |
| **Write:** announcement bar or theme text | `write_themes` (+ `read_themes`) | A **public** app also needs a theme-modification **exemption**. Prefer a theme app extension, or an announcement block that reads a metafield (`write_metafields`/`write_products` depending on owner), so AdsPilot never edits theme files. |
| **Write:** pages or blog content | `write_content` / `write_online_store_pages` | Optional |

**Attribution fields:**
- `Order.customerJourneySummary` contains `firstVisit`, `lastVisit`, `daysToConversion`, `customerOrderIndex`, `momentsCount` and `ready`. Source: shopify.dev/docs/api/admin-graphql/latest/objects/CustomerJourneySummary (version 2026-10, retrieved 2026-10-08).
- Each `CustomerVisit` has `landingPage`, `referrerUrl`, `referralCode`, `source`, `sourceType`, `sourceDescription`, `utmParameters`, `occurredAt` and `marketingEvent`. Source: shopify.dev/docs/api/admin-graphql/latest/objects/CustomerVisit (retrieved 2026-10-08).
- `ready = false` or `momentsCount = null` means attribution is still processing, so re-pull later.

**Write-scope risks:**
- Prices or descriptions changed by mistake.
- Discount stacking or leaks (code shared publicly).
- A broken theme or layout.
- Approval-token replay.
- The model acting on prompt-injected text from product or review data.
- Merchants seeing broad permissions at install (lower install rate, longer review).

**Mitigation:**
- Request write scopes as **optional scopes** granted only when the user turns the feature on ("granted scopes can differ from the ones in its configuration", access-scopes page).
- Diff preview, one-time approval tokens, before/after snapshots for rollback, rate caps, and audit log.

---

## 5. Recommended architecture for AdsPilot

**Components (inside the existing TypeScript MCP server):**
1. **`shopify-connector` module.** Handles the OAuth start and callback (authorization-code grant), HMAC and `state` checks, and token exchange.
   - Phase 2 adds refresh-token rotation (1 h access / 90 d refresh).
2. **Vault (existing).** Store per tenant: `{shop_domain, access_token, refresh_token?, expires_at?, granted_scopes, api_version, installed_at, app_id}`, encrypted at rest.
   - Never log tokens.
   - Wipe on `app/uninstalled` and on `shop/redact`.
3. **GraphQL client.**
   - Pinned to `2026-10`.
   - A throttle that reads `extensions.cost.throttleStatus` and backs off.
   - Bulk operations for backfills.
   - A quarterly version-bump checklist.
4. **Sync store (Postgres).**
   - Store only non-PII order data: order ID, created/cancelled time, financial and fulfillment status, totals, refunds, discount codes, line items, UTM, landing and referrer, source.
   - Write a data-retention policy (Level 1).
5. **Webhook receiver.**
   - Topics: `orders/create`, `orders/updated`, `orders/cancelled`, `refunds/create`, `returns/*`, `products/update`, `inventory_levels/update`, `app/uninstalled`, plus the 3 compliance topics.
   - Idempotent handlers.
   - A nightly reconciliation pull.
6. **MCP tools (read):**
   - `shopify_list_products`
   - `shopify_inventory`
   - `shopify_orders_summary(date range, by UTM/campaign)`
   - `shopify_refunds_returns`
   - `shopify_discount_usage`
   - `reconcile_ads_vs_store(platform, campaign, window)`. This joins Meta/Google results with Shopify orders via `utm_campaign`/`utm_content` and ad IDs in the landing URL. It returns platform-reported purchases, Shopify orders, cancelled, refunded/RTO, net delivered, and **true cost per delivered order = spend ÷ delivered orders**.
7. **MCP tools (write, phase 1b, approval-gated):**
   - `shopify_update_product_description`
   - `shopify_create_discount` (value, duration and usage caps)
   - `shopify_set_announcement` (via metafield/app block)
   - Each one: draft, diff, user approval token, execute, read back, verify.
8. **COD courier data (Pakistan).** A courier connector (PostEx, Leopards, TCS, M&P, Trax APIs, or a CSV import) maps tracking number to delivered/RTO status. Shopify alone usually won't know RTO. This is an inference from how COD works; confirm per store.

**UTM convention (needed for reconciliation):** every AdsPilot ad URL carries `utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}`. Meta dynamic URL parameters are standard Meta functionality and weren't re-verified in this research.

**Phases:**
- **Phase 1 (now, weeks):**
  - Custom-distribution app per client store, read-only scopes, Level 1 data only.
  - The 3 compliance webhooks implemented anyway.
  - Manual store onboarding as in section 1.
  - No billing through Shopify, so the Billing API restriction doesn't apply (custom apps can't use it).
- **Phase 1b:**
  - Optional write scopes for owner stores only.
  - Request them as optional scopes and keep them behind approval.
- **Phase 2 (public, unlisted first):**
  - Partner registration ($19).
  - Expiring offline tokens.
  - Protected-data Level 1 request and DPA.
  - Privacy policy and data-deletion flow.
  - Minimal scopes.
  - OAuth on first open.
  - Decide the billing model with Shopify, because the Billing API/Managed Pricing requirement applies to public apps per staff statements from 2026.
  - Submit for review.
  - Consider the theme-write exemption only if a metafield/app-block approach can't do the job.

**Open risks and uncertainties:**
- Billing-API requirement for an off-Shopify SaaS: staff forum statements, not a signed policy letter. Confirm with Shopify.
- Whether `read_all_orders` is approved quickly for custom-distribution apps: not verified.
- The Dev Dashboard protected-data request UI bug: forum reports, may be fixed.
- The community claim that Storefront MCP is "on every store running on the Winter 2026 release" (gamut.so) is superseded by the UCP migration.

---

## 6. Sources (all retrieved 2026-10-08 unless stated)

- Shopify AI Toolkit docs — https://shopify.dev/docs/apps/build/ai-toolkit
- Shopify AI Toolkit repo (MIT) — https://github.com/Shopify/shopify-ai-toolkit
- AI Toolkit open-sourced 2026-04-09 — https://askphill.com/blogs/blog/shopify-just-released-an-ai-toolkit-for-claude-heres-what-it-actually-does ; https://www.gamut.so/blog/shopify-mcp-guide (2026)
- Storefront MCP → UCP migration page — https://shopify.dev/docs/apps/build/storefront-mcp
- Cart tools deprecation changelog (2026) — https://shopify.dev/changelog/storefront-mcp-cart-tools-are-being-deprecated-in-favour-of-ucp-cart-mcp
- Catalog MCP → UCP dates (22 Apr / 30 May / 15 Jun 2026) — https://weaverse.io/blogs/shopify-storefront-catalog-mcp-ucp-migration-hydrogen-2026
- Customer Accounts MCP — https://shopify.dev/docs/apps/build/storefront-mcp/servers/customer-account
- Checkout MCP — https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp
- Shopify changelog (entries 2026-08-05, 08-28, 09-25, 09-28) — https://shopify.dev/changelog
- Community server GeLi2001/shopify-mcp (MIT) — https://github.com/GeLi2001/shopify-mcp
- Directory of community servers — https://www.pulsemcp.com/servers?q=shopify ; https://mcp.directory/blog/shopify-mcp-complete-guide-2026 (2026)
- Auth overview — https://shopify.dev/docs/apps/build/authentication-authorization
- Client credentials grant — https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
- Offline access tokens — https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
- Expiring tokens for new public apps (posted 2026-03-20) — https://shopify.dev/changelog/expiring-offline-access-tokens-required-for-public-apps-april-1-2026
- Expiring tokens for all public apps by 2027-01-01 — https://shopify.dev/changelog/expiring-offline-access-tokens-required-for-all-public-apps-as-of-january-1-2027
- Legacy custom apps end 2026-01-01 (forum, Dec 2025–Jan 2026) — https://community.shopify.dev/t/starting-january-1-2026-you-will-not-be-able-to-create-new-legacy-custom-apps-this-will-not-impact-any-existing-apps/26798
- Dev Dashboard limits for agencies (Feb 2026) — https://community.shopify.dev/t/dev-dashboard-limitations-for-custom-app-developers/31640
- Custom app credentials (Dec 2025) — https://community.shopify.dev/t/custom-app-credentials/27460
- Merchant Dev Dashboard app steps — https://help.sarasanalytics.com/en_US/pulse-shopify-/shopify-app-creation-steps ; https://docs.villatheme.com/configuration/how-to-use-11/create-an-app-and-get-credentials/
- Distribution methods — https://shopify.dev/docs/apps/launch/distribution ; https://shopify.dev/docs/apps/launch/distribution/select-distribution-method
- Unlisted apps need review + $19 (2025-07-14) — https://community.shopify.dev/t/do-i-need-shopify-app-review-if-i-just-want-my-external-application-users-to-connect-their-shopify-stores/19060
- Unlisted public apps must use Billing API (Apr–Jul 2026) — https://community.shopify.dev/t/unlisted-public-app-is-shopify-billing-api-mandatory-or-can-we-use-stripe/32021
- App requirements checklist — https://shopify.dev/docs/apps/launch/app-requirements-checklist
- Protected customer data — https://shopify.dev/docs/apps/launch/protected-customer-data
- Protected data request missing in Dev Dashboard (forum) — https://community.shopify.dev/t/bug-report-cannot-request-protected-customer-data-access-in-new-dev-dashboard/16527 ; https://community.shopify.dev/t/access-denied-to-protected-customer-data-in-custom-app/31802
- Access scopes — https://shopify.dev/docs/api/usage/access-scopes
- API versioning — https://shopify.dev/docs/api/usage/versioning
- GraphQL Admin rate limits — https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits
- CustomerJourneySummary (2026-10) — https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerJourneySummary
- CustomerVisit — https://shopify.dev/docs/api/admin-graphql/latest/objects/CustomerVisit
- Webhook topics — https://shopify.dev/docs/api/webhooks/latest
- Compliance webhooks — https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
