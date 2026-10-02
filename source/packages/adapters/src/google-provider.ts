import { PublishError, type Platform } from '@social-publisher/core'

import {
  classifyGoogleOAuthError,
  googleError,
  type GoogleErrorBody,
  type GoogleOAuthErrorBody,
} from './google-errors.ts'
import {
  registerProvider,
  type AuthUrlOptions,
  type AuthorisedCredential,
  type DiscoveredAccount,
  type Provider,
} from './provider.ts'

/**
 * Google authorisation and YouTube channel discovery.
 *
 * One Google connection is meant to grow product by product: YouTube now,
 * Business Profile and the rest later. Each product is a **scope bundle**,
 * asked for when it is connected, with `include_granted_scopes=true` so a later
 * grant adds to the earlier ones instead of replacing them. Bundle names live
 * here and nowhere else, so the connect command passes them through without
 * knowing what any of them is.
 *
 * Three things make Google unlike the providers before it:
 *
 *   - **Two lifetimes.** The access token lasts an hour; the refresh token lasts
 *     until it is revoked. So the credential carries both an `expiresAt` (the
 *     hour) and an `authorisationExpiresAt` (usually `null`, "no known end"),
 *     and the vault records the second in its expiry column. Storing the hour
 *     there would have the refresh runner declare the authorisation dead an
 *     hour after connecting.
 *   - **Granted is not requested.** People can untick individual permissions on
 *     Google's consent screen, so the token response's `scope` field, not the
 *     request, is the record of what the connection can do.
 *   - **The refresh token arrives once.** Google issues it on the first consent
 *     only, unless asked again with `prompt=consent`. A reconnect without it
 *     would come back with no refresh token and overwrite the stored one with
 *     nothing, so every authorisation asks with `prompt=consent`, and an
 *     exchange that still brings none is refused rather than stored.
 *
 * Endpoints and parameters were checked against Google's documentation on
 * 2026-10-02 (research/2026-10-02-youtube-api-facts.md, B1-B4).
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'
const YOUTUBE: Platform = 'youtube'

/** Matches the `/<provider>/callback` convention every provider here uses. */
export const DEFAULT_GOOGLE_REDIRECT_URI = 'http://localhost:8787/google/callback'

/**
 * What each Google product asks for. `identity` is always included: it is what
 * identifies the person (`sub`) so a reconnect updates the same authorisation.
 *
 * YouTube asks for upload plus read-only, not the full `youtube` scope. Upload
 * alone cannot list the channel, and both channel discovery and the identity
 * check before every upload need `channels.list`; full `youtube` ("Manage your
 * YouTube account") is a far more alarming consent for nothing used yet.
 * Analytics will be its own bundle, asked for when it is built.
 */
export const GOOGLE_SCOPE_BUNDLES: Readonly<Record<string, readonly string[]>> = {
  identity: ['openid', 'email', 'profile'],
  youtube: [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
  ],
}

/**
 * Bundles asked for when none is named. YouTube is the only Google product that
 * has anything to post to yet, and an identity-only sign-in would connect
 * nothing. When a second product exists, revisit this rather than letting it
 * grow: Google asks that each permission be requested in the context it is
 * used.
 */
export const DEFAULT_GOOGLE_SCOPE_BUNDLES: readonly string[] = ['youtube']

/**
 * A failure talking to Google's OAuth endpoints.
 *
 * A PublishError, so it carries a failure class. That is what lets the vault
 * tell a network blip during a token refresh (`transient`: try again, mark
 * nothing) from Google refusing the token (`credential`: the account needs
 * reconnecting), and lets the publisher report either one precisely.
 */
export class GoogleOAuthError extends PublishError {
  constructor(message: string, options: ConstructorParameters<typeof PublishError>[1]) {
    super(message, options)
    this.name = 'GoogleOAuthError'
  }
}

/**
 * Every scope to ask for, for the named bundles plus identity.
 *
 * An unknown name throws and lists the real ones. Asking Google for a product
 * the provider does not know is a typo, and silently connecting less than was
 * asked for would surface much later as a missing permission.
 */
