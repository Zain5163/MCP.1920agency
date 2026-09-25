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
 * can see it. That is the failure mode to watch for here.
 */

const PINTEREST_BASE = 'https://api.pinterest.com/v5'

export interface PinterestAdapterOptions {
  readonly fetch?: typeof globalThis.fetch
}

export class PinterestAdapter implements PlatformAdapter {
  readonly platform: Platform = 'pinterest'
  readonly capabilities: Capabilities = CAPABILITIES.pinterest

  readonly #fetch: typeof globalThis.fetch

  constructor(options: PinterestAdapterOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch
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
    if (media.publicUrl === undefined) {
      throw new PublishError(
        'Pinterest fetches media over HTTPS. Configure media hosting.',
        { failureClass: 'permanent' },
      )
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

    const body: Record<string, unknown> = {
      board_id: boardId,
      media_source: {
        source_type: media.kind === 'video' ? 'video_id' : 'image_url',
        url: media.publicUrl,
      },
    }
    if (title !== '') body.title = title
    if (description !== '') body.description = description.slice(0, 800)

    const created = await this.#post<{ id: string }>(ctx, 'pins', body)

    return {
      platformPostId: created.id,
      url: `https://www.pinterest.com/pin/${created.id}/`,
    }
  }

  async #post<T>(ctx: PublishContext, path: string, body: unknown): Promise<T> {
    const url = `${PINTEREST_BASE}/${path}`

    let response: Response
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.credential.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }
      if (ctx.signal !== undefined) init.signal = ctx.signal
      response = await this.#fetch(url, init)
    } catch (cause) {
      throw new PublishError('Could not reach the Pinterest API', {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      throw new PublishError('Pinterest returned a response that was not JSON', {
        failureClass: response.ok ? 'permanent' : 'transient',
        httpStatus: response.status,
        platformMessage: text.slice(0, 200),
      })
    }

    if (!response.ok) {
      // Pinterest uses its own envelope, not Meta's, so the shared Graph
      // classifier does not apply.
      const error = parsed as { message?: string; code?: number }
      throw new PublishError(`Pinterest publish failed: ${error.message ?? 'unknown error'}`, {
        failureClass: classifyHttpStatus(response.status),
        ...(error.message !== undefined ? { platformMessage: error.message } : {}),
        ...(error.code !== undefined ? { platformCode: String(error.code) } : {}),
        httpStatus: response.status,
      })
    }

    return parsed as T
  }
}
