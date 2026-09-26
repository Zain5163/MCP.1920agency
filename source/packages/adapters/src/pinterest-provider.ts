import { randomBytes } from 'node:crypto'

import type { Platform } from '@social-publisher/core'

import {
  registerProvider,
  type AuthorisedCredential,
  type DiscoveredAccount,
  type Provider,
} from './provider.ts'

/**
 * Pinterest authorisation and board discovery.
 *
 * Boards are the publish targets, so discovery returns one account per board
 * rather than one per Pinterest profile. That is what makes "post this pin to the
 * Recipes board, not all fourteen boards" expressible at all.
 *
 * ⚠️ Two access tiers. A new app has **Trial access**, where pins and boards
 * created through the API are sandbox entities visible only to their creator.
 * Standard Access requires a submitted video of the app performing a real action.
 * Everything succeeds under trial — the ids come back, the URLs resolve — which
 * makes it easy to believe publishing works when nobody else can see it.
 */

const AUTH_BASE = 'https://www.pinterest.com/oauth'
const API_BASE = 'https://api.pinterest.com/v5'
const PINTEREST: Platform = 'pinterest'

export const PINTEREST_SCOPES = [
  'boards:read',
  'pins:read',
  'pins:write',
  'user_accounts:read',
] as const

export interface PinterestOAuthConfig {
  readonly appId: string
  readonly appSecret: string
  readonly redirectUri: string
  readonly fetch?: typeof globalThis.fetch
}

export class PinterestOAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PinterestOAuthError'
  }
}

export function createPinterestState(): string {
  return randomBytes(32).toString('base64url')
}

export function buildPinterestAuthUrl(config: PinterestOAuthConfig, state: string): string {
  const url = new URL(AUTH_BASE)
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', PINTEREST_SCOPES.join(','))
  url.searchParams.set('state', state)
  return url.toString()
}

export class PinterestOAuth {
  readonly #config: PinterestOAuthConfig
  readonly #fetch: typeof globalThis.fetch

  constructor(config: PinterestOAuthConfig) {
    this.#config = config
    this.#fetch = config.fetch ?? globalThis.fetch
  }

  /**
   * Code -> tokens.
   *
   * Pinterest authenticates this call with HTTP Basic using the app id and
   * secret, not by putting the secret in the body — a difference from every Meta
   * flow here, and an easy one to get wrong.
   */
  async exchangeCode(code: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
    const basic = Buffer.from(`${this.#config.appId}:${this.#config.appSecret}`).toString('base64')

    const data = await this.#request<{
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }>(`${API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.#config.redirectUri,
      }),
    })

    if (data.access_token === undefined) {
      throw new PinterestOAuthError('Pinterest did not return an access token')
    }
    return {
      accessToken: data.access_token,
      ...(data.refresh_token !== undefined ? { refreshToken: data.refresh_token } : {}),
      ...(data.expires_in !== undefined
        ? { expiresAt: new Date(Date.now() + data.expires_in * 1000) }
        : {}),
    }
  }

  /** Pinterest access tokens expire; the refresh token is long-lived. */
  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const basic = Buffer.from(`${this.#config.appId}:${this.#config.appSecret}`).toString('base64')

    const data = await this.#request<{ access_token?: string; expires_in?: number }>(
      `${API_BASE}/oauth/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      },
    )

    if (data.access_token === undefined) {
      throw new PinterestOAuthError('Pinterest refused to refresh the token')
    }
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 2_592_000) * 1000),
    }
  }

  async boards(accessToken: string): Promise<Array<{ id: string; name: string }>> {
    const url = new URL(`${API_BASE}/boards`)
    url.searchParams.set('page_size', '100')

    const data = await this.#request<{ items?: Array<{ id: string; name: string }> }>(
      url.toString(),
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    )
    return data.items ?? []
  }

  async #request<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await this.#fetch(url, init)
    } catch (cause) {
      throw new PinterestOAuthError('Could not reach Pinterest', { cause })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new PinterestOAuthError(`Pinterest returned a non-JSON response (HTTP ${response.status})`)
    }

    if (!response.ok) {
      const message = (parsed as { message?: string }).message
      throw new PinterestOAuthError(`Pinterest rejected the request: ${message ?? response.status}`)
    }
    return parsed as T
  }
}

export class PinterestProvider implements Provider {
  readonly key = 'pinterest'
  readonly displayName = 'Pinterest'
  readonly platforms: readonly Platform[] = [PINTEREST]

  get redirectUri(): string {
    return this.#config.redirectUri
  }

  readonly #config: PinterestOAuthConfig

  constructor(config: PinterestOAuthConfig) {
    this.#config = config
  }

  /**
   * One board is one connectable account.
   *
   * The alternative — one connection per Pinterest profile, board chosen per post
   * — would need a board field on every draft and in every interface. Modelling
   * boards as accounts keeps the rest of the system unchanged, which is the same
   * reasoning that made Instagram a linked account of a Facebook Page.
   */
  authUrl(state: string): string {
    return buildPinterestAuthUrl(this.#config, state)
  }

  async exchangeCode(code: string): Promise<AuthorisedCredential> {
    return await new PinterestOAuth(this.#config).exchangeCode(code)
  }

  async discover(userAccessToken: string): Promise<DiscoveredAccount[]> {
    const boards = await new PinterestOAuth(this.#config).boards(userAccessToken)

    return boards.map((board) => ({
      externalId: board.id,
      platform: PINTEREST,
      displayName: board.name,
      accessToken: userAccessToken,
    }))
  }
}

export function registerPinterestProvider(config: PinterestOAuthConfig): PinterestProvider {
  const provider = new PinterestProvider(config)
  registerProvider(provider)
  return provider
}
