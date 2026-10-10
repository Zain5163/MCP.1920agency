import { join } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  DEFAULT_LINK_HOURS,
  MAX_LINK_HOURS,
  SECTIONS,
  SECTION_IDS,
  brandFor,
  brandsFor,
  contrastRatio,
  displayName,
  expiryFor,
  loadBrands,
  signViewerToken,
  tokensFor,
  usableSecret,
  wordmarkText,
  type BrandSettings,
  type BrandViewer,
  type LoadedBrand,
  type SectionId,
  type ViewerDeps,
} from '@social-publisher/brands'
import { optional } from '@social-publisher/config'

import { callFailure } from './publishing.ts'

/**
 * Brand design systems, served to the AI (list_brands, get_brand) and to people
 * (brand_viewer_link, which opens the private /brands viewer on the hosted server).
 *
 * The point is that every design an AI makes through this server, for any
 * brand it manages, starts from that brand's own tokens, logo files and voice
 * rather than from a fresh guess. The server instructions and the design skills
 * send the AI here first.
 *
 * Tenancy: a brand belongs to one tenant (brand.json `ownership`). Each call
 * resolves who is asking, and a brand that belongs to someone else is answered
 * exactly like one that does not exist.
 */

let cache: ReadonlyMap<string, LoadedBrand> | undefined

/**
 * Loaded and validated once per process. The hosted server builds a fresh tool
 * set per request; without the cache every request would re-read and re-check
 * every brand. A broken brand throws here, at start-up (http-server.ts calls
 * this before listening), rather than serving wrong values.
 */
export function allBrands(): ReadonlyMap<string, LoadedBrand> {
  cache ??= loadBrands()
  return cache
}

export const DEFAULT_PUBLIC_BASE_URL = 'https://mcp.1920agency.com'

/** Everything read from configuration is read per call, never at registration, so building the tool set reads nothing. */
export interface BrandToolOptions {
  /** Who is asking: hosted, the token's tenant; local, the owner. */
  readonly viewer: () => Promise<BrandViewer>
  readonly settings: () => BrandSettings
  /** BRAND_VIEW_SECRET. */
  readonly viewerSecret: () => string | undefined
  /** Where the viewer is served: PUBLIC_BASE_URL. */
  readonly publicBaseUrl: () => string
  /** Local transport only: give file paths on this machine, so the AI can use the logo files directly. */
  readonly localPaths?: boolean
  readonly brands?: () => ReadonlyMap<string, LoadedBrand>
  readonly now?: () => Date
}

/**
 * The product's name. TODO: read it from the central settings module
 * (packages/config, branch central-config) once that is merged; until then the
 * PRODUCT_NAME setting, and without it the brand's own "name not final" label.
 */
export function productSettings(): BrandSettings {
  return { productName: optional('PRODUCT_NAME') }
}

/** The viewer route's configuration, read per request (http-server.ts). */
export function viewerDepsFromConfig(): ViewerDeps {
  return {
    brands: allBrands(),
    secret: optional('BRAND_VIEW_SECRET'),
    ownerTenantId: optional('BRANDS_OWNER_TENANT_ID'),
    settings: productSettings(),
    now: () => new Date(),
  }
}

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] })

