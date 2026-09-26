import { createHmac } from 'node:crypto'

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
 * Instagram adapter (Content Publishing API).
 *
 * Fundamentally different from Facebook in one way that shapes everything here:
 * **Instagram fetches media from a public URL rather than accepting an upload.**
 * There is no way to POST bytes. That is why object storage (R2) is a hard
 * requirement for Instagram and not for Facebook.
 *
 * Publishing is always two phases, never one call:
 *
 *   1. CREATE a container -> Instagram starts downloading and transcoding the media
 *   2. WAIT for the container to report FINISHED
 *   3. PUBLISH the container
 *
 * Skipping step 2 is the classic bug: publishing a container that is still
 * IN_PROGRESS fails with an error that looks like a permissions problem. Images are
 * usually ready immediately; video routinely takes 10-60 seconds.
 */

export const INSTAGRAM_API_VERSION = 'v25.0'
const GRAPH_BASE = 'https://graph.facebook.com'

/**
 * The other way in.
 *
 * Instagram authorised directly — no Facebook Page — speaks to its own host with
 * its own token. Same platform, same publishing flow, different address. See
 * `decisions/0004`.
 *
 * Sending a direct-Instagram token to graph.facebook.com fails with an auth
 * error that says nothing about the host being wrong, which is why this is
 * chosen from the connection rather than guessed.
 */
const INSTAGRAM_DIRECT_BASE = 'https://graph.instagram.com'

/** The provider key set on connections authorised through Instagram itself. */
const DIRECT_PROVIDER_KEY = 'instagram'

type ContainerStatus = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED'

export interface InstagramAdapterOptions {
  readonly apiVersion?: string
  readonly appSecret?: string
  readonly fetch?: typeof globalThis.fetch
  /** Injected so tests do not actually wait. */
  readonly sleep?: (ms: number) => Promise<void>
  /** How long to wait for media processing before giving up. Default 5 minutes. */
  readonly processingTimeoutMs?: number
  readonly pollIntervalMs?: number
}

export class InstagramAdapter implements PlatformAdapter {
  readonly platform: Platform = 'instagram'
  readonly capabilities: Capabilities = CAPABILITIES.instagram

  readonly #apiVersion: string
  readonly #appSecret: string | undefined
  readonly #fetch: typeof globalThis.fetch
  readonly #sleep: (ms: number) => Promise<void>
  readonly #timeoutMs: number
  readonly #pollMs: number

  constructor(options: InstagramAdapterOptions = {}) {
    this.#apiVersion = options.apiVersion ?? INSTAGRAM_API_VERSION
    this.#appSecret = options.appSecret
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
      throw new PublishError(`Draft is not valid for Instagram: ${first?.message ?? 'unknown'}`, {
        failureClass: 'permanent',
        ...(first?.message !== undefined ? { platformMessage: first.message } : {}),
        ...(first?.code !== undefined ? { platformCode: first.code } : {}),
      })
    }

    const igUserId = ctx.connection.platformAccountId
    const caption = bodyForPlatform(draft, this.platform)

    const containerId =
      draft.media.length > 1
        ? await this.#createCarousel(ctx, igUserId, caption, draft.media)
        : await this.#createSingle(ctx, igUserId, caption, draft.media[0]!)

