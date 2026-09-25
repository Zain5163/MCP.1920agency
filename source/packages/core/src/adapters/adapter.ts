import type {
  Credential,
  MediaKind,
  Platform,
  PostDraft,
  PublishContext,
  PublishResult,
} from '../domain/types.ts'

/**
 * What a platform can accept. This is DATA, not conditionals.
 *
 * The standing design test for this project: adding a platform must not require
 * touching the UI. The UI renders limits by reading Capabilities, so any
 * `if (platform === 'instagram')` in a component is a design failure.
 */
export interface Capabilities {
  readonly maxTextLength: number
  readonly mediaKinds: readonly MediaKind[]
  readonly maxMediaCount: number
  /** Minimum media required. Instagram cannot post text alone, so this is 1. */
  readonly minMediaCount: number
  readonly videoMaxSeconds?: number
  readonly videoMinSeconds?: number
  /**
   * Accepted width/height range. Instagram rejects anything outside 4:5 (0.8)
   * to 1.91:1 at container creation, with an error that reads like a permissions
   * problem rather than a shape problem.
   */
  readonly aspectRatioMin?: number
  readonly aspectRatioMax?: number
  readonly maxImageBytes?: number
  readonly maxVideoBytes?: number
  /**
   * Instagram and TikTok fetch media from a public HTTPS URL rather than
   * accepting bytes. Drives whether a target may publish before its media has
   * finished uploading to object storage.
   */
  readonly requiresPublicMediaUrl: boolean
  /** Whether the platform itself can hold a future-dated post. */
  readonly supportsNativeScheduling: boolean
  /** Mixing images and video in one post. Most platforms disallow it. */
  readonly allowsMixedMedia: boolean
}

export interface ValidationIssue {
  readonly severity: 'error' | 'warning'
  readonly code: string
  readonly message: string
  readonly platform: Platform
}

export interface ValidationResult {
  readonly ok: boolean
  readonly issues: readonly ValidationIssue[]
}

export interface PlatformAdapter {
  readonly platform: Platform
  readonly capabilities: Capabilities

  /**
   * Pure and synchronous — no network, no I/O. Runs at compose time so the UI can
   * report "40 characters too long for X" immediately, rather than three hours
   * later in a failed job.
   */
  validate(draft: PostDraft): ValidationResult

  /** Must be idempotent on ctx.idempotencyKey. */
  publish(ctx: PublishContext, draft: PostDraft): Promise<PublishResult>

  /** Only implemented by platforms whose tokens expire. */
  refreshCredential?(current: Credential): Promise<Credential>
}
