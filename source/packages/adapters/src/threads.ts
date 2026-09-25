import {
  CAPABILITIES,
  PublishError,
  bodyForPlatform,
  classifyNetworkError,
  validateAgainstCapabilities,
  type Capabilities,
  type MediaRef,
  type Platform,
  type PlatformAdapter,
  type PostDraft,
  type PublishContext,
  type PublishResult,
  type ValidationResult,
} from '@social-publisher/core'

import { graphError, type GraphErrorBody } from './meta-errors.ts'

/**
 * Threads adapter.
 *
 * **Not the Facebook Graph API.** Threads lives at `graph.threads.net` with its
 * own OAuth, its own scopes (`threads_basic`, `threads_content_publish`) and a
 * Meta app configured for the Threads use case specifically. Assuming it rides on
 * an existing Facebook authorisation is a mistake that only shows up at the first
 * real call.
 *
 * The publish shape is the same two-step container flow as Instagram — create,
 * wait, publish — because both are Meta. Media must be at a public URL; there is
 * no upload path.
 */

export const THREADS_API_VERSION = 'v1.0'
const THREADS_BASE = 'https://graph.threads.net'

type ContainerStatus = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED'

export interface ThreadsAdapterOptions {
  readonly apiVersion?: string
  readonly fetch?: typeof globalThis.fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly processingTimeoutMs?: number
  readonly pollIntervalMs?: number
}

export class ThreadsAdapter implements PlatformAdapter {
  readonly platform: Platform = 'threads'
  readonly capabilities: Capabilities = CAPABILITIES.threads

  readonly #apiVersion: string
  readonly #fetch: typeof globalThis.fetch
  readonly #sleep: (ms: number) => Promise<void>
  readonly #timeoutMs: number
  readonly #pollMs: number

  constructor(options: ThreadsAdapterOptions = {}) {
    this.#apiVersion = options.apiVersion ?? THREADS_API_VERSION
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.#timeoutMs = options.processingTimeoutMs ?? 5 * 60 * 1000
    this.#pollMs = options.pollIntervalMs ?? 3000
  }

  validate(draft: PostDraft): ValidationResult {
    return validateAgainstCapabilities(draft, this.platform, this.capabilities)
  }

  async publish(ctx: PublishContext, draft: PostDraft): Promise<PublishResult> {
    const validation = this.validate(draft)
    if (!validation.ok) {
      const first = validation.issues.find((i) => i.severity === 'error')
      throw new PublishError(`Draft is not valid for Threads: ${first?.message ?? 'unknown'}`, {
        failureClass: 'permanent',
        ...(first?.message !== undefined ? { platformMessage: first.message } : {}),
        ...(first?.code !== undefined ? { platformCode: first.code } : {}),
      })
    }

    const userId = ctx.connection.platformAccountId
    const text = bodyForPlatform(draft, this.platform)

    const containerId =
      draft.media.length > 1
        ? await this.#createCarousel(ctx, userId, text, draft.media)
        : await this.#createSingle(ctx, userId, text, draft.media[0])

    await this.#waitUntilReady(ctx, containerId)

    const published = await this.#post<{ id: string }>(
      ctx,
      `${userId}/threads_publish`,
      new URLSearchParams({ creation_id: containerId }),
    )

