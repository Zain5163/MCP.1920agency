import type { Platform } from '../domain/types.ts'
import type { Capabilities } from './adapter.ts'

/**
 * Per-platform limits.
 *
 * `verified` carries the date each platform's numbers were last checked against
 * live documentation, or `false` if they are still only from knowledge. Platforms
 * change limits quietly, and a stale number here becomes a confusing publish
 * failure rather than a clear one — so these are worth rechecking periodically,
 * the same way the pinned Graph API version is.
 *
 * Facebook and Instagram were verified 2026-09-25. Everything else is unverified
 * and must be checked before that platform is used for real.
 */

export interface CapabilityRecord extends Capabilities {
  /** Set to an ISO date once confirmed against official platform documentation. */
  readonly verified: string | false
  readonly notes?: string
}

export const CAPABILITIES: Readonly<Record<Platform, CapabilityRecord>> = {
  facebook_page: {
    maxTextLength: 63_206,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 10,
    minMediaCount: 0,
    requiresPublicMediaUrl: false,
    supportsNativeScheduling: true,
    allowsMixedMedia: false,
    preview: {
      label: 'Facebook',
      accent: '#1877f2',
      // Facebook shows far more text than Instagram before cutting.
      captionTruncateAt: 400,
      captionPosition: 'above',
      mediaFit: 'original',
      showsCarouselDots: false,
      moreLabel: 'See more',
    },
    verified: '2026-09-25',
    notes:
      'Accepts JPG, PNG, GIF and MP4. Text limit is the widely-cited 63,206; Meta does not ' +
      'publish an exact figure and secondary sources also quote 50,000, so treat it as ' +
      'approximate — it is far beyond any realistic caption either way. Native scheduling ' +
      'needs published=false plus scheduled_publish_time, with a minimum lead time of about ' +
      '10 minutes; our own queue is used instead, so that path is untested.',
  },

  instagram: {
    maxTextLength: 2_200,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 10,
    minMediaCount: 1,
    videoMinSeconds: 3,
    videoMaxSeconds: 900,
    // 4:5 portrait (0.8) to 1.91:1 landscape. Outside this, container creation
    // fails with an error that reads like a permissions problem.
    aspectRatioMin: 0.8,
    aspectRatioMax: 1.91,
    requiresPublicMediaUrl: true,
    supportsNativeScheduling: false,
    allowsMixedMedia: true,
    preview: {
      label: 'Instagram',
      accent: '#e1306c',
      // Instagram cuts at roughly 125 characters, which is why a caption that
      // reads fine on Facebook can lose its point here.
      captionTruncateAt: 125,
      captionPosition: 'below',
      mediaFit: 'square',
      showsCarouselDots: true,
      moreLabel: 'more',
    },
    verified: '2026-09-25',
    notes:
      'Cannot post text alone — hence minMediaCount 1. Two-step create-then-publish container ' +
      'flow; the media URL must stay reachable across both steps. Rate limit is 100 published ' +
      'posts per 24h (NOT 50 — that figure is stale), and a carousel counts as one. Reels up ' +
      'to 15 minutes. ' +
      'DOCS SAY JPEG ONLY — PNG, WebP and GIF are listed as unsupported. In practice a PNG ' +
      'published successfully on 2026-09-25, so the restriction is not enforced as documented. ' +
      'Not blocking PNG here, because rejecting something that demonstrably works would be ' +
      'worse than the documented risk. Revisit if a PNG ever fails.',
  },

  threads: {
    maxTextLength: 500,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 20,
    minMediaCount: 0,
    videoMaxSeconds: 300,
    requiresPublicMediaUrl: true,
    supportsNativeScheduling: false,
    allowsMixedMedia: true,
    verified: false,
  },

  bluesky: {
    maxTextLength: 300,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 4,
    minMediaCount: 0,
    videoMaxSeconds: 60,
    requiresPublicMediaUrl: false,
    supportsNativeScheduling: false,
    allowsMixedMedia: false,
    verified: false,
    notes:
      'Length is counted in graphemes, not UTF-16 code units. Use the grapheme-aware counter ' +
      'in validate.ts, or emoji and combining characters will be miscounted.',
  },

  mastodon: {
    maxTextLength: 500,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 4,
    minMediaCount: 0,
    requiresPublicMediaUrl: false,
    supportsNativeScheduling: true,
    allowsMixedMedia: false,
    verified: false,
    notes:
      'Limits are per-instance and configurable. Read them from the instance /api/v1/instance ' +
      'endpoint at connect time rather than trusting this default.',
  },

  telegram: {
    maxTextLength: 4_096,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 10,
    minMediaCount: 0,
    requiresPublicMediaUrl: false,
    supportsNativeScheduling: false,
    allowsMixedMedia: true,
    verified: false,
    notes:
      'Caption limit when media is attached is much lower than the text-only limit ' +
      '(~1024). Model this as a media-dependent limit before shipping.',
  },

  discord: {
    maxTextLength: 2_000,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 10,
    minMediaCount: 0,
    requiresPublicMediaUrl: false,
    supportsNativeScheduling: false,
    allowsMixedMedia: true,
    verified: false,
  },

  // ---- Wave 2 and 3. Declared so the UI and types are complete; not implemented. ----

  youtube: {
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

  tiktok: {
    maxTextLength: 2_200,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 35,
    minMediaCount: 1,
    videoMaxSeconds: 600,
    requiresPublicMediaUrl: true,
    supportsNativeScheduling: false,
    allowsMixedMedia: false,
    verified: false,
    notes:
      'Until the app passes TikTok audit, posts land private/self-only. The domain serving ' +
      'media URLs must be verified with TikTok.',
  },

  linkedin: {
    maxTextLength: 3_000,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 20,
    minMediaCount: 0,
    requiresPublicMediaUrl: false,
    supportsNativeScheduling: false,
    allowsMixedMedia: false,
    verified: false,
    notes: 'Organization posting requires Community Management API approval, which may not be granted.',
  },

  x: {
    maxTextLength: 280,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 4,
    minMediaCount: 0,
    videoMaxSeconds: 140,
    requiresPublicMediaUrl: false,
    supportsNativeScheduling: false,
    allowsMixedMedia: false,
    verified: false,
    notes:
      'Pay-per-use billing: a post containing a link costs materially more than a plain post. ' +
      'Surface the per-post cost in the UI before publishing.',
  },
}

export function capabilitiesFor(platform: Platform): CapabilityRecord {
  const record = CAPABILITIES[platform]
  if (record === undefined) {
    throw new Error(`No capabilities declared for platform: ${platform}`)
  }
  return record
}

/** Platforms whose limits are still unverified. Surface this in the UI, not just in code. */
export function unverifiedPlatforms(): Platform[] {
  return (Object.keys(CAPABILITIES) as Platform[]).filter((p) => CAPABILITIES[p].verified === false)
}
