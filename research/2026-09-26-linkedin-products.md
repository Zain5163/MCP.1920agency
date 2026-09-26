# LinkedIn developer products — which are worth requesting

**Date:** 2026-09-26
**Why:** the owner's app exposes twelve products and asked which others are worth
adding. This is the triage, so it is not re-derived every time the page is opened.

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
