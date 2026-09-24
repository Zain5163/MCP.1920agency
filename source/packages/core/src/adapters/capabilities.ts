import type { Platform } from '../domain/types.ts'
import type { Capabilities } from './adapter.ts'

/**
 * Per-platform limits.
 *
 * ⚠️ VERIFY BEFORE FIRST LIVE USE. These values are set from knowledge, not
 * checked against live documentation — the same caution `..\Meta-Ads-Publisher`
 * applies to its pinned Graph API version. Platforms change limits quietly and a
 * stale number here becomes a confusing publish failure.
 *
 * Verification status is tracked per platform in the `verified` field. Anything
 * still `false` must be confirmed against official docs before that platform
 * leaves Wave 1 testing.
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
    verified: false,
    notes:
      'Native scheduling has a minimum lead time (documented ~10 minutes) and a maximum horizon. ' +
      'Confirm both before relying on platform-side scheduling instead of our own queue.',
  },

  instagram: {
    maxTextLength: 2_200,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 10,
    minMediaCount: 1,
    videoMinSeconds: 3,
    videoMaxSeconds: 900,
    requiresPublicMediaUrl: true,
    supportsNativeScheduling: false,
    allowsMixedMedia: true,
    verified: false,
    notes:
      'Cannot post text alone — hence minMediaCount 1. Publishing is a two-step create-then-publish ' +
      'container flow, and the media URL must stay reachable across both steps. ' +
      'Rate limit is documented around 50 published posts per 24h per account.',
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
