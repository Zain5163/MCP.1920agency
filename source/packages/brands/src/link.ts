import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed, expiring links to the brand viewer.
 *
 * The viewer is private: a page is served only for a link made by the
 * brand_viewer_link tool, which knows the caller's tenant. The link carries
 * which brand (or "*" for all of that tenant's brands), the tenant, and an
 * expiry, signed with HMAC-SHA256 under BRAND_VIEW_SECRET. Nothing is stored
 * server-side, so links survive restarts and need no table; the price is that
 * a link cannot be revoked one by one before it expires (rotate the secret to
 * revoke all of them). Hence a short default and a 7-day ceiling.
 *
 * The tenant in the link is checked again against the brand's ownership on
 * every view, so a link stops working if the brand changes hands.
 */

export interface ViewerClaims {
  /** A brand slug, or "*" for the index of this tenant's brands. */
  readonly brand: string
  readonly tenant: string
  /** Unix seconds. */
  readonly expires: number
}

export const DEFAULT_LINK_HOURS = 24
export const MAX_LINK_HOURS = 168
/** Shorter secrets are treated as absent, so a weak value cannot be configured by accident. */
export const MIN_SECRET_LENGTH = 32

const VERSION = 'v1'
const CONTEXT = 'brands.viewer-link.v1.'

export function usableSecret(secret: string | undefined): string | undefined {
  const s = secret?.trim()
  return s !== undefined && s.length >= MIN_SECRET_LENGTH ? s : undefined
}

function mac(payload: string, secret: string): string {
  // The context string keeps this key from ever validating a token made for another purpose.
  return createHmac('sha256', secret).update(CONTEXT + payload).digest('base64url')
}

export function signViewerToken(claims: ViewerClaims, secret: string): string {
  const key = usableSecret(secret)
  if (key === undefined) throw new Error(`The brand viewer secret must be at least ${MIN_SECRET_LENGTH} characters.`)
  const payload = Buffer.from(JSON.stringify({ b: claims.brand, t: claims.tenant, e: claims.expires })).toString('base64url')
  return `${VERSION}.${payload}.${mac(payload, key)}`
}

/**
 * The claims of a genuine, unexpired token, or null. Every kind of failure
 * returns the same null, so a caller learns nothing about why.
 */
export function verifyViewerToken(token: string | null | undefined, secret: string | undefined, now: Date): ViewerClaims | null {
  const key = usableSecret(secret)
  if (key === undefined || typeof token !== 'string' || token.length > 2048) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION) return null
  const [, payload, signature] = parts as [string, string, string]
  const expected = Buffer.from(mac(payload, key))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const c = decoded as { b?: unknown; t?: unknown; e?: unknown }
  if (typeof c.b !== 'string' || typeof c.t !== 'string' || typeof c.e !== 'number' || c.t === '') return null
  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (c.e <= nowSeconds) return null
  // A token claiming to last longer than any we issue was not made by us under this policy.
  if (c.e > nowSeconds + MAX_LINK_HOURS * 3600 + 300) return null
  return { brand: c.b, tenant: c.t, expires: c.e }
}

/** The expiry for a link valid `hours` from now, clamped to the allowed range. */
export function expiryFor(now: Date, hours: number = DEFAULT_LINK_HOURS): number {
  const h = Math.min(Math.max(Number.isFinite(hours) ? hours : DEFAULT_LINK_HOURS, 1), MAX_LINK_HOURS)
  return Math.floor(now.getTime() / 1000) + Math.round(h * 3600)
}
