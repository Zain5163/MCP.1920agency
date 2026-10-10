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
  /**
   * Present only on platforms that keep a title apart from the text, and the
   * most characters it may have. A UI shows a title field when this is set, so
   * a new titled platform needs a number here rather than a branch on its name.
   * Absent means `PostDraft.title` is ignored for this platform.
   */
  readonly titleMaxLength?: number
  /**
   * The kinds of post that carry the title, where only some do; a post carries
   * it when it has media of one of these kinds. Absent means every post on a
   * titled platform carries it.
   *
   * LinkedIn titles a document post and nothing else. Without this, a title
   * on its text, image or video post was shown in approval summaries and held
   * to a length limit although it is never sent. `titleIsSent` reads it, so
   * summaries and validation follow the rule the adapter applies.
   */
  readonly titleMediaKinds?: readonly MediaKind[]
  /**
   * Whether publishing here tells the platform that the media is realistic
   * AI-generated or altered (`PostDraft.syntheticMedia`). True only where the
   * adapter really sends that declaration through the API; absent means it
   * sends nothing, whatever the platform's own app offers.
   *
   * Approval summaries once said "Declared as realistic AI-generated or
   * altered media" for every target, while only YouTube was told. A post
   * declared for a platform without this gets the `synthetic_media_not_sent`
   * warning, and `fieldsSentTo` lists where the declaration goes and where it
   * does not, so the owner can label it in the app instead.
   */
  readonly sendsSyntheticMediaDisclosure?: boolean
  readonly mediaKinds: readonly MediaKind[]
  readonly maxMediaCount: number
  /** Minimum media required. Instagram cannot post text alone, so this is 1. */
  readonly minMediaCount: number
  readonly videoMaxSeconds?: number
  readonly videoMinSeconds?: number
  /**
   * Accepted width/height range for IMAGES (and any other non-video kind).
   * Instagram rejects a feed image outside 4:5 (0.8) to 1.91:1 at container
   * creation, with an error that reads like a permissions problem rather than a
   * shape problem.
   *
   * WHY images only (2026-10-11): a platform's video range is usually a
   * different one. Instagram's feed-image range was applied to every kind, so a
   * 9:16 Reel with known dimensions (0.56:1) was refused, while Meta documents
   * Reels as 0.01:1 to 10:1 (ig-user/media reference, checked 2026-10-11).
   * Video has its own `videoAspectRatioMin`/`videoAspectRatioMax`; a video is
   * never held to this range.
   */
  readonly aspectRatioMin?: number
  readonly aspectRatioMax?: number
  /**
   * Accepted width/height range for VIDEO. Absent means the aspect ratio of a
   * video is not checked here, whatever the image range says.
   */
  readonly videoAspectRatioMin?: number
  readonly videoAspectRatioMax?: number
  /**
   * Widest video accepted, in pixels, where the platform documents one
   * (Instagram Reels: 1920 columns). Checked only when the width is known.
   */
  readonly videoMaxWidth?: number
  readonly maxImageBytes?: number
  readonly maxVideoBytes?: number
  /** Largest document accepted, in bytes. Only meaningful where `mediaKinds` lists documents. */
  readonly maxDocumentBytes?: number
  /**
   * Most documents one post may carry, where `mediaKinds` lists documents.
   * Absent means only `maxMediaCount` applies. A LinkedIn document post is one
   * document and its text, so LinkedIn declares 1.
   */
  readonly maxDocumentCount?: number
  /**
   * Instagram and TikTok fetch media from a public HTTPS URL rather than
   * accepting bytes. Drives whether a target may publish before its media has
   * finished uploading to object storage.
   */
  readonly requiresPublicMediaUrl: boolean
  /** Whether the platform itself can hold a future-dated post. */
  readonly supportsNativeScheduling: boolean
  /**
   * Mixing kinds of media in one post: images with video, or a document with
   * either. Most platforms disallow it.
   */
  readonly allowsMixedMedia: boolean
  /** How the preview should render this platform. Absent means no preview yet. */
  readonly preview?: PreviewStyle
}

/**
 * How a post renders on this platform.
 *
 * Preview is inherently platform-specific, but the UI must not branch on platform
 * names — so the differences live here as data. A preview component reads these
 * and draws the right thing without knowing which platform it is looking at.
 */
export interface PreviewStyle {
  /** Name shown in the preview tab. */
  readonly label: string
  /**
   * What an account on this platform is called, e.g. "Facebook Page",
   * "Instagram", "LinkedIn Page". Shown as a badge next to every account name so
   * it is never ambiguous which one a post is going to — especially once several
   * platforms carry the same brand name.
   */
  readonly accountLabel: string
  /** Brand colour, for the tab indicator only. */
  readonly accent: string
  /**
   * Characters shown before the caption is cut with a "more" link. Instagram
   * truncates far earlier than Facebook, which changes how a caption should be
   * written — and that is invisible until it is published.
   */
  readonly captionTruncateAt: number
  /** Where the caption sits relative to the media. */
  readonly captionPosition: 'above' | 'below'
  /**
   * How media is displayed. 'square' crops to 1:1, which is what makes a wrongly
   * shaped image obvious before it goes out.
   */
  readonly mediaFit: 'square' | 'original'
  /** Whether multiple media show as a swipeable carousel with dots. */
  readonly showsCarouselDots: boolean
  /** Text of the expand link, e.g. "more" or "See more". */
  readonly moreLabel: string
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
