# Waiting list — parked, not forgotten

Things that are **blocked on someone else**, or deliberately deferred by the
owner. Each says who is blocking it, what unblocks it, and what is already built
so nothing is redone.

This is not the backlog. `IDEAS.md` holds things we might build; `ROADMAP.md`
holds the order. This file holds work that is **ready or nearly ready and
waiting**.

_Updated 2026-09-27._

---

## 1. LinkedIn company-page posting 🕐 blocked on LinkedIn

**Blocked by:** Community Management API — *Review in progress* on the PageAPI app
(client id `7762wg8x0byoiu`), submitted 2026-09-26.

**Already built, waiting only on approval:**
- `linkedin_page` provider, registered and verified as listing correctly
- Organisation-scope authorisation, deliberately without OIDC
- Discovery reads `organizationAcls` and never calls `/v2/userinfo`
- The adapter already posts to `urn:li:organization:…` — no code change needed

**To unblock:** when LinkedIn emails approval, run
`pnpm connect:provider linkedin-page`. Until then it reports *"administers no
company pages"*, which is the pending state, not a fault.

**Owner's note 2026-09-27:** check back in a day or two.

## 2. LinkedIn Ads 🕐 deferred by the owner

**Deferred because:** Meta is where the money actually is. Owner's words:
*"barely few people run ads on it… mostly meta is the most important."* Correct
call, and the reason this is parked rather than dropped.

**Already built and reusable:**
- The whole ads domain model (`decisions/0003`) is platform-neutral
- The policy layer already classifies `activate_campaign`, `update_budget`,
  `create_ad_plan`, `pause_campaign`
- Spend ceilings written and tested

**Access is already granted** — Advertising API Development Tier is live on the
PersonalAPI app. Nothing external blocks this; it is purely a matter of order.

**Worth knowing when it resumes:** LinkedIn's "Campaign" is Meta's "Ad Set".
See `decisions/0003`.

## 3. LinkedIn products under review 🕐 blocked on LinkedIn

Forms submitted 2026-09-26/27 on the PersonalAPI app:

| Product | For |
|---|---|
| Conversions API | Measuring ad results — tier 5b |
| Matched Audiences API | Retargeting — tier 5b |
| Lead Sync API | Lead capture and CRM handoff — IDEAS I3 |

No action until LinkedIn responds by email.

## 4. Media transcoding (ffmpeg) ⏸ needs a decision, not approval

`IDEAS.md` section J2. One source video in, a correct file per platform out:
LinkedIn's API is reported to cap at 200 MB, X caps video at 140 seconds,
Instagram enforces 4:5–1.91:1.

**Why it is parked:** it needs `ffmpeg` on whatever machine runs the worker. That
is the first thing in this project that cannot be done in TypeScript alone, and
it changes deployment. **A decision, not a detail**, so it waits for one.

## 5. Threads and Pinterest ⏸ no credentials

Both have working adapters and providers and 100+ tests between them. Neither has
ever published, because neither has app credentials configured.

- **Threads** needs a Meta app with the Threads use case — its own OAuth, own
  scopes, own host. Not the existing Meta app.
- **Pinterest** ⚠️ **Trial access is a sandbox** — pins are visible only to their
  creator while everything reports success. Standard Access needs a submitted
  video of the app in use.

`pnpm connect:provider` handles both the moment credentials exist.

## 6. Video verification gaps ⏸ small, worth doing before client work

- LinkedIn's **200 MB API ceiling is unverified** and conflicts with the 5 GB
  figure for manual upload. Find out before promising a client a large upload.
- Whether `/feed/update/urn:li:ugcPost:…` resolves — video posts return a
  different URN type from text and image posts.

---

## 7. Meta ads — three owner decisions ⏸

The ads tools are built and verified. Three things only the owner can decide:

1. ~~**Spend ceiling.**~~ **Set 2026-09-30**: 10,000/day, 100,000/month, 1,000
   minimum. **But they conflict for open-ended campaigns**: 10,000/day left
   running is 300,000/month, so the real always-on ceiling is ~3,333/day. Either
   raise the monthly limit to 300,000, or accept that 10,000/day only works for
   campaigns of 10 days or fewer. Owner's call.
2. **Orphan campaigns** in the sandbox from retries — all PAUSED, none can spend.
   Keep `120330000132891215`, delete the rest? Awaiting approval.
3. **The ads token carries 43 permissions and never expires.** Six are needed.
   Regenerate with only those, or keep it?

