import {
  CAPABILITIES,
  PublishError,
  bodyForPlatform,
  classifyHttpStatus,
  classifyNetworkError,
  countGraphemes,
  titleForPlatform,
  validateAgainstCapabilities,
  type Capabilities,
  type MediaRef,
  type Platform,
  type PlatformAdapter,
  type PostDraft,
  type PublishContext,
  type PublishResult,
  type ValidationIssue,
  type ValidationResult,
} from '@social-publisher/core'

import { openMedia, type MediaSource } from './media-source.ts'

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
 * 4. **A document post (a PDF carousel) carries a title.** The document goes up
 *    through its own Documents API in one piece, and the post names it with
 *    `content.media.title`, which LinkedIn requires for a document. The title is
 *    plain text, not little text, and is the draft's title or, failing that, the
 *    first line of the text. Checked against Microsoft Learn on 2026-10-02
 *    (research/2026-10-02-linkedin-documents.md); not yet posted for real.
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

/**
 * The longest document title LinkedIn's own composer takes, as schedulers that
 * post documents report it (SocialPilot's LinkedIn document guide). LinkedIn's
 * API documentation gives no limit for an organic post, so a longer title is a
 * warning rather than an error, and a title this adapter makes from the text is
 * kept within it. UNVERIFIED against the API.
 */
export const LINKEDIN_DOCUMENT_TITLE_SHOWN = 58

/**
 * The document types the Documents API takes: "PPT, PPTX, DOC, DOCX, and PDF"
 * (Microsoft Learn, checked 2026-10-02).
 */
const DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

/** Every PDF starts with this, within its first kilobyte. */
const PDF_SIGNATURE = '%PDF-'
const PDF_SIGNATURE_WINDOW = 1024

/**
 * The notice on a document post whose processing was never seen to finish.
 *
 * A member token may not read a document's status, and a read can also fail
 * partway through the polling. Either way the post goes out after a pause, on
 * the assumption, unverified for documents, that LinkedIn publishes it once
 * processing completes. If processing fails instead, the post never shows,
 * while a result without a notice is reported everywhere as plainly
 * PUBLISHED. The notice makes every surface report it as uploaded and tells
 * the owner what to look at.
 */
const DOCUMENT_UNCONFIRMED_NOTICE =
  'Posted, but this connection could not read whether LinkedIn finished processing the document, ' +
  "so the post is not confirmed as published. Check on LinkedIn that it shows the document's pages."

export interface LinkedInAdapterOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly apiVersion?: string
  /** How to wait while LinkedIn processes a document. Injected so tests do not sleep. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Status reads before a document that is still processing is given up on. Default 20. */
  readonly documentStatusChecks?: number
  /** Pause between those reads, in ms. Default 3,000, so about a minute in all. */
  readonly documentPollIntervalMs?: number
  /**
   * Pause before posting when the token cannot read the document's status, in
   * ms. Default 15,000. A member token is write-only for these reads, so this is
   * the path a personal profile takes.
   */
  readonly documentUnreadableWaitMs?: number
}

/**
 * A document is initialised like an image — one URL back, not a list of parts —
 * but answers with a `document` URN.
 */
interface DocumentUploadInit {
  readonly value?: {
    readonly uploadUrl?: string
    readonly document?: string
  }
}

/** Where a document's title came from, which validation reports. */
interface DocumentTitle {
  readonly text: string
  readonly source: 'draft' | 'text' | 'file' | 'default'
  readonly shortened: boolean
}

interface UploadInit {
  readonly value?: {
    readonly uploadUrl?: string
    readonly image?: string
  }
}

/**
 * Video is initialised differently from an image: LinkedIn returns a *list* of
 * byte ranges to upload rather than one URL, because anything over 4 MB is sent
 * in parts.
 */
interface VideoUploadInit {
  readonly value?: {
    readonly video?: string
    readonly uploadToken?: string
    readonly uploadInstructions?: ReadonlyArray<{
      readonly uploadUrl: string
      readonly firstByte: number
      readonly lastByte: number
    }>
  }
}

export class LinkedInAdapter implements PlatformAdapter {
  readonly platform: Platform = 'linkedin'
  readonly capabilities: Capabilities = CAPABILITIES.linkedin