export function googleScopes(bundles: readonly string[] = []): string[] {
  const named = bundles.map((b) => b.trim().toLowerCase()).filter((b) => b !== '')
  const requested = named.length > 0 ? named : DEFAULT_GOOGLE_SCOPE_BUNDLES
  const unknown = requested.filter((b) => !Object.hasOwn(GOOGLE_SCOPE_BUNDLES, b))
  if (unknown.length > 0) {
    const products = Object.keys(GOOGLE_SCOPE_BUNDLES).filter((b) => b !== 'identity')
    throw new GoogleOAuthError(
      `No Google product called ${unknown.map((u) => `"${u}"`).join(', ')}. Choose from: ${products.join(', ')}.`,
      { failureClass: 'permanent' },
    )
  }

  const scopes = new Set<string>(GOOGLE_SCOPE_BUNDLES.identity)
  for (const bundle of requested) {
    for (const scope of GOOGLE_SCOPE_BUNDLES[bundle] ?? []) scopes.add(scope)
  }
  return [...scopes]
}

export interface GoogleOAuthConfig {
  readonly clientId: string
  readonly clientSecret: string
  /** Needed to exchange a sign-in code. Renewing a token does not use it. */
  readonly redirectUri?: string
  readonly fetch?: typeof globalThis.fetch
}

export interface GoogleProviderConfig extends GoogleOAuthConfig {
  readonly redirectUri: string
}

/**
 * The authorise URL.
 *
 * Scopes are joined with spaces, like LinkedIn and unlike Meta's commas.
 * `access_type=offline` is what earns a refresh token at all, `prompt=consent`
 * makes Google issue one again on a reconnect, and `include_granted_scopes`
 * keeps permissions granted earlier for other products. `state` is the CSRF
 * check the callback server verifies.
 */
