# 0009 — Free and Premium plans, metered by MCP calls

**Date:** 2026-10-08
**Status:** accepted (owner's decisions). Refines `0007-pricing.md`: the flat
subscription becomes Premium; a free plan is added; credits stay.

## Decision

| | **Free** | **Premium** |
|---|---|---|
| Price | $0 | **$9 a month** (a launch discount toward $6–7 is allowed) |
| MCP calls | **200 a month**, reset on the 1st (UTC) | Unlimited, under a fair-use limit set later from real usage |
| What it can use | Every service: posting, ads, SEO, skills, playbooks | Everything, and every future service |
| Paid third-party extras (AI images, data calls) | Credits at 3× cost (0007) | Credits at 3× cost (0007) |
| Ad spend | Never marked up, never touches our account (0007) | Same |

**What counts as a call:** every MCP tool call, successful or not, except the
free account tools (`check_usage`, the upgrade link and similar), so a user at
the limit can always see where they stand and how to upgrade.

**Usage notices, so the product sells itself.** When a call crosses
**25%, 50%, 75%, 85%, 90%, 95% and 99%** of the free allowance, that call's
result carries a short notice. The server's instructions tell the user's AI to
pass it on in the chat: for example, "You've used 90% of your free calls this
month (180 of 200). Premium is $9/month for unlimited use: <link>." At **100%**
a call returns no work, only the plain message, the reset date and the upgrade
link. Notices are shown once per threshold per month, never on every call.

## Why

- A monthly allowance (not a one-time trial) brings free users back every month
  and shows them the value again; the threshold notices turn that into upgrades.
- Counting calls is simple, honest and visible to the user; counting "tasks" or
  tokens would need explaining.
- Premium at $9 sits inside the owner's $6–10 range and leaves room for a launch
  price.

## Payment provider: Polar (owner's decision, 2026-10-08)

Polar (polar.sh) is the merchant of record: it sells to the customer, handles
sales tax/VAT, and pays out to us. Stripe does not onboard Pakistani businesses
directly, but Polar pays out through Stripe Connect Express, and its supported
payout countries list Pakistan (checked 2026-10-08:
https://polar.sh/docs/merchant-of-record/supported-countries).
`UPGRADE_URL` is set to the Polar checkout once the Premium product exists there;
until then the limit texts say checkout is not open yet. Plan changes come back
from Polar webhooks into `tenants.plan` / `plan_renews_at` (Phase 4).

## Open

- The fair-use limit for Premium (set from the first months of real data).
- Polar's fees and payout schedule, and the account details it needs, confirmed
  when the owner opens the Polar account.
