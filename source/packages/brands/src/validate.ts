import type { Brand } from './types.ts'
import { contrastRatio, minimumFor } from './contrast.ts'

/**
 * Validation for brand.json, in two layers.
 *
 * 1. **Schema.** schema/brand.schema.json is the contract. It is checked by the
 *    small interpreter below, which supports exactly the keywords the schema
 *    uses (and refuses any other, so the schema cannot quietly start using a
 *    keyword nothing enforces). WHY not a library: the package has no runtime
 *    dependencies, the server image installs from a frozen lockfile, and the
 *    subset is small enough to read in one sitting.
 * 2. **Meaning.** What a schema cannot say: every `source` names a declared
 *    source, every colour reference names a colour, every pair meets the WCAG
 *    minimum for its declared use, ids are unique.
 *
 * Files on disk (logos, fonts, checksums) are checked by load.ts, which knows
 * where the brand folder is.
 */

export interface Issue {
  readonly path: string
  readonly message: string
}

type Schema = Record<string, unknown>

const KNOWN_KEYWORDS = new Set([
  '$schema', '$id', 'title', 'description', '$defs', '$ref', 'type', 'required', 'properties',
  'additionalProperties', 'items', 'enum', 'const', 'pattern', 'minLength', 'minItems', 'minimum', 'maximum',
])

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value)
  return actual === type || (type === 'number' && actual === 'integer')
}

export function validateSchema(value: unknown, schema: Schema, root: Schema = schema, path = '$'): Issue[] {
  const issues: Issue[] = []
  for (const key of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(key)) throw new Error(`brand.schema.json uses "${key}", which validate.ts does not enforce.`)
  }

  if (typeof schema.$ref === 'string') {
    const name = /^#\/\$defs\/(.+)$/.exec(schema.$ref)?.[1]
    const target = name === undefined ? undefined : (root.$defs as Record<string, Schema> | undefined)?.[name]
    if (target === undefined) throw new Error(`Unresolvable $ref ${schema.$ref}`)
    return validateSchema(value, target, root, path)
  }

  if ('const' in schema && value !== schema.const) {
    issues.push({ path, message: `must be ${JSON.stringify(schema.const)}` })
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    issues.push({ path, message: `must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}` })
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string]
    if (!types.some((t) => matchesType(value, t))) {
      issues.push({ path, message: `must be ${types.join(' or ')}, found ${typeOf(value)}` })
      return issues
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push({ path, message: `must not be empty` })
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      issues.push({ path, message: `"${value.slice(0, 60)}" does not match ${schema.pattern}` })
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) issues.push({ path, message: `must be at least ${schema.minimum}` })
    if (typeof schema.maximum === 'number' && value > schema.maximum) issues.push({ path, message: `must be at most ${schema.maximum}` })
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push({ path, message: `needs at least ${schema.minItems} item(s)` })
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => issues.push(...validateSchema(item, schema.items as Schema, root, `${path}[${i}]`)))
    }
  }
  if (typeOf(value) === 'object') {
    const object = value as Record<string, unknown>
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in object)) issues.push({ path, message: `is missing "${key}"` })
    }
    const properties = (schema.properties as Record<string, Schema> | undefined) ?? {}
    for (const [key, child] of Object.entries(object)) {
      const childSchema = properties[key]
      if (childSchema !== undefined) issues.push(...validateSchema(child, childSchema, root, `${path}.${key}`))
      else if (schema.additionalProperties === false) issues.push({ path: `${path}.${key}`, message: 'is not a known field' })
      else if (typeof schema.additionalProperties === 'object') {
        issues.push(...validateSchema(child, schema.additionalProperties as Schema, root, `${path}.${key}`))
      }
    }
  }
  return issues
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out = new Set<string>()
  for (const id of ids) (seen.has(id) ? out : seen).add(id)
  return [...out]
}

