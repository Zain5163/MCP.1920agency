'use client'

import { useState } from 'react'

import type { PickedFile } from '@/components/MediaPicker'

/**
 * How the post will actually look, per platform.
 *
 * This catches what validation cannot. Validation knows a caption fits; it does
 * not know the caption's point lands after Instagram's cut at ~125 characters, or
 * that a wide image loses its edges to a square crop. Both are invisible until
 * the post is live, and both are obvious in a preview.
 *
 * Contains **no platform names**. Everything platform-specific arrives as a
 * PreviewStyle from the capability record, so adding a platform means adding
 * preview data rather than editing this file. The architecture test enforces it.
 */

export interface PreviewStyle {
  readonly label: string
  readonly accent: string
  readonly captionTruncateAt: number
  readonly captionPosition: 'above' | 'below'
  readonly mediaFit: 'square' | 'original'
  readonly showsCarouselDots: boolean
  readonly moreLabel: string
}

export interface PreviewTarget {
  readonly platform: string
  readonly accountName: string
  readonly style: PreviewStyle
  /** Overrides the shared text for this platform, when one has been written. */
  readonly body?: string | undefined
}

export function PostPreview({
  targets,
  body,
  media,
}: {
  targets: readonly PreviewTarget[]
  body: string
  media: readonly PickedFile[]
}) {
  const [active, setActive] = useState(0)

  if (targets.length === 0) {
    return (
      <section className="card">
        <h2 className="mb-1 text-base font-semibold">Preview</h2>
        <p className="py-2 text-[0.88rem] text-muted">
          Select an account to see how the post will look.
        </p>
      </section>
    )
  }

  const target = targets[Math.min(active, targets.length - 1)]!
  const { style } = target

  // Show what will actually publish here, not the shared text.
  const text = target.body ?? body
  const truncated = truncate(text, style.captionTruncateAt)
  const isTruncated = truncated.length < text.length

  const caption = (
    <div className="px-3 py-2.5 text-[0.85rem] leading-relaxed">
      {text.trim() === '' ? (
        <span className="text-muted">No text</span>
      ) : (
        <>
          <span className="whitespace-pre-wrap">{truncated}</span>
          {isTruncated && (
            <>
              <span className="text-muted">… </span>
              <span className="text-muted">{style.moreLabel}</span>
            </>
          )}
        </>
      )}
    </div>
  )

  return (
    <section className="card">
      <h2 className="mb-1 text-base font-semibold">Preview</h2>
      <p className="mb-3 text-[0.85rem] text-muted">
        Approximate. Shows where text is cut and how media is cropped.
      </p>

      {target.body !== undefined && (
        <p className="mb-2 text-[0.76rem] text-brand">Showing this platform's own caption.</p>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {targets.map((t, index) => (
          <button
            key={`${t.platform}-${t.accountName}`}
            type="button"
            onClick={() => setActive(index)}
            className={`rounded-full border px-3 py-1 text-[0.8rem] ${
              index === active
                ? 'border-transparent text-white'
                : 'border-line text-muted hover:text-ink'
            }`}
            style={index === active ? { backgroundColor: t.style.accent } : undefined}
          >
            {t.style.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.72rem] font-bold text-white"
            style={{ backgroundColor: style.accent }}
          >
            {initials(target.accountName)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[0.85rem] font-semibold">{target.accountName}</div>
            <div className="text-[0.72rem] text-muted">Just now</div>
          </div>
        </div>

        {style.captionPosition === 'above' && caption}

        {media.length > 0 && (
          <div className="relative bg-black">
            <MediaFrame item={media[0]!} fit={style.mediaFit} />

            {media.length > 1 && (
              <>
                <div className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[0.72rem] text-white">
                  1/{media.length}
                </div>
                {style.showsCarouselDots && (
                  <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                    {media.map((m, i) => (
                      <span
                        key={m.id}
                        className={`h-1.5 w-1.5 rounded-full ${i === 0 ? 'bg-white' : 'bg-white/40'}`}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {style.captionPosition === 'below' && caption}
      </div>

      {isTruncated && (
        <p className="mt-2.5 text-[0.78rem] text-warn">
          {target.style.label} cuts this after {style.captionTruncateAt} characters. Put what
          matters before the cut.
        </p>
      )}

      {style.mediaFit === 'square' && media.length > 0 && (
        <p className="mt-1.5 text-[0.78rem] text-muted">
          Shown cropped to square — check nothing important sits near the edges.
        </p>
      )}
    </section>
  )
}

function MediaFrame({ item, fit }: { item: PickedFile; fit: 'square' | 'original' }) {
  const className =
    fit === 'square' ? 'aspect-square w-full object-cover' : 'max-h-[360px] w-full object-contain'

  return item.kind === 'video' ? (
    <video src={item.previewUrl} className={className} muted playsInline />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.previewUrl} alt="" className={className} />
  )
}

/** Cuts on a word boundary where possible, so the preview reads like the real thing. */
function truncate(text: string, at: number): string {
  if (text.length <= at) return text
  const slice = text.slice(0, at)
  const lastSpace = slice.lastIndexOf(' ')
  return lastSpace > at * 0.6 ? slice.slice(0, lastSpace) : slice
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
}
