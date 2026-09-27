# Meta Conversions API — what it is and why it is worth building

**Date:** 2026-09-28
**Why:** the owner asked what else the Marketing API makes possible. This is the
part with the clearest return, and it is not obvious from the name.
**Sources:** [AdAdvisor](https://adadvisor.ai/blog/meta-conversions-api),
[RoasProof](https://www.roasproof.com/blog/meta-conversions-api-setup-guide),
[Digitized Kosmos on deduplication](https://digitizedkosmos.com/blogs/fix-meta-conversions-api-deduplication-error).
All **reported**, not yet confirmed against Meta's own docs or tested.

---

## The problem it solves

The browser pixel is going blind. iOS tracking prompts, ad blockers, cookie
banners and browser privacy defaults all stop it firing. What that costs is not
just reporting: **Meta optimises toward the conversions it is told about.** Fewer
reported conversions means worse targeting, and it means an ad set takes longer
to reach the ~50 conversions a week it needs to leave the learning phase.

The Conversions API sends the same events **server to server**, where none of that
applies.

This connects directly to the guardrail already in the code: the learning-phase
budget floor is `CPA × 50 ÷ 7`. If a third of conversions never get reported, the
real floor is a third higher than it looks. Conversions API is the cheaper half
of that problem — recover the signal rather than raise the budget.

## How it works

`POST https://graph.facebook.com/v25.0/{pixel_id}/events`, with a batch of events.
Each event carries:

| Field | Notes |
|---|---|
| `event_name` | `Purchase`, `Lead`, `CompleteRegistration`… |
| `event_time` | Unix seconds |
| `action_source` | `website`, `app`, `phone_call`, `system_generated` |
| `event_source_url` | The page it happened on |
| `event_id` | **The deduplication key.** See below |
| `user_data` | Hashed identifiers, plus `fbp`, `fbc`, IP and user agent |
| `custom_data` | `value`, `currency`, `content_ids` |

### ⚠️ Hashing is exact, and a near miss is silent

Identifiers must be **normalised first, then SHA-256 hashed**: trim, lowercase,
strip formatting. Hashing is deterministic, so normalisation that differs from
Meta's by **one uppercase letter** produces a hash that never matches anything.

The field is accepted. The event is accepted. The match simply never happens, and
nothing anywhere says so.

That is the same failure shape this project keeps meeting — Pinterest's sandbox,
TikTok pre-audit, LinkedIn's truncation, Meta's sandbox ad account. **Success that
is not success.** Normalisation belongs in one tested function, never inline.

### ⚠️ Deduplication is not optional

The recommended setup is deliberately **redundant**: the browser pixel *and* the
server both report the same conversion, and Meta discards the duplicate. That is
how coverage survives a blocked pixel.

It only works if both send the **same `event_id`** — one id generated at the
moment the conversion happens, passed to the pixel as `eventID` and to the server
as `event_id`. Get it wrong and every purchase is counted twice, which inflates
reported results and teaches the algorithm the wrong thing.

`fbp` (browser cookie) and `fbc` (click id) are what let a server event be matched
to a browser session at all. They have to be read from the request and passed
through.

## What it would let us build

1. **A conversion endpoint per client.** They call us on a purchase or a lead; we
   normalise, hash, deduplicate and forward. They never touch Meta's API.
2. **Honest attribution in reporting.** Knowing which conversions were
   pixel-only, server-only or both is the difference between a real number and a
   guess.
3. **Better delivery, not just better reports.** More reported conversions is
   directly more signal for the algorithm.
4. **The same shape for other platforms.** LinkedIn's Conversions API and
   TikTok's Events API solve the same problem the same way. One normalised
   conversion event, adapters per platform — exactly the pattern already used for
   publishing.

## What to be careful about

- **It handles personal data.** Emails and phone numbers, even hashed. That is a
  different category from anything this project stores today and needs a
  deliberate decision about retention before a line is written.
- **Hashed is not anonymous.** A hashed email is still a stable identifier for a
  person.
- **Test events first.** Meta provides a `test_event_code` so events can be seen
  arriving without polluting real data. Nothing should go to production without
  it.
- Unverified here: the exact current API version and whether `dataset_id` has
  fully replaced `pixel_id` in the path. Check before building.

## Verdict

Worth building, and it belongs **after** ads creation works end to end, because
it improves campaigns that exist rather than creating them. Recorded as IDEAS L.
