# Architecture map: adding a `google` provider and a YouTube adapter

Read-only survey, 2026-10-02. Nothing was modified. Root: `D:\My AI Works\AI-Automation\Social-Publisher\source`. Inside a section, `file.ts:N` refers to the file named in that section's heading. Annotations inside code blocks marked `←` are mine.

**Test baseline today.** Every unit suite passes: core 145, adapters 301, vault 31, publisher 13, config 21, telemetry 20, media 18. Not run: the db and auth suites (they need a database) and `pnpm -r typecheck`.

**Packages resolve through `dist/`.** Every package has `"main": "./dist/index.js"`, and core's `exports` also points at dist. So the apps, and any test that imports another package (adapters tests import `@social-publisher/core`), only see a source change after `pnpm -r build`. dist was current at 2026-10-02 09:24.

**What YouTube already has:**
- `'youtube'` is in `PLATFORMS` (`packages\core\src\domain\types.ts:15`).
- It is in the Prisma `Platform` enum (`schema.prisma:38`, created by the init migration at line 2), so **no migration is needed**.
- It has a capability record (`capabilities.ts:176-188`).
- MCP's `z.enum(PLATFORMS)` already accepts it.
- `PublishService` currently answers "No adapter is built for youtube yet." (`publish-service.ts:87,143`).
- `provider_auths.provider` is free text, so the key `google` needs no migration either.

**Existing plan and facts.** `D:\My AI Works\AI-Automation\Social-Publisher\architecture\google-suite-plan.md` and `...\research\2026-10-01-google-suite.md`. `WAITING-LIST.md` #15 fixes the redirect as `http://localhost:8787/google/callback`. The plan's §5 step 6 says `/callback/google`, which contradicts the code's `/<provider>/callback` convention.

---

## 1. The Provider contract

### `D:\My AI Works\AI-Automation\Social-Publisher\source\packages\adapters\src\provider.ts`

Exports:
- `DiscoveredAccount` (22-38)
- `AuthorisedCredential` (41-45)
- `Provider` (47-91)
- `registerProvider`, `providerFor`, `allProviders` (93-105): a module-level `Map` keyed by `provider.key`. Registering the same key again replaces the old one silently.
- `flattenAccounts` (108-117): each account, then its `linked` accounts, recursively.

```ts
// provider.ts:22-91, doc comments stripped
export interface DiscoveredAccount { readonly externalId: string; readonly platform: Platform
  readonly displayName: string; readonly accessToken: string; readonly linked?: readonly DiscoveredAccount[] }
export interface AuthorisedCredential {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly expiresAt?: Date
}
export interface Provider {
  readonly key: string                     // ← stored in provider_auths.provider
  readonly displayName: string
  readonly platforms: readonly Platform[]  // ← declared; nothing reads it
  readonly redirectUri: string             // ← the connect CLI takes its port and path from this
  authUrl(state: string): string
  exchangeCode(code: string): Promise<AuthorisedCredential>
  discover(userAccessToken: string): Promise<DiscoveredAccount[]>
  refresh?(currentToken: string): Promise<{ accessToken: string; expiresAt: Date }>   // ← :90
}
```

`DiscoveredAccount.accessToken` is the token copied onto that account's Connection. For Meta it is the Page token. Every other provider reuses the user token.

### LinkedIn, end to end (`...\packages\adapters\src\linkedin-provider.ts`)

- **Scopes.** Member app: `['openid','profile','w_member_social']` (:47). Organisation app: `r_organization_social`, `w_organization_social`, `rw_organization_admin` (:53-57). `linkedInScopes()` picks one set from `organizationAccess` (:94-98).
- **Authorise URL.** `buildLinkedInAuthUrl` (:100-110) sets `response_type=code`, `client_id`, `redirect_uri` and `state`, with scopes **joined by spaces**.
- **Code exchange** (:127-146, through `#form` :228-264). A form POST to `https://www.linkedin.com/oauth/v2/accessToken`, with the client secret **in the body**. It returns `refreshToken` only if LinkedIn sends one, and sets `expiresAt = now + expires_in`.
- **Discovery** (:333-369).
  - Member app: `/v2/userinfo` gives `urn:li:person:{sub}`.
  - Organisation app: `/rest/organizationAcls`, then `/rest/organizations/{id}` per page, giving `urn:li:organization:{n}`. It throws if no pages are found.
  - A 403 on the ACL call is turned into `[]` (:195-200).
  - Every discovered account gets the user token as its `accessToken`.
- **Token lifetime.** 60 days (5,184,000 s), confirmed in the console (capabilities notes; PROJECT-LOG 2026-09-26). A self-serve app is offered no refresh.
- **Two registry keys from one class.** `get key()` returns `'linkedin_page'` or `'linkedin'` (:299-301).
- **The refresh gap** (:148-160):

```ts
   * NOT exposed as `Provider.refresh`, deliberately. That interface hands over the
   * *access* token, and LinkedIn needs a separate refresh token — which it only
   * issues to apps approved for programmatic refresh in the first place. ...
   * Pinterest has the same shape and the same gap.
   */
  async refreshWithToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const data = await this.#form({ grant_type: 'refresh_token', refresh_token: refreshToken })
```

### How the other providers differ

| | Pinterest (`pinterest-provider.ts`) | Threads (`threads-provider.ts`) | Instagram direct / Meta |
|---|---|---|---|
| Scope separator | comma (:60) | comma (:63) | comma. (Google needs **spaces**.) |
| Code exchange | HTTP Basic with app id and secret (:81-111) | secret in the body (:85-103), then a mandatory long-lived exchange (:216-221) | IG: short then long (instagram-provider.ts:95-125). Meta: exchanges twice (meta-provider.ts:47-55) |
| Accounts found | one per **board**; `externalId` is the board id (:204-213) | one profile (:229-241) | IG: one profile. Meta: Pages, each with its linked IG |
| Refresh | `PinterestOAuth.refresh(refreshToken)` exists (:113-136), but `PinterestProvider` has no `refresh`: the same gap as LinkedIn | `refresh(currentToken)` (:207-209) refreshes with the **access** token (`th_refresh_token`, :131-146) | IG direct: same as Threads (`ig_refresh_token`, :239-241). Meta: none |

---

## 2. Where providers are registered and how credentials move

### Registration sites

| File | Lines | Registers |
|---|---|---|
| `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\cli\src\connect-provider.ts` `registerConfigured()` | 72-155 | meta, instagram, threads, pinterest, linkedin, linkedin_page. Each one only when its id and secret are set (`optional()`). |
| `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\web\src\lib\engine.ts` `ensureProviders()` | 73-82 | **meta only**, using `required()` |
| `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\worker\src\refresh-cli.ts` `registerProviders()` | 40-59 | meta (`required`) and threads (`optional`). Instagram direct, Pinterest and LinkedIn are not registered, so their auths are skipped as "no provider registered". |
| apps/mcp | none | no providers at all |

