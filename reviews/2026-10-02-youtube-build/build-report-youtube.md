Done: Google sign-in and YouTube publishing are built through all four gated stages. The final gate passed: `pnpm -r build` and `pnpm -r typecheck` (13 of 13 workspaces) are clean, and `pnpm -r test` passes 810 of 810. Nothing was published, uploaded, signed in or called live, no migration was made, `CORE_KEYS` is unchanged, and nothing was committed. Everything is unit-tested against scripted mocks only; none of it has run against Google.

## Test results
| Suite | Before | After |
|---|---|---|
| core | 145 | 165 |
| adapters | 301 | 413 |
| vault | 31 | 40 |
| publisher | 13 | 18 |
| db | 37 | 40 |
| auth | 49 | 49 |
| config | 21 | 21 |
| telemetry | 20 | 22 |
| media | 18 | 18 |
| mcp | 24 | 24 |
| **Total** | **659** | **810** |

- **Flaky reruns:**
  - At the stage-1 gate, two auth timing tests failed under parallel load: "rejecting an unknown user is not measurably faster" and the known "records last use without failing the request". The auth suite alone passed 49/49, and a full rerun was green.
  - At the stage-2 gate, only "records last use…" failed, and the rerun was green.
  - The final gate was green on the first run, and again after my last edits.
- The db and auth suites run against the live Supabase database, as they already did. My new `queue.test.ts` uses a throwaway tenant that it deletes, and its job cannot be claimed by a real worker.

## Files created (under `D:\My AI Works\AI-Automation\Social-Publisher\source\packages\`)
- `adapters\src\google-errors.ts`: D12 mapping, the token-endpoint mapping, the midnight-Pacific quota reset clock, Retry-After parsing.
- `adapters\src\google-provider.ts`: scope bundles, `buildGoogleAuthUrl`, `GoogleOAuth`, `GoogleProvider`, `googleProviderConfigFromEnv`, `registerGoogleProvider`.
- `adapters\src\media-source.ts`: moved out of `linkedin.ts`; LinkedIn's 39 tests pass unchanged.
- `adapters\src\youtube.ts`: `YouTubeAdapter`, `youTubeOptionsFromEnv`, `youtubeTagCharacters`.
- Tests: `adapters\test\youtube.test.ts` (62), `google-provider.test.ts` (29), `google-errors.test.ts` (14), `media-source.test.ts` (7), `db\test\queue.test.ts` (3).

## Files changed
- **core:**
  - `types.ts`: `title`, `syntheticMedia`, `PlatformOverride`, `PublishResult.notice`. `'document'` was not added.
  - `adapter.ts`: `titleMaxLength`.
  - `validate.ts`: `titleForPlatform`, `syntheticMediaForPlatform`, `overridesForStorage`, the `title_too_long` check.
  - `errors.ts`: `code`.
  - `resolutions.ts`: the new codes, plus corrected `QUOTA_EXHAUSTED` text.
  - `capabilities.ts`: the YouTube record (title 100, 12 h / 256 GiB, a preview with the unique label "YouTube Channel", new notes, `verified: false`).
  - Tests: `errors.test.ts`, `resolutions.test.ts`, `validate.test.ts`.
