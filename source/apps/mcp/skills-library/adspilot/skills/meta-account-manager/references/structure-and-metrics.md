# Structure, metrics and history: how to judge and scale a Meta account

Companion to the meta-account-manager skill. Three questions every performance
manager answers before touching a budget: **how is the money organised (CBO or
ABO)**, **which numbers say an ad or campaign is working**, and **what the
account's own history already proves**.

---

## 1. CBO or ABO: which, and when

| | ABO (ad set budget) | CBO (campaign budget, "Advantage+ campaign budget") |
|---|---|---|
| Who decides the split | You: each ad set gets its own fixed budget | Meta: one budget, moved to whichever ad set converts best |
| Best for | **Testing**: new creatives, angles, offers or audiences need a fair, even share of spend to be judged | **Scaling** proven ad sets: Meta pushes money to what is already winning |
| Risk | Money stays in a losing ad set until you move it | A new or weaker ad set gets starved, so it never shows what it can do |
| Learning | Each ad set needs its own ~50 results/week | Same per ad set, but Meta concentrates spend so the winner gets there faster |

Rules:
1. **One ad set: CBO and ABO are the same.** Do not restructure just to change the label.
2. **Test with ABO** (or Meta's built-in Creative Testing, which splits spend evenly
   inside a live ad set): a small test campaign at 10–20% of spend, equal budgets,
   judged after about 3× the target cost per result per ad or concept.
3. **Scale with CBO** once 2+ ad sets have each proven a cost per result at or under
   target: put them in one CBO campaign and raise the campaign budget ~20% every 2–4 days.
4. **Never test new things inside a scaling CBO campaign**: Meta starves them before
   they are judged, and a weak test can pull spend from the winner.
5. **Graduate winners by post ID**: move a winning ad into the scaling campaign using its
   existing post, so its likes, comments and shares come with it.
6. While the whole account makes fewer than ~50 purchases a week, keep it to **one or two
   ad sets in total**. Every split slows learning.

AdsPilot today sets budgets on ad sets (`budgetLevel: adset`). With one ad set this is
fine; when an account graduates to a multi-ad-set scaling campaign, say that a CBO
campaign is the right structure and that AdsPilot cannot build it yet.

---

## 2. The metrics, in the order that matters

### Business numbers decide; everything else explains them

| Metric | Means | Judge against |
|---|---|---|
| **Cost per purchase (CPA)** | Spend ÷ purchases | The target the business set, and break-even |
| **Return on ad spend (ROAS)** | Purchase value ÷ spend | Break-even ROAS = 1 ÷ gross margin |
| **Cost per delivered order** (COD markets) | CPA ÷ (1 − return rate) | What the business actually keeps |
| Purchases per week, per ad set | Volume | ~50 to leave learning |

An ad or campaign is **successful** when its cost per purchase is at or under target
(and ROAS above break-even) **on enough data**: about 3× the target spent, or 3+
purchases, over 3+ days. Before that, "it looks good" is a guess.

### Funnel numbers find *where* it breaks

Read them top to bottom; the first one that is clearly worse than the account's own
baseline is the problem to fix, and it tells you what kind of fix:

| Step | Metric | When it is worse than baseline, look at |
|---|---|---|
| Attention cost | **CPM** (cost per 1,000 impressions) | Season and competition (Nov–Dec, sales events), audience too narrow, ad quality ranking low. Not an ad copy problem by itself |
| Stopping the scroll | **Hook rate** (video: 3-second views ÷ impressions; aim ~25–30%+) | The first 1–2 seconds / the image: product not visible, weak hook |
| Holding attention | **Hold rate** (ThruPlays ÷ 3-second views) | The middle of the video: too slow, no payoff |
| Wanting to click | **Link click-through rate (link CTR)** | Hook, offer and message relevance. Falling CTR with rising frequency = fatigue |
| Click cost | **Cost per link click (CPC)** | CPM ÷ CTR: fix whichever of the two moved |
| Arriving | **Landing page views ÷ link clicks** (aim ~70%+) | Page speed, accidental clicks, poor placements (e.g., Audience Network) |
| Wanting the product | **Add to cart ÷ landing page views** | Offer and price, product page, size guide, photos, trust signals, delivery terms. Usually the store, not the ad |
| Starting checkout | **Initiate checkout ÷ add to cart** | Surprise costs (delivery fees), forced sign-up |
| Finishing | **Purchase ÷ initiate checkout** | Checkout friction, payment and COD options, form length |
| Basket size | **Average order value (AOV)** | Bundles, upsells, price mix |

### Ad-level signals

| Signal | Reading |
|---|---|
| Frequency over ~3 (7 days) with CTR falling 20%+ | Fatigue: launch a fresh version of the same angle |
| High CTR, poor purchase rate | The ad promises something the page does not deliver, or attracts browsers |
| Low CTR, good purchase rate | Right message, weak hook: re-cut the first line or first seconds |
| Spend concentrates on one ad | Normal under Meta's delivery; dangerous when that one ad tires. Keep alternatives ready |
| Quality, engagement and conversion rankings (Ads Manager) | Below average on quality = the creative, on conversion = the page or offer |

---

## 3. Use the account's own history before inventing anything

History is the cheapest research there is: someone already paid for it.

1. **Pull 90 days at ad level** (`analyze_ad_performance` for the account with
   `days: 90`, or insights by ad) and rank ads with meaningful spend (about 3× the target CPA or more)
   by cost per purchase. Note each winner's **product, angle, format (video or
   static), offer, price shown and season**.
2. **Pull monthly funnel numbers** for the best month and the latest month, and put
   them side by side (table above). The step that moved most is the problem.
3. **Reuse what proved itself**: relaunch or rework the winning angle and format,
   in season, at today's prices. Keep the original post where possible (social proof).
4. **Do not repeat what failed** with enough spend: the same angle, format or offer
   that cost 2× target before will usually do so again.
5. **Check what changed** around good and bad periods (`get_ad_activity`): budget
   jumps, paused campaigns, payment failures and policy rejections explain many swings.

### Worked example (PK footwear e-commerce, COD, 2026)

Best month February: CPA PKR 636. Latest month September: CPA PKR 1,398.

| | Feb | Sep |
|---|---|---|
| CPM | 251 | 342 (+37%) |
| Link CTR | 2.34% | 1.76% |
| CPC | 10.7 | 19.4 |
| Landing page views ÷ clicks | 78% | 79% |
| Add to cart ÷ landing page views | 5.9% | 3.5% |
| Purchase ÷ initiate checkout | 47% | 58% |

Reading: checkout was never the problem (it improved). Attention got more expensive
(CPM up, CTR down, so CPC doubled) and visitors wanted the product less (add-to-cart
down by 40%). So the fixes were a sharper in-season hook and offer (the February
winners were Chelsea boots in winter with one clear price) and store fixes (delivery
terms, stale banners, trust), not checkout or targeting. The best ads by cost per
purchase over 90 days were **videos**, while the next creative round had been planned
as static images only, so proven video formats went back into the plan.

---

## 4. What the daily report must contain

For the account and each active campaign, yesterday / 3 days / 7 days: spend,
purchases, CPA against target, ROAS, CPM, link CTR, CPC, landing page views ÷ clicks,
add to cart ÷ landing page views, purchase ÷ checkout, frequency. Then: which step of
the funnel is worst against baseline, and the one action that addresses it.