### Callback paths

All callbacks are on port 8787. Each provider uses its own path, taken from its `redirectUri`:

| Provider | Default redirect (connect-provider.ts line) |
|---|---|
| meta | `http://localhost:8787/callback` (:79) |
| instagram | `/instagram/callback` (:97) |
| threads | `/threads/callback` (:107) |
| pinterest | `/pinterest/callback` (:117) |
| linkedin | `/linkedin/callback` (:135) |
| linkedin_page | `/linkedin-page/callback` (:146-149) |
| google (proposed) | `/google/callback` |

### The callback server (`...\apps\cli\src\callback-server.ts`)

- `waitForCallback({port, path, expectedState, timeoutMs})` (37-115) listens on `127.0.0.1` (:107) for one request, and times out after 5 minutes (:109-111).
- Any path other than the expected one gets a 404 (:59-62).
- `error_description` or `error` rejects the wait (:64-70).
- The state check uses `statesMatch` from adapters (:72-78).
- It returns **only `{ code }`** (:90). Google's extra query parameters (`scope`, `authuser`, `prompt`) are ignored, so the granted scopes must come from the token response.
- The error messages say "Facebook" (:68, :83, :110). That is cosmetic.
- **No change is needed for Google.**

### The connect CLI, `main()` (connect-provider.ts:197-338)

1. `providerFor(argv[2])`, then `createState()` (from facebook-oauth).
2. `provider.authUrl(state)` (:214), then `waitForCallback` (:219-223).
3. `exchangeCode` (:236), then `discover(credential.accessToken)` and `flattenAccounts` (:239-240).
4. Zero accounts: exit and store nothing (:242-250).
5. `scopes = requestedScopes(provider)` (:253). These are the **requested** scopes, read back from the `scope` parameter of `authUrl('probe')` (:165-172).

```ts
  const auth = await saveProviderAuth({ tenantId: tenant.id, provider: provider.key,
    externalUserId: discovered[0]!.externalId,     // ← :265, the first ACCOUNT, not the user
    displayName: provider.displayName, secretCiphertext: '', keyVersion: 1, scopes,
    ...(credential.expiresAt !== undefined ? { expiresAt: credential.expiresAt } : {}),
  })
  const authVault = new TokenVault({ kek, keyVersion: 1, store: providerAuthCredentialStore() })
  await authVault.store(auth.id, tenant.id, { accessToken: credential.accessToken,
    ...(credential.refreshToken !== undefined ? { refreshToken: credential.refreshToken } : {}),
    ...(credential.expiresAt !== undefined ? { expiresAt: credential.expiresAt } : {}) })
  // … per account: connection.upsert(… providerAuthId: auth.id, scopes, needsReauth: false) :286-312
    await vault.store(connection.id, tenant.id, { accessToken: account.accessToken,
      ...(credential.expiresAt !== undefined ? { expiresAt: credential.expiresAt } : {}) })  // ← :314-317, no refreshToken
```

`asPrismaPlatform` (:61-63) casts the core `Platform` to the Prisma enum. The two differ: core has `bluesky`, Prisma does not.

### The web app

- `engine.ts`: `publishService` (36-52), `tokenVault` with `prismaCredentialStore` (54-63), `providerFor` calls `ensureProviders()` (84-87), `providerAuthVault` with `providerAuthCredentialStore` (93-104), `listConnections` adds `providerKey` (128-144), `targetFor` (147-155).
- `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\web\src\app\accounts\actions.ts`:
  - `resolveAuth` (61-84) takes `auths.find((a) => !a.needsReauth)` (:63). That is the **first usable ProviderAuth of any provider**, oldest first (`listProviderAuths` orders by `createdAt`).
  - Discovery runs `providerAuthVault().withCredential(auth.id, …, discover)` **with no refresh function** (:97-101, :141-148).
  - `connectAccount` stores only `{ accessToken: account.accessToken }`, with no expiry and no refresh token (:183).
  - The web app has no OAuth callback route. Connecting is CLI-only.

### The refresh runner (refresh-cli.ts)

```ts
  const expired = await expiredProviderAuths()                // ← :73, expires_at < now
  for (const auth of expired) { if (!auth.needsReauth) {
      await markAuthExpired(auth.id, 'the authorisation expired before it could be refreshed') … // ← auth AND all its connections
  // … for each expiring auth (expires_at within 14 days, :85):
      const next = await vault.withCredential(auth.id, auth.tenantId,
        async (cred) => await provider.refresh!(cred.accessToken))   // ← :113-117, no RefreshFn; access token only
      await vault.store(auth.id, auth.tenantId, { accessToken: next.accessToken,
        expiresAt: next.expiresAt })                                  // ← :121-124, refreshToken dropped
      await recordRefreshed(auth.id, next.expiresAt)                  // ← :125
```

A failed refresh only logs a warning. It does not mark the auth needs-reauth (:131-143). Refreshed tokens are **never copied onto the Connection rows**.

### Database helpers (`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\db\src\`)

**`credential-refresh.ts`**
- `expiringProviderAuths(14)`: `expiresAt` not null and within the window, `needsReauth=false` (33-61).
- `expiredProviderAuths()`: `expiresAt < now` (69-91).
- `markAuthExpired`: a transaction marking the auth and all its connections (100-111).
- `recordRefreshed` (114-119).

**`provider-auth.ts`**
- `saveProviderAuth`: upsert on `(tenantId, provider, externalUserId)`. The update path overwrites the ciphertext, scopes and expiry, and clears needs-reauth (29-70).
- `listProviderAuths` (72-98), `findProviderAuth` (101-109), `markProviderAuthNeedsReauth` (111-120).
- `disconnectAccount` and `reconnectAccount` (130-148) only flip `needsReauth`.

**`credential-store.ts`**
- `prismaCredentialStore()` (14-57) reads and writes the `connections` row.
- `providerAuthCredentialStore()` (72-113) does the same against `provider_auths`. Its `save` writes `expiresAt: record.expiresAt` into `provider_auths.expires_at` (:96-103).
- The worker (worker.ts:59-96) and `post.ts` (351-390) each carry their own copy of the connections store.

**`monitor.ts` `checkCredentialExpiry`** (227-258): any expired provider auth is **critical**. Expiry within 7 days is a warning.

### The vault (`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\vault\src\vault.ts`)

