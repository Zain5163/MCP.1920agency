import type { MediaKind } from './types.ts'

/**
 * Media types that are documents: PDF, and the Word and PowerPoint formats.
 *
 * Which of them a platform takes is that platform's business, checked in its
 * adapter. This list only says what counts as a document at all.
 */
const DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

/**
 * The kind of attachment a stored file is, from its media type.
 *
 * The media table keeps a mime type and no kind, so whatever rebuilds a draft
 * from the database (the worker, and through it every retry) derives the kind
 * here, the same way each time. That is why documents needed no migration.
 *
 * Parameters such as `; charset=binary` and letter case are ignored. A type that
 * is neither video nor a document counts as an image, which is what the worker
 * did for everything that was not video before documents existed.
 */
export function mediaKindForMime(mime: string): MediaKind {
  const type = (mime.split(';')[0] ?? '').trim().toLowerCase()
  if (type.startsWith('video/')) return 'video'
  if (DOCUMENT_MIME_TYPES.has(type)) return 'document'
  return 'image'
}
