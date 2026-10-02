import {
  CAPABILITIES,
  PublishError,
  backoffMs,
  bodyForPlatform,
  classifyNetworkError,
  countGraphemes,
  syntheticMediaForPlatform,
  titleForPlatform,
  validateAgainstCapabilities,
  type Capabilities,
  type Credential,
  type Platform,
  type PlatformAdapter,
  type PostDraft,
  type PublishContext,
  type PublishResult,
  type ValidationIssue,
  type ValidationResult,
} from '@social-publisher/core'

import { googleError, parseRetryAfter, type GoogleErrorBody } from './google-errors.ts'
import { GoogleOAuth } from './google-provider.ts'
import { openMedia, type MediaSource } from './media-source.ts'

/**
 * YouTube adapter: uploads one video per post.
 *
 * What makes YouTube unlike the platforms before it:
 *
 * 1. **Uploads from an unaudited project are private, whatever is asked.**
 *    Google restricts every `videos.insert` from an API project created after
 *    2020-07-28 that has not passed the YouTube API audit to private viewing,
 *    with no appeal. So until `audited` is set, this adapter asks for private
 *    itself, reads back the privacy YouTube actually applied, and returns a
 *    notice saying the video was uploaded as private. Reporting such an upload
 *    as "published" would be the worst kind of failure: a success nobody else
 *    can see.
 *
 * 2. **The title is its own field.** At most 100 characters, no `<` or `>`.
 *    `PostDraft.title` is used when given, otherwise the first line of the
 *    text; the description is the text itself, limited in BYTES (5,000), not
 *    characters.
 *
 * 3. **The upload is resumable and chunked.** A session is opened with the
 *    metadata, then the file goes up in 8 MiB PUTs (a multiple of 256 KiB, as
 *    Google requires). Every chunk but the last is answered `308 Resume
 *    Incomplete`, which is not `ok`; a check written like LinkedIn's
 *    `if (!response.ok) throw` would fail every upload larger than one chunk.
 *    An interrupted chunk is never assumed to have arrived or not: the
 *    session is asked what it holds, and the upload resumes from there.
 *
 * 4. **No idempotency key.** `videos.insert` accepts none, so a retried job is
 *    a second copy of the video. What prevents that is outside this file: the
 *    worker records the video id the moment it exists and never re-runs a job
 *    that has one, and it keeps the job's lock fresh while a long upload runs.
 *    Inside this file, nothing may throw once the video exists.
 *
 * 5. **One token reaches one channel**, and the API has no channel parameter.
 *    So before anything is uploaded the token is asked which channel it
 *    belongs to, and an answer other than this connection's channel stops the
 *    upload.
 *
 * Every upload states `privacyStatus`, `selfDeclaredMadeForKids` and
 * `containsSyntheticMedia` explicitly. YouTube's defaults for them are not
 * documented, the audience setting is required by YouTube policy, and AI
 * disclosure is required for realistic synthetic content.
 *
 * Protocol and limits were checked against Google's documentation on
 * 2026-10-02 (research/2026-10-02-youtube-api-facts.md). Nothing here has been
 * run against the real API yet.
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3'
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'
const WATCH_URL = 'https://www.youtube.com/watch?v='

/** Google's unit for chunk sizes: every chunk but the last is a multiple of it. */
const CHUNK_UNIT = 262_144

/** 8 MiB: 32 units. Large enough that requests are few, small enough to resume cheaply. */
export const YOUTUBE_DEFAULT_CHUNK_BYTES = 32 * CHUNK_UNIT

/** People & Blogs, the category Google's own upload sample uses. */
export const YOUTUBE_DEFAULT_CATEGORY_ID = '22'

const TITLE_MAX = 100
const DESCRIPTION_MAX_BYTES = 5_000
const TAGS_MAX_CHARACTERS = 500

/** Longest video a channel may upload before it is verified: 15 minutes. */
const UNVERIFIED_MAX_SECONDS = 900

/** Statuses Google says an upload can be resumed after. Every other 4xx/5xx is final. */
const RESUMABLE_STATUSES: ReadonlySet<number> = new Set([500, 502, 503, 504])

