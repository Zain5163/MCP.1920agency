import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { contrastRatio, levelOf, luminance, minimumFor } from './contrast.ts'
import { displayName, wordmarkText, type BrandSettings, type LoadedBrand } from './load.ts'
import { escapeHtml as esc, inline, renderMarkdown } from './markdown.ts'
import { SECTIONS, type SectionId } from './sections.ts'
import type { Brand, Component, FontFamily, LogoFile, Placement } from './types.ts'

/**
 * The private brand viewer: one documentation-style page per brand.
 *
 * Navigation on the left, and on the right every section with its live
 * examples drawn from the tokens themselves (swatches with computed contrast,
 * type specimens in the brand's own fonts, components, the sample ad in each
 * placement, a sample social post). Nothing on the page is a screenshot, so it
 * cannot drift from brand.json.
 *
 * The page is self-contained: fonts and logos are inlined as data: URIs and
 * there is no script at all. WHY: the route can then send a Content-Security-
 * Policy that allows no network request of any kind, so no third party ever
 * sees that the page was opened, and the signed token in the address never
 * leaves it.
 */

export interface ViewerContext {
  readonly token: string
  /** "*" when the link opens every brand of this tenant; a slug otherwise. */
  readonly scope: string
  /** The tenant's other brands, listed only for an all-brands link. */
  readonly others: readonly LoadedBrand[]
  readonly settings: BrandSettings
  readonly expires: Date
}

const MIME: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  jpeg: 'image/jpeg',
  woff2: 'font/woff2',
  woff: 'font/woff',
  truetype: 'font/ttf',
}

