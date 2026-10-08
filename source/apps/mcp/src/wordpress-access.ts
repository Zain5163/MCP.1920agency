import { join } from 'node:path'

import {
  WordPressClient,
  createSafeFetch,
  type RestMode,
  type SafeFetch,
  type WordPressLogin,
} from '@social-publisher/adapters'
import { CONFIG_DIR, optional } from '@social-publisher/config'
import { TenantScope, listProviderAuths, markProviderAuthNeedsReauth, providerAuthCredentialStore, saveProviderAuth } from '@social-publisher/db'
import { TokenVault, parseKey } from '@social-publisher/vault'

import { currentScope } from './context.ts'

/**
 * Where the WordPress tools get their sites and logins from.
 *
 * Unlike Shopify, there is no app secret and no OAuth callback: the site owner
 * creates an Application Password in their own WordPress admin and gives it to
 * wordpress_connect_site. So the local app and the hosted server store sites
 * the same way — encrypted per account in the vault, in the existing
 * provider_auths table (provider "wordpress", one row per site, no migration):
 *
 *   external_user_id   the site address, e.g. "https://www.example.com"
 *   display_name       the site's name
 *   scopes             what the login can do and how to reach the API:
 *                      "role:<role>", "rest:pretty|query", and "woo" when
 *                      WooCommerce is active. No secret, and not the username.
 *   secret_ciphertext  "<username>:<application password>", sealed by the vault
 *                      with the account's id as associated data, so a row copied
 *                      to another account does not decrypt.
 *
 * The only difference between transports is whose account: the hosted server
 * knows it from the request's token; the local app uses the one local account.
 */

export const WORDPRESS_PROVIDER = 'wordpress'

export interface WordPressSite {
  /** The address without https://, e.g. "www.example.com" or "example.com/blog". */
  readonly key: string
  readonly name: string
  /** https://..., no trailing slash. */
  readonly url: string
  readonly roles: readonly string[]
  readonly restMode: RestMode
  /** WooCommerce's REST API was present when the site was connected. */
  readonly woo: boolean
}

export interface WordPressAccess {
  list(): Promise<WordPressSite[]>
  open(selector: string): Promise<{ client: WordPressClient; site: WordPressSite } | { error: string }>
  /** Stores the site and its login, encrypted. Replaces an earlier login for the same site. */
  save(site: Omit<WordPressSite, 'key'>, login: WordPressLogin): Promise<void>
  /** Forgets the login (the ciphertext is wiped, not only flagged). */
  disconnect(selector: string): Promise<WordPressSite | { error: string }>
  /** Where earlier versions of this site's pages, posts and products are saved. */
  backupDir(site: WordPressSite): string
  /** The account's activity log. Must not throw. Never given a secret. */
  record(action: string, detail: Record<string, unknown>): Promise<void>
  /** The SSRF-guarded fetch every request to a user-supplied address goes through. */
  readonly fetch: SafeFetch
}

