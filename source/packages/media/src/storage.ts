import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

/**
 * Media hosting on Supabase Storage.
 *
 * Exists for one reason: **Instagram and TikTok fetch media from a public URL
 * rather than accepting an upload.** There is no way to POST bytes to them, so an
 * image must already be reachable on the public internet before a post can be
 * created. Facebook accepts uploads directly and does not need any of this.
 *
 * Supabase rather than Cloudflare R2: the account already exists, no payment card
 * is required, and 1 GB is thousands of social images. Swapping to R2 later means
 * reimplementing this one interface.
 */

export interface UploadedMedia {
  readonly key: string
  readonly publicUrl: string
  readonly bytes: number
  readonly mime: string
  readonly sha256: string
  /** True when an identical file was already stored and nothing was re-uploaded. */
  readonly reused: boolean
}

/**
 * The largest file the media store takes: Supabase's Free plan per-file cap.
 *
 * WHY (2026-10-11): Supabase documents "Free: 50 MB" per file ("For Free
 * projects, the limit can't exceed 50 MB", supabase.com/docs/guides/storage/
 * uploads/file-limits, checked 2026-10-11), and our bucket is on the Free plan.
 * A video over it used to be read whole into memory and sent, only to be
 * refused with a bare HTTP 413. It is now refused before anything is read or
 * sent, with the cap and the plan named. Taken as 50 MiB, the larger reading,
 * so nothing Supabase would accept is refused here; a file the server still
 * refuses gets the same explanation from the 413.
 *
 * Raising the cap or moving video off Supabase is a separate decision (video
 * pipeline plan, V4: object storage we control); this only makes the limit
 * visible early.
 */
export const SUPABASE_FREE_FILE_LIMIT_BYTES = 50 * 1024 * 1024

export interface MediaStoreOptions {
  readonly supabaseUrl: string
  readonly serviceRoleKey: string
  readonly bucket: string
  readonly fetch?: typeof globalThis.fetch
  /** The per-file cap. Default: the Supabase Free plan's 50 MB. */
  readonly maxFileBytes?: number
}

export class MediaUploadError extends Error {
  readonly status: number | undefined
  /**
   * The catalogue entry for this failure. A file over the store's cap is
   * STORAGE_REJECTED, whose fix includes checking the size against the limit.
   */
  readonly code: 'STORAGE_REJECTED' | undefined
  constructor(message: string, status?: number, code?: 'STORAGE_REJECTED') {
    super(message)
    this.name = 'MediaUploadError'
    this.status = status
    this.code = code
  }
}

/**
 * What to say when a file is over the store's cap: its size, the cap, the
 * plan that sets it, and what to do instead.
 */
export function tooLargeForStorageMessage(bytes: number, capBytes: number, mime?: string): string {
  const what = mime?.startsWith('video/') === true ? 'video' : 'file'
  return (
    `This ${what} is ${megabytes(bytes)}, over the ${megabytes(capBytes)} per-file limit of the media storage ` +
    '(Supabase Storage on the Free plan), so it was not uploaded and nothing was posted. ' +
    (what === 'video'
      ? 'To post it now, publish it immediately from the local file to the platforms that take uploads (they read it ' +
        'straight from disk, with no storage limit); a scheduled post and platforms that fetch by URL need it stored. ' +
        `Or export it under ${megabytes(capBytes)}. `
      : `Use a file under ${megabytes(capBytes)}. `) +
    'Storing large videos is planned (video pipeline plan, decision V4: move media to storage we control).'
  )
}

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
}

export function mimeForPath(path: string): string | undefined {
  return MIME_BY_EXT[extname(path).toLowerCase()]
}

export class MediaStore {
  readonly #base: string
  readonly #key: string
  readonly #bucket: string
  readonly #fetch: typeof globalThis.fetch
  /** The per-file cap, in bytes. */
  readonly maxFileBytes: number

  constructor(options: MediaStoreOptions) {
    this.#base = options.supabaseUrl.replace(/\/+$/, '')
    this.#key = options.serviceRoleKey
    this.#bucket = options.bucket
    this.#fetch = options.fetch ?? globalThis.fetch
    this.maxFileBytes = options.maxFileBytes ?? SUPABASE_FREE_FILE_LIMIT_BYTES
  }

  /**
   * Refuses a file over the cap before anything is read or sent. Callers that
   * know a size before reading the bytes (a browser upload, a file on disk)
   * call it first, so a large video is never read into memory for nothing.
   */
  assertFits(bytes: number, mime?: string): void {
    if (bytes > this.maxFileBytes) {
      throw new MediaUploadError(tooLargeForStorageMessage(bytes, this.maxFileBytes, mime), 413, 'STORAGE_REJECTED')
    }
  }