function dataUri(dir: string, path: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(join(dir, path)).toString('base64')}`
}

const link = (path: string, token: string) => `${path}?t=${encodeURIComponent(token)}`

function fontAlias(brand: Brand, family: FontFamily): string {
  return `b-${brand.slug}-${family.id}`
}

function stackOf(brand: Brand, familyId: string): string {
  const family = brand.typography.families.find((f) => f.id === familyId)
  if (family === undefined) return 'system-ui, sans-serif'
  return family.files.length > 0 ? `"${fontAlias(brand, family)}", ${family.stack}` : family.stack
}

function fontFaces(loaded: LoadedBrand): string {
  const { brand, dir } = loaded
  return brand.typography.families
    .flatMap((family) =>
      family.files.map(
        (file) =>
          `@font-face{font-family:"${fontAlias(brand, family)}";src:url("${dataUri(dir, file.path, MIME[file.format]!)}") format("${file.format}");` +
          `font-weight:${file.weight};font-style:${file.style};font-display:block}`,
      ),
    )
    .join('\n')
}

function hexOf(brand: Brand, id: string): string | undefined {
  return brand.colors.find((c) => c.id === id)?.hex
}

/** A colour id or a gradient id, as a CSS background value. */
function fill(brand: Brand, id: string): string {
  return hexOf(brand, id) ?? brand.gradients.find((g) => g.id === id)?.css ?? 'transparent'
}

function isProposed(brand: Brand, source: string): boolean {
  return brand.sources.find((s) => s.id === source)?.kind === 'proposed'
}

function mark(brand: Brand, source: string): string {
  return isProposed(brand, source)
    ? '<span class="tag tag-proposed" title="Not approved yet">Proposed · owner to confirm</span>'
    : `<span class="tag" title="Where this value came from">${esc(source)}</span>`
}

function list(items: readonly string[], cls = ''): string {
  if (items.length === 0) return ''
  return `<ul${cls === '' ? '' : ` class="${cls}"`}>${items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`
}

function darkest(brand: Brand): string {
  return [...brand.colors].sort((a, b) => luminance(a.hex) - luminance(b.hex))[0]?.hex ?? '#111111'
}

function lightest(brand: Brand): string {
  return [...brand.colors].sort((a, b) => luminance(b.hex) - luminance(a.hex))[0]?.hex ?? '#FFFFFF'
}

/**
 * Each logo file is embedded once, as a CSS background on a class, and every
 * place that shows it is an element with that class. WHY: an <img> per use
 * would repeat the whole file in the page each time (a 300 KB logo shown six
 * times is a 2 MB page).
 */
function logoClass(brand: Brand, file: LogoFile): string {
  return `lg-${brand.slug}-${file.id}`
}

function logoCss(loaded: LoadedBrand): string {
  return loaded.brand.logo.files
    .map((f) => `.${logoClass(loaded.brand, f)}{background:url("${dataUri(loaded.dir, f.path, MIME[f.format]!)}") center/contain no-repeat}`)
    .join('\n')
}

function logoImg(loaded: LoadedBrand, file: LogoFile, style = ''): string {
  return `<span class="logo-img ${logoClass(loaded.brand, file)}" role="img" aria-label="${esc(file.name)}" style="aspect-ratio:${file.widthPx}/${file.heightPx}${style === '' ? '' : `;${esc(style)}`}"></span>`
}

function wordmark(brand: Brand, settings: BrandSettings, size: string): string {
  const text = wordmarkText(brand, settings) ?? brand.name
  return `<span class="wordmark" style="font-size:${size}">${esc(text)}</span><span class="tag tag-proposed">Placeholder · name not final · not a logo</span>`
}

// ---------------------------------------------------------------------------- sections

function overview(loaded: LoadedBrand, ctx: ViewerContext): string {
  const { brand } = loaded
  const style = brand.adCreatives.style
  const display = brand.typography.scale[0]
  const logo = brand.logo.files.find((f) => f.id === style.logo)
  const hero =
    `<div class="hero" style="background:${esc(fill(brand, style.background))};color:${esc(hexOf(brand, style.text) ?? '#fff')}">` +
    `<div class="hero-logo">${logo !== undefined ? logoFor(loaded, logo, style.logoField, 'height:clamp(36px,6vw,56px);width:auto') : wordmark(brand, ctx.settings, 'clamp(22px,4vw,34px)')}</div>` +
    (display !== undefined
      ? `<p class="hero-line" style="font-family:${esc(stackOf(brand, display.family))};font-weight:${display.weight}">${esc(brand.adCreatives.sample.headline)}</p>`
      : '') +
    `<div class="hero-strip">${brand.colors.slice(0, 8).map((c) => `<span style="background:${c.hex}" title="${esc(c.name)} ${c.hex}"></span>`).join('')}</div></div>`
  const sources =
    '<div class="table-wrap"><table><thead><tr><th>Source</th><th>Kind</th><th>Where</th><th>Checked</th></tr></thead><tbody>' +
    brand.sources
      .map(
        (s) =>
          `<tr><td><code>${esc(s.id)}</code></td><td>${s.kind === 'proposed' ? '<span class="tag tag-proposed">proposed</span>' : esc(s.kind)}</td>` +
          `<td>${esc(s.ref)}${s.note !== undefined ? `<div class="muted small">${inline(s.note)}</div>` : ''}</td><td class="nowrap">${esc(s.checked)}</td></tr>`,
      )
      .join('') +
    '</tbody></table></div>'
  return (
    hero +
    `<p class="lead">${inline(brand.summary)}</p>` +
    `<dl class="facts"><div><dt>Status</dt><dd>${statusTag(brand)}</dd></div><div><dt>Version</dt><dd>${esc(brand.version)} · ${esc(brand.updated)}</dd></div>` +
    `<div><dt>Approval</dt><dd>${esc(brand.approval.approvers.join(', '))}</dd></div></dl>` +
    `<p class="note">${inline(brand.approval.rule)}</p>` +
    `<h3>Where every value came from</h3>${sources}`
  )
}

function statusTag(brand: Brand): string {
  if (brand.status === 'imported') return '<span class="tag tag-ok">Imported from the brand’s own system</span>'
  if (brand.status === 'mixed') return '<span class="tag tag-proposed">Imported, with proposed additions</span>'
  return '<span class="tag tag-proposed">Proposed · owner to confirm</span>'
}

function colours(loaded: LoadedBrand): string {
  const { brand } = loaded
  const swatches = brand.colors
    .map((c) => {
      const onWhite = contrastRatio(c.hex, '#FFFFFF')
      const onBlack = contrastRatio(c.hex, '#000000')
      const ink = onBlack > onWhite ? '#000' : '#fff'
      return (
        `<figure class="swatch"><div class="chip-color" style="background:${c.hex};color:${ink}"><span>${c.hex}</span></div>` +
        `<figcaption><strong>${esc(c.name)}</strong> <code>${esc(c.id)}</code><div class="small">${inline(c.role)}</div>` +
        `<div class="small muted">${inline(c.use)}</div>${mark(brand, c.source)}</figcaption></figure>`
      )
    })
    .join('')
  const pairs =
    '<div class="table-wrap"><table class="pairs"><thead><tr><th>Sample</th><th>Pair</th><th>Ratio</th><th>Use</th><th>Result</th></tr></thead><tbody>' +
    brand.contrastPairs
      .map((p) => {
        const fg = hexOf(brand, p.fg)!
        const bg = hexOf(brand, p.bg)!
        const ratio = contrastRatio(fg, bg)
        const min = minimumFor(p.use)
        const verdict =
          p.use === 'avoid'
            ? '<span class="tag tag-bad">Never use</span>'
            : p.use === 'decorative'
              ? '<span class="tag">Decoration only</span>'
              : ratio >= (min ?? 0)
                ? `<span class="tag tag-ok">Pass ≥ ${min}:1</span>`
                : `<span class="tag tag-bad">Fails ${min}:1</span>`
        return (
          `<tr><td><span class="pair-sample" style="background:${bg};color:${fg}">Aa Text</span></td>` +
          `<td><code>${esc(p.fg)}</code> on <code>${esc(p.bg)}</code>${p.note !== undefined ? `<div class="small muted">${inline(p.note)}</div>` : ''}</td>` +
          `<td><strong>${ratio.toFixed(2)}:1</strong><div class="small muted">${levelOf(ratio)}</div></td><td>${esc(p.use)}</td><td>${verdict}</td></tr>`
        )
      })
      .join('') +
    '</tbody></table></div>'
  const gradients =
    brand.gradients.length === 0
      ? ''
      : '<h3>Gradients</h3><div class="grid-2">' +
        brand.gradients
          .map((g) => `<figure class="gradient"><div style="background:${esc(g.css)}"></div><figcaption><strong>${esc(g.name)}</strong><div class="small muted">${inline(g.use)}</div><code class="small">${esc(g.css)}</code> ${mark(brand, g.source)}</figcaption></figure>`)
          .join('') +
        '</div>'
  return `<div class="swatches">${swatches}</div><h3>Contrast (computed, WCAG 2.2)</h3>${pairs}${gradients}`
}

function typography(loaded: LoadedBrand): string {
  const { brand } = loaded
  const families = brand.typography.families
    .map(
      (f) =>
        `<div class="card-plain"><p class="specimen-family" style="font-family:${esc(stackOf(brand, f.id))}">${esc(f.name)}</p>` +
        `<p class="small">${inline(f.role)}</p><p class="small muted">Stack: <code>${esc(f.stack)}</code></p>` +
        `<p class="small">Licence: <strong>${esc(f.licence.name)}</strong>. ${inline(f.licence.notes)}</p>` +
        `<p class="small muted">${f.files.length > 0 ? `${f.files.length} file(s): ${f.files.map((x) => `<code>${esc(x.path)}</code> (${esc(x.weight)})`).join(', ')}` : 'No font file: a system font stack.'}</p>${mark(brand, f.source)}</div>`,
    )
    .join('')
  const scale = brand.typography.scale
    .map(
      (t) =>
        `<div class="type-row"><div class="type-meta"><strong>${esc(t.role)}</strong><code>${esc(t.id)}</code>` +
        `<span class="small muted">${esc(t.size)}${t.sizeMobile !== undefined ? ` · mobile ${esc(t.sizeMobile)}` : ''} · ${esc(t.weight)} · ${esc(t.lineHeight)}${t.tracking !== undefined ? ` · ${esc(t.tracking)}` : ''}</span>${mark(brand, t.source)}</div>` +
        `<p class="type-sample" style="font-family:${esc(stackOf(brand, t.family))};font-size:min(${esc(t.size)},11vw);font-weight:${t.weight};line-height:${esc(t.lineHeight)}` +
        `${t.tracking !== undefined ? `;letter-spacing:${esc(t.tracking)}` : ''}${t.transform !== undefined ? `;text-transform:${t.transform}` : ''}">${esc(t.sample)}</p></div>`,
    )
    .join('')
  return `<div class="grid-2">${families}</div><h3>Type scale</h3><p class="small muted">Shown at the real size, capped to the screen width on a phone.</p>${scale}<h3>Rules</h3>${list(brand.typography.rules)}`
}

