import { mediaKindForMime, type MediaRef, type PostDraft } from '@social-publisher/core'

/** A target's post as the worker loads it: the post row and its media, in order. */
export interface StoredPost {
  readonly body: string
  readonly overrides: unknown
  readonly media: ReadonlyArray<{
    readonly media: {
      readonly id: string
      readonly mime: string
      readonly bytes: number
      readonly publicUrl: string
      readonly width: number | null
      readonly height: number | null
      readonly durationSeconds: number | null
    }
  }>
}

/**
 * The draft a scheduled or retried target publishes, rebuilt from the database
 * alone: the worker runs in another process, later, and has nothing else.
 *
 * So whatever is not stored with the post does not go out. That is why every
 * path that schedules a post stores its media rows, and why a post whose
 * attachments could not be stored is never re-queued (see the worker's
 * refusal and `TenantScope.retryTarget`).
 */
export function draftFromStored(post: StoredPost): PostDraft {
  const media: MediaRef[] = post.media.map((link) => ({
    id: link.media.id,
    // The media table holds a mime type and no kind: a PDF is a document (a
    // LinkedIn carousel), video/* is video, anything else an image, as before.
    kind: mediaKindForMime(link.media.mime),
    mime: link.media.mime,
    bytes: link.media.bytes,
    publicUrl: link.media.publicUrl,
    ...(link.media.width !== null ? { width: link.media.width } : {}),
    ...(link.media.height !== null ? { height: link.media.height } : {}),
    ...(link.media.durationSeconds !== null ? { durationSeconds: link.media.durationSeconds } : {}),
  }))

  const overrides = post.overrides as NonNullable<PostDraft['overrides']> | null
  return {
    body: post.body,
    media,
    ...(overrides !== null ? { overrides } : {}),
  }
}
