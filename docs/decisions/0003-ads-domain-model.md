# 0003 — The ads domain model

**Date:** 2026-09-27
**Status:** accepted
**Context:** tier 5b. LinkedIn Advertising API Development Tier is granted, so
LinkedIn is the first ads platform with access in hand. Meta Ads follows.

---

## The problem

An ad is not a post. `PostDraft` is content plus targets; an ad is a hierarchy
with budgets, schedules, audiences and objectives, and **a bug in it spends real
money**. Tier 5b already says this. This decision settles the shape before any
adapter is written, because the ordering mistake — build the integration, then
discover the model is wrong — is expensive once two platforms exist.

## ⚠️ The trap: "campaign" means different things on different platforms

This is the single most important thing in this document.

| Our term | Meta | LinkedIn | Holds |
|---|---|---|---|
| **Campaign** | Campaign | **Ad Campaign Group** | objective |
| **AdSet** | Ad Set | **Ad Campaign** | budget, schedule, audience |
| **Ad** | Ad | **Creative** | the creative itself |

**LinkedIn's "Campaign" is Meta's "Ad Set", not Meta's "Campaign".** Anyone
reading LinkedIn's docs and Meta's docs in the same week will conflate them, and
the failure mode is putting a budget on the wrong object — which either does
nothing or spends at the wrong level.

So the domain uses **our own names**, and each adapter translates. The same
reasoning that keeps platform names out of the publishing path applies here, with
more at stake.

## Decisions

### 1. A separate `AdDraft`, not an extension of `PostDraft`

They share almost nothing. Forcing an ad through `PostDraft` would mean optional
fields everywhere that are mandatory for one and meaningless for the other, and
every validator would have to ask which it is holding.

### 2. Money is integer minor units, never floats

`0.1 + 0.2 !== 0.3`. Budgets are precisely where that matters. Every amount is an
integer count of cents with an explicit currency, and a mismatched currency is
**refused rather than converted** — a wrong exchange rate silently multiplies a
budget, and this layer exists to make that impossible rather than unlikely.

### 3. Everything is created PAUSED. Always.

Inherited from `Meta-Ads-Publisher`, which already proved the pattern. There is no
"create and run" call in this system's vocabulary. Activation is a **separate,
explicitly confirmed action**.

The reason is asymmetry: a wrongly-created paused campaign costs nothing and is
deleted in a second. A wrongly-created live campaign spends money while you work
out what happened.

### 4. Activation and budget increases are high-risk actions

They go through the policy layer built on 2026-09-26. The AI proposes; a
deterministic validator authorises. Classification and ceilings are code, never
instructions to a model.

### 5. Spend ceilings are checked before the platform is called

`checkSpend` already exists and is tested. It becomes load-bearing here: a
per-tenant daily and monthly maximum, checked locally, so "increase every budget
by 500%" fails on arithmetic rather than on good judgement — and fails **before**
any money is committed rather than after.

### 6. Read before write

The first LinkedIn ads work is **reading**: list ad accounts, campaigns and
performance. It is useful on its own (the cross-account anomaly query in `docs/product/ideas.md`
I4), carries no financial risk, and proves the auth, account model and pagination
before anything can spend.

Writing comes second, and starts with creating paused objects.

## Consequences

- Two more layers of translation per platform, which is the cost of not having
  LinkedIn's vocabulary leak into Meta's code and vice versa.
- `AdDraft` needs its own validation and its own capability record, because ads
  limits differ from organic limits on every platform.
- The existing vault, tenant scoping, audit log and error catalogue are reused
  unchanged. Ads inherit them rather than carrying their own, which was the whole
  argument for putting ads behind this engine instead of a separate project.

## Rejected

- **Reusing `PostDraft` with optional ad fields.** Every consumer would need to
  know which kind it held; the type would stop meaning anything.
- **Floating-point currency.** Convenient and wrong.
- **Exposing platform-native objects directly.** Faster to build, and it would
  put "campaign means two different things" into every caller rather than
  containing it in one adapter.
- **Creating live campaigns with a `paused: false` option.** An option to skip a
  safety rule is the safety rule not existing.