function logoFor(loaded: LoadedBrand, file: LogoFile, fieldId: string | undefined, style: string): string {
  const img = logoImg(loaded, file, style)
  const field = fieldId === undefined ? undefined : hexOf(loaded.brand, fieldId)
  return field === undefined ? img : `<span class="logo-field" style="background:${field}">${img}</span>`
}

function logo(loaded: LoadedBrand, ctx: ViewerContext): string {
  const { brand } = loaded
  const l = brand.logo
  const files =
    l.files.length === 0
      ? `<div class="logo-stage" style="background:${darkest(brand)};color:${lightest(brand)}">${wordmark(brand, ctx.settings, 'clamp(26px,5vw,40px)')}</div>` +
        (l.placeholder !== undefined ? `<p class="note">${inline(l.placeholder.note)}</p>` : '')
      : l.files
          .map((f) => {
            const bg = f.background === 'light' ? lightest(brand) : f.background === 'dark' ? darkest(brand) : '#808080'
            const height = Math.min(120, f.heightPx)
            const pad = Math.round(height * l.clearSpaceRatio)
            return (
              `<figure class="logo-card"><div class="logo-stage" style="background:${bg}"><span class="clear" style="padding:${pad}px">${logoImg(loaded, f, `height:${height}px;width:auto;max-width:100%`)}</span></div>` +
              `<figcaption><strong>${esc(f.name)}</strong> <code>${esc(f.path)}</code><div class="small">${inline(f.use)}</div>` +
              `<div class="small muted">${f.widthPx}×${f.heightPx} ${esc(f.format)} · for ${esc(f.background)} backgrounds · sha256 ${esc(f.sha256.slice(0, 12))}…</div>${mark(brand, f.source)}</figcaption></figure>`
            )
          })
          .join('')
  const min =
    l.files[0] !== undefined
      ? `<div class="logo-stage logo-min" style="background:${l.files[0].background === 'light' ? lightest(brand) : darkest(brand)}">${logoImg(loaded, l.files[0], `width:${l.minSize.digitalPx}px;height:auto`)}</div>`
      : ''
  return (
    `<div class="logos">${files}</div>` +
    `<h3>Clear space and minimum size</h3><p>${inline(l.clearSpace)} <span class="small muted">(dashed outline above)</span></p>` +
    `<p>Smallest digital size: <strong>${l.minSize.digitalPx}px</strong> wide. ${inline(l.minSize.note)}</p>${min}` +
    `<div class="grid-2"><div class="do"><h3>Do</h3>${list(l.do)}</div><div class="dont"><h3>Don’t</h3>${list(l.dont)}</div></div>` +
    `<p class="small">Licence: ${inline(l.licence)} ${mark(brand, l.source)}</p>`
  )
}

function layoutSpacing(loaded: LoadedBrand): string {
  const { brand } = loaded
  const accent = hexOf(brand, brand.adCreatives.style.accent) ?? '#888'
  const spacing = brand.spacing.scalePx
    .map((px) => `<div class="space-row"><code>${px}px</code><span style="width:${Math.min(px, 320)}px;background:${accent}"></span></div>`)
    .join('')
  const radii = brand.radii
    .map((r) => `<figure class="radius"><div style="border-radius:${Math.min(r.px, 60)}px;border-color:${accent}"></div><figcaption><code>${esc(r.id)}</code> ${r.px}px<div class="small muted">${inline(r.use)}</div>${mark(brand, r.source)}</figcaption></figure>`)
    .join('')
  const shadows = brand.shadows
    .map((s) => `<figure class="shadow"><div style="box-shadow:${esc(s.css)}"></div><figcaption><code>${esc(s.id)}</code><div class="small muted">${inline(s.use)}</div><code class="small">${esc(s.css)}</code></figcaption></figure>`)
    .join('')
  const lay = brand.layout
  return (
    `<dl class="facts"><div><dt>Content width</dt><dd>${lay.maxWidthPx}px max</dd></div><div><dt>Gutters</dt><dd>${inline(lay.gutters)}</dd></div>` +
    `<div><dt>Breakpoints</dt><dd>${lay.breakpointsPx.map((b) => `${b}px`).join(' · ')}</dd></div><div><dt>Grid</dt><dd>${inline(lay.grid)}</dd></div></dl>` +
    `${list(lay.rules)}<h3>Spacing scale (${brand.spacing.unitPx}px unit)</h3><div class="spaces">${spacing}</div>${list(brand.spacing.rules)}` +
    `<h3>Corner radii</h3><div class="radii">${radii}</div>` +
    (shadows === '' ? '' : `<h3>Shadows</h3><div class="shadows" style="background:${darkest(brand)}">${shadows}</div>`)
  )
}