Also: the three ads in `120330000132891215` were `PENDING_REVIEW` on 2026-09-30.
Check with `get_campaign_status` whether Meta approved them.

---

## 8. AI image generation: key and $2/day cap set 2026-10-01; needs credit (see #13)

Decided: **OpenRouter, paid per image** (decisions/0007). Built and unit-tested
as `generate_ad_images`. Needs, in the env file:

- `OPENROUTER_API_KEY`, from openrouter.ai/keys.
- `OPENROUTER_DAILY_LIMIT_USD`, the most to spend on images per day. Nothing is
  generated while it is empty.

~~## 9. Cleanup~~ **Done 2026-09-30**: 9 sandbox campaigns and 9 creatives
deleted, and the test lead form archived.

## 10. First real Meta campaign: PAUSED by the owner on 2026-10-01

Campaign `120249127474910366` on "1920Agency 10" ran from 2026-09-30 at PKR
500/day. The owner paused it: it was a test that the live account works, and it
did. Read back from Meta 2026-10-01: `PAUSED`.

**To do:** read what it spent and did with `get_ad_performance` before reusing
anything from it.

## 11. The Meta token reaches client ad accounts (deliberate)

The system user can reach client accounts (Muzaree, European Cyprus, Malta, UK
and others). **The owner granted this deliberately**, to manage client accounts
through AdsPilot later, and checks it daily. The code acts only on the configured
account.

## 12. "Website events" tick box on the live ad

The API shows the pixel on the ad (added 2026-09-30); the owner's Ads Manager
still showed the box unticked. **Waiting on the owner:** reload Ads Manager. If
it is still unticked, tick it once there, and the ad is read back to see what
Ads Manager writes, so the code matches it exactly.

## 13. OpenRouter has no credit

The key works (checked 2026-10-01, free check) and the daily cap is **$2**, but
the account has **$0 credit**, and image models are paid. **Waiting on the
owner:** add credit at openrouter.ai → Credits. Until then `generate_ad_images`
will fail at OpenRouter, and nothing is charged.

## 14. The product name

"AdsPilot" is taken by several live products, one selling nearly the same thing
(adspilot.tech: AI agents for Google Ads, Meta Ads, SEO, social, Business
Profile). See `research/2026-10-01-product-name.md`. First choice **Mahir**
("expert"), then Hamkar, Markwala. **Waiting on the owner:** pick, then check
trademarks, domains and handles before anything public carries it.

## 15. Google: owner setup, and two answers from Google

Plan and full checklist with links: `architecture/google-suite-plan.md` (facts in
`research/2026-10-01-google-suite.md`). **Waiting on the owner,** in order:
Google Cloud projects (dev and prod, paid billing), OAuth consent screen set to
production, OAuth client (secret only in `~/.social-publisher/.env`), enable the
APIs, brand verification, then apply for Google Ads Basic access, the Business
Profile API access form, and the YouTube audit (uploads stay private until it
passes).

**Existing project (found 2026-10-01):** `gen-lang-client-0046538567`, created
by Google AI Studio, used by SEO-Ops through a **service account** for Search
Console. Reusable as the owner's own/dev project. A service account cannot post
to Business Profile or YouTube; those need an **OAuth client** (Web application,
redirect `http://localhost:8787/google/callback`). The customer-facing production
project waits for the final product name, because its consent screen and brand
verification carry the name and domain.

**Waiting on Google:** whether a hosted AdsPilot where each customer signs in
with their own Google account counts as a banned "programmatic proxy" under the
2026-08-31 Ads policy. Until answered, Google Ads is built for the owner's own
accounts only. A letter to Google can be drafted.

## 16. What the first audit found in the ad account (owner to decide)

From `audit_ad_account`, 2026-10-02, read-only:

- **4 ads rejected or with issues**: two "55kIg Template" ads disapproved, "Error:
  03117889091" and "MMTT | WA Messages | 26-03-2024" with issues. Fix, appeal or
  archive them.
- The test traffic campaign put 97% of its spend on Audience Network. If it is
  reused, exclude Audience Network or let the new landing-page-view default
  apply.
- Over 30 days, "VES 3999 - 2" and "VES 3999 - 3" cost 1.5–1.6× more per
  conversation than "VES- 5" (PKR 54). Give a target cost per conversation for a
  real verdict.

---

## How to use this file

When something here unblocks, move it into `ROADMAP.md` and delete it from here.
When the owner asks "what were we waiting on?", this is the answer.
