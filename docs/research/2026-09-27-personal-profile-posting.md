# Can we post to personal profiles? Per platform.

**Date:** 2026-09-27
**Why:** the owner's plan is "Meta posting (personal profile + page) and marketing,
LinkedIn posting (personal and pages) and marketing". One quarter of that is not
buildable, and it is cheaper to know now than after an adapter is written.

---

## Facebook personal profiles: ❌ NOT POSSIBLE. Ever.

**This is a hard platform restriction, not an approval we have not asked for.**

Meta deprecated `publish_actions` in Graph API v3.0 in 2018, after Cambridge
Analytica, and **never replaced it**. The Graph API publishes to **Pages only**.
No level of App Review, business verification or partnership grants posting to a
personal Facebook timeline.

Sources: [PostPeer](https://www.postpeer.dev/blog/best-facebook-posting-api),
[Postproxy](https://postproxy.dev/blog/facebook-graph-api-posting-guide/),
[TechCrunch, 2018](https://techcrunch.com/2018/04/24/facebook-api-changes).

Any tool that claims to post to a personal Facebook profile is either driving a
browser session or breaking Meta's terms. Both get accounts banned, and neither
is something this project will do.

**Consequence for the plan:** Meta posting means **Pages and Instagram Business
accounts**. There is no personal-profile half to build.

## Instagram personal accounts: ❌ not via the API

Publishing requires an Instagram **Business or Creator** account linked to a
Facebook Page. A personal Instagram account cannot publish through the API at
all. 1920 Agency's is already a Business account, so this costs nothing here —
but it will matter for any client who has not converted theirs.

## LinkedIn personal profiles: ✅ YES, and already working

The exception, and the reason the asymmetry is confusing.

`w_member_social` from the self-serve "Share on LinkedIn" product posts to a
personal profile. Verified 2026-09-26 with text, image and video all published
live. LinkedIn permits exactly what Meta forbids.

## LinkedIn company pages: 🕐 pending

Needs the Community Management API on a **separate app**. Requested; review in
progress. See `2026-09-26-linkedin.md`.

---

## The honest matrix

| Platform | Personal | Business / Page |
|---|---|---|
| Facebook | ❌ impossible by policy | ✅ working |
| Instagram | ❌ needs a Business account | ✅ working |
| LinkedIn | ✅ **working** | 🕐 pending review |
| Threads | ✅ (one account per authorisation) | n/a |
| Pinterest | ✅ (per board) | n/a |

The pattern worth remembering when the next platform is scoped: **Meta is the
restrictive one.** Assuming "if LinkedIn allows it, Meta probably does" is exactly
backwards, and is the same shape of mistake as assuming Threads used the Graph
API.
