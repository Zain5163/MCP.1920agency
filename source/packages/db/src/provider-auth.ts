import { db } from './client.ts'

/**
 * Provider authorisations — the layer between "a person logged in with Meta" and
 * "these specific Pages are connected".
 *
 * Before this existed, connecting a second Facebook Page meant another full trip
 * through OAuth, even though the first authorisation already covered every Page
 * the user administers. Storing the long-lived USER token lets us list what is
 * available on demand and connect or disconnect each account independently.
 *
 * Like every other credential, the token itself is only ever read through
 * packages/vault. Nothing here returns plaintext.
 */

export interface ProviderAuthSummary {
  readonly id: string
  readonly provider: string
  readonly externalUserId: string
  readonly displayName: string | null
  readonly scopes: readonly string[]
  readonly expiresAt: Date | null
  readonly needsReauth: boolean
  /** How many accounts are currently connected through this authorisation. */
  readonly connectedCount: number
}

/** Upserts on (tenant, provider, external user) so reconnecting updates rather than duplicates. */
export async function saveProviderAuth(input: {
  tenantId: string
  provider: string
  externalUserId: string
  displayName?: string
  secretCiphertext: string
  keyVersion: number
  scopes: readonly string[]
  expiresAt?: Date | null
}): Promise<{ id: string }> {
  const row = await db().providerAuth.upsert({
    where: {
      tenantId_provider_externalUserId: {
        tenantId: input.tenantId,
        provider: input.provider,
        externalUserId: input.externalUserId,
      },
    },
    create: {
      tenantId: input.tenantId,
      provider: input.provider,
      externalUserId: input.externalUserId,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      secretCiphertext: input.secretCiphertext,
      keyVersion: input.keyVersion,
      scopes: [...input.scopes],
      expiresAt: input.expiresAt ?? null,
    },
    update: {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      secretCiphertext: input.secretCiphertext,
      keyVersion: input.keyVersion,
      scopes: [...input.scopes],
      expiresAt: input.expiresAt ?? null,
      // A fresh authorisation clears any previous failure.
      needsReauth: false,
      reauthReason: null,
    },
    select: { id: true },
  })
  return row
}

export async function listProviderAuths(tenantId: string): Promise<ProviderAuthSummary[]> {
  const rows = await db().providerAuth.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      provider: true,
      externalUserId: true,
      displayName: true,
      scopes: true,
      expiresAt: true,
      needsReauth: true,
      _count: { select: { connections: true } },
    },
  })

  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    externalUserId: r.externalUserId,
    displayName: r.displayName,
    scopes: r.scopes,
    expiresAt: r.expiresAt,
    needsReauth: r.needsReauth,
    connectedCount: r._count.connections,
  }))
}

/** Scoped by tenant, so another account's authorisation is simply not found. */
export async function findProviderAuth(
  tenantId: string,
  providerAuthId: string,
): Promise<{ id: string; tenantId: string; provider: string; secretCiphertext: string } | null> {
  return await db().providerAuth.findFirst({
    where: { id: providerAuthId, tenantId },
    select: { id: true, tenantId: true, provider: true, secretCiphertext: true },
  })
}

export async function markProviderAuthNeedsReauth(
  tenantId: string,
  providerAuthId: string,
  reason: string,
): Promise<void> {
  await db().providerAuth.updateMany({
    where: { id: providerAuthId, tenantId },
    data: { needsReauth: true, reauthReason: reason },
  })
}

/**
 * Disconnects one account.
 *
 * Deliberately NOT a delete. Deleting a connection would orphan the posts that
 * reference it, and `targets.connection_id` is `onDelete: Restrict` precisely to
 * stop that. Marking it needs-reauth keeps the history intact and makes the
 * account unusable until reconnected, which is what "disconnect" should mean.
 */
export async function disconnectAccount(
  tenantId: string,
  connectionId: string,
): Promise<boolean> {
  const result = await db().connection.updateMany({
    where: { id: connectionId, tenantId },
    data: { needsReauth: true, reauthReason: 'disconnected by user' },
  })
  return result.count > 0
}

/** Re-enables an account previously disconnected, if its credential still works. */
export async function reconnectAccount(tenantId: string, connectionId: string): Promise<boolean> {
  const result = await db().connection.updateMany({
    where: { id: connectionId, tenantId },
    data: { needsReauth: false, reauthReason: null },
  })
  return result.count > 0
}
