import { FacebookPageAdapter, InstagramAdapter } from '@social-publisher/adapters'
import { optional, required } from '@social-publisher/config'
import { db } from '@social-publisher/db'
import { PublishService, type TargetSpec } from '@social-publisher/publisher'
import { TokenVault, parseKey } from '@social-publisher/vault'
import type { Connection } from '@social-publisher/core'

/**
 * Wiring shared by every MCP tool.
 *
 * The vault is constructed once and the tools only ever reach a credential through
 * `targetFor`, which hands it to the adapter inside a callback. No tool has a way
 * to obtain a plaintext token, which is the property the whole design rests on.
 */

let service: PublishService | undefined
let vault: TokenVault | undefined

export function publishService(): PublishService {
  if (service === undefined) {
    const apiVersion = optional('META_API_VERSION', 'v25.0')!
    // Signs every call with appsecret_proof. Required when the Meta app has
    // "Require app secret" enabled, and harmless when it does not.
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
      store: {
        async load(connectionId, tenantId) {
          const row = await db().connection.findFirst({
            where: { id: connectionId, tenantId },
            select: { id: true, tenantId: true, secretCiphertext: true, expiresAt: true },
          })
          return row === null
            ? null
            : {
                connectionId: row.id,
                tenantId: row.tenantId,
                secretCiphertext: row.secretCiphertext,
                expiresAt: row.expiresAt,
              }
        },
        async save(record) {
          await db().connection.update({
            where: { id: record.connectionId },
            data: {
              secretCiphertext: record.secretCiphertext,
              keyVersion: record.keyVersion,
              expiresAt: record.expiresAt,
            },
          })
        },
        async markNeedsReauth(connectionId, tenantId, reason) {
          await db().connection.updateMany({
            where: { id: connectionId, tenantId },
            data: { needsReauth: true, reauthReason: reason },
          })
        },
      },
    })
  }
  return vault
}

/** The single tenant, created on first connect. */
export async function currentTenant(): Promise<{ id: string; name: string }> {
  const tenant = await db().tenant.findFirst({ orderBy: { createdAt: 'asc' } })
  if (tenant === null) {
    throw new Error('No accounts connected yet. Run `pnpm connect` in source/apps/cli first.')
  }
  return { id: tenant.id, name: tenant.name }
}

export async function loadConnections(tenantId: string): Promise<Connection[]> {
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

/** Binds a connection to its vault-held credential without ever exposing the token. */
export function targetFor(connection: Connection): TargetSpec {
  return {
    connection,
    withCredential: async (fn) =>
      await tokenVault().withCredential(connection.id, connection.tenantId, async (cred) =>
        await fn(cred.accessToken),
      ),
  }
}
