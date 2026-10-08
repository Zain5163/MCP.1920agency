import type { ContentSummary, PluginInfo, SiteIndex, WooProduct } from '@social-publisher/adapters'

/**
 * What wordpress_site_audit checks, as pure functions over what the site
 * returned, so each check is tested without a site.
 *
 * Every finding is a fact read from the site, with the place to fix it. There
 * is no score: a number like "72/100" would be invented here, and the skills
 * (store-builder's conversion-checklists, seo-audit, core-web-vitals) say to
 * work from findings, not from a made-up grade. Speed is judged only by what the
 * HTML shows (scripts, styles, size, caching headers); real speed needs
 * PageSpeed Insights on the live page, and the audit says so.
 */

export type Severity = 'high' | 'medium' | 'low'

export interface Finding {
  readonly severity: Severity
  readonly area: 'SEO' | 'speed' | 'conversion' | 'trust' | 'security' | 'mobile' | 'accessibility' | 'store' | 'site'
  readonly finding: string
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find((v) => v !== undefined)

/** Facts and findings from the public home page. */
export function homepageFindings(page: { status: number; html: string; bytes: number; headers: Readonly<Record<string, string>> }): {
  facts: { title: string | undefined; description: string | undefined; generator: string | undefined; scripts: number; styles: number }
  findings: Finding[]
} {
  const out: Finding[] = []
  const html = page.html
  const head = html.split(/<\/head>/i)[0] ?? ''
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
  const metas = html.match(/<meta\b[^>]*>/gi) ?? []
  const meta = (key: string, value: string) => metas.find((m) => (attr(m, key) ?? '').toLowerCase() === value)
  const description = (() => {
    const m = meta('name', 'description')
    return m === undefined ? undefined : attr(m, 'content')
  })()
  const generatorTag = meta('name', 'generator')
  const generator = generatorTag === undefined ? undefined : attr(generatorTag, 'content')
  const robots = [meta('name', 'robots'), meta('name', 'googlebot')].map((m) => (m === undefined ? '' : (attr(m, 'content') ?? ''))).join(',') + ',' + (page.headers['x-robots-tag'] ?? '')
  const scripts = count(html, /<script\b[^>]*\bsrc\s*=/gi)
  const styles = count(html, /<link\b[^>]*rel\s*=\s*["']?stylesheet/gi)
  const blocking = (head.match(/<script\b[^>]*\bsrc\s*=[^>]*>/gi) ?? []).filter((t) => !/\b(async|defer)\b|type\s*=\s*["']?module/i.test(t)).length
  const imgs = html.match(/<img\b[^>]*>/gi) ?? []
  const noAlt = imgs.filter((t) => attr(t, 'alt') === undefined).length
  const h1 = count(html, /<h1\b/gi)

  if (page.status !== 200) out.push({ severity: 'high', area: 'site', finding: `The home page answered HTTP ${page.status} instead of 200. Visitors and search engines may not see it.` })
  if (/noindex/i.test(robots)) {
    out.push({ severity: 'high', area: 'SEO', finding: 'The home page tells search engines not to index it ("noindex"). If the site is live, untick Settings > Reading > "Discourage search engines from indexing this site", and check the SEO plugin\'s settings.' })
  }
  if (title === undefined || title === '') out.push({ severity: 'high', area: 'SEO', finding: 'The home page has no <title>. The theme or SEO plugin should output one.' })
  else if (title.length > 65) out.push({ severity: 'low', area: 'SEO', finding: `The home page title is ${title.length} characters; search results cut it at about 60: "${title.slice(0, 80)}".` })
  if (description === undefined || description.trim() === '') {
    out.push({ severity: 'medium', area: 'SEO', finding: 'The home page has no meta description, so search engines pick their own snippet. Set one in the SEO plugin (WordPress core has no field for it).' })
  } else if (description.length > 170) {
    out.push({ severity: 'low', area: 'SEO', finding: `The meta description is ${description.length} characters; search results show about 150–160.` })
  }
  if (h1 === 0) out.push({ severity: 'medium', area: 'SEO', finding: 'The home page has no H1 heading. The main headline should be one H1 saying what the business sells.' })
  else if (h1 > 1) out.push({ severity: 'low', area: 'SEO', finding: `The home page has ${h1} H1 headings; one is clearer for visitors and search engines.` })
  if (meta('name', 'viewport') === undefined) out.push({ severity: 'high', area: 'mobile', finding: 'No viewport meta tag: phones show the desktop layout shrunk. The theme needs <meta name="viewport" content="width=device-width, initial-scale=1">.' })
  if (!/<html\b[^>]*\blang\s*=/i.test(html)) out.push({ severity: 'low', area: 'accessibility', finding: 'The page does not declare its language (<html lang>), which screen readers and translators use.' })
  if (noAlt > 0) out.push({ severity: noAlt > 5 ? 'medium' : 'low', area: 'accessibility', finding: `${noAlt} of ${imgs.length} image(s) on the home page have no alt text (Media Library > the image > Alternative Text).` })
  const firstImg = imgs[0]
  if (firstImg !== undefined && /loading\s*=\s*["']?lazy/i.test(firstImg)) {
    out.push({ severity: 'low', area: 'speed', finding: 'The first image on the page is lazy-loaded. If it is the main (hero) image, that delays the largest paint; it should load at once.' })
  }
  if (blocking > 5) out.push({ severity: 'medium', area: 'speed', finding: `${blocking} scripts in the page head load without async or defer, so the page waits for each before showing.` })
  if (scripts > 25) out.push({ severity: 'medium', area: 'speed', finding: `The home page loads ${scripts} script files; plugins that load scripts on every page are the usual cause.` })
  if (styles > 15) out.push({ severity: 'low', area: 'speed', finding: `The home page loads ${styles} stylesheets.` })
  if (page.bytes > 500_000) out.push({ severity: 'low', area: 'speed', finding: `The home page HTML alone is ${Math.round(page.bytes / 1024)} KB (page builders often inline a lot).` })
  const insecure = count(html, /\b(src|href)\s*=\s*["']http:\/\//gi)
  if (count(html, /\bsrc\s*=\s*["']http:\/\//gi) > 0) {
    out.push({ severity: 'medium', area: 'trust', finding: `The page loads ${count(html, /\bsrc\s*=\s*["']http:\/\//gi)} file(s) over plain http (mixed content): browsers block or warn. Update those links to https (a search-replace on the database, done by a developer with a backup).` })
  } else if (insecure > 10) {
    out.push({ severity: 'low', area: 'trust', finding: `${insecure} links on the home page still start with http://.` })
  }
  if (meta('property', 'og:image') === undefined) out.push({ severity: 'low', area: 'SEO', finding: 'No og:image: links shared on Facebook, WhatsApp and others show no picture. SEO plugins set one.' })
  if (!/application\/ld\+json/i.test(html)) out.push({ severity: 'low', area: 'SEO', finding: 'No structured data (JSON-LD) on the home page; an SEO plugin adds Organization or LocalBusiness data.' })
  const h = page.headers
  const cached = ['x-cache', 'cf-cache-status', 'x-litespeed-cache', 'x-proxy-cache', 'x-cache-status', 'x-sucuri-cache', 'x-fastcgi-cache', 'x-varnish', 'x-kinsta-cache', 'x-wpe-cached', 'x-rocket-nginx-bypass', 'age'].some((k) => k in h)
  const cacheComment = /<!--[^>]*(cache|optimized by|wp rocket|litespeed|w3 total)/i.test(html.slice(-4000))
  if (!cached && !cacheComment) {
    out.push({ severity: 'medium', area: 'speed', finding: 'No sign of a page cache in the home page\'s response (no cache headers or cache-plugin marker). Without one, every visit builds the page in PHP. The host\'s cache or one caching plugin fixes that.' })
  }
  return { facts: { title, description, generator, scripts, styles }, findings: out }
}

const SEO_PLUGINS = /^(wordpress-seo|seo-by-rank-math|all-in-one-seo-pack|wp-seopress|autodescription|slim-seo|squirrly-seo)\//
const CACHE_PLUGINS = /^(wp-rocket|w3-total-cache|litespeed-cache|wp-super-cache|wp-fastest-cache|cache-enabler|comet-cache|hummingbird-performance|breeze|sg-cachepress|wp-optimize|nitropack|swift-performance)/
const BUILDERS = /^(elementor|js_composer|beaver-builder|divi-builder|oxygen|bricks|thrive-visual-editor|siteorigin-panels)/

/** Findings from the plugin list (only readable by administrators). */
export function pluginFindings(plugins: readonly PluginInfo[]): Finding[] {
  const out: Finding[] = []
  const active = plugins.filter((p) => p.status === 'active' || p.status === 'network-active')
  const inactive = plugins.filter((p) => p.status === 'inactive')
  if (inactive.length > 0) {
    out.push({ severity: 'medium', area: 'security', finding: `${inactive.length} inactive plugin(s) still installed (${inactive.slice(0, 6).map((p) => p.name).join(', ')}${inactive.length > 6 ? ', …' : ''}). Deactivated code can still be attacked; delete what is not needed.` })
  }
  const seo = active.filter((p) => SEO_PLUGINS.test(p.plugin))
  if (seo.length === 0) out.push({ severity: 'medium', area: 'SEO', finding: 'No SEO plugin is active, so there is no way to set meta descriptions, a sitemap or social previews per page.' })
  if (seo.length > 1) out.push({ severity: 'medium', area: 'SEO', finding: `${seo.length} SEO plugins are active (${seo.map((p) => p.name).join(', ')}); they output duplicate tags. Keep one.` })
  const cache = active.filter((p) => CACHE_PLUGINS.test(p.plugin))
  if (cache.length > 1) out.push({ severity: 'medium', area: 'speed', finding: `${cache.length} caching or optimisation plugins are active (${cache.map((p) => p.name).join(', ')}); they conflict. Keep one.` })
  const builders = active.filter((p) => BUILDERS.test(p.plugin))
  if (builders.length > 0) out.push({ severity: 'low', area: 'speed', finding: `Page builder active: ${builders.map((p) => p.name).join(', ')}. Check the ad landing pages' speed on a phone; builders are a common cause of slow pages.` })
  if (active.length > 40) out.push({ severity: 'low', area: 'security', finding: `${active.length} active plugins. Each is code to keep updated; remove those not earning their place.` })
  return out
}

const has = (pages: readonly ContentSummary[], re: RegExp) => pages.some((p) => p.status === 'publish' && (re.test(p.slug) || re.test(p.title.toLowerCase())))

/** Findings from the site's name, tagline, permalinks and published pages. */
export function contentFindings(input: {
  index: SiteIndex
  restMode: 'pretty' | 'query'
  pages: readonly ContentSummary[]
  posts: readonly ContentSummary[]
  woo: boolean
}): Finding[] {
  const out: Finding[] = []
  const { index, pages, posts } = input
  if (index.name.trim() === '') out.push({ severity: 'high', area: 'trust', finding: 'The site has no title (Settings > General > Site Title).' })
  if (/^just another wordpress site$/i.test(index.description.trim())) {
    out.push({ severity: 'medium', area: 'trust', finding: 'The tagline is still WordPress\'s default "Just another WordPress site" (Settings > General > Tagline). It can show in search results and the browser tab.' })
  }
  if (input.restMode === 'query') {
    out.push({ severity: 'high', area: 'SEO', finding: 'The site uses plain permalinks (addresses like ?p=123). Choose "Post name" in Settings > Permalinks. On a live site, check old links redirect afterwards.' })
  }
  if (!has(pages, /contact/)) out.push({ severity: 'high', area: 'trust', finding: 'No published Contact page found. Buyers from ads look for a way to reach a real business.' })
  if (!has(pages, /about|our-story|who-we-are/)) out.push({ severity: 'low', area: 'trust', finding: 'No published About page found.' })
  if (!has(pages, /privacy/)) out.push({ severity: 'medium', area: 'trust', finding: 'No published privacy policy page found (Settings > Privacy). Ad platforms and most countries\' laws expect one once a pixel or a form collects data.' })
  if (input.woo) {
    if (!has(pages, /refund|return|exchange/)) out.push({ severity: 'high', area: 'store', finding: 'No published refund or returns page found. Returns terms are a top reason buyers hesitate, and several countries require them (get_skill selling-by-country).' })
    if (!has(pages, /shipping|delivery/)) out.push({ severity: 'medium', area: 'store', finding: 'No published shipping or delivery page found.' })
    if (!has(pages, /terms|conditions/)) out.push({ severity: 'low', area: 'store', finding: 'No published terms and conditions page found.' })
  }
  if (!has(pages, /faq|questions/)) out.push({ severity: 'low', area: 'conversion', finding: 'No FAQ page found; it answers the objections that stop orders and leads.' })
  if (pages.some((p) => p.status === 'publish' && p.slug === 'sample-page')) out.push({ severity: 'low', area: 'trust', finding: 'WordPress\'s "Sample Page" is still published.' })
  if (posts.some((p) => p.status === 'publish' && p.slug === 'hello-world')) out.push({ severity: 'low', area: 'trust', finding: 'WordPress\'s "Hello world!" post is still published.' })
  return out
}

/** Findings from WooCommerce products (the first page of them). */
export function wooFindings(products: readonly WooProduct[]): Finding[] {
  const out: Finding[] = []
  const live = products.filter((p) => p.status === 'publish')
  const noImage = live.filter((p) => p.images === 0)
  if (noImage.length > 0) out.push({ severity: 'high', area: 'store', finding: `${noImage.length} published product(s) have no photo: ${noImage.slice(0, 5).map((p) => `"${p.name}" (id ${p.id})`).join(', ')}.` })
  const fewImages = live.filter((p) => p.images > 0 && p.images < 3)
  if (fewImages.length > 0) out.push({ severity: 'medium', area: 'store', finding: `${fewImages.length} published product(s) have fewer than 3 photos; 4–6 (front, back, detail, in use, scale) sell better.` })
  const noShort = live.filter((p) => p.shortDescription.replace(/<[^>]+>/g, '').trim() === '')
  if (noShort.length > 0) out.push({ severity: 'medium', area: 'store', finding: `${noShort.length} published product(s) have no short description (the text next to the price, where the delivery, payment and returns line belongs).` })
  const thin = live.filter((p) => p.description.replace(/<[^>]+>/g, '').trim().length < 300)
  if (thin.length > 0) out.push({ severity: 'low', area: 'store', finding: `${thin.length} published product(s) have a description under 300 characters.` })
  const out_ = live.filter((p) => p.stockStatus === 'outofstock')
  if (out_.length > 0) out.push({ severity: 'low', area: 'store', finding: `${out_.length} published product(s) are out of stock: ${out_.slice(0, 5).map((p) => `"${p.name}"`).join(', ')}. Hide them or mark them clearly before ads send traffic.` })
  return out
}

export const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
