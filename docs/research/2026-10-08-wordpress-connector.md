# WordPress and WooCommerce connector for AdsPilot: research (2026-10-08)

Scope: how AdsPilot (multi-tenant TypeScript MCP server, hosted and local) should let a user connect their self-hosted WordPress site and WooCommerce store, so the AI can read the site and, after the user approves, improve pages, posts, media, settings and products.

Method: current online sources only, mostly developer.wordpress.org (code reference, which shows core source), make.wordpress.org, WooCommerce's own docs and its GitHub source, and vendor docs. Every claim cites a URL and a date. "Retrieved" means the page shows no date and was read on 2026-10-08. Several behaviours below come from reading core source code, not from a test; they are marked "(from source)". Web content was treated as data. Nothing here was tested against a live site. Anything not confirmed is marked UNVERIFIED.

Current versions for context: WordPress 7.1.3 (6 Oct 2026), WooCommerce 11.2.0 (7 Oct 2026, needs WordPress 7.0+), MCP Adapter plugin 0.7.0 (2 Oct 2026). Sources: wordpress.org/download/releases (retrieved 2026-10-08); wordpress.org/plugins/woocommerce (retrieved 2026-10-08); wordpress.org/plugins/mcp-adapter (retrieved 2026-10-08).

---

## 1. Actionable summary