export function buildGoogleAuthUrl(
  config: GoogleProviderConfig,
  state: string,
  bundles: readonly string[] = [],
): string {
  const url = new URL(AUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', googleScopes(bundles).join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)
  return url.toString()
}

interface TokenResponse {
  readonly access_token?: string
  readonly expires_in?: number
  readonly refresh_token?: string
  readonly refresh_token_expires_in?: number
  readonly scope?: string
  readonly token_type?: string
}

interface ChannelList {
  readonly items?: ReadonlyArray<{ readonly id?: string; readonly snippet?: { readonly title?: string } }>
}

/** Token-endpoint refusals that mean the app's own client is misconfigured. */
const CLIENT_ERRORS: ReadonlySet<string> = new Set(['invalid_client', 'unauthorized_client', 'deleted_client'])

export class GoogleOAuth {
  readonly #config: GoogleOAuthConfig
  readonly #fetch: typeof globalThis.fetch

  constructor(config: GoogleOAuthConfig) {
    this.#config = config
    this.#fetch = config.fetch ?? globalThis.fetch
  }

  /**
   * Code -> tokens, plus who signed in.
   *
   * The client secret goes in the form body. The person is identified from
   * OpenID user info: `sub` is stable for the life of the Google account, so it
   * keys the stored authorisation, and the email labels it.
   */
  async exchangeCode(code: string): Promise<AuthorisedCredential> {
    const redirectUri = this.#config.redirectUri
    if (redirectUri === undefined) {
      throw new GoogleOAuthError('Exchanging a Google sign-in code needs the redirect URI it was issued for.', {
        failureClass: 'permanent',
      })
    }

    const data = await this.#token(
      { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
      'exchange the sign-in code',
    )
    if (data.access_token === undefined) {
      throw new GoogleOAuthError('Google did not return an access token for the sign-in code.', {
        failureClass: 'permanent',
      })
    }
    if (data.refresh_token === undefined) {
      // Without it the connection dies within the hour, and storing it anyway
      // would look like a working connect until then.
      throw new GoogleOAuthError(
        'Google returned no refresh token, so this connection would stop working within the hour. ' +
          'Nothing was stored. Remove the app at https://myaccount.google.com/permissions and connect again.',
        { failureClass: 'permanent', code: 'GOOGLE_TOKEN_REVOKED' },
      )
    }

    const person = await this.userinfo(data.access_token)
    const now = Date.now()
    const label = person.email ?? person.name
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(now + (data.expires_in ?? 3_600) * 1000),
      ...(data.scope !== undefined ? { grantedScopes: data.scope.split(' ').filter((s) => s !== '') } : {}),
      externalUserId: person.sub,
      ...(label !== undefined ? { accountLabel: label } : {}),
      // Only time-limited grants carry an end date. Otherwise the refresh
      // token lives until revoked, so there is no known end. The 7-day limit on
      // apps in Testing status is real but not reported in the response.
      authorisationExpiresAt:
        data.refresh_token_expires_in !== undefined
          ? new Date(now + data.refresh_token_expires_in * 1000)
          : null,
    }
  }

  /**
   * Renews the access token with the refresh token.
   *
   * Google normally sends no new refresh token here, so the one used is handed
   * back to be kept. Should Google ever rotate it, the new one wins.
   */
  async refreshWithToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const data = await this.#token(
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      'renew the access token',
    )
    if (data.access_token === undefined) {
      throw new GoogleOAuthError('Google answered the token renewal without an access token.', {
        failureClass: 'transient',
      })
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 3_600) * 1000),
    }
  }

  /**
   * The vault's refresh function, for providers and adapters alike. A stored
   * credential without a refresh token cannot be renewed, which is a dead
   * credential rather than a fault worth retrying.
   */
  async refreshCredential(current: {
    readonly accessToken: string
    readonly refreshToken?: string
    readonly expiresAt?: Date
  }): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    if (current.refreshToken === undefined) {
      throw new GoogleOAuthError(
        'This Google connection holds no refresh token, so its hour-long access token cannot be renewed. Reconnect it.',
        { failureClass: 'credential', code: 'GOOGLE_TOKEN_REVOKED' },
      )
    }
    return await this.refreshWithToken(current.refreshToken)
  }

  /** Who signed in, from OpenID Connect. */
  async userinfo(accessToken: string): Promise<{ sub: string; email?: string; name?: string }> {
    const data = await this.#get<{ sub?: string; email?: string; name?: string }>(
      USERINFO_URL,
      accessToken,
      'identify the Google account',
    )
    if (data.sub === undefined || data.sub === '') {
      throw new GoogleOAuthError('Google did not say which account signed in.', { failureClass: 'permanent' })
    }
    return {
      sub: data.sub,
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
    }
  }

  /**
   * The YouTube channel this token reaches. One token reaches one channel.
   *
   * An empty list, not an error, when there is nothing to connect: an account
   * with no channel (Google documents 401 `youtubeSignupRequired`; whether
   * `mine=true` instead answers with no items is unverified, so both count) and
   * a sign-in where YouTube read access was unticked (403
   * `insufficientPermissions`). Both are expected states rather than faults,
   * and the provider's hint explains them. Anything else — quota, a switched-off
   * API, a network failure — is thrown, classified.
   */
  async youtubeChannels(accessToken: string): Promise<Array<{ id: string; title: string }>> {
    const url = new URL(CHANNELS_URL)
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('mine', 'true')

    let data: ChannelList
    try {
      data = await this.#get<ChannelList>(url.toString(), accessToken, 'list the YouTube channel')
    } catch (error) {
      if (
        error instanceof PublishError &&
        (error.code === 'YOUTUBE_NO_CHANNEL' || error.code === 'GOOGLE_SCOPE_NOT_GRANTED')
      ) {
        return []
      }
      throw error
    }

    return (data.items ?? [])
      .filter((item): item is { id: string; snippet?: { title?: string } } => typeof item.id === 'string')
      .map((item) => ({ id: item.id, title: item.snippet?.title ?? item.id }))
  }

  async #token(fields: Record<string, string>, purpose: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      ...fields,
      client_id: this.#config.clientId,
      client_secret: this.#config.clientSecret,
    })

    let response: Response
    try {
      response = await this.#fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })
    } catch (cause) {
      // No answer is not a refusal. Calling it permanent would let one dropped
      // connection mark a working account as needing reconnection.
      throw new GoogleOAuthError(`Could not reach Google to ${purpose}.`, { failureClass: 'transient', cause })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      parsed = undefined
    }

    if (!response.ok) {
      const error = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as GoogleOAuthErrorBody
      const classified = classifyGoogleOAuthError(error, response.status)
      const reason = typeof error.error === 'string' ? error.error : undefined
      const detail = error.error_description ?? reason ?? `HTTP ${response.status}`
      const hint =
        reason !== undefined && CLIENT_ERRORS.has(reason)
          ? ' Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in ~/.social-publisher/.env; a deleted client can be restored in Google Cloud within 30 days.'
          : ''
      throw new GoogleOAuthError(`Google refused to ${purpose}: ${detail}.${hint}`, {
        failureClass: classified.failureClass,
        platformMessage: detail,
        ...(reason !== undefined ? { platformCode: reason } : {}),
        httpStatus: response.status,
        ...(classified.code !== undefined ? { code: classified.code } : {}),
      })
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new GoogleOAuthError(`Google answered a request to ${purpose} with something that was not JSON.`, {
        failureClass: 'transient',
        httpStatus: response.status,
      })
    }
    return parsed as TokenResponse
  }

  async #get<T>(url: string, accessToken: string, purpose: string): Promise<T> {
    let response: Response
    try {
      response = await this.#fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } })
    } catch (cause) {
      throw new GoogleOAuthError(`Could not reach Google to ${purpose}.`, { failureClass: 'transient', cause })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      parsed = undefined
    }

    if (!response.ok) {
      throw googleError((parsed ?? {}) as GoogleErrorBody, response.status, {
        what: `Google (${purpose})`,
        retryAfter: response.headers.get('retry-after'),
      })
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new GoogleOAuthError(`Google answered a request to ${purpose} with something that was not JSON.`, {
        failureClass: 'transient',
        httpStatus: response.status,
      })
    }
    return parsed as T
  }
}