export const siteKey = (url: string) => url.replace(/^https:\/\//, '')

/** Finds a site by key, address or name, as a user would type it. */
export function findSite(selector: string, sites: readonly WordPressSite[]): WordPressSite | { error: string } {
  const wanted = selector.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const hit = sites.find((s) => s.key === wanted || s.name.toLowerCase() === wanted || s.key.replace(/^www\./, '') === wanted.replace(/^www\./, ''))
  if (hit !== undefined) return hit
  return {
    error:
      sites.length === 0
        ? 'No WordPress site is connected yet. Use wordpress_connect_site with the site address, a username and an Application Password.'
        : `No connected WordPress site called "${selector}". Connected: ${sites.map((s) => `${s.name} (${s.key})`).join(', ')}.`,
  }
}

export function scopesFor(site: Omit<WordPressSite, 'key'>): string[] {
  return [...site.roles.map((r) => `role:${r}`), `rest:${site.restMode}`, ...(site.woo ? ['woo'] : [])]
}

export function siteFromRow(row: { externalUserId: string; displayName: string | null; scopes: readonly string[] }): WordPressSite {
  return {
    key: siteKey(row.externalUserId),
    name: row.displayName ?? siteKey(row.externalUserId),
    url: row.externalUserId,
    roles: row.scopes.filter((s) => s.startsWith('role:')).map((s) => s.slice(5)),
    restMode: row.scopes.includes('rest:query') ? 'query' : 'pretty',
    woo: row.scopes.includes('woo'),
  }
}

/** "<username>:<password>"; WordPress usernames cannot contain a colon, so the first one splits. */
export function splitLogin(pair: string): WordPressLogin {
  const at = pair.indexOf(':')
  if (at <= 0) throw new Error('The stored WordPress login is unreadable. Reconnect the site with wordpress_connect_site.')
  return { username: pair.slice(0, at), password: pair.slice(at + 1) }
}

let vaultInstance: TokenVault | undefined
function vault(): TokenVault {
  if (vaultInstance === undefined) {
    const key = optional('VAULT_MASTER_KEY')
    if (key === undefined) throw new Error('VAULT_MASTER_KEY is not set, so AdsPilot cannot store or read site logins. Add it to the server configuration (SETUP.md).')
    vaultInstance = new TokenVault({ kek: parseKey(key, 'VAULT_MASTER_KEY'), keyVersion: 1, store: providerAuthCredentialStore() })
  }
  return vaultInstance
}

/** The vault-backed access for one account. `tenantId` is resolved per call. */
export function vaultWordPressAccess(options: {
  tenantId: () => Promise<string>
  backupRoot: (tenantId: string) => string
  record: (tenantId: string, action: string, detail: Record<string, unknown>) => Promise<void>
  fetch?: SafeFetch
}): WordPressAccess {
  const fetch = options.fetch ?? createSafeFetch()
  const rows = async (tenantId: string) =>
    (await listProviderAuths(tenantId)).filter((a) => a.provider === WORDPRESS_PROVIDER && !a.needsReauth)

  let lastTenant: string | undefined
  const tenant = async () => (lastTenant = await options.tenantId())

  return {
    fetch,
    list: async () => (await rows(await tenant())).map(siteFromRow),
    open: async (selector) => {
      const tenantId = await tenant()
      const all = await rows(tenantId)
      const site = findSite(selector, all.map(siteFromRow))
      if ('error' in site) return site
      const authId = all.find((a) => a.externalUserId === site.url)!.id
      const client = new WordPressClient({
        siteUrl: site.url,
        restMode: site.restMode,
        fetch,
        // Read from the vault for each request; nothing keeps it afterwards.
        login: async () => await vault().withCredential(authId, tenantId, async (cred) => splitLogin(cred.accessToken)),
      })
      return { client, site }
    },
    save: async (site, login) => {
      const tenantId = await tenant()
      // Row first, then the vault seals the login into it (as the Shopify connection does).
      const auth = await saveProviderAuth({
        tenantId,
        provider: WORDPRESS_PROVIDER,
        externalUserId: site.url,
        displayName: site.name,
        secretCiphertext: '',
        keyVersion: 1,
        scopes: scopesFor(site),
        expiresAt: null,
      })
      await vault().store(auth.id, tenantId, { accessToken: `${login.username}:${login.password.replace(/\s+/g, '')}`, scopes: scopesFor(site) })
    },
    disconnect: async (selector) => {
      const tenantId = await tenant()
      const all = (await listProviderAuths(tenantId)).filter((a) => a.provider === WORDPRESS_PROVIDER)
      const site = findSite(selector, all.map(siteFromRow))
      if ('error' in site) return site
      const row = all.find((a) => a.externalUserId === site.url)!
      // Wipe the sealed login, then flag the row: a disconnected site keeps no usable secret.
      await saveProviderAuth({
        tenantId,
        provider: WORDPRESS_PROVIDER,
        externalUserId: row.externalUserId,
        ...(row.displayName !== null ? { displayName: row.displayName } : {}),
        secretCiphertext: '',
        keyVersion: 1,
        scopes: row.scopes,
        expiresAt: null,
      })
      await markProviderAuthNeedsReauth(tenantId, row.id, 'disconnected by user')
      return site
    },
    backupDir: (site) => join(options.backupRoot(lastTenant ?? 'unknown'), site.key.replace(/[^a-z0-9.-]/gi, '_')),
    record: async (action, detail) => {
      try {
        await options.record(await tenant(), action, detail)
      } catch {
        // An activity-log failure must never be why a change did or did not happen.
      }
    },
  }
}

/** Hosted: each AdsPilot account's own sites, its own backups folder, its own activity log. */
export function hostedWordPressAccess(tenantId: string): WordPressAccess {
  return vaultWordPressAccess({
    tenantId: async () => tenantId,
    backupRoot: (t) => join(optional('WORDPRESS_BACKUP_DIR', join(CONFIG_DIR, 'wordpress-backups'))!, 'tenants', t),
    // Recorded under the request's own account, never the server's first one.
    record: async (t, action, detail) => void (await new TenantScope(t).record('mcp', action, detail)),
  })
}

/** Local (the owner's PC): the one local account. */
export function localWordPressAccess(): WordPressAccess {
  return vaultWordPressAccess({
    tenantId: async () => (await currentScope()).tenantId,
    backupRoot: () => join(CONFIG_DIR, 'wordpress-backups'),
    record: async (t, action, detail) => void (await new TenantScope(t).record('mcp', action, detail)),
  })
}