function componentStyle(brand: Brand, c: Component): string {
  const s = c.style
  const parts: string[] = [`color:${hexOf(brand, s.color)}`, `border-radius:${s.radiusPx}px`]
  if (s.background !== undefined) parts.push(`background:${fill(brand, s.background)}`)
  if (s.border !== undefined) parts.push(`border:${hexOf(brand, s.border) !== undefined ? `1px solid ${hexOf(brand, s.border)}` : s.border}`)
  if (s.padding !== undefined) parts.push(`padding:${s.padding}`)
  if (s.fontWeight !== undefined) parts.push(`font-weight:${s.fontWeight}`)
  if (s.fontSizePx !== undefined) parts.push(`font-size:${s.fontSizePx}px`)
  if (s.family !== undefined) parts.push(`font-family:${stackOf(brand, s.family)}`)
  if (s.shadow !== undefined) parts.push(`box-shadow:${brand.shadows.find((x) => x.id === s.shadow)?.css ?? 'none'}`)
  if (s.transform !== undefined) parts.push(`text-transform:${s.transform}`)
  if (s.letterSpacing !== undefined) parts.push(`letter-spacing:${s.letterSpacing}`)
  if (s.minHeightPx !== undefined) parts.push(`min-height:${s.minHeightPx}px`)
  return esc(parts.join(';'))
}

function specimen(brand: Brand, c: Component): string {
  const style = componentStyle(brand, c)
  switch (c.kind) {
    case 'button-primary':
    case 'button-secondary':
      return `<span class="cmp-button" style="${style}">${esc(c.label)} <span aria-hidden="true">↗</span></span>`
    case 'card':
      return `<div class="cmp-card" style="${style}"><strong>${esc(c.label)}</strong><span>${esc(brand.adCreatives.sample.body ?? brand.summary.slice(0, 90))}</span></div>`
    case 'chip':
    case 'badge':
      return `<span class="cmp-chip" style="${style}">${esc(c.label)}</span>`
    case 'input':
      return `<span class="cmp-field"><span class="cmp-label">${esc(c.label)}</span><span class="cmp-input" style="${style}">name@example.com</span></span>`
    case 'link':
      return `<span class="cmp-link" style="${style}">${esc(c.label)} <span aria-hidden="true">→</span></span>`
  }
}

function components(loaded: LoadedBrand): string {
  const { brand } = loaded
  const cards = brand.components
    .map(
      (c) =>
        `<figure class="cmp"><div class="cmp-stage" style="background:${fill(brand, c.surface)}">${specimen(brand, c)}</div>` +
        `<figcaption><strong>${esc(c.name)}</strong> <code>${esc(c.id)}</code><p class="small">${inline(c.spec)}</p>${list(c.rules, 'small')}${mark(brand, c.source)}</figcaption></figure>`,
    )
    .join('')
  const motion = brand.motion === undefined ? '' : `<h3>Motion</h3>${list(brand.motion.rules)}`
  return `<div class="cmps">${cards}</div>${motion}`
}

function imagery(loaded: LoadedBrand): string {
  const { brand } = loaded
  return (
    `<p>${inline(brand.imagery.style)} ${mark(brand, brand.imagery.source)}</p>` +
    `<div class="grid-2"><div class="do"><h3>Do</h3>${list(brand.imagery.do)}</div><div class="dont"><h3>Don’t</h3>${list(brand.imagery.dont)}</div></div>` +
    `<h3>Icons</h3><p>${inline(brand.icons.style)} ${mark(brand, brand.icons.source)}</p>${list(brand.icons.rules)}`
  )
}

function voice(loaded: LoadedBrand): string {
  const { brand } = loaded
  const v = brand.voice
  const examples =
    v.examples.length === 0
      ? ''
      : '<div class="table-wrap"><table><thead><tr><th>Say</th><th>Not</th></tr></thead><tbody>' +
        v.examples.map((e) => `<tr><td class="say">${inline(e.say)}</td><td class="avoid">${inline(e.avoid)}</td></tr>`).join('') +
        '</tbody></table></div>'
  return (
    `<div class="chips">${v.personality.map((p) => `<span class="tag">${esc(p)}</span>`).join('')}</div> ${mark(brand, v.source)}` +
    `<h3>Rules</h3>${list(v.rules)}${examples}` +
    (v.neverOnCreative.length > 0 ? `<p class="note">Never on any creative: ${v.neverOnCreative.map((w) => `<code>${esc(w)}</code>`).join(', ')}</p>` : '')
  )
}

