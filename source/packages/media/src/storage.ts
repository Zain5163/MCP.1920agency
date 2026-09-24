import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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

export interface MediaStoreOptions {
  readonly supabaseUrl: string
  readonly serviceRoleKey: string
  readonly bucket: string
  readonly fetch?: typeof globalThis.fetch
}

export class MediaUploadError extends Error {
  readonly status: number | undefined
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'MediaUploadError'
    this.status = status
  }
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

  constructor(options: MediaStoreOptions) {
    this.#base = options.supabaseUrl.replace(/\/+$/, '')
    this.#key = options.serviceRoleKey
    this.#bucket = options.bucket
    this.#fetch = options.fetch ?? globalThis.fetch
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

function describeFailure(status: number, detail: string): string {
  if (status === 400 && detail.includes('Bucket not found')) {
    return 'The bucket does not exist. Create it in Supabase Storage.'
  }
  if (status === 401 || status === 403) {
    return 'The service_role key was rejected. Check SUPABASE_SERVICE_ROLE_KEY.'
  }
  if (status === 413) return 'The file is larger than the bucket allows.'
  return detail.slice(0, 200)
}
