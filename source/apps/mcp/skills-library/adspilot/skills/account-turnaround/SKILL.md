---
name: account-turnaround
description: "Turn around a Meta ad account that is declining, unprofitable or 'sometimes works, mostly not': check the basics, diagnose the decline month by month with diagnose_account_trend, set targets from the business's real costs with break_even_cost_per_sale, fix the causes in order (store, creative, auction, structure), cut losers fast, cap spend, monitor every few hours, and report. Use when an owner says costs per sale went up, results are inconsistent, ROAS is falling, or asks whether to start a new ad account."
---

# Account turnaround: from "it used to work" to steady, profitable sales

**Updated 2026-10-09**, from a real turnaround (PK footwear, cash on delivery): cost per
purchase rose 2.2× over seven months; three funnel steps explained all of it, and the
business's real costs showed that the target everyone assumed was wrong. The general
method for running an account is `get_skill meta-account-manager`; this is the rescue
sequence. Pass `account` to every ads tool when the user has more than one account.

## 1. Rule out the boring causes first (10 minutes)

- `get_ad_activity` (days 30–90): payment failures ("Payment Needed"), campaigns paused by
  someone, budget jumps, rejected ads. One failed card and a manual pause cut one account's
  spend by 60% overnight; that is not an ads problem.
- `audit_ad_account`: rejected ads, campaigns optimising for clicks instead of purchases,
  ad sets stuck in learning, too many small ad sets, spend with no tracked results.
- Read every live ad's text: AI-written variants have shipped drafting notes and old prices to customers.

## 2. Diagnose the decline (diagnose_account_trend)

`diagnose_account_trend` (months 9–12) gives the month-by-month funnel, the best month, and
the change in cost per purchase split into steps that multiply to the total:

| Step that got worse | What it means | Where the fix is |
|---|---|---|
| **Add to cart ÷ page views** | Visitors want the product less once they see it | **The store and the offer** (`get_skill store-builder`): clear price, a bundle, delivery and returns stated the same everywhere, real photos and sizes, no stale banners, the ad's product is the page's product |
| **Link CTR** | Ads stopped stopping people | **Creative**: 8–12 genuinely different concepts, proven formats re-cut (often video), in-season product, one clear price; refresh every 2–3 weeks |
| **CPM** | The auction got dearer | Season and competition (plan events early: `get_skill event-calendar`); better CTR lowers it; do not push more spend into a tiring audience |
| Page views per click | Clicks are not loading the page | Speed on mobile data, broken links, weak placements |
| Purchase ÷ add to cart | Carts are not becoming orders | Surprise costs, checkout friction, missing payment methods (cash on delivery where buyers expect it) |

Also read: frequency (above ~2.5 per month on a small audience means fatigue) and whether
spend was raised while the rates fell (it usually was).

Then `analyze_ad_performance` (days 90) for the ads, formats, angles, prices and season
that sold cheapest: reuse what proved itself, at today's prices.

## 3. Set targets from real costs (break_even_cost_per_sale)

Ask the owner for: cost per item **with packaging**, average order value and items per order,
delivery the business pays, taxes and fees as a percentage, and **the share of orders refused
or returned**. Never assume them. Then `break_even_cost_per_sale`.

- **Loss line** = break-even cost per purchase (after learning, 3 days).
- **Target** ≈ half of break-even (keeps half of each order's profit).
- **Scale (+20%) only at or under target for 3+ days.**
- Any product priced below cost (or near it): never advertise it, and tell the owner.
- Cash on delivery: a 30% refusal rate costs about as much as the ads do. Order
  confirmation (call/WhatsApp before dispatch) and a small prepaid discount are often the
  cheapest profit there is. A two-item bundle roughly doubles what a sale can cost.

## 4. Reset the structure and the money

- One **proven** campaign (the ads with the best 90-day cost per purchase) and one **test**
  campaign; purchase optimisation on both (`verify_campaign` checks it). About 60% of the
  budget to proven, 40% to test; test money stays small until an ad proves itself.
- Few, larger ad sets; 4–6 different ads live so delivery is not resting on one.
- **Agree a daily cap with the owner and set it as the account's {{PRODUCT_NAME}} ceiling**
  (`~/.social-publisher/ad-accounts.json` `dailyLimit`), so no change can exceed it.
- Cut fast (`set_ad_delivery` off needs no approval): an ad at ~3× the target with no
  purchase; an ad with half the click-through of its siblings after meaningful spend; any
  ad showing a price below cost. Budget changes and new ads need the owner's approval.

## 5. Monitor on a rhythm

A declining account needs eyes more than once a day while it recovers: a short check every
few hours (today's spend against the cap, purchases, losers switched off, delivery problems)
plus one daily report (the funnel step that is worst against baseline and the one action
for it). On the {{PRODUCT_NAME}} desktop app this is a scheduled headless run with only read tools
and `set_ad_delivery` off allowed; everything else goes to a waiting list for the owner.

## 6. Report like this

A table of the months (from `diagnose_account_trend`), the ranked causes in one line each,
what was done (with numbers), what waits for the owner's yes, and the break-even line. Real
numbers only; "not enough data" beats a guess. Judge by the week, not the day: at 4–8 sales
a day, a day of 1 and a day of 12 are both normal.

## "Should we start a new ad account?"

Almost never as a fix. Meta does not score an ad account by its past cost per result: every
ad competes in every auction on its offer, creative and predicted response. The valuable
history is in the **pixel / dataset**, which a new account would share anyway. New accounts
start with low spending limits, more ad reviews and a higher risk of restriction, and split
learning if run alongside. Keep a second account only as a **standby** (payment method,
Page, pixel shared, low {{PRODUCT_NAME}} ceiling) for a restriction, or for ownership reasons.
Check the current account's health first: `account_status` active, no `disable_reason`.

## Never

- Scale spend while the funnel rates are falling.
- Judge a sales campaign on clicks or cheap traffic.
- Set a cost-per-purchase target without the business's real costs.
- Blame the account, the algorithm or the audience before reading the funnel.
- For the buyer's country (payments, cash on delivery, tax, consumer law): `get_skill selling-by-country`.
