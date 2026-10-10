import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

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
 * Facebook Page adapter.
 *
 * Chosen as the first adapter because Facebook accepts uploaded bytes, so it works
 * before object storage exists — Instagram cannot, since it fetches media from a
 * public URL.
 *
 * API VERSION: pinned below, overridable via META_API_VERSION.
 *
 * v25.0 was released 2026-02-18 and was the current version when checked on
 * 2026-09-23. Meta deprecates versions on a rolling ~2-year cycle (v19 went on
 * 2026-05-21, v20 on 2026-09-24), so recheck the changelog periodically:
 * https://developers.facebook.com/docs/graph-api/changelog/versions/
 *
 * Note: `AI-Automation\_archive\Meta-Ads-Publisher` (archived) pinned v23.0, which is now two versions
 * behind; it is archived, so nothing needs bumping there.
 */

export const DEFAULT_API_VERSION = 'v25.0'
const GRAPH_BASE = 'https://graph.facebook.com'

export interface FacebookAdapterOptions {
  readonly apiVersion?: string
  /**
   * The Meta app secret. When supplied, every call is signed with
   * `appsecret_proof`.
   *
   * This is required if the app has "Require app secret" enabled in Advanced
   * Settings, and is good practice regardless: it means a stolen access token on
   * its own is not enough to act as our app.
   */
  readonly appSecret?: string
  /** Injected for tests; defaults to global fetch. */
  readonly fetch?: typeof globalThis.fetch
  /** Injected for tests; defaults to reading from disk. */
  readonly readMedia?: (media: MediaRef) => Promise<Uint8Array>
}

export class FacebookPageAdapter implements PlatformAdapter {
  readonly platform: Platform = 'facebook_page'
  readonly capabilities: Capabilities = CAPABILITIES.facebook_page

  readonly #apiVersion: string
  readonly #appSecret: string | undefined
  readonly #fetch: typeof globalThis.fetch
  readonly #readMedia: (media: MediaRef) => Promise<Uint8Array>

  constructor(options: FacebookAdapterOptions = {}) {
    this.#apiVersion = options.apiVersion ?? DEFAULT_API_VERSION
    this.#appSecret = options.appSecret
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#readMedia = options.readMedia ?? defaultReadMedia
  }

  validate(draft: PostDraft): ValidationResult {
    return validateAgainstCapabilities(draft, this.platform, this.capabilities)
  }

  async publish(ctx: PublishContext, draft: PostDraft): Promise<PublishResult> {
    // Refuse rather than publish something the platform will reject, so a bad draft
    // fails loudly here instead of burning a retry budget against Graph.
    const validation = this.validate(draft)
    if (!validation.ok) {
      const first = validation.issues.find((i) => i.severity === 'error')
      throw new PublishError(`Draft is not valid for Facebook: ${first?.message ?? 'unknown'}`, {
        failureClass: 'permanent',
        ...(first?.message !== undefined ? { platformMessage: first.message } : {}),
        ...(first?.code !== undefined ? { platformCode: first.code } : {}),
      })
    }

    const pageId = ctx.connection.platformAccountId
    const message = bodyForPlatform(draft, this.platform)
    const videos = draft.media.filter((m) => m.kind === 'video')
    const images = draft.media.filter((m) => m.kind === 'image')

    if (videos.length > 0) return await this.#publishVideo(ctx, pageId, message, videos[0]!)
    if (images.length === 1) return await this.#publishSinglePhoto(ctx, pageId, message, images[0]!)
    if (images.length > 1) return await this.#publishMultiPhoto(ctx, pageId, message, images)
    return await this.#publishText(ctx, pageId, message)
  }

  // ---- publish paths -------------------------------------------------------

