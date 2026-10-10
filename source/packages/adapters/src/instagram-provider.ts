import { randomBytes } from 'node:crypto'

import type { Platform } from '@social-publisher/core'

import {
  registerProvider,
  type AuthorisedCredential,
  type DiscoveredAccount,
  type Provider,
} from './provider.ts'

/**
 * Instagram authorised directly, without a Facebook Page.
 *
 * The second way into Instagram. See `docs/decisions/0004`. The one that matters:
 * Meta's docs state plainly that this setup *"does not require a Facebook Page
 * to be linked to the Instagram professional account"*.
 *
 * That is the whole point. Many businesses are Instagram-first — they created an
 * Instagram business account and never made a Facebook Page. Before this they
 * could not connect at all, and "you need a Facebook Page you do not want" is
 * not a reason anyone accepts.
 *
 * Where a Page *is* linked, nothing changes: connecting through Facebook still
 * brings Instagram with it, and asking for a second authorisation for one
 * account would be worse than useful.
 *
 * ⚠️ This is a **different host and a different token** from the Page route.
 * `graph.instagram.com`, its own OAuth, its own scopes. The same trap Threads
 * set: sharing a company does not mean sharing an API.
 */

const AUTH_BASE = 'https://www.instagram.com/oauth/authorize'
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token'
const GRAPH = 'https://graph.instagram.com'
const INSTAGRAM: Platform = 'instagram'

/**
 * The scopes introduced with Instagram Login. The older `business_*` names were
 * deprecated on 2025-01-27, so anything still using them is stale.
 */
export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
] as const

export interface InstagramOAuthConfig {
  /** The **Instagram** app id, which is not the Meta app id. */
  readonly appId: string
  readonly appSecret: string
  readonly redirectUri: string
  readonly fetch?: typeof globalThis.fetch
}

export class InstagramOAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'InstagramOAuthError'
  }
}

export function createInstagramState(): string {
  return randomBytes(32).toString('base64url')
}

export function buildInstagramAuthUrl(config: InstagramOAuthConfig, state: string): string {
  const url = new URL(AUTH_BASE)
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  // Comma-separated here. LinkedIn uses spaces, Pinterest uses commas, Meta uses
  // commas — four platforms, three conventions, and each rejects the others with
  // an unhelpful error.
  url.searchParams.set('scope', INSTAGRAM_SCOPES.join(','))
  url.searchParams.set('state', state)
  return url.toString()
}

export class InstagramOAuth {
  readonly #config: InstagramOAuthConfig
  readonly #fetch: typeof globalThis.fetch

  constructor(config: InstagramOAuthConfig) {
    this.#config = config
    this.#fetch = config.fetch ?? globalThis.fetch
  }

