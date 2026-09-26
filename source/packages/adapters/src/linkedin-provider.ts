import { randomBytes } from 'node:crypto'

import type { Platform } from '@social-publisher/core'

import {
  registerProvider,
  type AuthorisedCredential,
  type DiscoveredAccount,
  type Provider,
} from './provider.ts'

/**
 * LinkedIn authorisation and account discovery.
 *
 * LinkedIn splits into two products that behave like different platforms:
 *
 *   - **Share on LinkedIn** — self-serve. Tick it on the app and `w_member_social`
 *     works immediately. Posts go out as the person who authorised.
 *   - **Community Management API** — posting as a company page. Requires an
 *     application LinkedIn approves sparingly, and access can be refused with no
 *     appeal.
 *
 * **These two cannot live on the same app.** Confirmed 2026-09-26: with Sign In
 * with OpenID Connect enabled, Community Management's request button is disabled
 * outright. Creating a second app without OIDC made it requestable immediately.
 * This had been carried as a reported-but-unverified claim; it is now a fact the
 * design depends on.
 *
 * So one LinkedIn account means **two apps and two providers**:
 *
 *   - `linkedin` — the member app. OIDC plus `w_member_social`. Posts as a
 *     person.
 *   - `linkedin_page` — the organisation app. Organisation scopes only and no
 *     OIDC, so it cannot call `/v2/userinfo` and must not try. Posts as a page.
 *
 * Both yield the same `linkedin` platform and the same adapter, because the
 * author URN already carries which kind of thing is posting. Only authorisation
 * and discovery differ, which is exactly what a Provider is for.
 */

const AUTH_BASE = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const API_BASE = 'https://api.linkedin.com'
const LINKEDIN: Platform = 'linkedin'

/** Granted by the self-serve "Share on LinkedIn" product. */
export const LINKEDIN_MEMBER_SCOPES = ['openid', 'profile', 'w_member_social'] as const

/**
 * The organisation app's scopes. Requesting these from an app without Community
 * Management approval fails the whole dialog, not just these scopes.
 */
export const LINKEDIN_ORGANIZATION_SCOPES = [
  'r_organization_social',
  'w_organization_social',
  'rw_organization_admin',
] as const

export interface LinkedInOAuthConfig {
  readonly appId: string
  readonly appSecret: string
  readonly redirectUri: string
  /**
   * True for the **organisation app**: a separate LinkedIn app with Community
   * Management approved and OpenID Connect deliberately absent.
   *
   * This is not a flag to add to the member app. Setting it there would request
   * organisation scopes that app does not hold, and the dialog refuses outright
   * rather than degrading — which would break personal posting too.
   */
  readonly organizationAccess?: boolean
  readonly apiVersion?: string
  readonly fetch?: typeof globalThis.fetch
}

export class LinkedInOAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LinkedInOAuthError'
  }
}

