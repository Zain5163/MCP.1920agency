import type { Capabilities, ValidationIssue, ValidationResult } from '../adapters/adapter.ts'
import type { Platform, PlatformOverride, PostDraft } from './types.ts'

/**
 * Counts user-perceived characters (graphemes), not UTF-16 code units.
 *
 * `"👨‍👩‍👧‍👦".length` is 11 and `[..."👨‍👩‍👧‍👦"].length` is 7, but every platform counts it
 * as 1. Getting this wrong means rejecting valid posts and accepting ones the
 * platform will refuse — and it shows up the moment anyone uses an emoji.
 */
export function countGraphemes(text: string): number {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (Segmenter === undefined) return [...text].length
  const segmenter = new Segmenter('en', { granularity: 'grapheme' })
  let count = 0
  for (const _ of segmenter.segment(text)) count += 1
  return count
}

/** Resolves the body actually sent to a platform, honouring per-platform overrides. */
export function bodyForPlatform(draft: PostDraft, platform: Platform): string {
  return draft.overrides?.[platform]?.body ?? draft.body
}

/**
 * Resolves the title actually sent to a platform: its own override first, then
 * the draft's title, else undefined.
 *
 * A blank title counts as no title. Forms and AI callers send `''` for an empty
 * field, and treating that as a real title would let a blank override hide the
 * draft's title, or send a platform an empty title it rejects. Surrounding
 * whitespace is dropped for the same reason: it is never meant.
 */
export function titleForPlatform(draft: PostDraft, platform: Platform): string | undefined {
  for (const candidate of [draft.overrides?.[platform]?.title, draft.title]) {
    const trimmed = candidate?.trim()
    if (trimmed !== undefined && trimmed !== '') return trimmed
  }
  return undefined
}

/**
 * Whether this platform's post declares realistic AI-generated or altered media.
 *
 * Always a boolean, never undefined: platforms that ask for the disclosure are
 * sent an explicit answer, because their default for a missing one is not
 * documented and guessing wrong is a policy breach rather than a typo.
 */
export function syntheticMediaForPlatform(draft: PostDraft, platform: Platform): boolean {
  return draft.overrides?.[platform]?.syntheticMedia ?? draft.syntheticMedia ?? false
}

/**
 * The overrides to store with a post, so the worker can rebuild the draft
 * exactly — when it is scheduled, and when a failed target is retried.
 *
 * The posts table has a body and an `overrides` JSON column but no title or
 * disclosure column, and adding one is a migration. So the draft's own title
 * and `syntheticMedia` are written into the override of every target platform,
 * where the worker already reads overrides back. A platform's own override
 * still wins over the draft-level value, exactly as when publishing now.
 *
 * Returns undefined when there is nothing to store, so a plain post keeps a
 * null column rather than an empty object.
 */
