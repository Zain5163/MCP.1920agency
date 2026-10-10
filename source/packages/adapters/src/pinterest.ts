import { openAsBlob } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import {
  CAPABILITIES,
  PublishError,
  bodyForPlatform,
  classifyHttpStatus,
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

import { openMedia, type MediaSource } from './media-source.ts'

/**
 * Pinterest adapter.
 *
 * The shape that makes Pinterest different: **a pin belongs to a board**, not to
 * an account. One Pinterest profile has many boards, and posting the same pin to
 * all of them is spam rather than reach. So each board is modelled as its own
 * connection, and `platformAccountId` holds the board id.
 *
 * That is why account selection had to become per-account rather than
 * per-platform before this could be built honestly.
 *
 * ⚠️ **Trial access publishes to a sandbox.** Until the app has Standard Access,
 * pins created through the API are visible only to their creator. Everything
 * looks successful — the pin id comes back, the URL resolves — and nobody else
 * can see it. That is the failure mode to watch for here. The research note
 * (docs/research/2026-10-11-video-platform-specs-and-rights.md §2) also records
 * that the sandbox does not support video pins at all.
 *
 * **A video pin is four calls, not one** (Pinterest API v5 OpenAPI 5.28.0,
 * `POST /media` "Register media upload", `GET /media/{media_id}`, and the
 * `PinMediaSourceVideoID` schema, checked 2026-10-11):
 *
 *   1. `POST /v5/media` with `media_type: video` registers the upload and
 *      returns a `media_id`, an `upload_url` and `upload_parameters`.
 *   2. The file is POSTed to `upload_url` as a multipart form: every pair from
 *      `upload_parameters`, then the file as the `file` field. The URL is a
 *      pre-signed storage address, so the Pinterest token is NOT sent there.
 *   3. `GET /v5/media/{media_id}` is polled until `status` is `succeeded`
 *      (`registered` → `processing` → `succeeded` | `failed`).
 *   4. `POST /v5/pins` with `media_source: { source_type: 'video_id', media_id }`
 *      and a cover: `cover_image_url`, `cover_image_data` with
 *      `cover_image_content_type`, or `cover_image_key_frame_time` (seconds).
 *
 * WHY (2026-10-11): the previous version sent `source_type: 'video_id'` with a
 * `url`, which is not a field of a video media source: Pinterest takes video
 * only by `media_id`, so every video pin would have failed. A missing cover is
 * reported to fail too, so a pin without a thumbnail uses a key frame and the
 * result says which.
 */

const PINTEREST_BASE = 'https://api.pinterest.com/v5'

/**
 * The frame used as the cover when no thumbnail is given, in seconds. One
 * second rather than zero: the first frame of an edit is often a black fade-in.
 * Pinterest uses the last frame when this is past the end of the video.
 */
export const PINTEREST_DEFAULT_COVER_KEY_FRAME_SECONDS = 1

/** The cover types `cover_image_content_type` accepts (`ContentType` in the OpenAPI). */
const COVER_CONTENT_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png'])

/**
 * A local cover is sent inline as Base64. Pinterest states no limit for it;
 * this keeps an accidental poster-sized file from bloating the request. A
 * larger cover can be given as a public URL instead.
 */
const MAX_INLINE_COVER_BYTES = 10_000_000

type MediaStatus = 'registered' | 'processing' | 'succeeded' | 'failed'

interface MediaUpload {
  readonly media_id?: string
  readonly upload_url?: string
  readonly upload_parameters?: Readonly<Record<string, string>>
}

export interface PinterestAdapterOptions {
  readonly fetch?: typeof globalThis.fetch
  /** Injected so tests do not actually wait. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Injected so tests can move time. */
  readonly now?: () => number
  /** How long to wait for Pinterest to process a video. Default 10 minutes. */
  readonly processingTimeoutMs?: number
  /** How often to ask. Default 5 seconds. */
  readonly pollIntervalMs?: number
  /** The cover frame when no thumbnail is given. Default 1 second. */
  readonly defaultCoverKeyFrameSeconds?: number
}

export class PinterestAdapter implements PlatformAdapter {
  readonly platform: Platform = 'pinterest'
  readonly capabilities: Capabilities = CAPABILITIES.pinterest

  readonly #fetch: typeof globalThis.fetch
  readonly #sleep: (ms: number) => Promise<void>
  readonly #now: () => number
  readonly #timeoutMs: number
  readonly #pollMs: number
  readonly #keyFrameSeconds: number

  constructor(options: PinterestAdapterOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.#now = options.now ?? (() => Date.now())
    this.#timeoutMs = options.processingTimeoutMs ?? 10 * 60 * 1000
    this.#pollMs = options.pollIntervalMs ?? 5_000
    this.#keyFrameSeconds = options.defaultCoverKeyFrameSeconds ?? PINTEREST_DEFAULT_COVER_KEY_FRAME_SECONDS
  }

  validate(draft: PostDraft): ValidationResult {
    return validateAgainstCapabilities(draft, this.platform, this.capabilities)
  }

  async publish(ctx: PublishContext, draft: PostDraft): Promise<PublishResult> {
    const validation = this.validate(draft)
    if (!validation.ok) {
      const first = validation.issues.find((i) => i.severity === 'error')
      throw new PublishError(`Draft is not valid for Pinterest: ${first?.message ?? 'unknown'}`, {
        failureClass: 'permanent',
        ...(first?.message !== undefined ? { platformMessage: first.message } : {}),
        ...(first?.code !== undefined ? { platformCode: first.code } : {}),
      })
    }

    const boardId = ctx.connection.platformAccountId
    const text = bodyForPlatform(draft, this.platform)
    const media = draft.media[0]

    if (media === undefined) {
      // Guarded by minMediaCount, restated because the consequence is specific:
      // Pinterest has no text-only post at all.
      throw new PublishError('Pinterest needs an image or video — there is no text-only pin.', {
        failureClass: 'permanent',
      })
    }

    /**
     * Pinterest splits a pin's text in two: a short title and a longer
     * description. Most of our platforms have one body, so the first line
     * becomes the title and the rest the description — which is how people
     * naturally write anyway.
     */
    const [firstLine, ...rest] = text.split('\n')
    const title = (firstLine ?? '').slice(0, 100)
    const description = rest.join('\n').trim() === '' ? text : rest.join('\n').trim()

    let mediaSource: Record<string, unknown>
    let notice: string | undefined
    if (media.kind === 'video') {
      const video = await this.#prepareVideo(ctx, media)
      mediaSource = video.mediaSource
      notice = video.notice
    } else {
      if (media.publicUrl === undefined) {
        throw new PublishError('Pinterest fetches images over HTTPS. Configure media hosting.', {
          failureClass: 'permanent',
        })
      }
      mediaSource = { source_type: 'image_url', url: media.publicUrl }
    }

    const body: Record<string, unknown> = { board_id: boardId, media_source: mediaSource }
    if (title !== '') body.title = title
    if (description !== '') body.description = description.slice(0, 800)

    const created = await this.#postJson<{ id: string }>(ctx, 'pins', body, 'Creating the pin')

    return {
      platformPostId: created.id,
      url: `https://www.pinterest.com/pin/${created.id}/`,
      ...(notice !== undefined ? { notice } : {}),
    }
  }

  // ---- video ---------------------------------------------------------------

  /**
   * Registers, uploads and waits for a video, and returns the media source
   * that names it, with its cover. Nothing is pinned until this returns, so
   * every failure in here leaves nothing published.
   */
  async #prepareVideo(
    ctx: PublishContext,
    media: MediaRef,
  ): Promise<{ mediaSource: Record<string, unknown>; notice?: string }> {
    // The cover is checked first: a bad thumbnail should stop the pin before
    // a large video is uploaded, not after.
    const cover = await this.#cover(media.thumbnail)

    const source = await openMedia(media, this.#fetch, ctx.signal !== undefined ? { signal: ctx.signal } : {})
    let mediaId: string
    try {
      if (source.size === 0) {
        throw new PublishError('The video file is empty, so there is nothing to upload. Nothing was pinned.', {
          failureClass: 'permanent',
        })
      }
      const limit = this.capabilities.maxVideoBytes
      if (limit !== undefined && source.size > limit) {
        throw new PublishError(
          `The video is ${megabytes(source.size)}, over Pinterest's ${megabytes(limit)} limit. ` +
            'Export it at a lower bitrate or shorten it. Nothing was uploaded or pinned.',
          { failureClass: 'permanent', platformCode: 'video_too_large' },
        )
      }

      const registered = await this.#postJson<MediaUpload>(ctx, 'media', { media_type: 'video' }, 'Registering the video upload')
      const uploadUrl = registered.upload_url
      if (registered.media_id === undefined || uploadUrl === undefined || !isHttps(uploadUrl)) {
        throw new PublishError(
          'Pinterest registered the video but did not return where to upload it, so it cannot be sent. Nothing was pinned; try again.',
          { failureClass: 'transient' },
        )
      }
      mediaId = registered.media_id
      await this.#upload(ctx, uploadUrl, registered.upload_parameters ?? {}, source, media)
    } finally {
      // Closes the handle and removes any temporary download, whatever happened.
      await source.close()
    }

    await this.#waitUntilProcessed(ctx, mediaId)

    if (cover !== undefined) {
      return { mediaSource: { source_type: 'video_id', media_id: mediaId, ...cover } }
    }
    return {
      mediaSource: { source_type: 'video_id', media_id: mediaId, cover_image_key_frame_time: this.#keyFrameSeconds },
      notice:
        `No thumbnail was given, so Pinterest uses the video frame at ${this.#keyFrameSeconds} s as the pin's cover. ` +
        'Give the video a thumbnail (JPEG or PNG) to choose the cover yourself.',
    }
  }

  /**
   * The cover fields for a thumbnail, or undefined when there is none. A
   * public HTTPS address goes as `cover_image_url`; a local file goes inline
   * as Base64. Anything Pinterest would refuse is refused here, before the
   * video is uploaded.
   */
  async #cover(thumbnail: MediaRef | undefined): Promise<Record<string, string> | undefined> {
    if (thumbnail === undefined) return undefined
    const mime = thumbnail.mime.toLowerCase().split(';')[0]!.trim()
    if (!COVER_CONTENT_TYPES.has(mime === 'image/jpg' ? 'image/jpeg' : mime)) {
      throw new PublishError(
        `The video's thumbnail is ${thumbnail.mime}; Pinterest takes a JPEG or PNG cover. Export it as JPEG or PNG. Nothing was uploaded or pinned.`,
        { failureClass: 'permanent', code: 'MEDIA_UNSUPPORTED' },
      )
    }
    if (thumbnail.publicUrl !== undefined && isHttps(thumbnail.publicUrl)) {
      return { cover_image_url: thumbnail.publicUrl }
    }
    if (thumbnail.localPath !== undefined) {
      let bytes: Buffer
      try {
        bytes = await readFile(thumbnail.localPath)
      } catch (cause) {
        throw new PublishError(
          `Could not read the thumbnail at ${thumbnail.localPath}. Check the path. Nothing was uploaded or pinned.`,
          { failureClass: 'permanent', cause },
        )
      }
      if (bytes.length > MAX_INLINE_COVER_BYTES) {
        throw new PublishError(
          `The thumbnail is ${megabytes(bytes.length)}; a local cover is sent inline and must be at most ` +
            `${megabytes(MAX_INLINE_COVER_BYTES)}. Use a smaller JPEG, or give it as a public https:// URL. Nothing was uploaded or pinned.`,
          { failureClass: 'permanent' },
        )
      }
      return {
        cover_image_data: bytes.toString('base64'),
        cover_image_content_type: mime === 'image/jpg' ? 'image/jpeg' : mime,
      }
    }
    throw new PublishError(
      'The video has a thumbnail with neither a public https:// URL nor a local file, so Pinterest cannot use it as the cover. ' +
        'Host the thumbnail, or remove it to let Pinterest use a frame of the video. Nothing was uploaded or pinned.',
      { failureClass: 'permanent', code: 'MEDIA_NOT_HOSTED' },
    )
  }

  /**
   * Sends the file to the upload address Pinterest returned, as the
   * multipart form its docs describe: the upload parameters, then `file`.
   *
   * The file is read from disk lazily (`openAsBlob`), so a 2 GB video is not
   * held in memory. No Authorization header: the address is pre-signed
   * storage, and the Pinterest token must never go anywhere but Pinterest.
   */
  async #upload(
    ctx: PublishContext,
    uploadUrl: string,
    parameters: Readonly<Record<string, string>>,
    source: MediaSource,
    media: MediaRef,
  ): Promise<void> {
    const form = new FormData()
    // Storage reads the policy fields before the file, so the file goes last.
    for (const [key, value] of Object.entries(parameters)) form.append(key, value)
    const blob = await openAsBlob(source.path, { type: media.mime })
    form.append('file', blob, media.localPath !== undefined ? basename(media.localPath) : 'video.mp4')

    let response: Response
    try {
      const init: RequestInit = { method: 'POST', body: form }
      if (ctx.signal !== undefined) init.signal = ctx.signal
      response = await this.#fetch(uploadUrl, init)
    } catch (cause) {
      throw new PublishError('Could not send the video to Pinterest’s upload storage. Nothing was pinned.', {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }
    if (response.ok) {
      await response.body?.cancel().catch(() => {})
      return
    }

    const detail = (await response.text().catch(() => '')).slice(0, 300)
    // 403 is usually an upload policy that expired while the file was being
    // sent; a fresh attempt registers a fresh one. 5xx and 429 are the
    // storage being busy. Anything else (400: e.g. the file is too large for
    // the policy) will fail the same way again.
    const retry = response.status === 403 || response.status === 429 || response.status >= 500
    throw new PublishError(
      `Pinterest's upload storage refused the video (HTTP ${response.status}). ` +
        (retry
          ? 'This is usually temporary, or the upload permission expired during a slow upload; it is tried again. '
          : 'Check the file is a valid MP4, MOV or M4V within Pinterest\'s limits. ') +
        'Nothing was pinned.',
      {
        failureClass: retry ? 'transient' : 'permanent',
        httpStatus: response.status,
        ...(detail !== '' ? { platformMessage: detail } : {}),
      },
    )
  }

  /**
   * Polls the registered media until Pinterest has processed it. Creating the
   * pin before then fails, and a failed processing never recovers, so the two
   * outcomes are told apart: failed is permanent, slow is retried.
   */
  async #waitUntilProcessed(ctx: PublishContext, mediaId: string): Promise<void> {
    const deadline = this.#now() + this.#timeoutMs
    for (;;) {
      const info = await this.#getJson<{ status?: MediaStatus }>(
        ctx,
        `media/${encodeURIComponent(mediaId)}`,
        'Checking the video upload',
      )
      if (info.status === 'succeeded') return
      if (info.status === 'failed') {
        throw new PublishError(
          'Pinterest could not process the video, so no pin was created. Re-export it as an H.264 MP4 between 4 seconds and 15 minutes, ' +
            'with an aspect ratio between 1:2 and 1.91:1, then post again.',
          { failureClass: 'permanent', code: 'MEDIA_PROCESSING_FAILED', platformMessage: 'Media upload status: failed' },
        )
      }
      if (this.#now() + this.#pollMs > deadline) {
        throw new PublishError(
          `Pinterest was still processing the video after ${Math.round(this.#timeoutMs / 60_000)} minutes, so no pin was created yet. ` +
            'It is tried again; a shorter or smaller file processes faster.',
          { failureClass: 'transient', code: 'MEDIA_PROCESSING_TIMEOUT', platformMessage: `Media upload status: ${info.status ?? 'unknown'}` },
        )
      }
      await this.#sleep(this.#pollMs)
    }
  }

  // ---- plumbing ------------------------------------------------------------

  async #postJson<T>(ctx: PublishContext, path: string, body: unknown, what: string): Promise<T> {
    return await this.#request<T>(ctx, path, { method: 'POST', body: JSON.stringify(body) }, what)
  }

  async #getJson<T>(ctx: PublishContext, path: string, what: string): Promise<T> {
    return await this.#request<T>(ctx, path, { method: 'GET' }, what)
  }

  async #request<T>(ctx: PublishContext, path: string, init: RequestInit, what: string): Promise<T> {
    const url = `${PINTEREST_BASE}/${path}`

    let response: Response
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${ctx.credential.accessToken}` }
      if (init.method === 'POST') headers['content-type'] = 'application/json'
      const full: RequestInit = { ...init, headers }
      if (ctx.signal !== undefined) full.signal = ctx.signal
      response = await this.#fetch(url, full)
    } catch (cause) {
      throw new PublishError(`Could not reach the Pinterest API (${what})`, {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      throw new PublishError(`Pinterest returned a response that was not JSON (${what})`, {
        failureClass: response.ok ? 'permanent' : 'transient',
        httpStatus: response.status,
        platformMessage: text.slice(0, 200),
      })
    }

    if (!response.ok) {
      // Pinterest uses its own envelope, not Meta's, so the shared Graph
      // classifier does not apply.
      const error = parsed as { message?: string; code?: number }
      throw new PublishError(`Pinterest publish failed (${what}): ${error.message ?? 'unknown error'}`, {
        failureClass: classifyHttpStatus(response.status),
        ...(error.message !== undefined ? { platformMessage: error.message } : {}),
        ...(error.code !== undefined ? { platformCode: String(error.code) } : {}),
        httpStatus: response.status,
      })
    }

    return parsed as T
  }
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/** Bytes as decimal megabytes for a message, e.g. 2000 MB or 12.5 MB. */
function megabytes(bytes: number): string {
  return `${Math.round(bytes / 100_000) / 10} MB`
}
