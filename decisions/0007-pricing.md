# 0007 — Pricing: per connected account, and pass-through costs at 3×

**Date:** 2026-09-30
**Status:** accepted (owner's decision)
**Context:** the owner reviewed the competitors in
`research/2026-09-30-competitors.md` and preferred Zernio's model.

---

## Decision

**1. Social accounts are charged per connected account, around US$6–7 each.**

The same shape as Zernio ($6 / $3 / $1 per account in tiers, with the first two
free). It is simple to explain and scales with what a customer actually uses.

**2. Anything we pay for per use is passed on at 3× what it costs us.**

Several things cost money per call, and the cost is ours until it is charged on:

| Pass-through cost | What we pay |
|---|---|
| AI image generation (OpenRouter) | ~$0.03–0.08 per image, reported exactly per call |
| X (Twitter) API | pay per post; more for a post with a link |
| Future data calls (rank tracking, backlinks, enrichment) | per call, by provider |

At 3×, a $0.04 image is billed at about $0.12. The multiple covers our margin,
failed calls, and the cost of carrying the provider accounts.

**3. Ad spend is never marked up.** The customer's ad budget goes to Meta or Google
directly from their own ad account and card. We charge for the tool, not a
percentage of their spend. Taking a percentage would give us a reason to push
budgets up, which is the opposite of what the spend ceilings are for.

## What this changes

- **The website pricing section.** `ROADMAP.md` had recommended against
  per-account pricing, on the grounds that agencies with many clients would pay
  more. The owner has decided otherwise, and this record replaces that
  recommendation. The concern is worth keeping in mind for **agency tiers**: a
  lower per-account rate at volume, as Zernio does, answers it without changing
  the model.
- **Metering is needed before charging.** The audit log already records the
  exact cost of every image (`images.generated`, `costUsd`). The same pattern
  will be needed for every pass-through cost, per tenant, before an invoice can be
  produced from it.

## Not decided yet

- Tier boundaries, and how many accounts are free.
- Currency and payment provider for Pakistan and abroad.
- Whether ad accounts count as "accounts" for pricing, or only social ones.
