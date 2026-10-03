/**
 * The error catalogue.
 *
 * Project rule: **no error is allowed to say only what broke.** Every failure
 * carries a stable code, what happened, why it happened, and the concrete steps
 * that fix it. A message like "Publish failed: (#100) Invalid parameter" is a
 * support ticket; the same failure with "the caption is 40 characters over
 * Instagram's limit — shorten it or use a per-platform override" is self-service.
 *
 * This matters more than usual here because the operator is often an AI agent
 * relaying to a human. An AI given a resolution can act on it; an AI given a
 * platform error code invents a plausible-sounding fix.
 *
 * Adding a new failure mode means adding an entry here, not inventing a message
 * at the throw site.
 */

export type ErrorCode =
  // configuration
  | 'CONFIG_MISSING'
  | 'CONFIG_FILE_ABSENT'
  | 'VAULT_KEY_INVALID'
  // connectivity
  | 'DB_UNREACHABLE'
  | 'DB_PAUSED'
  | 'PLATFORM_UNREACHABLE'
  // credentials
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'SCOPE_MISSING'
  | 'NO_CONNECTION'
  | 'GOOGLE_SCOPE_NOT_GRANTED'
  | 'GOOGLE_API_NOT_ENABLED'
  | 'GOOGLE_TOKEN_REVOKED'
  // content
  | 'TEXT_TOO_LONG'
  | 'MEDIA_REQUIRED'
  | 'MEDIA_NOT_HOSTED'
  | 'MEDIA_UNSUPPORTED'
  | 'VIDEO_TOO_LONG'
  | 'MIXED_MEDIA'
  | 'SCHEDULED_IN_PAST'
  // platform
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'PLATFORM_REJECTED'
  | 'MEDIA_PROCESSING_FAILED'
  | 'MEDIA_PROCESSING_TIMEOUT'
  | 'STORAGE_NOT_PUBLIC'
  | 'STORAGE_REJECTED'
  | 'YOUTUBE_NO_CHANNEL'
  | 'YOUTUBE_WRONG_CHANNEL'
  | 'YOUTUBE_CHANNEL_UPLOAD_LIMIT'
  | 'YOUTUBE_UPLOAD_UNCONFIRMED'
  | 'YOUTUBE_UPLOAD_TOKEN_EXPIRED'
  // internal
  | 'UNKNOWN'

export interface Resolution {
  readonly code: ErrorCode
  /** Plain language, no jargon. What the user sees first. */
  readonly what: string
  /** The cause. Answers "why did this happen?" rather than restating the symptom. */
  readonly why: string
  /** Ordered, concrete steps. Each one must be something a person can actually do. */
  readonly fix: readonly string[]
  /** Whether retrying unchanged could succeed. */
  readonly retryable: boolean
  /**
   * Whether a human must act. An AI agent can retry a rate limit on its own but
   * cannot reconnect a revoked Facebook token — knowing the difference is what
   * stops an agent looping forever on something it can never fix.
   */
  readonly needsHuman: boolean
}

