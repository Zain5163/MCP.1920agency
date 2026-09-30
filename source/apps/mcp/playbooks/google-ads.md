# Google Ads playbook

**Status: this server cannot launch Google Ads yet.** There are no Google tools.
What you *can* do is plan a campaign and write it in a form the user can enter
into Google Ads themselves. Say that plainly before starting, and never describe
a Google campaign as created or running.

**Updated 2026-09-30.**

---

## The difference from Meta that shapes everything

Google Search **harvests demand that already exists**. People are typing what
they want. It cannot create demand the way Meta can. So:

- If almost nobody searches for what the business sells, say so, and suggest Meta
  instead of forcing keywords nobody types.
- On Meta the creative does the targeting. On Search **the keyword does**, and
  the ad is downstream of it.

## Spend in this order

Each rung earns budget only once the one below it is producing real customers:

1. **Brand** — people searching the business's own name. Cheap, converts best.
   Always on, with its own budget.
2. **High-intent** — ready to buy ("video editing agency Karachi", "best reel
   editor for restaurants"). Where most of the budget belongs.
3. **Competitor** — "[competitor] alternative". Costlier; needs a comparison page.
4. **Problem-aware** — has the problem, is not shopping yet. Longer payback.
5. **Display, YouTube, broad awareness** — last, with spare budget only.

Skipping rungs is how accounts spend everything and get nothing.

## Account structure

- **Separate campaigns with separate budgets** for brand, high-intent,
  competitor and remarketing. In a shared budget, brand takes everything and the
  rest learns nothing.
- **Themed ad groups**: 5–15 closely related keywords that one promise answers.
  If two keywords need different landing pages, they belong in different groups.
- **A campaign that cannot reach ~15–30 conversions a month cannot feed automated
  bidding.** Merge it rather than keep it separate.

Settings to change on every new Search campaign:

- **Search Partners and Display Network: off** until proven.
- **Location: "Presence"** — people physically there. The default also serves
  people merely *interested in* the place.

## Keywords

Start with **Phrase and Exact** match on high-intent terms. Add **Broad** only
once *all three* are true: 30+ conversions a month, automated bidding running,
and a solid negative list. Broad without them buys irrelevant clicks.

**Negative keywords from day one.** A starting list:

> free, cheap, jobs, job, salary, hiring, career, internship, student, course,
> tutorial, training, certification, pdf, template, reddit, wiki,
> "what is", "how to", "meaning", "definition"

Remove any that are actually relevant to the business. A gotcha worth knowing: a
**broad** negative only blocks queries containing *all* its words — negative
"free trial" does not block "free".

## Bidding, by how many conversions the campaign already gets

| Conversions in the last 30 days | Strategy |
|---|---|
| Under 15 | Maximise Clicks, or Manual CPC |
| 15–29 | Maximise Conversions |
| 30+, stable | Target CPA, set at 1.1–1.2× the actual CPA |
| 50+, with real sale values | Target ROAS |

Change targets by **10–15% at most, then wait 1–2 weeks.** Every change restarts
learning. A target set well below reality makes Google stop bidding.

## Responsive search ads: hard limits

Output that breaks these is refused by Google. Count characters, including
spaces, and show the count.

| Field | Rule |
|---|---|
| Headlines | **exactly 15**, each **≤ 30 characters** |
| Descriptions | **exactly 4**, each **≤ 90 characters** |
| Paths | up to 2, each **≤ 15 characters** |
| Final URL | https |
| Per ad group | **at most 3** responsive search ads |

Always deliver alongside them: the ad group structure, at least 8 negative
keywords, at least 4 sitelinks, and at least 4 callouts of ≤ 25 characters.

Write the 15 headlines as genuinely different angles — the offer, the benefit,
proof, the location, the call to action, the brand — not fifteen rewordings.

## Performance Max

Only after Search is working, never as the first campaign, never on weak
tracking. Exclude the brand from it at account level, or it takes credit for
searches brand Search would have won anyway. Supply a real video — Google
generates a poor one if you do not.

## Measurement

Attribution is **data-driven by default** (rule-based models were retired in
2025). For lead businesses, the biggest improvement available is sending real
outcomes — qualified lead, sale — back into Google, so it optimises toward
customers rather than form-fills.

---

## Connecting Google Ads later

Needs a Google Ads **developer token** with at least Basic access (Google's
approval, typically weeks), an OAuth client, and a manager account. Recorded in
the roadmap; not built.

---

*Informed by, and re-expressed from: coreyhaines31/marketingskills (MIT),
Hainrixz/claude-ads (MIT), itallstartedwithaidea/google-ads-skills (Apache-2.0).
Source copies in `reference/ad-skills/`.*
