# Wave 1 Architecture — Social Publisher

**Date:** 2026-09-21
**Status:** agreed, implementation starting
**Scope:** the shape of the system up to and including Wave 1 (Facebook Pages, Instagram,
plus the no-approval platforms). Waves 2–3 must fit this without redesign.

---

## 0. The three decisions that shape everything else

1. **No Docker, no Redis, no local database.** Wave 1 uses hosted Postgres (Supabase
   free tier) and a Postgres-backed job queue. Rationale below.
2. **One Next.js app + one worker process.** Not a microservice split. The seam that
   matters is the *token vault boundary*, and that is enforced by module structure, not
   by network topology.
3. **Secrets live outside this workspace.** Workspace rule: no `.env`, tokens or keys
   inside `D:\My AI Works`. Config is read from `%USERPROFILE%\.social-publisher\.env`.

---

## 1. Why no Docker

Docker Desktop on Windows requires WSL2, ~2 GB, and a reboot, and it would only be
giving us local Postgres and Redis. We need neither:

- **Postgres** — Supabase free tier. This is already the direction recorded in
  `AI-Automation\_archive\Ads-Platform\research\03-security-architecture.md`, so we stay consistent, and
  it is the same database we would deploy to anyway. No local/prod drift.
- **Redis** — not needed at Wave 1. A `jobs` table plus a polling worker with
  `SELECT ... FOR UPDATE SKIP LOCKED` handles scheduled publishing correctly, including
  concurrency, retries and backoff. Redis/BullMQ becomes worth it in the hundreds of
  jobs-per-minute range, which is far beyond Wave 1.

**Revisit when:** we run multiple worker instances and job latency matters, or we add
per-tenant rate-limit fairness. Swapping the queue is a contained change because the
worker only depends on a `JobQueue` interface.

**Carried forward from the inherited security research:** the Supabase Data API must be
**disabled** for the token schema. The browser never talks to Postgres directly.

---

## 2. Component layout

```
source/
  apps/
    web/          Next.js (App Router) — UI + API routes. The only public surface.
    worker/       Long-running Node process. Polls jobs, runs adapters, retries.
  packages/
    core/         Domain: PostDraft, validation, adapter interface, job contracts.
    adapters/     One module per platform. The only code that knows platform APIs.
    vault/        Token custody. Encrypt/decrypt, refresh, per-tenant scoping.
    db/           Prisma schema, migrations, typed client.
    mcp/          MCP server. An HTTP client of the web API. No direct DB access.
```

**Hard import rule:** only `packages/vault` may read the `connections.secret_ciphertext`
column. Adapters receive a short-lived token handed to them; they never query for one.
This is the Ads-Platform "token broker" principle implemented as a module boundary —
cheap now, load-bearing later.

**The MCP server is a client, not a second implementation.** It calls the same HTTP API
the UI calls, authenticated with a local API key. This is why chat and UI can never
drift apart.

---

## 3. Data model (Wave 1)

| Table | Purpose | Key columns |
|---|---|---|
| `tenants` | The account boundary. Owner is tenant #1. | `id`, `name` |
| `users` | App identity — **separate from platform connections**. | `id`, `tenant_id`, `email` |
| `connections` | One connected social account. | `id`, `tenant_id`, `platform`, `platform_account_id`, `display_name`, `secret_ciphertext`, `key_version`, `expires_at`, `scopes`, `credential_source` |
| `posts` | A piece of content, platform-agnostic. | `id`, `tenant_id`, `body`, `media[]`, `created_by` |
| `targets` | One post to one connection. The unit that succeeds or fails. | `id`, `post_id`, `connection_id`, `state`, `scheduled_for`, `platform_post_id`, `error` |
| `jobs` | Queue. | `id`, `target_id`, `run_after`, `attempts`, `locked_at`, `state` |
| `media_assets` | Uploaded files. | `id`, `tenant_id`, `r2_key`, `public_url`, `mime`, `bytes`, `width`, `height`, `duration_s` |
| `audit_log` | Append-only. Who did what, which token, what the platform returned. | `id`, `tenant_id`, `actor`, `action`, `detail` |