  async #publishText(ctx: PublishContext, pageId: string, message: string): Promise<PublishResult> {
    const body = new FormData()
    body.set('message', message)
    const result = await this.#post<{ id: string }>(ctx, `${pageId}/feed`, body)
    return this.#toResult(result.id)
  }

  async #publishSinglePhoto(
    ctx: PublishContext,
    pageId: string,
    message: string,
    image: MediaRef,
  ): Promise<PublishResult> {
    const body = new FormData()
    body.set('caption', message)
    await this.#attachMedia(body, image, 'source')

    // post_id is the feed story; id is the photo object. The feed story is what a
    // user would open, so prefer it.
    const result = await this.#post<{ id: string; post_id?: string }>(ctx, `${pageId}/photos`, body)
    return this.#toResult(result.post_id ?? result.id)
  }

  /**
   * Multi-photo posts are a two-phase flow: upload each photo unpublished to get a
   * media_fbid, then create one feed story attaching them all. There is no single
   * call that does this.
   */
  async #publishMultiPhoto(
    ctx: PublishContext,
    pageId: string,
    message: string,
    images: readonly MediaRef[],
  ): Promise<PublishResult> {
    const mediaIds: string[] = []
    for (const image of images) {
      const body = new FormData()
      body.set('published', 'false')
      await this.#attachMedia(body, image, 'source')
      const uploaded = await this.#post<{ id: string }>(ctx, `${pageId}/photos`, body)
      mediaIds.push(uploaded.id)
    }

    const feed = new FormData()
    feed.set('message', message)
    mediaIds.forEach((id, index) => {
      feed.set(`attached_media[${index}]`, JSON.stringify({ media_fbid: id }))
    })

    const result = await this.#post<{ id: string }>(ctx, `${pageId}/feed`, feed)
    return this.#toResult(result.id)
  }

  async #publishVideo(
    ctx: PublishContext,
    pageId: string,
    message: string,
    video: MediaRef,
  ): Promise<PublishResult> {
    const body = new FormData()
    body.set('description', message)
    await this.#attachMedia(body, video, 'source')
    const result = await this.#post<{ id: string }>(ctx, `${pageId}/videos`, body)
    return this.#toResult(result.id)
  }

  // ---- plumbing ------------------------------------------------------------

  /**
   * Prefers a public URL when one exists — letting Meta fetch avoids pushing the
   * bytes through us — and falls back to uploading the local file.
   */
  async #attachMedia(body: FormData, media: MediaRef, fileField: string): Promise<void> {
    if (media.publicUrl !== undefined) {
      body.set(media.kind === 'video' ? 'file_url' : 'url', media.publicUrl)
      return
    }
    if (media.localPath === undefined) {
      throw new PublishError('Attachment has neither a public URL nor a local file.', {
        failureClass: 'permanent',
      })
    }
    const bytes = await this.#readMedia(media)
    body.set(fileField, new Blob([bytes], { type: media.mime }), basename(media.localPath))
  }

  async #post<T>(ctx: PublishContext, path: string, body: FormData): Promise<T> {
    const url = `${GRAPH_BASE}/${this.#apiVersion}/${path}`

    // Sent in the body rather than the query string so it never lands in a log.
    if (this.#appSecret !== undefined) {
      body.set(
        'appsecret_proof',
        createHmac('sha256', this.#appSecret).update(ctx.credential.accessToken).digest('hex'),
      )
    }

    // The token goes in the Authorization header, never the query string: URLs end
    // up in logs, proxies and error traces.
    let response: Response
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.credential.accessToken}` },
        body,
      }
      if (ctx.signal !== undefined) init.signal = ctx.signal
      response = await this.#fetch(url, init)
    } catch (cause) {
      throw new PublishError('Could not reach the Facebook Graph API', {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      throw new PublishError('Facebook returned a response that was not JSON', {
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

  #toResult(id: string): PublishResult {
    return { platformPostId: id, url: `https://www.facebook.com/${id}` }
  }
}

async function defaultReadMedia(media: MediaRef): Promise<Uint8Array> {
  if (media.localPath === undefined) throw new Error('No local path to read')
  return new Uint8Array(await readFile(media.localPath))
}
