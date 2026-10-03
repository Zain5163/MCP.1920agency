import {
  PublishError,
  backoffMs,
  type Connection,
  type ErrorCode,
  type Platform,
  type PlatformAdapter,
  type PostDraft,
  type PublishResult,
  type ValidationIssue,
} from '@social-publisher/core'

/**
 * The single publishing implementation.
 *
 * It lives in its own package rather than inside the MCP server so that a worker,
 * a CLI, or a future UI all drive publishing through the same code. The
 * architecture's rule was "the MCP server must not be a second implementation";
 * with no web API to be a client of, this package is what keeps that true.
 */

export interface TargetSpec {
  readonly connection: Connection
  /**
   * Resolved by the caller from the vault. Never loaded here.
   *
   * The caller may hand `fn` a second argument, `renew`: it renews the
   * credential from inside the same vault callback, stores it, and resolves to
   * the new access token. It reaches the adapter as
   * `PublishContext.renewAccessToken`, so an upload that outlasts its token
   * can carry on instead of starting again. Optional, and added after the
   * fact: a caller that cannot renew passes only the token, and every adapter
   * behaves as before.
   */
  readonly withCredential: <T>(fn: (accessToken: string, renew?: () => Promise<string>) => Promise<T>) => Promise<T>
}

export interface TargetOutcome {
  readonly connectionId: string
  readonly platform: Platform
  readonly displayName: string
  readonly ok: boolean
  /** Includes the adapter's `notice`, which every caller must show. */
  readonly result?: PublishResult
  readonly error?: {
    readonly failureClass: string
    readonly message: string
    readonly platformCode?: string
    /** The catalogue entry the adapter named, when it could tell. Prefer it over the class. */
    readonly code?: ErrorCode
    readonly retryable: boolean
    readonly retryAfterMs?: number
  }
}

export interface PublishReport {
  readonly allSucceeded: boolean
  readonly succeeded: readonly TargetOutcome[]
  readonly failed: readonly TargetOutcome[]
}

export interface ValidationReport {
  readonly ok: boolean
  readonly byPlatform: ReadonlyMap<Platform, readonly ValidationIssue[]>
}

export class PublishService {
  readonly #adapters: ReadonlyMap<Platform, PlatformAdapter>

  constructor(adapters: readonly PlatformAdapter[]) {
    this.#adapters = new Map(adapters.map((a) => [a.platform, a]))
  }

  adapterFor(platform: Platform): PlatformAdapter | undefined {
    return this.#adapters.get(platform)
  }

  supportedPlatforms(): Platform[] {
    return [...this.#adapters.keys()]
  }

  /**
   * Validates a draft against every target before anything is published.
   *
   * Run this first and show the result: catching "too long for X" here costs
   * nothing, whereas catching it during publish means a partial post — three
   * platforms live and two failed, with the content already public.
   */
  validate(draft: PostDraft, platforms: readonly Platform[]): ValidationReport {
    const byPlatform = new Map<Platform, readonly ValidationIssue[]>()
    let ok = true

    for (const platform of platforms) {
      const adapter = this.#adapters.get(platform)
      if (adapter === undefined) {
        ok = false
        byPlatform.set(platform, [
          {
            severity: 'error',
            code: 'unsupported_platform',
            message: `No adapter is built for ${platform} yet.`,
            platform,
          },
        ])
        continue
      }
      const result = adapter.validate(draft)
      if (!result.ok) ok = false
      byPlatform.set(platform, result.issues)
    }

    return { ok, byPlatform }
  }

  /**
   * Publishes to every target.
   *
   * Targets are independent: one platform failing must never prevent the others
   * from going out. "It partly worked" is the normal case, so the report always
   * separates what succeeded from what did not rather than throwing on first error.
   */
  async publish(
    draft: PostDraft,
    targets: readonly TargetSpec[],
    options: { idempotencyKeyFor: (connectionId: string) => string; signal?: AbortSignal } = {
      idempotencyKeyFor: (id) => id,
    },
  ): Promise<PublishReport> {
    const outcomes = await Promise.all(
      targets.map(async (target) => await this.#publishOne(draft, target, options)),
    )

    const succeeded = outcomes.filter((o) => o.ok)
    const failed = outcomes.filter((o) => !o.ok)
    return { allSucceeded: failed.length === 0, succeeded, failed }
  }

  async #publishOne(
    draft: PostDraft,
    target: TargetSpec,
    options: { idempotencyKeyFor: (connectionId: string) => string; signal?: AbortSignal },
  ): Promise<TargetOutcome> {
    const { connection } = target
    const base = {
      connectionId: connection.id,
      platform: connection.platform,
      displayName: connection.displayName,
    }

    const adapter = this.#adapters.get(connection.platform)
    if (adapter === undefined) {
      return {
        ...base,
        ok: false,
        error: {
          failureClass: 'permanent',
          message: `No adapter is built for ${connection.platform} yet.`,
          retryable: false,
        },
      }
    }

    // A connection already known to be dead should not be attempted: it wastes a
    // call and produces a confusing platform error instead of a clear instruction.
    if (connection.needsReauth) {
      return {
        ...base,
        ok: false,
        error: {
          failureClass: 'credential',
          message: `${connection.displayName} needs reconnecting. Run the connect command.`,
          retryable: false,
        },
      }
    }

    try {
      const result = await target.withCredential(async (accessToken, renew) => {
        const ctx = {
          connection,
          credential: { accessToken },
          idempotencyKey: options.idempotencyKeyFor(connection.id),
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
          ...(renew !== undefined ? { renewAccessToken: renew } : {}),
        }
        return await adapter.publish(ctx, draft)
      })
      return { ...base, ok: true, result }
    } catch (error) {
      return { ...base, ok: false, error: describeError(error) }
    }
  }
}

function describeError(error: unknown): NonNullable<TargetOutcome['error']> {
  if (error instanceof PublishError) {
    const retryAfterMs =
      error.retryAfterSeconds !== undefined ? error.retryAfterSeconds * 1000 : backoffMs(1)
    return {
      failureClass: error.failureClass,
      // The platform's own wording, never paraphrased — a reworded error is a
      // support ticket nobody can trace back to the platform.
      message: error.platformMessage ?? error.message,
      ...(error.platformCode !== undefined ? { platformCode: error.platformCode } : {}),
      ...(error.code !== undefined ? { code: error.code } : {}),
      retryable: error.isRetryable,
      ...(error.isRetryable ? { retryAfterMs } : {}),
    }
  }

  /**
   * The vault refusing a dead credential is a credential failure, not a
   * rejection of the post. Reported as `permanent`, the worker filed the target
   * as failed rather than needing reconnection, and the MCP server told the user
   * the platform had refused the content — when the fix was to reconnect.
   *
   * Matched by name because this package does not depend on the vault. When the
   * vault gives the refusal behind it — say, Google revoking the token — its
   * code and wording are carried along, so the diagnosis can be specific.
   */
  if (error instanceof Error && error.name === 'NeedsReauthError') {
    const cause = error.cause instanceof PublishError ? error.cause : undefined
    const because = cause?.platformMessage ?? cause?.message
    return {
      failureClass: 'credential',
      message: because !== undefined ? `${error.message} ${because}` : error.message,
      ...(cause?.platformCode !== undefined ? { platformCode: cause.platformCode } : {}),
      ...(cause?.code !== undefined ? { code: cause.code } : {}),
      retryable: false,
    }
  }

  return {
    failureClass: 'permanent',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  }
}
