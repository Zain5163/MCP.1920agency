import { wordmarkParts } from '@social-publisher/config'

/**
 * The product name in the header, in two colours ("Ads" + brand-coloured "Pilot").
 *
 * WHY a component: the name was typed into five pages as Ads<span>Pilot</span>,
 * and the name is not final. It now comes from the one setting
 * (packages/config product.ts, PRODUCT_NAME), split before its last inner
 * capital, so a rename needs no page edits. A server component on purpose: the
 * setting is read on the server; client components receive it already rendered.
 */
export function Wordmark() {
  const [first, second] = wordmarkParts()
  return (
    <>
      {first}
      {second !== '' && <span className="text-brand">{second}</span>}
    </>
  )
}
