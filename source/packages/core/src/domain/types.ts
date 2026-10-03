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

/**
 * What an attachment is.
 *
 * `document` is a multi-page file, such as a PDF, that a platform shows as pages
 * the reader swipes through: a LinkedIn document post, which is how PDF
 * carousels go out there. Only a platform whose capabilities list it accepts
 * one; every other platform refuses it at validation. The database keeps no
 * kind, only a mime type, so a stored file's kind comes from
 * `mediaKindForMime` (domain/media.ts).
 */
export type MediaKind = 'image' | 'video' | 'document'

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
  /**
   * A title, for platforms that keep one separately from the text, such as a
   * YouTube video. Generic so others with a title (a Pinterest pin, a LinkedIn
   * document) can take it up too. A platform uses it only when its capabilities
   * declare `titleMaxLength`, which is also what tells a UI to show a title
   * field — data, never a platform name — and, where they list
   * `titleMediaKinds`, only on those kinds of post (a LinkedIn document, not a
   * LinkedIn text post). The rest ignore it; `fieldsSentTo` says which send it.
   */
  readonly title?: string
  /**
   * Declares that the media is realistic AI-generated or altered content: a real
   * person shown saying or doing something they did not, altered footage of a
   * real event or place, or a realistic scene that never happened.
   *
   * Generic because YouTube, Meta and TikTok all ask for this disclosure, and
   * omitting it on content that needs it can get a post labelled or removed.
   * But only a platform whose capabilities declare
   * `sendsSyntheticMediaDisclosure` is actually told: today that is YouTube,
   * which is sent an explicit `true` or `false` on every upload, unset meaning
   * `false`. Every other adapter (Facebook, Instagram, LinkedIn, Threads,
   * Pinterest) sends nothing, so a post declared for those gets the
   * `synthetic_media_not_sent` warning, and a summary must say where it was not
   * declared (`fieldsSentTo`).
   */
  readonly syntheticMedia?: boolean
  readonly media: readonly MediaRef[]
  /** Optional per-platform overrides, e.g. a shorter body for X. */
  readonly overrides?: Partial<Record<Platform, PlatformOverride>>
  readonly scheduledFor?: Date
}

/**
 * What one platform may override. Each field falls back to the draft's own
 * value when absent.
 */
export type PlatformOverride = Partial<Pick<PostDraft, 'body' | 'title' | 'syntheticMedia'>>

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
  /**
   * Renews the access token and resolves to the new one, for a publish that
   * outlives its token: a large video can take longer to upload than a Google
   * access token lasts, and a token that runs out mid-upload would otherwise
   * throw away everything sent so far.
   *
   * A function, not a refresh token, because a credential exists only inside
   * the vault's callback. The caller builds this inside that callback, stores
   * the renewed credential before resolving, and it works only while
   * `publish` runs. Absent when the caller cannot renew (no refresh function
   * for this platform, or no refresh token stored), and then an adapter
   * behaves exactly as it did before this existed.
   *
   * Each call is a round trip to the token endpoint, so an adapter calls it
   * when the token has been refused or is about to run out, not before every
   * request. A failed renewal rejects with the refresh error itself, carrying
   * its `failureClass`, so the adapter can tell a dead authorisation from a
   * busy endpoint.
   */
  readonly renewAccessToken?: () => Promise<string>
}

export interface PublishResult {
  readonly platformPostId: string
  readonly url?: string
  readonly raw?: unknown
  /**
   * Set when the platform accepted the post but the outcome is not what
   * "published" would make a reader assume — for example a video uploaded as
   * private because the API project has not passed YouTube's audit.
   *
   * Every surface that reports a result must show this text and must not
   * describe that target as plainly published. A success the customer cannot
   * see is the silent failure this project designs against; the adapter is the
   * only place that knows it happened, so it says so here.
   */
  readonly notice?: string
}

export type TargetState =
  | 'pending'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'needs_reauth'
