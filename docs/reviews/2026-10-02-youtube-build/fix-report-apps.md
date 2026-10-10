All the fixes in my scope are done and committed on `review-fixes`, and the final gate passes. I touched only `apps/*` plus a small change in `packages/db`. I edited no `.md` files, nothing under the live Social-Publisher folder, and nothing called a platform or read the `.env` file.

**You need to run the db suite.** I changed `packages/db`: a new pure file, a change to `retryTarget`, and one new test case in `tenant-isolation.test.ts`. That case type-checks, but I did not run it because it uses the live database.

**Gate: exit 0.** 827 → 893 tests, all passing:

| Package | Before | After |
|---|---|---|
| mcp | 24 | 56 |
| web | none | 13 |
| cli | none | 13 |
| worker | none | 8 |
| core, adapters, vault, config, media, telemetry, publisher | 194, 488, 40, 21, 18, 22, 20 | unchanged |

The architecture test and `next build` pass.

## Fixes

- **#1, #2, #8 — renewal during an upload (`b3e6ffd`).** `credentialFor()` follows the contract the package step set, and is now used at all four sites: `worker.ts:202`, `cli/post.ts:412`, `mcp/context.ts:118`, `web/lib/engine.ts:171`. An app cannot import another app, so the function is copied into each one, each with the same 5 tests against the real vault and publisher.

- **#3 — partial Google grant (`cd15327`).** `connect-provider.ts:263` calls `partialGrantRefusal` (`cli/src/grant-check.ts:25`) straight after the token exchange, before anything is discovered or stored. It prints the missing labels, the `GOOGLE_SCOPE_NOT_GRANTED` fix steps and "Nothing was stored.", then exits 1. 4 tests use the real `GoogleProvider` against a scripted Google.

- **MCP groundwork (`1bcd0b0`).** `publish_post` was written twice, once per transport, and the stdio copy could not be tested. Both transports now share `mcp/src/publishing.ts`, with outside dependencies passed in (`registerTools` takes them as an optional fourth argument).
  - One visible change: a hosted FAILED line now shows the platform's message, as stdio already did.

- **#4 — title and AI declaration per platform (`8166977`).** The approval summary (`publishing.ts:232`) and the CLI output (`cli/src/fields-sent.ts`, used at `post.ts:275`) now say per platform where the title and the declaration are sent, and which platforms do not take a title. Platforms that are not sent the declaration get "NOT declared on …: label it in the app." The `--synthetic` help comment and the tool descriptions are corrected.

- **#7 — "uploaded", not green "published" (`3e9c1bd`).** Every recorder writes a successful publish through `publishedColumns()`. A notice is stored with the code `adspilot:notice` in the `error_code` column, which nothing reads for a published target, so no migration is needed.
  - The dashboard (`web/lib/targets.ts:32`) draws such a target as "uploaded" in the warn colour, shows the notice beneath it, and offers no Retry.
  - `list_posts` (`publishing.ts:515`) lists it as "uploaded".
  - Older published rows that still hold a stale error message are drawn as before.
  - `apps/web` names no platform.

- **#11 — hosted `schedule_post` keeps its media (`1762abe`).** `storeHostedMedia()` (`publishing.ts:173`, called at `tools.ts:253`) writes a `media_assets` and `post_media` row for each public-URL attachment, with an empty `r2Key`. The worker's draft rebuild moved unchanged into `worker/src/draft.ts`; a test shows the stored rows rebuild into a draft YouTube accepts.

- **#6 — no retry without the attachments (`c166fa8`).** A failed target whose post's attachments were not all stored gets the code `adspilot:attachments_not_stored` (`failedColumns`).
  - `retryTarget` refuses it (`tenant-scope.ts:184`), and so does the worker (`worker.ts:151`).
  - The dashboard shows the reason in place of Retry; `list_posts` and the CLI/MCP replies say "publish it again from the file".
  - The CLI (`post.ts:334`) and MCP `publish_post` now store media rows whenever the media was hosted, so those failures stay retryable.

- **#9 — no "retried automatically" (`2ca0826`, `0aef638`).** `publishNowResolution` (`publishing.ts:447`) drops the steps that promise an automatic retry and ends with "call publish_post again after <time>, without confirm". `callFailure` (`:465`) does the same for any tool failure, including a database outage during `publish_post`.

- **#12 — one publish per approval (`d3be021`).** Both transports pass `extra.signal` into the publish (`tools.ts:205`, `server.ts:223`).
  - `mcp/src/approvals.ts` spends a token synchronously when it is accepted. A repeat is answered "already used, for post <id>".
  - Sending the same content again needs a new approval, whose summary says "ALREADY SENT".
  - The reviewers' reproduction is now a real client/server test: a 150 ms client timeout, the upload sees the abort, and the retry with the same token publishes nothing.

- **Lower finding — Accounts page warning (`70913d4`).** `authorisationsToSearch()` (`web/lib/accounts.ts:14`) skips authorisations whose provider the web app does not register. A tenant whose only authorisations are unusable there is no longer told one "expired".

## Not done, and gaps
- **Not unit-tested:** the worker's refusal step and the CLI's wiring in `post.ts` both need the database or the running script, so only the type-checker covers them. The helpers they call are tested.
- **Old failed targets:** targets created before this change carry no mark. Pressing Retry on an old failed immediate post that had a local file can still lose the file. A read-only check of the live database would show whether any exist.
- **Hosted transport cancel:** I did not verify that the hosted HTTP transport aborts `extra.signal` when a client disconnects. The tested path is a client sending a cancellation, which is what Claude Code does over stdio.
- **Outside `apps/`:** YouTube's scheduled-media hint in `youtube.ts`, and MetaProvider's `missingPermissions`.
- **Optional, not done:** MCP progress notifications during uploads.
- **Possible follow-up:** a helper in `packages/vault` would remove the four copies of `credentialFor`.