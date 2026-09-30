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

1. **Spend ceiling.** `META_ADS_DAILY_LIMIT` and `META_ADS_MONTHLY_LIMIT` in the
   env file, whole PKR. Until both are set, create and activate refuse. No
   default on purpose.
2. **Orphan campaigns** in the sandbox from retries — all PAUSED, none can spend.
   Keep `120330000132891215`, delete the rest? Awaiting approval.
3. **The ads token carries 43 permissions and never expires.** Six are needed.
   Regenerate with only those, or keep it?

Also: the three ads in `120330000132891215` were `PENDING_REVIEW` on 2026-09-30.
Check with `get_campaign_status` whether Meta approved them.

---

## How to use this file

When something here unblocks, move it into `ROADMAP.md` and delete it from here.
When the owner asks "what were we waiting on?", this is the answer.