export function overridesForStorage(
  draft: PostDraft,
  platforms: readonly Platform[],
): PostDraft['overrides'] | undefined {
  const out: Partial<Record<Platform, PlatformOverride>> = { ...draft.overrides }
  for (const platform of platforms) {
    const merged: PlatformOverride = {
      ...(draft.title !== undefined ? { title: draft.title } : {}),
      ...(draft.syntheticMedia !== undefined ? { syntheticMedia: draft.syntheticMedia } : {}),
      ...draft.overrides?.[platform],
    }
    if (Object.keys(merged).length > 0) out[platform] = merged
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Shared validation every adapter runs. An adapter may add platform-specific
 * rules on top, but must not reimplement these.
 */
export function validateAgainstCapabilities(
  draft: PostDraft,
  platform: Platform,
  caps: Capabilities,
): ValidationResult {
  const issues: ValidationIssue[] = []
  const add = (
    severity: ValidationIssue['severity'],
    code: string,
    message: string,
  ): void => {
    issues.push({ severity, code, message, platform })
  }

  const body = bodyForPlatform(draft, platform)
  const length = countGraphemes(body)

  if (length > caps.maxTextLength) {
    add(
      'error',
      'text_too_long',
      `Text is ${length} characters, ${length - caps.maxTextLength} over the ${caps.maxTextLength} limit.`,
    )
  }

  /**
   * Title, only where the platform has one. Counted in graphemes like the body,
   * so an emoji in a title costs what the platform charges for it. A missing
   * title is not an error here: some titled platforms fall back to the first
   * line of the text, and that rule belongs to their adapter.
   */
  if (caps.titleMaxLength !== undefined) {
    const title = titleForPlatform(draft, platform)
    const titleLength = title === undefined ? 0 : countGraphemes(title)
    if (titleLength > caps.titleMaxLength) {
      add(
        'error',
        'title_too_long',
        `Title is ${titleLength} characters, ${titleLength - caps.titleMaxLength} over the ${caps.titleMaxLength} limit.`,
      )
    }
  }

  const media = draft.media
  const images = media.filter((m) => m.kind === 'image')
  const videos = media.filter((m) => m.kind === 'video')
  const documents = media.filter((m) => m.kind === 'document')
  const kinds = new Set(media.map((m) => m.kind))

  if (media.length < caps.minMediaCount) {
    add(
      'error',
      'media_required',
      caps.minMediaCount === 1
        ? 'This platform cannot post text alone — attach an image or video.'
        : `At least ${caps.minMediaCount} media items are required.`,
    )
  }

  if (media.length > caps.maxMediaCount) {
    add(
      'error',
      'too_many_media',
      `${media.length} media items attached, but the limit is ${caps.maxMediaCount}.`,
    )
  }

  if (body.trim() === '' && media.length === 0) {
    add('error', 'empty_post', 'A post needs text, media, or both.')
  }

  for (const kind of kinds) {
    if (!caps.mediaKinds.includes(kind)) {
      add('error', 'unsupported_media_kind', `This platform does not accept ${kind} posts.`)
    }
  }

  // Any two kinds together, not only images with video: a document mixed with
  // either is refused the same way, and with images and video alone this is
  // exactly the check it always was.
  if (!caps.allowsMixedMedia && kinds.size > 1) {
    add(
      'error',
      'mixed_media',
      documents.length > 0
        ? 'A document is posted on its own here: it cannot be combined with images or video.'
        : 'Images and video cannot be combined in one post here.',
    )
  }

  /**
   * Documents, where the platform takes them: how many one post may carry, and
   * how large each may be. A platform that does not take documents has already
   * refused them above as an unsupported kind, so these add nothing there.
   */
  if (documents.length > 0 && caps.mediaKinds.includes('document')) {
    if (caps.maxDocumentCount !== undefined && documents.length > caps.maxDocumentCount) {
      add(
        'error',
        'too_many_documents',
        caps.maxDocumentCount === 1
          ? `${documents.length} documents attached, but a post here carries one.`
          : `${documents.length} documents attached, but the limit is ${caps.maxDocumentCount}.`,
      )
    }
    for (const doc of documents) {
      if (caps.maxDocumentBytes !== undefined && doc.bytes > caps.maxDocumentBytes) {
        add(
          'error',
          'document_too_large',
          `The document is ${megabytes(doc.bytes)}, over the ${megabytes(caps.maxDocumentBytes)} limit.`,
        )
      }
    }
  }

  for (const video of videos) {
    const duration = video.durationSeconds
    if (duration === undefined) {
      add(
        'warning',
        'unknown_duration',
        'Video duration is unknown, so length limits could not be checked before publishing.',
      )
      continue
    }
    if (caps.videoMaxSeconds !== undefined && duration > caps.videoMaxSeconds) {
      add(
        'error',
        'video_too_long',
        `Video is ${Math.round(duration)}s, over the ${caps.videoMaxSeconds}s limit.`,
      )
    }
    if (caps.videoMinSeconds !== undefined && duration < caps.videoMinSeconds) {
      add(
        'error',
        'video_too_short',
        `Video is ${Math.round(duration)}s, under the ${caps.videoMinSeconds}s minimum.`,
      )
    }
    if (caps.maxVideoBytes !== undefined && video.bytes > caps.maxVideoBytes) {
      add('error', 'video_too_large', `Video exceeds the ${caps.maxVideoBytes} byte limit.`)
    }
  }

  for (const image of images) {
    if (caps.maxImageBytes !== undefined && image.bytes > caps.maxImageBytes) {
      add('error', 'image_too_large', `Image exceeds the ${caps.maxImageBytes} byte limit.`)
    }
  }

  /**
   * Aspect ratio.
   *
   * Instagram rejects anything outside 4:5 to 1.91:1 when the container is
   * created, and the error it returns reads like a permissions problem rather
   * than a shape problem. Catching it here turns a confusing platform failure
   * into a clear instruction before anything is queued.
   *
   * Only checked when dimensions are known — an unknown size warns rather than
   * blocking, because a wrongly-rejected valid post is worse than a late failure.
   */
  if (caps.aspectRatioMin !== undefined || caps.aspectRatioMax !== undefined) {
    for (const item of media) {
      if (item.width === undefined || item.height === undefined || item.height === 0) {
        if (media.length > 0) {
          add(
            'warning',
            'unknown_dimensions',
            'Image dimensions are unknown, so the aspect ratio could not be checked before publishing.',
          )
        }
        break
      }

      const ratio = item.width / item.height
      const min = caps.aspectRatioMin ?? 0
      const max = caps.aspectRatioMax ?? Infinity

      if (ratio < min || ratio > max) {
        add(
          'error',
          'aspect_ratio_unsupported',
          `${item.width}x${item.height} is ${ratio.toFixed(2)}:1, outside this platform's accepted range ` +
            `(${min.toFixed(2)}:1 to ${max.toFixed(2)}:1). Crop it to square, portrait 4:5, or landscape 1.91:1.`,
        )
      }
    }
  }

  /**
   * Platforms that fetch media cannot be handed a URL that is not yet live. This
   * is checked here rather than at publish time so the failure is visible while
   * the user is still looking at the composer.
   */
  if (caps.requiresPublicMediaUrl) {
    for (const item of media) {
      if (item.publicUrl === undefined || !item.publicUrl.startsWith('https://')) {
        add(
          'error',
          'media_not_publicly_hosted',
          'This platform fetches media over HTTPS, so every attachment needs a public https:// URL.',
        )
        break
      }
    }
  } else {
    // Upload-capable platforms still need the bytes from somewhere.
    for (const item of media) {
      if (item.publicUrl === undefined && item.localPath === undefined) {
        add(
          'error',
          'media_source_missing',
          'Attachment has neither a public URL nor a local file to upload.',
        )
        break
      }
    }
  }

  if (draft.scheduledFor !== undefined && draft.scheduledFor.getTime() < Date.now()) {
    add('error', 'scheduled_in_past', 'Scheduled time is in the past.')
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}

/** Bytes as decimal megabytes for a message, e.g. 100 MB or 120.5 MB. */
function megabytes(bytes: number): string {
  return `${Math.round(bytes / 100_000) / 10} MB`
}
