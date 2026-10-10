# Google suite plan: one Google connection, six products

**Date:** 2026-10-01
**Status:** proposed. Nothing in it is built.
**Facts and sources:** `docs/research/2026-10-01-google-suite.md`. Anything marked
UNVERIFIED there stays unverified here.

**Order of work:** owner's own business first (1920 Agency), customers second.
This follows the roadmap's owner priorities (`docs/product/roadmap.md`): social first (GBP and YouTube), then
ads.

---

## 0. What the research changed

Read these before anything else.

1. **There is no developer token to apply for any more, and no manager account is
   needed.** Google Ads access is now a level on the Cloud project (Test, Explorer,
   Basic, Standard). Basic needs brand verification and is then often granted
   automatically. Keyword Planner needs Basic.
2. **Google's 31 August 2026 Developer Policies name MCP servers as prohibited
   "programmatic proxies"** when they "solely" re-expose Google Ads.
   - The owner's own use is exempt.
   - **Google Ads for customers must not launch until Google confirms in writing
     that AdsPilot's model is acceptable** (research 3.6). This is now the
     longest and least certain lead in the whole plan.
3. **YouTube uploads have their own bucket of 100 a day.** Quota is no longer the
   problem. The **audit** is: until it passes, every API upload is **private**.
4. **Google's own Ads page calls the `adwords` scope "restricted"**, though it is
   missing from Google's restricted list.
   - If it is restricted, customer-facing Google Ads also needs a CASA security
     assessment: about 6 weeks, paid to the assessor, and repeated yearly.
   - **Keep `adwords` in its own bundle.** That way GBP, YouTube, Search Console,
     GA4 and GTM verification never wait on it.
5. **"One click" tracking is "one click and, at most, one paste".** No Google API
   can edit the website itself, and a GTM *account* cannot be created through the
   API.

---

## 1. Architecture

### 1.1 One Google connection that grows (incremental scopes)

- **One `Provider` with key `google`.** One OAuth client per Cloud project.
- **One `ProviderAuth` row per tenant per Google user.** The table and the
  `scopes` column already exist.
- Each product is a **scope bundle**, requested the first time that product is
  used, with `include_granted_scopes=true`, `access_type=offline` and
  `prompt=consent`.
- After every grant, the `scope` field of the token response is written to
  `ProviderAuth.scopes`.
- **Granular consent means a user may untick anything.** So a product is
  "connected" only if *its* scopes are in that list. It is never assumed from the
  bundle we asked for.

| Bundle | Scopes | Requested when |
|---|---|---|
| `identity` | `openid email profile` | First connect, always |
| `business_profile` | `business.manage` | First GBP tool use |
| `youtube` | `youtube.upload`, `youtube`, `yt-analytics.readonly` | First YouTube tool use |
| `search` | `webmasters`, `siteverification` | First Search Console tool or tracking setup |
| `analytics` | `analytics.readonly`, later `analytics.edit` | First GA4 read; `edit` only at tracking setup |
| `tags` | `tagmanager.edit.containers`, `tagmanager.edit.containerversions`, `tagmanager.publish` | Tracking setup only |
| `ads` | `adwords` | First Google Ads tool use |

How the MCP side handles a missing bundle:

- When a tool needs a bundle the connection lacks, it returns a resolution
  (RULES R1) with a **connect link for that bundle only**. It does not fail
  silently.
- New error codes for `resolutions.ts`:
  - `GOOGLE_SCOPE_NOT_GRANTED` (the user unticked it)
  - `GOOGLE_PRODUCT_NOT_APPROVED` (e.g. GBP quota 0, or Ads at Explorer)
  - `GOOGLE_TOKEN_REVOKED`
  - `YOUTUBE_UPLOAD_PRIVATE_UNTIL_AUDIT`
  - `GTM_NO_ACCOUNT`
  - `GA4_TERMS_NOT_ACCEPTED`
  - `SITE_SNIPPET_NOT_FOUND`

**Why not ask for every scope at once:** a frightening consent screen, partial
grants anyway, and a verification review that cannot see a feature for each
scope. Research section 1 has the details.

### 1.2 Where tokens live: the existing vault

- **The Google refresh token** is encrypted in `ProviderAuth.secretCiphertext`
  through `packages/vault`, like Meta's long-lived user token.
