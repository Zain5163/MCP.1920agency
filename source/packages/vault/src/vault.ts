import { open, seal, VaultError, type SealContext } from './envelope.ts'

/**
 * The token broker.
 *
 * The load-bearing rule of this project: plaintext credentials are only ever
 * available *inside* a `withCredential` callback. There is deliberately no
 * `getToken()` that returns one, because a function that returns a secret will
 * eventually have its result logged, serialised into an error, or attached to a
 * trace. Making the secret's lifetime a lexical scope is what stops that.
 *
 * Adapters therefore never load a credential — they are handed one.
 */

export interface StoredCredential {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly expiresAt?: Date
  readonly scopes?: readonly string[]
}

export interface CredentialRecord {
  readonly connectionId: string
  readonly tenantId: string
  readonly secretCiphertext: string
  readonly expiresAt: Date | null
}

/** Storage is injected so the vault is testable without a database. */
export interface CredentialStore {
  load(connectionId: string, tenantId: string): Promise<CredentialRecord | null>
  save(record: {
    connectionId: string
    tenantId: string
    secretCiphertext: string
    keyVersion: number
    expiresAt: Date | null
  }): Promise<void>
  markNeedsReauth(connectionId: string, tenantId: string, reason: string): Promise<void>
}

export interface VaultOptions {
  readonly kek: Buffer
  readonly keyVersion: number
  readonly store: CredentialStore
  /** Refresh this long before actual expiry. Default 5 minutes. */
  readonly refreshSkewMs?: number
  readonly now?: () => Date
}

export class NeedsReauthError extends Error {
  readonly connectionId: string
  constructor(connectionId: string, message: string) {
    super(message)
    this.name = 'NeedsReauthError'
    this.connectionId = connectionId
  }
}

export type RefreshFn = (current: StoredCredential) => Promise<StoredCredential>

export class TokenVault {
  readonly #kek: Buffer
  readonly #keyVersion: number
  readonly #store: CredentialStore
  readonly #skewMs: number
  readonly #now: () => Date

  constructor(options: VaultOptions) {
    this.#kek = options.kek
    this.#keyVersion = options.keyVersion
    this.#store = options.store
    this.#skewMs = options.refreshSkewMs ?? 5 * 60 * 1000
    this.#now = options.now ?? (() => new Date())
  }

  async store(
    connectionId: string,
    tenantId: string,
    credential: StoredCredential,
  ): Promise<void> {
    const ctx: SealContext = { tenantId, keyVersion: this.#keyVersion }
    const ciphertext = seal(JSON.stringify(credential), this.#kek, ctx)
    await this.#store.save({
      connectionId,
      tenantId,
      secretCiphertext: ciphertext,
      keyVersion: this.#keyVersion,
      expiresAt: credential.expiresAt ?? null,
    })
  }

  /**
   * Hands a live credential to `fn`, refreshing first if it is at or near expiry.
   *
   * The credential is not returned and must not be captured by the callback. If a
   * refresh is needed and either impossible or unsuccessful, the connection is
   * marked `needs_reauth` and NeedsReauthError is thrown — the user has to
   * reconnect, and retrying will not help.
   */
  async withCredential<T>(
    connectionId: string,
    tenantId: string,
    fn: (credential: StoredCredential) => Promise<T>,
    refresh?: RefreshFn,
  ): Promise<T> {
    const record = await this.#store.load(connectionId, tenantId)
    if (record === null) {
      throw new VaultError(`No credential stored for connection ${connectionId}`)
    }
    // Defence in depth: the store is already scoped by tenant, and the AEAD would
    // reject a mismatch anyway. Checking here turns a crypto failure into a clear one.
    if (record.tenantId !== tenantId) {
      throw new VaultError('Credential tenant mismatch')
    }

    let credential = JSON.parse(
      open(record.secretCiphertext, this.#kek, { tenantId }),
    ) as StoredCredential
    credential = reviveDates(credential)

    if (this.#isExpiring(credential)) {
      if (refresh === undefined || credential.refreshToken === undefined) {
        await this.#store.markNeedsReauth(connectionId, tenantId, 'expired, no refresh available')
        throw new NeedsReauthError(
          connectionId,
          'Credential expired and cannot be refreshed. Reconnect the account.',
        )
      }
      try {
        credential = await refresh(credential)
        await this.store(connectionId, tenantId, credential)
      } catch (cause) {
        await this.#store.markNeedsReauth(connectionId, tenantId, 'refresh failed')
        throw new NeedsReauthError(
          connectionId,
          'Credential refresh failed. Reconnect the account.',
        )
      }
    }

    return await fn(credential)
  }

  #isExpiring(credential: StoredCredential): boolean {
    if (credential.expiresAt === undefined) return false
    return credential.expiresAt.getTime() - this.#skewMs <= this.#now().getTime()
  }
}

/** JSON.parse gives back an ISO string, not a Date. */
function reviveDates(credential: StoredCredential): StoredCredential {
  const raw = credential as StoredCredential & { expiresAt?: string | Date }
  if (raw.expiresAt === undefined) return credential
  return { ...credential, expiresAt: new Date(raw.expiresAt) }
}