- `StoredCredential` (15-20): `{accessToken, refreshToken?, expiresAt?, scopes?}`.
- `CredentialStore` (30-40): `load`, `save`, `markNeedsReauth`.
- `RefreshFn = (current: StoredCredential) => Promise<StoredCredential>` (60).
- Refresh happens 5 minutes before expiry by default (:73).
- `store()` writes the **column** as `expiresAt: credential.expiresAt ?? null` (:89).
- `reviveDates` only revives `expiresAt` (152-156).
- The AEAD binds only `tenantId|keyVersion` (envelope.ts:38-40).

```ts
// withCredential, vault.ts:122-142 (condensed)
    if (this.#isExpiring(credential)) {                       // ← expiresAt − 5 min ≤ now
      if (refresh === undefined || credential.refreshToken === undefined) {
        await this.#store.markNeedsReauth(connectionId, tenantId, 'expired, no refresh available')
        throw new NeedsReauthError(connectionId, 'Credential expired and cannot be refreshed. …') }
      try {
        credential = await refresh(credential)                // ← replaces; does not merge
        await this.store(connectionId, tenantId, credential)
      } catch (cause) {                                       // ← ANY error, transient included
        await this.#store.markNeedsReauth(connectionId, tenantId, 'refresh failed')
        throw new NeedsReauthError(connectionId, 'Credential refresh failed. Reconnect the account.') }
    }
    return await fn(credential)
```

---

## 3. Prisma schema (`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\db\prisma\schema.prisma`)

**Enums**
- `Platform` (31-43): `facebook_page, instagram, threads, mastodon, telegram, discord, youtube, tiktok, linkedin, pinterest, x`. Pinterest was added later with `ALTER TYPE … ADD VALUE`.
- `CredentialSource` (48-51): `platform_app | tenant_byo`. Nothing reads it.

**`ProviderAuth`** (161-191)
- `provider` (free text), `externalUserId`, `displayName?`.
- `secretCiphertext`, `keyVersion`, `scopes String[]`, `expiresAt?`, `needsReauth`, `reauthReason?`.
- `@@unique([tenantId, provider, externalUserId])`.
- `connections Connection[]`.

**`Connection`** (194-230)
- `platform Platform`, `platformAccountId`, `displayName`, `credentialSource @default(platform_app)`.
- Its **own** `secretCiphertext` and `keyVersion`, plus `scopes`, `expiresAt?`, `needsReauth`, `reauthReason?`.
- `providerAuthId String?` with `onDelete: SetNull` (218-222).
- `@@unique([tenantId, platform, platformAccountId])`.

**Other models**
- `Post` (233-251): `body` plus `overrides Json?`. There is **no title column**.
- `MediaAsset` (352-375): `publicUrl String` is required, so scheduled media is always hosted.

**How a Connection that belongs to a ProviderAuth gets its token at publish time: the ProviderAuth is not involved.**

1. Each connection holds an encrypted **copy** of its token, written at connect time (connect-provider.ts:314-317, web actions.ts:183).
2. All four publish paths read `connections.secret_ciphertext` through `TokenVault.withCredential(connection.id, …)`, and **none of them passes a RefreshFn**:
   - mcp `context.ts:97-105`
   - web `engine.ts:147-155`
   - `worker.ts:162-165`
   - `post.ts:293-296`
3. `providerAuthId` is only used to derive `Connection.providerKey`, through `include: { providerAuth: { select: { provider: true } } }` (tenant-scope.ts:51). The **worker omits it** (worker.ts:105, 125-135).

---

## 4. Publishing

### The `PlatformAdapter` contract (`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\core\src\adapters\adapter.ts`)

```ts
export interface PlatformAdapter {            // :98-114
  readonly platform: Platform
  readonly capabilities: Capabilities
  validate(draft: PostDraft): ValidationResult                              // pure, synchronous
  publish(ctx: PublishContext, draft: PostDraft): Promise<PublishResult>    // "Must be idempotent on ctx.idempotencyKey"
  refreshCredential?(current: Credential): Promise<Credential>              // ← declared, called NOWHERE
}
```

`PublishContext` (types.ts:97-106) is `{ connection, credential, idempotencyKey, signal? }`. `PublishResult` (108-112) is `{ platformPostId, url?, raw? }`.

### `PublishService` (`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\publisher\src\publish-service.ts`)

- `TargetSpec` (21-25) is `{ connection, withCredential<T>(fn: (accessToken: string) => Promise<T>) }`.
- `validate` (75-99) runs per platform. A missing adapter produces `unsupported_platform`.
- `publish` (108-122) runs every target with `Promise.all` and splits the results into succeeded and failed.
- `#publishOne` (124-177) refuses a connection that already needs reauth, then:

```ts
      const result = await target.withCredential(async (accessToken) => {
        const ctx = { connection,
          credential: { accessToken },      // ← refreshToken and expiresAt never reach the adapter
          idempotencyKey: options.idempotencyKeyFor(connection.id),
          ...(options.signal !== undefined ? { signal: options.signal } : {}) }
        return await adapter.publish(ctx, draft) })
```

`describeError` (180-199) handles two cases:
- A `PublishError` becomes `{failureClass, message: platformMessage ?? message, platformCode, retryable, retryAfterMs}`.
- **Anything else is `permanent` and not retryable.** That includes `NeedsReauthError`, so the worker records it as `failed`, not `needs_reauth` (worker.ts:208).

### `localPath` versus `publicUrl`

- `validate.ts:169-192`: platforms with `requiresPublicMediaUrl` need an `https://` `publicUrl`. Upload platforms such as YouTube need either `publicUrl` or `localPath`.

| Path | Media it hands the adapter |
|---|---|
| CLI `post.ts` | `toMedia` gives `localPath` and a real `bytes` value from stat (337-349). It uploads to Supabase only when a target requires a public URL **or the post is scheduled** (137-184). |
| Worker | `publicUrl` only, from `media_assets` (worker.ts:137-146) |
| Web | Always uploaded, so `publicUrl` only. Each file is held whole in memory with `file.arrayBuffer()` (actions.ts:113-138). `next.config.mjs` sets `serverActions.bodySizeLimit: '25mb'`. |
| MCP stdio | `localPath` or `publicUrl`, but `bytes: 0` (server.ts:145-158, :392) |
| MCP HTTP | `publicUrl` only, `bytes: 0` (tools.ts:91-101, :428). `schedule_post` (306-363) saves **no media rows**, so the worker later publishes with no media. |

- `MediaStore.uploadFile` reads the whole file into memory (storage.ts:133).

### LinkedIn's chunked video upload, as the model (`...\packages\adapters\src\linkedin.ts`)

- `MediaSource` (86-90) and `fileSource(path, owned)` (96-124) read byte ranges with `handle.read`. A short read throws a transient error. An owned temp file is deleted on `close()`.
- `#openMedia` (444-503):
  - `localPath`: read straight from disk.
  - `publicUrl`: streamed into `tmpdir()/adspilot-<uuid>`, owned so it is deleted afterwards.
  - Neither: permanent error.
  - Both helpers are **module-private**.
