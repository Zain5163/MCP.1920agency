import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SECTIONS, type SectionId } from './sections.ts'
import type { Brand } from './types.ts'
import { validateMeaning, validateSchema, type Issue } from './validate.ts'

/**
 * Brands are folders: brands/<slug>/ holds brand.json (tokens), guidelines.md
 * (the prose, one "## " heading per section) and the assets/ and fonts/ the
 * tokens point to.
 *
 * WHY inside this package rather than at the repository root: the server image
 * is built from source/ only (deploy/Dockerfile.dockerignore), and the hosted
 * MCP reads these files at run time. Here they ship with the code that reads
 * them, and the same relative path works from src/ (tests, type-stripping) and
 * from dist/ (the compiled package).
 */
export const BRANDS_ROOT = fileURLToPath(new URL('../brands/', import.meta.url))
export const SCHEMA_PATH = fileURLToPath(new URL('../schema/brand.schema.json', import.meta.url))

export interface LoadedBrand {
  readonly brand: Brand
  readonly dir: string
  /** guidelines.md split by section; every section is present. */
  readonly guidelines: Readonly<Record<SectionId, string>>
  readonly guidelinesText: string
}

export class BrandValidationError extends Error {
  readonly issues: readonly Issue[]
  constructor(slug: string, issues: readonly Issue[]) {
    super(`Brand "${slug}" is not valid:\n  ${issues.map((i) => `${i.path} ${i.message}`).join('\n  ')}`)
    this.issues = issues
  }
}

/** Splits guidelines.md on "## " headings and maps each to its section. */
export function splitGuidelines(markdown: string): { sections: Partial<Record<SectionId, string>>; unknown: string[] } {
  const sections: Partial<Record<SectionId, string>> = {}
  const unknown: string[] = []
  const byTitle = new Map<string, SectionId>(SECTIONS.map((s) => [s.title.toLowerCase(), s.id]))
  let current: SectionId | undefined
  let buffer: string[] = []
  const flush = () => {
    if (current !== undefined) sections[current] = buffer.join('\n').trim()
    buffer = []
  }
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## (.+?)\s*$/.exec(line)
    if (heading !== null) {
      flush()
      current = byTitle.get(heading[1]!.toLowerCase())
      if (current === undefined) unknown.push(heading[1]!)
      continue
    }
    if (current !== undefined) buffer.push(line)
  }
  flush()
  return { sections, unknown }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Checks everything a brand.json points at on disk. */
export function fileIssues(brand: Brand, dir: string): Issue[] {
  const issues: Issue[] = []
  brand.logo.files.forEach((file, i) => {
    const path = join(dir, file.path)
    if (!existsSync(path)) return void issues.push({ path: `$.logo.files[${i}].path`, message: `${file.path} does not exist` })
    if (sha256(path) !== file.sha256) {
      issues.push({ path: `$.logo.files[${i}].sha256`, message: `${file.path} no longer matches its recorded checksum: the original was changed` })
    }
  })
  brand.typography.families.forEach((family, i) => {
    family.files.forEach((file, j) => {
      if (!existsSync(join(dir, file.path))) issues.push({ path: `$.typography.families[${i}].files[${j}]`, message: `${file.path} does not exist` })
    })
    if (family.files.length > 0 && family.licence.file === undefined) {
      issues.push({ path: `$.typography.families[${i}].licence`, message: 'ships font files, so the licence text must ship beside them' })
    }
    if (family.licence.file !== undefined && !existsSync(join(dir, family.licence.file))) {
      issues.push({ path: `$.typography.families[${i}].licence.file`, message: `${family.licence.file} does not exist` })
    }
  })
  return issues
}

let schemaCache: Record<string, unknown> | undefined

function schema(): Record<string, unknown> {
  schemaCache ??= JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>
  return schemaCache
}

/** Loads and fully checks one brand folder. Throws BrandValidationError with every problem at once. */
export function loadBrand(dir: string, slug: string): LoadedBrand {
  const raw = JSON.parse(readFileSync(join(dir, 'brand.json'), 'utf8')) as unknown
  const schemaIssues = validateSchema(raw, schema())
  if (schemaIssues.length > 0) throw new BrandValidationError(slug, schemaIssues)
  const brand = raw as Brand
  const issues = [...validateMeaning(brand), ...fileIssues(brand, dir)]
  if (brand.slug !== slug) issues.push({ path: '$.slug', message: `is "${brand.slug}" but the folder is "${slug}"` })

  const guidelinesPath = join(dir, 'guidelines.md')
  const guidelinesText = existsSync(guidelinesPath) ? readFileSync(guidelinesPath, 'utf8') : ''
  if (guidelinesText === '') issues.push({ path: 'guidelines.md', message: 'is missing' })
  const { sections, unknown } = splitGuidelines(guidelinesText)
  for (const s of SECTIONS) {
    if (sections[s.id] === undefined || sections[s.id] === '') issues.push({ path: 'guidelines.md', message: `has no "## ${s.title}" section` })
  }
  for (const title of unknown) issues.push({ path: 'guidelines.md', message: `has a "## ${title}" heading that is not a section` })

  if (issues.length > 0) throw new BrandValidationError(slug, issues)
  return { brand, dir, guidelines: sections as Record<SectionId, string>, guidelinesText }
}

/**
 * Every brand under root, checked. Built once at start-up: a server that
 * started with a broken brand would hand AIs wrong colours with full
 * confidence, so it refuses to start instead (like the skills library).
 */
export function loadBrands(root: string = BRANDS_ROOT): Map<string, LoadedBrand> {
  const out = new Map<string, LoadedBrand>()
  for (const slug of readdirSync(root).sort()) {
    const dir = join(root, slug)
    if (!statSync(dir).isDirectory()) continue
    out.set(slug, loadBrand(dir, slug))
  }
  return out
}

/** Settings that change how a brand is shown, read from configuration by the caller. */
export interface BrandSettings {
  /**
   * The product's name: the MCP passes productName() from the central
   * settings module (packages/config product.ts). This package takes it as a
   * value rather than importing config, so it stays free of runtime
   * dependencies and its tests need no env file.
   */
  readonly productName?: string | undefined
}

/**
 * The name to show. A brand whose name lives in a setting (the product) shows
 * the setting, unless that is a word the brand never puts on a creative.
 */
export function displayName(brand: Brand, settings: BrandSettings = {}): string {
  if (brand.nameSetting !== 'productName') return brand.name
  const name = settings.productName?.trim()
  if (name === undefined || name === '') return brand.name
  return isForbiddenName(brand, name) ? brand.name : name
}

/** The text a placeholder wordmark shows: never a working name the brand forbids. */
export function wordmarkText(brand: Brand, settings: BrandSettings = {}): string | undefined {
  const placeholder = brand.logo.placeholder
  if (placeholder === undefined) return undefined
  const name = settings.productName?.trim()
  if (brand.nameSetting === 'productName' && name !== undefined && name !== '' && !isForbiddenName(brand, name)) return name
  return placeholder.text
}

function isForbiddenName(brand: Brand, name: string): boolean {
  return brand.voice.neverOnCreative.some((word) => name.toLowerCase().includes(word.toLowerCase()))
}
