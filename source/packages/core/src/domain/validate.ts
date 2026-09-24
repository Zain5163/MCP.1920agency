import type { Capabilities, ValidationIssue, ValidationResult } from '../adapters/adapter.ts'
import type { Platform, PostDraft } from './types.ts'

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

  const media = draft.media
  const images = media.filter((m) => m.kind === 'image')
  const videos = media.filter((m) => m.kind === 'video')

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

  for (const kind of new Set(media.map((m) => m.kind))) {
    if (!caps.mediaKinds.includes(kind)) {
      add('error', 'unsupported_media_kind', `This platform does not accept ${kind} posts.`)
    }
  }

  if (!caps.allowsMixedMedia && images.length > 0 && videos.length > 0) {
    add('error', 'mixed_media', 'Images and video cannot be combined in one post here.')
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
