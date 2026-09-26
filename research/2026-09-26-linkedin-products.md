# LinkedIn developer products — which are worth requesting

**Date:** 2026-09-26
**Why:** the owner's app exposes twelve products and asked which others are worth
adding. This is the triage, so it is not re-derived every time the page is opened.

## Two apps, as of 2026-09-27

| App | Client ID | Holds | State |
|---|---|---|---|
| **PersonalAPI** | `77e2h71w8mhoqb` | Share on LinkedIn, Sign In with OIDC, Advertising API, Ad Library, Events Management | working — posting verified |
| **PageAPI** | `7762wg8x0byoiu` | Community Management API only | **Review in progress** |

### The exclusivity is mutual, and stronger than first understood

On **PageAPI**, now that Community Management is in review, **Share on LinkedIn
and Advertising API are both greyed out**. The conflict is not "OIDC blocks
Community Management" — it is that a Community Management app cannot hold the
ordinary publishing or ads products at all, in either direction.

That means the two-app split is not a workaround. It is the only shape LinkedIn
permits, and trying to consolidate later would fail.

### Advertising API is GRANTED, not pending

PersonalAPI lists Advertising API under **Added products** with a *View Ad
Accounts* link, so Development Tier access is live. Tier 5b no longer has an
access blocker on LinkedIn — only build work.

Development Tier is reported to cover a small number of ad accounts and is meant
for building before requesting Standard. Unverified, and worth confirming before
anything is promised to a client.

### Submitted, awaiting review

Conversions API, Matched Audiences API, Lead Sync API — forms submitted
2026-09-26/27.

### A tab that appeared: Webhooks

PersonalAPI now shows a **Webhooks** tab that was not there before. Worth looking
at when leads and comments are built: push notification of a new lead or a new
comment beats polling for it, and it is the difference between replying in
minutes and replying tomorrow. Not investigated yet.

## Already on the app

| Product | Status | What it gave us |
|---|---|---|
| Share on LinkedIn | ✅ added | `w_member_social` — posting as a person |
| Sign In with LinkedIn (OpenID Connect) | ✅ added | `openid`, `profile`, `/v2/userinfo` — without it, connect fails |
| Advertising API | 🕐 requested 2026-09-26 | Campaign management. Tier 5b depends on it |

## Worth requesting now — approvals are the long pole

| Product | Why it matters here | Maps to |
|---|---|---|
| **Lead Sync API** | Retrieve leads from lead-gen forms. A lead sitting in a dashboard for three days is worth far less than one reaching a salesperson in three minutes. For an agency this may be worth more than the campaign creation it depends on | IDEAS **I3** |
| **Conversions API** | Sends conversion events back for measurement and optimisation. Without it, campaign performance is guesswork — you can spend but not learn | Tier **5b** |
| **Matched Audiences API** | Retarget site visitors and known contacts. This is where most B2B ad efficiency comes from | Tier **5b** |
| **LinkedIn Ad Library** | Search competitors' live ads. Read-only, no risk, and directly useful to an agency pitching clients | IDEAS **D**, competitor work |

All four had live request buttons as of 2026-09-26. Requesting costs a click and
starts a clock that cannot be hurried later.

## Blocked

| Product | State |
|---|---|
| **Community Management API** | Request button **disabled**, not pending. This is the one that would allow posting as the 1920 Agency page. See `2026-09-26-linkedin.md` for the second-app theory being tested |
| Live Events, Member Data Portability, Pages Data Portability | Buttons disabled; none are needed for anything planned |

## Not worth it for now

| Product | Why not |
|---|---|
| Events Management API | Managing an organisation's LinkedIn events. Real feature, no demand, and it needs organisation access we do not have |

## The rule this follows

Request anything read-only or clearly on the roadmap **early**, because approval
time is the constraint, not build time. Do not request things with no use: every
extra permission is something to justify at review and something to lose if the
app is ever audited.
