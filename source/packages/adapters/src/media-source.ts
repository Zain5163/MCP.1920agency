import { randomUUID } from 'node:crypto'
import { open, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PublishError, classifyHttpStatus, classifyNetworkError, type MediaRef } from '@social-publisher/core'

/**
 * Media read from disk one byte range at a time, for the platforms that take
 * uploaded bytes rather than fetching a URL — LinkedIn and YouTube.
 *
 * Moved here from the LinkedIn adapter when YouTube needed the same thing. The
 * LinkedIn tests cover the behaviour and were left unchanged by the move,
 * which is what shows nothing about it changed.
 */

/**
 * A file that can be read one byte range at a time.
 *
 * Exists so a large video is never held in memory in one piece: each part is
 * read from disk only when it is about to be sent.
 *
 * `size` is the file's real length from `stat`, never the size a caller
 * declared. Platforms that are told the length up front — LinkedIn's part list,
 * YouTube's `X-Upload-Content-Length` — reject or corrupt an upload whose bytes
 * do not match, and a declared size can be zero or a guess.
 */
export interface MediaSource {
  readonly size: number
  read(start: number, endInclusive: number): Promise<Uint8Array>
  close(): Promise<void>
}

/**
 * `owned` means this code created the file and must delete it. A caller's own
 * media is never deleted, which would be a spectacular thing to get wrong.
 */
export async function fileSource(path: string, owned: boolean): Promise<MediaSource> {
  const { size } = await stat(path)
  const handle = await open(path, 'r')
  let closed = false

  return {
    size,
    async read(start, endInclusive) {
      const length = endInclusive - start + 1
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, 0, length, start)
      // A short read means the file changed under us mid-upload. Sending the
      // padding would upload silent corruption, so it stops instead.
      if (bytesRead !== length) {
        throw new PublishError(
          `Read ${bytesRead} bytes where ${length} were expected. The media file changed while it was being uploaded.`,
          { failureClass: 'transient' },
        )
      }
      return new Uint8Array(buffer)
    },
    async close() {
      if (closed) return
      closed = true
      await handle.close().catch(() => {})
      if (owned) await unlink(path).catch(() => {})
    },
  }
}

/**
 * Opens media as a file on disk that can be read one range at a time.
 *
 * The first version of this, in the LinkedIn adapter, returned the whole file
 * as a single `Uint8Array`. Fine for a 1.6 MB image, and an out-of-memory crash
 * for a 400 MB video — several concurrent uploads on a worker would each hold
 * their entire file in one buffer. Reading parts straight from disk is both the
 * fix and the natural shape, since the platforms want parts anyway.
 *
 * A URL is downloaded to a temporary file first rather than held in memory.
 * That trades disk for RAM deliberately: disk is the resource we have. The
 * temporary file is owned, so closing the source deletes it.
 *
 * `signal`, when given, also cancels that download.
 */
export async function openMedia(
  media: MediaRef,
  fetchImpl: typeof globalThis.fetch,
  options: { readonly signal?: AbortSignal } = {},
): Promise<MediaSource> {
  if (media.localPath !== undefined) {
    try {
      return await fileSource(media.localPath, false)
    } catch (cause) {
      throw new PublishError(`Could not read the media file at ${media.localPath}`, {
        failureClass: 'permanent',
        cause,
      })
    }
  }

  if (media.publicUrl !== undefined) {
    const url = media.publicUrl
    let response: Response
    try {
      response =
        options.signal !== undefined ? await fetchImpl(url, { signal: options.signal }) : await fetchImpl(url)
    } catch (cause) {
      throw new PublishError(`Could not download the media from ${url}`, {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }
    if (!response.ok) {
      throw new PublishError(`Media host returned HTTP ${response.status} for ${url}`, {
        failureClass: classifyHttpStatus(response.status),
        httpStatus: response.status,
      })
    }

    const temp = join(tmpdir(), `adspilot-${randomUUID()}`)
    try {
      const handle = await open(temp, 'w')
      try {
        // Streamed rather than buffered, so a large download never exists in
        // memory in one piece either.
        if (response.body !== null) {
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            await handle.write(chunk)
          }
        }
      } finally {
        await handle.close()
      }
    } catch (cause) {
      await unlink(temp).catch(() => {})
      throw new PublishError(`Could not save the download from ${url}`, {
        failureClass: 'transient',
        cause,
      })
    }

    // Owned: this temp file is deleted when the source is closed.
    return await fileSource(temp, true)
  }

  throw new PublishError('The media has neither a local file nor a URL to upload from.', {
    failureClass: 'permanent',
  })
}
