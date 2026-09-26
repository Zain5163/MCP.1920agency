import type { Platform } from '@social-publisher/core'

import { FacebookOAuth, buildAuthUrl, type OAuthConfig } from './facebook-oauth.ts'
import {
  registerProvider,
  type AuthorisedCredential,
  type DiscoveredAccount,
  type Provider,
} from './provider.ts'

/**
 * Meta as a provider: one authorisation, many Facebook Pages, and the Instagram
 * account linked to each.
 *
 * All Meta-specific knowledge about *discovering* accounts lives here, so the
 * dashboard and MCP server can list and connect accounts without naming a
 * platform. Adding LinkedIn means writing a sibling of this file and nothing else.
 */

const FACEBOOK: Platform = 'facebook_page'
const INSTAGRAM: Platform = 'instagram'

export class MetaProvider implements Provider {
  readonly key = 'meta'
  readonly displayName = 'Facebook & Instagram'
  readonly platforms: readonly Platform[] = [FACEBOOK, INSTAGRAM]

  get redirectUri(): string {
    return this.#config.redirectUri
  }

  readonly #config: OAuthConfig

  constructor(config: OAuthConfig) {
    this.#config = config
  }

  authUrl(state: string): string {
    return buildAuthUrl(this.#config, state)
  }

  /**
   * Meta issues a short-lived token first, so this exchanges twice. Skipping the
   * second step gives a credential that dies in about an hour — which looks
   * like a working connect until the next day.
   */
  async exchangeCode(code: string): Promise<AuthorisedCredential> {
    const oauth = new FacebookOAuth(this.#config)
    const short = await oauth.exchangeCode(code)
    const long = await oauth.exchangeForLongLived(short.accessToken)
    return {
      accessToken: long.accessToken,
      ...(long.expiresAt !== undefined ? { expiresAt: long.expiresAt } : {}),
    }
  }

  async discover(userAccessToken: string): Promise<DiscoveredAccount[]> {
    const oauth = new FacebookOAuth(this.#config)
    const pages = await oauth.listPages(userAccessToken)

    return pages.map((page) => ({
      externalId: page.id,
      platform: FACEBOOK,
      displayName: page.name,
      accessToken: page.accessToken,
      /**
       * Instagram publishes with the PAGE token, so it is linked rather than a
       * separate authorisation. Presenting it as its own thing to connect would
       * imply a second sign-in that does not exist.
       */
      ...(page.instagramAccountId !== undefined
        ? {
            linked: [
              {
                externalId: page.instagramAccountId,
                platform: INSTAGRAM,
                displayName: `${page.name} (Instagram)`,
                accessToken: page.accessToken,
              },
            ],
          }
        : {}),
    }))
  }
}

/** Registers Meta. Called once at startup by anything that connects accounts. */
export function registerMetaProvider(config: OAuthConfig): MetaProvider {
  const provider = new MetaProvider(config)
  registerProvider(provider)
  return provider
}
