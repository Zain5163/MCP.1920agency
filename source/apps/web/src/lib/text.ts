/**
 * Counts user-perceived characters, not UTF-16 code units.
 *
 * Mirrors the engine's counter deliberately. `"👨‍👩‍👧‍👦".length` is 11 and the
 * spread is 7, but every platform counts it as 1 — so a naive counter tells the
 * user something false the moment they use an emoji, and the UI would disagree
 * with the validation that actually decides.
 *
 * Lives in the web app rather than being imported from core because it is used by
 * client components, and core is a server-side package.
 */
export function countGraphemes(text: string): number {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (Segmenter === undefined) return [...text].length
  let count = 0
  for (const _ of new Segmenter('en', { granularity: 'grapheme' }).segment(text)) count += 1
  return count
}