function percent(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(2)}%`
}

function adFrame(loaded: LoadedBrand, p: Placement, ctx: ViewerContext, override?: { eyebrow?: string; headline: string; body?: string; counter?: string; items?: readonly string[] }): string {
  const { brand } = loaded
  const s = brand.adCreatives.style
  const sample = brand.adCreatives.sample
  const z = p.safeZonePx
  const inset = `top:${percent(z.top, p.heightPx)};right:${percent(z.right, p.widthPx)};bottom:${percent(z.bottom, p.heightPx)};left:${percent(z.left, p.widthPx)}`
  const logoFile = s.logo === null ? undefined : brand.logo.files.find((f) => f.id === s.logo)
  const logoHtml =
    logoFile !== undefined
      ? `<span class="ad-logo">${logoFor(loaded, logoFile, s.logoField, 'height:100%;width:auto')}</span>`
      : `<span class="ad-wordmark">${esc(wordmarkText(brand, ctx.settings) ?? brand.name)}</span>`
  const headline = override?.headline ?? sample.headline
  const emphasis = override === undefined ? sample.emphasis : undefined
  let headlineHtml = esc(headline)
  if (emphasis !== undefined && headline.includes(emphasis)) {
    const span =
      sample.emphasisGradient !== undefined
        ? `<span style="background:${esc(fill(brand, sample.emphasisGradient))};-webkit-background-clip:text;background-clip:text;color:transparent">${esc(emphasis)}</span>`
        : `<span style="color:${hexOf(brand, s.accent)}">${esc(emphasis)}</span>`
    headlineHtml = esc(headline.slice(0, headline.indexOf(emphasis))) + span + esc(headline.slice(headline.indexOf(emphasis) + emphasis.length))
  }
  const eyebrow = override?.eyebrow ?? sample.eyebrow
  const body = override?.body ?? (override === undefined ? sample.body : undefined)
  const items = override?.items ?? []
  return (
    `<div class="ad" style="aspect-ratio:${p.widthPx}/${p.heightPx};background:${esc(fill(brand, s.background))};color:${hexOf(brand, s.text)}">` +
    `<div class="ad-safe" style="${inset}" aria-hidden="true"></div>` +
    `<div class="ad-content" style="${inset}">` +
    (s.logoPosition === 'top' ? logoHtml : '') +
    (override?.counter !== undefined ? `<span class="ad-counter" style="color:${hexOf(brand, s.muted)}">${esc(override.counter)}</span>` : '') +
    (eyebrow !== undefined ? `<span class="ad-eyebrow" style="color:${hexOf(brand, s.accent)};font-family:${esc(stackOf(brand, s.bodyFamily))}">${esc(eyebrow)}</span>` : '') +
    `<span class="ad-headline" style="font-family:${esc(stackOf(brand, s.headlineFamily))};font-weight:${s.headlineWeight}${s.headlineTransform !== undefined ? `;text-transform:${s.headlineTransform}` : ''}">${headlineHtml}</span>` +
    (override === undefined && sample.price !== undefined ? `<span class="ad-price" style="color:${hexOf(brand, s.accent)};font-family:${esc(stackOf(brand, s.headlineFamily))}">${esc(sample.price)}</span>` : '') +
    (body !== undefined ? `<span class="ad-body" style="color:${hexOf(brand, s.muted)};font-family:${esc(stackOf(brand, s.bodyFamily))}">${esc(body)}</span>` : '') +
    (items.length > 0 ? `<ol class="ad-items" style="font-family:${esc(stackOf(brand, s.bodyFamily))}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>` : '') +
    (override === undefined ? '<span class="ad-visual">Image area: a real photo</span>' : '') +
    (override === undefined
      ? `<span class="ad-cta" style="background:${fill(brand, s.ctaBackground)};color:${hexOf(brand, s.ctaText)};border-radius:${s.ctaRadiusPx}px;font-family:${esc(stackOf(brand, s.bodyFamily))}">${esc(sample.cta)}</span>`
      : '') +
    (s.logoPosition === 'bottom' ? logoHtml : '') +
    '</div></div>'
  )
}

function adCreatives(loaded: LoadedBrand, ctx: ViewerContext): string {
  const { brand } = loaded
  const a = brand.adCreatives
  const frames = a.placements
    .map(
      (p) =>
        `<figure class="ad-fig ad-${p.ratio.replace(':', '-')}">${adFrame(loaded, p, ctx)}` +
        `<figcaption><strong>${esc(p.name)}</strong> · ${esc(p.ratio)} · ${p.widthPx}×${p.heightPx}<div class="small muted">Dashed line: keep text and logo inside (top ${p.safeZonePx.top}, bottom ${p.safeZonePx.bottom}, sides ${p.safeZonePx.left}/${p.safeZonePx.right} px)</div>${mark(brand, p.source)}</figcaption></figure>`,
    )
    .join('')
  const specs = a.placements.map((p) => `<h4>${esc(p.name)} (${esc(p.ratio)})</h4>${list(p.rules)}`).join('')
  return (
    `<p class="note">${inline(a.sample.note)} ${mark(brand, a.sample.source)}</p><div class="ads">${frames}</div>` +
    `<h3>Rules for every ad</h3>${list(a.rules)}<h3>Per placement</h3>${specs}`
  )
}

