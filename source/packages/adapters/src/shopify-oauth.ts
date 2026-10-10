import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { productName } from '@social-publisher/config'

import { ShopifyError, httpsTransport, type ShopifyTransport } from './shopify-admin.ts'

/**
 * Shopify's authorization-code grant, for stores connected by their own owners
 * from an AI chat (hosted AdsPilot). The app secret stays on the server; the
 * owner's browser only ever carries a one-time code.
 *
 * Two signatures protect the callback:
 *   - Shopify signs the callback query with the app secret (verifyShopifyHmac),
 *     so a forged callback is refused.
 *   - AdsPilot signs the `state` it sends out (signState): which AdsPilot
 *     account asked, for which store, until when. Without it a callback could be
 *     replayed into someone else's account.
 *
 * Tokens are requested as EXPIRING offline tokens (required for public apps from
 * 2026): an access token for about an hour and a refresh token for about 90 days.
 */

export const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

export function normaliseShop(input: string): string | undefined {
  const shop = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const full = shop.includes('.') ? shop : `${shop}.myshopify.com`
  return SHOP_PATTERN.test(full) ? full : undefined
}

const b64url = (b: Buffer) => b.toString('base64url')

export interface InstallState {
  /** The AdsPilot account (tenant) that asked to connect. */
  tenantId: string
  shop: string
  /** Epoch ms after which the state is refused. */
  expiresAt: number
  nonce: string
}

export function signState(state: Omit<InstallState, 'nonce'>, key: string): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...state, nonce: b64url(randomBytes(12)) })))
  const mac = b64url(createHmac('sha256', key).update(`state.${body}`).digest())
  return `${body}.${mac}`
}

export function verifyState(token: string, key: string, now: number = Date.now()): InstallState | { error: string } {
  const [body, mac] = token.split('.')
  if (body === undefined || mac === undefined) return { error: 'The connect link is malformed.' }
  const expected = b64url(createHmac('sha256', key).update(`state.${body}`).digest())
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { error: `The connect link was not issued by ${productName()}.` }
  let parsed: InstallState
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as InstallState
  } catch {
    return { error: 'The connect link is malformed.' }
  }
  if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt < now) {
    return { error: `The connect link has expired. Ask ${productName()} for a new one in your chat.` }
  }
  return parsed
}

/**
 * Shopify's callback signature: HMAC-SHA256 over the query string minus `hmac`
 * (and the legacy `signature`), keys sorted, hex digest, keyed with the app secret.
 */
export function verifyShopifyHmac(query: URLSearchParams, secret: string): boolean {
  const hmac = query.get('hmac')
  if (hmac === null || !/^[0-9a-f]{64}$/i.test(hmac)) return false
  const message = [...query.entries()]
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const digest = createHmac('sha256', secret).update(message).digest('hex')
  const a = Buffer.from(digest, 'hex')
  const b = Buffer.from(hmac.toLowerCase(), 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function authorizeUrl(input: { shop: string; clientId: string; scopes: string; redirectUri: string; state: string }): string {
  const u = new URL(`https://${input.shop}/admin/oauth/authorize`)
  u.searchParams.set('client_id', input.clientId)
  u.searchParams.set('scope', input.scopes)
  u.searchParams.set('redirect_uri', input.redirectUri)
  u.searchParams.set('state', input.state)
  return u.toString()
}

export interface ShopifyTokenSet {
  accessToken: string
  /** When the access token stops working. */
  expiresAt: Date | undefined
  refreshToken: string | undefined
  /** When the refresh token, and so the whole authorisation, ends. */
  refreshExpiresAt: Date | undefined
  scopes: string[]
}

function parseTokenResponse(status: number, body: string, now: number): ShopifyTokenSet {
  let parsed: {
    access_token?: string
    expires_in?: number
    refresh_token?: string
    refresh_token_expires_in?: number
    scope?: string
    error?: string
    error_description?: string
  } = {}
  try {
    parsed = JSON.parse(body) as typeof parsed
  } catch {
    // handled below
  }
  if (status !== 200 || parsed.access_token === undefined) {
    throw new ShopifyError(
      `Shopify did not issue a token (HTTP ${status}${parsed.error ? `: ${parsed.error}` : ''}${parsed.error_description ? ` — ${parsed.error_description}` : ''}).`,
      'auth',
    )
  }
  return {
    accessToken: parsed.access_token,
    expiresAt: parsed.expires_in !== undefined ? new Date(now + parsed.expires_in * 1000) : undefined,
    refreshToken: parsed.refresh_token,
    refreshExpiresAt: parsed.refresh_token_expires_in !== undefined ? new Date(now + parsed.refresh_token_expires_in * 1000) : undefined,
    scopes: (parsed.scope ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  }
}

async function tokenRequest(shop: string, payload: Record<string, unknown>, transport: ShopifyTransport, now: () => number): Promise<ShopifyTokenSet> {
  let res: { status: number; body: string }
  try {
    res = await transport({
      host: shop,
      path: '/admin/oauth/access_token',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json', accept: 'application/json' },
    })
  } catch (cause) {
    throw new ShopifyError(`Could not reach ${shop}: ${cause instanceof Error ? cause.message : String(cause)}`, 'network')
  }
  return parseTokenResponse(res.status, res.body, now())
}

export async function exchangeCode(
  input: { shop: string; clientId: string; clientSecret: string; code: string },
  transport: ShopifyTransport = httpsTransport(),
  now: () => number = Date.now,
): Promise<ShopifyTokenSet> {
  return await tokenRequest(
    input.shop,
    { client_id: input.clientId, client_secret: input.clientSecret, code: input.code, expiring: 1 },
    transport,
    now,
  )
}

export async function refreshAccessToken(
  input: { shop: string; clientId: string; clientSecret: string; refreshToken: string },
  transport: ShopifyTransport = httpsTransport(),
  now: () => number = Date.now,
): Promise<ShopifyTokenSet> {
  return await tokenRequest(
    input.shop,
    { client_id: input.clientId, client_secret: input.clientSecret, grant_type: 'refresh_token', refresh_token: input.refreshToken },
    transport,
    now,
  )
}