- **Access tokens last about 1 hour.** They are minted inside `withCredential`
  and never stored.
- **One contract gap to close first.** `Provider.refresh(currentToken)` receives
  only the *access* token. Google refreshes with the *refresh* token.
  - This is the gap the LinkedIn provider already documents and deliberately
    leaves unwired.
  - The fix: give the vault's `RefreshFn(StoredCredential)`, which already
    carries `refreshToken`, a path through the Provider interface.
  - Make that an **additive** change (RULES R8), so the Meta and LinkedIn paths
    stay untouched.
- **Revocation:** a refresh failure with `invalid_grant` sets
  `ProviderAuth.needsReauth`, using the existing 1.4 machinery. A token can die
  for several reasons:
  - 6 months unused
  - the user revokes access
  - the 7-day Testing limit
  - the 100-token-per-client limit
- **Never in the workspace:** client secret, refresh tokens, service account JSON.
  The client ID and secret go in `%USERPROFILE%\.social-publisher\.env`, as
  today.

### 1.3 What a Google authorisation discovers

Google is unlike Meta: there is **one user token** and no per-asset tokens. So
discovery produces two kinds of record.

- **Publishing surfaces** become `Connection` rows, so the existing post, target
  and job pipeline works unchanged:
  - `google_business_profile`: one per GBP **location**. Its `platformAccountId`
    is `accounts/{a}/locations/{l}`.
  - `youtube`: one per **channel**. `youtube` already exists in `PLATFORMS`;
    `google_business_profile` must be added.
  - Each Connection points at its `ProviderAuth`. Its credential is the shared
    Google token, not its own.
- **Non-publishing assets** go in a **new `ProviderAsset` table**:
  - Columns: `tenant_id`, `provider_auth_id`, `kind`, `external_id`,
    `display_name`, `meta jsonb`.
  - Kinds: `ads_customer`, `ga4_property`, `gsc_site`, `gtm_container`.
  - They are not publishing targets and should not be forced into `Connection`,
    in the same way that ads were not forced into `PostDraft` (decision 0003).
- **Tenant scoping:**
  - every row carries `tenant_id`, with RLS behind application-layer scoping
  - every tool resolves an asset by `(tenant_id, id)` before any call to Google
  - a GBP location or Ads customer is never addressed by a raw Google ID that
    arrived in a prompt

### 1.4 Adapters, one per product

Each is the only code that knows its API (RULES R10).

| Module | Wraps | Notes |
|---|---|---|
| `google-provider.ts` | OAuth, scope bundles, discovery across products | One provider |
| `google-business.ts` | v4 localPosts and reviews, Performance API v1, Account Management | A `PlatformAdapter` for posts. Media by public URL (`requiresPublicMediaUrl: true`). Respects 10 edits a minute per profile |
| `youtube.ts` | `videos.insert` (resumable), `videos.update`, `thumbnails.set`, Analytics `reports.query` | A `PlatformAdapter`. Must report "uploaded, private until audit" honestly, never as "published" |
| `google-search-console.ts` | searchanalytics, sitemaps, sites, urlInspection | Read-mostly |
| `google-analytics.ts` | Admin v1beta (properties, dataStreams, keyEvents, googleAdsLinks), Data API | |
| `google-tag-manager.ts` | containers, workspaces, tags, triggers, variables, versions | Rate-limited to the **0.25 QPS project quota**. Runs only inside a queued job |
| `google-site-verification.ts` | getToken, insert | |
| `google-ads.ts`, `google-ads-guardrails.ts`, `google-ads-naming.ts` | GoogleAdsService mutate and search, ConversionActionService, KeywordPlanIdeaService | Mirrors the Meta file layout. Uses REST or the gRPC client; **no developer-token header** |

**Cloud projects:**

- **Two:** `adspilot-dev` and `adspilot-prod`. Google's OAuth policy asks for
  this.
- The Google Ads policy requires a **dedicated** project per integration, so the
  AdsPilot project is used for nothing else.
- YouTube and Tag Manager quotas are **per project and shared by all tenants.**
  The worker meters them per tenant so that one tenant cannot exhaust them.

---

## 2. Tools to add, with risk levels

