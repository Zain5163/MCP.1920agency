# Review of the YouTube / documents build, and the agreed fixes

**Date:** 2026-10-02. Commit reviewed: `7303e89`. Five independent reviewers, each
finding checked by a separate skeptic who tried to refute it. Full findings with
evidence and scratch reproductions:
`C:\Users\RANAZA~1\AppData\Local\Temp\claude\d--My-AI-Works\2e482ace-b0b2-4185-962b-a49ffb3bed17\scratchpad\wf3\result.json`
(confirmed[n] matches #n below).

**Live paths:** no critical or high regression in Facebook, Instagram, LinkedIn
text/image/video or Meta ads. Validation and LinkedIn request sequences were
compared old against new and are identical for existing inputs.

**Constraint for every fix:** no database migration; no quoted platform literal
outside the files the architecture test allows; additive contract changes only.

## Confirmed findings and the fix decided for each

| # | Finding | Decided fix |
|---|---|---|
| 0 | Lost reply to the **final chunk** → transient "nothing was published" → the retry uploads the video **twice** | Track when the final byte range has been sent. From then on no exit may be retryable: throw **permanent** with a new code `YOUTUBE_UPLOAD_UNCONFIRMED` ("the whole video was sent but YouTube's reply was lost; it may already be on the channel — check YouTube Studio before publishing again"). Before giving up on a long Retry-After, ask the session for status once. An abort after the final chunk is treated the same way |
| 1, 2, 8 | The token is never renewed during an upload; a 401 restarts from byte 0; uploads over ~1 h can never finish | Add an optional renewal path that respects "a token exists only inside a callback": `TargetSpec.withCredential(fn)` may hand `fn` a second argument `renew(): Promise<string>`; `PublishContext.renewAccessToken?` carries it to the adapter. The apps build `renew` inside the vault callback from `adapter.refreshCredential` and store the merged credential with `vault.store`. YouTube: keep the current token in a variable; on a 401 during the upload, renew once, ask the **same session** for status (`bytes */total`) and continue from the reported range; a second 401 straight after renewing is a credential failure (`GOOGLE_TOKEN_REVOKED`). Also renew proactively before a chunk once ~45 minutes have passed since the token was obtained. Give the mid-upload 401 a specific code so MCP stops saying "retried automatically" |
| 3 | Connect stores a YouTube channel as ready when **youtube.upload was not granted** | Optional `Provider.missingPermissions?(granted, bundles)`; `GoogleProvider` checks by capability (any of `youtube.upload`, `youtube`, `youtube.force-ssl`, `youtubepartner` allows upload). `connect-provider.ts` refuses before storing anything, prints the missing consent-screen label and the `GOOGLE_SCOPE_NOT_GRANTED` fix |
| 4 | "Declared as AI-generated" and "Title:" shown for Facebook/Instagram/LinkedIn, which never send them | Capability `sendsSyntheticMediaDisclosure` (YouTube only). Approval summaries and CLI output list where the disclosure **is** sent and where it is **not** ("label it in the app"). Validation warning `synthetic_media_not_sent`. Show the title only for platforms that use it |
| 5 | LinkedIn document posts on a member token are reported PUBLISHED although processing was never confirmed | `#awaitDocument` reports whether it confirmed AVAILABLE; when not, the result carries a **notice** ("posted, but LinkedIn did not let this connection read whether the PDF finished processing; check the post shows its pages") |
| 6 | An immediate post with local-only media stores no media rows; a dashboard **Retry** republishes the text **without** the attachment | Fail closed, no migration: mark such targets so they cannot be re-queued without their media (use an existing column if one fits, e.g. a platform code), make `retryTarget` and the worker refuse them with "its attachments were not stored; publish it again from the file", and keep hosted media rows whenever media was hosted anyway |
| 7 | The dashboard shows a private YouTube upload as green **"published"** and hides the notice | A published target that carries a notice is drawn as **"uploaded"** (warn colour) with the notice shown beneath, without a Retry form; `list_posts` says "uploaded" too. No platform literal in `apps/web`: drive it from data (a stored marker or a capability flag) |
| 9 | "A quota error waits for the reset and retries" is false for publish-now; Retry is a dead end there | Correct SETUP.md; MCP must not print "This will be retried automatically" for a publish-now failure; the scheduled-media hint covers publish-now retries |
| 10 | LinkedIn-Content-System PROJECT-CONTEXT says nothing is scheduled (11 are) and points to obsolete next actions | Rewrite the stale lines (owner-facing docs) |
| 11 | Hosted `schedule_post` with media stores no media rows → every hosted media schedule (including YouTube) fails later | Store `media_assets` + `post_media` rows for public-URL media (`r2Key` empty: the file is hosted by the caller) |
| 12 | An MCP client timeout during a long upload → the model re-calls with the same token → a **second video** | Pass the request's abort `signal` into `publish`; make a `publish_post` approval token **single-use per process** (a repeat answers "already sent as post <id>; check list_posts") |

## Lower findings, also fixed

- Network or 5xx failures at Google's token endpoint must be **transient**, so one blip during a refresh never marks a working channel as needing reconnection.
- The Accounts page warns "No provider is registered for linkedin" on every load: skip authorisations whose provider the web app does not register.
- The 2026-10-07-pm document title is 64 characters (LinkedIn's composer shows 58): shorten without changing meaning.
- The worker's 30-minute task limit can stop a long upload; document it (an interrupted upload before the final chunk never creates a video).
- Stale numbers in the status files.

## Refuted

- "No test covers the new approval-payload fields": the tests exist.
