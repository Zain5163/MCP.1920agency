import type { Connection } from '@social-publisher/core'
import type { TargetSpec } from '@social-publisher/publisher'
import type { RefreshFn, StoredCredential, TokenVault } from '@social-publisher/vault'

/**
 * A target's `withCredential`: the token from the vault, and a way to renew it
 * while the publish is still running.
 *
 * The vault renews an expiring token on the way in, and only then. A YouTube
 * upload can outlast the hour a Google token lives: without a renewal it met a
 * 401 partway, started again from byte 0, and past an hour could never finish.
 * `renew` is made here, inside the vault's callback, so the token still never
 * exists outside one.
 *
 * - It renews from the credential held now, not the one the vault handed over,
 *   so a second renewal starts from the first one's result.
 * - It merges what the refresh returns, as the vault does. A refresh answers
 *   only what changed; replacing the credential with that would drop the
 *   refresh token, and the authorisation's own end (Google's is "none", which
 *   must not become the token's hour).
 * - A renewed token that cannot be saved is logged, nothing more. It is valid
 *   either way, failing the upload over a database hiccup would throw the work
 *   away, and the next publish simply renews again.
 * - A refresh failure reaches the adapter unchanged and marks nothing. The
 *   adapter tells a blip from a revoked grant; marking the connection here
 *   would turn a blip into a reconnect.
 *
 * Absent when the adapter renews nothing or the credential holds no refresh
 * token, which leaves every other platform exactly as before.
 *
 * The same function exists in each app (cli, mcp, web, worker): an app cannot
 * import another, and each has a test holding it to this contract.
 */
export function credentialFor(
  vault: Pick<TokenVault, 'withCredential' | 'store'>,
  connection: Pick<Connection, 'id' | 'tenantId' | 'displayName'>,
  refresh: RefreshFn | undefined,
  log: (message: string) => void,
): TargetSpec['withCredential'] {
  return async (fn) =>
    await vault.withCredential(
      connection.id,
      connection.tenantId,
      async (cred) => {
        let current: StoredCredential = cred
        const renew =
          refresh === undefined || cred.refreshToken === undefined
            ? undefined
            : async (): Promise<string> => {
                current = { ...current, ...(await refresh(current)) }
                try {
                  await vault.store(connection.id, connection.tenantId, current)
                } catch (error) {
                  log(
                    `renewed the token for ${connection.displayName} but could not save it ` +
                      `(${error instanceof Error ? error.message : String(error)}); carrying on with it, ` +
                      'and the next publish renews again',
                  )
                }
                return current.accessToken
              }
        return await fn(cred.accessToken, renew)
      },
      // Renews an expiring token on the way in, as before.
      refresh,
    )
}
