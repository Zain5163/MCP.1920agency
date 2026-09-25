import { randomBytes, timingSafeEqual } from 'node:crypto'

import type { Platform } from '@social-publisher/core'

import { registerProvider, type DiscoveredAccount, type Provider } from './provider.ts'

/**
 * Threads authorisation and discovery.
 *
 * Deliberately separate from the Meta provider, because Threads is a separate
 * authorisation despite both being Meta:
 *
 *   - authorise at threads.net, not facebook.com
 *   - exchange tokens at graph.threads.net, not graph.facebook.com
 *   - its own scopes: threads_basic, threads_content_publish
 *   - the Meta app must be configured with the **Threads use case**
 *
 * One more difference that matters operationally: a Threads long-lived token
 * lasts 60 days and **must be refreshed** to stay alive, whereas a Facebook Page
 * token derived from a long-lived user token does not expire while the app stays
 * installed. So Threads connections go stale if nothing refreshes them.
 */

const AUTH_BASE = 'https://threads.net'
const API_BASE = 'https://graph.threads.net'
const THREADS: Platform = 'threads'

export const THREADS_SCOPES = ['threads_basic', 'threads_content_publish'] as const

export interface ThreadsOAuthConfig {
  readonly appId: string
  readonly appSecret: string
  readonly redirectUri: string
  readonly fetch?: typeof globalThis.fetch
}

export class ThreadsOAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ThreadsOAuthError'
  }
}

export function createThreadsState(): string {
  return randomBytes(32).toString('base64url')
}

export function threadsStatesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

export function buildThreadsAuthUrl(config: ThreadsOAuthConfig, state: string): string {
  const url = new URL(`${AUTH_BASE}/oauth/authorize`)
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', THREADS_SCOPES.join(','))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  return url.toString()
}

export interface ThreadsToken {
  readonly accessToken: string
  readonly userId: string
  readonly expiresAt?: Date
}

export class ThreadsOAuth {
  readonly #config: ThreadsOAuthConfig
  readonly #fetch: typeof globalThis.fetch

  constructor(config: ThreadsOAuthConfig) {
    this.#config = config
    this.#fetch = config.fetch ?? globalThis.fetch
  }

  /** Code -> short-lived token (~1 hour). Also returns the Threads user id. */
  async exchangeCode(code: string): Promise<ThreadsToken> {
    const body = new URLSearchParams({
      client_id: this.#config.appId,
      client_secret: this.#config.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.#config.redirectUri,
      code,
    })

    const data = await this.#request<{ access_token?: string; user_id?: string | number }>(
      `${API_BASE}/oauth/access_token`,
      { method: 'POST', body },
    )

    if (data.access_token === undefined || data.user_id === undefined) {
      throw new ThreadsOAuthError('Threads did not return an access token')
    }
    return { accessToken: data.access_token, userId: String(data.user_id) }
  }

  /** Short-lived -> long-lived (~60 days). Required before anything useful. */
  async exchangeForLongLived(shortLivedToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const url = new URL(`${API_BASE}/access_token`)
    url.searchParams.set('grant_type', 'th_exchange_token')
    url.searchParams.set('client_secret', this.#config.appSecret)
    url.searchParams.set('access_token', shortLivedToken)

    const data = await this.#request<{ access_token?: string; expires_in?: number }>(url.toString(), {
      method: 'GET',
    })
    if (data.access_token === undefined) {
      throw new ThreadsOAuthError('Threads did not return a long-lived token')
    }
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1000),
    }
  }

  /**
   * Extends a long-lived token.
   *
   * Unlike a Facebook Page token, a Threads token expires. It can be refreshed
   * between 24 hours and 60 days after issue — leave it longer and the connection
   * simply dies, needing a full reauthorisation.
   */
  async refresh(longLivedToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const url = new URL(`${API_BASE}/refresh_access_token`)
    url.searchParams.set('grant_type', 'th_refresh_token')
    url.searchParams.set('access_token', longLivedToken)

    const data = await this.#request<{ access_token?: string; expires_in?: number }>(url.toString(), {
      method: 'GET',
    })
    if (data.access_token === undefined) {
      throw new ThreadsOAuthError('Threads refused to refresh the token')
    }
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1000),
    }
  }

  /** The authorised profile. Threads has exactly one account per authorisation. */
  async profile(accessToken: string): Promise<{ id: string; username: string }> {
    const url = new URL(`${API_BASE}/v1.0/me`)
    url.searchParams.set('fields', 'id,username')

    const data = await this.#request<{ id?: string; username?: string }>(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (data.id === undefined) throw new ThreadsOAuthError('Threads did not return a profile')
    return { id: data.id, username: data.username ?? data.id }
  }

  async #request<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await this.#fetch(url, init)
    } catch (cause) {
      throw new ThreadsOAuthError('Could not reach Threads', { cause })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new ThreadsOAuthError(`Threads returned a non-JSON response (HTTP ${response.status})`)
    }

    const error = (parsed as { error?: { message?: string }; error_message?: string }).error
    const flat = (parsed as { error_message?: string }).error_message
    if (error !== undefined || flat !== undefined) {
      throw new ThreadsOAuthError(`Threads rejected the request: ${error?.message ?? flat}`)
    }
    if (!response.ok) throw new ThreadsOAuthError(`Threads returned HTTP ${response.status}`)

    return parsed as T
  }
}

export class ThreadsProvider implements Provider {
  readonly key = 'threads'
  readonly displayName = 'Threads'
  readonly platforms: readonly Platform[] = [THREADS]

  readonly #config: ThreadsOAuthConfig

  constructor(config: ThreadsOAuthConfig) {
    this.#config = config
  }

  /**
   * Threads tokens must be refreshed between 24 hours and 60 days after issue.
   * Outside that window the token is simply dead.
   */
  async refresh(currentToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    return await new ThreadsOAuth(this.#config).refresh(currentToken)
  }

  /**
   * One authorisation is one Threads account — there is no equivalent of
   * choosing between several Pages. Returning an array anyway keeps the Provider
   * contract uniform, which is what lets the UI stay platform-agnostic.
   */

  async discover(userAccessToken: string): Promise<DiscoveredAccount[]> {
    const oauth = new ThreadsOAuth(this.#config)
    const profile = await oauth.profile(userAccessToken)

    return [
      {
        externalId: profile.id,
        platform: THREADS,
        displayName: profile.username,
        accessToken: userAccessToken,
      },
    ]
  }
}

export function registerThreadsProvider(config: ThreadsOAuthConfig): ThreadsProvider {
  const provider = new ThreadsProvider(config)
  registerProvider(provider)
  return provider
}
