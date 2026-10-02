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
  /** When this access token stops working. Drives refresh-on-read. */
  readonly expiresAt?: Date
  readonly scopes?: readonly string[]
  /**
   * When the AUTHORISATION ends, as distinct from the access token.
   *
   * For most providers they are the same moment: a Threads or LinkedIn token is
   * the authorisation, and it dies at 60 days. Google splits them. Its access
   * token lasts an hour and is renewed with a refresh token that lives until it
   * is revoked. Writing the hour into the expiry column would make the refresh
   * runner declare the whole authorisation dead an hour after connecting, and
   * the monitor raise a critical alert on every run.
   *
   * So when this is present it is what the column records: a date, or `null`
   * for "no known end". Absent means the column follows `expiresAt`, exactly as
   * before this field existed.
   */
  readonly authorisationExpiresAt?: Date | null
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
  /**
   * `cause` carries the refresh failure, when there was one, so whoever reports
   * this can say "Google revoked the token" rather than only "reconnect".
   */
  constructor(connectionId: string, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
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
      // The column means "when this authorisation dies". See authorisationExpiresAt.
      expiresAt:
        credential.authorisationExpiresAt !== undefined
          ? credential.authorisationExpiresAt
          : (credential.expiresAt ?? null),
    })
  }

  /**
   * Hands a live credential to `fn`, refreshing first if it is at or near expiry.
   *
   * The credential is not returned and must not be captured by the callback. If a
   * refresh is needed and either impossible or refused, the connection is
   * marked `needs_reauth` and NeedsReauthError is thrown — the user has to
   * reconnect, and retrying will not help.
   *
   * A refresh that fails *transiently* — the error carries `failureClass:
   * 'transient'`, as a PublishError does — is re-thrown as it is and marks
   * nothing. With an hourly token, one network blip during a refresh would
   * otherwise disable a working channel until someone reconnected it. The class
   * is read by duck typing because the vault deliberately depends on nothing,
   * core included.
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
      let refreshed: StoredCredential
      try {
        refreshed = await refresh(credential)
      } catch (cause) {
        if (isTransient(cause)) throw cause
        await this.#store.markNeedsReauth(connectionId, tenantId, 'refresh failed')
        throw new NeedsReauthError(
          connectionId,
          'Credential refresh failed. Reconnect the account.',
          { cause },
        )
      }
      /**
       * Merged, not replaced. A refresher returns what changed — usually a new
       * access token and expiry — and replacing the whole credential with that
       * would drop the refresh token it was renewed with, so the next refresh,
       * an hour later, would have nothing to work with.
       *
       * Stored outside the try on purpose: the platform has already said yes,
       * so a database hiccup while saving is not a reason to mark a working
       * account dead.
       */
      credential = { ...credential, ...refreshed }
      await this.store(connectionId, tenantId, credential)
    }

    return await fn(credential)
  }

  #isExpiring(credential: StoredCredential): boolean {
    if (credential.expiresAt === undefined) return false
    return credential.expiresAt.getTime() - this.#skewMs <= this.#now().getTime()
  }
}

/** JSON.parse gives back an ISO string, not a Date. A stored null stays null. */
function reviveDates(credential: StoredCredential): StoredCredential {
  const raw = credential as StoredCredential & {
    expiresAt?: string | Date
    authorisationExpiresAt?: string | Date | null
  }
  return {
    ...credential,
    ...(raw.expiresAt !== undefined ? { expiresAt: new Date(raw.expiresAt) } : {}),
    ...(raw.authorisationExpiresAt !== undefined
      ? {
          authorisationExpiresAt:
            raw.authorisationExpiresAt === null ? null : new Date(raw.authorisationExpiresAt),
        }
      : {}),
  }
}

/** Whether a refresh failure says it is worth trying again later. */
function isTransient(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { failureClass?: unknown }).failureClass === 'transient'
  )
}