export class GoogleProvider implements Provider {
  readonly key = 'google'
  readonly displayName = 'Google'
  readonly platforms: readonly Platform[] = [YOUTUBE]
  readonly noAccountsHint =
    'A Google sign-in reaches a YouTube channel only if that Google account has a channel and ' +
    '"View your YouTube account" was left ticked on the consent screen. Create the channel at ' +
    'https://www.youtube.com, or connect again and leave every permission ticked.'

  readonly #config: GoogleProviderConfig

  constructor(config: GoogleProviderConfig) {
    this.#config = config
  }

  get redirectUri(): string {
    return this.#config.redirectUri
  }

  authUrl(state: string, options?: AuthUrlOptions): string {
    return buildGoogleAuthUrl(this.#config, state, options?.scopeBundles ?? [])
  }

  async exchangeCode(code: string): Promise<AuthorisedCredential> {
    return await new GoogleOAuth(this.#config).exchangeCode(code)
  }

  /**
   * One connectable account per channel the token reaches.
   *
   * `externalId` is the channel id, which is what the YouTube adapter checks the
   * token against before every upload. Each channel publishes with the same
   * Google token, so its connection gets a copy of it, refresh token included.
   */
  async discover(userAccessToken: string): Promise<DiscoveredAccount[]> {
    const channels = await new GoogleOAuth(this.#config).youtubeChannels(userAccessToken)
    return channels.map((channel) => ({
      externalId: channel.id,
      platform: YOUTUBE,
      displayName: channel.title,
      accessToken: userAccessToken,
    }))
  }

  async refreshCredential(current: {
    readonly accessToken: string
    readonly refreshToken?: string
    readonly expiresAt?: Date
  }): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    return await new GoogleOAuth(this.#config).refreshCredential(current)
  }
}

/**
 * Google's settings from the environment, or undefined when it is not set up.
 * Optional by design, like every provider: an install that does not use Google
 * must not need its keys.
 */
export function googleProviderConfigFromEnv(
  read: (key: string) => string | undefined,
): GoogleProviderConfig | undefined {
  const clientId = read('GOOGLE_CLIENT_ID')
  const clientSecret = read('GOOGLE_CLIENT_SECRET')
  if (clientId === undefined || clientSecret === undefined) return undefined
  return {
    clientId,
    clientSecret,
    redirectUri: read('GOOGLE_REDIRECT_URI') ?? DEFAULT_GOOGLE_REDIRECT_URI,
  }
}

export function registerGoogleProvider(config: GoogleProviderConfig): GoogleProvider {
  const provider = new GoogleProvider(config)
  registerProvider(provider)
  return provider
}