    return {
      platformPostId: published.id,
      url: `https://www.threads.net/@${ctx.connection.displayName}/post/${published.id}`,
    }
  }

  // ---- containers ----------------------------------------------------------

  async #createSingle(
    ctx: PublishContext,
    userId: string,
    text: string,
    media: MediaRef | undefined,
  ): Promise<string> {
    const params = new URLSearchParams({ text })

    if (media === undefined) {
      // Threads, unlike Instagram, is happy with text alone.
      params.set('media_type', 'TEXT')
    } else {
      this.#setMedia(params, media)
      params.set('media_type', media.kind === 'video' ? 'VIDEO' : 'IMAGE')
    }

    const created = await this.#post<{ id: string }>(ctx, `${userId}/threads`, params)
    return created.id
  }

  async #createCarousel(
    ctx: PublishContext,
    userId: string,
    text: string,
    media: readonly MediaRef[],
  ): Promise<string> {
    const childIds: string[] = []
    for (const item of media) {
      const params = new URLSearchParams({ is_carousel_item: 'true' })
      this.#setMedia(params, item)
      params.set('media_type', item.kind === 'video' ? 'VIDEO' : 'IMAGE')
      const child = await this.#post<{ id: string }>(ctx, `${userId}/threads`, params)
      childIds.push(child.id)
    }

    // Children must finish processing before the parent accepts them.
    for (const childId of childIds) await this.#waitUntilReady(ctx, childId)

    const parent = new URLSearchParams({
      media_type: 'CAROUSEL',
      text,
      children: childIds.join(','),
    })
    const created = await this.#post<{ id: string }>(ctx, `${userId}/threads`, parent)
    return created.id
  }

  #setMedia(params: URLSearchParams, media: MediaRef): void {
    if (media.publicUrl === undefined) {
      throw new PublishError(
        'Threads fetches media over HTTPS and cannot accept a local file. Configure media hosting.',
        { failureClass: 'permanent' },
      )
    }
    params.set(media.kind === 'video' ? 'video_url' : 'image_url', media.publicUrl)
  }

  /**
   * Waits for processing, exactly as Instagram requires.
   *
   * A text-only container is ready immediately, but polling it once costs little
   * and keeps one code path rather than two that can drift.
   */
  async #waitUntilReady(ctx: PublishContext, containerId: string): Promise<void> {
    const deadline = Date.now() + this.#timeoutMs

    for (;;) {
      const info = await this.#get<{ status?: ContainerStatus; error_message?: string }>(
        ctx,
        containerId,
        new URLSearchParams({ fields: 'status,error_message' }),
      )
      const status = info.status ?? 'FINISHED'

      if (status === 'FINISHED' || status === 'PUBLISHED') return

      if (status === 'ERROR') {
        throw new PublishError('Threads could not process the media', {
          failureClass: 'permanent',
          platformMessage: info.error_message ?? 'The media failed Threads processing.',
        })
      }
      if (status === 'EXPIRED') {
        throw new PublishError('The Threads container expired before publishing', {
          failureClass: 'permanent',
          platformMessage: 'Container expired. Re-create the post.',
        })
      }

      if (Date.now() + this.#pollMs > deadline) {
        throw new PublishError('Threads is still processing the media', {
          failureClass: 'transient',
          platformMessage: 'Media processing did not finish in time.',
        })
      }
      await this.#sleep(this.#pollMs)
    }
  }

  // ---- plumbing ------------------------------------------------------------

  async #post<T>(ctx: PublishContext, path: string, params: URLSearchParams): Promise<T> {
    return await this.#request<T>(ctx, path, { method: 'POST', body: params })
  }

  async #get<T>(ctx: PublishContext, path: string, params: URLSearchParams): Promise<T> {
    return await this.#request<T>(ctx, `${path}?${params.toString()}`, { method: 'GET' })
  }

  async #request<T>(ctx: PublishContext, path: string, init: RequestInit): Promise<T> {
    const url = `${THREADS_BASE}/${this.#apiVersion}/${path}`

    let response: Response
    try {
      const headers: Record<string, string> = {
        // Token in the header, never the query string — URLs reach logs and proxies.
        Authorization: `Bearer ${ctx.credential.accessToken}`,
      }
      if (init.method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded'

      const full: RequestInit = { ...init, headers }
      if (ctx.signal !== undefined) full.signal = ctx.signal
      response = await this.#fetch(url, full)
    } catch (cause) {
      throw new PublishError('Could not reach the Threads API', {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      throw new PublishError('Threads returned a response that was not JSON', {
        failureClass: response.ok ? 'permanent' : 'transient',
        httpStatus: response.status,
        platformMessage: text.slice(0, 200),
      })
    }

    if (!response.ok || (parsed as GraphErrorBody).error !== undefined) {
      // Threads reuses Meta's error envelope, so the same classifier applies.
      throw graphError(parsed as GraphErrorBody, response.status)
    }
    return parsed as T
  }
}
