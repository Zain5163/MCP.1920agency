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
      accountLabel: 'Facebook Page',
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
      accountLabel: 'Instagram',
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
    preview: {
      label: 'Threads',
      accountLabel: 'Threads',
      accent: '#000000',
      // Threads shows the whole 500 characters, so nothing is ever cut.
      captionTruncateAt: 500,
      captionPosition: 'above',
      mediaFit: 'original',
      showsCarouselDots: true,
      moreLabel: 'more',
    },
    verified: false,
    notes:
      'NOT the Facebook Graph API. Lives at graph.threads.net with its own OAuth, its own ' +
      'scopes (threads_basic, threads_content_publish) and a Meta app configured for the ' +
      'Threads use case. A Threads long-lived token lasts 60 days and MUST be refreshed ' +
      'between 24h and 60d, unlike a Facebook Page token which does not expire while the ' +
      'app stays installed — so these connections go stale if nothing refreshes them. ' +
      'Unlike Instagram it can post text alone. Limits here are unverified.',
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
    // Neither: LinkedIn is the only platform here that takes uploaded bytes and
    // will not fetch a URL, so the adapter reads from disk or downloads first.
    // Reported as 3 seconds to 30 minutes for the API. Feed video in the app is
    // capped lower (~15 minutes), so the API figure is the permissive one.
    videoMinSeconds: 3,
    videoMaxSeconds: 1_800,
    requiresPublicMediaUrl: false,
    supportsNativeScheduling: false,
    allowsMixedMedia: false,
    preview: {
      label: 'LinkedIn',
      accountLabel: 'LinkedIn Profile',
      accent: '#0a66c2',
      // The feed cuts at roughly 200 characters behind "see more".
      captionTruncateAt: 200,
      captionPosition: 'above',
      mediaFit: 'original',
      showsCarouselDots: true,
      moreLabel: 'see more',
    },
    verified: false,
    notes:
      'The author is a full URN and the URN carries the account type: urn:li:person:x is a ' +
      'personal profile, urn:li:organization:n a company page. platform_account_id holds the ' +
      'whole URN. ' +
      'WARNING: commentary is "little text", not plain text. An unescaped reserved character ' +
      '( ) [ ] { } @ # * _ ~ < > | \\ does NOT error — LinkedIn drops the post from that ' +
      'character onward and still reports success. escapeLittleText handles it. ' +
      'CONFIRMED by a real published post 2026-09-26: escaping round-trips end to end. ' +
      'Text containing ( ) survived intact, and an escaped # rendered as a normal ' +
      'hashtag with no backslash visible — LinkedIn unescapes little text on display. ' +
      'A created post returns 201 with an empty body; the id is in the x-restli-id header. ' +
      'Every call needs LinkedIn-Version (YYYYMM, retired after about a year) and ' +
      'X-Restli-Protocol-Version: 2.0.0. ' +
      'TWO self-serve products are needed, not one: "Share on LinkedIn" grants w_member_social, ' +
      'and "Sign In with LinkedIn using OpenID Connect" grants openid/profile and /v2/userinfo. ' +
      'Without the second, discovery cannot identify the authorising member and there is no ' +
      'person URN to author the post as. ' +
      'CONFIRMED against a real app console 2026-09-26: access token TTL is 2 months ' +
      '(5,184,000 seconds), which is the default this code already assumed. No refresh product ' +
      'is offered on a self-serve app, so a connection must be reauthorised every 60 days. ' +
      'Posting as a company page needs the Community Management API, and on a verified ' +
      'standard app its request button was DISABLED outright — not merely unapproved. ' +
      'Reported but unverified: Community Management and Sign In with OpenID Connect cannot ' +
      'coexist on one app, which would mean company-page posting needs a SECOND LinkedIn app ' +
      'rather than another product on this one. Confirm before building for it. ' +
      'FILE SIZE: sources CONFLICT. The Videos API is reported as capped at 200 MB, ' +
      'while native upload in the LinkedIn app takes 5 GB — so a video that uploads ' +
      'fine by hand may be refused through the API. Unverified either way; find out ' +
      'empirically before promising a customer a large upload. ' +
      'Video is a SEPARATE endpoint from images: /rest/videos, split into 4 MB parts, ' +
      'each PUT returning an ETag that must be collected and handed to finalizeUpload. ' +
      'Losing one ETag wastes the whole upload. A post carries images OR one video, ' +
      'never both. ' +
      'Remaining limits here are unverified.',
  },

  pinterest: {
    // Pinterest splits text into a 100-char title and an 800-char description.
    // One body covers both: first line becomes the title, the rest the description.
    maxTextLength: 800,
    mediaKinds: ['image', 'video'],
    maxMediaCount: 1,
    // There is no text-only pin at all.
    minMediaCount: 1,
    requiresPublicMediaUrl: true,
    supportsNativeScheduling: false,
    allowsMixedMedia: false,
    preview: {
      label: 'Pinterest',
      accountLabel: 'Pinterest Board',
      accent: '#e60023',
      captionTruncateAt: 100,
      captionPosition: 'below',
      mediaFit: 'original',
      showsCarouselDots: false,
      moreLabel: 'more',
    },
    verified: false,
    notes:
      'A pin belongs to a BOARD, not an account — each board is its own connection, so ' +
      'platform_account_id holds the board id. ' +
      'WARNING: under Trial access, pins are sandbox entities visible only to their creator. ' +
      'Everything reports success — an id comes back and the URL resolves — while nobody ' +
      'else can see the pin. Standard Access needs a submitted video of the app in use. ' +
      'Tokens expire and are renewed with a separate refresh token, unlike Threads which ' +
      'refreshes using the access token itself. Limits here are unverified.',
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