- `#uploadVideoFrom` (349-430):
  - Init sends the **real** `source.size` (:355-362).
  - One PUT per range LinkedIn returns, sequential, with each ETag collected, then `finalizeUpload` (:421-427).

```ts
    for (const [index, part] of instructions.entries()) {          // linkedin.ts:376-419 (condensed)
      const chunk = await source.read(part.firstByte, Math.min(part.lastByte, source.size - 1))
      response = await this.#fetch(part.uploadUrl, { method: 'PUT', body: chunk, headers: {
        Authorization: `Bearer ${ctx.credential.accessToken}`, 'content-type': media.mime } /* +signal */ })
      if (!response.ok) throw new PublishError(`LinkedIn rejected video part ${index + 1} …`,
        { failureClass: classifyHttpStatus(response.status), httpStatus: response.status })
      const etag = response.headers.get('etag'); /* missing → transient */ partIds.push(etag)
    }
```

### Every place adapters are registered

Each one is a hard-coded list that calls `required('META_APP_SECRET')`:

| File | Lines |
|---|---|
| `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\mcp\src\context.ts` | 35-44 (shared by the stdio and HTTP transports) |
| `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\worker\src\worker.ts` | 49-56 |
| `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\cli\src\post.ts` | 119-126 |
| `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\web\src\lib\engine.ts` | 40-49 |

```ts
  return new PublishService([                           // worker.ts:49-56
    new FacebookPageAdapter({ apiVersion, appSecret }),
    new InstagramAdapter({ apiVersion, appSecret }),
    new ThreadsAdapter(),
    new PinterestAdapter(),
    new LinkedInAdapter(),
  ])
```

---

## 5. Types and validation (`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\core\src\`)

```ts
export interface PostDraft {                       // domain/types.ts:54-60
  readonly body: string
  readonly media: readonly MediaRef[]
  readonly overrides?: Partial<Record<Platform, Partial<Pick<PostDraft, 'body'>>>>
  readonly scheduledFor?: Date
}
```

- **There is no title field and no per-platform setting other than `body`.** Pinterest takes its title from the first line of the body, capped at 100 characters (pinterest.ts:84-92).
- `MediaRef` (29-48) is `{id, kind:'image'|'video', mime, bytes, publicUrl?, localPath?, width?, height?, durationSeconds?}`.
- `PLATFORMS` is at 7-20. `Credential` (91-95) does include `refreshToken`.
- `Connection` (63-85) includes `scopes` and `providerKey?`. Nothing reads `scopes`.

**The `Capabilities` structure** (adapter.ts:17-46):
- Limits: `maxTextLength`, `mediaKinds`, `maxMediaCount`, `minMediaCount`, `videoMaxSeconds?`, `videoMinSeconds?`, `aspectRatioMin?`, `aspectRatioMax?`, `maxImageBytes?`, `maxVideoBytes?`.
- Behaviour: `requiresPublicMediaUrl`, `supportsNativeScheduling`, `allowsMixedMedia`.
- `preview?: PreviewStyle` (55-84): `label`, `accountLabel`, `accent`, `captionTruncateAt`, `captionPosition`, `mediaFit`, `showsCarouselDots`, `moreLabel`.
- `CapabilityRecord` adds `verified: string|false` and `notes?` (capabilities.ts:17-21).
- The web app reads these through `page.tsx:38-47`, into `Composer`'s `AccountOption` (12-24).

```ts
  youtube: {                                         // adapters/capabilities.ts:176-188
    maxTextLength: 5_000,
    mediaKinds: ['video'],
    maxMediaCount: 1,
    minMediaCount: 1,
    requiresPublicMediaUrl: false,
    supportsNativeScheduling: true,
    allowsMixedMedia: false,
    verified: false,
    notes:
      'Title is a separate 100-char field, not part of the description. Quota is per-project ' +
      'and shared across all tenants: 10,000 units/day at 1,600 per upload is ~6 uploads/day total.',
  },
```

- The YouTube record has **no `preview`**, so the UI falls back to a generic label and accent.
- **The quota note is stale.** Google's `videos.insert` page, checked today, says 100 calls a day in a separate "Video Uploads" bucket at 1 unit each.

**`validateAgainstCapabilities`** (domain/validate.ts:29-199) counts **graphemes** in `bodyForPlatform` (:21-23). The codes it produces:
- `text_too_long`, `media_required`, `too_many_media`, `empty_post`
- `unsupported_media_kind`, `mixed_media`
- `unknown_duration` (warning), `video_too_long`, `video_too_short`, `video_too_large`, `image_too_large`
- `unknown_dimensions` (warning), `aspect_ratio_unsupported`
- `media_not_publicly_hosted`, `media_source_missing`
- `scheduled_in_past`

These lowercase codes are separate from `ErrorCode`. Adapters run this and then add their own rules.

---

## 6. Errors

**`domain/errors.ts`**
- `FailureClass = 'transient'|'credential'|'permanent'` (9-15).
- `PublishError` (17-49) carries `{failureClass, platformMessage?, platformCode?, httpStatus?, retryAfterSeconds?, cause?}`. `isRetryable` is true only for transient.
- `classifyNetworkError` (81-89) walks the `cause` chain looking for ECONNRESET and similar.
- `backoffMs` (110-119) uses full jitter, from 30 seconds up to 6 hours.

```ts
export function classifyHttpStatus(status: number): FailureClass {   // :60-66
  if (status === 401 || status === 403) return 'credential'          // ← YouTube quota and rate errors are 403
  if (status === 429) return 'transient'
  if (status >= 500) return 'transient'
  if (status >= 400) return 'permanent'
  return 'permanent'
}
```