  /**
   * Uploads bytes and returns a public URL.
   *
   * The object key is the content hash, so uploading the same image twice reuses
   * the first upload instead of filling the bucket with duplicates. It also means
   * a retried publish does not create a second copy.
   */
  async upload(
    bytes: Uint8Array,
    options: { mime: string; tenantId: string; extension?: string },
  ): Promise<UploadedMedia> {
    this.assertFits(bytes.length, options.mime)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const ext = options.extension ?? extensionForMime(options.mime)
    const key = `${options.tenantId}/${sha256}${ext}`
    const publicUrl = this.publicUrlFor(key)

    // upsert=false makes a duplicate return 409, which is the signal that this
    // exact content is already hosted.
    const response = await this.#fetch(`${this.#base}/storage/v1/object/${this.#bucket}/${key}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#key}`,
        apikey: this.#key,
        'content-type': options.mime,
        'x-upsert': 'false',
        'cache-control': 'public, max-age=31536000, immutable',
      },
      body: bytes,
    })

    if (response.ok) {
      return { key, publicUrl, bytes: bytes.length, mime: options.mime, sha256, reused: false }
    }

    const detail = await response.text().catch(() => '')

    /**
     * A duplicate is success, not failure: the key is the content hash, so an
     * existing object holds byte-identical content and the public URL is already
     * correct. This is what makes a retried publish safe.
     *
     * Supabase does not signal this with an HTTP 409 — it returns **HTTP 400**
     * with `"statusCode":"409"` and `"code":"KeyAlreadyExists"` in the body, so
     * checking response.status alone silently misses it.
     */
    if (isDuplicate(response.status, detail)) {
      return { key, publicUrl, bytes: bytes.length, mime: options.mime, sha256, reused: true }
    }

    if (isTooLarge(response.status, detail)) {
      // Under our cap yet refused as too large: the bucket has a lower limit
      // of its own, which is set per bucket in Supabase.
      throw new MediaUploadError(
        `Storage refused this file as too large (HTTP 413). It is ${megabytes(bytes.length)}, within the ` +
          `${megabytes(this.maxFileBytes)} per-file limit of the Supabase Free plan, so the bucket "${this.#bucket}" has a lower ` +
          'limit of its own. Raise it in Supabase Dashboard > Storage > the bucket > Edit (up to the plan limit), or use a smaller file. ' +
          'Nothing was posted.',
        413,
        'STORAGE_REJECTED',
      )
    }

    throw new MediaUploadError(
      `Upload failed (HTTP ${response.status}). ${describeFailure(response.status, detail)}`,
      response.status,
    )

    return { key, publicUrl, bytes: bytes.length, mime: options.mime, sha256, reused: false }
  }

  async uploadFile(path: string, options: { tenantId: string; mime?: string }): Promise<UploadedMedia> {
    const mime = options.mime ?? mimeForPath(path)
    if (mime === undefined) {
      throw new MediaUploadError(`Cannot determine a media type for ${path}`)
    }
    // Before reading: a 2 GB video over the cap must not be loaded into memory
    // only to be refused.
    this.assertFits((await stat(path)).size, mime)
    const bytes = new Uint8Array(await readFile(path))
    return await this.upload(bytes, { mime, tenantId: options.tenantId, extension: extname(path).toLowerCase() })
  }

  publicUrlFor(key: string): string {
    return `${this.#base}/storage/v1/object/public/${this.#bucket}/${key}`
  }

  /**
   * Confirms a URL is actually reachable anonymously.
   *
   * Worth calling before an Instagram publish: a private bucket produces a
   * confusing Instagram-side error long after the real mistake was made here.
   */
  async isPubliclyReachable(url: string): Promise<boolean> {
    try {
      const response = await this.#fetch(url, { method: 'HEAD' })
      return response.ok
    } catch {
      return false
    }
  }
}

/**
 * Recognises "this object already exists" across the shapes Supabase uses.
 *
 * Deliberately tolerant: a genuine duplicate is harmless to treat as success, and
 * the alternative — failing a publish because the image was already uploaded — is
 * a real outage for something that actually worked.
 */
function isDuplicate(status: number, detail: string): boolean {
  if (status === 409) return true
  if (status !== 400) return false
  return (
    detail.includes('KeyAlreadyExists') ||
    detail.includes('"statusCode":"409"') ||
    detail.includes('resource already exists') ||
    detail.includes('Duplicate')
  )
}

function extensionForMime(mime: string): string {
  for (const [ext, value] of Object.entries(MIME_BY_EXT)) {
    if (value === mime) return ext
  }
  return ''
}

/**
 * "Too large" across the shapes Supabase uses. Like a duplicate, it may come
 * as HTTP 400 with the real status in the body rather than as a 413.
 */
function isTooLarge(status: number, detail: string): boolean {
  if (status === 413) return true
  return (
    detail.includes('"statusCode":"413"') ||
    /payload too large/i.test(detail) ||
    /exceeded the maximum allowed size/i.test(detail)
  )
}

/** Bytes as MB (1 MB = 1,048,576 bytes, the unit Supabase's limits use), e.g. 50 MB or 120.4 MB. */
function megabytes(bytes: number): string {
  return `${Math.round((bytes / 1_048_576) * 10) / 10} MB`
}

function describeFailure(status: number, detail: string): string {
  if (status === 400 && detail.includes('Bucket not found')) {
    return 'The bucket does not exist. Create it in Supabase Storage.'
  }
  if (status === 401 || status === 403) {
    return 'The service_role key was rejected. Check SUPABASE_SERVICE_ROLE_KEY.'
  }
  return detail.slice(0, 200)
}