  /**
   * Code to a usable token, in two steps.
   *
   * The first exchange returns a token that lasts about an hour. Stopping there
   * yields a connection that works while you are testing it and is dead by
   * morning — the same trap as Meta's and Threads' short-lived tokens.
   */
  async exchangeCode(code: string): Promise<AuthorisedCredential> {
    const short = await this.#form(TOKEN_URL, {
      client_id: this.#config.appId,
      client_secret: this.#config.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.#config.redirectUri,
      code,
    })

    if (short.access_token === undefined) {
      throw new InstagramOAuthError('Instagram did not return an access token')
    }
    return await this.exchangeForLongLived(short.access_token)
  }

  /** Short-lived to long-lived: about 60 days. */
  async exchangeForLongLived(shortLivedToken: string): Promise<AuthorisedCredential> {
    const url = new URL(`${GRAPH}/access_token`)
    url.searchParams.set('grant_type', 'ig_exchange_token')
    url.searchParams.set('client_secret', this.#config.appSecret)
    url.searchParams.set('access_token', shortLivedToken)

    const data = await this.#get<{ access_token?: string; expires_in?: number }>(url.toString())
    if (data.access_token === undefined) {
      throw new InstagramOAuthError('Instagram refused to issue a long-lived token')
    }
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1000),
    }
  }

  /**
   * Extends a long-lived token.
   *
   * Unlike a Facebook Page token, which lives as long as the app stays
   * installed, this one expires. A connection nobody refreshes simply stops
   * working after 60 days, weeks after anyone thinks about it — which is exactly
   * why the refresh runner exists.
   */
  async refresh(longLivedToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const url = new URL(`${GRAPH}/refresh_access_token`)
    url.searchParams.set('grant_type', 'ig_refresh_token')
    url.searchParams.set('access_token', longLivedToken)

    const data = await this.#get<{ access_token?: string; expires_in?: number }>(url.toString())
    if (data.access_token === undefined) {
      throw new InstagramOAuthError('Instagram refused to refresh the token')
    }
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1000),
    }
  }

  async profile(accessToken: string): Promise<{ id: string; username: string; accountType?: string }> {
    const url = new URL(`${GRAPH}/me`)
    url.searchParams.set('fields', 'id,username,account_type')
    url.searchParams.set('access_token', accessToken)

    const data = await this.#get<{ id?: string; username?: string; account_type?: string }>(
      url.toString(),
    )
    if (data.id === undefined) {
      throw new InstagramOAuthError('Instagram did not identify the authorising account')
    }
    return {
      id: data.id,
      username: data.username ?? 'Instagram',
      ...(data.account_type !== undefined ? { accountType: data.account_type } : {}),
    }
  }

  async #form(url: string, fields: Record<string, string>): Promise<{ access_token?: string }> {
    let response: Response
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      })
    } catch (cause) {
      throw new InstagramOAuthError('Could not reach Instagram', { cause })
    }
    return await this.#parse(response)
  }

  async #get<T>(url: string): Promise<T> {
    let response: Response
    try {
      response = await this.#fetch(url)
    } catch (cause) {
      throw new InstagramOAuthError('Could not reach Instagram', { cause })
    }
    return (await this.#parse(response)) as T
  }

  async #parse(response: Response): Promise<{ access_token?: string }> {
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new InstagramOAuthError(
        `Instagram returned a non-JSON response (HTTP ${response.status})`,
      )
    }
    if (!response.ok) {
      const error = parsed as {
        error_message?: string
        error?: { message?: string }
      }
      throw new InstagramOAuthError(
        `Instagram rejected the request: ${error.error_message ?? error.error?.message ?? response.status}`,
      )
    }
    return parsed as { access_token?: string }
  }
}

export class InstagramProvider implements Provider {
  readonly key = 'instagram'
  readonly displayName = 'Instagram (direct)'
  readonly platforms: readonly Platform[] = [INSTAGRAM]

  readonly #config: InstagramOAuthConfig

  constructor(config: InstagramOAuthConfig) {
    this.#config = config
  }

  get redirectUri(): string {
    return this.#config.redirectUri
  }

  authUrl(state: string): string {
    return buildInstagramAuthUrl(this.#config, state)
  }

  async exchangeCode(code: string): Promise<AuthorisedCredential> {
    return await new InstagramOAuth(this.#config).exchangeCode(code)
  }

  /** This token expires; a Page token does not. The refresh runner handles it. */
  async refresh(currentToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    return await new InstagramOAuth(this.#config).refresh(currentToken)
  }

  /** One authorisation is one Instagram account. */
  async discover(userAccessToken: string): Promise<DiscoveredAccount[]> {
    const profile = await new InstagramOAuth(this.#config).profile(userAccessToken)

    return [
      {
        externalId: profile.id,
        platform: INSTAGRAM,
        displayName: `@${profile.username}`,
        accessToken: userAccessToken,
      },
    ]
  }
}

export function registerInstagramProvider(config: InstagramOAuthConfig): InstagramProvider {
  const provider = new InstagramProvider(config)
  registerProvider(provider)
  return provider
}
