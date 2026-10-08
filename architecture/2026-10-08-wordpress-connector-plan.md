# WordPress and WooCommerce connector for AdsPilot — plan and state

**Status 2026-10-08 ~11:50 PKT: DEPLOYED, not yet verified against a real site.** Merged (`ed0a294`, together with PostHog MCP Analytics and the hosted Shopify activity-log fix), `/opt/adspilot/data/wordpress-backups` created (uid 1000), released `ed0a2941302a`; gate 1,214+3 tests green. Next: the go-live test on a throwaway HTTPS WordPress with WooCommerce (section "What the owner or parent must do"), then add the WordPress and Shopify backup folders to `backup.sh`.

_2026-10-08. Owner approved building it the same day; users are worldwide. Research:
`research/2026-10-08-wordpress-connector.md`. Pattern followed: the Shopify connector
(`architecture/2026-10-08-shopify-connector-plan.md`)._

## What it is for

A user's AI connects their self-hosted WordPress site (and WooCommerce store) to AdsPilot,
reads and audits it, and improves it: each change goes through a summary the user approves.

## Decisions

| Question | Decision | Why |
|---|---|---|
| API | Core REST API (`/wp-json/wp/v2`, `/wc/v3`) | Works on every WordPress since 5.6 with no plugin; WooCommerce accepts the same login |
| WordPress MCP Adapter | Not now; detect the `mcp` namespace later as an option | A plugin on ~40k sites; three read-only abilities by default; editing needs custom abilities |
| Login | An Application Password, given to `wordpress_connect_site` | The only core way for an app to log in. Never the user's own password |
| Better login, later | WordPress's "Authorize Application" flow (one click in wp-admin, callback on the server) | The AI never sees the password. Needs a `/wordpress/callback` route and the password kept out of the proxy's access logs (it arrives in the query string) |
| Storage | `provider_auths`, provider `wordpress`, one row per site; login sealed by the vault per account | Fits cleanly: no new table, **no migration** |
| Licences | Our own code only; WordPress (GPLv2+) and WooCommerce (GPLv3+) are called over HTTP, never copied | Copying GPL code into the SaaS would make it GPL |
| WordPress.com-hosted sites | Later (WordPress.com OAuth2, its own API) | A different auth system |

## Safety (in code, whatever the AI asks)

1. **SSRF guard** on every request to a user-supplied address
   (`packages/adapters/src/safe-http.ts`): https on 443 only, no credentials in the URL,
   internal names refused before DNS; every resolved address must be public; the socket is
   pinned to the checked address (no DNS rebinding); redirects to another host refused;
   checked again on every request. Media downloads may follow redirects to other public
   https hosts, each hop re-checked, with no login header.
2. **Reads are free; every change needs the approval token** on an exact summary. The token
   covers the change and a fingerprint of what is there now, so a page edited meanwhile
   needs a new approval.
3. **New content is always a draft.** Publishing is its own approved step.
4. **Backup, change, read-back**: the current version is saved to
   `~/.social-publisher/wordpress-backups/` (hosted: `WORDPRESS_BACKUP_DIR` or the same
   folder, per account) before the write; the result is read back and any difference is
   reported, never called done (e.g. WordPress stripping `<script>` for users without
   `unfiltered_html`). WordPress revisions are a second source, not the only one: they can
   be turned off and hold only title, content and excerpt.
5. **The password never leaves the request it is used in**: read from the vault per
   request, turned into one Authorization header, never logged, echoed or saved elsewhere
   (a canary test checks outputs, activity records, backups and the console).
6. **Disconnect** revokes the Application Password on the site (introspect + delete, 5.7+)
   and wipes AdsPilot's sealed copy.

## Tools (both transports, all metered)

| Tool | Kind | Approval |
|---|---|---|
| `wordpress_connect_site`, `wordpress_disconnect_site`, `list_wordpress_sites` | Connection | No (the user gives the password) |
| `wordpress_site_overview`, `wordpress_list_content`, `wordpress_read_content`, `wordpress_site_audit`, `woocommerce_products`, `wordpress_list_backups` | Read | No |
| `wordpress_save_content`, `wordpress_publish_content`, `wordpress_upload_media`, `wordpress_restore_backup`, `woocommerce_update_product` | Write | Yes (policy entries in `core/src/domain/policy.ts`) |