    await this.#waitUntilReady(ctx, containerId)
    return await this.#publishContainer(ctx, igUserId, containerId)
  }

  // ---- container creation --------------------------------------------------

  async #createSingle(
    ctx: PublishContext,
    igUserId: string,
    caption: string,
    media: MediaRef,
  ): Promise<string> {
    const params = new URLSearchParams({ caption })
    this.#setMedia(params, media)
    // Single videos publish as Reels — Instagram retired the standalone video feed
    // post, and REELS is the supported media_type for video via the API.
    if (media.kind === 'video') params.set('media_type', 'REELS')

    const created = await this.#post<{ id: string }>(ctx, `${igUserId}/media`, params)
    return created.id
  }

  /**
   * Carousels are three phases: a container per child, then a parent container
   * listing them, then publish the parent.
   */
  async #createCarousel(
    ctx: PublishContext,
    igUserId: string,
    caption: string,
    media: readonly MediaRef[],
  ): Promise<string> {
    const childIds: string[] = []
    for (const item of media) {
      const params = new URLSearchParams({ is_carousel_item: 'true' })
      this.#setMedia(params, item)
      const child = await this.#post<{ id: string }>(ctx, `${igUserId}/media`, params)
      childIds.push(child.id)
    }

    // Children must finish processing before the parent will accept them.
    for (const childId of childIds) await this.#waitUntilReady(ctx, childId)

    const parent = new URLSearchParams({
      media_type: 'CAROUSEL',
      caption,
      children: childIds.join(','),
    })
    const created = await this.#post<{ id: string }>(ctx, `${igUserId}/media`, parent)
    return created.id
  }

  #setMedia(params: URLSearchParams, media: MediaRef): void {
    if (media.publicUrl === undefined) {
      // Caught in validate(), but restated here because the consequence is subtle:
      // there is no upload path to fall back to, unlike Facebook.
      throw new PublishError(
        'Instagram fetches media over HTTPS and cannot accept a local file. Configure R2 media hosting.',
        { failureClass: 'permanent' },
      )
    }
    params.set(media.kind === 'video' ? 'video_url' : 'image_url', media.publicUrl)
  }

  // ---- processing ----------------------------------------------------------

  /**
   * Polls until the container reports FINISHED.
   *
   * Publishing an IN_PROGRESS container fails with a misleading error, so this
   * wait is not an optimisation — it is required for correctness.
   */
  async #waitUntilReady(ctx: PublishContext, containerId: string): Promise<void> {
    const deadline = Date.now() + this.#timeoutMs

    for (;;) {
      const params = new URLSearchParams({ fields: 'status_code,status' })
      const info = await this.#get<{ status_code?: ContainerStatus; status?: string }>(
        ctx,
        containerId,
        params,
      )
      const status = info.status_code ?? 'IN_PROGRESS'

      if (status === 'FINISHED') return
      if (status === 'PUBLISHED') return

      if (status === 'ERROR') {
        throw new PublishError('Instagram could not process the media', {
          failureClass: 'permanent',
          platformMessage: info.status ?? 'The media failed Instagram processing.',
        })
      }
      if (status === 'EXPIRED') {
        // Containers expire after 24h; only reachable if publishing stalled badly.
        throw new PublishError('The Instagram media container expired before publishing', {
          failureClass: 'permanent',
          platformMessage: 'Container expired. Re-create the post.',
        })
      }

      if (Date.now() + this.#pollMs > deadline) {
        // Transient: the media may simply be large. A retry re-uploads and works.
        throw new PublishError('Instagram is still processing the media', {
          failureClass: 'transient',
          platformMessage: 'Media processing did not finish in time.',
        })
      }
      await this.#sleep(this.#pollMs)
    }
  }

  async #publishContainer(
    ctx: PublishContext,
    igUserId: string,
    containerId: string,
  ): Promise<PublishResult> {
    const params = new URLSearchParams({ creation_id: containerId })
    const published = await this.#post<{ id: string }>(ctx, `${igUserId}/media_publish`, params)
    return {
      platformPostId: published.id,
      url: `https://www.instagram.com/p/${published.id}`,
    }
  }

  /** Remaining posts in the rolling 24h window. Instagram allows 100 (verified 2026-09-25). */
  async remainingQuota(ctx: PublishContext): Promise<number | undefined> {
    try {
      const params = new URLSearchParams({ fields: 'quota_usage,config' })
      const info = await this.#get<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(
        ctx,
        `${ctx.connection.platformAccountId}/content_publishing_limit`,
        params,
      )
      const row = info.data?.[0]
      if (row?.quota_usage === undefined) return undefined
      // 100, not 50 — the 50 figure is stale and widely repeated.
      return (row.config?.quota_total ?? 100) - row.quota_usage
    } catch {
      // Advisory only — never let a quota check block a publish.
      return undefined
    }
  }

  // ---- plumbing ------------------------------------------------------------

  #sign(params: URLSearchParams, accessToken: string): void {
    if (this.#appSecret !== undefined) {
      params.set(
        'appsecret_proof',
        createHmac('sha256', this.#appSecret).update(accessToken).digest('hex'),
      )
    }
  }

  async #post<T>(ctx: PublishContext, path: string, params: URLSearchParams): Promise<T> {
    this.#sign(params, ctx.credential.accessToken)
    return await this.#request<T>(ctx, path, { method: 'POST', body: params })
  }

  async #get<T>(ctx: PublishContext, path: string, params: URLSearchParams): Promise<T> {
    this.#sign(params, ctx.credential.accessToken)
    return await this.#request<T>(ctx, `${path}?${params.toString()}`, { method: 'GET' })
  }

  /**
   * Which Instagram this connection is.
   *
   * A connection made through a Facebook Page carries the provider that created
   * it — 'meta' — while one authorised through Instagram itself carries
   * 'instagram'. Older connections predate the field entirely; they were all made
   * through a Page, so the Page host is the right default.
   */
  #baseFor(ctx: PublishContext): string {
    return ctx.connection.providerKey === DIRECT_PROVIDER_KEY
      ? INSTAGRAM_DIRECT_BASE
      : GRAPH_BASE
  }

  async #request<T>(ctx: PublishContext, path: string, init: RequestInit): Promise<T> {
    const url = `${this.#baseFor(ctx)}/${this.#apiVersion}/${path}`

    let response: Response
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${ctx.credential.accessToken}`,
      }
      if (init.method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded'

      const full: RequestInit = { ...init, headers }
      if (ctx.signal !== undefined) full.signal = ctx.signal
      response = await this.#fetch(url, full)
    } catch (cause) {
      throw new PublishError('Could not reach the Instagram Graph API', {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      throw new PublishError('Instagram returned a response that was not JSON', {
        failureClass: response.ok ? 'permanent' : 'transient',
        httpStatus: response.status,
        platformMessage: text.slice(0, 200),
      })
    }

    if (!response.ok || (parsed as GraphErrorBody).error !== undefined) {
      throw graphError(parsed as GraphErrorBody, response.status)
    }
    return parsed as T
  }
}