/** Who is asking, or a catalogue failure: never a raw throw out of a tool. */
async function resolveViewer(options: BrandToolOptions): Promise<BrandViewer | ReturnType<typeof text>> {
  try {
    return await options.viewer()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return text(callFailure(/can't reach database|ECONNREFUSED|connection.*closed/i.test(message) ? 'DB_UNREACHABLE' : 'UNKNOWN', message))
  }
}

function isAnswer(value: BrandViewer | ReturnType<typeof text>): value is ReturnType<typeof text> {
  return 'content' in value
}

function notFound(slug: string): ReturnType<typeof text> {
  return text(`No brand "${slug}" belongs to this account. Call list_brands to see the brands you can use.`)
}

function proposedSources(loaded: LoadedBrand): Set<string> {
  return new Set(loaded.brand.sources.filter((s) => s.kind === 'proposed').map((s) => s.id))
}

/** The rules every answer starts with: short, and the same for every brand. */
function howToUse(loaded: LoadedBrand, settings: BrandSettings, localPaths: boolean): string {
  const b = loaded.brand
  const proposed = [...proposedSources(loaded)]
  const logoLines =
    b.logo.files.length > 0
      ? b.logo.files.map((f) => `  - ${f.id}: ${f.name} (${f.widthPx}x${f.heightPx} ${f.format}, for ${f.background} backgrounds)${localPaths ? ` at ${join(loaded.dir, f.path)}` : ''}`)
      : [`  - none. Placeholder only: "${wordmarkText(b, settings) ?? b.name}" as plain text, marked as a placeholder. ${b.logo.placeholder?.note ?? ''}`]
  return [
    `Brand: ${displayName(b, settings)} (${b.slug}), design system ${b.version}, status ${b.status}.`,
    '',
    'How to use it:',
    '- Use only these colours, fonts, logo files and voice rules. The brand wins over any skill, template or new idea.',
    '- The logo is always one of the original files below, unchanged. Never draw, retype, recolour or generate a logo or wordmark.',
    `- Values whose source is ${proposed.length > 0 ? proposed.map((p) => `"${p}"`).join(', ') : 'marked proposed'} are PROPOSED: tell the user, and get the owner's yes before they appear in anything published.`,
    `- Never put these on a creative: ${b.voice.neverOnCreative.join(', ')}.`,
    `- Approval: ${b.approval.rule}`,
    '- Making a design does not publish it: posting and ads still go through their own approval step.',
    '',
    'Logo files:',
    ...logoLines,
    localPaths ? '' : 'To see the brand or download its files, ask for a private link with brand_viewer_link.',
  ].join('\n')
}

/** Tokens for a section, with each contrast pair's computed ratio added so the AI does not have to work it out. */
function sectionTokens(loaded: LoadedBrand, section: SectionId): Record<string, unknown> {
  const tokens = tokensFor(loaded.brand, section)
  if (section !== 'colours') return tokens
  const hex = new Map(loaded.brand.colors.map((c) => [c.id, c.hex]))
  return {
    ...tokens,
    contrastPairs: loaded.brand.contrastPairs.map((p) => ({ ...p, ratio: Number(contrastRatio(hex.get(p.fg)!, hex.get(p.bg)!).toFixed(2)) })),
  }
}

function sectionText(loaded: LoadedBrand, section: SectionId, parts: 'all' | 'tokens' | 'guidelines'): string {
  const title = SECTIONS.find((s) => s.id === section)!.title
  const out = [`## ${title}`]
  if (parts !== 'tokens') out.push('', loaded.guidelines[section])
  if (parts !== 'guidelines') out.push('', 'Tokens:', '```json', JSON.stringify(sectionTokens(loaded, section), null, 1), '```')
  return out.join('\n')
}

export function registerBrandTools(server: McpServer, options: BrandToolOptions): void {
  const brands = options.brands ?? allBrands
  const now = options.now ?? (() => new Date())

  server.tool(
    'list_brands',
    'List the brand design systems this account manages (colours, fonts, logo files, voice, ad and social rules). Call it before designing anything for a business: an ad creative, social post, carousel, landing page or store. Then load the brand with get_brand.',
    {},
    async () => {
      const viewer = await resolveViewer(options)
      if (isAnswer(viewer)) return viewer
      const mine = brandsFor(brands(), viewer)
      if (mine.length === 0) {
        return text(
          'No brand design systems belong to this account yet. Ask the user for their logo file, colours and fonts, ' +
            'or propose a small system (get_skill web-ui-design) and get it approved before designing.',
        )
      }
      const settings = options.settings()
      return text(
        [
          `${mine.length} brand${mine.length === 1 ? '' : 's'}. Load one with get_brand { brand } before designing for it; one part with get_brand { brand, section }.`,
          '',
          ...mine.map((l) => `${l.brand.slug}: ${displayName(l.brand, settings)} (${l.brand.status}, v${l.brand.version})\n  ${l.brand.summary}`),
          '',
          `Sections: ${SECTION_IDS.join(', ')}.`,
          'A person can see any of them with a private link: brand_viewer_link.',
        ].join('\n'),
      )
    },
  )

  server.tool(
    'get_brand',
    'Read a brand design system: the rules for using it, then its guidelines and machine-readable tokens (colours with roles and contrast, type scale and fonts, logo files and clear space, spacing, components, imagery, voice, ad placements and safe zones, social templates). Use it before any creative, post, page or store work for that brand, and follow it exactly.',
    {
      brand: z.string().describe('The brand slug from list_brands, e.g. "1920-agency".'),
      section: z
        .enum(SECTION_IDS as [SectionId, ...SectionId[]])
        .optional()
        .describe('Only one part, e.g. "ad-creatives" before making an ad, "colours", "logo". Without it, everything.'),
      parts: z
        .enum(['all', 'tokens', 'guidelines'])
        .optional()
        .describe('"tokens" for the JSON only, "guidelines" for the prose only. Default: both.'),
    },
    async ({ brand, section, parts }) => {
      const viewer = await resolveViewer(options)
      if (isAnswer(viewer)) return viewer
      const loaded = brandFor(brands(), brand, viewer)
      if (loaded === undefined) return notFound(brand)
      const settings = options.settings()
      const sections = section === undefined ? SECTION_IDS : [section]
      return text(
        [howToUse(loaded, settings, options.localPaths === true), '', ...sections.map((s) => sectionText(loaded, s, parts ?? 'all'))].join('\n\n'),
      )
    },
  )

  server.tool(
    'brand_viewer_link',
    `Make a private, expiring link to the brand viewer: a documentation page with every colour, type specimen, logo, component, sample ad (1:1, 4:5, 9:16) and social post, drawn from the brand's tokens. Give it to the user to look at or share with their team. Default ${DEFAULT_LINK_HOURS} hours, at most ${MAX_LINK_HOURS / 24} days; anyone with the link can view until it expires.`,
    {
      brand: z.string().optional().describe('One brand slug. Without it, the link opens every brand of this account.'),
      hours: z.number().min(1).max(MAX_LINK_HOURS).optional().describe(`How long the link works. Default ${DEFAULT_LINK_HOURS}.`),
    },
    async ({ brand, hours }) => {
      const secret = usableSecret(options.viewerSecret())
      if (secret === undefined) {
        return text(
          callFailure(
            'CONFIG_MISSING',
            'BRAND_VIEW_SECRET is not set on this server (it must be at least 32 random characters), so private brand links cannot be made. The brands themselves are still available through get_brand.',
          ),
        )
      }
      const viewer = await resolveViewer(options)
      if (isAnswer(viewer)) return viewer
      const mine = brandsFor(brands(), viewer)
      if (brand !== undefined && brandFor(brands(), brand, viewer) === undefined) return notFound(brand)
      if (brand === undefined && mine.length === 0) return text('No brand design systems belong to this account yet, so there is nothing to link to.')

      const at = now()
      const expires = expiryFor(at, hours ?? DEFAULT_LINK_HOURS)
      const token = signViewerToken({ brand: brand ?? '*', tenant: viewer.tenantId, expires }, secret)
      const base = options.publicBaseUrl().replace(/\/+$/, '')
      const url = `${base}/brands${brand === undefined ? '' : `/${brand}`}?t=${encodeURIComponent(token)}`
      const settings = options.settings()
      const what = brand === undefined ? `all ${mine.length} of this account's brands` : displayName(brandFor(brands(), brand, viewer)!.brand, settings)
      return text(
        [
          `Private link to ${what}, valid until ${new Date(expires * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC:`,
          url,
          '',
          'Anyone with this link can view the page until then, so share it only with people who should see the brand. It is not indexed by search engines and loads nothing from other sites.',
        ].join('\n'),
      )
    },
  )
}
