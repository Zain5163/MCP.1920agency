import { PublishError, classifyHttpStatus, classifyNetworkError } from '@social-publisher/core'

/**
 * Image generation through OpenRouter, paid per image.
 *
 * The owner's choice (2026-09-30): OpenRouter rather than one vendor, because
 * one key reaches Google's, OpenAI's and ByteDance's image models, and it is
 * billed per call rather than monthly. Its image endpoint reports the **exact
 * cost of every call** in `usage.cost`, which is what lets a daily spending cap
 * be enforced against real charges instead of estimates.
 *
 * Models differ in the shapes they can make, and that is checked before paying
 * for anything. Verified against OpenRouter's live model list on 2026-09-30:
 * Google's Gemini 3.1 Flash Image makes 1:1, 4:5 and 9:16; OpenAI's GPT Image 2
 * has no 4:5 at all — the Feed shape — so a request for it would otherwise be
 * paid for and then unusable.
 */

const BASE = 'https://openrouter.ai/api/v1'

/** Supports every shape an ad needs, verified on the live model list. */
export const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image'

/**
 * The shapes an ad uses, mapped to what an image model is asked for.
 *
 * Landscape (1.91:1) is absent on purpose: no listed model makes that ratio,
 * and generating 16:9 and calling it 1.91:1 would put a wrongly shaped file
 * into a placement that crops it. Refused, with the reason, instead.
 */
export const GENERATABLE_SHAPES = ['1:1', '4:5', '9:16'] as const
export type GeneratableShape = (typeof GENERATABLE_SHAPES)[number]

/**
 * Composition advice added to every prompt, per shape.
 *
 * Each placement covers part of the frame with its own interface. A 9:16 image
 * made without this puts the subject where Stories and Reels draw their
 * buttons and caption. The model cannot know that unless it is told.
 */
export const COMPOSITION: Readonly<Record<GeneratableShape, string>> = {
  '1:1': 'Square composition. Main subject centred with comfortable margins on every side.',
  '4:5':
    'Portrait 4:5 composition for a social feed. Main subject in the upper two thirds; keep the lower edge simple.',
  '9:16':
    'Full-screen vertical 9:16 composition for Stories and Reels. Main subject in the upper-middle of the frame; ' +
    'keep the top 12% and the bottom 25% free of anything important, because app buttons and captions cover them.',
}

/**
 * Said once, in every prompt, because image models render text badly and an
 * ad with misspelt words in the picture is worse than one with none. Headlines
 * and copy belong in the ad's text fields, where they can be read and tested.
 */
const NO_TEXT =
  'Do not render any words, letters, logos or watermarks in the image. Photographic, natural lighting, ' +
  'looks like a real post rather than a stock advert.'

export interface GeneratedImage {
  readonly bytes: Uint8Array
  readonly mediaType: string
  /** What OpenRouter charged, in US dollars. */
  readonly costUsd: number
  readonly model: string
  readonly aspectRatio: GeneratableShape
}

export interface OpenRouterImagesOptions {
  readonly apiKey: string
  readonly fetch?: typeof globalThis.fetch
}

export class OpenRouterImages {
  readonly #key: string
  readonly #fetch: typeof globalThis.fetch
  readonly #ratios = new Map<string, readonly string[]>()

  constructor(options: OpenRouterImagesOptions) {
    this.#key = options.apiKey
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  /**
   * The aspect ratios a model accepts, from OpenRouter's public model list.
   * Cached for the life of the process: the list changes rarely, and asking
   * before every image would double the calls for nothing.
   */
  async supportedShapes(model: string): Promise<readonly string[]> {
    const cached = this.#ratios.get(model)
    if (cached !== undefined) return cached

    let response: Response
    try {
      response = await this.#fetch(`${BASE}/images/models`)
    } catch (cause) {
      throw new PublishError('Could not reach OpenRouter to check the image model.', {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }
    const list = (await response.json()) as {
      data?: Array<{ id: string; supported_parameters?: { aspect_ratio?: { values?: string[] } } }>
    }
    for (const m of list.data ?? []) this.#ratios.set(m.id, m.supported_parameters?.aspect_ratio?.values ?? [])

    const found = this.#ratios.get(model)
    if (found === undefined) {
      throw new PublishError(`OpenRouter has no image model called "${model}".`, { failureClass: 'permanent' })
    }
    return found
  }

  async generate(request: {
    readonly prompt: string
    readonly aspectRatio: GeneratableShape
    readonly model?: string
    readonly resolution?: '1K' | '2K'
  }): Promise<GeneratedImage> {
    const model = request.model ?? DEFAULT_IMAGE_MODEL

    const shapes = await this.supportedShapes(model)
    if (!shapes.includes(request.aspectRatio)) {
      throw new PublishError(
        `${model} cannot make ${request.aspectRatio} images (it supports ${shapes.join(', ') || 'no listed ratios'}). ` +
          `Nothing was charged. Use ${DEFAULT_IMAGE_MODEL}, which makes every ad shape.`,
        { failureClass: 'permanent' },
      )
    }

    const prompt = [request.prompt.trim(), COMPOSITION[request.aspectRatio], NO_TEXT].join('\n\n')

    let response: Response
    try {
      response = await this.#fetch(`${BASE}/images`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#key}`,
          'content-type': 'application/json',
          // OpenRouter's attribution headers; they identify the app on its side.
          'X-Title': 'AdsPilot',
        },
        body: JSON.stringify({
          model,
          prompt,
          aspect_ratio: request.aspectRatio,
          resolution: request.resolution ?? '1K',
          output_format: 'png',
          n: 1,
        }),
      })
    } catch (cause) {
      throw new PublishError('Could not reach OpenRouter to generate the image.', {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }

    const text = await response.text()
    let parsed: {
      data?: Array<{ b64_json?: string; media_type?: string }>
      usage?: { cost?: number }
      error?: { message?: string }
    }
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new PublishError(`OpenRouter returned a response that was not JSON (HTTP ${response.status}).`, {
        failureClass: response.ok ? 'permanent' : 'transient',
      })
    }

    if (!response.ok) {
      const message = parsed.error?.message ?? `HTTP ${response.status}`
      throw new PublishError(
        response.status === 402
          ? 'OpenRouter refused for lack of credit. Top up the OpenRouter account; nothing was charged.'
          : `OpenRouter refused the image: ${message}`,
        { failureClass: classifyHttpStatus(response.status), platformMessage: message, httpStatus: response.status },
      )
    }

    const image = parsed.data?.[0]
    if (image?.b64_json === undefined) {
      throw new PublishError('OpenRouter answered but returned no image.', { failureClass: 'transient' })
    }

    return {
      bytes: new Uint8Array(Buffer.from(image.b64_json, 'base64')),
      mediaType: image.media_type ?? 'image/png',
      // A missing cost is recorded as zero rather than guessed, and flagged by
      // the caller: the cap is only as good as the numbers fed into it.
      costUsd: typeof parsed.usage?.cost === 'number' ? parsed.usage.cost : 0,
      model,
      aspectRatio: request.aspectRatio,
    }
  }
}
