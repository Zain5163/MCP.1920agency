'use client'

import { countGraphemes } from '@/lib/text'

/**
 * Per-platform captions.
 *
 * One caption everywhere is governed by the strictest limit, which means the
 * platform with the most room gets the shortest post. Worse, the preview now
 * makes visible that Instagram cuts at ~125 characters while Facebook shows far
 * more — so the *same* words land differently.
 *
 * An override is opt-in per platform. Leaving one blank means "use the shared
 * text", which keeps the common case a single box rather than one per account.
 */

export interface PlatformTextTarget {
  readonly platform: string
  readonly label: string
  readonly accent: string
  readonly maxTextLength: number
  /** Where this platform cuts the caption, if it has preview data. */
  readonly truncateAt?: number | undefined
}

export function PerPlatformText({
  targets,
  sharedBody,
  overrides,
  onChange,
}: {
  targets: readonly PlatformTextTarget[]
  sharedBody: string
  overrides: Readonly<Record<string, string>>
  onChange: (platform: string, value: string) => void
}) {
  if (targets.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {targets.map((target) => {
        const value = overrides[target.platform] ?? ''
        const active = value.trim() !== ''
        // What will actually be published for this platform.
        const effective = active ? value : sharedBody
        const length = countGraphemes(effective)
        const over = length > target.maxTextLength
        const cut =
          target.truncateAt !== undefined && length > target.truncateAt
            ? length - target.truncateAt
            : 0

        return (
          <div key={target.platform} className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[0.85rem]">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: target.accent }}
                />
                {target.label}
                {!active && <span className="text-[0.76rem] text-muted">using shared text</span>}
              </span>
              <span className={`text-[0.76rem] ${over ? 'text-bad' : 'text-muted'}`}>
                {length} / {target.maxTextLength}
                {over && ` — ${length - target.maxTextLength} over`}
              </span>
            </div>

            <textarea
              name={`override:${target.platform}`}
              value={value}
              onChange={(e) => onChange(target.platform, e.target.value)}
              placeholder={`Leave blank to use the shared text`}
              className="min-h-[90px] resize-y text-[0.85rem] leading-relaxed"
            />

            {cut > 0 && (
              <p className="mt-1.5 text-[0.76rem] text-warn">
                {cut} character{cut === 1 ? '' : 's'} past where {target.label} cuts the caption.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
