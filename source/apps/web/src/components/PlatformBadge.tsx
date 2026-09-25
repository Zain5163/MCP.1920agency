/**
 * The platform badge.
 *
 * Every account name gets one, because "1920 Agency" alone is ambiguous the
 * moment the same brand exists on several platforms — and it always does. A
 * customer glancing at a list needs to see *Facebook Page* or *Instagram*
 * without reading further.
 *
 * Label and colour come from the capability record, so a new platform gets a
 * badge by adding data rather than editing this file.
 */
export function PlatformBadge({
  label,
  accent,
}: {
  /** e.g. "Facebook Page". Falls back to the raw platform key if none is set. */
  readonly label: string
  readonly accent?: string | undefined
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.7rem] font-medium"
      style={
        accent !== undefined
          ? { borderColor: `${accent}55`, color: accent }
          : { borderColor: 'var(--color-line)', color: 'var(--color-muted)' }
      }
    >
      {accent !== undefined && (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
      )}
      {label}
    </span>
  )
}

/** Turns a raw platform key into something readable when no label is declared. */
export function humanisePlatform(platform: string): string {
  return platform
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
