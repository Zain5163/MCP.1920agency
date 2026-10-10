import 'server-only'

import {
  FacebookPageAdapter,
  InstagramAdapter,
  ThreadsAdapter,
  PinterestAdapter,
  LinkedInAdapter,
  YouTubeAdapter,
  googleProviderConfigFromEnv,
  providerFor as lookupProvider,
  registerGoogleProvider,
  registerMetaProvider,
  youTubeOptionsFromEnv,
  type Provider,
} from '@social-publisher/adapters'
import { oauthRedirectUri, optional, required } from '@social-publisher/config'
import type { Connection } from '@social-publisher/core'
import {
  TenantScope,
  db,
  prismaCredentialStore,
  providerAuthCredentialStore,
} from '@social-publisher/db'
import { MediaStore } from '@social-publisher/media'
import { PublishService, type TargetSpec } from '@social-publisher/publisher'
import { TokenVault, parseKey } from '@social-publisher/vault'

import { credentialFor } from './credential'

/**
 * Server-side wiring for the web app.
 *
 * `server-only` at the top is load-bearing: it makes the build fail if any of this
 * is ever imported into a client component, which would ship the vault key and the
 * Meta app secret to the browser.
 */

let service: PublishService | undefined
let vault: TokenVault | undefined

export function publishService(): PublishService {
  if (service === undefined) {
    const apiVersion = optional('META_API_VERSION', 'v25.0')!
    const appSecret = required('META_APP_SECRET')
    service = new PublishService([
      new FacebookPageAdapter({ apiVersion, appSecret }),
      new InstagramAdapter({ apiVersion, appSecret }),
      // Threads uses its own API host and its own token, so it takes no Meta config.
      new ThreadsAdapter(),
      // Pinterest uses its own API and its own token, so no Meta config either.
      new PinterestAdapter(),
      // LinkedIn uses its own API, its own token and its own version header.
      new LinkedInAdapter(),
      // Google's token and settings. Uploads stay private, and are reported as
      // private, until YOUTUBE_UPLOADS_AUDITED says the API audit has passed.
      new YouTubeAdapter(youTubeOptionsFromEnv((key) => optional(key))),
    ])
  }
  return service
}

export function tokenVault(): TokenVault {
  if (vault === undefined) {
    vault = new TokenVault({
      kek: parseKey(required('VAULT_MASTER_KEY'), 'VAULT_MASTER_KEY'),
      keyVersion: 1,
      store: prismaCredentialStore(),
    })
  }
  return vault
}

/**
 * Providers, registered once.
 *
 * Registration is the single place a platform is named for account discovery.
 * Adding one means a line here and a provider file — nothing in the UI.
 */
let providersReady = false

function ensureProviders(): void {
  if (providersReady) return
  registerMetaProvider({
    appId: required('META_APP_ID'),
    appSecret: required('META_APP_SECRET'),
    redirectUri: oauthRedirectUri('META_REDIRECT_URI'),
    apiVersion: optional('META_API_VERSION', 'v25.0')!,
  })
  // Optional: only when a Google client is configured. Without it a stored
  // Google authorisation simply has no provider here, and says so.
  const google = googleProviderConfigFromEnv((key) => optional(key))
  if (google !== undefined) registerGoogleProvider(google)
  providersReady = true
}

export function providerFor(key: string): Provider | undefined {
  ensureProviders()
  return lookupProvider(key)
}

/**
 * A separate vault for provider authorisations, because their credential lives in
 * a different table. Sharing the connection vault silently wrote nothing.
 */
let authVault: TokenVault | undefined

export function providerAuthVault(): TokenVault {
  if (authVault === undefined) {
    authVault = new TokenVault({
      kek: parseKey(required('VAULT_MASTER_KEY'), 'VAULT_MASTER_KEY'),
      keyVersion: 1,
      store: providerAuthCredentialStore(),
    })
  }
  return authVault
}

export function mediaStore(): MediaStore {
  return new MediaStore({
    supabaseUrl: required('SUPABASE_URL'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    bucket: optional('SUPABASE_STORAGE_BUCKET', 'media')!,
  })
}

export async function currentTenantId(): Promise<string> {
  const tenant = await db().tenant.findFirst({ orderBy: { createdAt: 'asc' } })
  if (tenant === null) throw new Error('No accounts connected yet. Run the connect command first.')
  return tenant.id
}

/**
 * Every request works through a scope rather than the raw client, so a page or
 * action cannot read another account's data even by mistake.
 */
export function scope(tenantId: string): TenantScope {
  return new TenantScope(tenantId)
}

export async function listConnections(tenantId: string): Promise<Connection[]> {
  const rows = await scope(tenantId).connections()
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    platform: r.platform,
    platformAccountId: r.platformAccountId,
    displayName: r.displayName,
    credentialSource: r.credentialSource,
    scopes: r.scopes,
    needsReauth: r.needsReauth,
    ...('providerAuth' in r && r.providerAuth !== null && r.providerAuth !== undefined
      ? { providerKey: (r.providerAuth as { provider: string }).provider }
      : {}),
    ...(r.expiresAt !== null ? { expiresAt: r.expiresAt } : {}),
  }))
}

/**
 * Binds a connection to its credential without exposing the token to callers.
 *
 * The adapter's refresh function goes along, so an hour-long token is renewed
 * on the way in instead of the connection being marked dead, and again
 * mid-upload when the adapter asks (see credential.ts). Undefined for every
 * adapter whose tokens do not renew, which is exactly the old behaviour.
 */
export function targetFor(connection: Connection): TargetSpec {
  const adapter = publishService().adapterFor(connection.platform)
  return {
    connection,
    withCredential: credentialFor(
      tokenVault(),
      connection,
      adapter?.refreshCredential?.bind(adapter),
      (message) => console.error(`[publish] ${message}`),
    ),
  }
}
