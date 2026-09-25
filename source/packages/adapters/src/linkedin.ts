import { readFile } from 'node:fs/promises'

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

/**
 * LinkedIn adapter.
 *
 * Three things make LinkedIn unlike everything built so far:
 *
 * 1. **The author is a URN, and the URN says what kind of thing is posting.**
 *    `urn:li:person:xxx` is a personal profile, `urn:li:organization:123` is a
 *    company page. `platformAccountId` therefore holds the whole URN rather than
 *    a bare id — one field carrying both identity and account type, so no second
 *    column is needed to tell them apart.
 *
 * 2. **Media is uploaded, not fetched.** Instagram, Threads and Pinterest are
 *    given a URL and collect the file themselves. LinkedIn issues a one-time
 *    upload URL and expects the bytes, so this adapter reads the file — from
 *    disk or over HTTPS — and PUTs it.
 *
 * 3. **`commentary` is "little text", not plain text.** Reserved characters left
 *    raw do not error: LinkedIn silently drops the post body from that character
 *    onward. A single unescaped `(` publishes a truncated post that reports
 *    complete success. That is the worst failure shape there is, so escaping
 *    happens here and is covered by tests.
 *
 * ⚠️ Posting as an organisation needs the Community Management API, which
 * LinkedIn approves sparingly. Personal profiles work with the self-serve
 * "Share on LinkedIn" product. Expect personal to work and company pages to
 * depend on an approval that may never arrive.
 */

const LINKEDIN_BASE = 'https://api.linkedin.com'

/**
 * LinkedIn versions its API by month and retires versions after about a year —
 * the same trap as a pinned Graph API version, so it is stated once and
 * overridable rather than scattered through the calls.
 */
export const LINKEDIN_DEFAULT_VERSION = '202601'

/**
 * Characters reserved by little text format. Left unescaped they do not produce
 * an error; they truncate the published post silently.
 */
const RESERVED = /[\\|{}@[\]()<>#*_~]/g

/**
 * Escapes text for the `commentary` field.
 *
 * Note on hashtags: the little text spec asks for `#` to be escaped, which is
 * done here because an unescaped one risks losing the rest of the post. Whether
 * an escaped `#` still renders as a clickable hashtag has NOT been verified
 * against a real account. If hashtags come out as plain text, that is why — and
 * the fix is to stop escaping `#` specifically, not to stop escaping.
 */
export function escapeLittleText(text: string): string {
  return text.replace(RESERVED, (character) => `\\${character}`)
}

export interface LinkedInAdapterOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly apiVersion?: string
}

interface UploadInit {
  readonly value?: {
    readonly uploadUrl?: string
    readonly image?: string
  }
}

export class LinkedInAdapter implements PlatformAdapter {
  readonly platform: Platform = 'linkedin'
  readonly capabilities: Capabilities = CAPABILITIES.linkedin

  readonly #fetch: typeof globalThis.fetch
  readonly #version: string

  constructor(options: LinkedInAdapterOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#version = options.apiVersion ?? LINKEDIN_DEFAULT_VERSION
  }

  validate(draft: PostDraft): ValidationResult {
    return validateAgainstCapabilities(draft, this.platform, this.capabilities)
  }

  async publish(ctx: PublishContext, draft: PostDraft): Promise<PublishResult> {
    const validation = this.validate(draft)
    if (!validation.ok) {
      const first = validation.issues.find((i) => i.severity === 'error')
      throw new PublishError(`Draft is not valid for LinkedIn: ${first?.message ?? 'unknown'}`, {
        failureClass: 'permanent',
        ...(first?.message !== undefined ? { platformMessage: first.message } : {}),
        ...(first?.code !== undefined ? { platformCode: first.code } : {}),
      })
    }

    const author = ctx.connection.platformAccountId
    if (!author.startsWith('urn:li:')) {
      // Worth catching loudly: LinkedIn's own error for a bare id is an opaque
      // 422 that gives no hint the value was the wrong shape.
      throw new PublishError(
        `LinkedIn needs a full URN as the author, got "${author}". Reconnect the account.`,
        { failureClass: 'credential' },
      )
    }

    const images = draft.media.filter((m) => m.kind === 'image')
    if (images.length !== draft.media.length) {
      throw new PublishError(
        'Video posting to LinkedIn is not implemented yet — it uses a separate chunked upload with ETag tracking. Post the video as a link, or remove it from the draft.',
        { failureClass: 'permanent' },
      )
    }

    const uploaded: string[] = []
    for (const image of images) {
      uploaded.push(await this.#uploadImage(ctx, author, image))
    }

    const body: Record<string, unknown> = {
      author,
      commentary: escapeLittleText(bodyForPlatform(draft, this.platform)),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }

    const first = uploaded[0]
    if (uploaded.length === 1 && first !== undefined) {
      body.content = { media: { id: first } }
    } else if (uploaded.length > 1) {
      body.content = { multiImage: { images: uploaded.map((id) => ({ id })) } }
    }

    const response = await this.#send(ctx, 'POST', `${LINKEDIN_BASE}/rest/posts`, body)

    /**
     * A created post returns 201 with an EMPTY body; the id lives in the
     * `x-restli-id` response header. Parsing the body for it finds nothing and
     * looks like a platform fault rather than a wrong assumption.
     */
    const postId = response.headers.get('x-restli-id')
    if (postId === null || postId === '') {
      throw new PublishError(
        'LinkedIn accepted the post but returned no id, so it cannot be linked or verified.',
        { failureClass: 'transient', httpStatus: response.status },
      )
    }

    return {
      platformPostId: postId,
      url: `https://www.linkedin.com/feed/update/${postId}/`,
    }
  }

  /**
   * Registers an upload, then sends the bytes to the URL LinkedIn hands back.
   *
   * The upload URL is single-use and short-lived, so this pair of calls cannot be
   * split across a retry.
   */
  async #uploadImage(ctx: PublishContext, owner: string, media: MediaRef): Promise<string> {
    const init = await this.#send(
      ctx,
      'POST',
      `${LINKEDIN_BASE}/rest/images?action=initializeUpload`,
      { initializeUploadRequest: { owner } },
    )
    const parsed = (await init.json()) as UploadInit
    const target = parsed.value?.uploadUrl
    const urn = parsed.value?.image

