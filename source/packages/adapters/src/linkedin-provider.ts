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
 * Discovery therefore treats organisations as *optional*. A tenant with only
 * member access gets their personal profile and no error; one with Community
 * Management access also gets every page they administer. A 403 on the
 * organisation call is a missing approval, not a fault, so it is swallowed
 * rather than failing the whole connect flow.
 */

const AUTH_BASE = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const API_BASE = 'https://api.linkedin.com'
const LINKEDIN: Platform = 'linkedin'

/** Granted by the self-serve "Share on LinkedIn" product. */
export const LINKEDIN_MEMBER_SCOPES = ['openid', 'profile', 'w_member_social'] as const

/** Requires Community Management API approval. Requesting them without it fails the whole dialog. */
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
   * Only set this once LinkedIn has actually approved Community Management for
   * the app. Asking for organisation scopes without approval does not degrade
   * gracefully — the authorisation dialog refuses outright, so the tenant cannot
   * connect their personal profile either.
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

export function linkedInScopes(config: LinkedInOAuthConfig): string[] {
  return config.organizationAccess === true
    ? [...LINKEDIN_MEMBER_SCOPES, ...LINKEDIN_ORGANIZATION_SCOPES]
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
  readonly key = 'linkedin'
  readonly displayName = 'LinkedIn'
  readonly platforms: readonly Platform[] = [LINKEDIN]

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

    const member = await oauth.member(userAccessToken)
    const accounts: DiscoveredAccount[] = [
      {
        externalId: `urn:li:person:${member.sub}`,
        platform: LINKEDIN,
        displayName: member.name ?? 'LinkedIn profile',
        accessToken: userAccessToken,
      },
    ]

    for (const org of await oauth.organizations(userAccessToken)) {
      accounts.push({
        externalId: org.urn,
        platform: LINKEDIN,
        displayName: org.name,
        // Organisations post with the same member token; LinkedIn authorises by
        // the ACL, not by a per-page token the way Meta does.
        accessToken: userAccessToken,
      })
    }

    return accounts
  }
}

export function registerLinkedInProvider(config: LinkedInOAuthConfig): LinkedInProvider {
  const provider = new LinkedInProvider(config)
  registerProvider(provider)
  return provider
}