- **vault** `vault.ts` (D14): the refreshed credential is merged, a transient refresh failure is re-thrown without marking anything, `authorisationExpiresAt` is what the expiry column records, and `NeedsReauthError` carries an optional `cause`. No method was added. Plus `vault.test.ts`.
- **publisher** `publish-service.ts`: `code` is passed through (D13); `NeedsReauthError` is reported as credential, using the cause's code and message (D16); the notice is carried through. Plus `publish-service.test.ts`.
- **db:** `queue.ts` adds `touchJob`; `credential-refresh.ts` lets `recordRefreshed` take `Date | null`.
- **telemetry:** `redact.ts` adds `ya29.`, `1//` and `GOCSPX-` patterns, plus `telemetry.test.ts`.
- **adapters:** `provider.ts` (additive), `linkedin.ts` (uses the moved module), `index.ts` (no export-name collisions).
- **apps** (`source\apps\`): `cli\src\connect-provider.ts`, `cli\src\post.ts`, `mcp\src\context.ts`, `server.ts`, `tools.ts`, `worker\src\worker.ts`, `refresh-cli.ts`, `web\src\lib\engine.ts`, `web\src\app\accounts\actions.ts`, `web\src\app\actions.ts`, `web\src\components\AccountManager.tsx`.
- **docs** (`D:\My AI Works\AI-Automation\Social-Publisher\`):
  - `.env.example`: Google and YouTube names; secrets left blank, safe non-secret defaults filled in.
  - `SETUP.md`: the stale Meta redirect fixed to `http://localhost:8787/callback`, with the Live/HTTPS caveat already recorded in WAITING-LIST #17; a new §8 for Google; a status row.
  - `CURRENT-STATE.md`: one row, YouTube marked built and unit-tested, not proven live. I did this because AGENTS.md asks for the status file to be updated.

## Deviations and decisions where the spec was silent
1. **New sixth code `YOUTUBE_WRONG_CHANNEL`** (class credential), so the D11 refusal has its own resolution under R1.
2. **New optional `Provider.noAccountsHint`.** This is my reading of "no channel → `[]` with a clear message path"; the CLI and web print it.
3. **Bundles:** naming none means `['youtube']`. An unknown name throws and lists the real ones. Names are case-insensitive.
4. **Error classes:**
   - `uploadLimitExceeded` is transient, with a 24 h wait; when the limit resets is not documented.
   - Any 403 without a known reason is permanent, not credential.
   - A 401 without a reason is credential, `GOOGLE_TOKEN_REVOKED`.
   - A 401 or 404 in the middle of an upload is transient.
   - A 200/201 with no video id is permanent, so it is never uploaded twice.
5. **Upload loop limits:** at most 5 interruptions in a row (progress resets the count), plus a hard ceiling of 3 × chunks + 20 requests. A Retry-After over 60 s is handed to the worker rather than waited out.
6. **Titles:**
   - A blank title counts as none, and titles are trimmed.
   - Without a title, the first non-blank line is used; if it is too long it is cut at a word with "…", and a warning says so.
   - `<` or `>` in the title or description is an error.
   - A video over 15 minutes gets a warning that the channel must be verified.
7. **Tags and audience:** `PostDraft` has no tags field, so tags are an adapter option that no app sets; nothing sends tags today. "Made for kids" is also an adapter option, default false, not wired to an env variable.
8. **Honest reporting:**
   - A result with a notice prints `UPLOADED` plus `NOTE:` (CLI, both MCP transports, worker log, web message), never "published".
   - The notice is stored in `targets.platform_message`. The target state stays `published`: a separate state needs a migration, and the video id must be recorded to prevent a duplicate upload.
9. **Title and AI disclosure are stored for immediate posts too,** not only scheduled ones (D8 only said scheduled). Otherwise retrying a failed target would lose the AI disclosure.
10. **Web account connect:**
    - Every stored authorisation is searched, and each account records which authorisation found it.
    - The account's credential is stored inside the vault callback.
    - The refresh token and expiry are copied only when the account uses the same token as the authorisation.
    - Side effect: LinkedIn, Threads, Instagram-direct and Pinterest accounts connected from the web now get their 60-day expiry, which they previously did not.
11. **Other vault and refresh behaviour:**
    - A database failure after a successful refresh no longer marks the account dead.
    - Google's 7-day Testing expiry is not reported by Google, so it cannot be recorded.
    - The refresh runner may renew a Google token twice on one pass; harmless.

## Not done
- **D19** is untouched; nothing blocks it.
- **Web composer:** no title or AI-disclosure input. Web uploads use the first line as the title and declare no synthetic media.
- **HTTP MCP `schedule_post`** still stores no media rows, so a YouTube post scheduled that way fails in the worker. That error now explains the cause. A fix needs a design decision because the media table's storage key column is required.
- **Mid-upload token renewal:** the adapter only receives the access token, so an upload that outlives it fails once (transient) and restarts after the vault renews it. An upload needing more than about 55 minutes cannot finish.

## Unverified
- All YouTube and Google behaviour, until it is run live.
- Whether `channels.list` returns no items or 401 `youtubeSignupRequired` for an account with no channel; both are handled.
- Whether chunk uploads re-check the Authorization header.
- How much of a description shows before "…more"; the preview uses 150 characters.
- When a channel's daily upload limit resets.
- Possible pre-existing issue, not checked and not changed: `connect:provider meta` stores the user token's expiry on Page connections. If Meta returns `expires_in`, the vault could refuse those connections after about 60 days. The verified Meta path is `pnpm connect`, not this one.