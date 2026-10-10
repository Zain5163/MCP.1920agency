# 0001 — MCP-first, no web UI; scope cut after a worth-it review

- **Date:** 2026-09-23
- **Status:** accepted
- **Decided by:** owner, after an explicit "is this worth doing or are we wasting time?" challenge

## Context

The project was drifting toward a full product — web UI, auth, billing, multi-tenant
onboarding — on the assumption that it would be commercialised at $5–7/month. The owner
challenged whether any of this was worth building. That challenge was correct and the
review that followed changed the scope.

## The honest comparison

| Option | Cost | Verdict |
|---|---|---|
| **Mixpost Pro** | $299 one-time, no subscription | Already supports Facebook, Instagram, YouTube, TikTok, LinkedIn, Threads, Pinterest. Works today. |
| **Buffer / Publer** | ~$12–20/month | ~$150–240/year forever. |
| **Build a SaaS competitor** | Months | Entering a market where Postiz is free and AGPL, Mixpost is $299 forever, and Buffer has a decade of distribution. |
| **Build an MCP posting tool** | Days | **Nobody sells this.** Not Buffer, not Mixpost, not Postiz. |

**Conclusion: for posting 1920 Agency's own content cheaply, building is not rational —
Mixpost Pro would win.** The build is only justified by the thing none of them offer:
driving publishing from chat, which is how the owner already works.

## Decision

Build the **MCP tool only**. Specifically:

**In scope**
- MCP server — compose, validate, schedule and publish by instruction from chat
- Facebook Page and Instagram adapters
- Postgres-backed scheduler for future-dated posts
- Multi-tenant schema (`tenant_id` on every table) — it costs one column now and is a
  rewrite to retrofit, so it stays even though there is one tenant

**Out of scope, deferred**
- Web UI. Revisit only after chat-driven posting has been used for a while; the owner
  may find they do not want it.
- Auth, sessions, billing, onboarding, App Review for third-party accounts. All
  speculative until the tool proves itself in daily use.

**Cut entirely**
- **Bluesky.** Proposed as a no-approval platform to prove the publish pipeline. Since
  the Meta app and Business Verification already exist, Facebook can serve that purpose
  directly. Bluesky is also near-worthless as a channel for this audience. This was a
  wasted step, identified by the owner.

## Consequences

- OAuth still needs a browser redirect, so a **temporary localhost listener** is needed
  for a one-time `connect` command. This is not a UI and does not reopen that decision.
- `packages/core` and `packages/vault` (64 tests) are required by every path considered,
  including the Mixpost one. None of that work is wasted.
- If the SaaS is ever revisited, the schema and vault are already correct for it. Only
  the UI and billing layers would be new.

## Revisit when

Chat-driven posting has been in real use for a month and either (a) the owner finds
themselves wanting to click rather than type, or (b) someone outside 1920 Agency asks to
use it.