export function createLinkedInState(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Each app asks for its own scopes and nothing else.
 *
 * The organisation app deliberately does NOT request `openid` or `profile`: it
 * has no Sign In with OpenID Connect product, and asking for a scope an app does
 * not hold fails the whole dialog rather than dropping that one scope.
 */
export function linkedInScopes(config: LinkedInOAuthConfig): string[] {
  return config.organizationAccess === true
    ? [...LINKEDIN_ORGANIZATION_SCOPES]
    : [...LINKEDIN_MEMBER_SCOPES]
}

export function buildLinkedInAuthUrl(config: LinkedInOAuthConfig, state: string): string {
  const url = new URL(AUTH_BASE)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', state)
  // Space-separated, unlike Pinterest's commas. Sending commas yields an
  // "invalid scope" error that names no scope in particular.
  url.searchParams.set('scope', linkedInScopes(config).join(' '))
  return url.toString()
}

export class LinkedInOAuth {
  readonly #config: LinkedInOAuthConfig
  readonly #fetch: typeof globalThis.fetch

  constructor(config: LinkedInOAuthConfig) {
    this.#config = config
    this.#fetch = config.fetch ?? globalThis.fetch
  }

  /**
   * Code -> tokens.
   *
   * The secret goes in the form body. Not HTTP Basic like Pinterest, and not a
   * query parameter like Meta — three platforms, three conventions.
   */
  async exchangeCode(
    code: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
    const data = await this.#form({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.#config.redirectUri,
    })

    if (data.access_token === undefined) {
      throw new LinkedInOAuthError('LinkedIn did not return an access token')
    }
    return {
      accessToken: data.access_token,
      ...(data.refresh_token !== undefined ? { refreshToken: data.refresh_token } : {}),
      ...(data.expires_in !== undefined
        ? { expiresAt: new Date(Date.now() + data.expires_in * 1000) }
        : {}),
    }
  }

  /**
   * Renews using a refresh token.
   *
   * NOT exposed as `Provider.refresh`, deliberately. That interface hands over the
   * *access* token, and LinkedIn needs a separate refresh token — which it only
   * issues to apps approved for programmatic refresh in the first place. An
   * unapproved app's access token simply dies at 60 days and the tenant must
   * reauthorise. Wiring this into the refresh runner would make it look handled
   * when it is not. Pinterest has the same shape and the same gap.
   */
  async refreshWithToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const data = await this.#form({ grant_type: 'refresh_token', refresh_token: refreshToken })

    if (data.access_token === undefined) {
      throw new LinkedInOAuthError('LinkedIn refused to refresh the token')
    }
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1000),
    }
  }

  /** The authorising member, via OpenID Connect. `sub` is the person id. */
  async member(accessToken: string): Promise<{ sub: string; name?: string }> {
    const data = await this.#get<{ sub?: string; name?: string }>(
      `${API_BASE}/v2/userinfo`,
      accessToken,
    )
    if (data.sub === undefined) {
      throw new LinkedInOAuthError('LinkedIn did not identify the authorising member')
    }
    return { sub: data.sub, ...(data.name !== undefined ? { name: data.name } : {}) }
  }

  /**
   * Company pages this member administers.
   *
   * Returns an empty list rather than throwing when access is refused: without
   * Community Management approval this call 403s, and that is the expected state
   * for most apps rather than an error worth stopping a connect flow for.
   */
  async organizations(accessToken: string): Promise<Array<{ urn: string; name: string }>> {
    const url = new URL(`${API_BASE}/rest/organizationAcls`)
    url.searchParams.set('q', 'roleAssignee')
    url.searchParams.set('role', 'ADMINISTRATOR')
    url.searchParams.set('state', 'APPROVED')

    let data: { elements?: Array<{ organization?: string }> }
    try {
      data = await this.#get(url.toString(), accessToken, true)
    } catch {
      return []
    }

    const urns = (data.elements ?? [])
      .map((e) => e.organization)
      .filter((u): u is string => u !== undefined)

    // The ACL response carries URNs but no names, so each page needs a second
    // lookup. A failed name lookup falls back to the URN rather than dropping a
    // page the tenant can genuinely post to.
    const named: Array<{ urn: string; name: string }> = []
    for (const urn of urns) {
      const id = urn.split(':').pop() ?? ''
      let name = urn
      try {
        const org = await this.#get<{ localizedName?: string }>(
          `${API_BASE}/rest/organizations/${id}`,
          accessToken,
          true,
        )
        if (org.localizedName !== undefined) name = org.localizedName
      } catch {
        // Keep the URN as the label.
      }
      named.push({ urn, name })
    }
    return named
  }

  async #form(fields: Record<string, string>): Promise<{
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }> {
    const body = new URLSearchParams({
      ...fields,
      client_id: this.#config.appId,
      client_secret: this.#config.appSecret,
    })

    let response: Response
    try {
      response = await this.#fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })
    } catch (cause) {
      throw new LinkedInOAuthError('Could not reach LinkedIn', { cause })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new LinkedInOAuthError(`LinkedIn returned a non-JSON response (HTTP ${response.status})`)
    }
    if (!response.ok) {
      const error = parsed as { error_description?: string; message?: string }
      throw new LinkedInOAuthError(
        `LinkedIn rejected the request: ${error.error_description ?? error.message ?? response.status}`,
      )
    }
    return parsed as { access_token?: string; expires_in?: number }
  }

  async #get<T>(url: string, accessToken: string, versioned = false): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` }
    if (versioned) {
      headers['LinkedIn-Version'] = this.#config.apiVersion ?? '202601'
      headers['X-Restli-Protocol-Version'] = '2.0.0'
    }

    let response: Response
    try {
      response = await this.#fetch(url, { method: 'GET', headers })
    } catch (cause) {
      throw new LinkedInOAuthError('Could not reach LinkedIn', { cause })
    }

    const text = await response.text()
    if (!response.ok) {
      throw new LinkedInOAuthError(`LinkedIn rejected the request (HTTP ${response.status})`)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new LinkedInOAuthError('LinkedIn returned a response that was not JSON')
    }
  }
}