Every table carries `tenant_id` from the first migration, including while there is one
tenant. Postgres RLS with `FORCE ROW LEVEL SECURITY` as defence in depth *behind*
mandatory application-layer scoping — never as the primary control.

**`credential_source`** is `platform_app` or `tenant_byo`. This one column is the
bring-your-own-keys pricing model, and it must exist from migration 1.

**Why `posts` and `targets` are separate:** a post to five platforms is one piece of
content and five independent outcomes. Three can succeed while two fail and retry. A
single flat table cannot express that, and "it partly worked" is the normal case.

---

## 4. The adapter interface

```ts
export interface PlatformAdapter {
  readonly platform: Platform
  readonly capabilities: Capabilities

  /** Pure, synchronous, no network. Runs before anything is queued. */
  validate(draft: PostDraft): ValidationResult

  /** Performs the publish. Must be idempotent on idempotencyKey. */
  publish(ctx: PublishContext, draft: PostDraft): Promise<PublishResult>

  /** Only for platforms with expiring tokens. */
  refreshCredential?(current: Credential): Promise<Credential>
}

export interface Capabilities {
  maxTextLength: number
  mediaKinds: Array<'image' | 'video'>
  maxMediaCount: number
  videoMaxSeconds?: number
  aspectRatios?: string[]
  /** Instagram and TikTok fetch media from a public URL; they do not accept bytes. */
  requiresPublicMediaUrl: boolean
  supportsNativeScheduling: boolean
}
```

**`validate` is separate from `publish` and runs first**, at compose time, so the UI can
say "this caption is 40 characters too long for X" before anything is scheduled — not
three hours later in a failed job.

**Capabilities are data, not platform conditionals.** The UI renders constraints by
reading `capabilities`. Adding a platform must not require touching the UI. That is the
standing design test, inherited from Ads-Platform.

---

## 5. Publishing flow

```
compose -> validate(all targets) -> persist post + targets -> enqueue jobs
                                                                  |
worker: claim job (FOR UPDATE SKIP LOCKED)
     -> vault.withToken(connection, token => adapter.publish(...))
     -> success: target.state = published, record platform_post_id
     -> failure: classify -> retryable? backoff + requeue : state = failed, record error
     -> always: audit_log
```

**Error classification is the reliability feature.** Three classes, handled differently:

| Class | Example | Action |
|---|---|---|
| Transient | 5xx, timeout, rate limit | Exponential backoff, retry |
| Credential | token expired or revoked | Attempt refresh once, else mark connection `needs_reauth` and surface in UI |
| Permanent | caption too long, unsupported aspect ratio, policy rejection | Fail immediately, show the platform message verbatim. Never retry. |

Retrying a permanent failure forever is the single most common failure mode in
self-hosted schedulers. Silent failure is why people churn from these tools, so a failed
target must be visible in the UI, not just in a log.

**Idempotency:** every target carries an `idempotencyKey`. A worker crash between
"platform accepted" and "row updated" must not double-post. Where a platform supports a
client-side idempotency token we pass it; where it does not, we check for an existing
`platform_post_id` before re-attempting.

---

## 6. Media

Instagram and TikTok **pull** media from a public HTTPS URL. This makes object storage
mandatory, not a convenience.

- **Cloudflare R2**, public read bucket, custom domain. Chosen for zero egress fees —
  and egress is exactly what a fetch-based publish flow generates.
- Uploads go browser to R2 via presigned URL, never through the app server.
- Media URLs must remain reachable for the whole publish window. Do not clean up an
  asset until every target referencing it is terminal.

---

## 7. What Wave 1 deliberately does not include

Analytics, comment and inbox management, AI caption generation, team roles and approval
workflows, billing. Publishing reliability is the product. These come after it works.

---

## 8. Open questions (CP-0, still unresolved)

1. Does Meta's content-publishing App Review path differ from the ads path, and is it
   faster? Assumed easier — no Marketing API Access Tier second gate, and the tokens
   cannot spend money. **Unverified.**
2. X pay-per-use pricing confirmed against the official X page, not secondary sources.
3. TikTok Content Posting API audit requirements for public (non-private) posting.

None of these block Wave 1 implementation on the owner's own accounts.
