# 0007 — Pricing: a flat subscription, and third-party costs at 3× as credits

**Date:** 2026-09-30, corrected the same day by the owner
**Status:** accepted (owner's decision)
**Context:** the owner reviewed the competitors in
`research/2026-09-30-competitors.md` and liked Zernio's pricing page.

---

## Decision

**1. Posting is a flat subscription of about US$6–7 in total.**

One price, and the customer can post to every platform they connect. It is
**not** charged per connected account. An earlier version of this record said it
was; the owner corrected that.

**2. Third-party usage is paid for with credits, at 3× what it costs us.**

When a customer uses a paid third-party service *through* AdsPilot, we pay the
provider and charge the customer three times that, from a prepaid credit
balance on their side. Worked example from the owner: if OpenRouter charges us
$1 for images, the customer pays $3 in credits.

| Pass-through cost | What we pay |
|---|---|
| AI image generation (OpenRouter) | about $0.03–0.08 per image, reported exactly per call |
| X (Twitter) API | pay per post, and more for a post with a link |
| Future data calls (rank tracking, backlinks, enrichment) | per call, by provider |

The multiple covers our margin, failed calls, and the cost of carrying the
provider accounts.

**3. Marketing (ads) may be limited by plan.** For example, how many ad accounts
a plan can manage. Free allowances may be offered. Not yet set.

**4. Ad spend is never marked up.** The customer's budget goes to Meta or Google
from their own ad account and card. We charge for the tool, not a percentage of
their spend. Taking a percentage would give us a reason to push budgets up, which
is the opposite of what the spend ceilings are for.

## What this needs before it can be charged

- **A credit ledger per tenant**, debited at 3× on every pass-through call. The
  audit log already records the exact cost of each image (`images.generated`,
  `costUsd`), so the source numbers exist. What is missing is the balance, the
  top-up, and refusing a call when the balance is empty.
- **Per-tenant limits and settings.** Today the spend ceilings, the ad account and
  the OpenRouter key come from the owner's environment, which suits 1920 Agency
  alone. Customers need their own, stored per tenant (decision 0005 records the
  same need for ad accounts).

## Not decided yet

- The exact price, and whether there is a free tier.
- How many ad accounts each plan includes.
- The payment provider and currencies, for Pakistan and abroad.
