import { PublishError, type ErrorCode, type FailureClass } from '@social-publisher/core'

/**
 * Google API error classification.
 *
 * Built like `meta-errors.ts`, for the same reason: the HTTP status says too
 * little. Google answers a spent quota, a throttle, an unticked permission and
 * an API that was never switched on all with **403**. The shared
 * `classifyHttpStatus` turns every 403 into a credential failure, which would
 * tell the owner his token had expired when he was simply out of quota for the
 * day — and park the post as needing reconnection, which fixes nothing.
 *
 * So classification reads `error.errors[0].reason`, Google's own name for what
 * went wrong, and only falls back on the status when there is none. Each
 * reason maps to a failure class and, where one exists, to the catalogue entry
 * that explains it, so whoever shows the error can be precise.
 *
 * Reasons are taken from Google's error pages, checked 2026-10-02
 * (docs/research/2026-10-02-youtube-api-facts.md, A9).
 */

/** The envelope every Google API error uses. */
export interface GoogleErrorBody {
  readonly error?: {
    readonly code?: number
    readonly message?: string
    readonly status?: string
    readonly errors?: ReadonlyArray<{
      readonly domain?: string
      readonly reason?: string
      readonly message?: string
    }>
  }
}

/**
 * The token endpoint's envelope, which is not the API's: `error` is a bare
 * string such as `invalid_grant`, not an object.
 */
export interface GoogleOAuthErrorBody {
  readonly error?: unknown
  readonly error_description?: string
  readonly error_subtype?: string
}

export interface GoogleErrorClass {
  readonly failureClass: FailureClass
  readonly code?: ErrorCode
  /** When retrying makes sense, how long to wait first. */
  readonly retryAfterSeconds?: number
}

/** The project's quota for the day is spent. Comes back at midnight Pacific. */
const QUOTA_REASONS: ReadonlySet<string> = new Set(['quotaExceeded', 'dailyLimitExceeded'])

/** Too many calls in a short window. A throttle, not a verdict on the content. */
const RATE_REASONS: ReadonlySet<string> = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'uploadRateLimitExceeded',
])

/**
 * The account has no channel to act as. `youtubeSignupRequired` arrives as a
 * 401, which a status-only reading would call an expired token; reconnecting
 * cannot create a channel, so it is permanent with its own diagnosis.
 */
const NO_CHANNEL_REASONS: ReadonlySet<string> = new Set([
  'youtubeSignupRequired',
  'authenticatedUserNotChannel',
])

/**
 * How long a channel waits after hitting its own daily upload limit. YouTube
 * does not document when that limit resets, so a full day is the safe guess:
 * too early only burns another attempt, while the worker's attempt cap stops a
 * channel that stays blocked. Unverified.
 */
const CHANNEL_LIMIT_RETRY_SECONDS = 86_400

/** Google's own name for the failure, when it gives one. */
export function googleReason(body: GoogleErrorBody): string | undefined {
  return body.error?.errors?.[0]?.reason
}

/**
 * Seconds until Google's daily quotas reset, which is midnight Pacific time
 * (Google's quota page, checked 2026-10-02).
 *
 * Reads the wall clock in Los Angeles rather than assuming a fixed offset, so
 * daylight saving is handled by the time zone database. On the two days a year
 * the clocks change the answer can be an hour out; an hour late is harmless,
 * and an hour early earns one more quota error, which computes the right wait
 * from then. Five minutes are added so the retry lands after the reset rather
 * than on it.
 */
export function secondsUntilQuotaReset(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')
  const elapsed = (part('hour') % 24) * 3600 + part('minute') * 60 + part('second')
  return 86_400 - elapsed + 300
}

/**
 * Classifies an API error.
 *
 * The fallbacks matter as much as the named reasons. A 401 with no specific
 * reason means Google refused the token, so it is a credential problem. Any
 * other 403 is treated as permanent rather than as a credential failure: an
 * unrecognised refusal is far more often a rule about the request than a dead
 * token, and calling it a token problem sends the owner off to reconnect for
 * nothing.
 */
