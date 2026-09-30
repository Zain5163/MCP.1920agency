/**
 * Error classification. This is the reliability feature of the whole system.
 *
 * Retrying a permanent failure forever is the most common failure mode in
 * self-hosted schedulers, and silent failure is why people abandon them. Every
 * adapter failure must land in exactly one of these three classes.
 */

export type FailureClass =
  /** 5xx, timeout, connection reset, rate limit. Back off and retry. */
  | 'transient'
  /** Token expired or revoked. Try one refresh, then stop and ask the user. */
  | 'credential'
  /** Caption too long, bad aspect ratio, policy rejection. Never retry. */
  | 'permanent'

export class PublishError extends Error {
  readonly failureClass: FailureClass
  /** The platform's own message, shown to the user verbatim. Never paraphrased. */
  readonly platformMessage: string | undefined
  readonly platformCode: string | undefined
  readonly httpStatus: number | undefined
  /** Honour a platform's Retry-After rather than guessing. */
  readonly retryAfterSeconds: number | undefined

  constructor(
    message: string,
    options: {
      failureClass: FailureClass
      platformMessage?: string
      platformCode?: string
      httpStatus?: number
      retryAfterSeconds?: number
      cause?: unknown
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'PublishError'
    this.failureClass = options.failureClass
    this.platformMessage = options.platformMessage
    this.platformCode = options.platformCode
    this.httpStatus = options.httpStatus
    this.retryAfterSeconds = options.retryAfterSeconds
  }

  get isRetryable(): boolean {
    return this.failureClass === 'transient'
  }
}

/**
 * Default classification from an HTTP status, for adapters that have no more
 * specific signal. Adapters SHOULD override this using the platform's own error
 * codes — a Meta subcode is far more reliable than a bare 400.
 *
 * 4xx defaults to permanent: retrying a request the platform already rejected as
 * malformed just burns quota. 401/403 are credential problems, and 429 is the one
 * 4xx that is genuinely transient.
 */
export function classifyHttpStatus(status: number): FailureClass {
  if (status === 401 || status === 403) return 'credential'
  if (status === 429) return 'transient'
  if (status >= 500) return 'transient'
  if (status >= 400) return 'permanent'
  return 'permanent'
}

/** Network-level failures with no HTTP response are always worth retrying. */
/**
 * Whether a failure to reach a platform is worth retrying.
 *
 * Walks the `cause` chain rather than reading only the top-level error. Node's
 * `fetch` never throws the network error itself: it throws `TypeError: fetch
 * failed` and puts the `ECONNRESET` one level down, in `cause`. Reading only the
 * top level classified **every dropped connection as permanent**, so the worker
 * never retried a post that failed on a network blip. Found 2026-09-30 when a
 * Meta ads call reset mid-run and came back labelled permanent.
 *
 * The depth limit guards against a cause cycle, which is legal JavaScript.
 */
export function classifyNetworkError(error: unknown): FailureClass {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    const code = (current as { code?: string }).code
    if (code !== undefined && RETRYABLE_NETWORK_CODES.has(code)) return 'transient'
    current = (current as { cause?: unknown }).cause
  }
  return 'permanent'
}

const RETRYABLE_NETWORK_CODES: ReadonlySet<string> = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET',
])

/**
 * Exponential backoff with full jitter, capped.
 *
 * Full jitter (rather than a fixed exponential) matters because many targets are
 * queued at the same scheduled minute. Without jitter they retry in lockstep and
 * hammer the platform in synchronised waves, which is how you earn a rate limit.
 */
export function backoffMs(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const base = options.baseMs ?? 30_000
  const max = options.maxMs ?? 6 * 60 * 60 * 1000
  const random = options.random ?? Math.random
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1))
  return Math.floor(random() * exponential)
}
