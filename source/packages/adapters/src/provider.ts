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
  /** When the access token stops working. */
  readonly expiresAt?: Date
  /**
   * The scopes the person actually granted, when the provider reports them.
   *
   * Google lets people untick individual permissions, so what was requested is
   * not what was granted. Storing the requested list would make a connection
   * look capable of something it is not. Absent means the provider does not
   * say, and the requested scopes are the best record there is.
   */
  readonly grantedScopes?: readonly string[]
  /**
   * The provider's stable id for the person who authorised, when it has one
   * (OpenID `sub`). Keys the stored authorisation, so reconnecting updates it
   * rather than adding a duplicate. Absent means the first discovered account
   * stands in, as it always has.
   */
  readonly externalUserId?: string
  /** A human label for the authorisation, e.g. the email that signed in. */
  readonly accountLabel?: string
  /**
   * When the authorisation itself ends, if that differs from `expiresAt`.
   * `null` means no known end: Google's access token lasts an hour, but the
   * refresh token behind it lives until it is revoked. Absent means
   * `expiresAt` is the authorisation's end too, which is true for every
   * provider that has no refresh token.
   */
  readonly authorisationExpiresAt?: Date | null
}

/** Options for building the authorise URL. */
export interface AuthUrlOptions {
  /**
   * Which of the provider's products to ask for, by bundle name, e.g. the
   * YouTube bundle of a Google connection. Providers with a single fixed set of
   * scopes ignore this. Empty or absent means the provider's default.
   */
  readonly scopeBundles?: readonly string[]
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
   *
   * `options` is how a provider with several products asks for only the ones
   * being connected. A provider is free to ignore it.
   */
  authUrl(state: string, options?: AuthUrlOptions): string

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

  /**
   * Renews a credential using its refresh token.
   *
   * Separate from `refresh` because that one is handed only the access token,
   * which is all Threads and Instagram need, and a refresh-token provider such
   * as Google cannot work with it. This one receives the whole stored
   * credential and returns what changed; the vault merges the result, so a
   * provider that issues no new refresh token keeps the old one.
   *
   * It has the shape of the vault's refresh function, so it can be passed
   * straight to `withCredential` and renewal happens on read.
   */
  refreshCredential?(current: {
    readonly accessToken: string
    readonly refreshToken?: string
    readonly expiresAt?: Date
  }): Promise<{ readonly accessToken: string; readonly refreshToken?: string; readonly expiresAt: Date }>

  /**
   * What to tell someone whose authorisation reached no postable account, in
   * this provider's own terms — for Google, that the account may have no
   * channel. Without it the connect command can only say "nothing found".
   */
  readonly noAccountsHint?: string
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
