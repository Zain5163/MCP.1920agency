# 0005 — How customers give us access to their ad accounts

**Date:** 2026-09-28
**Status:** accepted
**Context:** the owner asked, while setting up a System User: *"how people who use
our MCP how they gonna give us access… on one click we can run ads on any ads
account."*

The right question, and the answer is not the thing currently being set up.

---

## Two models, and only one of them scales

### System User token — what is set up today

A System User lives inside **1920 Agency's own** Business Manager. Assets — ad
accounts, Pages, pixels — are assigned to it by hand, and it issues a token that
**does not expire**.

Right for: 1920 Agency's own advertising, and all testing.

Wrong for: customers. It would mean every customer adding us to *their* Business
Manager, creating a System User, generating a token, and pasting a
**non-expiring credential with full spending power** into a form. No customer
should agree to that, and any who did would be taking a risk we should not have
asked of them.

### Facebook Login for Business — what customers use

The customer clicks **Connect**, sees Meta's own dialog listing exactly what is
being granted, picks which ad accounts and Pages to include, and approves. We
receive a token scoped to what they chose. They can revoke it from their own
settings without speaking to us.

This is how every publishing and ads tool does it, and it is the only version a
customer will reasonably accept.

## Decision

**Both, for different purposes.**

- **System User** for 1920 Agency's own accounts and for all development. It is
  simpler, it does not expire, and it needs no review.
- **Facebook Login for Business** for every customer. Same `Provider` contract
  already used for Meta Pages, LinkedIn and Instagram — the Meta provider gains
  ad account discovery alongside Page discovery.

The `Provider` abstraction already does this shape. Nothing structural changes.

## ⚠️ The gate, stated plainly

`ads_management` on **someone else's** ad account requires Meta **App Review**.
There is no way around it and no partial version:

- Business verification of 1920 Agency
- A screencast of the integration actually working
- A written case for why each permission is needed
- Meta's judgement, which can be no

While the app is unreviewed, `ads_management` works **only** on ad accounts where
the authorising person already has a role — which is exactly why the owner's own
account works today and a customer's would not.

**This is the long pole, and it should start as soon as ad creation works end to
end**, because review requires a *working* integration to demonstrate. Building is
the path to access, not the other way round.

## What changes in the code

1. `MetaProvider.discover` also returns ad accounts, not only Pages.
2. Ad accounts are stored like connections are: per tenant, credential in the
   vault, never in the workspace.
3. `MetaAdsClient` takes its account and token per call rather than at
   construction, so one process serves many tenants. **Today it is constructed
   once from environment variables, which is single-tenant by design and must
   change before any customer touches it.**

## What does not change

Everything that makes ads safe is already tenant-agnostic: created paused, the
spend ceiling, the approval token, the audit log, the guardrails. They were built
before the first campaign for exactly this reason.

## Rejected

- **Asking customers for a System User token.** A non-expiring credential with
  full spending power, pasted into a form. Even if a customer agreed, holding it
  would be a liability we chose to take on.
- **Asking for ad account ids and using our own token.** It does not work — Meta
  checks the authorising user's role on that account — and if it did, it would be
  worse.
- **Waiting for App Review before building.** Review needs a working integration
  to demonstrate. The order is fixed by Meta.
