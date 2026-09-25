'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Media selection with visible, controllable order.
 *
 * Why this is more than a file input: **selection order is carousel order**, and
 * a plain `<input multiple>` shows neither what was picked nor what order it is
 * in. Carousel order is exactly the thing people get wrong, and it is invisible
 * until the post is already live.
 *
 * The mechanism worth knowing: a file input's `files` cannot be reordered
 * directly. So the real files live in React state, and just before submit a
 * `DataTransfer` is rebuilt in the chosen order and assigned back to the hidden
 * input — which is what the form action then receives.
 */

export interface PickedFile {
  readonly id: string
  readonly file: File
  readonly previewUrl: string
  readonly kind: 'image' | 'video'
}

export interface MediaPickerProps {
  /** Most restrictive limit across the selected platforms. */
  readonly maxFiles: number
  /** True when at least one selected platform cannot post without media. */
  readonly required: boolean
  readonly onChange?: (files: readonly PickedFile[]) => void
}

export function MediaPicker({ maxFiles, required, onChange }: MediaPickerProps) {
  const [picked, setPicked] = useState<PickedFile[]>([])
  const visibleInput = useRef<HTMLInputElement>(null)
  const hiddenInput = useRef<HTMLInputElement>(null)

  /**
   * Keeps the hidden input in sync with the chosen order.
   *
   * This is what the server action actually reads, so the order shown on screen
   * and the order published are the same thing rather than two things that agree
   * by luck.
   */
  useEffect(() => {
    const input = hiddenInput.current
    if (input === null) return

    const transfer = new DataTransfer()
    for (const item of picked) transfer.items.add(item.file)
    input.files = transfer.files

    onChange?.(picked)
  }, [picked, onChange])

  // Object URLs leak until revoked, and a composer used all day accumulates them.
  useEffect(() => {
    return () => {
      for (const item of picked) URL.revokeObjectURL(item.previewUrl)
    }
    // Intentionally on unmount only; per-item revocation happens in remove().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = (fileList: FileList | null): void => {
    if (fileList === null) return

    const incoming: PickedFile[] = []
    for (const file of Array.from(fileList)) {
      incoming.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        kind: file.type.startsWith('video/') ? 'video' : 'image',
      })
    }

    setPicked((prev) => {
      const combined = [...prev, ...incoming]
      if (combined.length <= maxFiles) return combined
      // Revoke what will not be kept, rather than silently leaking it.
      for (const extra of combined.slice(maxFiles)) URL.revokeObjectURL(extra.previewUrl)
      return combined.slice(0, maxFiles)
    })

    // Reset so picking the same file again still fires a change event.
    if (visibleInput.current !== null) visibleInput.current.value = ''
  }

  const remove = (id: string): void => {
    setPicked((prev) => {
      const target = prev.find((p) => p.id === id)
      if (target !== undefined) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
  }

  const move = (index: number, direction: -1 | 1): void => {
    setPicked((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }

  const atLimit = picked.length >= maxFiles

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="field-label mb-0">
          Media{required ? ' (required)' : ''}
        </span>
        <span className={`text-[0.76rem] ${atLimit ? 'text-warn' : 'text-muted'}`}>
          {picked.length} of {maxFiles}
          {picked.length > 1 && ' · order below is the carousel order'}
        </span>
      </div>

      {/* The real payload. Never shown; kept in sync by the effect above. */}
      <input ref={hiddenInput} type="file" name="media" multiple className="hidden" tabIndex={-1} />

      <input
        ref={visibleInput}
        type="file"
        accept="image/*,video/*"
        multiple
        disabled={atLimit}
        onChange={(e) => add(e.target.files)}
        className="file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-[0.85rem] file:text-ink disabled:opacity-50"
      />

      {atLimit && (
        <p className="mt-1.5 text-[0.76rem] text-warn">
          That is the maximum for the platforms you have selected. Remove one to add another.
        </p>
      )}

      {picked.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {picked.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-2"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-[0.72rem] font-semibold text-white">
                {index + 1}
              </span>

              {item.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded object-cover"
                />
              ) : (
                <video
                  src={item.previewUrl}
                  className="h-12 w-12 shrink-0 rounded object-cover"
                  muted
                />
              )}

              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.85rem]">{item.file.name}</div>
                <div className="text-[0.74rem] text-muted">
                  {item.kind} · {(item.file.size / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${item.file.name} earlier`}
                  className="rounded border border-line px-2 py-1 text-[0.8rem] text-muted disabled:opacity-30 hover:text-ink"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === picked.length - 1}
                  aria-label={`Move ${item.file.name} later`}
                  className="rounded border border-line px-2 py-1 text-[0.8rem] text-muted disabled:opacity-30 hover:text-ink"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  aria-label={`Remove ${item.file.name}`}
                  className="rounded border border-line px-2 py-1 text-[0.8rem] text-bad"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