/** The meaning checks. Assumes the schema already passed. */
export function validateMeaning(brand: Brand): Issue[] {
  const issues: Issue[] = []
  const add = (path: string, message: string) => issues.push({ path, message })

  const sources = new Set(brand.sources.map((s) => s.id))
  const colors = new Map(brand.colors.map((c) => [c.id, c]))
  const gradients = new Set(brand.gradients.map((g) => g.id))
  const families = new Set(brand.typography.families.map((f) => f.id))
  const logos = new Set(brand.logo.files.map((l) => l.id))
  const placements = new Set(brand.adCreatives.placements.map((p) => p.id))
  const shadows = new Set(brand.shadows.map((s) => s.id))

  for (const [label, ids] of [
    ['sources', brand.sources.map((s) => s.id)],
    ['colors', brand.colors.map((c) => c.id)],
    ['gradients', brand.gradients.map((g) => g.id)],
    ['typography.families', brand.typography.families.map((f) => f.id)],
    ['typography.scale', brand.typography.scale.map((t) => t.id)],
    ['logo.files', brand.logo.files.map((l) => l.id)],
    ['adCreatives.placements', brand.adCreatives.placements.map((p) => p.id)],
    ['components', brand.components.map((c) => c.id)],
    ['socialTemplates', brand.socialTemplates.map((t) => t.id)],
  ] as const) {
    for (const id of duplicates(ids)) add(`$.${label}`, `id "${id}" is used twice`)
  }

  // Every value says where it came from.
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`))
    if (value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'source' && typeof child === 'string' && !sources.has(child)) {
        add(`${path}.source`, `names "${child}", which is not in sources`)
      }
      if (path !== '$' || key !== 'sources') walk(child, `${path}.${key}`)
    }
  }
  walk(brand, '$')

  const color = (ref: string, path: string) => {
    if (!colors.has(ref)) add(path, `names colour "${ref}", which is not in colors`)
  }
  const fill = (ref: string, path: string) => {
    if (!colors.has(ref) && !gradients.has(ref)) add(path, `names "${ref}", which is neither a colour nor a gradient`)
  }

  brand.contrastPairs.forEach((pair, i) => {
    const path = `$.contrastPairs[${i}]`
    color(pair.fg, `${path}.fg`)
    color(pair.bg, `${path}.bg`)
    const fg = colors.get(pair.fg)
    const bg = colors.get(pair.bg)
    if (fg === undefined || bg === undefined) return
    const ratio = contrastRatio(fg.hex, bg.hex)
    const minimum = minimumFor(pair.use)
    if (minimum !== undefined && ratio < minimum) {
      add(path, `${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, under the ${minimum}:1 WCAG minimum for ${pair.use}`)
    }
    if (pair.use === 'avoid' && ratio >= 4.5) {
      add(path, `${pair.fg} on ${pair.bg} is marked avoid but passes for text (${ratio.toFixed(2)}:1); say why or drop it`)
    }
    if (pair.documentedRatio !== undefined && Math.abs(pair.documentedRatio - ratio) > 0.02) {
      add(path, `the source documents ${pair.documentedRatio}:1 but the colours give ${ratio.toFixed(2)}:1`)
    }
  })

  brand.typography.scale.forEach((role, i) => {
    if (!families.has(role.family)) add(`$.typography.scale[${i}].family`, `names family "${role.family}", which is not declared`)
  })

  const style = brand.adCreatives.style
  fill(style.background, '$.adCreatives.style.background')
  for (const key of ['text', 'accent', 'muted', 'ctaBackground', 'ctaText'] as const) color(style[key], `$.adCreatives.style.${key}`)
  if (style.logoField !== undefined) color(style.logoField, '$.adCreatives.style.logoField')
  for (const key of ['headlineFamily', 'bodyFamily'] as const) {
    if (!families.has(style[key])) add(`$.adCreatives.style.${key}`, `names family "${style[key]}", which is not declared`)
  }
  if (style.logo !== null && !logos.has(style.logo)) add('$.adCreatives.style.logo', `names logo "${style.logo}", which is not in logo.files`)
  if (style.logo === null && brand.logo.placeholder === undefined) {
    add('$.adCreatives.style.logo', 'is null, so the brand needs a logo.placeholder')
  }
  if (brand.logo.files.length === 0 && brand.logo.placeholder === undefined) {
    add('$.logo', 'has no files and no placeholder')
  }
  const sample = brand.adCreatives.sample
  if (sample.emphasis !== undefined && !sample.headline.includes(sample.emphasis)) {
    add('$.adCreatives.sample.emphasis', 'must be a phrase inside the headline')
  }
  if (sample.emphasisGradient !== undefined && !gradients.has(sample.emphasisGradient)) {
    add('$.adCreatives.sample.emphasisGradient', `names "${sample.emphasisGradient}", which is not a gradient`)
  }
  for (const word of brand.voice.neverOnCreative) {
    const texts = [sample.eyebrow, sample.headline, sample.body, sample.price, sample.cta]
    if (texts.some((t) => t !== undefined && t.toLowerCase().includes(word.toLowerCase()))) {
      add('$.adCreatives.sample', `uses "${word}", which this brand never puts on a creative`)
    }
  }

  for (const required of ['1:1', '4:5', '9:16']) {
    if (!brand.adCreatives.placements.some((p) => p.ratio === required)) add('$.adCreatives.placements', `needs a ${required} placement`)
  }
  brand.adCreatives.placements.forEach((p, i) => {
    const [w, h] = p.ratio.split(':').map(Number) as [number, number]
    if (Math.abs(p.widthPx / p.heightPx - w / h) > 0.01) add(`$.adCreatives.placements[${i}]`, `${p.widthPx}x${p.heightPx} is not ${p.ratio}`)
    const z = p.safeZonePx
    if (z.top + z.bottom >= p.heightPx || z.left + z.right >= p.widthPx) add(`$.adCreatives.placements[${i}].safeZonePx`, 'leaves no room')
  })

  brand.socialTemplates.forEach((t, i) => {
    if (!placements.has(t.format)) add(`$.socialTemplates[${i}].format`, `names placement "${t.format}", which is not declared`)
  })

  brand.components.forEach((c, i) => {
    const path = `$.components[${i}]`
    color(c.surface, `${path}.surface`)
    color(c.style.color, `${path}.style.color`)
    if (c.style.background !== undefined) fill(c.style.background, `${path}.style.background`)
    if (c.style.family !== undefined && !families.has(c.style.family)) add(`${path}.style.family`, `names family "${c.style.family}", which is not declared`)
    if (c.style.shadow !== undefined && !shadows.has(c.style.shadow)) add(`${path}.style.shadow`, `names shadow "${c.style.shadow}", which is not declared`)
    // A label must be readable on its own fill: the brand's pair list must say so.
    // Without a fill of its own, the label sits on the surface.
    const behind = c.style.background ?? c.surface
    if (colors.has(behind)) {
      const fg = colors.get(c.style.color)
      const bg = colors.get(behind)
      if (fg !== undefined && bg !== undefined && contrastRatio(fg.hex, bg.hex) < 4.5) {
        add(path, `${c.style.color} on ${behind} is ${contrastRatio(fg.hex, bg.hex).toFixed(2)}:1, under 4.5:1 for a label`)
      }
    }
  })

  const proposed = brand.sources.filter((s) => s.kind === 'proposed').map((s) => s.id)
  const usesProposed = JSON.stringify(brand).match(/"source":"([a-z0-9-]+)"/g)?.some((m) => proposed.includes(m.slice(10, -1))) ?? false
  if (brand.status === 'imported' && usesProposed) add('$.status', 'is "imported" but some values come from a proposed source: use "mixed"')
  if (brand.status === 'proposed' && !usesProposed) add('$.status', 'is "proposed" but nothing comes from a proposed source')
  if (brand.nameSetting !== undefined && brand.logo.files.length > 0) {
    add('$.nameSetting', 'a brand whose name is not final must not ship logo files')
  }

  return issues
}
