import 'server-only'

import { FacebookPageAdapter, InstagramAdapter } from '@social-publisher/adapters'
import { optional, required } from '@social-publisher/config'
import type { Connection } from '@social-publisher/core'
import { db, prismaCredentialStore } from '@social-publisher/db'
import { MediaStore } from '@social-publisher/media'
import { PublishService, type TargetSpec } from '@social-publisher/publisher'
import { TokenVault, parseKey } from '@social-publisher/vault'

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

export async function listConnections(tenantId: string): Promise<Connection[]> {
  const rows = await db().connection.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    platform: r.platform,
    platformAccountId: r.platformAccountId,
    displayName: r.displayName,
    credentialSource: r.credentialSource,
    scopes: r.scopes,
    needsReauth: r.needsReauth,
    ...(r.expiresAt !== null ? { expiresAt: r.expiresAt } : {}),
  }))
}

/** Binds a connection to its credential without exposing the token to callers. */
export function targetFor(connection: Connection): TargetSpec {
  return {
    connection,
    withCredential: async (fn) =>
      await tokenVault().withCredential(connection.id, connection.tenantId, async (cred) =>
        await fn(cred.accessToken),
      ),
  }
}
