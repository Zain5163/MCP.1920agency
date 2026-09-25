import {
  FacebookPageAdapter,
  InstagramAdapter,
  ThreadsAdapter,
  PinterestAdapter,
  LinkedInAdapter,
} from '@social-publisher/adapters'
import { optional, required } from '@social-publisher/config'
import { TenantScope, db, prismaCredentialStore } from '@social-publisher/db'
import { PublishService, type TargetSpec } from '@social-publisher/publisher'
import { TokenVault, parseKey } from '@social-publisher/vault'
import type { Connection } from '@social-publisher/core'

/**
 * Wiring shared by every MCP tool.
 *
 * Two boundaries are enforced here rather than trusted to each tool:
 *
 *   - **Tenancy.** Tools receive a TenantScope, never a raw database client. Every
 *     query is scoped to one account by construction, so a tool cannot reach
 *     another tenant's data even by mistake.
 *   - **Credentials.** The only way to a token is `targetFor`, which hands it to an
 *     adapter inside a callback. No tool has a way to obtain plaintext.
 */

let service: PublishService | undefined
let vault: TokenVault | undefined

export function publishService(): PublishService {
  if (service === undefined) {
    const apiVersion = optional('META_API_VERSION', 'v25.0')!
    // Signs every call with appsecret_proof. Required when the Meta app has
    // "Require app secret" enabled, harmless otherwise.
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
 * The scope this MCP session acts within.
 *
 * Today the server runs locally over stdio for a single operator, so it resolves
 * the one tenant. When the server moves to HTTP this becomes "resolve the tenant
 * from the request's token" — and because every tool already takes a TenantScope
 * rather than reaching for the database, that change lands here and nowhere else.
 */
export async function currentScope(): Promise<TenantScope> {
  const tenant = await db().tenant.findFirst({ orderBy: { createdAt: 'asc' } })
  if (tenant === null) {
    throw new Error(
      'No account is set up yet. Run the connect command in source/apps/cli to link a social account.',
    )
  }
  return new TenantScope(tenant.id)
}

export async function loadConnections(scope: TenantScope): Promise<Connection[]> {
  const rows = await scope.connections()
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
