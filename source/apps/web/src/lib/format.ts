/**
 * Deterministic date formatting.
 *
 * `toLocaleString()` must never be used in anything that renders on both the
 * server and the client. Node formats with the server's locale and timezone,
 * the browser formats with the user's, the two strings differ, and React treats
 * that as a hydration mismatch — which in React 19 throws rather than warns and
 * takes the whole page down with "a client-side exception has occurred".
 *
 * These formatters produce byte-identical output wherever they run, so the
 * server HTML and the client render always agree.
 *
 * The cost is that times are shown in UTC rather than the viewer's timezone. If
 * local time matters later, the correct fix is to format on the client after
 * mount (inside useEffect), never to reintroduce toLocaleString into the
 * server-rendered path.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parse(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const date = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(date.getTime()) ? null : date
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** e.g. "24 Sep 2026" */
export function formatDate(value: Date | string | null | undefined): string {
  const date = parse(value)
  if (date === null) return '—'
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** e.g. "24 Sep 2026, 22:36 UTC" */
export function formatDateTime(value: Date | string | null | undefined): string {
  const date = parse(value)
  if (date === null) return '—'
  return `${formatDate(date)}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

/**
 * Relative time, e.g. "3 hours ago".
 *
 * Takes `now` as a parameter rather than calling Date.now() internally, so a
 * server render and a client render of the same page agree. Passing a
 * server-provided timestamp keeps it deterministic.
 */
export function formatRelative(
  value: Date | string | null | undefined,
  now: number,
): string {
  const date = parse(value)
  if (date === null) return 'never'

  const seconds = Math.round((now - date.getTime()) / 1000)
  const future = seconds < 0
  const abs = Math.abs(seconds)

  const say = (n: number, unit: string): string => {
    const plural = `${n} ${unit}${n === 1 ? '' : 's'}`
    return future ? `in ${plural}` : `${plural} ago`
  }

  if (abs < 45) return future ? 'in a moment' : 'just now'
  if (abs < 3600) return say(Math.round(abs / 60), 'minute')
  if (abs < 86_400) return say(Math.round(abs / 3600), 'hour')
  if (abs < 2_592_000) return say(Math.round(abs / 86_400), 'day')
  return formatDate(date)
}