**`domain/resolutions.ts`**
- `ErrorCode` (18-49) has 25 codes:
  - Configuration: `CONFIG_MISSING`, `CONFIG_FILE_ABSENT`, `VAULT_KEY_INVALID`
  - Connectivity: `DB_UNREACHABLE`, `DB_PAUSED`, `PLATFORM_UNREACHABLE`
  - Credentials: `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `SCOPE_MISSING`, `NO_CONNECTION`
  - Content: `TEXT_TOO_LONG`, `MEDIA_REQUIRED`, `MEDIA_NOT_HOSTED`, `MEDIA_UNSUPPORTED`, `VIDEO_TOO_LONG`, `MIXED_MEDIA`, `SCHEDULED_IN_PAST`
  - Platform: `RATE_LIMITED`, `QUOTA_EXHAUSTED`, `PLATFORM_REJECTED`, `MEDIA_PROCESSING_FAILED`, `MEDIA_PROCESSING_TIMEOUT`, `STORAGE_NOT_PUBLIC`, `STORAGE_REJECTED`
  - Internal: `UNKNOWN`
- `Resolution` (51-67) is `{code, what, why, fix[], retryable, needsHuman}`.
- `CATALOGUE: Record<ErrorCode, …>` (69-302), `resolutionFor`, `allCodes` (304-310), `formatResolution` (318-339).
- The plan's proposed codes (`GOOGLE_SCOPE_NOT_GRANTED`, `GOOGLE_TOKEN_REVOKED`, `YOUTUBE_UPLOAD_PRIVATE_UNTIL_AUDIT`, …) are **not added yet**.

**The quality test** (`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\core\test\resolutions.test.ts:10-19`):
- Every code needs `what.length > 10`, `why.length > 20` and at least one `fix` step, each longer than 10 characters.
- `why` must differ from `what` (:22-28).
- `retryable` implies `!needsHuman` (:30-38).
- A union member without a catalogue entry is caught **only by `tsc`**, not by `node --test`.

**How adapters map platform errors**
- `meta-errors.ts:57-80`:
  - Codes 102, 190, 458, 459, 463, 467 are credential.
  - Codes 1, 2, 4, 17, 32, 341, 613 are transient.
  - Codes 3, 10, 200, 283 and 100 are permanent; so is 368, and so is subcode 2069004.
  - Otherwise it falls back to the HTTP status.
  - `graphError` (90-103) uses `platformMessage = error_user_msg ?? message` and `platformCode = "code/subcode"`.
- LinkedIn `#send` (linkedin.ts:529-545) uses `classifyHttpStatus(status)` with `message` and `serviceErrorCode`. Network failures go through `classifyNetworkError`. A failed validation becomes permanent with `platformCode = issue.code`.
- Pinterest has its own envelope (pinterest.ts:146-155).

**How MCP turns failures into resolutions.** It picks a resolution **by failure class only**:

```ts
function codeForFailure(failureClass: string): ErrorCode {   // server.ts:330-334, duplicated at tools.ts:57-61
  if (failureClass === 'credential') return 'TOKEN_EXPIRED'
  if (failureClass === 'transient') return 'RATE_LIMITED'
  return 'PLATFORM_REJECTED'
}
```

**YouTube error facts, from Google's documentation fetched 2026-10-02**
- Envelope: `{error:{code, message, errors:[{domain, reason, message}]}}`.
- **403**: `quotaExceeded`, `rateLimitExceeded`, `userRateLimitExceeded`, `dailyLimitExceeded`, `insufficientPermissions`, `accessNotConfigured`, `forbidden`.
- **401**: `authError`, `required`.
- **5xx**: `backendError`, `internalError`, `notReady`.
- `videos.insert` **400**: `uploadLimitExceeded`, `invalidTitle`, `invalidDescription`, `invalidTags`, `invalidCategoryId`, `invalidPublishAt`, `invalidVideoMetadata`, `mediaBodyRequired`, …
- `videos.insert` **403**: `forbiddenPrivacySetting`, `forbiddenLicenseSetting`.

---

## 7. Architecture tests (`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\core\test\architecture.test.ts`)