  readonly #fetch: typeof globalThis.fetch
  readonly #version: string
  readonly #sleep: (ms: number) => Promise<void>
  readonly #documentStatusChecks: number
  readonly #documentPollIntervalMs: number
  readonly #documentUnreadableWaitMs: number

  constructor(options: LinkedInAdapterOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#version = options.apiVersion ?? LINKEDIN_DEFAULT_VERSION
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.#documentStatusChecks = Math.max(1, options.documentStatusChecks ?? 20)
    this.#documentPollIntervalMs = options.documentPollIntervalMs ?? 3_000
    this.#documentUnreadableWaitMs = options.documentUnreadableWaitMs ?? 15_000
  }

  /**
   * The shared checks, plus a document post's own: a type LinkedIn takes, and
   * where its title comes from. Text, image and video posts get exactly the
   * shared checks, as before documents existed.
   */
  validate(draft: PostDraft): ValidationResult {
    const shared = validateAgainstCapabilities(draft, this.platform, this.capabilities)
    const document = draft.media.find((m) => m.kind === 'document')
    if (document === undefined) return shared

    const issues: ValidationIssue[] = [...shared.issues]
    const add = (severity: ValidationIssue['severity'], code: string, message: string): void => {
      issues.push({ severity, code, message, platform: this.platform })
    }

    for (const item of draft.media) {
      if (item.kind === 'document' && !DOCUMENT_TYPES.has(normalisedMime(item.mime))) {
        add(
          'error',
          'document_type_unsupported',
          `LinkedIn takes a document as PDF, PPT, PPTX, DOC or DOCX, not ${item.mime === '' ? 'a file of unknown type' : item.mime}.`,
        )
      }
    }

    const title = this.#documentTitle(draft, document)
    if (title.source === 'draft') {
      const length = countGraphemes(title.text)
      if (length > LINKEDIN_DOCUMENT_TITLE_SHOWN) {
        add(
          'warning',
          'document_title_long',
          `The document title is ${length} characters. LinkedIn's own composer allows ${LINKEDIN_DOCUMENT_TITLE_SHOWN} ` +
            'and the API documents no limit, so a longer title may be shortened or refused. Shorten it to be safe.',
        )
      }
    } else if (title.source === 'text') {
      add(
        'warning',
        'document_title_from_text',
        title.shortened
          ? `No title was set, so the document is titled with the first line of the text, shortened to ${LINKEDIN_DOCUMENT_TITLE_SHOWN} characters: "${title.text}".`
          : `No title was set, so the document is titled with the first line of the text: "${title.text}".`,
      )
    } else if (title.source === 'file') {
      add('warning', 'document_title_from_file', `No title was set and there is no text, so the document is titled with its file name: "${title.text}".`)
    } else {
      add('warning', 'document_title_default', `No title was set and there is no text or file name to take one from, so the document is titled "${title.text}".`)
    }

    return { ok: !issues.some((i) => i.severity === 'error'), issues }
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

    /**
     * A document is the whole of its post's media: one document, nothing beside
     * it. Validation has already said so; this restates it where the content is
     * built, as the video rule below does.
     */
    const documents = draft.media.filter((m) => m.kind === 'document')
    if (documents.length > 0 && documents.length !== draft.media.length) {
      throw new PublishError(
        'LinkedIn cannot combine a document with images or video in one post. Send the document on its own.',
        { failureClass: 'permanent' },
      )
    }
    if (documents.length > 1) {
      throw new PublishError('LinkedIn takes one document per post, not several.', {
        failureClass: 'permanent',
      })
    }

    /**
     * A post is images or one video, never both.
     *
     * LinkedIn has no container that mixes them, and attempting it fails with an
     * error about the content type that gives no hint the mixture was the
     * problem.
     */
    const videos = draft.media.filter((m) => m.kind === 'video')
    if (videos.length > 0 && videos.length !== draft.media.length) {
      throw new PublishError(
        'LinkedIn cannot mix a video with images in one post. Send the video on its own.',
        { failureClass: 'permanent' },
      )
    }
    if (videos.length > 1) {
      throw new PublishError('LinkedIn takes one video per post, not several.', {
        failureClass: 'permanent',
      })
    }

    const uploaded: string[] = []
    // Only a document post names its media. Settled before anything is sent.
    const firstDocument = documents[0]
    const documentTitle =
      firstDocument !== undefined ? this.#documentTitle(draft, firstDocument).text : undefined
    // False only for a document LinkedIn was not seen to finish processing.
    let documentProcessed = true
    const firstVideo = videos[0]
    if (firstVideo !== undefined) {
      uploaded.push(await this.#uploadVideo(ctx, author, firstVideo))
    } else if (firstDocument !== undefined) {
      const document = await this.#uploadDocument(ctx, author, firstDocument)
      uploaded.push(document.urn)
      documentProcessed = document.processed
    } else {
      for (const image of draft.media) {
        uploaded.push(await this.#uploadImage(ctx, author, image))
      }
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
      // The Posts API marks the title required for a document, and it is the
      // only media this adapter titles.
      body.content = {
        media: { id: first, ...(documentTitle !== undefined ? { title: documentTitle } : {}) },
      }
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

    const notice = documentProcessed ? undefined : DOCUMENT_UNCONFIRMED_NOTICE
    return {
      platformPostId: postId,
      url: `https://www.linkedin.com/feed/update/${postId}/`,
      ...(notice !== undefined ? { notice } : {}),
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

    // From disk in ranges, downloading a URL to a temp file first (media-source.ts).
    const source = await openMedia(media, this.#fetch)
    let put: Response
    try {
      // An image goes up in one piece; LinkedIn offers no parts for images.
      const bytes = await source.read(0, source.size - 1)
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
    } finally {
      await source.close()
    }

    if (!put.ok) {
      throw new PublishError(`LinkedIn rejected the image upload (HTTP ${put.status})`, {
        failureClass: classifyHttpStatus(put.status),
        httpStatus: put.status,
      })
    }

    return urn
  }

  /**
   * Uploads a video in parts, then finalises it.
   *
   * Three calls rather than the image's two, and the middle one repeats:
   *
   *   1. `initializeUpload` — given the exact byte count, LinkedIn replies with a
   *      list of byte ranges and a URL for each. Under 4 MB that list has one
   *      entry, which is why a small video looks deceptively like the image flow.
   *   2. A PUT per range. **Each response carries an `ETag` that must be kept**;
   *      losing one means the parts cannot be reassembled and the upload is wasted.
   *   3. `finalizeUpload`, handing back the ETags in order with the upload token.
   *
   * Parts go up in sequence rather than in parallel. Slower, but a failure then
   * names the part that failed instead of producing several simultaneous errors,
   * and a video upload is already slow enough that this is not where the time goes.
   */
  async #uploadVideo(ctx: PublishContext, owner: string, media: MediaRef): Promise<string> {
    // LinkedIn asks for 4 MB parts, and each one is read from disk only when it
    // is about to be sent.
    const source = await openMedia(media, this.#fetch)
    try {
      return await this.#uploadVideoFrom(ctx, owner, media, source)
    } finally {
      // Always closes the handle and removes any temporary download, including
      // when a part fails partway through.
      await source.close()
    }
  }

  async #uploadVideoFrom(
    ctx: PublishContext,
    owner: string,
    media: MediaRef,
    source: MediaSource,
  ): Promise<string> {
    const init = await this.#send(
      ctx,
      'POST',
      `${LINKEDIN_BASE}/rest/videos?action=initializeUpload`,
      // fileSizeBytes decides how many parts come back, so it must be the real
      // length rather than anything the caller declared.
      { initializeUploadRequest: { owner, fileSizeBytes: source.size } },
    )

    const parsed = (await init.json()) as VideoUploadInit
    const urn = parsed.value?.video
    const uploadToken = parsed.value?.uploadToken
    const instructions = parsed.value?.uploadInstructions

    if (urn === undefined || instructions === undefined || instructions.length === 0) {
      throw new PublishError('LinkedIn did not return upload instructions for the video.', {
        failureClass: 'transient',
      })
    }

    const partIds: string[] = []
    for (const [index, part] of instructions.entries()) {
      // Read this part only when it is about to be sent, so only one 4 MB slice
      // is in memory at a time regardless of how large the video is.
      // lastByte is inclusive.
      const chunk = await source.read(part.firstByte, Math.min(part.lastByte, source.size - 1))

      let response: Response
      try {
        const request: RequestInit = {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${ctx.credential.accessToken}`,
            'content-type': media.mime,
          },
          body: chunk,
        }
        if (ctx.signal !== undefined) request.signal = ctx.signal
        response = await this.#fetch(part.uploadUrl, request)
      } catch (cause) {
        throw new PublishError(
          `Could not upload video part ${index + 1} of ${instructions.length} to LinkedIn`,
          { failureClass: classifyNetworkError(cause), cause },
        )
      }

      if (!response.ok) {
        throw new PublishError(
          `LinkedIn rejected video part ${index + 1} of ${instructions.length} (HTTP ${response.status})`,
          { failureClass: classifyHttpStatus(response.status), httpStatus: response.status },
        )
      }

      const etag = response.headers.get('etag')
      if (etag === null || etag === '') {
        // Without every ETag the parts cannot be reassembled, so stopping here
        // beats finalising an upload that will be rejected or, worse, silently
        // produce a broken video.
        throw new PublishError(
          `LinkedIn did not return an ETag for video part ${index + 1}, so the upload cannot be completed.`,
          { failureClass: 'transient' },
        )
      }
      partIds.push(etag)
    }

    await this.#send(ctx, 'POST', `${LINKEDIN_BASE}/rest/videos?action=finalizeUpload`, {
      finalizeUploadRequest: {
        video: urn,
        ...(uploadToken !== undefined ? { uploadToken } : {}),
        uploadedPartIds: partIds,
      },
    })

    return urn
  }

  /**
   * Uploads a document — a PDF carousel, or a PPT, PPTX, DOC or DOCX file — and
   * waits for LinkedIn to process it, where the token can see that.
   *
   * The Documents API, checked on Microsoft Learn 2026-10-02:
   *
   *   1. `POST /rest/documents?action=initializeUpload` with the owner returns
   *      an upload URL and the `urn:li:document:…` id.
   *   2. One PUT of the whole file to that URL. Unlike video there are no parts,
   *      no ETags and no finalize call: a document goes up in one piece, at most
   *      100 MB, so it is read into memory once.
   *   3. Processing, read back from `GET /rest/documents/{urn}` (#awaitDocument).
   *
   * The file is opened and checked first, so an empty, oversized or mislabelled
   * file is refused before anything is registered with LinkedIn.
   *
   * Says whether processing was seen to finish (`processed`), so the post can
   * carry a notice when it was not.
   */
  async #uploadDocument(
    ctx: PublishContext,
    owner: string,
    media: MediaRef,
  ): Promise<{ readonly urn: string; readonly processed: boolean }> {
    const source = await openMedia(media, this.#fetch, ctx.signal !== undefined ? { signal: ctx.signal } : {})
    let urn: string
    try {
      await this.#checkDocument(media, source)

      const init = await this.#send(
        ctx,
        'POST',
        `${LINKEDIN_BASE}/rest/documents?action=initializeUpload`,
        { initializeUploadRequest: { owner } },
      )
      const parsed = (await readJson(init)) as DocumentUploadInit | undefined
      const target = parsed?.value?.uploadUrl
      const document = parsed?.value?.document
      if (typeof target !== 'string' || target === '' || typeof document !== 'string' || document === '') {
        throw new PublishError(
          'LinkedIn did not return an upload address for the document, so nothing was uploaded or posted.',
          { failureClass: 'transient', httpStatus: init.status },
        )
      }
      urn = document

      const bytes = await source.read(0, source.size - 1)
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
        throw new PublishError('Could not upload the document to LinkedIn. Nothing was posted.', {
          failureClass: classifyNetworkError(cause),
          cause,
        })
      }
      await drain(put)
      if (!put.ok) {
        throw new PublishError(`LinkedIn rejected the document upload (HTTP ${put.status}). Nothing was posted.`, {
          failureClass: classifyHttpStatus(put.status),
          httpStatus: put.status,
        })
      }
    } finally {
      // Closes the handle and removes any temporary download, whatever happened.
      await source.close()
    }

    const processed = await this.#awaitDocument(ctx, urn)
    return { urn, processed }
  }

  /**
   * What can be known about a document before LinkedIn sees it: that it has
   * bytes, fits the limit by its real size rather than the declared one, and,
   * when it says it is a PDF, starts like one.
   */
  async #checkDocument(media: MediaRef, source: MediaSource): Promise<void> {
    if (source.size === 0) {
      throw new PublishError('The document file is empty, so there is nothing to post.', {
        failureClass: 'permanent',
      })
    }
    const limit = this.capabilities.maxDocumentBytes
    if (limit !== undefined && source.size > limit) {
      throw new PublishError(
        `The document is ${source.size} bytes, over LinkedIn's limit of ${limit} bytes (100 MB). Nothing was posted.`,
        { failureClass: 'permanent' },
      )
    }
    if (normalisedMime(media.mime) === 'application/pdf') {
      const head = await source.read(0, Math.min(source.size, PDF_SIGNATURE_WINDOW) - 1)
      if (!Buffer.from(head).toString('latin1').includes(PDF_SIGNATURE)) {
        throw new PublishError(
          'The file is labelled a PDF but does not start like one, so LinkedIn would refuse it. Export it again as a PDF. Nothing was posted.',
          { failureClass: 'permanent' },
        )
      }
    }
  }

  /**
   * Waits until LinkedIn has processed an uploaded document, before the post
   * points at it.
   *
   * Where the status can be read: AVAILABLE goes on; PROCESSING_FAILED stops
   * with nothing posted; PROCESSING or WAITING_UPLOAD is read again, a bounded
   * number of times, then given up as transient. Nothing is posted then, and the
   * worker's retry uploads the document afresh, as the Instagram adapter does
   * with a container that is slow to finish.
   *
   * A member token cannot read it. LinkedIn documents `w_member_social` as
   * write-only for `GET /rest/images`, and Postiz, which posts documents through
   * this API, reports the same for documents. So a status that cannot be read
   * means one fixed pause, then the post. LinkedIn describes posts whose media is
   * still processing as published once processing completes (the Posts API's
   * PUBLISH_REQUESTED state), and the live video posts of 2026-09-26 were created
   * straight after upload, so the pause only gives a fresh upload time to
   * register. UNVERIFIED for documents until the first real one.
   *
   * Resolves true once LinkedIn reports AVAILABLE, and false when the status
   * could not be read: refused outright, as for a member token, or failing
   * partway through the polling. A post made after a false is not confirmed,
   * and its result says so (DOCUMENT_UNCONFIRMED_NOTICE).
   */
  async #awaitDocument(ctx: PublishContext, urn: string): Promise<boolean> {
    for (let check = 1; ; check += 1) {
      const status = await this.#documentStatus(ctx, urn)
      if (status === 'AVAILABLE') return true
      if (status === undefined) {
        await this.#sleep(this.#documentUnreadableWaitMs)
        return false
      }
      if (status === 'PROCESSING_FAILED') {
        throw new PublishError(
          'LinkedIn could not process the document, so nothing was posted. LinkedIn takes PDF, PPT, PPTX, DOC or ' +
            'DOCX files up to 100 MB and 300 pages; a password-protected or damaged file fails the same way.',
          { failureClass: 'permanent', platformCode: status, code: 'MEDIA_PROCESSING_FAILED' },
        )
      }
      if (check >= this.#documentStatusChecks) {
        throw new PublishError(
          `LinkedIn was still processing the document (${status}) after ${check} checks, so nothing was posted. ` +
            'It is tried again later.',
          { failureClass: 'transient', code: 'MEDIA_PROCESSING_TIMEOUT' },
        )
      }
      await this.#sleep(this.#documentPollIntervalMs)
    }
  }

  /**
   * The document's processing status, or undefined when it cannot be read: no
   * permission, no answer, or no status in the answer. Throws only when the
   * publish was cancelled.
   */
  async #documentStatus(ctx: PublishContext, urn: string): Promise<string | undefined> {
    let response: Response
    try {
      const init: RequestInit = {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ctx.credential.accessToken}`,
          'LinkedIn-Version': this.#version,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      }
      if (ctx.signal !== undefined) init.signal = ctx.signal
      // A URN in a path is encoded, as the Posts API asks for every URN in a URL.
      response = await this.#fetch(`${LINKEDIN_BASE}/rest/documents/${encodeURIComponent(urn)}`, init)
    } catch (cause) {
      if (ctx.signal?.aborted === true) {
        throw new PublishError('The publish was cancelled after the document was uploaded. Nothing was posted.', {
          failureClass: 'transient',
          cause,
        })
      }
      return undefined
    }
    if (!response.ok) {
      await drain(response)
      return undefined
    }
    const body = (await readJson(response)) as { readonly status?: unknown } | undefined
    return typeof body?.status === 'string' ? body.status : undefined
  }

  /**
   * The title a document post goes out with: the draft's own (its LinkedIn
   * override first), else the first non-blank line of the text, else the file's
   * name, else "Document". One made here is kept within what LinkedIn's composer
   * shows, shortened at a word if it has to be. The title is plain text, not
   * little text, so it is not escaped.
   */
  #documentTitle(draft: PostDraft, document: MediaRef): DocumentTitle {
    const explicit = titleForPlatform(draft, this.platform)
    if (explicit !== undefined) return { text: explicit, source: 'draft', shortened: false }

    const firstLine = bodyForPlatform(draft, this.platform)
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '')
    if (firstLine !== undefined) {
      const fitted = fitToGraphemes(firstLine, LINKEDIN_DOCUMENT_TITLE_SHOWN)
      return { text: fitted.text, source: 'text', shortened: fitted.shortened }
    }

    const name = fileTitle(document)
    if (name !== undefined) {
      const fitted = fitToGraphemes(name, LINKEDIN_DOCUMENT_TITLE_SHOWN)
      return { text: fitted.text, source: 'file', shortened: fitted.shortened }
    }

    return { text: 'Document', source: 'default', shortened: false }
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
      let error: { message?: string; serviceErrorCode?: number; code?: string } = {}
      try {
        error = text === '' ? {} : (JSON.parse(text) as typeof error)
      } catch {
        error = { message: text.slice(0, 200) }
      }

      const media = mediaAssetProblem(error)
      throw new PublishError(`LinkedIn publish failed: ${error.message ?? 'unknown error'}`, {
        // Media LinkedIn has not received yet is worth another go; media it
        // could not process is not, and has its own explanation.
        failureClass: media === 'waiting' ? 'transient' : media === 'failed' ? 'permanent' : classifyHttpStatus(response.status),
        ...(media === 'failed' ? { code: 'MEDIA_PROCESSING_FAILED' as const } : {}),
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

/**
 * LinkedIn's errors for a post that points at media it has not received yet, or
 * could not process. Listed in the Videos API's error table
 * (`MEDIA_ASSET_WAITING_UPLOAD`, "Media asset is waiting upload";
 * `MEDIA_ASSET_PROCESSING_FAILED`, "Media asset failed processing") and assumed,
 * not verified, to be what a document post gets too. Matched on the newer
 * `code` field or the message, since LinkedIn returns either shape.
 */
function mediaAssetProblem(error: { readonly message?: string; readonly code?: string }): 'waiting' | 'failed' | undefined {
  const text = `${error.code ?? ''} ${error.message ?? ''}`
  if (/MEDIA_ASSET_WAITING_UPLOAD|waiting upload/i.test(text)) return 'waiting'
  if (/MEDIA_ASSET_PROCESSING_FAILED|failed processing/i.test(text)) return 'failed'
  return undefined
}

/** A media type without parameters or case, e.g. `application/pdf`. */
function normalisedMime(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase()
}

/**
 * A title from a local file's name, without its folder or extension. Only a
 * local file: a hosted copy is named by its content hash, which makes a useless
 * title.
 */
function fileTitle(media: MediaRef): string | undefined {
  if (media.localPath === undefined) return undefined
  // Either separator, so a Windows path is read the same on any machine.
  const name = media.localPath.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  const stem = (dot > 0 ? name.slice(0, dot) : name).trim()
  return stem === '' ? undefined : stem
}

/**
 * Shortens text to at most `max` graphemes, at a word where that keeps most of
 * it, ending with an ellipsis; never inside an emoji. The YouTube adapter
 * shortens a title made from the text by the same rule.
 */
function fitToGraphemes(text: string, max: number): { text: string; shortened: boolean } {
  const parts = graphemes(text)
  if (parts.length <= max) return { text, shortened: false }
  const head = parts.slice(0, max - 1).join('')
  const space = head.lastIndexOf(' ')
  const cut = space >= Math.floor(head.length * 0.6) ? head.slice(0, space) : head
  return { text: `${cut.trimEnd()}…`, shortened: true }
}

function graphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (Segmenter === undefined) return [...text]
  return [...new Segmenter('en', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)
}

/** The body as a JSON object, or undefined when it is empty, not JSON, or not an object. */
async function readJson(response: Response): Promise<object | undefined> {
  const text = await response.text().catch(() => '')
  if (text === '') return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Releases a reply's body so its connection can be reused. */
async function drain(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Nothing to release.
  }
}
