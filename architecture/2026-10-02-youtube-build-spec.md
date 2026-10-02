# Build spec: Google connection, YouTube publishing, LinkedIn documents

**Date:** 2026-10-02. **Status:** the spec the build follows. Decisions here
override `google-suite-plan.md` where they differ (each difference is marked).

Read with it:
- `architecture/2026-10-02-provider-adapter-map.md`: the code as it is, with
  file and line references, pitfalls (§9.5) and tests that break (§9.6).
- `research/2026-10-02-youtube-api-facts.md`: verified YouTube and Google OAuth
  facts with sources. UNVERIFIED items stay unverified; code must not rely on them.

Rules that apply throughout: `RULES.md` (R1 every error has a fix, R8 additive
contract changes, R10 platform knowledge only in adapters), the architecture
test (no quoted platform literal such as `'youtube'` or `'x'` outside
`packages/adapters`, `core/src/domain/types.ts`, `core/src/adapters/capabilities.ts`),
Node type-stripping limits (no `enum`, no `namespace`, no constructor parameter
properties, `.ts` relative imports, `exactOptionalPropertyTypes` spread pattern).

**Out of scope, deliberately:** no database migration, no live Google call, no
real upload, no OAuth sign-in, no change to `CORE_KEYS`.

---

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | YouTube bundle = `youtube.upload` + `youtube.readonly` (plus identity `openid email profile`). **Differs from the plan**, which asked for full `youtube` and analytics. Analytics becomes its own later bundle. | `channels.list` and `videos.list` need readonly (upload alone cannot list); full `youtube` ("Manage your YouTube account") is a scarier consent for nothing we use yet |
| D2 | Redirect `http://localhost:8787/google/callback` | the `/<provider>/callback` convention; Google allows localhost for Web clients |
| D3 | Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (optional, default D2), `YOUTUBE_UPLOADS_AUDITED` (default false), `YOUTUBE_DEFAULT_PRIVACY` (default `private`), `YOUTUBE_CATEGORY_ID` (default `22`) | |
| D4 | Every upload sends `privacyStatus`, `selfDeclaredMadeForKids` (false unless asked) and `containsSyntheticMedia` explicitly | defaults are undocumented; YouTube requires the audience setting; AI disclosure is policy |
| D5 | Until `YOUTUBE_UPLOADS_AUDITED=true`, the adapter **forces private** and the result carries a notice saying so. After upload it reads `videos.list?part=status` and reports the privacy YouTube actually applied | Google locks API uploads from unaudited projects to private, with no appeal; never report such an upload as "published" publicly |
| D6 | Title: generic `PostDraft.title?`; per-platform `overrides[p].title`; capability `titleMaxLength`. YouTube uses the title if given, otherwise the first line of the body; the description is the body. | YouTube's title is separate (≤100 chars, no `<` `>`); generic so Pinterest/LinkedIn documents can use it |
| D7 | AI disclosure: generic `PostDraft.syntheticMedia?: boolean`, per-platform override too | YouTube, Meta and TikTok all ask; the AI must set it for realistic AI-generated content |
| D8 | Persistence with **no migration**: scheduled posts store title and syntheticMedia in `Post.overrides` for each target platform; the worker already rebuilds `overrides` (worker.ts:148-152) | |
| D9 | Main YouTube path = **publish now from a local file** (stdio MCP `publish_post`, CLI `post`). Scheduled YouTube through the worker works only when the file fits the media bucket; say so in the error. Native `publishAt` scheduling comes after the audit | storage is size-capped; unaudited uploads are private anyway |
| D10 | Upload = resumable session + chunked PUTs (8 MiB = 32×256 KiB), `redirect: 'manual'`, 308 + `Range` handling, status-check resume on network/5xx (bounded retries), 404 session → transient error so the job retries cleanly | Google's protocol; a 308 is not `ok` |
| D11 | Identity check before upload: `channels.list?part=id&mine=true` must return the connection's channel id | one token reaches one channel; never upload to the wrong one |
| D12 | YouTube errors mapped by `errors[0].reason` in `google-errors.ts` (quota/rate → transient, insufficientPermissions → `GOOGLE_SCOPE_NOT_GRANTED`, accessNotConfigured → `GOOGLE_API_NOT_ENABLED`, youtubeSignupRequired → `YOUTUBE_NO_CHANNEL`, uploadLimitExceeded → `YOUTUBE_CHANNEL_UPLOAD_LIMIT`, 401/invalid_grant → credential/`GOOGLE_TOKEN_REVOKED`) | `classifyHttpStatus` turns every 403 into "credential", which would tell the owner his token expired when he is out of quota |
| D13 | `PublishError.code?: ErrorCode` (optional) so MCP shows the precise resolution; `codeForFailure` uses it first | |
| D14 | Vault: merge refreshed credential; a refresh failure whose `failureClass` is `transient` re-throws without marking needs-reauth; `StoredCredential.authorisationExpiresAt?: Date \| null` written to the column when present | Google access tokens last an hour; without this every connection dies after an hour or on one network blip (map §9.5 #1-3) |
| D15 | All four publish sites pass `adapter.refreshCredential` to `withCredential` (undefined for every other adapter, so no behaviour change) | |
| D16 | `NeedsReauthError` is reported as `credential`, not `permanent` (duck-typed by `name`) | so a dead token shows "reconnect", not "rejected" |
| D17 | Worker heartbeat `touchJob(jobId)` every 60 s while a job runs | a long upload must not be reclaimed and uploaded twice (no idempotency on videos.insert) |
| D18 | Redaction: `ya29.…`, `1//…`, `GOCSPX-…` | never log Google secrets |
| D19 | LinkedIn **document** posts (PDF carousels): `MediaRef.kind` gains `'document'`; LinkedIn capability allows one document, not mixed; adapter uses the Documents API, post `content.media` with `title`; CLI `--document <pdf>` (+ `--title`); worker maps `application/pdf` to `document` | the owner's carousels; no migration (media kind is derived from mime) |

## 2. Contract changes (additive)

- `adapters/src/provider.ts`: `AuthorisedCredential` gains `grantedScopes?`,
  `externalUserId?`, `accountLabel?`, `authorisationExpiresAt?: Date | null`.
  `Provider.authUrl(state, options?: { scopeBundles?: readonly string[] })`.
  `Provider.refreshCredential?(current)`. Keep `refresh?(currentToken)` exactly.
- `core/src/domain/types.ts`: `PostDraft.title?`, `PostDraft.syntheticMedia?`,
  overrides pick `'body' | 'title' | 'syntheticMedia'`; `MediaRef.kind` adds
  `'document'`; `PublishResult.notice?: string`.
- `core/src/adapters/adapter.ts`: `Capabilities.titleMaxLength?`.
- `core/src/domain/validate.ts`: `titleForPlatform`, `title_too_long`, and
  document handling for platforms whose `mediaKinds` include it.
- `core/src/domain/errors.ts`: `PublishError` option and field `code?: ErrorCode`.
- `core/src/domain/resolutions.ts`: full entries for `GOOGLE_SCOPE_NOT_GRANTED`,
  `GOOGLE_API_NOT_ENABLED`, `GOOGLE_TOKEN_REVOKED`, `YOUTUBE_NO_CHANNEL`,
  `YOUTUBE_CHANNEL_UPLOAD_LIMIT`. The private-until-audit case is a notice, not
  an error.
- `vault/src/vault.ts`: D14, without adding a method (`vault.test.ts` checks the
  method set).
- `publisher/src/publish-service.ts`: pass `code`; D16; carry `notice` through.
- `db/src/queue.ts`: `touchJob`.
- `telemetry/src/redact.ts`: D18.
- `core/src/adapters/capabilities.ts` youtube: `titleMaxLength: 100`,
  `maxVideoBytes` 256 GB, `videoMaxSeconds` 12 h, a `preview` with a unique
  `accountLabel`, notes updated (100 uploads/day bucket since 2026-06-01; private
  until audit); `verified` stays documentation-only, not live. LinkedIn: allow
  `document`.

## 3. New adapter files

- `google-provider.ts`: `GOOGLE_SCOPE_BUNDLES`, `buildGoogleAuthUrl`
  (space-joined scopes, `access_type=offline`, `include_granted_scopes=true`,
  `prompt=consent`, `state`), `GoogleOAuth` (exchange: secret in body, read
  `scope` → `grantedScopes`, userinfo `sub` → `externalUserId`, `email` →
  `accountLabel`; **refuse if no refresh_token**; `refreshWithToken` keeps the
  old refresh token; `invalid_grant` → credential), `GoogleProvider` (`key
  'google'`, discover via `channels.list?part=snippet&mine=true`; no channel →
  `[]` with a clear message path; `refreshCredential`).
- `google-errors.ts`: D12.
- `media-source.ts`: `MediaSource`, `fileSource`, `openMedia` moved out of
  `linkedin.ts` and shared (LinkedIn tests guard the move).
- `youtube.ts`: `YouTubeAdapter` (validate D6 + bytes limit on description + tags
  ≤500 total; publish D10, D11, D4, D5; `refreshCredential` when OAuth config is
  given).
- Tests: `google-provider.test.ts`, `youtube.test.ts`, plus LinkedIn document
  tests. Cover: 308→201, chunk alignment, real byte count from stat, token only in
  the header, forced private + notice, quota → transient, insufficientPermissions
  → permanent with code, 401/invalid_grant → credential, scope string format and
  parameters, granted scopes parsed, missing refresh token refused, wrong channel
  refused, transient refresh failure does not mark needs-reauth.

## 4. Apps

- `cli/src/connect-provider.ts`: register google (optional env); `argv` bundles
  passed to `authUrl` and to `requestedScopes`; store `grantedScopes`,
  `externalUserId`, `accountLabel`, authorisation expiry; copy the refresh token
  onto a connection only when the account token is the same token.
- `cli/src/post.ts`: `--title`, `--synthetic`, `--document`; register the
  YouTube adapter; pass refresh fn; print the notice.
- `mcp`: `context.ts` registers the YouTube adapter and passes the refresh fn;
  `server.ts` and `tools.ts` draftShape gain `title` and `syntheticMedia` (in the
  approval payload, so changing either voids the token), describe shows them,
  results print the notice; `codeForFailure` uses `PublishError.code`.
- `worker`: register YouTube; refresh fn; heartbeat; record the notice; map
  `application/pdf` → document.
- `web/src/lib/engine.ts`: register YouTube adapter and google provider
  (optional); `actions.ts` provider-aware `resolveAuth`, pass refresh fn.
- `worker/src/refresh-cli.ts`: register google; store merged credential.

## 5. Owner setup (cannot be done by code)

In Google Cloud project `gen-lang-client-0046538567` (the owner's own/dev use):
OAuth consent screen (External; add himself as test user or publish to
production), **enable YouTube Data API v3**, create an OAuth client of type
**Web application** with redirect `http://localhost:8787/google/callback`, put
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `~/.social-publisher/.env`,
then run `pnpm connect:provider google youtube` in `source/apps/cli`. Testing
status means the connection dies after 7 days; production status ("unverified
app" warning) avoids that for personal use. The YouTube audit form lifts the
private lock.
