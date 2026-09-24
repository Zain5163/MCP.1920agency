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
    what: 'This account has hit its posting limit for now.',
    why: 'Platforms cap posts per rolling window — Instagram allows 50 per 24 hours, YouTube limits uploads per day.',
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
    why: 'The file was downloaded but rejected during transcoding — usually an unsupported codec, corrupt file, or out-of-range aspect ratio.',
    fix: [
      'Re-export as H.264 MP4 for video, or JPEG/PNG for images',
      'Check the aspect ratio is within the platform’s accepted range',
    ],
    retryable: false,
    needsHuman: true,
  },
  MEDIA_PROCESSING_TIMEOUT: {
    what: 'The platform is still processing the media.',
    why: 'Large videos can take longer than the wait allows. The upload itself succeeded.',
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
