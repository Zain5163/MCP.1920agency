import type { Platform } from '@social-publisher/core'

/**
 * The connector contract — the other half of the adapter story.
 *
 * `PlatformAdapter` answers "how do I publish to this platform". A `Provider`
 * answers "how does someone authorise, and what accounts does that authorisation
 * reach". Those are genuinely different problems: one Meta login yields many
 * Facebook Pages and Instagram accounts, and the publishing code does not care
 * how they arrived.
 *
 * This interface exists because the architecture test caught the web app
 * hardcoding `facebook_page` and `instagram` while listing accounts. The fix is
 * not to allow the exception — it is to give account discovery the same
 * platform-agnostic shape publishing already has.
 *
 * Adding a platform should therefore be: one Provider, one adapter per surface it
 * exposes, one capability record. Nothing in the UI, queue, vault or publisher.
 */

/** One account an authorisation can reach. */
export interface DiscoveredAccount {
  /** The platform's own id for this account. */
  readonly externalId: string
  readonly platform: Platform
  readonly displayName: string
  /**
   * The credential for publishing to this specific account. For Meta this is the
   * Page token; other providers may reuse the user token.
   */
  readonly accessToken: string
  /**
   * Accounts that come along with this one. A Facebook Page carries its linked
   * Instagram account, and connecting them separately would be a worse
   * experience for no benefit.
   */
  readonly linked?: readonly DiscoveredAccount[]
}

/** What an authorisation yields, once the redirect has been exchanged. */
export interface AuthorisedCredential {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly expiresAt?: Date
}

export interface Provider {
  /** Stable key stored on ProviderAuth: 'meta', 'linkedin', 'google'. */
  readonly key: string
  /** Human name, for the UI. */
  readonly displayName: string
  /** Which platforms an authorisation with this provider can yield. */
  readonly platforms: readonly Platform[]
  /**
   * Where this provider sends the browser back to. The connect command needs the
   * port and path to know what to listen on, and each provider uses its own so
   * that one misconfigured redirect cannot break the others.
   */
  readonly redirectUri: string

  /**
   * Where to send someone to authorise.
   *
   * This and `exchangeCode` were added after three platforms ended up with
   * working adapters that nobody could connect: discovery was provider-driven
   * from the start, authorisation never was, so the connect command only knew
   * how to run Meta's dialog. Putting both on the provider is what makes
   * `connect <provider>` generic instead of a switch on platform names.
   */
  authUrl(state: string): string

  /** Turns the code from the redirect into a usable credential. */
  exchangeCode(code: string): Promise<AuthorisedCredential>

  /** Every account this authorisation can reach, connected or not. */
  discover(userAccessToken: string): Promise<DiscoveredAccount[]>

  /**
   * Extends a credential that is approaching expiry.
   *
   * Optional, because platforms differ fundamentally here. A Facebook Page token
   * lives as long as the app stays installed and has nothing to refresh. A
   * Threads token dies after 60 days and **must** be refreshed inside a window —
   * miss it and the connection is gone, needing full reauthorisation.
   *
   * A provider that omits this is declaring "my credentials do not expire on
   * their own", which the refresh runner treats as nothing to do rather than as
   * a failure.
   */
  refresh?(currentToken: string): Promise<{ accessToken: string; expiresAt: Date }>
}

const REGISTRY = new Map<string, Provider>()

export function registerProvider(provider: Provider): void {
  REGISTRY.set(provider.key, provider)
}

export function providerFor(key: string): Provider | undefined {
  return REGISTRY.get(key)
}

export function allProviders(): Provider[] {
  return [...REGISTRY.values()]
}

/** Flattens an account and anything linked to it, for storing them together. */
export function flattenAccounts(
  accounts: readonly DiscoveredAccount[],
): DiscoveredAccount[] {
  const out: DiscoveredAccount[] = []
  for (const account of accounts) {
    out.push(account)
    if (account.linked !== undefined) out.push(...flattenAccounts(account.linked))
  }
  return out
}
