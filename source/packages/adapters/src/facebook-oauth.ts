import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Facebook OAuth, the connect half of the adapter.
 *
 * The flow, and why it has four steps rather than one:
 *
 *   1. Send the user to Meta's dialog -> they approve -> Meta redirects back with a
 *      short-lived `code`.
 *   2. Exchange the code for a short-lived USER token (~1-2 hours).
 *   3. Exchange that for a long-lived USER token (~60 days).
 *   4. Call /me/accounts with the long-lived user token to get PAGE tokens.
 *
 * Step 3 before step 4 is the part that is easy to get wrong: page tokens inherit
 * the lifetime of the user token they were derived from. Fetch pages using the
 * short-lived token and you get page tokens that die in an hour; fetch them using
 * the long-lived one and Meta returns page tokens that do not expire at all while
 * the user keeps the app installed.
 */

const GRAPH_BASE = 'https://graph.facebook.com'
const DIALOG_BASE = 'https://www.facebook.com'

/**
 * Scopes for Wave 1. Instagram scopes are requested up front so the user approves
 * once rather than being sent back through the dialog when Instagram is added.
 *
 * With Standard Access these work on Pages you own. Serving anyone else's Page
 * needs Advanced Access via App Review.
 */
export const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
] as const

export interface OAuthConfig {
  readonly appId: string
  readonly appSecret: string
  readonly redirectUri: string
  readonly apiVersion: string
  readonly fetch?: typeof globalThis.fetch
}

export class OAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'OAuthError'
  }
}

/** Opaque CSRF token. Without it, an attacker can feed us their own `code`. */
export function createState(): string {
  return randomBytes(32).toString('base64url')
}

export function statesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  // Compare in constant time, and only when lengths match — timingSafeEqual throws
  // on a length mismatch, which would itself leak length.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

export function buildAuthUrl(config: OAuthConfig, state: string): string {
  const url = new URL(`${DIALOG_BASE}/${config.apiVersion}/dialog/oauth`)
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('scope', FACEBOOK_SCOPES.join(','))
  url.searchParams.set('response_type', 'code')
  return url.toString()
}

export interface UserToken {
  readonly accessToken: string
  readonly expiresAt?: Date
}

export interface PageAccount {
  readonly id: string
  readonly name: string
  readonly accessToken: string
  readonly category?: string
  readonly instagramAccountId?: string
}

export class FacebookOAuth {
  readonly #config: OAuthConfig
  readonly #fetch: typeof globalThis.fetch

  constructor(config: OAuthConfig) {
    this.#config = config
    this.#fetch = config.fetch ?? globalThis.fetch
  }

  /** Step 2: authorisation code -> short-lived user token. */
  async exchangeCode(code: string): Promise<UserToken> {
    const url = new URL(`${GRAPH_BASE}/${this.#config.apiVersion}/oauth/access_token`)
    url.searchParams.set('client_id', this.#config.appId)
    url.searchParams.set('client_secret', this.#config.appSecret)
    url.searchParams.set('redirect_uri', this.#config.redirectUri)
    url.searchParams.set('code', code)

    const data = await this.#get<{ access_token: string; expires_in?: number }>(url)
    return toUserToken(data)
  }

  /** Step 3: short-lived -> long-lived (~60 days). Must happen before listPages. */
  async exchangeForLongLived(shortLivedToken: string): Promise<UserToken> {
    const url = new URL(`${GRAPH_BASE}/${this.#config.apiVersion}/oauth/access_token`)
    url.searchParams.set('grant_type', 'fb_exchange_token')
    url.searchParams.set('client_id', this.#config.appId)
    url.searchParams.set('client_secret', this.#config.appSecret)
    url.searchParams.set('fb_exchange_token', shortLivedToken)

    const data = await this.#get<{ access_token: string; expires_in?: number }>(url)
    return toUserToken(data)
  }

  /**
   * Step 4: the Pages this user administers, each with its own page token.
   *
   * Pass a LONG-LIVED user token. Page tokens derived from a short-lived one expire
   * within the hour, which surfaces much later as a mysterious dead connection.
   */
  async listPages(longLivedUserToken: string): Promise<PageAccount[]> {
    const url = new URL(`${GRAPH_BASE}/${this.#config.apiVersion}/me/accounts`)
    url.searchParams.set('fields', 'id,name,access_token,category,instagram_business_account')
    url.searchParams.set('limit', '100')

    const data = await this.#get<{
      data?: Array<{
        id: string
        name: string
        access_token: string
        category?: string
        instagram_business_account?: { id: string }
      }>
    }>(url, longLivedUserToken)

    return (data.data ?? []).map((page) => ({
      id: page.id,
      name: page.name,
      accessToken: page.access_token,
      ...(page.category !== undefined ? { category: page.category } : {}),
      ...(page.instagram_business_account !== undefined
        ? { instagramAccountId: page.instagram_business_account.id }
        : {}),
    }))
  }

  /**
   * Proves a token is still live and reports its real scopes and expiry.
   *
   * Worth calling at connect time: it catches a user who approved the dialog but
   * unticked a permission, which otherwise fails much later at publish time with a
   * confusing error.
   */
  async debugToken(token: string): Promise<{
    isValid: boolean
    scopes: string[]
    expiresAt?: Date
    /** The Meta user who authorised. Identifies the same person reconnecting. */
    userId?: string
  }> {
    const url = new URL(`${GRAPH_BASE}/${this.#config.apiVersion}/debug_token`)
    url.searchParams.set('input_token', token)

    const appToken = `${this.#config.appId}|${this.#config.appSecret}`
    const data = await this.#get<{
      data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number; user_id?: string }
    }>(url, appToken)

    const info = data.data ?? {}
    const expiresAt =
      info.expires_at !== undefined && info.expires_at > 0
        ? new Date(info.expires_at * 1000)
        : undefined

    return {
      isValid: info.is_valid === true,
      scopes: info.scopes ?? [],
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(info.user_id !== undefined ? { userId: info.user_id } : {}),
    }
  }

  /**
   * appsecret_proof signs each call with the app secret, so a stolen token alone is
   * not enough to use our app. Meta recommends it and it costs one hash.
   */
  #proof(token: string): string {
    return createHmac('sha256', this.#config.appSecret).update(token).digest('hex')
  }

  async #get<T>(url: URL, token?: string): Promise<T> {
    if (token !== undefined) {
      url.searchParams.set('access_token', token)
      url.searchParams.set('appsecret_proof', this.#proof(token))
    }

    let response: Response
    try {
      response = await this.#fetch(url.toString(), { method: 'GET' })
    } catch (cause) {
      throw new OAuthError('Could not reach Facebook during the connect flow', { cause })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new OAuthError(`Facebook returned a non-JSON response (HTTP ${response.status})`)
    }

    const err = (parsed as { error?: { message?: string; code?: number } }).error
    if (err !== undefined) {
      throw new OAuthError(`Facebook rejected the request: ${err.message ?? 'unknown'}`)
    }
    if (!response.ok) {
      throw new OAuthError(`Facebook returned HTTP ${response.status}`)
    }
    return parsed as T
  }
}

function toUserToken(data: { access_token: string; expires_in?: number }): UserToken {
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    throw new OAuthError('Facebook did not return an access token')
  }
  // No expires_in means a token that does not expire on its own.
  return data.expires_in !== undefined && data.expires_in > 0
    ? { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) }
    : { accessToken: data.access_token }
}