export class LinkedInProvider implements Provider {
  readonly platforms: readonly Platform[] = [LINKEDIN]

  /**
   * Two apps means two registry keys, or the second registration would silently
   * replace the first and one of them would quietly stop working.
   */
  get key(): string {
    return this.#config.organizationAccess === true ? 'linkedin_page' : 'linkedin'
  }

  get displayName(): string {
    return this.#config.organizationAccess === true ? 'LinkedIn Pages' : 'LinkedIn'
  }

  get redirectUri(): string {
    return this.#config.redirectUri
  }

  readonly #config: LinkedInOAuthConfig

  constructor(config: LinkedInOAuthConfig) {
    this.#config = config
  }

  /**
   * The authorising member, plus any company pages they administer.
   *
   * `externalId` is the full URN in both cases. That is what the adapter sends as
   * the post author, and it is also what distinguishes a personal profile from a
   * company page without needing an account-type column — the same trick as
   * Pinterest storing a board id.
   */
  authUrl(state: string): string {
    return buildLinkedInAuthUrl(this.#config, state)
  }

  async exchangeCode(code: string): Promise<AuthorisedCredential> {
    return await new LinkedInOAuth(this.#config).exchangeCode(code)
  }

  async discover(userAccessToken: string): Promise<DiscoveredAccount[]> {
    const oauth = new LinkedInOAuth(this.#config)

    if (this.#config.organizationAccess === true) {
      /**
       * The organisation app has no OpenID Connect, so `/v2/userinfo` would 403.
       * Calling it anyway and catching the failure would work, but it would make
       * every connect slower and log an error that is not one. There is simply no
       * member to discover here.
       */
      const orgs = await oauth.organizations(userAccessToken)
      if (orgs.length === 0) {
        throw new LinkedInOAuthError(
          'This LinkedIn authorisation administers no company pages. Check that the ' +
            'account admins the page, and that Community Management access has actually ' +
            'been GRANTED — while the request is still pending this call returns nothing ' +
            'rather than an error, so it looks like you admin no pages.',
        )
      }
      return orgs.map((org) => ({
        externalId: org.urn,
        platform: LINKEDIN,
        displayName: org.name,
        accessToken: userAccessToken,
      }))
    }

    const member = await oauth.member(userAccessToken)
    return [
      {
        externalId: `urn:li:person:${member.sub}`,
        platform: LINKEDIN,
        displayName: member.name ?? 'LinkedIn profile',
        accessToken: userAccessToken,
      },
    ]
  }
}

export function registerLinkedInProvider(config: LinkedInOAuthConfig): LinkedInProvider {
  const provider = new LinkedInProvider(config)
  registerProvider(provider)
  return provider
}