The policy classes are the existing ones in `core/src/domain/policy.ts`.

- **Low** executes.
- **Medium** executes and is audited.
- **High** returns a summary and an HMAC approval token, and executes only when
  the token is echoed back.
- Anything that spends money also passes the **spend ceiling** and is created
  **paused**, exactly as on Meta.

### Google Business Profile

| Tool | Risk | Notes |
|---|---|---|
| `list_business_locations` | low | |
| `get_business_insights` | low | Daily metrics and monthly search keywords |
| `list_reviews` | low | Review text cached for 30 days at most (GBP policy) |
| `draft_review_reply` | low | Returns text only, sends nothing |
| `reply_to_review` | **high** | Public, under the business's name. GBP policy forbids automated replies without explicit consent |
| `delete_review_reply` | medium | |
| Posting | via `publish_post`, `schedule_post` | GBP becomes a platform. The existing publish policy applies. EVENT and OFFER fields go in per-platform overrides |

### YouTube

| Tool | Risk | Notes |
|---|---|---|
| `list_youtube_channels`, `get_youtube_analytics` | low | |
| Upload | via `publish_post` (high) and `schedule_post` (medium) | Privacy is an explicit field. Until the audit passes, the adapter forces `private` and the result says so |
| `update_video_metadata` | high on a public video, medium on a private one | Title, description, tags, thumbnail |

### Search Console

| Tool | Risk | Notes |
|---|---|---|
| `get_search_performance` | low | |
| `inspect_url` | low | Status only. The result includes the UI link for Request Indexing |
| `list_sitemaps` | low | |
| `submit_sitemap` | medium | Harmless and repeatable |
| `add_search_console_site` | medium | |

There is **deliberately no `request_indexing` tool for ordinary pages.** The
Indexing API is only for JobPosting and BroadcastEvent pages, and misusing it
risks revocation. Record this as rejected (R5).

### GA4

