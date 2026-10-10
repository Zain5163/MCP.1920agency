import type { Capabilities, ValidationIssue, ValidationResult } from '../adapters/adapter.ts'
import { capabilitiesFor } from '../adapters/capabilities.ts'
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
 * Whether this platform sends a title with this post.
 *
 * Only a titled platform does (`titleMaxLength`), and where its capabilities
 * name the kinds of post that carry one (`titleMediaKinds`), only a post with
 * media of such a kind: a YouTube video always has its title, a LinkedIn post
 * only when it is a document. Validation and summaries both read this, so
 * neither checks nor shows a title that never goes out.
 */
export function titleIsSent(draft: PostDraft, caps: Capabilities): boolean {
  if (caps.titleMaxLength === undefined) return false
  const kinds = caps.titleMediaKinds
  return kinds === undefined || draft.media.some((m) => kinds.includes(m.kind))
}

/** Where a draft's title and AI-media declaration actually go. See `fieldsSentTo`. */
export interface FieldsSent {
  /**
   * Each platform that sends a title with this post, and the title it sends.
   * A platform that has no title field, does not title this kind of post, or
   * has no title set is left out.
   */
  readonly titles: ReadonlyArray<{ readonly platform: Platform; readonly title: string }>
  /** Platforms the post is declared for as realistic AI-generated or altered media, and which are told. */
  readonly disclosedTo: readonly Platform[]
  /**
   * Platforms the post is declared for which are NOT told: publishing there
   * sends no such declaration, so it has to be labelled in the platform's app.
   */
  readonly notDisclosedTo: readonly Platform[]
}

/**
 * What a post's title and AI-media declaration actually reach, among the
 * platforms it is about to go to.
 *
 * An approval summary is a statement about what will go out. Summaries showed
 * "Title:" and "Declared as realistic AI-generated or altered media" for
 * every target, while Facebook, Instagram and a LinkedIn text post drop the
 * title and only YouTube is sent the declaration, so an owner approved a post
 * believing Meta had been told. This answers from capability data, so the
 * tools and the CLI can say which platform gets what without naming one.
 *
 * Each platform is listed once, in the order given, however many of its
 * accounts are targeted. `capabilitiesOf` defaults to the capability table; a
 * caller holding adapters may pass theirs.
 */
export function fieldsSentTo(
  draft: PostDraft,
  platforms: readonly Platform[],
  capabilitiesOf: (platform: Platform) => Capabilities = capabilitiesFor,
): FieldsSent {
  const titles: Array<{ readonly platform: Platform; readonly title: string }> = []
  const disclosedTo: Platform[] = []
  const notDisclosedTo: Platform[] = []
  for (const platform of new Set(platforms)) {
    const caps = capabilitiesOf(platform)
    const title = titleIsSent(draft, caps) ? titleForPlatform(draft, platform) : undefined
    if (title !== undefined) titles.push({ platform, title })
    if (!syntheticMediaForPlatform(draft, platform)) continue
    if (caps.sendsSyntheticMediaDisclosure === true) disclosedTo.push(platform)
    else notDisclosedTo.push(platform)
  }
  return { titles, disclosedTo, notDisclosedTo }
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
   * Title, only where this post sends one (`titleIsSent`): a title that never
   * goes out cannot be too long. Counted in graphemes like the body, so an
   * emoji in a title costs what the platform charges for it. A missing title is
   * not an error here: some titled platforms fall back to the first line of
   * the text, and that rule belongs to their adapter.
   */
  if (caps.titleMaxLength !== undefined && titleIsSent(draft, caps)) {
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

  /**
   * The AI-media declaration, where publishing here does not send one. A
   * warning rather than an error: the post itself is fine, but the platform is
   * not told, and nothing else would say so. Without it, the declaration read
   * as made everywhere it was asked for.
   */
  if (syntheticMediaForPlatform(draft, platform) && caps.sendsSyntheticMediaDisclosure !== true) {
    add(
      'warning',
      'synthetic_media_not_sent',
      'Marked as realistic AI-generated or altered media, but publishing here does not send that declaration, ' +
        "so this platform is not told. Label it in the platform's app after posting, or say so in the text.",
    )
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
      add(
        'error',
        'video_too_large',
        `The video is ${megabytes(video.bytes)}, over this platform's ${megabytes(caps.maxVideoBytes)} limit. ` +
          'Export it at a lower bitrate or shorten it.',
      )
    }
    if (caps.videoMaxWidth !== undefined && video.width !== undefined && video.width > caps.videoMaxWidth) {
      add(
        'error',
        'video_too_wide',
        `The video is ${video.width} pixels wide, over this platform's ${caps.videoMaxWidth}-pixel limit. ` +
          `Export it at most ${caps.videoMaxWidth} pixels wide (1080x1920 for a vertical video).`,
      )
    }
  }

  for (const image of images) {
    if (caps.maxImageBytes !== undefined && image.bytes > caps.maxImageBytes) {
      add('error', 'image_too_large', `Image exceeds the ${caps.maxImageBytes} byte limit.`)
    }
  }

  /**
   * Aspect ratio, per kind of media.
   *
   * Instagram rejects a feed image outside 4:5 to 1.91:1 when the container is
   * created, and the error it returns reads like a permissions problem rather
   * than a shape problem. Catching it here turns a confusing platform failure
   * into a clear instruction before anything is queued.
   *
   * WHY per kind (2026-10-11): a video is checked against the video range
   * only, never the image range. Applying Instagram's image range to every
   * kind refused a 9:16 Reel (0.56:1), which Meta accepts: Reels take 0.01:1 to
   * 10:1 (developers.facebook.com/docs/instagram-platform/instagram-graph-api/
   * reference/ig-user/media, checked 2026-10-11). A kind with no declared range
   * is not checked.
   *
   * Only checked when dimensions are known — an unknown size warns rather than
   * blocking, because a wrongly-rejected valid post is worse than a late failure.
   */
  let unknownDimensionsWarned = false
  for (const item of media) {
    const isVideo = item.kind === 'video'
    const declaredMin = isVideo ? caps.videoAspectRatioMin : caps.aspectRatioMin
    const declaredMax = isVideo ? caps.videoAspectRatioMax : caps.aspectRatioMax
    if (declaredMin === undefined && declaredMax === undefined) continue

    if (item.width === undefined || item.height === undefined || item.height === 0) {
      if (!unknownDimensionsWarned) {
        unknownDimensionsWarned = true
        add(
          'warning',
          'unknown_dimensions',
          `${isVideo ? 'Video' : 'Image'} dimensions are unknown, so the aspect ratio could not be checked before publishing.`,
        )
      }
      continue
    }

    const ratio = item.width / item.height
    const min = declaredMin ?? 0
    const max = declaredMax ?? Infinity

    if (ratio < min || ratio > max) {
      add(
        'error',
        'aspect_ratio_unsupported',
        `${item.width}x${item.height} is ${ratio.toFixed(2)}:1, outside this platform's accepted ${isVideo ? 'video' : 'image'} range ` +
          `(${min.toFixed(2)}:1 to ${max.toFixed(2)}:1). ` +
          (isVideo
            ? 'Re-export the video within that range.'
            : 'Crop it to square, portrait 4:5, or landscape 1.91:1.'),
      )
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