function socialTemplates(loaded: LoadedBrand, ctx: ViewerContext): string {
  const { brand } = loaded
  const templates = brand.socialTemplates
  const first = templates[0]
  const placement = brand.adCreatives.placements.find((p) => p.id === first?.format) ?? brand.adCreatives.placements[0]!
  const total = String(Math.max(2, Math.min(first?.structure.length ?? 3, 9))).padStart(2, '0')
  const cover = adFrame(loaded, placement, ctx, {
    ...(brand.adCreatives.sample.eyebrow !== undefined ? { eyebrow: brand.adCreatives.sample.eyebrow } : {}),
    headline: brand.adCreatives.sample.headline,
    ...(brand.adCreatives.sample.body !== undefined ? { body: brand.adCreatives.sample.body } : {}),
    counter: `01 / ${total}`,
  })
  const second = adFrame(loaded, placement, ctx, {
    eyebrow: first?.name ?? 'Template',
    headline: first?.purpose ?? '',
    items: first?.structure.slice(0, 4) ?? [],
    counter: `02 / ${total}`,
  })
  const cards = templates
    .map(
      (t) =>
        `<div class="card-plain"><strong>${esc(t.name)}</strong> <code>${esc(t.id)}</code> <span class="small muted">${esc(t.format)}</span>` +
        `<p class="small">${inline(t.purpose)}</p><ol class="small">${t.structure.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>${list(t.rules, 'small muted')}${mark(brand, t.source)}</div>`,
    )
    .join('')
  return (
    `<p class="small muted">A sample post drawn from the first template: its cover, then its structure as the next slide.</p>` +
    `<div class="ads"><figure class="ad-fig">${cover}<figcaption>Cover</figcaption></figure><figure class="ad-fig">${second}<figcaption>Slide 2</figcaption></figure></div>` +
    `<h3>Templates</h3><div class="grid-2">${cards}</div>`
  )
}

function downloads(loaded: LoadedBrand, ctx: ViewerContext): string {
  const { brand } = loaded
  const base = `/brands/${brand.slug}/files/`
  const items: string[] = [
    `<li><a href="${esc(link(base + 'brand.json', ctx.token))}" download>brand.json</a> — every token, with roles and sources (machine-readable)</li>`,
    `<li><a href="${esc(link(base + 'guidelines.md', ctx.token))}" download>guidelines.md</a> — the written guidelines</li>`,
    ...brand.logo.files.map((f) => `<li><a href="${esc(link(base + fileName(f.path), ctx.token))}" download>${esc(fileName(f.path))}</a> — ${esc(f.name)}, original file</li>`),
    ...brand.typography.families.flatMap((f) =>
      f.licence.file !== undefined ? [`<li><a href="${esc(link(base + fileName(f.licence.file), ctx.token))}" download>${esc(fileName(f.licence.file))}</a> — ${esc(f.name)} licence</li>`] : [],
    ),
  ]
  return `<ul class="downloads">${items.join('')}</ul><p class="small muted">Links work only while this private link is valid.</p>`
}

export function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

const RENDER: Record<SectionId, (loaded: LoadedBrand, ctx: ViewerContext) => string> = {
  overview,
  colours: (l) => colours(l),
  typography: (l) => typography(l),
  logo,
  'layout-spacing': (l) => layoutSpacing(l),
  components: (l) => components(l),
  imagery: (l) => imagery(l),
  voice: (l) => voice(l),
  'ad-creatives': adCreatives,
  'social-templates': socialTemplates,
  downloads,
}

// ---------------------------------------------------------------------------- page

