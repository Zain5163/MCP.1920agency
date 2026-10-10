import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { brandFor, brandsFor } from './access.ts'
import type { BrandSettings, LoadedBrand } from './load.ts'
import { verifyViewerToken } from './link.ts'
import { fileName, renderBrandPage, renderIndexPage, renderUnavailable } from './viewer.ts'

/**
 * The /brands routes, as a pure function from request to response so the
 * whole access model is testable without a socket.
 *
 *   GET /brands?t=…                     every brand of the link's tenant ("*" links only)
 *   GET /brands/<slug>?t=…              one brand's page
 *   GET /brands/<slug>/files/<name>?t=… a download: brand.json, guidelines.md,
 *                                       a logo file or a font licence, by exact name
 *
 * Without a genuine, unexpired link for a brand the tenant owns, every path
 * answers the same 404 page: no brand list, no hint whether a brand exists.
 */

export interface ViewerRequest {
  readonly method: string
  readonly pathname: string
  readonly token: string | null
}

export interface ViewerDeps {
  readonly brands: ReadonlyMap<string, LoadedBrand>
  /** BRAND_VIEW_SECRET. Absent or too short: every request is refused. */
  readonly secret: string | undefined
  readonly ownerTenantId: string | undefined
  readonly settings: BrandSettings
  readonly now: () => Date
}

export interface ViewerResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | Buffer
}

/**
 * Headers on every response. The CSP allows nothing to load from anywhere:
 * no script, no network, inline styles and data: fonts/images only, so the
 * page cannot leak its address (and the token in it) to any third party.
 */
export const VIEWER_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store, private',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}

const HTML = 'text/html; charset=utf-8'

function page(status: number, body: string): ViewerResponse {
  return { status, headers: { ...VIEWER_HEADERS, 'content-type': HTML }, body }
}

const notFound = (): ViewerResponse => page(404, renderUnavailable())

const DOWNLOAD_TYPES: Record<string, string> = {
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
}

/** The files of a brand that may be downloaded, by exact name. Nothing else in the folder is reachable. */
export function downloadable(loaded: LoadedBrand): Map<string, string> {
  const files = new Map<string, string>([
    ['brand.json', 'brand.json'],
    ['guidelines.md', 'guidelines.md'],
  ])
  for (const f of loaded.brand.logo.files) files.set(fileName(f.path), f.path)
  for (const family of loaded.brand.typography.families) {
    if (family.licence.file !== undefined) files.set(fileName(family.licence.file), family.licence.file)
  }
  return files
}

export function handleViewerRequest(req: ViewerRequest, deps: ViewerDeps): ViewerResponse {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return { status: 405, headers: { ...VIEWER_HEADERS, allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }, body: 'Method not allowed.' }
  }
  const path = req.pathname.replace(/\/+$/, '')
  const now = deps.now()
  const claims = verifyViewerToken(req.token, deps.secret, now)
  if (claims === null) return notFound()
  const viewer = { tenantId: claims.tenant, ownerTenantId: deps.ownerTenantId }
  const token = req.token!
  const expires = new Date(claims.expires * 1000)

  if (path === '/brands') {
    if (claims.brand !== '*') return notFound()
    return page(200, renderIndexPage(brandsFor(deps.brands, viewer), { token, settings: deps.settings, expires }))
  }

  const m = /^\/brands\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/files\/([A-Za-z0-9._-]+))?$/.exec(path)
  if (m === null) return notFound()
  const slug = m[1]!
  if (claims.brand !== '*' && claims.brand !== slug) return notFound()
  const loaded = brandFor(deps.brands, slug, viewer)
  if (loaded === undefined) return notFound()

  const file = m[2]
  if (file === undefined) {
    const others = claims.brand === '*' ? brandsFor(deps.brands, viewer) : []
    return page(200, renderBrandPage(loaded, { token, scope: claims.brand, others, settings: deps.settings, expires }))
  }

  const relative = downloadable(loaded).get(file)
  if (relative === undefined) return notFound()
  const ext = file.split('.').pop()?.toLowerCase() ?? ''
  return {
    status: 200,
    headers: {
      ...VIEWER_HEADERS,
      'content-type': DOWNLOAD_TYPES[ext] ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${loaded.brand.slug}-${file}"`,
    },
    body: readFileSync(join(loaded.dir, relative)),
  }
}