```ts
const ALLOWED = [                                              // :31-36
  join('packages', 'adapters'),
  join('packages', 'core', 'src', 'domain', 'types.ts'),
  join('packages', 'core', 'src', 'adapters', 'capabilities.ts'),
  join('apps', 'cli', 'src', 'connect.ts'),                    // ← connect-provider.ts is NOT allowed
]
//  :83-88, for every file outside ALLOWED:
        if (new RegExp(`['"\`]${platform}['"\`]`).test(body)) violations.push(…)
```

**What gets scanned**
- Every `.ts` and `.tsx` file under `packages/` and `apps/`.
- Skipped: `node_modules`, `dist`, `.next`, `.git`, `migrations`, `*.test.ts(x)`.
- Comments are stripped first (:61-63). Note that `//.*$` also cuts any string after `https://`.

**What it forbids**
- **A quoted platform literal** (`'youtube'`, `"x"`, …) anywhere outside the allowed paths. `'YOUTUBE_X'`, `'google'` and URLs are fine.
- In `apps/web`, `===`, `!==` or `includes(` followed by a quoted platform name (:100-118).
- Any quoted platform literal in `publisher`, `db`, `vault`, `media` or `telemetry` (:120-137).

**What it requires**
- Every entry in `PLATFORMS` has a capability record, and every record has a `PLATFORMS` entry (:140-159).
- Each preview has a label, a hex accent, a `moreLabel`, and `0 < captionTruncateAt ≤ maxTextLength` (:161-180).
- Facebook and Instagram have previews, and Instagram truncates earlier than Facebook (:182-202).
- Every preview has a non-empty `accountLabel`, and **no two platforms share one** (:204-225).

**How the codebase gets platform names into apps legally:** exported constants from adapters, such as `PAGE_PLATFORM` (facebook-engagement.ts:346) and `META_REQUIRED_SCOPES` keys (used in monitor-cli.ts:51).

---

## 8. Configuration (`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\config\src\env.ts`)

**How values are read**
- `loadEnv` (57-66) merges `~/.social-publisher/.env` with `process.env`; the process environment wins, and the result is cached.
- `required(key)` throws `ConfigError` (73-83). `optional(key, fallback)` (85-88).
- `CORE_KEYS` (106-112) is `DATABASE_URL, DIRECT_URL, META_APP_ID, META_APP_SECRET, VAULT_MASTER_KEY`. `MEDIA_HOSTING_KEYS` is at 122-126. `checkConfig` is at 135-156.
- Provider environment variables are read **in the apps**, with no central registry.

**OAuth environment names that exist** (`D:\My AI Works\AI-Automation\Social-Publisher\.env.example`)

| Group | Names | Lines |
|---|---|---|
| Meta | `META_APP_ID`, `META_APP_SECRET`, `META_API_VERSION=v25.0`, `META_REDIRECT_URI=http://localhost:8787/callback` | 13-16 |
| Instagram direct | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` | 28-30 |
| Threads | `THREADS_*` | 48-50 |
| Pinterest | `PINTEREST_*` | 55-57 |
| LinkedIn | `LINKEDIN_APP_ID`, `LINKEDIN_APP_SECRET`, `LINKEDIN_REDIRECT_URI`, `LINKEDIN_API_VERSION=202601` | 64-68 |
| LinkedIn page app | `LINKEDIN_PAGE_APP_ID`, `LINKEDIN_PAGE_APP_SECRET`, `LINKEDIN_PAGE_REDIRECT_URI` | 78-80 |
| Google | none yet | |

**`SETUP.md`**
- Covers Meta (§2) and Threads (§6) only. There is no LinkedIn, Pinterest, Instagram-direct or Google section.
- §2 step 5 gives a stale Meta redirect, `http://localhost:3000/api/auth/callback/facebook`. The code defaults to `http://localhost:8787/callback`.
- The §5 env-file template leaves out `DIRECT_URL`.

---

## 9. Recommended insertion points

### 9.1 Contract changes first

All of these are additive (RULES R8).

**`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\adapters\src\provider.ts`**

```ts
export interface AuthorisedCredential {
  readonly accessToken: string; readonly refreshToken?: string; readonly expiresAt?: Date
  readonly grantedScopes?: readonly string[]          // Google token response `scope`; granular consent
  readonly externalUserId?: string                    // OIDC `sub`; a stable ProviderAuth key
  readonly accountLabel?: string                      // e.g. the email, for provider_auths.display_name
  readonly authorisationExpiresAt?: Date | null       // null = no scheduled death (Google app In production)
}
// on Provider:
  authUrl(state: string, options?: { readonly scopeBundles?: readonly string[] }): string
  refreshCredential?(current: { accessToken: string; refreshToken?: string; expiresAt?: Date }):
    Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date }>
```

Keep `refresh?(currentToken: string)` unchanged. Threads and Instagram use it, and `instagram-provider.test.ts:82-94` calls `.refresh('OLD')`.

**`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\vault\src\vault.ts`**

This change is the key to the Google credential lifecycle. Do not add a method: `vault.test.ts:226-233` asserts the exact method set.
- **Merge rather than replace** the refreshed credential. At :131, use `credential = { ...credential, ...(await refresh(credential)) }`. That keeps `refreshToken` and any authorisation expiry the refresher leaves out. Existing tests still pass.
- **Let a transient refresh failure through without marking needs-reauth.** In the catch at :133-139, duck-type it: `if ((cause as {failureClass?: string}).failureClass === 'transient') throw cause`. The vault has no dependency on core, so it cannot import `PublishError`.
- Add `authorisationExpiresAt?: Date | null` to `StoredCredential`. `store()` (:89) should write that value to the column whenever the property is present, and fall back to `expiresAt` otherwise. `reviveDates` (152-156) must revive it too.
- Effect: `provider_auths.expires_at` keeps meaning "when this authorisation dies". The JSON copy still carries the one-hour token expiry, so refresh-on-read keeps working. `credential-refresh.ts`, `monitor.ts` and the refresh runner then need **no change for Google**.

**`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\core\src\` (optional)**
- `domain/types.ts`:
  - `PostDraft.title?: string`, with overrides becoming `Pick<PostDraft, 'body' | 'title'>`.
  - `PublishResult.visibility?: 'public'|'unlisted'|'private'` or `notice?: string`, so a private upload can be reported honestly.
- `adapters/adapter.ts`: `Capabilities.titleMaxLength?`, so the UI renders a title box from data and not from a platform name.
- `domain/validate.ts`: a `titleForPlatform` function and a title check.
- `domain/errors.ts`: `PublishError.code?: ErrorCode`, so MCP can pick a precise resolution. `publish-service.ts:180-199` passes it through; `codeForFailure` (server.ts:330, tools.ts:57) uses it first.
- `domain/resolutions.ts`: `GOOGLE_SCOPE_NOT_GRANTED`, `GOOGLE_TOKEN_REVOKED`, `YOUTUBE_UPLOAD_PRIVATE_UNTIL_AUDIT`, and `GOOGLE_API_NOT_ENABLED` for `accessNotConfigured`. Each needs a full entry, and this file must not contain the quoted literal `'youtube'`.

### 9.2 The Google provider

**New: `D:\My AI Works\AI-Automation\Social-Publisher\source\packages\adapters\src\google-provider.ts`.** Model it on `linkedin-provider.ts`, using the `#fetch` injection pattern.

Endpoints:
- Authorise: `https://accounts.google.com/o/oauth2/v2/auth`
- Token: `https://oauth2.googleapis.com/token`
- User info: `https://openidconnect.googleapis.com/v1/userinfo`

Contents:
- **`GOOGLE_SCOPE_BUNDLES`** (plan §1.1):
  - identity: `openid email profile`
  - the YouTube bundle: `https://www.googleapis.com/auth/youtube.upload`, `.../youtube`, `.../yt-analytics.readonly`
  - Bundle names stay **inside adapters**. Unknown names throw, listing the valid ones.
- **`buildGoogleAuthUrl`**: `response_type=code`, `client_id`, `redirect_uri`, scopes **space-joined**, `access_type=offline`, `include_granted_scopes=true`, `prompt=consent`, `state`. Google's docs confirm the refresh token comes only with `access_type=offline`, and that `http://localhost` redirects are allowed.
- **`GoogleOAuth`**:
  - `exchangeCode`: a form POST with the secret in the body. Read `scope`, use it for `grantedScopes`, and get `sub` from user info.
  - `refreshWithToken`: send `grant_type=refresh_token` and **keep the old refresh token**; Google does not normally return a new one.
  - Map `invalid_grant` to a credential failure. `refresh_token_expires_in` is "only set when the user grants time-based access". Testing-mode tokens die after 7 days with no field telling you so.
- **`GoogleProvider`**:
  - `key 'google'`, `platforms [YOUTUBE]`.
  - `discover` calls `GET https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true` (1 unit) and returns `{externalId: channel.id, platform, displayName: snippet.title, accessToken}`. A 403 `insufficientPermissions` becomes `[]`, as LinkedIn's `organizations()` does.
  - It also has `refreshCredential` and `registerGoogleProvider`.
  - Exported names must not collide under `export *`. `facebook.ts` already exports `DEFAULT_API_VERSION`.

**`...\packages\adapters\src\index.ts`**: export the new files.

**`D:\My AI Works\AI-Automation\Social-Publisher\source\apps\cli\src\connect-provider.ts`**
- In `registerConfigured()`, add a Google block using `optional('GOOGLE_CLIENT_ID')`, `optional('GOOGLE_CLIENT_SECRET')` and `optional('GOOGLE_REDIRECT_URI', 'http://localhost:8787/google/callback')`.
- Read `process.argv.slice(3)` as `scopeBundles`, and pass it to `authUrl` at :214 **and** inside `requestedScopes` (:167). Never compare an argument against `'youtube'`.
- :253: use `credential.grantedScopes ?? requestedScopes(…)`.
- :265-266: use `credential.externalUserId ?? discovered[0]!.externalId` and `credential.accountLabel ?? provider.displayName`.
- :270 and :279: use the authorisation expiry. :331-335: print it.
- :314-317: copy the refresh token only when it belongs to the same token: `...(credential.refreshToken !== undefined && account.accessToken === credential.accessToken ? { refreshToken: credential.refreshToken } : {})`. Also copy `authorisationExpiresAt`. This is generic: Meta Page tokens differ from the user token, so Meta is unaffected.

**`...\apps\web\src\lib\engine.ts` `ensureProviders()` (73-82)**: register Google with `optional()`.

**`...\apps\web\src\app\accounts\actions.ts`**
- `resolveAuth` (61-84) has to be provider-aware. Today it takes the first usable auth of any provider.
- Pass `resolved.provider.refreshCredential` as the 4th argument at :97-101 and :141-148. Without it the vault marks the Google authorisation dead an hour after connecting.
- At :183, copy `cred.refreshToken`, `expiresAt` and `authorisationExpiresAt`.

**`...\apps\worker\src\refresh-cli.ts`**
- Optionally register Google.
- If it ever refreshes a refresh-token provider, store `{ ...cred, ...next }` from inside the callback. :121-124 currently drops `refreshToken`.

**`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\telemetry\src\redact.ts`** (PATTERNS 44-55): add Google token shapes: `ya29.…` access tokens, `1//…` refresh tokens and `GOCSPX-…` client secrets. Key names are already covered.

**Documentation:** `D:\My AI Works\AI-Automation\Social-Publisher\.env.example` (add the `GOOGLE_*` names), `...\SETUP.md` (a Google section, and fix the stale Meta redirect), and the project context files after the work, per AGENTS.md.

**Do not touch `CORE_KEYS`.** `config\test\env.test.ts:102-115` expects only the five core keys to be required.

### 9.3 The YouTube adapter

**New: `D:\My AI Works\AI-Automation\Social-Publisher\source\packages\adapters\src\youtube.ts`**

- `readonly platform: Platform = 'youtube'`; `capabilities = CAPABILITIES.youtube`.
- **Options:** `fetch?`, `oauth?: {clientId, clientSecret}` (for `refreshCredential`), `privacy?` (default `'private'`), `audited?` (false forces private), `chunkBytes?` (a multiple of 262,144), `categoryId?`, `notifySubscribers?`.
- **`validate`:** the shared check, plus title (first line of the body, or `draft.title`) of 1-100 characters with no `<` or `>`, and a description of **at most 5,000 bytes** with no `<` or `>`. Google documents the description limit in bytes; the capability limit counts graphemes. Tags total at most 500 characters.
- **`publish`:**
  1. Optionally check identity: `channels?part=id&mine=true` must return `ctx.connection.platformAccountId`. A token reaches exactly one channel, and the API has no channel parameter.
  2. Open the media with LinkedIn's approach. Use the **stat size**, never `MediaRef.bytes`.
  3. Start a session: `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` with `Authorization`, `Content-Type: application/json; charset=UTF-8`, `X-Upload-Content-Length` and `X-Upload-Content-Type` (`video/*` or `application/octet-stream`). The session URI comes back in `Location`.
  4. PUT chunks to it with `Authorization` and `Content-Range: bytes a-b/total`. Every chunk except the last is the same size and a multiple of 256 KB. **A `308` with `Range: bytes=0-N` means "continue"**. `201` returns the video resource. Retry 500/502/503/504 by sending `Content-Range: bytes */total` and resuming. A `404` means the session expired; start again.
  5. Return `{ platformPostId: id, url: https://www.youtube.com/watch?v=id, visibility/raw: privacyStatus }`.
- `publishAt` is only allowed with `private`.
- **`refreshCredential(current)`**: `GoogleOAuth.refreshWithToken(current.refreshToken)`, preserving the refresh token.

**New: `...\packages\adapters\src\google-errors.ts`**, built like `meta-errors.ts`. Mapping by `errors[0].reason`:

| Reason | Class | Resolution |
|---|---|---|
| `quotaExceeded`, `dailyLimitExceeded` | transient | `QUOTA_EXHAUSTED`, with `retryAfterSeconds` set to the quota reset. Google states midnight Pacific; verify. |
| `rateLimitExceeded`, `userRateLimitExceeded`, 5xx | transient | |
| `uploadLimitExceeded` (a 400) | not permanent-malformed: the channel's own upload limit | |
| `insufficientPermissions` | permanent | `GOOGLE_SCOPE_NOT_GRANTED` |
| `accessNotConfigured` | permanent | API not enabled |
| `forbidden*`, `invalid*`, `mediaBodyRequired` | permanent | |
| 401 `authError` or `required`; token-endpoint `invalid_grant` | credential | |

**Optional: `...\packages\adapters\src\media-source.ts`.** Extract `MediaSource`, `fileSource` and `#openMedia` from `linkedin.ts` (86-124, 444-503). LinkedIn's tests (linkedin.test.ts:187-233, 461-600) guard the move.

**`D:\My AI Works\AI-Automation\Social-Publisher\source\packages\core\src\adapters\capabilities.ts` youtube record (176-188)**
- Keep `mediaKinds: ['video']`. `validate.test.ts:152-159` depends on it.
- Update the notes: 100 uploads a day in their own bucket, and every upload is **private until the audit passes** for projects created after 2020-07-28.
- Add a `preview` with a **distinct** `accountLabel`, e.g. `'YouTube Channel'`, and `captionTruncateAt` no higher than 5,000.
- Consider `maxVideoBytes` (256 GB per the docs).

**Wire the adapter into each app.** Add `new YouTubeAdapter({...optional Google config, privacy from env})` at:
- `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\mcp\src\context.ts:35-44`
- `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\worker\src\worker.ts:49-56`
- `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\cli\src\post.ts:119-126`
- `D:\My AI Works\AI-Automation\Social-Publisher\source\apps\web\src\lib\engine.ts:40-49`

Read the settings with `optional()`, never with a `'youtube'` literal. Name variables like `YOUTUBE_UPLOAD_PRIVACY`, which do not match the test's pattern.

**Pass a refresh function at all four `withCredential` sites.** These are `context.ts:100-103`, `engine.ts:150-153`, `worker.ts:162-165` and `post.ts:293-296`:

```ts
  const adapter = publishService().adapterFor(connection.platform)   // worker/cli: service.adapterFor(…)
  await tokenVault().withCredential(connection.id, connection.tenantId,
    async (cred) => await fn(cred.accessToken),
    adapter?.refreshCredential?.bind(adapter))     // undefined for every other adapter: no behaviour change
```

**Report private uploads honestly.** These places print or record "published" for any success:
- `worker.ts:177`, `worker.ts:185`
- `server.ts:270-272`
- `tools.ts:295-297`
- `post.ts:324-327`
- `actions.ts:236-243`

**If `title` is added**, it has to reach:
- the MCP `draftShape` (server.ts:135-159, tools.ts:81-102)
- **the approval payloads**, so a title edit voids the approval token (server.ts:234-240, tools.ts:234-238)
- both `buildDraft` functions
- a CLI `--title` flag
- the web `Composer` (driven by `titleMaxLength`) and `actions.ts:71-77`
- persistence: `posts.title` (a migration) or the overrides JSON, so the worker can rebuild it (worker.ts:148-153).

**Long uploads and the job lock.** Keep long uploads locked, so another worker run cannot start a second upload of the same job: add a `touchJob(jobId)` in `D:\My AI Works\AI-Automation\Social-Publisher\source\packages\db\src\queue.ts`, called from a timer in `worker.ts` around :157-169. The alternative is a longer `reclaimStale` window.

**New test files:** `...\packages\adapters\test\youtube.test.ts` and `google-provider.test.ts`, built on `mockLinkedIn` (linkedin.test.ts:31-61). Cover:
- a 308 then a 201
- chunk alignment
- the real byte count
- the token sent only in the header
- forced private
- quotaExceeded is transient; insufficientPermissions is permanent; 401 and `invalid_grant` are credential
- space-separated scopes, `access_type`, `include_granted_scopes`, `prompt`
- granted scopes parsed from the token response
- `[]` when the scope is missing.

### 9.4 Migrations

None are needed for `google` or `youtube`. A migration is needed only for:
- a `posts.title` column
- the plan's `ProviderAsset` table
- `google_business_profile`, which must be added to the Prisma enum, `PLATFORMS` **and** `CAPABILITIES` together, or the architecture and type checks fail
- a new target state such as `published_private`.

### 9.5 Pitfalls

1. **Without the vault fix, the hourly expiry kills every YouTube connection.** If `provider_auths.expires_at` holds the one-hour access-token expiry:
   - the refresh runner's first pass (refresh-cli.ts:73-83) calls `markAuthExpired`, disabling the auth and all its connections;
   - `checkCredentialExpiry` (monitor.ts:227-243) raises a critical alert on every run.
2. **Copied connection tokens die after an hour.** They have no refresh token (connect-provider.ts:314-317, actions.ts:183), and no publish site passes a refresh function. The vault then marks them `'expired, no refresh available'`.
3. **The vault treats any refresh error as fatal.** It marks needs-reauth even on a network blip (vault.ts:133-139). With hourly refreshes, one blip disables the channel.
4. **`NeedsReauthError` is reported wrongly.** It is not a `PublishError`, so it is reported as `permanent`. The target becomes `failed`, not `needs_reauth`, and MCP shows `PLATFORM_REJECTED` (publish-service.ts:194-198, worker.ts:208).
5. **Quota and rate limits become "token expired".** Every YouTube 403, including quotaExceeded and rateLimitExceeded, is classed as `credential` by `classifyHttpStatus`. The worker parks the target, and MCP tells the user their token expired. Use the Google error mapper.
6. **A 308 is not `ok`.** A LinkedIn-style `if (!response.ok) throw` kills every upload with more than one chunk. With no `Location` header, fetch returns the 308 as it is; using `redirect: 'manual'` makes that explicit.
7. **The token can expire mid-upload.** `withCredential` hands over one token, refreshed only when it is within 5 minutes of expiry, and Google's docs send `Authorization` on every PUT. A long upload can outlive the token. Use a longer `refreshSkewMs`, or treat a 401 mid-upload as transient.
8. **Long uploads can be duplicated.** Jobs locked for more than 15 minutes are re-queued (queue.ts:68). The worker is a one-shot task every 5 minutes and reclaims at startup (worker.ts:234). `videos.insert` has no idempotency key, so a second worker run during a long upload makes a duplicate video.
9. **Who a Google authorisation belongs to.** `provider_auths` is unique on `(tenant, provider, externalUserId)`, and connect uses `discovered[0].externalId`. Whether a Brand Account channel yields a different `sub` is **UNVERIFIED**. Upserting over the wrong row would point channel A's connection at channel B's token, which is why the adapter's identity check is recommended.
10. **Requested is not granted.** Connect stores the requested scopes (:253), but granular consent lets people untick some. Use `grantedScopes`.
11. **A re-consent can lose the refresh token.** A re-consent without `prompt=consent` may return none, and connect-provider.ts:276-280 would then overwrite the stored one with nothing. Always send `prompt=consent`, and fail loudly if no refresh token comes back.
12. **Don't name platforms in app code.** Bundle names and CLI arguments must never be compared with `'youtube'` outside adapters. The literal `'x'` is also a platform name, so any quoted `'x'` in app code fails the test.
13. **Node's type stripping is strict.** It rejects `enum`, `namespace` and constructor parameter properties; use `#private` fields as the code already does. Relative imports need `.ts`. `exactOptionalPropertyTypes` requires the `...(v !== undefined ? {v} : {})` pattern.
14. **Media limits on the way in.** The web limits a request body to 25 MB and buffers files in memory. `MediaStore` buffers whole files. Scheduled media always goes through Supabase, so check the bucket's per-file limit. MCP HTTP's `schedule_post` stores no media, so a scheduled YouTube post fails `media_required`.
15. **The worker's connections lack `providerKey`** (worker.ts:125-135). Don't make the adapter depend on it.
16. **Unverified facts.**
    - Whether `channels.list(mine=true)` works with only `youtube.upload` granted. The plan's bundle includes `youtube`.
    - The default for "made for kids".
    - Whether a title is required on insert.
    - The 15-minute length limit for unverified channels.
17. **Stale catalogue text.** `QUOTA_EXHAUSTED` says Instagram allows 50 posts a day; the capability notes say 100. The YouTube quota note is also stale.

### 9.6 Tests that will break if changed naively

| Test | Breaks if |
|---|---|
| `core\test\architecture.test.ts` | a platform literal is added outside adapters; YouTube gets a preview whose label duplicates another platform's; `captionTruncateAt` exceeds `maxTextLength` |
| `core\test\validate.test.ts:152-159` | `mediaKinds` for YouTube changes |
| `core\test\resolutions.test.ts` | a new catalogue entry is thin. A code missing from the catalogue fails only under `tsc` |
| `adapters\test\instagram-provider.test.ts:82-94` | the `Provider.refresh` signature changes |
| `vault\test\vault.test.ts:226-233` | `TokenVault` gets a new method. The existing refresh tests (104-221) still pass with the merge and transient changes in 9.1 |
| `config\test\env.test.ts:102-115` | Google keys are added to `CORE_KEYS` |
| `publisher\test\publish-service.test.ts` | the `TargetSpec` shape changes. It uses `'tiktok'` as the unsupported platform, so YouTube is safe |

**Order of work:** change core, then `pnpm -r build`, then adapters and their tests, then build again, then the apps. Finish with `pnpm -r typecheck` and `pnpm -r test`.