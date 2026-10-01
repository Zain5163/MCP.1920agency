# Google suite: what each API can do, what it needs, and how long access takes

**Date:** 2026-10-01
**Why:** the owner wants Google Business Profile, YouTube, Google Ads with Keyword
Planner, Search Console, GA4, and "one click" website tracking. These come for
1920 Agency first, then for customers. This note records the facts. The plan is
in `architecture/google-suite-plan.md`.
**Method:** official Google documentation, fetched 2026-10-01. Trade press
(ppc.land and similar) is used only where Google's own page was not reachable,
and is labelled **reported**. Anything not confirmed is labelled **UNVERIFIED**,
following `research/README.md` and RULES R7.

---

## ⚠️ Read this first: three things that changed recently

The brief for this research assumed some things that are no longer true. Each
correction below comes from Google's own pages.

1. **Google Ads developer tokens were sunset on 9 September 2026.** API access
   levels now belong to the **Google Cloud project**. You apply on the Google Ads
   API Overview page in Cloud Console, and you no longer need a manager account
   (MCC) to get access. A token sent in the header is "optional and ignored by the
   API servers". Basic access requires **brand verification** of the Cloud
   project, and is then often approved automatically "within minutes".
   [developer-token](https://developers.google.com/google-ads/api/docs/api-policy/developer-token),
   [access-levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)
2. **Google Ads Developer Policies now name MCP servers.** The update was
   published 31 August 2026. A "programmatic proxy" is *"a third-party hosted
   interface, secondary API, wrapper service, Model Context Protocol (MCP) server,
   proxy endpoint, or any similar service that **solely** replicates, wraps, or
   re-exposes Google Ads programmatic capabilities as an intermediate layer"*.
   Proxies are prohibited. **This is the single biggest risk to "Google Ads for
   customers"**; see section 3.6.
   [definition](https://support.google.com/google-ads/answer/18103182),
   [Developer Policies](https://support.google.com/adspolicy/answer/6169371)
3. **YouTube upload quota is no longer the bottleneck.** On 2025-12-04 an upload
   dropped from about 1,600 units to about 100. Since 2026-06-01, `videos.insert`
   has its **own bucket of 100 uploads a day**, at 1 unit each. The ROADMAP line
   "about six uploads a day in total" is out of date.
   [revision history](https://developers.google.com/youtube/v3/revision_history),
   [quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost)

---

## 1. One Google OAuth app for everything

### Can one consent cover every product?

**Yes, technically.** One OAuth client can request scopes from many APIs. All of
them are declared on the consent screen's Data Access page and verified together.
[sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

**Google advises against asking for everything at once.** It says: *"It is
generally a best practice to request scopes incrementally, at the time access is
required, rather than up front."*
[oauth2](https://developers.google.com/identity/protocols/oauth2) The same
advice is in [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies).

How incremental authorisation and granular consent work:
[web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server),
[granular permissions](https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions)

- Send `include_granted_scopes=true`. The new token then also covers every scope
  the user granted before. This lets us grow one Google connection one product at
  a time.
- **Granular consent:** when two or more scopes are requested, the user can untick
  any of them. *"Your app must verify which scopes were actually granted."* Read
  the `scope` field in the token response.
- Send `access_type=offline` to get a refresh token. It is returned only on the
  first authorisation. `prompt=consent` forces a new one.

**The risk of asking for every scope at once:**

1. The consent screen becomes a long list that includes spending money, managing
   YouTube and editing the website's tags. Many people will refuse.
2. Granular consent means a partial grant is normal anyway. The code has to cope
   with it either way.
3. Verification judges each scope against a feature the reviewer can see in the
   demo video. Requesting a scope we cannot yet demonstrate slows the review or
   gets it rejected.
4. Adding scopes after verification "may" need re-verification.
   [7454865](https://support.google.com/cloud/answer/7454865)

So the right shape is **one connection that grows**: request each product's
scopes the first time that product is used.

### Scope classes, and which of ours fall where

The classes are non-sensitive, sensitive and restricted.
[15549135](https://support.google.com/cloud/answer/15549135)

The **restricted** list covers Gmail, Drive, Fit, Chat, Data Portability,
Photos Ambient and Health.
[13464325](https://support.google.com/cloud/answer/13464325) None of ours is on
it:

- `business.manage`
- `adwords`
- `webmasters`
- `analytics*`
- `tagmanager.*`
- `siteverification`
- `youtube*`
- `yt-analytics*`

On that list, **no CASA security assessment** is needed.

**⚠️ The sources conflict on `adwords`.** The Google Ads page says the adwords
scope *"is classified as a restricted scope, which means that you should complete
the OAuth app verification process before productionizing your application."*
[secure-credentials](https://developers.google.com/google-ads/api/docs/productionize/secure-credentials)

- Restricted would normally mean a CASA assessment, about 6 weeks.
- But `adwords` is absent from Google's restricted-scope list.
- **UNVERIFIED which applies.** The Cloud Console's Data Access page will show it
  (owner checklist step 5).
- **Budget for CASA on the `ads` bundle until the Console says otherwise.**

Whether each of the other scopes counts as *sensitive* is not listed on any public
page. The Cloud Console shows it when the scope is added. **UNVERIFIED per scope.
Assume all of them are sensitive** except `openid`, `email` and `profile`. The
`adwords` scope has needed OAuth verification since 2021.
[ads blog](https://ads-developers.googleblog.com/2021/10/ads-api-apps-must-complete-oauth.html)
Google itself uses "deleting YouTube videos" as its example of a sensitive scope.

### Verification

[requirements](https://support.google.com/cloud/answer/13464321),
[timelines](https://support.google.com/cloud/answer/13463817)

- **Brand verification**, needed by every app:
  - a homepage on a verified domain
  - a privacy policy on the same domain, linked from the homepage and the consent
    screen
  - every authorised domain verified in Search Console
  - Google's branding guidelines followed
  - contact details
  - About **2–3 business days**.
- **Sensitive scopes** need all of the above, plus:
  - an English **demo video** showing the full flow and the consent screen with
    the exact scopes
  - a justification for each scope
  - compliance with Limited Use
  - Google's two pages disagree on timing: "10 business days" and "typically
    3–5 business days". **Plan for about 2 weeks.**
- **Restricted scopes** take about 6 weeks, including CASA. Not relevant to us.

### Testing mode and the 7-day expiry

[15549945](https://support.google.com/cloud/answer/15549945),
[oauth2](https://developers.google.com/identity/protocols/oauth2)

- An External app in **Testing** status is limited to about **100 test users**.
  That cap counts over the project's lifetime.
- *"A Google Cloud Platform project with an OAuth consent screen configured for an
  external user type and a publishing status of 'Testing' is issued a refresh
  token expiring in 7 days"*. The only exception is an app that requests nothing
  beyond name, email and profile.
  - **Consequence:** while the app is in Testing, the owner's own Google
    connection dies every week.
  - **Fix:** set the app to **In production** for the owner's own use, even
    before verification.
  - An unverified app in production shows an "unverified app" warning and is
    capped at **100 new users**. Its refresh tokens do *not* die after 7 days.
    [7454865](https://support.google.com/cloud/answer/7454865)
  - **Inference, not stated by Google:** a production but unverified app is the
    right state for the owner's own use while verification is pending.
- **Internal** user type is only for members of the project's own Workspace
  organisation.
- Other limits on refresh tokens:
  - **100 refresh tokens per Google Account per client ID.** Creating another
    silently invalidates the oldest.
  - A token also dies after **6 months unused**, or when the user revokes access.
- Cross-Account Protection (RISC) is optional. It notifies us when a user revokes
  access or their account is compromised.
  [risc](https://developers.google.com/identity/protocols/risc)
- Policy says to use **separate Cloud projects for dev and prod**, and a separate
  OAuth client per platform.
  [policies](https://developers.google.com/identity/protocols/oauth2/policies)

---

## 2. Google Business Profile (GBP)

**Access request:** [prereqs](https://developers.google.com/my-business/content/prereqs),
[FAQ](https://developers.google.com/my-business/content/faq)

- What you need before applying:
  - a GBP that is **verified and active for 60+ days**
  - a **website** that represents that business
  - the Cloud project's **Project Number**
- Apply through the [GBP API contact form](https://support.google.com/business/contact/api_default)
  and choose "Application for Basic API Access". Send it **from an email that is
  an owner or manager on the profile**.
- What approval looks like: quota is **0 QPM until approved** and **300 QPM once
  approved**.
- FAQ: *"Requests are reviewed within 14 days."*
- The GBP APIs only appear in the API Library **after** approval.
- There is no sandbox. Test with `validateOnly`.
- **This is a long-lead item and should be submitted first.**

**Scope:** `https://www.googleapis.com/auth/business.manage`. It is the only
scope GBP has. Sensitivity is UNVERIFIED; assume sensitive.

**What we can do with it:**

| Need | API | Notes |
|---|---|---|
| Posts | v4 `accounts/{a}/locations/{l}/localPosts` (create, patch, delete, list) | Topic types STANDARD, EVENT, OFFER, ALERT (ALERT only for COVID_19). CTA types BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP, CALL. Media is given by `sourceUrl`, i.e. a public URL like Instagram. **Product posts cannot be created by API.** [posts](https://developers.google.com/my-business/content/posts-data), [ref](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts) |
| Reviews | v4 `reviews.list`, `get`, `batchGetReviews`, `PUT …/reply`, `DELETE …/reply` | [review-data](https://developers.google.com/my-business/content/review-data) |
| Insights | Business Profile **Performance API** v1: `fetchMultiDailyMetricsTimeSeries`, `getDailyMetricsTimeSeries`, `searchkeywords.impressions.monthly.list` (the searches people used to find the business) | The old v4 `reportInsights` has been discontinued. [performance](https://developers.google.com/my-business/reference/performance/rest), [sunset](https://developers.google.com/my-business/content/sunset-dates) |
| Q&A | **Gone.** Discontinued 2025-11-03 | Do not build |
| Listing info | Business Information API, Account Management API | Accounts and locations, i.e. the "discover" step |

**Limits** ([limits](https://developers.google.com/my-business/content/limits)):

- 300 QPM per API.
- **10 edits per minute per profile, which cannot be increased.**
- Create Location: 300 per day.

**Policy points that bear on automation**
([policies](https://developers.google.com/my-business/content/policies)):

- **Review replies must not be automated without explicit user consent.** Our
  approval token satisfies this. An auto-reply mode would need a separate,
  explicit opt-in.
- Changes to a client's listing must be reported to them within 48 hours. Our
  audit log plus a notification covers this.
- Cached content may be kept for at most 30 days. This affects how long we store
  review text.
- Agencies and clients may not use our project to avoid applying for their own.
  This is the same idea as the Ads proxy rule. **UNVERIFIED** how strictly it is
  applied to SaaS tools whose users authorise with their own login.

**Countries:** no UK, EU or Pakistan restriction is stated on any page checked.
UNVERIFIED either way.

---

## 3. Google Ads

### 3.1 Access, after the 9 September 2026 change

[access-levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels),
[developer-token](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)

| Level | Daily operations | Accounts | How |
|---|---|---|---|
| Test | 15,000 | Test accounts only | Enable the API in the Cloud project |
| **Explorer** | **2,880** on production, 15,000 on test | Test and production | Click "Apply for access" on the [Google Ads API Overview page](https://console.cloud.google.com/google/ads-apis/overview). It "may" be upgraded automatically |
| **Basic** | 15,000 | Test and production | Same page. **Brand verification is a prerequisite.** "May" be upgraded automatically; reported as minutes to hours |
| Standard | Unlimited | Test and production | A manual application, about **10 business days** |

- **Explorer cannot use:**
  - account creation (`CreateCustomerClient`)
  - user management
  - **Planning, including `KeywordPlanIdeaService`**
  - billing and payments
- So **Keyword Planner needs Basic or above.** That is official.
- No manager account is needed to get access. A manager account is needed only
  to link and manage several accounts.
- **Prerequisites for Ads brand verification**
  ([brand-verification](https://developers.google.com/google-ads/api/docs/api-policy/brand-verification)):
  - OAuth consent screen user type **External**
  - publishing status **In production**
  - all branding fields filled in
- Applying needs Owner, Editor, Quota Admin or Service Usage Admin on the project.
  A Cloud project on the **Free Trial may be rejected**, which Google lists as a
  known issue.
- **Standard** is a manual audit. It asks what the tool does and who uses it, and
  asks for **demo sign-in access** if external users use it.
- **RMF applies only at Standard.** Changes must be submitted to Google **2 weeks
  before release**, and non-compliance fees are possible.
  [rmf](https://developers.google.com/google-ads/api/docs/api-policy/rmf)
- **Reported, not confirmed on Google's own page** (ppc.land):
  - pending Basic applications were closed on 10 September and must be
    resubmitted
  - v25 returns `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` when a Test-level
    project calls a production account
- **The ROADMAP figure of "2–4 weeks for Basic" is out of date.** Basic now
  depends on brand verification, which takes 2–3 business days, and Google then
  reviews quickly.

**Scope:** `https://www.googleapis.com/auth/adwords`. Not restricted. Assume
sensitive.

**Which account a call acts on:**

- A customer who authorises with their own Google login can call their **own**
  account directly by its customer ID.
- `login-customer-id` is needed only when acting **through** a manager account.
- Linking customers to our manager account is **not** required. It is an option
  for agency-managed clients.
- **UNVERIFIED** against a v25 page today. It is long-standing behaviour.

### 3.2 Campaigns end to end

The pattern matches the Meta side:

1. Create a `CampaignBudget` in micros.
2. Create the `Campaign` with `status = PAUSED`.
3. Create ad groups and responsive search ads, or Performance Max asset groups.
4. Support `validate_only` on mutates, which is a dry run.
5. Activate later by changing the status to ENABLED.

These are standard Google Ads API features. They were not re-fetched page by page
today, so they are **verified in general but not per field for v25**.

Confirmed on Google's pages since the first draft:

- PAUSED is Google's own recommendation until targeting and ads are ready.
- Every campaign must now declare `contains_eu_political_advertising`.
- `partial_failure` exists.
- RSAs take 3–15 headlines and 2–4 descriptions.
- PMax non-retail asset groups must be created in **one bulk mutate**, with their
  minimum assets and temporary IDs.

Sources: [create-campaigns](https://developers.google.com/google-ads/api/docs/campaigns/create-campaigns),
[RSA](https://developers.google.com/google-ads/api/docs/responsive-search-ads/overview),
[PMax](https://developers.google.com/google-ads/api/docs/performance-max/asset-groups).
Character limits are UNVERIFIED.

**Billing:**
[billing](https://developers.google.com/google-ads/api/docs/billing/overview)

- The API can manage billing setups **only for monthly-invoicing accounts**.
- **Card billing is set up in the Google Ads UI** by the advertiser.
- Billing services are blocked at Explorer.
- As with Meta (decision 0005, 5b.5), payment is the user's step.

**Account creation through the API:**
[create-account](https://developers.google.com/google-ads/api/docs/account-management/create-account)

- `CreateCustomerClient` works only under a manager account.
- It needs Basic or above.
- It is limited to *"advertisers who have had more than $1,000 USD in spend, and
  are in good standing"*.
- **So a new customer with no Ads account creates it in the UI.**

### 3.3 Keyword Planner

[generate-keyword-ideas](https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas)

- `KeywordPlanIdeaService.GenerateKeywordIdeas` takes exactly one seed:
  `keyword_seed`, `url_seed`, `keyword_and_url_seed` or `site_seed`. It also takes
  `geo_target_constants`, `language` and `keyword_plan_network`.
- It returns:
  - average monthly searches
  - competition (LOW, MEDIUM, HIGH)
  - low and high top-of-page bids in micros
  - monthly volumes
- No KeywordPlan object is needed.
- `GenerateKeywordHistoricalMetrics` returns metrics for keywords you already
  have.
- **Needs Basic access.** It is restricted at Explorer (see 3.1).
- Rate limit: **1 QPS per customer** for the planning methods.
  [quotas](https://developers.google.com/google-ads/api/docs/best-practices/quotas)
  A site seed can return up to 250,000 ideas. Historical metrics cover the last 12
  months and are updated monthly.
- Language IDs: English `1000`, Urdu `1041`.
  [languagecodes.csv](https://developers.google.com/static/google-ads/api/data/tables/languagecodes.csv)
- Test accounts serve no ads and have empty metrics.
- **UNVERIFIED:** that accounts with no or low spend see volume *ranges* rather
  than exact numbers. This is widely reported for the UI and assumed to apply to
  the API too.
- **UNVERIFIED** geo constants: UK `2826`, Pakistan `2586`. They are standard IDs
  but were not re-fetched; look them up with `GeoTargetConstantService` rather
  than hardcoding.

### 3.4 Conversion actions and enhanced conversions

[conversions overview](https://developers.google.com/google-ads/api/docs/conversions/overview)

- `ConversionActionService` creates conversion actions such as `WEBPAGE` and
  `UPLOAD_CLICKS`. The `tag_snippets` field returns the tag details, i.e. the
  conversion ID and label that a GTM `awct` tag needs.
- **Imported GA4 key events**, type `GOOGLE_ANALYTICS_4_CUSTOM`:
  [categories](https://developers.google.com/google-ads/api/docs/conversions/categories)
  - Once GA4 is linked to Ads, they appear with status **HIDDEN**.
  - **Importing one means setting its status to ENABLED through the API**, which
    can be automated.
  - The API can also change primary-for-goal, category, name and value.
  - Other edits return `MUTATE_NOT_ALLOWED`.
  - Creating them from scratch through the API is UNVERIFIED.
- `ConversionTrackingSetting.accepted_customer_data_terms` and
  `enhanced_conversions_for_leads_enabled` are **output-only**.
  [ConversionTrackingSetting](https://developers.google.com/google-ads/api/reference/rpc/v25/ConversionTrackingSetting)
  - **Accepting the customer data terms for enhanced conversions is done in the
    Ads UI.** That is confirmed, and is one manual click.
- **Deprecation:** *"Starting June 15, 2026, UploadClickConversion requests will
  fail if the developer token hasn't previously sent requests to upload offline
  conversions…"*
  [upload-offline](https://developers.google.com/google-ads/api/docs/conversions/upload-offline)
  - **A new integration must upload offline conversions and enhanced conversions
    for leads through the Data Manager API.** Its scope is `datamanager`.
    [Data Manager](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/upgrade)
  - Enhanced conversions for web adjustments still go through
    `ConversionAdjustmentUploadService`.

### 3.5 Consent Mode v2 (EEA and UK)

[consent guide](https://developers.google.com/tag-platform/security/guides/consent),
[ads help](https://support.google.com/google-ads/answer/10000067)

- There are four signals:
  - `ad_storage`
  - `analytics_storage`
  - `ad_user_data` (added November 2023)
  - `ad_personalization` (added November 2023)
- Sites with EEA visitors must send all four.
- Defaults are set before any tag fires, and can be set per region with ISO 3166-2
  codes. A site can therefore default to `denied` for the EEA and UK and to
  `granted` for Pakistan.
- Basic mode blocks tags until consent. Advanced mode sends cookieless pings while
  consent is denied.
- **Reported, widely documented:** since March 2024, missing EEA signals cost
  remarketing and audience features and conversion modelling. The exact
  enforcement wording was not on the pages fetched, so it is **UNVERIFIED** here.
- **A certified CMP integrated with TCF** is required from 16 January 2024 (EEA
  and UK), but **for publishers** using AdSense, Ad Manager or AdMob.
  [13554116](https://support.google.com/adsense/answer/13554116)
  - **For advertisers a certified CMP is recommended, not required.** An
    advertiser may "maintain your own banner".
    [13695607](https://support.google.com/google-ads/answer/13695607)
  - The **EU User Consent Policy covers the EEA, UK and Switzerland.** It requires
    valid consent, consent records, a way to revoke, and naming the parties
    involved. [user-consent-policy](https://www.google.com/about/company/user-consent-policy/)
  - **Google audits advertisers' banners**
    ([16724512](https://support.google.com/google-ads/answer/16724512)). It checks
    for:
    - a visible banner with an affirmative action
    - "ads personalization" named on the first layer
    - a link to business.safety.google/privacy
    - no Google ad cookies before consent
  - Penalties include suspended remarketing and personalisation, and restricted
    conversion measurement.
  - **Choosing and wording the banner is a legal and UX decision for the
    business.** We can install it, but we should not choose it silently.
  - Since March 2024, linked audiences include only non-EEA users unless consent
    is handled.
    [14275483](https://support.google.com/analytics/answer/14275483) (from a search
    summary)

### 3.6 ⚠️ The proxy policy and AdsPilot

[Developer Policies](https://support.google.com/adspolicy/answer/6169371),
[definition](https://support.google.com/google-ads/answer/18103182),
[ppc.land (reported)](https://ppc.land/google-bans-programmatic-proxies-from-ads-api-access/)

What the policy says, quoted from the official page:

- Agencies and end-advertisers must *"use their own Google Cloud Platform account
  and Google Ads access in order to ensure Google Ads API access is associated
  with the individual end-advertiser or agency."*
- *"Granting end-users headless programmatic access to make account modifications
  to Google Ads accounts **without Google review of the developer's proposed use
  case, or without direct, per-entity Google authentication** is prohibited."*
- Exempt:
  - *"your own use of the Google Ads API"*
  - *"open-source tools where the end-users download the software and connect it
    to Google Ads using their own access credentials."*
- Required Minimum Functionality (RMF):
  - full-service tools must meet RMF across creation, management and reporting
  - reporting-only tools must meet it for reporting
  - internal-use tools have no RMF requirement

What it means for us:

- **1920 Agency's own use is clearly fine**, since it is the developer's own use.
- **A hosted AdsPilot that customers connect to is the exact shape the policy
  names.** Two features argue that it is *not* "solely" a proxy:
  - each customer signs in with their own Google login, which is per-entity
    authentication
  - AdsPilot adds approval, spend ceilings, playbooks and reporting
- Whether that is enough is **Google's judgement, and UNVERIFIED.** The policy is
  one month old, and Google says it is "actively reviewing existing integrations"
  (reported).
- **This must be settled in writing with Google before Google Ads opens to
  customers.** The owner can ask through the Standard access application, which
  is a review of the "proposed use case", or through Google Ads API support.
- The fallback options are below. Each costs some of the "one click".

| Option | What it means | Cost |
|---|---|---|
| A. Reviewed use case, our project, per-customer OAuth | Apply for Standard access, describing AdsPilot exactly. Meet RMF | Needs Google to say yes |
| B. Bring your own Cloud project | Each customer creates their own GCP project and OAuth client, and AdsPilot uses it (`credential_source = tenant_byo`, a column that already exists) | Real technical work for the customer, against the owner's "no technical work" goal |
| C. Open-source local distribution | Customers run the MCP server themselves with their own credentials | Exempt, but it is a different product |

---

## 4. YouTube

[getting started](https://developers.google.com/youtube/v3/getting-started),
[videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert),
[audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)

**Quota:**

- The default per project is **100 `videos.insert` calls**, **100 `search.list`
  calls**, and **10,000 units** for everything else, each day.
- Costs per call:

| Call | Units |
|---|---|
| `thumbnails.set` | 50 |
| `videos.update` | 50 |
| `playlistItems.insert` | 50 |
| `captions.insert` | 400 |
| `videos.list` | 1 |

- **The quota is per project and shared by every customer.** 100 uploads a day is
  enough for early customers, but it is a ceiling.
- **The private-until-audit rule:** *"All videos uploaded via the videos.insert
  endpoint from unverified API projects created after 28 July 2020 will be
  restricted to private viewing mode."*
  - Until the audit passes, AdsPilot can upload but **cannot publish publicly**,
    even to the owner's own channel.
  - Like Pinterest's trial and TikTok's audit, the result is real but invisible.
- **Audit and quota extension** go through one form:
  [yt_api_form](https://support.google.com/youtube/contact/yt_api_form). There is
  no published timeline ("as soon as possible"). **UNVERIFIED** duration; plan for
  weeks.

**Scopes:**

| Scope | Allows |
|---|---|
| `youtube.upload` | Upload |
| `youtube` | Manage: update metadata, set thumbnails, manage playlists |
| `youtube.readonly` | Read |
| `youtube.force-ssl` | Comments |
| `yt-analytics.readonly` | Analytics |
| `yt-analytics-monetary.readonly` | Revenue |

- Assume all are sensitive. None is restricted.

**Shorts:**

- A Short is a normal upload that is **up to 3 minutes** long and square or
  vertical. [12779649](https://support.google.com/youtube/answer/12779649)
- There is no Shorts-specific API flag.
- **UNVERIFIED** that the classification applies identically to API uploads.

**Analytics:** the YouTube Analytics API (`reports.query`) gives channel and video
metrics. [analytics ref](https://developers.google.com/youtube/analytics/reference)

---

## 5. Search Console and the Indexing API

**Search Console API:** [limits](https://developers.google.com/webmaster-tools/limits)

- What it offers:
  - `searchanalytics.query` for performance data
  - `sitemaps.submit` and `sitemaps.list`
  - `sites.add` and `sites.list`
  - `urlInspection.index.inspect`
- Scopes: `webmasters` (read and write) and `webmasters.readonly`.
- Quotas:

| Method | Limit |
|---|---|
| Search Analytics | 1,200 QPM per site and per user; 30,000,000 per day and 40,000 QPM per project |
| URL Inspection | **2,000 per day and 600 QPM per site** |
| Everything else | 20 QPS and 200 QPM per user |

- **URL Inspection only reports status. It cannot request indexing.** It shows
  the status of the version in Google's index, and *"you cannot test the
  indexability of a live URL."*
  [inspect](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect)
  The "Request indexing" button exists only in the Search Console UI.
- **Data delay:** *"typically available after 2-3 days."*
  - Up to 25,000 rows per request; paginate with `startRow`.
  - At most 50,000 rows per day per search type.
  - The API returns the top rows rather than guaranteeing every row.
  - `dataState: all` includes fresh data, and `hourly_all` gives hourly data
    (added April 2025).
  - Sources: [all-your-data](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data),
    [query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
- **16 months of history through the API is UNVERIFIED.**
- Whether `sites.add` adds an unverified entry, with verification done separately
  through the Site Verification API, is also UNVERIFIED.

**Indexing API:**
[quickstart](https://developers.google.com/search/apis/indexing-api/v3/quickstart)

- It is officially **only** for *"pages with either `JobPosting` or
  `BroadcastEvent` embedded in a `VideoObject`"*.
- Default quotas:
  [quota-pricing](https://developers.google.com/search/apis/indexing-api/v3/quota-pricing)
  - **200 publish requests per day**, "for onboarding and submission testing"
  - 180 getMetadata requests per minute
  - 380 requests per minute across all endpoints
- More quota needs an approval form, and quota *"may increase or decrease based
  on the document quality"*.
- It uses a **service account** that is added as an owner in Search Console.
  Scope: `indexing`.
- *"Any attempts to abuse the Indexing API… may result in access being
  revoked"*, and submissions get spam detection.
- **Do not offer it as a general "index my page" button.** For ordinary pages, the
  honest tools are sitemap submission, URL Inspection status, and a link to
  Request Indexing in the UI.

---

## 6. Google Analytics 4

**Admin API**
([v1 REST](https://developers.google.com/analytics/devguides/config/admin/v1/rest)).
In **v1beta**:

- `accounts.provisionAccountTicket`
- `properties.create`
- `dataStreams.create` (a web stream returns the **Measurement ID**)
- `keyEvents.create`
- `googleAdsLinks.create`
- `customDimensions`
- `measurementProtocolSecrets`
- `dataRetentionSettings`

In **v1alpha only**:

- enhanced measurement settings
- data redaction
- `getGlobalSiteTag`
- event create and edit rules
- audiences
- channel groups

**Creating a GA4 account** cannot be done fully by API.
[provisionAccountTicket](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accounts/provisionAccountTicket)

- `provisionAccountTicket` (scope `analytics.edit`) returns a ticket.
- **The user must accept Google Analytics' Terms of Service in their browser.**
- That is one unavoidable click, and only for users with no GA4 account.

Scopes: `analytics.readonly`, `analytics.edit`, `analytics.manage.users`.

More Admin API details:
[quotas](https://developers.google.com/analytics/devguides/config/admin/v1/quotas),
[keyEvents](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.keyEvents)

- Quotas: 1,200 requests a minute (600 per user) and 600 writes a minute (180 per
  user).
- `keyEvents` take `countingMethod` `ONCE_PER_EVENT` or `ONCE_PER_SESSION`.
- `googleAdsLinks.adsPersonalizationEnabled` defaults to true.
- Data retention for standard properties is 2 or 14 months.
- v1alpha may break; v1beta is not expected to.
- There is no Admin API resource for GA4 consent settings (UNVERIFIED).

**Data API:**
[quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas)

- Offers `runReport` and `runRealtimeReport`. Scope: `analytics.readonly`.
- Quotas for a standard property:

| Quota | Limit |
|---|---|
| Core tokens per property per day | **200,000** |
| Core tokens per property per hour | 40,000 |
| Core tokens per project per property per hour | **14,000** |
| Concurrent requests per property | 10 |

---

## 7. Tag Manager API v2

[REST reference](https://developers.google.com/tag-platform/tag-manager/api/reference/rest),
[quotas](https://developers.google.com/tag-platform/tag-manager/api/v2/limits-quotas)

**What exists:**

- `accounts`: get, list and update. **There is no `accounts.create`.**
- `containers`: create, plus `snippet`, `lookup` and others.
- `workspaces`: create, plus `create_version`, `quick_preview` and `getStatus`.
- `tags`, `triggers`, `variables`, `built_in_variables`, `templates` (including
  `import_from_gallery`) and `gtag_config`.
- `versions`: **`publish`**, plus `live` and others.

**Consequences:**

- A user with **no GTM account must create one in the GTM UI.** That is one
  unavoidable step.
- The alternative is to create their container inside **our** GTM account and
  grant them access (`tagmanager.manage.users`). That trades their ownership for
  convenience.
- Tag type identifiers used by the API:

| Identifier | Tag |
|---|---|
| `googtag` | Google tag |
| `gaawe` | GA4 event |
| `awct` | Ads conversion |
| `gclidw` | Conversion linker |
| `sp` | Ads remarketing |

  These are **UNVERIFIED** today; read them back from an existing container
  before relying on them.

**Other details:**

- `workspaces.create_version` *"Creates a Container Version from the entities
  present in the workspace, deletes the workspace."*
- `containers.snippet` returns the install snippet.
- In GTM, the GA4 Google tag fires on **Initialization – All Pages**.
- Consent defaults go on **Consent Initialization – All Pages**, which fires
  before everything else.
- The Community Template Gallery has CMP templates: Cookiebot, OneTrust,
  Usercentrics and 25+ others.
- A Google tag's "destinations" can be a GA4 stream, a Google Ads account,
  Floodlight or Merchant Center.

Sources: [create_version](https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces/create_version),
[consent in GTM](https://support.google.com/tagmanager/answer/10718549),
[destinations](https://support.google.com/tagmanager/answer/12324388),
[GA4 in GTM](https://support.google.com/tagmanager/answer/9442095)

**Scopes:** [authorization](https://developers.google.com/tag-platform/tag-manager/api/v2/authorization)
`tagmanager.readonly`, `tagmanager.edit.containers`,
`tagmanager.delete.containers`, `tagmanager.edit.containerversions`,
`tagmanager.publish`, `tagmanager.manage.users` and `tagmanager.manage.accounts`.

**Quota:** **10,000 requests a day and 0.25 QPS per project.**

- That is one request every 4 seconds, shared by every customer.
- A full tracking setup is roughly 30–60 calls, so it takes **2–4 minutes** and
  must run as a queued job, never inline in a tool call.
- A higher quota can be requested.

---

## 8. Site Verification API

[getting started](https://developers.google.com/site-verification/v1/getting_started),
[Search Console help](https://support.google.com/webmasters/answer/9008080)

- Methods: FILE, META, DNS_TXT, DNS_CNAME, **ANALYTICS** and **TAG_MANAGER**.
- The flow is `getToken`, then place the token, then `insert`.
- Scopes: `siteverification` and `siteverification.verify_only`.
- **TAG_MANAGER:**
  - the container must belong to the user's GTM account
  - the user needs **Publish or Admin** permission on the container
  - the `<noscript>` part must sit right after `<body>`
- **ANALYTICS:**
  - the tracking code must be in `<head>`
  - the user needs **edit** rights on the GA property
- **Domain properties** (`sc-domain:`) need **DNS**. Tag-based methods only verify
  URL-prefix properties.
- **Consequence:** once our GTM container is live on the site, the Search Console
  URL-prefix property can be verified automatically. A Domain property still needs
  a DNS record, which we can only add when we control the DNS.

---

## 9. Getting the GTM snippet onto the site: the honest limit of "one click"

Every API above configures Google's side. **None of them can change the
website.** The two-part GTM snippet (a script in `<head>`, a `noscript` after
`<body>`) has to get onto the page some other way.

| Platform | Route | What it needs | Confidence |
|---|---|---|---|
| **WordPress (self-hosted)** | Our own small plugin that prints the container ID; or Google's **Site Kit**; or the **WordPress REST API or a WordPress MCP** writing to a plugin's setting | Site Kit can create a GA account, property and stream "on your behalf". It can pick or create a GTM container and place it, place the Ads conversion ID, and verify Search Console. Its consent mode tracks no EEA, UK or Swiss visitors by default, and needs a CMP plugin. Requires WP 5.2+, PHP 7.4+ and the REST API on. No core WordPress REST field for head scripts was found (**UNVERIFIED** that none exists), so a plugin is assumed | [sitekit](https://sitekit.withgoogle.com/documentation/getting-started/install/), [analytics](https://sitekit.withgoogle.com/documentation/supported-services/analytics/), [consent](https://sitekit.withgoogle.com/documentation/using-site-kit/consent-mode/) |
| **WordPress.com** | A plugin, on paid Personal, Premium, Business or Commerce plans (from a search snippet); or the WPCode header plugin | A paid plan | [wordpress.com](https://wordpress.com/support/plugins/install-a-plugin/) (snippet) |
| **Shopify** | The **Google & YouTube** channel sets up GA4 with automatic e-commerce events; the store must not be password-protected. GTM runs as a **Customer Events custom pixel**: sandboxed, **no `noscript`**, not supported by Shopify, and incompatible with the Tag Assistant troubleshooter | Theme edits through the API (`themeFilesUpsert`) need `write_themes` **plus a Shopify exemption** granted on request. **Consequence: the GTM method of Search Console verification probably fails on Shopify** because there is no `noscript` after `<body>`, so use META or DNS there (inference) | [GA4 setup](https://help.shopify.com/en/manual/reports-and-analytics/google-analytics/google-analytics-setup), [gtm tutorial](https://help.shopify.com/en/manual/promoting-marketing/pixels/custom-pixels/gtm-tutorial), [themeFilesUpsert](https://shopify.dev/docs/api/admin-graphql/latest/mutations/themeFilesUpsert) |
| **Wix** | Marketing Integrations → Google Tag Manager, where the user enters the container ID | **A paid plan and a connected domain** | [about integrations](https://support.wix.com/en/article/about-marketing-integrations), [GTM](https://support.wix.com/en/article/connecting-your-google-tag-manager-account-to-your-wix-site) |
| **Squarespace** | Code Injection (header and footer) | **Core, Plus or Advanced plan.** **There is no API**, so the user pastes it | [Squarespace](https://support.squarespace.com/hc/en-us/articles/205815908-Using-code-injection) |
| **Webflow and other builders** | Custom code in site settings, before `</head>` and before `</body>`, 50,000 characters each | A paid site or Workspace plan for custom code. The GA integration itself is free. The user pastes it | Search snippets of help.webflow.com (the page returned 403) |
| **Any site** | The user, or their developer, pastes one snippet once | Five minutes | Certain |
| **A site we host or build** (1920 Agency sites) | We put it in the template | Nothing from the user | Certain |

**The key point:** after the snippet is in place **once**, everything else is done
through the GTM API with no further website edits:

- new tags and events
- the Meta pixel
- consent mode
- GA4 configuration

So "one click" is honestly **one click plus, at most, one paste**, and zero pastes
on WordPress with our plugin or on a site we host.

---

## 10. Meta pixel and Conversions API through the same container (later)

- A Meta pixel can be added as a GTM tag. GTM's Community Template Gallery has
  templates for it, so the same container that holds Google's tags can hold
  Meta's (**UNVERIFIED** which template to use).
- Conversions API is server to server. It is covered in
  `research/2026-09-28-meta-conversions-api.md`, and that note's sources are
  reported rather than official.
- The `event_id` used to deduplicate pixel and server events should come from the
  same data-layer event that GTM fires for GA4.

---

## Approval lead times, longest first

| Approval | Typical | Source |
|---|---|---|
| YouTube API audit (public uploads, more quota) | Not published; plan for weeks | [audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) |
| Google Ads proxy-policy clarification or Standard review | About 10 business days for Standard; a policy answer is open-ended | [access-levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels) |
| GBP API access | "Within 14 days"; needs a profile 60+ days old | [FAQ](https://developers.google.com/my-business/content/faq) |
| OAuth **restricted**-scope verification with CASA, *if* `adwords` really is restricted (see section 1) | About 6 weeks | [13463817](https://support.google.com/cloud/answer/13463817) |
| OAuth sensitive-scope verification | 3–10 business days | [13463817](https://support.google.com/cloud/answer/13463817) |
| OAuth brand verification (also a prerequisite for Ads Basic) | 2–3 business days | same |
| Google Ads Explorer, then Basic | Minutes to hours after brand verification (reported) | [access-levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels) |