/**
 * A Retry-After longer than this is not waited out inside one publish: the
 * error is passed on with the wait, so the worker reschedules the job instead
 * of holding a process open.
 */
const LONGEST_INLINE_WAIT_MS = 60_000

/**
 * Added to a missing-media error at publish time. Validation before scheduling
 * passes with the local file attached; the worker then rebuilds the draft from
 * the database, which holds the video only if it was hosted.
 */
const SCHEDULED_MEDIA_HINT =
  ' If this post was scheduled, its video was not stored with it: a scheduled YouTube post needs ' +
  'its file hosted in the media bucket, which caps file size. Publish it now from the local file instead.'

export type YouTubePrivacy = 'private' | 'unlisted' | 'public'

export const YOUTUBE_PRIVACY_VALUES: readonly YouTubePrivacy[] = ['private', 'unlisted', 'public']

export interface YouTubeAdapterOptions {
  readonly fetch?: typeof globalThis.fetch
  /**
   * The Google OAuth client. With it the adapter can renew its own hour-long
   * access token through `refreshCredential`; without it there is no
   * `refreshCredential`, and an expired token means reconnecting.
   */
  readonly oauth?: { readonly clientId: string; readonly clientSecret: string }
  /** Privacy to ask for once the project is audited. Default private. */
  readonly privacy?: YouTubePrivacy
  /**
   * True only once the Cloud project has passed the YouTube API audit. Until
   * then every upload is sent as private, whatever `privacy` says, and is
   * reported as such.
   */
  readonly audited?: boolean
  /** A category id, as a string. Default '22', People & Blogs. */
  readonly categoryId?: string
  /** Whether subscribers are notified. Unset leaves YouTube's default, which is to notify. */
  readonly notifySubscribers?: boolean
  /**
   * Declares the channel's videos made for children. Default false: general
   * audience. YouTube requires an answer, so one is always sent.
   */
  readonly madeForKids?: boolean
  /** Tags sent with every upload; at most 500 characters in total. */
  readonly tags?: readonly string[]
  /** Bytes per PUT. A positive multiple of 256 KiB. Default 8 MiB. */
  readonly chunkBytes?: number
  /** Interruptions in a row before an upload is given up for this attempt. Default 5. */
  readonly maxResumeAttempts?: number
  /** First backoff between resume attempts, in ms. Default 1,000. */
  readonly retryBaseMs?: number
  /** How to wait between resume attempts. Injected so tests do not sleep. */
  readonly sleep?: (ms: number) => Promise<void>
}

/** The parts of a video resource this adapter reads. */
interface VideoResource {
  readonly id: string
  readonly status?: { readonly privacyStatus?: string; readonly uploadStatus?: string }
}

/** What the upload session said in reply to one request. */
type UploadReply =
  | { readonly kind: 'done'; readonly video: VideoResource }
  /** 308: the session holds this many bytes. */
  | { readonly kind: 'incomplete'; readonly received: number }
  /** No reply at all, or a 5xx Google says can be resumed after. */
  | { readonly kind: 'interrupted'; readonly httpStatus?: number; readonly retryAfterMs?: number }

export class YouTubeAdapter implements PlatformAdapter {
  readonly platform: Platform = 'youtube'
  readonly capabilities: Capabilities = CAPABILITIES.youtube

  /**
   * Present only when the OAuth client was given, so callers can pass
   * `adapter.refreshCredential` straight to the vault: undefined there means
   * "cannot renew", which is the truth without a client.
   */
  readonly refreshCredential?: (current: Credential) => Promise<Credential>

  readonly #fetch: typeof globalThis.fetch
  readonly #privacy: YouTubePrivacy
  readonly #audited: boolean
  readonly #categoryId: string
  readonly #notifySubscribers: boolean | undefined
  readonly #madeForKids: boolean
  readonly #tags: readonly string[]
  readonly #chunkBytes: number
  readonly #maxResumeAttempts: number
  readonly #retryBaseMs: number
  readonly #sleep: (ms: number) => Promise<void>