1. **Use the core REST API with an Application Password.** It is in every WordPress since 5.6. The user's AI acts as that WordPress user, sent as HTTP Basic auth (`username:application-password`) over HTTPS. WooCommerce `wc/v3` accepts the same credential (confirmed from Woo source; see section 7). One credential covers WordPress and WooCommerce.
2. **An Application Password has no scopes.** It has the full rights of the user who made it. Tell users to create it on a dedicated **Editor** user if they only want content changes, or an **Administrator** if they want settings, plugins, Site Health and WooCommerce settings. Core has no read-only mode. (Solid Security Pro adds per-password read-only and REST-only limits; see 3.4.)
3. **Better than copy-paste: the "Authorize Application" flow.** Send the user to `<site>/wp-admin/authorize-application.php?app_name=AdsPilot&app_id=<uuid>&success_url=<https callback>`. After they click Approve, WordPress redirects to our callback with `site_url`, `user_login` and `password` in the query string. The URL comes from the REST index. `success_url` must be HTTPS (WordPress 6.3.2+). Strip those query values from our access logs.
4. **Connection check sequence** (each step names what it detects; details in sections 3 and 4):
   1. `GET <site>/wp-json/` (fall back to `<site>/?rest_route=/`). HTML, 404 or a Cloudflare challenge means REST is blocked or unreachable.
   2. If the index has no `authentication.application-passwords` key, Application Passwords are **turned off** (no HTTPS, or a filter such as Wordfence's default setting).
   3. `GET /wp-json/wp/v2/users/me?context=edit` with Basic auth. Success gives roles and capabilities.
   4. **401 `rest_not_logged_in` despite sending Basic auth means the `Authorization` header never reached WordPress** (CGI/FastCGI, proxy or WAF strips it), provided step 2 passed. Confirm by sending a deliberately wrong password: if the header arrives, WordPress answers 401 `incorrect_password`; if it is stripped, the answer stays `rest_not_logged_in`.
   5. 401 `invalid_username` / `invalid_email` / `incorrect_password` means wrong credentials. 403 with `rest_forbidden*` / `rest_cannot_*` means the user's role is too low for that call.
5. **Wordfence turns Application Passwords off by default** (since Wordfence 7.4.14, Dec 2020). This will be the most common blocker. Our help text must say: Wordfence → All Options → Brute Force Protection → untick "Disable WordPress application passwords".
6. **There is no "restore revision" endpoint in core REST.** Revisions are readable (`/wp/v2/posts/<id>/revisions`), but restoring means writing the old `title`, `content` and `excerpt` back with a normal update. Revisions keep only those three fields by default and can be switched off (`WP_POST_REVISIONS` false/0). **AdsPilot must store its own before-copy of every object it changes** (full `context=edit` JSON, including slug, status, meta, featured image, SEO fields), like the Shopify backups.
7. **SEO title and meta description are not core fields.** Yoast's REST output (`yoast_head_json`) is read-only by Yoast's own docs. Writing Yoast or Rank Math fields needs a helper plugin or custom `register_post_meta(... show_in_rest ...)`. Phase 1: read SEO data from `yoast_head_json` (or Rank Math `getHead` if enabled), write only core `title`, `excerpt` and `content`; show the user exact SEO text to paste. Later: an optional tiny companion plugin.
8. **WooCommerce prices are strings**, and whether they include tax depends on `woocommerce_prices_include_tax` (only matters when taxes are on). Read it plus the currency before quoting any price. Variable products are priced per variation.
9. **Do not build on WordPress's MCP Adapter for now.** It needs the user to install a plugin (40,000+ installs vs 7M+ for WooCommerce), it exposes only three read-only core abilities by default, and post editing needs custom abilities. Detect it (`mcp` namespace) and offer it later as an optional path. The old Automattic `wordpress-mcp` plugin was archived on 17 Sep 2026.
10. **WordPress.com-hosted sites are a separate, later integration** (WordPress.com OAuth2 and its own MCP server, which also covers Jetpack-connected self-hosted sites on Jetpack AI/Complete plans).
11. **SSRF:** our hosted server fetches user-supplied URLs. Allow only http/https, resolve DNS once and connect to the checked public IP, block private, loopback, link-local and metadata addresses, and do not follow redirects to another host.
12. **Licences:** WordPress is GPLv2+, WooCommerce GPLv3+, MCP Adapter GPLv2+. Calling them over HTTP from closed-source AdsPilot is fine. Copying their PHP code into AdsPilot is not. A companion plugin we ship must itself be GPL.

### User steps (fastest path, self-hosted WordPress)
1. Log in to wp-admin as the user AdsPilot should act as (ideally a dedicated Editor or Administrator account).
2. Go to **Users → Profile**. Scroll to **Application Passwords**.
3. Type a name ("AdsPilot") and click the add button. Copy the 24-character password shown. It is shown only once.
4. Paste site URL, username and password into AdsPilot. Or skip steps 2–4 and use AdsPilot's "Connect" button (Authorize Application flow).
5. To disconnect: same screen, **Revoke** the "AdsPilot" row.
If the section is missing: the site is not on HTTPS, or a security plugin (usually Wordfence) has disabled it.

---

## 2. Application Passwords: facts

| Fact | Detail | Source (date) |
|---|---|---|
| Since | WordPress 5.6. Generated "from an Edit User page (wp-admin -> Users -> Edit User)". | developer.wordpress.org/rest-api/using-the-rest-api/authentication (retrieved 2026-10-08) |
| UI steps | "Go to Users → Profile" (or edit another user), "Enter a descriptive name", generate, "copy/store it immediately (it will not be shown again)". Stored hashed. | developer.wordpress.org/advanced-administration/security/application-passwords (2026-01-28) |
| Format | 24 characters, upper/lower case and digits, shown in chunks like `abcd EFGH 1234 ijkl MNOP 6789`. "Can be used with or without the spaces." Core strips every non-alphanumeric character before checking (`preg_replace('/[^a-z\d]/i', '', $password)`). | make.wordpress.org/core/2020/11/05/application-passwords-integration-guide (2020-11-05); developer.wordpress.org/reference/functions/wp_authenticate_application_password (retrieved 2026-10-08, from source) |
| Username | Login name or email both work: core looks up by login, then by email. | wp_authenticate_application_password, as above (from source) |
| Transport | HTTP Basic auth (RFC 7617), e.g. `curl --user "USERNAME:PASSWORD" https://HOST/wp-json/wp/v2/users?context=edit`. Not usable on wp-login.php. Also works for XML-RPC. | integration guide (2020-11-05) |
| HTTPS rule | `wp_is_application_passwords_supported()` returns `is_ssl() \|\| 'local' === wp_get_environment_type()` (since 5.9). So a site with `WP_ENVIRONMENT_TYPE` = `local` works over plain HTTP. | developer.wordpress.org/reference/functions/wp_is_application_passwords_supported (retrieved 2026-10-08) |
| Filters | `wp_is_application_passwords_available` (whole site; `__return_false` disables, `__return_true` forces on) and `wp_is_application_passwords_available_for_user` (per user, e.g. admins only). | wp_is_application_passwords_available reference (retrieved 2026-10-08); integration guide (2020-11-05) |
| Permissions | Same as the user. Scoping was only "planned for future versions" in 2020; no core scoping found in 2026. | integration guide (2020-11-05); advanced-administration page (2026-01-28) says nothing on scoping |
| Last used | "Accurate to within 24 hours". | integration guide (2020-11-05) |
| Revocation | Revoke individual passwords on the profile screen. REST: `/wp/v2/users/<id\|me>/application-passwords` (GET, POST, DELETE all) and `/…/application-passwords/introspect` (5.7+) returns the password used for the current request, so AdsPilot can learn its own UUID and delete it on disconnect. | advanced-administration page (2026-01-28); developer.wordpress.org/reference/classes/wp_rest_application_passwords_controller (retrieved 2026-10-08) |
| Authorize flow | Endpoint advertised at `index.authentication['application-passwords'].endpoints.authorization` (normally `/wp-admin/authorize-application.php`). Params: `app_name` (required), `app_id` (UUID, recommended), `success_url` (gets `site_url`, `user_login`, `password` appended), `reject_url`. | integration guide (2020-11-05) |
| Redirect rule | `success_url`/`reject_url` must be HTTPS except loopback or a `local` environment; `javascript:`/`data:` always rejected. Errors `invalid_redirect_url_format`, `invalid_redirect_scheme`. Since 6.3.2. | developer.wordpress.org/reference/functions/wp_is_authorize_application_redirect_url_valid (retrieved 2026-10-08) |

---

## 3. What blocks Application Passwords, and how to detect each

### 3.1 How core handles the credential (from source)
- `wp_validate_application_password` runs on `determine_current_user` at priority 20. It returns early, **without an error**, if Application Passwords are unavailable, or if `$_SERVER['PHP_AUTH_USER']` and `PHP_AUTH_PW` are not both set. Source: developer.wordpress.org/reference/functions/wp_validate_application_password; raw default-filters.php on GitHub WordPress/wordpress-develop trunk (both retrieved 2026-10-08).
- So when the feature is **disabled** or the header is **stripped**, WordPress treats the request as anonymous. It does not return `application_passwords_disabled` on REST in those cases. That code is set inside `wp_authenticate_application_password`, which the REST path only reaches when the feature is available. UNVERIFIED by test; from source.
- `wp_authenticate_application_password` also does nothing until at least one Application Password has ever been created on the site (`WP_Application_Passwords::is_in_use()`). Source: developer.wordpress.org/reference/classes/wp_application_passwords/is_in_use (retrieved 2026-10-08).
- Failures are collected by `rest_application_password_collect_status` and returned by `rest_application_password_check_errors` (on `rest_authentication_errors`, priority 90) with **HTTP 401** if no status was set. Source: developer.wordpress.org/reference/functions/rest_application_password_check_errors (retrieved 2026-10-08).

### 3.2 Error codes WordPress returns

| Situation | HTTP | `code` | Message | Source |
|---|---|---|---|---|
| Unknown username | 401 | `invalid_username` | "Unknown username. Check again or try your email address." (with `<strong>Error:</strong>` prefix) | wp_authenticate_application_password (from source) |
| Unknown email | 401 | `invalid_email` | "Unknown email address. Check again or try your username." | same |
| Wrong application password (or a normal login password) | 401 | `incorrect_password` | "The provided password is an invalid application password." | same |
| Feature off for the user (`…_available_for_user` filter) | 401 | `application_passwords_disabled_for_user` | "Application passwords are not available for your account. Please contact the site administrator for assistance." | same |
| Feature off site-wide | 401 (only on non-REST paths, see 3.1) | `application_passwords_disabled` | "Application passwords are not available." | same |
| Anonymous call to `/wp/v2/users/me` (header stripped, feature off, or no auth) | 401 | `rest_not_logged_in` | "You are not currently logged in." | developer.wordpress.org/reference/classes/wp_rest_users_controller/get_current_item (retrieved 2026-10-08) |
| Site that blocks all anonymous REST (handbook example filter) | 401 | `rest_not_logged_in` | same message | developer.wordpress.org/rest-api/frequently-asked-questions (retrieved 2026-10-08) |
| Permission callback returned false (e.g. settings without `manage_options`) | 401 if anonymous, 403 if logged in | `rest_forbidden` | "Sorry, you are not allowed to do that." UNVERIFIED wording | rest_authorization_required_code: `is_user_logged_in() ? 403 : 401` (retrieved 2026-10-08) |
| `context=edit` without edit rights | 401/403 | `rest_forbidden_context` | | wp_rest_posts_controller/get_items_permissions_check (retrieved 2026-10-08) |
| Publishing without `publish_posts` | 401/403 | `rest_cannot_publish` | "Sorry, you are not allowed to publish posts in this post type." | wp_rest_posts_controller/handle_status_param (retrieved 2026-10-08) |
| Themes list without `switch_themes` | 401/403 | `rest_cannot_view_themes` | "Sorry, you are not allowed to view themes." | wp_rest_themes_controller/get_items_permissions_check (retrieved 2026-10-08) |
| Plugins without `activate_plugins` | 401/403 | `rest_cannot_view_plugins` (code UNVERIFIED) | "Sorry, you are not allowed to manage plugins for this site." | wp_rest_plugins_controller/get_items_permissions_check (retrieved 2026-10-08) |
| Media upload missing headers | 400 | `rest_upload_no_data`, `rest_upload_no_content_type`, `rest_upload_no_content_disposition` | "No data supplied." etc. | wp_rest_attachments_controller/upload_from_data (retrieved 2026-10-08) |

Treat `code` as the stable key. Messages are translated into the site language.

### 3.3 Header stripping (CGI/FastCGI, proxies)
- Cause: in CGI/FastCGI mode Apache handles HTTP auth itself and does not pass the raw `Authorization` header to PHP. Source: github.com/georgestephanis/application-passwords/wiki/Basic-Authorization-Header----Missing (repo archived Nov 2022, retrieved 2026-10-08).
- Core mitigation since 5.6: `wp_populate_basic_auth_from_authorization_header()` rebuilds `PHP_AUTH_USER/PW` from `HTTP_AUTHORIZATION` or `REDIRECT_HTTP_AUTHORIZATION`. And the `.htaccess` that WordPress writes contains `RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]`. Sources: developer.wordpress.org/reference/functions/wp_populate_basic_auth_from_authorization_header; developer.wordpress.org/reference/classes/wp_rewrite/mod_rewrite_rules (both retrieved 2026-10-08). The version that added the rewrite line is UNVERIFIED (a third-party page says 5.6: wp-kama.com/2678, retrieved 2026-10-08).
- So stripping now mostly happens on sites with an old or hand-edited `.htaccess`, nginx/FastCGI setups, or a proxy/WAF in front. Fixes to give users:
  - Apache: `SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1` (handbook FAQ, retrieved 2026-10-08; also really-simple-ssl.com/the-authorization-header-is-missing, 2021-05-10), or re-save **Settings → Permalinks** to rewrite `.htaccess`.
  - nginx: `fastcgi_pass_header Authorization;` (handbook FAQ, retrieved 2026-10-08).
- WordPress's own Site Health has an "Authorization header" test (5.6+). It says "The authorization header is missing" and suggests flushing permalinks. Source: developer.wordpress.org/reference/classes/wp_site_health/get_test_authorization_header (retrieved 2026-10-08). Its REST route needs auth, so it cannot help us before login. Tell users to look at **Tools → Site Health** themselves.

### 3.4 Security plugins

| Plugin | Setting | Effect | Source (date) |
|---|---|---|---|
| Wordfence | "Disable WordPress application passwords" under Wordfence → All Options → Brute Force Protection | **On by default since Wordfence 7.4.14.** Hides the Profile section; feature off site-wide. | wordfence.com/blog/2020/12/wordpress-5-6-introduces-a-new-risk-to-your-site-what-to-do (Dec 2020; page body did not load, fact from search snippet of that page); rudrastyh.com/support/wordfence (undated, retrieved 2026-10-08) |
| Really Simple Security (Really Simple SSL) | Hardening: "Disable application passwords" | Prevents use and creation. | really-simple-ssl.com/instructions/about-hardening-features (2022-08-31) |
| Solid Security (ex-iThemes) | REST API "Restricted Access" (Security → Settings → WordPress Tweaks) | Most REST data needs a logged-in user; an authenticated Application Password should still work (UNVERIFIED). Pro 3.7.0+ can limit a password to REST or XML-RPC and to read-only. | solidwp.com/?p=41007 and solidwp.com/?p=42324 via search (retrieved 2026-10-08); exact behaviour UNVERIFIED |
| All-In-One WP Security | REST restriction option | Could not find the setting's documentation. UNVERIFIED. | — |
| Disable REST API (plugin) | On activation blocks REST for anonymous visitors, per-role rules | Message "DRA: Only authenticated users can access the REST API." So even `/wp-json/` may fail before we authenticate. | wordpress.org/plugins/disable-json-api (retrieved 2026-10-08) |

General rule from WordPress docs: "Security plugins, must-use plugins, or custom code may disable Application Passwords via filters." (advanced-administration page, 2026-01-28).

### 3.5 Hosts, WAFs and CDNs
- **Cloudflare challenge:** the response carries header `cf-mitigated: challenge` and is always `text/html`. Detect it and tell the user to add a WAF skip rule for `/wp-json/*` (or our IPs). Source: developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response (retrieved 2026-10-08).
- **ModSecurity / host WAF:** reported to block REST writes with 403 "WAF: Request blocked by ModSecurity" (OVHcloud community thread, community.ovhcloud.com/t/…/53826, retrieved 2026-10-08), and cPanel ModSecurity can cause 401s (blog.rdpcore.com, retrieved 2026-10-08).
- **Specific managed hosts** (GoDaddy, WP Engine, SiteGround): only old, anecdotal reports found (e.g. GoDaddy Managed WordPress blocking REST, wordpress.org/support/?p=8693263). No current host documentation found. UNVERIFIED for 2026.

---

## 4. Discovery and the REST endpoints AdsPilot needs

### 4.1 Discovery
- Every front-end page sends `Link: <…/wp-json/>; rel="https://api.w.org/"`. Without pretty permalinks it is `Link: <…/?rest_route=/>`. "Clients should … ensure that both routes can be handled." Source: developer.wordpress.org/rest-api/using-the-rest-api/discovery (retrieved 2026-10-08).
- The index (`/wp-json/`) holds `name`, `description`, `url`, `home`, `gmt_offset`, `timezone_string`, `page_for_posts`, `page_on_front`, `show_on_front`, `namespaces`, `authentication`, `routes`, image-size keys, and optionally `site_logo`, `site_icon`. **No WordPress version.** Source: developer.wordpress.org/reference/classes/wp_rest_server/get_index (retrieved 2026-10-08).
- `authentication.application-passwords` is added **only when Application Passwords are available**. Source: developer.wordpress.org/reference/functions/rest_add_application_passwords_to_index (retrieved 2026-10-08).
- Plugins are detected from `namespaces`: `wc/v3` = WooCommerce REST, `yoast/v1` = Yoast, `rankmath/v1` = Rank Math, `mcp` = MCP Adapter (namespace inferred from its endpoint path `/wp-json/mcp/mcp-adapter-default-server`), `wp-abilities/v1` = Abilities API (6.9+). Source: discovery page above; github.com/WordPress/mcp-adapter (retrieved 2026-10-08).
- **WordPress version:** not in REST. The homepage `<meta name="generator" content="WordPress x.y">` from `wp_generator()` is common but often removed with `remove_action('wp_head','wp_generator')`. Source: developer.wordpress.org/reference/functions/wp_generator (retrieved 2026-10-08). Treat version as "unknown" and use feature detection (namespaces, routes).
- The `routes` list in the index is large on plugin-heavy sites. Cache it per site.

### 4.2 Endpoints and capabilities

| Need | Endpoint | Capability | Notes | Source (retrieved 2026-10-08 unless dated) |
|---|---|---|---|---|
| Who am I | `GET /wp/v2/users/me?context=edit` | logged in | `context=edit` returns `roles` and `capabilities`. Use them to plan which tools to offer. | users controller reference |
| Pages / posts list and raw content | `GET /wp/v2/pages`, `/wp/v2/posts` with `context=edit`, `status=any` | `edit_posts` / `edit_pages` for `context=edit` | Without `context=edit` you get rendered HTML only. | posts controller get_items_permissions_check |
| Create or update | `POST /wp/v2/posts`, `POST /wp/v2/posts/<id>` (same for pages) | `edit_post` on the item | `draft` and `pending` need no publish right. `publish`, `future`, `private` need `publish_posts`/`publish_pages`, else `rest_cannot_publish`. | handle_status_param |
| Revisions | `GET /wp/v2/posts/<id>/revisions[/<rev>]`, same for pages; `DELETE` needs `force=true` | `edit_post` on the parent | See section 5. | post-revisions reference; revisions controller |
| Autosaves | `GET/POST /wp/v2/posts/<id>/autosaves`, `GET …/autosaves/<id>` | `edit_post` | | post-revisions reference |
| Media upload | `POST /wp/v2/media` with raw file body plus `Content-Type` and `Content-Disposition: attachment; filename="x.jpg"`, or multipart `file` field (multipart field name UNVERIFIED in docs found) | `upload_files` (and `edit_post` if attaching to a post) | Then `POST /wp/v2/media/<id>` to set `alt_text`, `caption`, `title`, `description`. Unsupported image formats may be refused (6.8 change). | media reference; attachments controller create_item_permissions_check, upload_from_data |
| Site settings | `GET/POST /wp/v2/settings` | `manage_options` (admin) | Fields: title, description, url, email, timezone, date_format, time_format, start_of_week, language, use_smilies, default_category, default_post_format, posts_per_page, show_on_front, page_on_front, page_for_posts, default_ping_status, default_comment_status, site_logo, site_icon. **No `permalink_structure`, no `blog_public` (search-engine visibility).** | settings reference; settings controller |
| Active theme | `GET /wp/v2/themes?status=active` | `edit_posts` (or edit right on any REST post type) since 5.7 | All themes need `switch_themes` or `manage_network_themes`. | themes controller check_read_active_theme_permission |
| Plugins | `GET /wp/v2/plugins` (5.5+) | `activate_plugins` | Read-only in AdsPilot. Never activate/install without explicit approval. | plugins controller |
| Site Health | `GET /wp-site-health/v1/tests/{background-updates, loopback-requests, https-status (5.7), dotorg-communication, authorization-header, page-cache (6.1)}`, `/directory-sizes` (not multisite) | `view_site_health_checks` (filterable per test) | Async tests only; the "direct" tests are not in REST (UNVERIFIED that none are). | wp_rest_site_health_controller |
| Self-revoke | `GET /wp/v2/users/me/application-passwords/introspect`, then `DELETE …/application-passwords/<uuid>` | own user | | application passwords controller |

Pagination: core uses `per_page` (max 100) with `X-WP-Total` and `X-WP-TotalPages` headers. UNVERIFIED in this pass (standard behaviour, no page re-read).

---

## 5. Revisions, autosaves and our own backup

- Routes and fields: revisions have `author`, `date`, `date_gmt`, `guid`, `id`, `modified`, `modified_gmt`, `parent`, `slug`, `title`, `content`, `excerpt`. Deleting needs `force=true` ("revisions do not support trashing"). **No restore endpoint is documented.** Source: developer.wordpress.org/rest-api/reference/post-revisions (retrieved 2026-10-08).
- Restore in practice: read the revision with `context=edit`, then `POST /wp/v2/posts/<parent>` with its raw `title`, `content`, `excerpt`. This creates a new revision, so it is undoable.
- Only `post_title`, `post_content`, `post_excerpt` are revisioned by default. Source: developer.wordpress.org/reference/functions/_wp_post_revision_fields (retrieved 2026-10-08). Since 6.4, meta can opt in with `revisions_enabled` in `register_meta` (default false). Source: make.wordpress.org/core/2023/10/24/framework-for-storing-revisions-of-post-meta-in-6-4 (2023-10-24).
- Revisions can be off: `WP_POST_REVISIONS` false or 0 disables them; a number limits them; filters `wp_revisions_to_keep` and `wp_{post_type}_revisions_to_keep` override. Source: developer.wordpress.org/reference/functions/wp_revisions_to_keep (retrieved 2026-10-08).
- **Conclusion:** AdsPilot keeps its own backup before every write: the full `context=edit` object (slug, status, template, featured_media, categories, tags, meta, plus SEO plugin fields and Woo product JSON). Restore = write that back. Use WordPress revisions only as a secondary safety net.

---

## 6. SEO title and meta description

| Option | Read | Write | Source (date) |
|---|---|---|---|
| Core | `title`, `excerpt`, `content` | Yes, standard REST | REST reference (retrieved 2026-10-08) |
| Yoast SEO | `yoast_head` (HTML) and `yoast_head_json` on post responses (Yoast 16.7+), and `/yoast/v1/get_head?url=` | **No.** "The Yoast REST API is currently read-only, and doesn't currently support POST or PUT calls." | developer.yoast.com/customization/apis/rest-api (page example dated 2024-08-21, retrieved 2026-10-08) |
| Yoast meta keys | `_yoast_wpseo_title`, `_yoast_wpseo_metadesc` | Only if exposed with `register_post_meta(... 'show_in_rest' => true, 'auth_callback' => …)` or a helper plugin such as "SEO Fields API Support". Underscore keys are protected and not in REST by default (UNVERIFIED wording). | wordpress.org/plugins/seo-fields-api-support (retrieved 2026-10-08) |
| Rank Math | `GET /wp-json/rankmath/v1/getHead?url=` when "Headless CMS Support" is enabled | Third-party plugins ("Rank Math API Manager") add `POST /wp-json/rank-math-api/v1/update-meta` for `rank_math_title`, `rank_math_description`, etc. A native Rank Math write route used by its editor is UNVERIFIED. | rankmath.com/kb/headless-cms-support (retrieved 2026-10-08); github.com/Devora-AS/rank-math-api-manager (retrieved 2026-10-08) |

Recommendation: phase 1 reads SEO data (Yoast JSON or Rank Math getHead) and writes only core fields. It hands the user the exact SEO title and description to paste. Phase 2: an optional, GPL, single-purpose AdsPilot companion plugin that registers the Yoast/Rank Math keys for REST with an `edit_post` check. Do not ask users to install random third-party "API bridge" plugins.

---

## 7. WooCommerce REST API v3

### 7.1 Authentication
- Woo's docs describe consumer key/secret: Basic auth over HTTPS, query-string `consumer_key`/`consumer_secret` when the server mangles the `Authorization` header, OAuth 1.0a over plain HTTP. Requirements: WooCommerce 3.5+, WordPress 4.4+, **pretty permalinks**. Keys inherit "that user's WordPress roles and capabilities". Woo's docs do not mention Application Passwords. Sources: woocommerce.github.io/woocommerce-rest-api-docs/#authentication; developer.woocommerce.com/docs/apis/rest-api/authentication (both retrieved 2026-10-08).
- **Application Passwords work with `wc/v3` (confirmed from source, not tested).** `WC_REST_Authentication::authenticate` runs on `determine_current_user` at priority 15 and returns early if a user is already set. Over HTTPS it treats `PHP_AUTH_USER` as a consumer key; when no key matches, it returns false **without setting an error**. OAuth then finds no `oauth_*` parameters and also sets no error. Core's `wp_validate_application_password` (priority 20) then logs the user in. Sources: raw.githubusercontent.com/woocommerce/woocommerce/trunk/plugins/woocommerce/includes/class-wc-rest-authentication.php; WordPress default-filters.php (both retrieved 2026-10-08). A third-party guide states the same (stackharbor.com wp-woocommerce-rest-api-auth, retrieved 2026-10-08).
- Woo error to know: a wrong secret for a real consumer key gives 401 `woocommerce_rest_authentication_error` "Consumer secret is invalid." (same source). Woo's docs: "Consumer key is missing" over SSL means a server header problem.
- Pretty permalinks: Woo's docs require them. Whether `?rest_route=/wc/v3/…` works on plain permalinks is UNVERIFIED.

### 7.2 Capabilities (from Woo source `wc-rest-functions.php`, retrieved 2026-10-08)
- Products use post-type capabilities: read → `read_private_products`, create → `publish_products`, edit → `edit_product`, delete → `delete_product`, batch → `edit_others_products`. (Map: `read_private_posts`, `publish_posts`, `edit_post`, `delete_post`, `edit_others_posts` on the `product` type.) Shop Manager and Administrator have these.
- Settings, system status, shipping methods, payment gateways, webhooks → `manage_woocommerce`. Reports → `view_woocommerce_reports`. Attributes → `manage_product_terms`.

### 7.3 Product fields
- `name`, `description`, `short_description`, `type` (`simple`, `grouped`, `external`, `variable`), `status` (`draft`, `pending`, `private`, `publish`), `regular_price` (string), `sale_price` (string), `date_on_sale_from` / `date_on_sale_to` ("in the site's timezone"; `_gmt` variants exist). Source: woocommerce.github.io/woocommerce-rest-api-docs, product properties (retrieved 2026-10-08).
- Variable products: prices live on variations, `/wc/v3/products/<product_id>/variations[/<id>]`, batch at `…/variations/batch`, up to 100 objects per batch. Source: withone.ai WooCommerce knowledge page and REST docs table of contents (retrieved 2026-10-08); batch limit filterable via `woocommerce_rest_batch_items_limit` (wp-kama.ru, retrieved 2026-10-08).
- Send prices as strings ("19.99"), using the store's decimal setting. Empty `sale_price` clears a sale (UNVERIFIED).

### 7.4 Tax and currency
- `woocommerce_prices_include_tax` = "Prices entered with tax". `wc_prices_include_tax()` is true only when taxes are enabled **and** this option is `yes`. Changing it does not update existing products. Read it at `GET /wc/v3/settings/tax/woocommerce_prices_include_tax` (or the whole `/settings/tax` group). Sources: wp-kama.com/plugin/woocommerce/function/wc_prices_include_tax; docs.WooCommerce.com settings-tax view (both retrieved 2026-10-08). Read `woocommerce_calc_taxes` in `/settings/general` too (key name UNVERIFIED in this pass).
- Currency: `GET /wc/v3/data/currencies/current` (code, name, symbol). Source: WC_REST_Data_Currencies_Controller docs (docs.WooCommerce.com, retrieved 2026-10-08). Settings routes need `manage_woocommerce`, so a Shop Manager is enough; an Editor is not.
- So the AI can say: "Prices on this store are entered including tax" or "excluding tax", or "taxes are off".

---

## 8. WordPress.com-hosted sites (later)

- WordPress.com uses OAuth2: register at developer.wordpress.com/apps; authorize `https://public-api.wordpress.com/oauth2/authorize`, token `…/oauth2/token`. Tokens can be per-blog or `global` (all the user's WordPress.com and Jetpack-connected sites). Source: developer.wordpress.com/docs/oauth2 (2026-01-22).
- Core REST via the proxy has the form `https://public-api.wordpress.com/wp/v2/sites/<site>/…` (third-party description: apidog.com WordPress API blog, retrieved 2026-10-08; exact form UNVERIFIED on official docs).
- WordPress.com MCP server: `https://public-api.wordpress.com/wpcom/v2/mcp/v1`, OAuth 2.1 with PKCE, "Full access" or "Read only" at consent. Available on all paid plans (free sites for 30 days). Self-hosted sites connected through **Jetpack AI or Complete** use the same server. Source: developer.wordpress.com/docs/mcp (2026-10-07).
- Application Passwords on Business/Commerce (Atomic) sites via `<site>/wp-json/`: a forum post says you can generate one in classic wp-admin, but no official statement found. UNVERIFIED. Treat WordPress.com as a separate connector for a later phase.

---

## 9. WordPress's official MCP work

| Item | Status | Source (date) |
|---|---|---|
| **Abilities API** | In core since **WordPress 6.9** (server side: `wp_register_ability()` etc., REST at `/wp-abilities/v1/`). 6.9 ships three core abilities: `core/get-site-info`, `core/get-user-info`, `core/get-environment-info`. WordPress 7.0 (20 May 2026) added the JavaScript side, a WP AI Client and a Connectors API. | make.wordpress.org/core/2025/11/10/abilities-api-in-wordpress-6-9 (2025-11-10, via search); developer.wordpress.org/news/2026/04/whats-new-for-developers-april-2026; jorijn.com/nandann.com summaries (2026, via search) |
| **MCP Adapter** (`WordPress/mcp-adapter`) | **A plugin, not core.** v0.7.0, 2 Oct 2026, 40,000+ installs, needs WP 6.9+, PHP 7.4+, tested to 7.1.3. GPL-2.0-or-later. HTTP and STDIO (WP-CLI) transports. Default server at `/wp-json/mcp/mcp-adapter-default-server` with three meta-tools: `mcp-adapter/discover-abilities`, `get-ability-info`, `execute-ability`. Abilities are private unless registered with `meta.mcp.public = true`. Auth = WordPress user (Application Password over HTTPS, or a custom OAuth layer). | github.com/WordPress/mcp-adapter (retrieved 2026-10-08); wordpress.org/plugins/mcp-adapter (retrieved 2026-10-08); instawp.com/wordpress-mcp-adapter-review (2026-10-06) |
| MCP Adapter caveats | No post editing out of the box (needs custom abilities). A reviewer says "Any Subscriber can reach the server by default" (only `read` capability checked; filter `mcp_adapter_default_transport_permission_user_capability`). HTTP transport needs an `Mcp-Session-Id` header after initialise. | instawp.com review (2026-10-06); single third-party source, partly UNVERIFIED |
| **Automattic `wordpress-mcp`** | **Deprecated and archived 17 Sep 2026**; points to `mcp-adapter` and developer.wordpress.com/docs/mcp. | github.com/Automattic/wordpress-mcp (retrieved 2026-10-08) |
| **WordPress.com MCP** | See section 8. Hosted by Automattic; not for ordinary self-hosted sites without Jetpack AI/Complete. | developer.wordpress.com/docs/mcp (2026-10-07) |

**Should AdsPilot use MCP Adapter instead of REST?** Not as the main path.
- Reach: it needs a plugin install. 40,000+ installs against WooCommerce's 7M+ shows most sites will not have it in 2026.
- Function: by default it exposes three read-only info abilities. Editing posts, media, SEO or products depends on which other plugins registered public abilities. Each site would be different, so our tools and safety checks could not be predictable.
- Control: AdsPilot's value is its approval gate, backups and restore. Those need known operations on known fields, which core REST gives on every site since 5.6.
- Licence: talking to it over HTTP is fine (GPL-2.0+); we must not copy its code.
- Plan: REST now. At connect time, if `namespaces` contains `mcp` or `wp-abilities/v1`, record it. Later, list public abilities (`GET /wp-abilities/v1/abilities`) and offer selected ones as extra, read-first tools.

---

## 10. SSRF (our server fetches user-supplied site URLs)

From the OWASP SSRF Prevention Cheat Sheet, case "application must fetch arbitrary external URLs" (cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html, retrieved 2026-10-08):
- Allow only `http`/`https` ("allowed list of protocols").
- Resolve the host and check every IP is public. Block 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, loopback, link-local, and cloud metadata (`169.254.169.254`, `metadata.google.internal`, Azure's endpoint). Also block IPv6 equivalents (::1, fc00::/7, fe80::/10) and IPv4-mapped IPv6 (our addition, standard practice).
- DNS rebinding: "Bind the connection to a validated address". In Node, resolve once, validate, then connect to that IP with the original `Host`/SNI (a custom `lookup` on the HTTP agent), and re-validate on every new connection.
- "Disable the support for redirection in the web client". Handle 3xx ourselves: allow only a same-site http→https or `www` change, re-validated; refuse other hosts.
- "Deny-lists are bypass-prone. Prefer allow-lists." For us the allow-list is the site the user connected, stored once.
- Also: cap response size and time, never send the Application Password to any host other than the stored site, and never follow the `success_url` values from the site itself.

---

## 11. Licences

- WordPress: "GPLv2 (or later)". "Derivatives of WordPress code inherit the GPL license"; WordPress.org treats plugins and themes as derivatives. Source: wordpress.org/about/license (retrieved 2026-10-08).
- WooCommerce: GPL "version 3 of the License, or (at your option) any later version". Source: raw.githubusercontent.com/woocommerce/woocommerce/trunk/plugins/woocommerce/license.txt (retrieved 2026-10-08).
- MCP Adapter: GPL-2.0-or-later. Source: github.com/WordPress/mcp-adapter (retrieved 2026-10-08).
- GPL FAQ: "pipes, sockets and command-line arguments are communication mechanisms normally used between two separate programs", unless the exchange is "intimate enough, exchanging complex internal data structures". Source: gnu.org/licenses/gpl-faq.html#MereAggregation (quoted via search; the page itself returned HTTP 429, retrieved 2026-10-08).
- So: AdsPilot calling REST or MCP over HTTPS is a separate program and can stay proprietary. Do not paste WordPress or WooCommerce PHP (or GPL client code) into AdsPilot. Any WordPress companion plugin we distribute must be GPL-compatible. Its code is then public, so keep secrets and business logic on our server. Not legal advice.

---

## Recommendation

1. **Phase 1 (build now): core REST + Application Passwords**, one connector for WordPress and WooCommerce.
   - Connect: "Connect" button using the Authorize Application flow, with manual paste as fallback. Store `site_url`, `user_login` and password encrypted in the vault per tenant; record the password UUID via `/introspect`.
   - Probe: index → app-password key → `users/me?context=edit` → wrong-password check if needed → `namespaces` (wc/v3, yoast/v1, rankmath/v1, mcp). Give one plain-English fix per failure (HTTPS, Wordfence toggle, header fix, Cloudflare rule, role too low).
   - Tools: site overview (index, settings if admin, active theme, plugins, Site Health), page/post audit (`context=edit`), draft-first edits (create or update as `draft`/`pending` unless the user approves publishing), media upload with alt text, Woo product overview and price/description edits (with tax and currency stated).
   - Safety: AdsPilot's own backup before every write, plus restore; approval token on every write; never install, activate or change plugins, themes, permalinks or users.
2. **Phase 2:** optional GPL companion plugin for SEO meta (Yoast/Rank Math) and anything core REST lacks; Abilities/MCP Adapter tools when detected.
3. **Phase 3:** WordPress.com OAuth connector (also reaches Jetpack AI/Complete sites through its MCP server).
4. **Test before launch** (none done here): a real HTTPS site with Wordfence on and off, Apache CGI with a stripped header, nginx, Cloudflare challenge, a Shop Manager user on WooCommerce, and a site with revisions disabled.
