# 0004 — Instagram has two ways in, and one adapter

**Date:** 2026-09-27
**Status:** accepted

---

## Context

Instagram can be reached two ways, and they are genuinely different integrations:

| | **Facebook Login** (built) | **Instagram Login** (new) |
|---|---|---|
| Authorises via | A Facebook Page | The Instagram account itself |
| Needs a Facebook Page | **Yes** | **No** |
| API host | `graph.facebook.com` | `graph.instagram.com` |
| Credential | The Page token | Its own token |
| Account id | IG account linked to the Page | The IG user id |

Meta's own documentation is explicit: *"This API setup does not require a
Facebook Page to be linked to the Instagram professional account."*

The owner's reason for wanting it is the right one and not obvious from the docs:
**many businesses are Instagram-first.** They created an Instagram business
account directly and never made a Facebook Page. Today those customers cannot
connect at all, and the reason — "you need a Facebook Page you do not want" — is
not one they will accept.

Where a Page *is* already linked, nothing changes: connecting through Facebook
still brings Instagram with it, and asking someone to authorise twice for one
account would be worse.

## The problem this creates

`PublishService` holds `Map<Platform, PlatformAdapter>` — **one adapter per
platform, by construction**. Two Instagram adapters do not fit, and making them
fit would mean platform-specific branching in the publisher, which is the exact
thing the architecture test forbids.

But the two paths need different hosts, so something must tell them apart.

## Decision

**One adapter, which picks its host from the connection.**

The connection already knows which authorisation created it: `providerAuthId`
points at a `ProviderAuth` carrying the provider key. So the domain `Connection`
gains `providerKey`, populated from that existing relation.

**No schema change.** The information was already stored; it simply was not
carried through to the adapter.

`providerKey` is a plain string in core and is never interpreted there. Only the
adapter reads it, so no platform knowledge leaks — the same rule that has held
since the architecture test caught the accounts page hardcoding platform names.

## Why not the alternatives

- **A second `Platform` value** such as `instagram_direct`. It is not a different
  platform; it is the same Instagram account reached differently. A user would
  see two Instagrams in a list and reasonably ask which one is theirs.
- **Inferring the host from the connection's scopes.** Works today, breaks
  silently whenever a scope name changes, and the failure is a request to the
  wrong host that reads like an auth problem.
- **A new column.** The data already exists. A duplicate would be a second source
  of truth to keep in step.
- **A `credentialSource` variant.** That column answers "whose API keys", which is
  the bring-your-own-keys model. Overloading it would conflate two ideas that
  will diverge.

## Consequences

- One more provider (`instagram`), registered exactly as LinkedIn's two apps are.
  The Provider abstraction absorbs this without changes — which is the second
  time it has paid for itself.
- The Instagram adapter branches on host in one place, with the reason stated.
- Tokens differ: an Instagram Login token is long-lived for 60 days and
  **refreshable**, unlike a Page token which does not expire while the app stays
  installed. So this provider implements `refresh` and Meta's does not, and the
  existing refresh runner handles it with no changes.