const CATALOGUE: Readonly<Record<ErrorCode, Omit<Resolution, 'code'>>> = {
  CONFIG_MISSING: {
    what: 'Some required configuration is missing.',
    why: 'The service reads its settings from a config file outside the project, and one or more required values are blank.',
    fix: [
      'Open the config file at ~/.social-publisher/.env',
      'Fill in the key named in the error detail',
      'Run the status command to confirm everything is present',
    ],
    retryable: false,
    needsHuman: true,
  },
  CONFIG_FILE_ABSENT: {
    what: 'The configuration file does not exist.',
    why: 'Settings live outside the project directory so credentials are never stored with the code, and that file has not been created yet.',
    fix: ['Follow SETUP.md to create ~/.social-publisher/.env', 'Run the status command to verify'],
    retryable: false,
    needsHuman: true,
  },
  VAULT_KEY_INVALID: {
    what: 'The encryption key is missing or malformed.',
    why: 'VAULT_MASTER_KEY must be exactly 32 random bytes in base64. Stored credentials cannot be decrypted without it.',
    fix: [
      'Check VAULT_MASTER_KEY in the config file is present and unmodified',
      'If it was changed or lost, every connected account must be reconnected — the old credentials are unrecoverable by design',
    ],
    retryable: false,
    needsHuman: true,
  },

  DB_UNREACHABLE: {
    what: 'Cannot reach the database.',
    why: 'The database rejected the connection, or the network path to it is down.',
    fix: [
      'Check the project is running in the Supabase dashboard',
      'Confirm DATABASE_URL includes sslmode=require — without it the driver reports a misleading authentication failure',
      'Retry: the shared pooler is intermittently unavailable and usually recovers within seconds',
    ],
    retryable: true,
    needsHuman: false,
  },
  DB_PAUSED: {
    what: 'The database project is paused.',
    why: 'Supabase pauses free-tier projects after 7 days without activity. The weekly keep-alive prevents this, but it cannot run while the machine is off.',
    fix: [
      'Open the Supabase dashboard and press Resume',
      'Wait about a minute for it to come back',
      'Confirm the Social-Publisher-Keepalive scheduled task is still enabled',
    ],
    retryable: false,
    needsHuman: true,
  },
  PLATFORM_UNREACHABLE: {
    what: 'Could not reach the social platform.',
    why: 'A network error occurred before the platform replied — DNS, timeout, or a dropped connection.',
    fix: ['Check internet connectivity', 'Retry — this is usually momentary'],
    retryable: true,
    needsHuman: false,
  },

  TOKEN_EXPIRED: {
    what: 'The access token for this account has expired.',
    why: 'Platform tokens expire. Refresh either was not possible or was refused.',
    fix: [
      'Run the connect command and approve access again',
      'The account will publish normally afterwards; nothing else needs changing',
    ],
    retryable: false,
    needsHuman: true,
  },
  TOKEN_REVOKED: {
    what: 'Access to this account was withdrawn.',
    why: 'Someone removed the app from the account, changed the password, or revoked permissions in platform settings.',
    fix: [
      'Run the connect command and approve access again',
      'If it keeps happening, check whether another admin is removing the app in Business Settings',
    ],
    retryable: false,
    needsHuman: true,
  },
  SCOPE_MISSING: {
    what: 'The account is connected but lacks a required permission.',
    why: 'A permission was not granted during authorisation, or was later removed. Refreshing cannot add a permission that was never approved.',
    fix: [
      'Run the connect command again',
      'On the approval screen, leave every requested permission ticked — unticking one causes exactly this error later',
    ],
    retryable: false,
    needsHuman: true,
  },
  NO_CONNECTION: {
    what: 'No social account is connected for that platform.',
    why: 'Nothing has been authorised for this platform yet, or the connection was removed.',
    fix: ['Run the connect command', 'Run the status command to see which accounts are linked'],
    retryable: false,
    needsHuman: true,
  },
  GOOGLE_SCOPE_NOT_GRANTED: {
    what: 'The Google connection is missing a permission this needs.',
    why: 'Google lets people untick individual permissions on its consent screen, and one this action depends on was not granted, or was removed later in the Google Account. Refreshing the token cannot add a permission that was never given.',
    fix: [
      'In source/apps/cli run pnpm connect:provider google followed by the product, e.g. pnpm connect:provider google youtube',
      'On the Google consent screen, leave every requested permission ticked',
      'If Google does not ask again, remove the app at https://myaccount.google.com/permissions and connect once more',
    ],
    retryable: false,
    needsHuman: true,
  },
  GOOGLE_API_NOT_ENABLED: {
    what: 'The Google API this needs is switched off in the Google Cloud project.',
    why: 'Every Google API must be enabled in the Cloud project that owns the OAuth client. Until it is, Google refuses each call with accessNotConfigured, whatever permissions the account granted.',
    fix: [
      'Open https://console.cloud.google.com/apis/library in the project that holds GOOGLE_CLIENT_ID',
      'Enable the API named in the detail; uploading videos needs the YouTube Data API v3',
      'Wait a few minutes for the change to reach Google’s servers, then try again',
    ],
    retryable: false,
    needsHuman: true,
  },
  GOOGLE_TOKEN_REVOKED: {
    what: 'Google no longer accepts this connection’s authorisation.',
    why: 'Google cancels a refresh token when access is removed from the Google Account, when it goes six months unused, when the account passes 100 newer tokens for the same app, or after 7 days while the app’s consent screen is still in Testing.',
    fix: [
      'In source/apps/cli run pnpm connect:provider google youtube and approve access again',
      'If it dies again about a week later, publish the app to production in Google Cloud (Google Auth Platform, Audience) so its tokens stop expiring after 7 days',
    ],
    retryable: false,
    needsHuman: true,
  },

  TEXT_TOO_LONG: {
    what: 'The text is longer than this platform allows.',
    why: 'Each platform enforces its own limit, and the strictest selected platform governs.',
    fix: [
      'Shorten the text to the limit shown in the detail',
      'Or set a shorter per-platform override so other platforms keep the full version',
    ],
    retryable: false,
    needsHuman: true,
  },
  MEDIA_REQUIRED: {
    what: 'This platform cannot post text on its own.',
    why: 'Instagram and TikTok are media-first and reject posts with no image or video.',
    fix: ['Attach an image or video', 'Or remove that platform from this post'],
    retryable: false,
    needsHuman: true,
  },
  MEDIA_NOT_HOSTED: {
    what: 'The media has no public web address.',
    why: 'Instagram and TikTok download media from a URL rather than accepting an upload, so files must be hosted publicly before posting.',
    fix: [
      'Confirm media storage is configured (SUPABASE_SERVICE_ROLE_KEY)',
      'Confirm the storage bucket is set to public',
      'Facebook needs none of this — it accepts direct uploads',
    ],
    retryable: false,
    needsHuman: true,
  },
  MEDIA_UNSUPPORTED: {
    what: 'This platform does not accept that kind of file.',
    why: 'Platforms differ: YouTube takes video only, and some reject mixing images with video in one post.',
    fix: ['Use a supported file type for this platform', 'Or post to a different platform'],
    retryable: false,
    needsHuman: true,
  },
  VIDEO_TOO_LONG: {
    what: 'The video exceeds this platform’s length limit.',
    why: 'Each platform caps video duration, and the API rejects anything longer rather than trimming it.',
    fix: ['Trim the video to the limit shown', 'Or post it to a platform that allows longer video'],
    retryable: false,
    needsHuman: true,
  },
  MIXED_MEDIA: {
    what: 'Images and video cannot be combined in one post here.',
    why: 'Most platforms allow a carousel of images or a single video, but not both together.',
    fix: ['Post the images and the video separately', 'Or drop one of the two'],
    retryable: false,
    needsHuman: true,
  },
  SCHEDULED_IN_PAST: {
    what: 'The scheduled time has already passed.',
    why: 'A post can only be queued for the future.',
    fix: ['Choose a future time', 'Or publish immediately instead of scheduling'],
    retryable: false,
    needsHuman: true,
  },

  RATE_LIMITED: {
    what: 'The platform is temporarily refusing requests.',
    why: 'Too many calls in a short window. This is a throttle, not a rejection of the content.',
    fix: [
      'No action needed — it will retry automatically with a growing delay',
      'If it persists for hours, reduce how many posts are scheduled close together',
    ],
    retryable: true,
    needsHuman: false,
  },
  QUOTA_EXHAUSTED: {
    what: 'The posting limit for this period has been reached.',
    why: 'Platforms cap how much can be posted per window — Instagram allows 100 posts per 24 hours per account, and YouTube allows 100 API uploads a day per Google Cloud project, shared by every connected channel and reset at midnight Pacific time.',
    fix: ['Wait for the window to roll over', 'Spread scheduled posts across more days'],
    retryable: true,
    needsHuman: false,
  },
  PLATFORM_REJECTED: {
    what: 'The platform refused this post.',
    why: 'The content or its settings breached a platform rule. The platform’s own wording is in the detail and is the authoritative reason.',
    fix: [
      'Read the platform message in the detail — it states the specific rule',
      'Change the content accordingly and post again',
      'Retrying unchanged will fail identically',
    ],
    retryable: false,
    needsHuman: true,
  },
  MEDIA_PROCESSING_FAILED: {
    what: 'The platform could not process the media.',
    why: 'The file was received but rejected while the platform processed it — usually an unsupported codec, a corrupt file, or an out-of-range aspect ratio; for a document, a password-protected or damaged file, or one over the size or page limit.',
    fix: [
      'Re-export as H.264 MP4 for video, or JPEG/PNG for images',
      'Check the aspect ratio is within the platform’s accepted range',
      'For a document, export a plain PDF without a password, within the platform’s size and page limits',
    ],
    retryable: false,
    needsHuman: true,
  },
  MEDIA_PROCESSING_TIMEOUT: {
    what: 'The platform is still processing the media.',
    why: 'Large videos and long documents can take longer than the wait allows. The upload itself succeeded, and nothing was posted.',
    fix: ['No action needed — it will retry automatically', 'Smaller files process faster if this recurs'],
    retryable: true,
    needsHuman: false,
  },
  STORAGE_NOT_PUBLIC: {
    what: 'Uploaded media is not reachable from the public internet.',
    why: 'The storage bucket is private, so the platform cannot download the file it was pointed at.',
    fix: [
      'Open Supabase Dashboard → Storage → the media bucket',
      'Turn on Public bucket',
      'Post again — no need to re-upload',
    ],
    retryable: false,
    needsHuman: true,
  },
  STORAGE_REJECTED: {
    what: 'The media upload was refused.',
    why: 'Storage rejected the file — commonly a missing bucket, a bad service key, or a file over the size limit.',
    fix: [
      'Confirm the bucket named in the config exists',
      'Confirm SUPABASE_SERVICE_ROLE_KEY is the service_role key, not the anon key',
      'Check the file size against the bucket limit',
    ],
    retryable: false,
    needsHuman: true,
  },
  YOUTUBE_NO_CHANNEL: {
    what: 'This Google account has no YouTube channel to upload to.',
    why: 'Videos are uploaded to a channel, and a Google account has none until one is created. YouTube refuses uploads from an account without a channel, however the authorisation was granted.',
    fix: [
      'Sign in at https://www.youtube.com with the same Google account and create a channel',
      'Then run pnpm connect:provider google youtube in source/apps/cli and pick that account',
    ],
    retryable: false,
    needsHuman: true,
  },
  YOUTUBE_WRONG_CHANNEL: {
    what: 'The stored YouTube authorisation belongs to a different channel than this account.',
    why: 'A Google token reaches exactly one channel, and this one answered with another channel’s id, usually because the same Google login was reconnected for a different channel. Uploading would have put the video on the wrong channel, so nothing was sent.',
    fix: [
      'Run pnpm connect:provider google youtube and sign in to the channel named in the detail',
      'Run list_accounts to confirm that channel shows as ready before posting again',
    ],
    retryable: false,
    needsHuman: true,
  },
  YOUTUBE_CHANNEL_UPLOAD_LIMIT: {
    what: 'This YouTube channel has reached its daily upload limit.',
    why: 'YouTube caps how many videos one channel may upload in a day, separately from the API quota, and channels that are not verified get the lower limit.',
    fix: [
      'Nothing to do for a scheduled post: it is tried again after a day',
      'To raise the limit, verify the channel at https://www.youtube.com/verify',
    ],
    retryable: true,
    needsHuman: false,
  },
  /**
   * Not retryable, and a person must look, because the one thing a retry is
   * sure to do here is upload the video again: YouTube makes the video the
   * moment it holds the last byte and has no way to recognise a repeat.
   */
  YOUTUBE_UPLOAD_UNCONFIRMED: {
    what: 'The whole video was sent to YouTube, but whether YouTube created it is not known.',
    why: 'YouTube creates the video the moment it receives the last byte, and the reply that would have confirmed it never arrived: the connection dropped, YouTube answered with a server error, or the upload was cancelled, and asking the upload session afterwards did not settle it. YouTube cannot recognise a repeated upload, so publishing again without checking could put the video on the channel twice.',
    fix: [
      'Open YouTube Studio (https://studio.youtube.com) and look for the video under Content; a new upload can take a few minutes to appear',
      'If it is there, do not publish it again: change its title, privacy or other details in YouTube Studio if needed',
      'If it is still missing after about 15 minutes, publish it again',
    ],
    retryable: false,
    needsHuman: true,
  },
  /**
   * Its own code so the token running out mid-upload is not reported as a
   * rate limit "retried automatically": a publish-now upload is never retried
   * by anything, and retrying a long upload unchanged meets the same wall.
   */
  YOUTUBE_UPLOAD_TOKEN_EXPIRED: {
    what: 'The YouTube upload stopped because its access token ran out partway through.',
    why: 'A Google access token lasts an hour, so a long upload has to renew it as it goes, and this one could not: the app publishing it had no way to renew Google tokens (usually because GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set where it runs) or Google refused the app’s own client. YouTube then refused the rest of the file. An unfinished upload creates no video, so nothing was published.',
    fix: [
      'Check that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in ~/.social-publisher/.env and match the OAuth client in Google Cloud',
      'Publish the video again: it starts a fresh upload from the beginning',
      'If it stops the same way again, run the status command and reconnect the channel with pnpm connect:provider google youtube in source/apps/cli',
    ],
    retryable: false,
    needsHuman: true,
  },

  UNKNOWN: {
    what: 'Something failed in a way that is not yet catalogued.',
    why: 'This path has no specific diagnosis, which means the catalogue needs an entry for it.',
    fix: [
      'Read the technical detail attached to this error',
      'Report it so a proper diagnosis can be added — an uncatalogued error is a gap, not a dead end',
    ],
    retryable: false,
    needsHuman: true,
  },
}

export function resolutionFor(code: ErrorCode): Resolution {
  return { code, ...CATALOGUE[code] }
}

export function allCodes(): ErrorCode[] {
  return Object.keys(CATALOGUE) as ErrorCode[]
}

/**
 * Formats a resolution for a human or an AI agent reading a tool result.
 *
 * Structured headings rather than prose because an agent parses this to decide
 * whether to retry, ask the user, or stop.
 */
export function formatResolution(resolution: Resolution, detail?: string): string {
  const lines = [
    `[${resolution.code}] ${resolution.what}`,
    '',
    `Why: ${resolution.why}`,
    '',
    'How to fix:',
    ...resolution.fix.map((step, i) => `  ${i + 1}. ${step}`),
  ]
  if (detail !== undefined && detail.trim() !== '') {
    lines.push('', `Detail: ${detail}`)
  }
  lines.push(
    '',
    resolution.retryable
      ? 'This will be retried automatically.'
      : resolution.needsHuman
        ? 'This needs a person to act — retrying will not help.'
        : 'Retrying unchanged will not help.',
  )
  return lines.join('\n')
}