Code: `packages/adapters/src/wordpress.ts` (client, error explanations),
`packages/adapters/src/safe-http.ts`, `apps/mcp/src/wordpress-tools.ts`,
`wordpress-access.ts` (vault storage, local and hosted), `wordpress-audit.ts`.

## State

- **2026-10-08: built and unit-tested on branch `wordpress-tools`** (not merged, not
  deployed, not run against a real site). 75 new tests against a fake WordPress behind the
  real guarded fetch.

## To go live

1. **No migration** to approve.
2. Review and merge `wordpress-tools` (expect a small merge with the PostHog analytics
   branch in `hosted-server.ts` / `local-server.ts`: one import and one line each).
3. Server: `deploy/scripts/setup.sh` now creates `/opt/adspilot/data/wordpress-backups`
   and `docker-compose.yml` mounts it. On the existing server run once:
   `install -d -o 1000 -g 1000 -m 700 /opt/adspilot/data/wordpress-backups`, then release.
   Optionally set `WORDPRESS_BACKUP_DIR`. Add the folder to `backup.sh` before real
   customers connect (same gap as Shopify backups).
4. **Verify against a real test site** (R4) before telling users: a throwaway WordPress on
   HTTPS with WooCommerce and a few products (for example a free staging site from a host,
   or WordPress on a cheap VPS), an Editor and an Administrator user. Run: connect (also
   with Wordfence on, to see the message), overview, audit, create a draft, publish it,
   change a live page, restore it, upload an image, change a product price, disconnect
   (check the password row disappears in Users > Profile). Record results in PROJECT-LOG
   "Verified live".
5. Later: the Authorize Application flow; the MCP Adapter as an optional path; SEO plugin
   fields (Yoast and Rank Math are read-only over REST without a helper); WordPress.com.

## Log entry (moved from PROJECT-LOG.md at merge, 2026-10-08)

## 2026-10-08 — WordPress and WooCommerce connector (branch `wordpress-tools`, not merged, not deployed)

Owner approved building it on 2026-10-08; users are worldwide. Research first:
`research/2026-10-08-wordpress-connector.md`. Plan, tools and go-live steps:
`architecture/2026-10-08-wordpress-connector-plan.md`.

- **Decided: core REST API with an Application Password**, not WordPress's MCP Adapter
  (a plugin on 40k sites, three read-only abilities by default; detect it later as an
  option). WooCommerce REST v3 accepts the same login (from Woo's source; not yet tested
  live).
- **Storage: no migration.** Sites live in `provider_auths` (provider `wordpress`, one row
  per site, the login sealed by the vault per account). Same on the local app and the
  hosted server.
- **SSRF guard** (`packages/adapters/src/safe-http.ts`): https on 443 only; every resolved
  address must be public (private, loopback, link-local/metadata, CGNAT, reserved, IPv6
  ULA/link-local, IPv4-mapped and NAT64 forms); the socket is pinned to the checked
  address; no redirect to another host; re-checked on every request.
- 14 tools on both transports, all metered: connect, disconnect, list, overview, list
  content, read content, audit (findings, no score), WooCommerce products (reads); save
  content (new ones always drafts), publish/unpublish, upload media, restore backup or
  revision, WooCommerce product text and prices (approval, backup, change, read-back).
- Skills updated: wordpress-site-builder (+ references/woocommerce.md),
  store-platform-choice, landing-page-builder name the real tools; every change needs approval.
- Found, not fixed (outside this work): on the hosted server the Shopify tools' activity
  records (`audit()` in ads-tools.ts) go through `currentScope()`, which is the server's
  first account, not the request's. The WordPress tools record under the request's account.
- **Only unit-tested** with a fake WordPress behind the real guarded fetch: 75 new tests
  (SSRF refusals, R1 error messages, approvals for every write, backup before write and
  read-back after, rollback, a secret canary). Gate: 1,198 tests green. **Nothing has been
  run against a real WordPress site.**