| Tool | Risk |
|---|---|
| `get_analytics_report`, `get_realtime_report`, `list_ga4_properties` | low |
| `create_ga4_property` | high (permanent, under the user's account) |
| `mark_key_event` | medium |

### Tracking setup (section 3)

| Tool | Risk | Notes |
|---|---|---|
| `check_tracking_setup` | low | The `check_ad_setup` pattern: says what exists, what is missing, and who does each step |
| `plan_tracking_setup` | low | Returns the full plan: tags, triggers, key events, conversion actions, consent defaults |
| `apply_tracking_setup` | **high** | One approval for the whole plan. Builds a GTM workspace and version but **does not publish** |
| `publish_tracking` | **high** | Publishing a GTM version changes the live website for every visitor |
| `verify_tracking` | low | Fetches the site and checks the snippet; reads GA4 realtime and the Tag Diagnostics state |

### Google Ads (customer-facing only after the proxy question is answered)

| Tool | Risk | Notes |
|---|---|---|
| `research_keywords`, `get_keyword_history` | low | Needs **Basic** access. Without it, returns `GOOGLE_PRODUCT_NOT_APPROVED` with the fix |
| `list_ads_accounts`, `get_google_ads_performance`, `check_google_ads_setup` | low | |
| `preview_google_ad` | low | Uses `validate_only=true` |
| `create_google_ads_plan` | **high** | Budget, campaign **PAUSED**, ad groups, RSAs or PMax asset groups. Spend ceiling, the daily minimum and guardrails are enforced in code |
| `activate_google_campaign` | **high** + ceiling | Refused if billing is not set up |
| `update_google_budget` | **high** + ceiling | Micros are converted in exactly one place. Ceilings are in the account's currency, with no conversion (decision 0003) |
| `pause_google_campaign` | medium | |
| `create_conversion_action` | high | |
| `upload_offline_conversions` (later) | medium | Use the **Data Manager API** (`datamanager` scope). For a new integration, the Ads API path for click conversion uploads fails from 15 June 2026 |

Notes for the Google Ads tools:

- Every campaign create must set `contains_eu_political_advertising`. Default it
  to "does not contain", and make it part of the approval summary.
- Card billing and new Ads accounts are UI steps for most customers. API account
  creation needs a manager account and more than $1,000 of past spend.
- `check_google_ads_setup` therefore returns direct links for those steps, as
  `check_ad_setup` does on Meta.

---

## 3. One-click tracking, step by step

The goal: the user says "set up my tracking", approves once, and Google Tag Manager
with GA4, Google Ads conversions, the Google tag, Search Console verification and
mapped events is live.

**A** means automatic. **U** means the user does it, and the tool gives a direct
link each time.

| # | Step | Who | How |
|---|---|---|---|
| 1 | Connect Google with the `search`, `analytics` and `tags` bundles (`ads` if they advertise) | **U, one consent** | Incremental OAuth |
| 2 | Check what exists: GTM accounts and containers, GA4 properties, Ads customers, GSC sites, and whether the site already has a GTM or gtag snippet | A | `check_tracking_setup` |
| 3 | Only if the user has **no GTM account**: create it in the GTM UI | **U, about 1 minute** | No API exists. Alternative: a container in 1920 Agency's GTM account with the user granted access. Trade-off: we own it |
| 4 | Only if the user has **no GA4 account**: accept the GA Terms of Service | **U, one click** | `provisionAccountTicket`, then the ToS page |
| 5 | Create the GA4 property and web data stream, and get the Measurement ID | A | Admin API v1beta |
| 6 | Detect the site platform and the business type (lead gen, e-commerce, booking) | A | Fetch the homepage and look for generator tags and Shopify, Wix or Squarespace markers |
| 7 | Draft the event map: e.g. `generate_lead` (form submit, thank-you URL), `purchase` (data layer), `sign_up`, `contact` (tel: and mailto: clicks), `book_appointment` | A, then **U reviews** | `plan_tracking_setup`. Shown in plain language in the approval summary |
| 8 | **Approval** | **U, one approval** | `apply_tracking_setup` returns the HMAC token |
| 9 | Create the GTM container, workspace, Google tag, GA4 event tags, triggers, variables, conversion linker, and consent defaults (denied for EEA and UK, granted elsewhere, via region codes) | A, queued job, about 2–4 minutes at 0.25 QPS | Tag Manager API |
| 10 | Create Google Ads conversion actions (WEBPAGE) and add `awct` tags with their IDs and labels. Link GA4 to Ads with `googleAdsLinks.create` | A | Ads API and GA Admin API |
| 11 | Mark the mapped GA4 events as key events | A | `keyEvents.create` |
| 12 | Create the container version | A | `create_version`. **Not published yet** |
| 13 | **Get the snippet onto the site**: the honest limit | Depends on platform, see below | |
| 14 | **Publish the version** | **U, one approval** (`publish_tracking`) | `versions.publish` |
| 15 | Verify Search Console with the TAG_MANAGER method, add the property, submit the sitemap | A | Site Verification and Search Console APIs |
| 16 | Check that it works: the snippet is present, GA4 realtime receives a test hit, Tag Diagnostics are clean | A, `verify_tracking` | Report "verified" only when seen (R4) |
| 17a | Import GA4 key events into Ads. Once linked, they appear as HIDDEN conversion actions; we set them to ENABLED and choose primary or secondary | A | Ads API (verified in docs) |
| 17b | Accept the enhanced-conversions customer data terms | **U, one screen in the Ads UI** | The field is output-only in the API (verified in docs) |
| 18 | Choose a cookie banner (CMP) for EEA and UK visitors | **U decides** | A legal and UX choice. We offer certified CMP templates from the GTM gallery, installed with `import_from_gallery`. Not needed for Pakistan-only traffic |

### Step 13 by platform

| Site | What the user does | What we build |
|---|---|---|
| WordPress (self-hosted) | Install the AdsPilot plugin once, or connect the WordPress MCP | A tiny plugin that prints the container snippet in `wp_head` and `wp_body_open`. Site Kit is the alternative, but it is Google-run, so it is harder to drive and our container has to be selected in it |
| Shopify | Paste into a **custom pixel** following Shopify's GTM tutorial. The Google & YouTube channel covers GA4 natively | A custom pixel has no `noscript`, so verify Search Console by META or DNS rather than the GTM method. Theme editing by API needs `write_themes` **plus a Shopify exemption** (verified), so a Shopify app is a later, separate application |
| Wix | Paste the container ID in Marketing Integrations | Nothing; there is no API |
| Squarespace (Core or above) | Paste the snippet in Code Injection | Nothing; there is no API |
| Webflow and others | Paste the snippet in custom code | Nothing |
| A site 1920 Agency hosts | Nothing | Put it in the template |

**After the snippet is in once, every later change goes through GTM with no
website edit.** That includes new events, the Meta pixel, consent and new
conversion actions.

### Meta pixel and Conversions API later, through the same container

- Add the Meta pixel tag to the same GTM container, with the pixel ID from
  `create_pixel`, which is already built.
- Map the same data-layer events (`generate_lead` to `Lead`, `purchase` to
  `Purchase`) and generate one `event_id` per event, for later CAPI
  deduplication.
- Server-side CAPI is a separate build, covered in
  `docs/research/2026-09-28-meta-conversions-api.md`.

---

## 4. Phases, in order

| Phase | What | Gate to move on |
|---|---|---|
| **0. Owner setup** (starts now, runs in parallel) | Cloud projects, consent screen, enable APIs, brand verification. Submit **GBP access**, **YouTube audit**, **Ads Explorer then Basic**, and the **proxy-policy question** to Google | The forms are submitted. They take days to weeks, which is why they come first |
| **1. Foundation** | Google provider, scope bundles, the refresh-token contract fix, the `ProviderAsset` table, error codes, a dev-project end-to-end connect | The owner connects and reconnects, and a refresh works after 1 hour (verified live) |
| **2. GBP and YouTube posting** | `google_business_profile` platform and adapter; YouTube upload adapter; reviews read, reply draft, reply with approval; GBP insights and YouTube analytics | A real GBP post on 1920 Agency's profile. A real YouTube upload (private until audit, reported honestly) |
| **3. Search Console and GA4 reads** | Performance, URL inspection, sitemaps, GA4 reports | Real numbers from the owner's sites. Works for SimpleOnlineCounter, which SEO-Ops already uses |
| **4. Tracking setup** | Section 3 end to end; the WordPress plugin; `verify_tracking` | One owner site fully tracked, events seen in GA4 realtime, GSC verified via GTM |
| **5. Google Ads and Keyword Planner** | Ads adapter, guardrails, paused creation, activation, Keyword Planner, conversion actions; the playbook already exists | **Basic access granted.** Owner's own campaigns only |
| **6. Customers** | Production OAuth verification with the demo video; customer-facing GBP and YouTube; tracking for customers. **Google Ads for customers only after Google answers the proxy question** | Written confirmation from Google, or decide on option B or C in research 3.6 |
| **7. Meta through GTM** | Meta pixel in the same container; CAPI | Phase 4 working |

---

## 5. OWNER CHECKLIST: what only you can do, in order

Each step takes a few minutes unless marked. Nothing here goes into the workspace.
Secrets go only in `%USERPROFILE%\.social-publisher\.env`.

### Set up the Cloud projects

1. **Create two Google Cloud projects:** `adspilot-dev` and `adspilot-prod`.
   - **Attach a full (paid) billing account, not the Free Trial.** Google lists
     Free Trial projects as possibly rejected for Ads API access. No charges are
     expected from these APIs.
   - Use the 1920 Agency Google account that will own the product long term.
   - https://console.cloud.google.com/projectcreate
   - Note each project's **Project Number** from the dashboard.
2. **Configure Google Auth Platform → Branding** in each project:
   - app name AdsPilot
   - logo
   - support email
   - homepage
   - privacy policy URL
   - terms URL
   - authorised domain
   - https://console.cloud.google.com/auth/branding
3. **Verify the domain in Search Console**, as a Domain property via DNS. Brand
   verification requires it. https://search.google.com/search-console
4. **Audience: External.**
   - Add yourself as a test user.
   - Then press **Publish app** (to "In production") for the **prod** project.
     That stops your own refresh tokens dying every 7 days, and Google Ads brand
     verification requires it.
   - An unverified app shows a warning but works for up to 100 users.
   - https://console.cloud.google.com/auth/audience
5. **Data Access:** add the scopes from section 1.1. Note which ones the Console
   marks sensitive, and **tell me**, so the research note can move from
   UNVERIFIED to verified. https://console.cloud.google.com/auth/scopes
6. **Create the OAuth client** (Web application):
   - Redirect URI: `http://localhost:<port>/callback/google` for dev, then the
     production URL.
   - Put the ID and secret in the `.env` file only.
   - https://console.cloud.google.com/auth/clients
7. **Enable these APIs** in each project
   (https://console.cloud.google.com/apis/library):
   - YouTube Data API v3
   - YouTube Analytics API
   - Google Search Console API
   - Google Analytics Admin API
   - Google Analytics Data API
   - Tag Manager API
   - Site Verification API
   - Google Ads API
   - The GBP APIs appear only after step 9.
8. **Submit brand verification** in Google Auth Platform → Verification Center.
   - **2–3 business days.**
   - It is required before Google Ads Basic.
   - https://console.cloud.google.com/auth/verification

### Long-lead applications: submit as soon as step 8 is in

9. **GBP API access**, the long one (**about 14 days**):
   - Use the GBP API contact form and choose "Application for Basic API Access".
   - Send it from an email that is owner or manager of 1920 Agency's profile.
   - Include the prod Project Number.
   - The profile must have been verified for 60+ days, and the website must be
     live.
   - https://support.google.com/business/contact/api_default
   - Check it: the quota changes from 0 to 300 QPM.
10. **Google Ads API, Explorer then Basic.**
    - Open the Google Ads API Overview page in the prod project and click
      "Apply for access" for Explorer.
    - Once brand verification shows no warning, apply for Basic.
    - No manager account is needed. Developer tokens no longer exist.
    - https://console.cloud.google.com/google/ads-apis/overview
11. **Ask Google about the proxy policy, in writing.**
    - Describe AdsPilot plainly: an MCP server; each advertiser signs in with
      their own Google account; nothing is spent without a human approval; spend
      ceilings.
    - Ask whether it is permitted under the 31 August 2026 Developer Policies, and
      whether Standard access is the right route.
    - I can draft this text.
    - https://support.google.com/adspolicy/answer/6169371 (policy) and Google Ads
      API support through the Overview page.
12. **YouTube API audit.**
    - Submit the YouTube API Services Audit and Quota Extension Form for the prod
      project.
    - Uploads stay **private** until it passes.
    - There is no published timeline; plan for weeks.
    - It likely needs a working demo, so it may be better submitted after Phase 2
      (UNVERIFIED).
    - https://support.google.com/youtube/contact/yt_api_form

### Later

13. **Sensitive-scope verification for customers**, at Phase 6:
    - Record an English demo video showing the consent screen and each feature.
    - Write a justification per scope.
    - **3–10 business days.**
    - https://console.cloud.google.com/auth/verification
14. **Once only, in the Google Ads UI,** for your own account. Both are verified
    as UI-only in Google's docs:
    - set up card billing
    - accept the enhanced conversions customer data terms
15. **Choose a cookie banner (CMP)** for any site with UK or EU visitors. This is
    a business decision; I will install whichever you pick through GTM.

---

## 6. Rejected, so these are not re-proposed (R5)

- **Indexing API as a general "index my page" button.** It is officially only for
  JobPosting and BroadcastEvent pages, and abuse risks revocation.
- **Asking for every Google scope on first connect.** See 1.1.
- **Opening Google Ads to customers before Google answers the proxy question.**
  It would put the whole Cloud project, including GBP and YouTube, at risk of
  enforcement. That last part is **UNVERIFIED**, an inference about how Google
  enforces.
- **Automatic review replies with no explicit opt-in.** GBP policy forbids it.
- **Reporting a YouTube upload as "published"** while the project is unaudited.
- **Applying for a developer token in the manager account API Center.** Google
  says those applications "won't be processed".

## 7. Open questions, marked UNVERIFIED in research

- The sensitivity class of each scope. Answered by owner checklist step 5.
- Whether `adwords` is sensitive or restricted (Google's pages conflict), and
  therefore whether CASA is needed.
- Whether a hosted MCP with per-customer OAuth counts as a "programmatic proxy".
- The GTM tag type identifiers. Read them back from a real container in Phase 4.
- Wix GTM plan requirements, and Shopify theme-edit exemption rules.
- Whether accounts with low spend get volume ranges rather than exact numbers from
  Keyword Planner.
- How long the YouTube audit takes, and whether it needs a working demo first.