    if (target === undefined || urn === undefined) {
      throw new PublishError('LinkedIn did not return an upload URL for the image.', {
        failureClass: 'transient',
      })
    }

    const bytes = await this.#readMedia(media)

    let put: Response
    try {
      const request: RequestInit = {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${ctx.credential.accessToken}`,
          'content-type': media.mime,
        },
        body: bytes,
      }
      if (ctx.signal !== undefined) request.signal = ctx.signal
      put = await this.#fetch(target, request)
    } catch (cause) {
      throw new PublishError('Could not upload the image to LinkedIn', {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }

    if (!put.ok) {
      throw new PublishError(`LinkedIn rejected the image upload (HTTP ${put.status})`, {
        failureClass: classifyHttpStatus(put.status),
        httpStatus: put.status,
      })
    }

    return urn
  }

  /** LinkedIn wants bytes, so take them from wherever this media actually is. */
  async #readMedia(media: MediaRef): Promise<Uint8Array> {
    if (media.localPath !== undefined) {
      try {
        return new Uint8Array(await readFile(media.localPath))
      } catch (cause) {
        throw new PublishError(`Could not read the media file at ${media.localPath}`, {
          failureClass: 'permanent',
          cause,
        })
      }
    }

    if (media.publicUrl !== undefined) {
      let response: Response
      try {
        response = await this.#fetch(media.publicUrl)
      } catch (cause) {
        throw new PublishError(`Could not download the media from ${media.publicUrl}`, {
          failureClass: classifyNetworkError(cause),
          cause,
        })
      }
      if (!response.ok) {
        throw new PublishError(
          `Media host returned HTTP ${response.status} for ${media.publicUrl}`,
          { failureClass: classifyHttpStatus(response.status), httpStatus: response.status },
        )
      }
      return new Uint8Array(await response.arrayBuffer())
    }

    throw new PublishError('The media has neither a local file nor a URL to upload from.', {
      failureClass: 'permanent',
    })
  }

  async #send(ctx: PublishContext, method: string, url: string, body: unknown): Promise<Response> {
    let response: Response
    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${ctx.credential.accessToken}`,
          'content-type': 'application/json',
          // Both are mandatory. Omitting the version header gives a 426, which
          // reads like a client problem rather than a missing header.
          'LinkedIn-Version': this.#version,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(body),
      }
      if (ctx.signal !== undefined) init.signal = ctx.signal
      response = await this.#fetch(url, init)
    } catch (cause) {
      throw new PublishError('Could not reach the LinkedIn API', {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }

    if (!response.ok) {
      const text = await response.text()
      let error: { message?: string; serviceErrorCode?: number } = {}
      try {
        error = text === '' ? {} : (JSON.parse(text) as typeof error)
      } catch {
        error = { message: text.slice(0, 200) }
      }

      throw new PublishError(`LinkedIn publish failed: ${error.message ?? 'unknown error'}`, {
        failureClass: classifyHttpStatus(response.status),
        ...(error.message !== undefined ? { platformMessage: error.message } : {}),
        ...(error.serviceErrorCode !== undefined
          ? { platformCode: String(error.serviceErrorCode) }
          : {}),
        httpStatus: response.status,
      })
    }

    return response
  }
}
