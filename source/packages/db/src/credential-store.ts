import { db } from './client.ts'

/**
 * Prisma-backed storage for the token vault.
 *
 * Lives here rather than being repeated in each app because the CLI, the worker,
 * the MCP server and the web app all need it — and because this is the one place
 * allowed to read `connections.secret_ciphertext`. Four copies of that query is
 * four places for the vault boundary to be quietly broken.
 *
 * Note it returns ciphertext only. Decryption happens inside the vault, and the
 * plaintext never leaves a `withCredential` callback.
 */
export function prismaCredentialStore() {
  return {
    async load(connectionId: string, tenantId: string) {
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

    async save(record: {
      connectionId: string
      tenantId: string
      secretCiphertext: string
      keyVersion: number
      expiresAt: Date | null
    }) {
      await db().connection.update({
        where: { id: record.connectionId },
        data: {
          secretCiphertext: record.secretCiphertext,
          keyVersion: record.keyVersion,
          expiresAt: record.expiresAt,
        },
      })
    },

    async markNeedsReauth(connectionId: string, tenantId: string, reason: string) {
      // updateMany rather than update: scoped by tenant as well as id, so a wrong
      // tenant silently affects nothing instead of touching another tenant's row.
      await db().connection.updateMany({
        where: { id: connectionId, tenantId },
        data: { needsReauth: true, reauthReason: reason },
      })
    },
  }
}

/**
 * The same interface, backed by `provider_auths` instead of `connections`.
 *
 * Needed because a provider authorisation holds a credential too — the long-lived
 * user token — and it is not a connection. An earlier version stored it through
 * the connection store, which silently had nothing to update: the row was created
 * and the token was never saved, so account discovery failed later with
 * "No credential stored".
 *
 * Two explicit stores rather than one that guesses which table an id belongs to:
 * guessing costs an extra query on every credential read, and quietly does the
 * wrong thing if an id ever collides.
 */
export function providerAuthCredentialStore() {
  return {
    async load(providerAuthId: string, tenantId: string) {
      const row = await db().providerAuth.findFirst({
        where: { id: providerAuthId, tenantId },
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

    async save(record: {
      connectionId: string
      tenantId: string
      secretCiphertext: string
      keyVersion: number
      expiresAt: Date | null
    }) {
      await db().providerAuth.update({
        where: { id: record.connectionId },
        data: {
          secretCiphertext: record.secretCiphertext,
          keyVersion: record.keyVersion,
          expiresAt: record.expiresAt,
        },
      })
    },

    async markNeedsReauth(providerAuthId: string, tenantId: string, reason: string) {
      await db().providerAuth.updateMany({
        where: { id: providerAuthId, tenantId },
        data: { needsReauth: true, reauthReason: reason },
      })
    },
  }
}
