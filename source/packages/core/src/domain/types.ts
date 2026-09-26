/**
 * Core domain types. Platform-agnostic by design: nothing in this file may
 * reference a specific platform's API shape. Platform knowledge belongs in
 * packages/adapters.
 */

export const PLATFORMS = [
  'facebook_page',
  'instagram',
  'threads',
  'bluesky',
  'mastodon',
  'telegram',
  'discord',
  'youtube',
  'tiktok',
  'linkedin',
  'pinterest',
  'x',
] as const

export type Platform = (typeof PLATFORMS)[number]

/** Where the API credentials for a connection came from. Drives the BYO-keys model. */
export type CredentialSource = 'platform_app' | 'tenant_byo'

export type MediaKind = 'image' | 'video'

export interface MediaRef {
  readonly id: string
  readonly kind: MediaKind
  readonly mime: string
  readonly bytes: number
  /**
   * Publicly reachable HTTPS URL. Instagram and TikTok *fetch* media rather than
   * accepting an upload, so for those platforms this is mandatory and must stay
   * reachable for the whole publish window.
   */
  readonly publicUrl?: string
  /**
   * Local file, for platforms that accept uploaded bytes (Facebook, YouTube,
   * Telegram, Discord). Lets those platforms work before object storage exists.
   */
  readonly localPath?: string
  readonly width?: number
  readonly height?: number
  readonly durationSeconds?: number
}

/**
 * A piece of content, before it is bound to any platform. One draft fans out to
 * many targets.
 */
export interface PostDraft {
  readonly body: string
  readonly media: readonly MediaRef[]
  /** Optional per-platform overrides, e.g. a shorter body for X. */
  readonly overrides?: Partial<Record<Platform, Partial<Pick<PostDraft, 'body'>>>>
  readonly scheduledFor?: Date
}

/** A connected social account. Never carries a secret — see packages/vault. */
export interface Connection {
  readonly id: string
  readonly tenantId: string
  readonly platform: Platform
  readonly platformAccountId: string
  readonly displayName: string
  readonly credentialSource: CredentialSource
  readonly scopes: readonly string[]
  readonly expiresAt?: Date
  readonly needsReauth: boolean
  /**
   * Which provider's authorisation created this connection.
   *
   * Some platforms can be reached more than one way, and the routes are not
   * interchangeable — Instagram via a Facebook Page speaks to a different host
   * than Instagram authorised directly. An adapter needs to know which it is
   * holding.
   *
   * Deliberately an opaque string here: core never interprets it, so no platform
   * knowledge leaks into the domain. Only the adapter reads it.
   */
  readonly providerKey?: string
}

/**
 * A short-lived credential handed to an adapter by the vault. Adapters receive
 * this; they never load one themselves.
 */
export interface Credential {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly expiresAt?: Date
}

export interface PublishContext {
  readonly connection: Connection
  readonly credential: Credential
  /**
   * Stable per-target key. A worker crash between "platform accepted" and
   * "row updated" must not double-post.
   */
  readonly idempotencyKey: string
  readonly signal?: AbortSignal
}

export interface PublishResult {
  readonly platformPostId: string
  readonly url?: string
  readonly raw?: unknown
}

export type TargetState =
  | 'pending'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'needs_reauth'
