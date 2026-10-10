import type { PairUse } from './types.ts'

/**
 * WCAG 2.2 contrast, computed rather than copied from a document.
 *
 * Relative luminance and the (L1 + 0.05) / (L2 + 0.05) ratio from WCAG 2.2
 * (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio). The sRGB threshold is
 * 0.04045, as in the sRGB standard; WCAG's 0.03928 gives the same result for
 * every 8-bit value.
 */

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (m === null) throw new Error(`Not a #RRGGBB colour: ${hex}`)
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => channel(parseInt(h, 16))) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The minimum a pair must reach for its use: 4.5:1 for text (SC 1.4.3), 3:1
 * for large text (SC 1.4.3: 24 px, or 18.66 px bold) and for the boundaries
 * and states of controls (SC 1.4.11). Decorative and forbidden pairs have none.
 */
export function minimumFor(use: PairUse): number | undefined {
  switch (use) {
    case 'text':
      return 4.5
    case 'large-text':
    case 'ui':
      return 3
    case 'decorative':
    case 'avoid':
      return undefined
  }
}

/** The WCAG level a ratio reaches for normal text, for display. */
export function levelOf(ratio: number): 'AAA' | 'AA' | 'AA large' | 'fails' {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'AA large'
  return 'fails'
}