export function classifyGoogleError(
  body: GoogleErrorBody,
  httpStatus: number,
  now: Date = new Date(),
): GoogleErrorClass {
  const reason = googleReason(body)

  if (reason !== undefined) {
    if (QUOTA_REASONS.has(reason)) {
      return {
        failureClass: 'transient',
        code: 'QUOTA_EXHAUSTED',
        retryAfterSeconds: secondsUntilQuotaReset(now),
      }
    }
    if (RATE_REASONS.has(reason)) return { failureClass: 'transient', code: 'RATE_LIMITED' }
    if (reason === 'uploadLimitExceeded') {
      // A 400, but not a malformed request: the channel's own daily cap, which
      // is entirely separate from the project's API quota.
      return {
        failureClass: 'transient',
        code: 'YOUTUBE_CHANNEL_UPLOAD_LIMIT',
        retryAfterSeconds: CHANNEL_LIMIT_RETRY_SECONDS,
      }
    }
    if (reason === 'insufficientPermissions') {
      // Refreshing cannot add a permission that was never granted.
      return { failureClass: 'permanent', code: 'GOOGLE_SCOPE_NOT_GRANTED' }
    }
    if (reason === 'accessNotConfigured') {
      return { failureClass: 'permanent', code: 'GOOGLE_API_NOT_ENABLED' }
    }
    if (NO_CHANNEL_REASONS.has(reason)) return { failureClass: 'permanent', code: 'YOUTUBE_NO_CHANNEL' }
  }

  if (httpStatus === 401) return { failureClass: 'credential', code: 'GOOGLE_TOKEN_REVOKED' }
  if (httpStatus === 429) return { failureClass: 'transient', code: 'RATE_LIMITED' }
  if (httpStatus >= 500) return { failureClass: 'transient' }
  return { failureClass: 'permanent' }
}

/**
 * Classifies a refusal from Google's token endpoint.
 *
 * `invalid_grant` is the one that means the authorisation is gone — revoked,
 * expired after 7 days in Testing, unused for six months, or pushed out by
 * newer tokens. Everything else that is not a server fault (`invalid_client`,
 * `unauthorized_client`, `deleted_client`, `invalid_request`) is a problem with
 * the app's own configuration: permanent, but not the person's token.
 *
 * Only a readable OAuth error is a verdict, because the vault marks a channel
 * dead on anything that is not transient. So a server fault or a throttle is
 * transient whatever its body says, and is checked first; and a reply with no
 * OAuth error in it at all (an empty body, an HTML page from a proxy or a
 * captive portal) is transient too: it is not Google's answer to anything.
 */
export function classifyGoogleOAuthError(body: GoogleOAuthErrorBody, httpStatus: number): GoogleErrorClass {
  if (httpStatus === 429 || httpStatus >= 500) return { failureClass: 'transient' }
  if (body.error === 'invalid_grant') return { failureClass: 'credential', code: 'GOOGLE_TOKEN_REVOKED' }
  if (typeof body.error !== 'string') return { failureClass: 'transient' }
  return { failureClass: 'permanent' }
}

/**
 * A `Retry-After` header as seconds. It may be a number of seconds or an
 * HTTP date; anything unreadable is ignored rather than guessed at.
 */
export function parseRetryAfter(value: string | null | undefined, now: Date = new Date()): number | undefined {
  if (value === null || value === undefined || value.trim() === '') return undefined
  if (/^\d+$/.test(value.trim())) return Number(value.trim())
  const at = Date.parse(value)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000))
}

/**
 * Builds a PublishError from a Google API error response.
 *
 * Google's own message is passed through verbatim as the platform message —
 * never paraphrased, because a reworded platform error is a support ticket
 * nobody can trace. The reason becomes the platform code. A `Retry-After`
 * header, when present, wins over any wait computed here: it is the platform's
 * own instruction.
 */
export function googleError(
  body: GoogleErrorBody,
  httpStatus: number,
  options: { readonly what: string; readonly retryAfter?: string | null; readonly now?: Date },
): PublishError {
  const now = options.now ?? new Date()
  const classified = classifyGoogleError(body, httpStatus, now)
  const reason = googleReason(body)
  const platformMessage =
    body.error?.message ?? body.error?.errors?.[0]?.message ?? `Google returned HTTP ${httpStatus}`
  const retryAfterSeconds = parseRetryAfter(options.retryAfter, now) ?? classified.retryAfterSeconds

  return new PublishError(`${options.what} failed: ${platformMessage}`, {
    failureClass: classified.failureClass,
    platformMessage,
    ...(reason !== undefined ? { platformCode: reason } : {}),
    httpStatus,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    ...(classified.code !== undefined ? { code: classified.code } : {}),
  })
}