  constructor(options: YouTubeAdapterOptions = {}) {
    const chunkBytes = options.chunkBytes ?? YOUTUBE_DEFAULT_CHUNK_BYTES
    if (!Number.isInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes % CHUNK_UNIT !== 0) {
      // Google rejects misaligned chunks mid-upload; failing here names the setting.
      throw new RangeError(`chunkBytes must be a positive multiple of ${CHUNK_UNIT} (256 KiB), got ${chunkBytes}.`)
    }

    this.#fetch = options.fetch ?? globalThis.fetch
    this.#privacy = options.privacy ?? 'private'
    this.#audited = options.audited ?? false
    this.#categoryId = options.categoryId ?? YOUTUBE_DEFAULT_CATEGORY_ID
    this.#notifySubscribers = options.notifySubscribers
    this.#madeForKids = options.madeForKids ?? false
    this.#tags = options.tags ?? []
    this.#chunkBytes = chunkBytes
    this.#maxResumeAttempts = options.maxResumeAttempts ?? 5
    this.#retryBaseMs = options.retryBaseMs ?? 1_000
    this.#sleep =
      options.sleep ??
      (async (ms) => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, ms)
        })
      })

    if (options.oauth !== undefined) {
      const oauth = new GoogleOAuth({
        ...options.oauth,
        ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      })
      this.refreshCredential = async (current) => await oauth.refreshCredential(current)
    }
  }

  validate(draft: PostDraft): ValidationResult {
    const issues: ValidationIssue[] = [
      ...validateAgainstCapabilities(draft, this.platform, this.capabilities).issues,
    ]
    const add = (severity: ValidationIssue['severity'], code: string, message: string): void => {
      issues.push({ severity, code, message, platform: this.platform })
    }

    const title = this.#title(draft)
    if (title === undefined) {
      add('error', 'title_required', 'YouTube needs a title. Set one, or start the text with a line to use as the title.')
    } else {
      if (/[<>]/.test(title.text)) {
        add('error', 'title_invalid_characters', 'YouTube does not allow < or > in a title.')
      }
      if (title.derived) {
        add(
          'warning',
          'title_from_text',
          title.shortened
            ? `No title was set, so the first line of the text becomes the title, shortened to fit ${TITLE_MAX} characters: "${title.text}".`
            : `No title was set, so the first line of the text becomes the title: "${title.text}".`,
        )
      }
    }

    // The limit is in bytes. The grapheme check above cannot see it: 5,000
    // emoji are 5,000 graphemes and about 20,000 bytes.
    const description = bodyForPlatform(draft, this.platform)
    const bytes = Buffer.byteLength(description, 'utf8')
    if (bytes > DESCRIPTION_MAX_BYTES) {
      add(
        'error',
        'description_too_long',
        `The description is ${bytes} bytes, ${bytes - DESCRIPTION_MAX_BYTES} over YouTube's ${DESCRIPTION_MAX_BYTES}-byte limit. ` +
          'YouTube counts bytes, not characters, so emoji and non-Latin scripts use it up faster.',
      )
    }
    if (/[<>]/.test(description)) {
      add(
        'error',
        'description_invalid_characters',
        'YouTube does not allow < or > in a description. Replace them (for example with ‹ ›), or give YouTube its own text as an override.',
      )
    }

    // A warning, not an error: whether the channel is verified is something
    // only YouTube knows, and a verified channel takes up to 12 hours.
    const longest = Math.max(0, ...draft.media.map((m) => m.durationSeconds ?? 0))
    if (longest > UNVERIFIED_MAX_SECONDS) {
      add(
        'warning',
        'long_video_needs_verification',
        `The video is ${Math.round(longest / 60)} minutes long. YouTube takes videos over 15 minutes only from a verified channel (https://www.youtube.com/verify).`,
      )
    }

    const tagCharacters = youtubeTagCharacters(this.#tags)
    if (tagCharacters > TAGS_MAX_CHARACTERS) {
      add(
        'error',
        'tags_too_long',
        `The tags take ${tagCharacters} characters; YouTube allows ${TAGS_MAX_CHARACTERS} in total, counting the commas between tags and the quotes around any tag with a space.`,
      )
    }

    return { ok: !issues.some((i) => i.severity === 'error'), issues }
  }

  async publish(ctx: PublishContext, draft: PostDraft): Promise<PublishResult> {
    const validation = this.validate(draft)
    if (!validation.ok) {
      const problem = validation.issues.find((i) => i.severity === 'error')
      const detail = `${problem?.message ?? 'unknown'}${problem?.code === 'media_required' ? SCHEDULED_MEDIA_HINT : ''}`
      throw new PublishError(`Draft is not valid for YouTube: ${detail}`, {
        failureClass: 'permanent',
        platformMessage: detail,
        ...(problem?.code !== undefined ? { platformCode: problem.code } : {}),
      })
    }

    const video = draft.media[0]
    const title = this.#title(draft)
    if (video === undefined || title === undefined) {
      // Unreachable after validation; restated so the types say so too.
      throw new PublishError('A YouTube post needs one video and a title.', { failureClass: 'permanent' })
    }

    const requested: YouTubePrivacy = this.#audited ? this.#privacy : 'private'

    // Before anything is opened or sent: a token for another channel must not
    // upload anywhere.
    await this.#checkChannel(ctx)

    const source = await openMedia(video, this.#fetch, ctx.signal !== undefined ? { signal: ctx.signal } : {})
    let created: VideoResource
    try {
      if (source.size === 0) {
        throw new PublishError('The video file is empty, so there is nothing to upload.', { failureClass: 'permanent' })
      }
      const limit = this.capabilities.maxVideoBytes
      if (limit !== undefined && source.size > limit) {
        throw new PublishError(`The video is ${source.size} bytes, over YouTube's ${limit}-byte limit.`, {
          failureClass: 'permanent',
        })
      }

      // YouTube accepts any video/* type, or application/octet-stream for the rest.
      const contentType = video.mime.startsWith('video/') ? video.mime : 'application/octet-stream'
      const session = await this.#startSession(ctx, {
        title: title.text,
        description: bodyForPlatform(draft, this.platform),
        privacy: requested,
        synthetic: syntheticMediaForPlatform(draft, this.platform),
        contentType,
        size: source.size,
      })
      created = await this.#sendFile(ctx, session, source, contentType)
    } finally {
      // Closes the handle and removes any temporary download, whatever happened.
      await source.close()
    }

    // The video exists from here on. Nothing below may throw: a throw would
    // make the worker retry, and a retry is a second copy of the video.
    const readBack = await this.#readPrivacy(ctx, created.id)
    const applied = readBack ?? created.status?.privacyStatus
    const notice = privacyNotice({
      audited: this.#audited,
      requested,
      applied,
      confirmed: readBack !== undefined,
    })

    return {
      platformPostId: created.id,
      url: `${WATCH_URL}${encodeURIComponent(created.id)}`,
      raw: {
        privacyStatus: applied ?? null,
        requestedPrivacy: requested,
        privacyConfirmed: readBack !== undefined,
        uploadStatus: created.status?.uploadStatus ?? null,
      },
      ...(notice !== undefined ? { notice } : {}),
    }
  }

  /**
   * The title to send: the draft's own, else the first non-blank line of the
   * text, shortened at a word to fit if it has to be. Undefined when there is
   * neither, which validation reports.
   */
  #title(draft: PostDraft): { text: string; derived: boolean; shortened: boolean } | undefined {
    const explicit = titleForPlatform(draft, this.platform)
    if (explicit !== undefined) return { text: explicit, derived: false, shortened: false }

    const firstLine = bodyForPlatform(draft, this.platform)
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '')
    if (firstLine === undefined) return undefined
    const fitted = fitToGraphemes(firstLine, TITLE_MAX)
    return { text: fitted.text, derived: true, shortened: fitted.shortened }
  }

  /**
   * Asks the token which channel it belongs to, and refuses to go on unless it
   * is this connection's. Costs one quota unit, which is cheap insurance
   * against putting a video on the wrong channel.
   */
  async #checkChannel(ctx: PublishContext): Promise<void> {
    const url = new URL(`${API_BASE}/channels`)
    url.searchParams.set('part', 'id')
    url.searchParams.set('mine', 'true')
    const data = await this.#getJson<{ items?: ReadonlyArray<{ id?: string }> }>(
      ctx,
      url.toString(),
      'Checking which YouTube channel the token belongs to',
    )

    const channels = (data.items ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string')
    if (channels.length === 0) {
      throw new PublishError('This Google account has no YouTube channel, so there is nowhere to upload. Nothing was uploaded.', {
        failureClass: 'permanent',
        code: 'YOUTUBE_NO_CHANNEL',
      })
    }
    if (!channels.includes(ctx.connection.platformAccountId)) {
      const message =
        `The stored token belongs to YouTube channel ${channels.join(', ')}, not to ` +
        `${ctx.connection.displayName} (${ctx.connection.platformAccountId}). Nothing was uploaded.`
      throw new PublishError(message, {
        // The credential is the thing that is wrong: reconnecting the right
        // account fixes it, retrying never will.
        failureClass: 'credential',
        platformMessage: message,
        platformCode: 'wrong_channel',
        code: 'YOUTUBE_WRONG_CHANNEL',
      })
    }
  }

  /** Opens a resumable session with the metadata, and returns its address. */
  async #startSession(
    ctx: PublishContext,
    upload: {
      readonly title: string
      readonly description: string
      readonly privacy: YouTubePrivacy
      readonly synthetic: boolean
      readonly contentType: string
      readonly size: number
    },
  ): Promise<string> {
    const url = new URL(UPLOAD_URL)
    url.searchParams.set('uploadType', 'resumable')
    url.searchParams.set('part', 'snippet,status')
    if (this.#notifySubscribers !== undefined) {
      url.searchParams.set('notifySubscribers', String(this.#notifySubscribers))
    }

    const resource = {
      snippet: {
        title: upload.title,
        description: upload.description,
        // A string: the property is typed string, whatever Google's sample sends.
        categoryId: this.#categoryId,
        ...(this.#tags.length > 0 ? { tags: [...this.#tags] } : {}),
      },
      status: {
        privacyStatus: upload.privacy,
        selfDeclaredMadeForKids: this.#madeForKids,
        containsSyntheticMedia: upload.synthetic,
      },
    }

    let response: Response
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.credential.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          // The real length from disk, never the declared one: Google holds the
          // upload to exactly this many bytes.
          'X-Upload-Content-Length': String(upload.size),
          'X-Upload-Content-Type': upload.contentType,
        },
        body: JSON.stringify(resource),
        redirect: 'manual',
      }
      if (ctx.signal !== undefined) init.signal = ctx.signal
      response = await this.#fetch(url.toString(), init)
    } catch (cause) {
      throw new PublishError('Could not reach YouTube to start the upload.', {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }

    if (!response.ok) {
      throw googleError(((await readJson(response)) ?? {}) as GoogleErrorBody, response.status, {
        what: 'Starting the YouTube upload',
        retryAfter: response.headers.get('retry-after'),
      })
    }

    const session = response.headers.get('location')
    await drain(response)
    // The token goes with every chunk, so it is only ever sent back to Google.
    if (session === null || !isGoogleUrl(session)) {
      throw new PublishError('YouTube did not return an upload address, so the video cannot be sent.', {
        failureClass: 'transient',
        httpStatus: response.status,
      })
    }
    return session
  }

  /**
   * Sends the file, chunk by chunk, until the session reports the video made.
   *
   * After any interruption — no reply, or a 5xx — nothing more is sent until
   * the session has been asked what it holds, because Google warns that a
   * chunk may have arrived in full, in part, or not at all. Interruptions in a
   * row are bounded; progress resets the count, so a long upload on a shaky
   * line survives many blips but a dead one gives up.
   */
  async #sendFile(
    ctx: PublishContext,
    session: string,
    source: MediaSource,
    contentType: string,
  ): Promise<VideoResource> {
    let offset = 0
    let failures = 0
    let mustAsk = false
    // A ceiling on requests overall, whatever the replies say. Progress resets
    // the failure count, so a session that kept giving back ground could
    // otherwise keep this going forever.
    let budget = Math.ceil(source.size / this.#chunkBytes) * 3 + 20

    for (;;) {
      budget -= 1
      if (budget < 0) {
        throw new PublishError(
          `The YouTube upload made no lasting progress and was stopped at byte ${offset} of ${source.size}. ` +
            'Nothing was published; the next attempt starts it again.',
          { failureClass: 'transient' },
        )
      }
      const asking = mustAsk || offset >= source.size
      const reply = asking
        ? await this.#askStatus(ctx, session, source.size)
        : await this.#putChunk(ctx, session, source, offset, contentType)
      mustAsk = false

      if (reply.kind === 'done') return reply.video

      if (reply.kind === 'incomplete') {
        const moved = reply.received > offset
        offset = reply.received
        if (moved) {
          failures = 0
          continue
        }
        // A status check may report no progress: it is saying where to resume.
        if (asking && offset < source.size) continue
      } else {
        mustAsk = true
      }

      failures += 1
      if (failures > this.#maxResumeAttempts) {
        const network = reply.kind === 'interrupted' && reply.httpStatus === undefined
        throw new PublishError(
          `The YouTube upload was interrupted ${failures} times in a row and stopped at byte ${offset} of ${source.size}. ` +
            'Nothing was published; the next attempt starts it again.',
          {
            failureClass: 'transient',
            ...(reply.kind === 'interrupted' && reply.httpStatus !== undefined ? { httpStatus: reply.httpStatus } : {}),
            ...(network ? { code: 'PLATFORM_UNREACHABLE' as const } : {}),
          },
        )
      }

      const asked = reply.kind === 'interrupted' ? reply.retryAfterMs : undefined
      if (asked !== undefined && asked > LONGEST_INLINE_WAIT_MS) {
        throw new PublishError('YouTube asked for a long pause in the middle of the upload. Nothing was published; it is tried again later.', {
          failureClass: 'transient',
          retryAfterSeconds: Math.ceil(asked / 1000),
        })
      }
      await this.#sleep(asked ?? backoffMs(failures, { baseMs: this.#retryBaseMs, maxMs: 32_000 }))
    }
  }

  async #putChunk(
    ctx: PublishContext,
    session: string,
    source: MediaSource,
    offset: number,
    contentType: string,
  ): Promise<UploadReply> {
    const last = Math.min(offset + this.#chunkBytes, source.size) - 1
    // Read only now, so one chunk at a time is in memory however large the file.
    const bytes = await source.read(offset, last)
    return await this.#put(ctx, session, bytes, {
      'Content-Type': contentType,
      'Content-Range': `bytes ${offset}-${last}/${source.size}`,
    })
  }

  /** An empty PUT that asks the session how much it holds. */
  async #askStatus(ctx: PublishContext, session: string, size: number): Promise<UploadReply> {
    return await this.#put(ctx, session, new Uint8Array(0), { 'Content-Range': `bytes */${size}` })
  }

  async #put(
    ctx: PublishContext,
    session: string,
    body: Uint8Array,
    headers: Record<string, string>,
  ): Promise<UploadReply> {
    let response: Response
    try {
      const init: RequestInit = {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ctx.credential.accessToken}`, ...headers },
        body,
        // A 308 here means "send more", not "go elsewhere".
        redirect: 'manual',
      }
      if (ctx.signal !== undefined) init.signal = ctx.signal
      response = await this.#fetch(session, init)
    } catch (cause) {
      if (ctx.signal?.aborted === true) {
        throw new PublishError('The upload was cancelled before it finished. Nothing was published.', {
          failureClass: 'transient',
          cause,
        })
      }
      return { kind: 'interrupted' }
    }
    return await this.#interpret(response)
  }

  async #interpret(response: Response): Promise<UploadReply> {
    const status = response.status

    if (status === 200 || status === 201) {
      const video = (await readJson(response)) as Partial<VideoResource> | undefined
      if (typeof video?.id !== 'string' || video.id === '') {
        // The video probably exists. Retrying would likely make a second copy,
        // so this is permanent and says what to check.
        throw new PublishError(
          "YouTube reported the upload complete but returned no video id. Check the channel's uploads before posting it again, or it may appear twice.",
          { failureClass: 'permanent', httpStatus: status },
        )
      }
      return { kind: 'done', video: video as VideoResource }
    }

    if (status === 308) {
      const range = response.headers.get('range')
      await drain(response)
      return { kind: 'incomplete', received: bytesHeld(range) }
    }

    if (status === 404) {
      await drain(response)
      throw new PublishError(
        'The YouTube upload session expired before the video finished. Nothing was published; the next attempt starts a fresh upload.',
        { failureClass: 'transient', httpStatus: status },
      )
    }

    if (status === 401) {
      // An hour-long token can run out in the middle of a long upload. The next
      // attempt renews it, and its channel check catches a token that was
      // revoked rather than expired.
      await drain(response)
      throw new PublishError(
        'YouTube stopped accepting the access token partway through the upload, most likely because it expired. ' +
          'Nothing was published; the next attempt renews the token and uploads again.',
        { failureClass: 'transient', httpStatus: status },
      )
    }

    if (RESUMABLE_STATUSES.has(status)) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
      await drain(response)
      return {
        kind: 'interrupted',
        httpStatus: status,
        ...(retryAfter !== undefined ? { retryAfterMs: retryAfter * 1000 } : {}),
      }
    }

    throw googleError(((await readJson(response)) ?? {}) as GoogleErrorBody, status, {
      what: 'Uploading the video to YouTube',
      retryAfter: response.headers.get('retry-after'),
    })
  }

  /**
   * The privacy YouTube actually applied, read back after the upload. Google
   * documents no flag for "locked private", so comparing this with what was
   * asked for is the only honest check. Never throws: the video already exists,
   * and failing now would have it uploaded again.
   */
  async #readPrivacy(ctx: PublishContext, videoId: string): Promise<string | undefined> {
    try {
      const url = new URL(`${API_BASE}/videos`)
      url.searchParams.set('part', 'status')
      url.searchParams.set('id', videoId)
      const data = await this.#getJson<{ items?: ReadonlyArray<{ status?: { privacyStatus?: string } }> }>(
        ctx,
        url.toString(),
        'Reading back the uploaded video',
      )
      return data.items?.[0]?.status?.privacyStatus
    } catch {
      return undefined
    }
  }

  async #getJson<T>(ctx: PublishContext, url: string, what: string): Promise<T> {
    let response: Response
    try {
      const init: RequestInit = {
        method: 'GET',
        headers: { Authorization: `Bearer ${ctx.credential.accessToken}` },
      }
      if (ctx.signal !== undefined) init.signal = ctx.signal
      response = await this.#fetch(url, init)
    } catch (cause) {
      throw new PublishError(`Could not reach YouTube (${what}).`, {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }

    const parsed = await readJson(response)
    if (!response.ok) {
      throw googleError((parsed ?? {}) as GoogleErrorBody, response.status, {
        what,
        retryAfter: response.headers.get('retry-after'),
      })
    }
    if (parsed === undefined) {
      throw new PublishError(`YouTube answered with something that was not JSON (${what}).`, {
        failureClass: 'transient',
        httpStatus: response.status,
      })
    }
    return parsed as T
  }
}

/**
 * Characters YouTube counts against its 500-character tag limit.
 *
 * Google's rule: the commas between tags count, and a tag containing a space
 * counts as if it were in quotation marks — `Foo-Baz` is 7, `Foo Baz` is 9.
 */
export function youtubeTagCharacters(tags: readonly string[]): number {
  const cleaned = tags.map((tag) => tag.trim()).filter((tag) => tag !== '')
  if (cleaned.length === 0) return 0
  const characters = cleaned.reduce((sum, tag) => sum + countGraphemes(tag) + (/\s/.test(tag) ? 2 : 0), 0)
  return characters + (cleaned.length - 1)
}

/**
 * The adapter's settings from the environment.
 *
 * Read in one place so every app builds the adapter the same way and the
 * variable names exist once. Anything unreadable falls back to the safe value:
 * an unknown privacy becomes private, and anything but an explicit yes for the
 * audit leaves uploads private. A typo must never make a video public.
 */
export function youTubeOptionsFromEnv(read: (key: string) => string | undefined): YouTubeAdapterOptions {
  const privacy = read('YOUTUBE_DEFAULT_PRIVACY')?.trim().toLowerCase()
  const audited = read('YOUTUBE_UPLOADS_AUDITED')?.trim().toLowerCase()
  const category = read('YOUTUBE_CATEGORY_ID')?.trim()
  const clientId = read('GOOGLE_CLIENT_ID')
  const clientSecret = read('GOOGLE_CLIENT_SECRET')

  return {
    audited: audited === 'true' || audited === '1' || audited === 'yes',
    privacy: YOUTUBE_PRIVACY_VALUES.find((value) => value === privacy) ?? 'private',
    categoryId: category !== undefined && category !== '' ? category : YOUTUBE_DEFAULT_CATEGORY_ID,
    ...(clientId !== undefined && clientSecret !== undefined ? { oauth: { clientId, clientSecret } } : {}),
  }
}

/**
 * What to tell the reader about the video's visibility, or undefined when it
 * went out public as asked — the only case that is plainly "published".
 */
function privacyNotice(outcome: {
  readonly audited: boolean
  readonly requested: YouTubePrivacy
  readonly applied: string | undefined
  readonly confirmed: boolean
}): string | undefined {
  const unconfirmed = outcome.confirmed
    ? ''
    : ' This is what the upload reply said; reading the video back to confirm it failed.'

  if (outcome.applied === undefined) {
    return (
      'Uploaded, but YouTube did not say which privacy it applied, so it is not confirmed as published. ' +
      'Check the video in YouTube Studio before treating it as public.'
    )
  }

  if (!outcome.audited) {
    return (
      'Uploaded as private, not published. This Google Cloud project has not passed the YouTube API audit, ' +
      'and YouTube restricts uploads from unaudited projects to private viewing, so only the channel can see it. ' +
      'YouTube says such videos cannot be appealed: to go public, upload it again once the audit has passed, ' +
      'then set YOUTUBE_UPLOADS_AUDITED=true.' +
      (outcome.applied !== 'private' ? ` YouTube reports its privacy as ${outcome.applied}.` : '') +
      unconfirmed
    )
  }

  if (outcome.applied !== outcome.requested) {
    return (
      `Uploaded as ${outcome.applied}, not ${outcome.requested} as requested.` +
      (outcome.applied === 'private'
        ? ' YouTube locks uploads from projects that have not passed its API audit to private; check that the audit really has passed.'
        : '') +
      unconfirmed
    )
  }

  if (outcome.applied === 'private') {
    return `Uploaded as private, as configured: only the channel can see it.${unconfirmed}`
  }
  if (outcome.applied === 'unlisted') {
    return `Uploaded as unlisted, as configured: only people with the link can see it.${unconfirmed}`
  }
  return outcome.confirmed ? undefined : `Uploaded as public.${unconfirmed}`
}

/** Bytes the session holds, from a 308's `Range: bytes=0-N`. No header means none yet. */
function bytesHeld(range: string | null): number {
  if (range === null) return 0
  const match = /bytes=\d+-(\d+)/.exec(range)
  return match === null ? 0 : Number(match[1]) + 1
}

/** Only ever send the token back to Google. */
function isGoogleUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'googleapis.com' || url.hostname.endsWith('.googleapis.com'))
  } catch {
    return false
  }
}

/**
 * Shortens text to at most `max` graphemes, at a word where that keeps most of
 * it, ending with an ellipsis. Cuts between graphemes, never inside an emoji.
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
