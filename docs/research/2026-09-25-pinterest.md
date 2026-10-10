# Pinterest — the sandbox that reports success

**Date:** 2026-09-25

## ⚠️ The finding that matters

Pinterest has two access tiers, and the lower one is a **sandbox**:

- **Trial access** (what a new app has): pins and boards created through the API
  are sandbox entities **visible only to their creator**.
- **Standard access**: requires a submitted **video** of the app performing a real
  action.

Under Trial access everything reports success. The pin id comes back. The URL
resolves. Nobody else can see the pin.

This is the same shape of danger as LinkedIn's silent text truncation and TikTok's
private-until-audited posts: **the failure mode is a convincing success.** It is
recorded in `capabilities.ts`, in the adapter's file comment and in the roadmap,
because a note in only one place would be missed.

## VERIFIED

- **A pin belongs to a board, not to an account.** One profile has many boards,
  and posting the same pin to all of them is spam rather than reach.
- Therefore **each board is its own connection**, and `platform_account_id` holds
  the board id.
- Text splits into a **100-character title** and an **800-character description**.
  Our drafts have one body, so the first line becomes the title and the rest the
  description — which is how people write anyway.
- OAuth token exchange uses **HTTP Basic**, not a secret in the body. Different
  from every Meta flow, and an easy one to get wrong.
- Refresh uses a **separate refresh token**, unlike Threads which refreshes using
  the access token itself.
- There is **no text-only pin** — hence `minMediaCount: 1`.

## Consequence for the system

Modelling boards as accounts is what forced **account selection to move from
per-platform to per-account**. That change also fixed a pre-existing gap where
three connected Facebook Pages could not be posted to individually.

## NOT CHECKED

Rate limits, video requirements, image dimension minimums.

## Status

Adapter and provider built and unit-tested. Never published for real — no app
credentials yet.