const CSS = `
:root{color-scheme:light dark;--bg:#f5f5f7;--panel:#ffffff;--ink:#16171a;--muted:#5b606a;--line:#e1e3e8;--soft:#eef0f4;--focus:#2b63d9;--prop-bg:#fff2cc;--prop-ink:#5c4200;--ok-bg:#dcf5e3;--ok-ink:#0f5a29;--bad-bg:#fde2e0;--bad-ink:#8a1c12}
@media (prefers-color-scheme:dark){:root{--bg:#0e0f12;--panel:#16181c;--ink:#eceef2;--muted:#a3a9b4;--line:#2a2d34;--soft:#1f2228;--focus:#86a8ff;--prop-bg:#3d300a;--prop-ink:#ffe08a;--ok-bg:#12351f;--ok-ink:#8de3a6;--bad-bg:#3d1714;--bad-ink:#ffaba3}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:inherit}a:focus-visible,summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
code{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--soft);padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}
.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;z-index:9;background:var(--panel);padding:8px 12px}
.shell{display:grid;grid-template-columns:minmax(0,1fr)}
.side{background:var(--panel);border-bottom:1px solid var(--line);padding:16px}
.side .brand-name{font-weight:650;font-size:18px;margin:0}.side .meta{margin:4px 0 0;color:var(--muted);font-size:13px}
.side nav ol{display:flex;gap:4px;overflow-x:auto;list-style:none;margin:12px 0 0;padding:0 0 6px}
.side nav a{display:block;white-space:nowrap;padding:6px 10px;border-radius:8px;text-decoration:none;color:var(--muted);font-size:14px}
.side nav a:hover{background:var(--soft);color:var(--ink)}
.side .others{margin-top:14px;font-size:13px}.side .others a{color:var(--muted)}
main{padding:16px;min-width:0}
.page-head h1{font-size:clamp(24px,4vw,34px);line-height:1.15;margin:4px 0 6px}
section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin:0 0 18px;scroll-margin-top:12px;min-width:0}
section>h2{margin:0 0 12px;font-size:21px}
details.guide{margin:0 0 16px;border:1px solid var(--line);border-radius:10px;padding:10px 14px;background:var(--bg)}
details.guide summary{cursor:pointer;font-weight:600}
h3{font-size:16px;margin:22px 0 8px}h4{font-size:14px;margin:14px 0 4px}
p{margin:0 0 10px}ul,ol{margin:0 0 10px;padding-left:20px}li{margin:2px 0}
.lead{font-size:17px}.small{font-size:13px}.muted{color:var(--muted)}
.note{background:var(--soft);border-left:3px solid var(--focus);padding:8px 12px;border-radius:6px;font-size:14px}
.tag{display:inline-block;font-size:11.5px;line-height:1.4;padding:1px 7px;border-radius:999px;background:var(--soft);color:var(--muted);margin:2px 4px 2px 0;vertical-align:middle;white-space:nowrap}
.tag-proposed{background:var(--prop-bg);color:var(--prop-ink);font-weight:600}.tag-ok{background:var(--ok-bg);color:var(--ok-ink)}.tag-bad{background:var(--bad-bg);color:var(--bad-ink);font-weight:600}
.banner{background:var(--prop-bg);color:var(--prop-ink);border-radius:10px;padding:10px 14px;margin:0 0 16px;font-size:14px}
.table-wrap{overflow-x:auto;max-width:100%;margin:0 0 12px}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;vertical-align:top;padding:7px 8px;border-bottom:1px solid var(--line)}.nowrap{white-space:nowrap}th{font-weight:600;color:var(--muted)}
td.say{color:var(--ok-ink)}td.avoid{color:var(--bad-ink)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}.facts div{background:var(--bg);border-radius:10px;padding:8px 12px}
.facts dt{font-size:12px;color:var(--muted)}.facts dd{margin:0;font-size:14px}
.hero{border-radius:12px;padding:clamp(18px,4vw,36px);margin:0 0 16px;overflow:hidden}
.hero-logo{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:40px}
.hero-line{font-size:clamp(26px,5vw,48px);line-height:1.05;margin:18px 0 18px;letter-spacing:-.02em}
.hero-strip{display:flex;height:14px;border-radius:999px;overflow:hidden}.hero-strip span{flex:1}
.grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px}
.card-plain{border:1px solid var(--line);border-radius:10px;padding:12px 14px;min-width:0}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,170px),1fr));gap:12px}
.swatch{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden}.swatch figcaption{padding:8px 10px;font-size:13px}
.chip-color{height:86px;display:flex;align-items:flex-end;padding:6px 8px;font:12px ui-monospace,monospace}
.pair-sample{display:inline-block;padding:6px 10px;border-radius:6px;font-weight:600;white-space:nowrap;border:1px solid var(--line)}
.gradient{margin:0}.gradient>div{height:64px;border-radius:10px;border:1px solid var(--line)}.gradient figcaption{padding-top:6px;font-size:13px}
.specimen-family{font-size:28px;margin:0 0 6px}
.type-row{border-top:1px solid var(--line);padding:12px 0;min-width:0}.type-meta{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline;font-size:13px}
.type-sample{margin:6px 0 0;overflow-wrap:anywhere}
.logos{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px}
.logo-card{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden}.logo-card figcaption{padding:8px 10px;font-size:13px}
.logo-stage{display:flex;align-items:center;justify-content:center;padding:18px;min-height:150px;flex-wrap:wrap;gap:8px;border-radius:0}
.logo-min{min-height:90px;border-radius:10px;justify-content:flex-start;margin:0 0 12px}
.clear{display:inline-block;outline:1px dashed rgba(127,127,127,.9)}
.logo-img{display:inline-block;max-width:100%}
.logo-field{display:inline-flex;align-items:center;padding:.35em .6em;border-radius:6px;height:100%}
.wordmark{font:600 1em/1.1 system-ui,sans-serif;letter-spacing:-.01em;border:1px dashed currentColor;padding:.15em .4em;border-radius:6px}
.do h3{color:var(--ok-ink)}.dont h3{color:var(--bad-ink)}
.spaces{display:grid;gap:6px;margin:0 0 10px}.space-row{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:center;gap:8px}.space-row span{display:block;height:12px;border-radius:3px;max-width:100%}
.radii,.shadows{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr));gap:14px}
.radius{margin:0;font-size:13px}.radius>div{height:70px;border:2px solid;margin-bottom:6px;background:var(--soft)}
.shadows{padding:20px;border-radius:12px}.shadow{margin:0;font-size:12.5px;color:#f2f2f2}.shadow>div{height:70px;border-radius:12px;background:rgba(255,255,255,.08);margin-bottom:10px}.shadow .muted{color:#c9c9c9}.shadow code{background:rgba(255,255,255,.12)}
.cmps{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px}
.cmp{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden}.cmp figcaption{padding:10px 12px;font-size:13px}
.cmp-stage{padding:26px 18px;display:flex;align-items:center;justify-content:center;min-height:120px}
.cmp-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 20px;font-size:15px;line-height:1.2;text-decoration:none;max-width:100%}
.cmp-card{display:grid;gap:6px;padding:16px;max-width:280px;width:100%;font-size:14px;line-height:1.45}
.cmp-chip{display:inline-block;padding:4px 10px;font-size:12.5px}
.cmp-field{display:grid;gap:6px;width:100%;max-width:280px}.cmp-label{font-size:13px;color:inherit;opacity:.85}.cmp-input{display:block;padding:11px 12px;font-size:16px;opacity:.95}
.cmp-link{text-decoration:underline;text-underline-offset:3px;font-size:15px}
.ads{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),340px));gap:16px;align-items:start}
.ad-fig{margin:0}.ad-fig figcaption{font-size:12.5px;margin-top:6px}
.ad{position:relative;width:100%;container-type:inline-size;overflow:hidden;border-radius:8px;border:1px solid var(--line)}
.ad-safe{position:absolute;border:1px dashed rgba(255,0,128,.75);pointer-events:none;z-index:2}
.ad-content{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:2.2cqw;text-align:center;z-index:1}
.ad-logo{height:8cqw;display:inline-flex;align-items:center;max-width:70%}.ad-logo img{max-width:100%;object-fit:contain}
.ad-wordmark{font:600 4.6cqw/1 system-ui,sans-serif;border:1px dashed currentColor;padding:.2em .5em;border-radius:.3em}
.ad-counter{font:500 2.8cqw/1 ui-monospace,monospace;letter-spacing:.1em;align-self:flex-end}
.ad-eyebrow{font-size:3.1cqw;letter-spacing:.16em;text-transform:uppercase;font-weight:600}
.ad-headline{font-size:8.4cqw;line-height:1.05;letter-spacing:-.01em;text-wrap:balance}
.ad-price{font-size:11cqw;line-height:1;font-weight:600}
.ad-body{font-size:3.7cqw;line-height:1.35}
.ad-items{font-size:3.6cqw;text-align:left;margin:0;padding-left:1.2em;line-height:1.35}
.ad-visual{flex:1 1 auto;min-height:10cqw;width:100%;border:1px dashed currentColor;opacity:.42;border-radius:2cqw;display:grid;place-items:center;font-size:2.8cqw}
.ad-cta{font-size:3.4cqw;font-weight:650;padding:2.2cqw 5cqw;line-height:1}
.downloads li{margin:6px 0}
.foot{color:var(--muted);font-size:12.5px;margin:24px 0}
@media (min-width:900px){.shell{grid-template-columns:260px minmax(0,1fr)}.side{position:sticky;top:0;height:100vh;overflow:auto;border-bottom:0;border-right:1px solid var(--line);padding:24px 16px}
.side nav ol{display:block}.side nav li{margin:1px 0}main{padding:28px 36px;max-width:1240px}section{padding:24px 26px}}
@media print{.side{display:none}.shell{display:block}section{break-inside:avoid}}
`

