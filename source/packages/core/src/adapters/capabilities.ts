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
    // Reels (a single video goes out as REELS): "Duration: 15 mins maximum, 3
    // seconds minimum" (ig-user/media reference, checked 2026-10-11).
    videoMinSeconds: 3,
    videoMaxSeconds: 900,
    // FEED IMAGES ONLY: 4:5 portrait (0.8) to 1.91:1 landscape. Outside this,
    // container creation fails with an error that reads like a permissions
    // problem.
    aspectRatioMin: 0.8,
    aspectRatioMax: 1.91,
    // WHY a separate video range (2026-10-11): the image range above was
    // applied to video too, which refused a 9:16 Reel (0.56:1). Meta's
    // ig-user/media reference, Reels specifications (checked 2026-10-11):
    // "Required aspect ratio is between 0.01:1 and 10:1 but we recommend 9:16
    // to avoid cropping or blank space."; "Maximum columns (horizontal pixels):
    // 1920"; "File size: 300MB maximum" (read as 300,000,000 bytes, the
    // stricter reading). https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
    videoAspectRatioMin: 0.01,
    videoAspectRatioMax: 10,
    videoMaxWidth: 1_920,
    maxVideoBytes: 300_000_000,
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
      'REELS (checked 2026-10-11 against the ig-user/media reference): 3 s to 15 min, 300 MB, ' +
      'aspect 0.01:1 to 10:1 (9:16 recommended), at most 1920 px wide, 23-60 fps, MOV/MP4 with ' +
      'the moov atom first, H.264/HEVC, AAC. The 4:5 to 1.91:1 range is for FEED IMAGES only. ' +
      'Frame rate and codec are not checked here: the media record does not carry them. ' +
      'The reference states no separate aspect range for a carousel video item, so carousel ' +
      'video is held to the Reels range. ' +
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

  // ---- Wave 2 and 3. YouTube, LinkedIn and Pinterest have adapters; the rest are ----
  // ---- declared so the UI and types are complete, and are not implemented.       ----

  youtube: {
    // The description. Google documents its limit as 5,000 BYTES, which this
    // grapheme count cannot express, so the adapter checks the byte length too.
    maxTextLength: 5_000,
    titleMaxLength: 100,
    // Every upload states containsSyntheticMedia, true or false. The only
    // adapter here that sends the AI declaration at all.
    sendsSyntheticMediaDisclosure: true,
    mediaKinds: ['video'],
    maxMediaCount: 1,
    minMediaCount: 1,
    // 12 hours or 256 GB, whichever comes first. Over 15 minutes also needs a
    // verified channel, which only the channel itself can tell us.
    videoMaxSeconds: 43_200,
    maxVideoBytes: 274_877_906_944,
    requiresPublicMediaUrl: false,
    supportsNativeScheduling: true,
    allowsMixedMedia: false,
    preview: {
      label: 'YouTube',
      accountLabel: 'YouTube Channel',
      accent: '#ff0000',
      // How much of a description shows before "...more" is not documented;
      // about this much is commonly reported. Unverified.
      captionTruncateAt: 150,
      captionPosition: 'below',
      mediaFit: 'original',
      showsCarouselDots: false,
      moreLabel: '...more',
    },
    verified: false,
    notes:
      'Title is a separate field of at most 100 characters with no < or >; without one the ' +
      'adapter uses the first line of the text. The description is the text, at most 5,000 ' +
      'BYTES with no < or >, so non-Latin text and emoji fit fewer characters than the limit ' +
      'suggests. Tags total at most 500 characters, commas included. ' +
      'QUOTA: since 2026-06-01 videos.insert has its own bucket of 100 uploads a day per Google ' +
      'Cloud project, shared by every tenant and channel and reset at midnight Pacific; other ' +
      'calls share 10,000 units a day (channels.list and videos.list cost 1). The old figure of ' +
      '1,600 units per upload is stale. ' +
      'PRIVATE UNTIL AUDIT: uploads from API projects created after 2020-07-28 that have not ' +
      'passed the YouTube API audit are restricted to private, with no appeal, so the adapter ' +
      'uploads private until YOUTUBE_UPLOADS_AUDITED=true and reports it as uploaded, private — ' +
      'never as published. ' +
      'Every upload states privacyStatus, selfDeclaredMadeForKids and containsSyntheticMedia ' +
      'explicitly, because the defaults are undocumented. ' +
      'Native scheduling (status.publishAt) exists but only for private videos and is not used ' +
      'yet; the queue schedules instead, and a scheduled upload needs its file in the media ' +
      'bucket, which caps file size. Limits checked against Google documentation on ' +
      '2026-10-02 (docs/research/2026-10-02-youtube-api-facts.md); nothing has been uploaded for ' +
      'real yet, so verified stays false.',
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
    // The title of a DOCUMENT post, shown above its pages; no other LinkedIn post
    // here sends one (titleMediaKinds). 200 is LinkedIn's stated maximum for a
    // document ad's headline (LinkedIn Help a493903). No limit is documented for
    // an organic post, and LinkedIn's own composer is reported to stop at 58, so
    // the adapter warns past 58 and keeps a title it makes from the text within it.
    titleMaxLength: 200,
    titleMediaKinds: ['document'],
    mediaKinds: ['image', 'video', 'document'],
    maxMediaCount: 20,
    minMediaCount: 0,
    // A document post is one document and its text: never two documents, and
    // never a document with images or video (allowsMixedMedia below).
    maxDocumentCount: 1,
    // "The file size can't exceed 100MB and 300 pages" (Documents API). Read as
    // 100,000,000 bytes, the stricter reading. Pages are not counted here.
    maxDocumentBytes: 100_000_000,
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
      'The URN TYPE DIFFERS BY POST KIND, confirmed 2026-09-26: text and image posts ' +
      'return urn:li:share:..., video posts return urn:li:ugcPost:... . Anything that ' +
      'matches on the share prefix will silently miss every video post. ' +
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
      'Losing one ETag wastes the whole upload. A post carries images, one video, or ' +
      'one document, never a mix. ' +
      'DOCUMENT posts (PDF carousels), checked against the Documents and Posts API docs ' +
      '2026-10-02 (docs/research/2026-10-02-linkedin-documents.md): /rest/documents ' +
      'initializeUpload with the owner returns an uploadUrl and a urn:li:document id; the ' +
      'whole file goes up in ONE PUT (no parts, no finalize); the post is content.media ' +
      '{ id, title }, and the title is required for a document. PDF, PPT, PPTX, DOC or ' +
      'DOCX, at most 100 MB and 300 pages. Processing status (PROCESSING, AVAILABLE, ' +
      'PROCESSING_FAILED, WAITING_UPLOAD) is read back where the token may read it; a ' +
      'member token is documented as write-only for image reads and reported to be the ' +
      'same for documents, so the adapter then pauses and posts, and the result carries a ' +
      'notice that the post is not confirmed as published (reported as uploaded, not ' +
      'published). Nothing has been posted as a document for real yet. ' +
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
    // WHY not 140 s (2026-10-11): 140 s / 512 MB is now the DIRECT MESSAGE
    // limit. X's media upload best practices (docs.x.com/x-api/media/quickstart/
    // best-practices, checked 2026-10-11) give post video (tweet_video) as 0.5 s
    // to 20 minutes and 8 GB for a default account, 125 minutes and 16 GB for a
    // Premium / verified one, and say "Post-video caps match the X app" — the API
    // and the app share these. Which tier an account is cannot be known here, so
    // the default account's caps are encoded: the stricter, always-true reading.
    // 8 GB is read as 8,000,000,000 bytes, the stricter reading.
    videoMinSeconds: 0.5,
    videoMaxSeconds: 1_200,
    maxVideoBytes: 8_000_000_000,
    // "Aspect ratio: must be between 1:3 and 3:1" (same page).
    videoAspectRatioMin: 1 / 3,
    videoAspectRatioMax: 3,
    requiresPublicMediaUrl: false,
    supportsNativeScheduling: false,
    allowsMixedMedia: false,
    verified: false,
    notes:
      'Pay-per-use billing: a post containing a link costs materially more than a plain post. ' +
      'Surface the per-post cost in the UI before publishing. ' +
      'VIDEO (checked 2026-10-11, docs.x.com media upload best practices; no adapter yet): post ' +
      'video 0.5 s to 20 min and 8 GB for a default account, 125 min and 16 GB for Premium / ' +
      'verified, the same as the X app; the old 140 s / 512 MB now applies to DMs only. The ' +
      'default caps are encoded because the tier is not known before posting. Aspect 1:3 to ' +
      '3:1; H.264 High, AAC-LC, at most 60 fps, YUV 4:2:0, no open GOP, progressive. The page ' +
      'also says "Dimensions: must be between 32x32 and 1280x1024" yet lets subscribed users ' +
      'upload 1080p, so no width limit is encoded. Upload with media_category tweet_video: a DM ' +
      'category on a post is a documented cause of an upload that succeeds and a post that fails.',
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
