import { PublishError, type FailureClass } from '@social-publisher/core'

/**
 * Meta Graph API error classification.
 *
 * Meta's own `error.code` and `error.error_subcode` are far more reliable than the
 * HTTP status — Graph returns 400 for an expired token, a rate limit and a
 * malformed field alike, and those need three different responses. Classifying on
 * the status alone would retry permanent failures and give up on transient ones.
 */

export interface GraphErrorBody {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    error_user_title?: string
    error_user_msg?: string
    fbtrace_id?: string
  }
}

/** Token is dead or the user revoked access. Refresh, or make them reconnect. */
const CREDENTIAL_CODES = new Set([
  102, // session key invalid / user logged out
  190, // access token expired, revoked, or invalid
  458, // app not installed
  459, // user checkpointed
  463, // token expired
  467, // token invalid (user changed password)
])

/** Worth retrying after a wait. */
const TRANSIENT_CODES = new Set([
  1, // unknown/transient
  2, // service temporarily unavailable
  4, // application request limit reached
  17, // user request limit reached
  32, // page request limit reached
  341, // application limit reached
  613, // calls to this API have exceeded the rate limit
])

/**
 * Permission problems. Classified as `permanent` rather than `credential` because
 * refreshing the token will not add a scope the user never granted — the fix is a
 * new authorisation with different permissions, not a silent retry.
 */
const PERMISSION_CODES = new Set([
  3, // app does not have permission for this action
  10, // permission denied
  200, // permissions error
  283, // missing a required permission
])

export function classifyGraphError(body: GraphErrorBody, httpStatus: number): FailureClass {
  const code = body.error?.code
  const subcode = body.error?.error_subcode

  if (code !== undefined) {
    if (CREDENTIAL_CODES.has(code)) return 'credential'
    if (TRANSIENT_CODES.has(code)) return 'transient'
    if (PERMISSION_CODES.has(code)) return 'permanent'

    // Subcode 2069004 on an otherwise generic code means a temporary block.
    if (subcode === 2069004) return 'permanent'

    // Code 100 is "invalid parameter" — a malformed request that will fail again.
    if (code === 100) return 'permanent'

    // 368 = temporarily blocked for policy violations. Retrying compounds it.
    if (code === 368) return 'permanent'
  }

  if (httpStatus === 429) return 'transient'
  if (httpStatus >= 500) return 'transient'
  if (httpStatus === 401 || httpStatus === 403) return 'credential'
  return 'permanent'
}

/**
 * Builds a PublishError from a Graph response.
 *
 * `error_user_msg` is Meta's human-facing text and is preferred for display —
 * `message` is often developer jargon. Whichever is used is passed through
 * verbatim, never paraphrased, because a reworded platform error is a support
 * ticket nobody can trace.
 */
export function graphError(body: GraphErrorBody, httpStatus: number): PublishError {
  const failureClass = classifyGraphError(body, httpStatus)
  const err = body.error ?? {}
  const platformMessage = err.error_user_msg ?? err.message ?? 'Unknown Graph API error'

  const codeParts = [err.code, err.error_subcode].filter((p) => p !== undefined)

  return new PublishError(`Facebook publish failed: ${platformMessage}`, {
    failureClass,
    platformMessage,
    ...(codeParts.length > 0 ? { platformCode: codeParts.join('/') } : {}),
    httpStatus,
  })
}