function shell(title: string, side: string, main: string, faces = ''): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">' +
    `<title>${esc(title)}</title><style>${faces}\n${CSS}</style></head><body>` +
    '<a class="skip" href="#content">Skip to content</a>' +
    `<div class="shell"><aside class="side">${side}</aside><main id="content">${main}</main></div></body></html>`
  )
}

function expiryText(expires: Date): string {
  return `${expires.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function renderBrandPage(loaded: LoadedBrand, ctx: ViewerContext): string {
  const { brand } = loaded
  const name = displayName(brand, ctx.settings)
  const nav = SECTIONS.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('')
  const others =
    ctx.scope === '*' && ctx.others.length > 0
      ? `<div class="others"><strong>Other brands</strong><ul>${ctx.others
          .filter((o) => o.brand.slug !== brand.slug)
          .map((o) => `<li><a href="${esc(link(`/brands/${o.brand.slug}`, ctx.token))}">${esc(displayName(o.brand, ctx.settings))}</a></li>`)
          .join('')}</ul><a href="${esc(link('/brands', ctx.token))}">All brands</a></div>`
      : ''
  const side =
    `<p class="brand-name">${esc(name)}</p><p class="meta">Design system ${esc(brand.version)} · ${statusTag(brand)}</p>` +
    `<nav aria-label="Sections"><ol>${nav}</ol></nav>${others}<p class="meta">Private link · expires ${esc(expiryText(ctx.expires))}</p>`
  const banner =
    brand.status === 'imported'
      ? ''
      : `<p class="banner">Values marked <strong>Proposed · owner to confirm</strong> are not approved. ${inline(brand.approval.rule)}</p>`
  const sections = SECTIONS.map(
    (s) =>
      `<section id="${s.id}" aria-labelledby="h-${s.id}"><h2 id="h-${s.id}">${esc(s.title)}</h2>` +
      `<details class="guide"${s.id === 'overview' ? ' open' : ''}><summary>Guidelines</summary>${renderMarkdown(loaded.guidelines[s.id])}</details>` +
      RENDER[s.id](loaded, ctx) +
      '</section>',
  ).join('')
  const main =
    `<header class="page-head"><span class="small muted">Brand design system</span><h1>${esc(name)}</h1></header>${banner}${sections}` +
    `<p class="foot">Generated from brands/${esc(brand.slug)}/brand.json and guidelines.md. Private: do not forward this link.</p>`
  return shell(`${name} · brand design system`, side, main, `${fontFaces(loaded)}
${logoCss(loaded)}`)
}

export function renderIndexPage(brands: readonly LoadedBrand[], ctx: Omit<ViewerContext, 'others' | 'scope'>): string {
  const cards = brands
    .map((b) => {
      const name = displayName(b.brand, ctx.settings)
      const strip = b.brand.colors.slice(0, 6).map((c) => `<span style="background:${c.hex}"></span>`).join('')
      return `<div class="card-plain"><p class="brand-name"><a href="${esc(link(`/brands/${b.brand.slug}`, ctx.token))}">${esc(name)}</a></p><div class="hero-strip">${strip}</div><p class="small">${inline(b.brand.summary)}</p>${statusTag(b.brand)}</div>`
    })
    .join('')
  const side = `<p class="brand-name">Brand design systems</p><p class="meta">Private link · expires ${esc(expiryText(ctx.expires))}</p>`
  const main =
    `<header class="page-head"><h1>Brand design systems</h1></header>` +
    (brands.length === 0 ? '<p>No brands belong to this account yet.</p>' : `<div class="grid-2">${cards}</div>`)
  return shell('Brand design systems', side, main)
}

export function renderUnavailable(): string {
  const main =
    '<header class="page-head"><h1>This link is not valid</h1></header>' +
    '<section><p>It may have expired, been copied incompletely, or be for a brand you no longer have access to.</p>' +
    '<p>Ask your AI assistant for a new one: “give me a link to the brand viewer”. It uses the <code>brand_viewer_link</code> tool.</p></section>'
  return shell('Link not valid', '<p class="brand-name">Brand design systems</p>', main)
}
