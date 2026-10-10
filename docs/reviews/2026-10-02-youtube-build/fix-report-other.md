All three package-side fixes in my scope are done and committed on `review-fixes`, and the final gate passes. I didn't touch `apps/*`, `packages/db`, `packages/auth` or the live copy, and no test calls a real platform.

**Gate:** exit 0. 799 → 827 tests, all passing: core 181 → 194, adapters 473 → 488; config 21, vault 40, media 18, telemetry 22, publisher 20 and mcp 24 are unchanged. The db suite does not need a run for this step.

**Checked against the old code:**
- **#5:** four of the LinkedIn tests fail on the old adapter, on their assertions.
- **#3 and #4:** the new tests fail on the old code only because the new exports don't exist yet. I did not run them against the old behaviour assertion by assertion.

## Finding #5: LinkedIn document posts (`9bb760b`)
- **Fix:** `linkedin.ts:690` `#awaitDocument` now resolves `true` only when LinkedIn reports the document AVAILABLE. When the status can't be read, the post still goes out after the pause, as the agreed fix keeps it, but the result carries a notice (`DOCUMENT_UNCONFIRMED_NOTICE`, :122, attached at :376). Unreadable covers a 403 for a member token, an empty reply, a 5xx partway through polling, and a dropped connection.
- **Unchanged:** text, image and video posts, and documents seen AVAILABLE, have no notice.
- **Notes:** the LinkedIn capability notes now mention the notice.
- **Tests (`linkedin.test.ts`):**
  - The existing 403 and 15-second tests now assert the notice.
  - New cases cover a 500 after PROCESSING and a network error.
  - The AVAILABLE and image cases assert there is no notice.

## Finding #3: Google partial grant (`fa2cb9e`)
- **Contract:** `provider.ts:170` adds the optional `missingPermissions?(granted, scopeBundles): readonly string[]`.
- **Google:** `google-provider.ts:119` `GOOGLE_BUNDLE_PERMISSIONS`, `:166` `missingGooglePermissions`, `:532` the provider method. Bundle names are read exactly as when signing in, through a shared `requestedBundles`.
  - Upload is allowed by any of youtube.upload, youtube, youtube.force-ssl or youtubepartner ("Manage your YouTube videos").
  - **One addition beyond the agreed fix:** read access is checked the same way, by any of youtube.readonly, youtube, youtube.force-ssl or youtubepartner ("View your YouTube account"). Every upload checks the channel with channels.list first, which needs read access.
  - Identity scopes are not checked.
- **Tests:** 9 in `google-provider.test.ts`, including the reviewers' scenario: an exchange without upload access still discovers the channel, so only this check refuses it.

## Finding #4: AI declaration and title (`a7f123c`)
- **Capabilities** (`adapter.ts:36`, `:49`):
  - `sendsSyntheticMediaDisclosure` is set only on the YouTube record (`capabilities.ts:184`).
  - `titleMediaKinds` is a new field I added so a summary can tell that LinkedIn titles only document posts; it is set to `['document']` on LinkedIn (`:253`).
- **Validation** (`validate.ts`):
  - A new warning, `synthetic_media_not_sent` (:206), tells the owner to label the post in the platform's app.
  - `title_too_long` is now checked only where the title is actually sent (:185), so a LinkedIn text, image or video post is validated as it was before documents existed.
- **Helpers for the apps:** `titleIsSent(draft, caps)` (:63) and `fieldsSentTo(draft, platforms, capabilitiesOf?)` (:101), which returns `{ titles: {platform, title}[], disclosedTo, notDisclosedTo }`. Each platform appears once.
- **Comments:** the `PostDraft` comments in `types.ts` no longer claim every adapter sends the declaration.
- **Tests:**
  - 13 in `core/test/validate.test.ts`.
  - New `adapters/test/synthetic-media.test.ts`: Facebook, Instagram, LinkedIn text and LinkedIn image send identical requests with or without the declaration and title, which ties the capability to real adapter behaviour.
  - A YouTube assertion in `youtube.test.ts`.

## What the apps step must call
- **#3, `cli/src/connect-provider.ts`:** right after `exchangeCode` (:258), and before `discover`/`saveProviderAuth`:
  ```ts
  const missing = credential.grantedScopes !== undefined ? (provider.missingPermissions?.(credential.grantedScopes, scopeBundles) ?? []) : []
  ```
  If `missing` is not empty, print the labels and `RESOLUTIONS.GOOGLE_SCOPE_NOT_GRANTED.fix`, then "Nothing was stored.", `await disconnect()` and `process.exit(1)`. This mirrors the Meta check in `connect.ts:76-84`.
- **#4, the approval summary and CLI output** (`mcp/src/server.ts:270,275`, `mcp/src/tools.ts:271,276`, `cli/src/post.ts:262-263`): build `const sent = fieldsSentTo(draft, chosen.map((c) => c.platform))` (in the CLI, `platforms`).
  - Show `Title` only for `sent.titles`, per platform.
  - Print "Declared as realistic AI-generated or altered media on: …" for `sent.disclosedTo`.
  - Print "NOT declared on …: not sent through their API; label it in the app." for `sent.notDisclosedTo`.
  - Keep `title` and `syntheticMedia` in the approval payload.
  - Correct the `--synthetic` help comment at `post.ts:41-42`.
  - Optionally, the web app can use `titleIsSent` to show the title field for LinkedIn only when the post has a document.
- **#5:** no app change. The worker, CLI, web and MCP already show UPLOADED with the note when a notice is present; the dashboard's display of notices is finding #7.

## Not done
- **Meta through `connect:provider`:** `MetaProvider` doesn't implement `missingPermissions`, so a partial Meta grant made that way is still not checked. This gap was already there; `pnpm connect` (connect.ts) has its own check.
- **Docs:** status and context files are left for the docs step.