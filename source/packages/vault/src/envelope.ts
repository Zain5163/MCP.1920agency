import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Envelope encryption for stored OAuth credentials.
 *
 * Scheme, per `..\..\..\Ads-Platform\research\03-security-architecture.md`:
 *   - a fresh per-row DEK (AES-256-GCM) encrypts the secret
 *   - the DEK is wrapped by a master KEK held outside the database
 *   - `tenantId` and `keyVersion` are bound into the AEAD Additional Authenticated
 *     Data, so a ciphertext lifted from one tenant's row cannot be replayed into
 *     another's — the unwrap simply fails
 *   - `keyVersion` is stored in the clear so keys can be rotated without a
 *     flag-day migration
 *
 * Per-row DEKs rather than encrypting directly under the KEK: it caps how much
 * data any single key protects, and rotation can re-wrap DEKs without touching
 * (or decrypting) the secrets themselves.
 */

const MAGIC = 0x01
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

export class VaultError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'VaultError'
  }
}

export interface SealContext {
  readonly tenantId: string
  readonly keyVersion: number
}

/** Binds ciphertext to its tenant and key version. Any mismatch fails the unwrap. */
function aad(ctx: SealContext): Buffer {
  return Buffer.from(`v1|${ctx.tenantId}|${ctx.keyVersion}`, 'utf8')
}

function gcmEncrypt(key: Buffer, plaintext: Buffer, additional?: Buffer) {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  if (additional !== undefined) cipher.setAAD(additional)
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { iv, body, tag: cipher.getAuthTag() }
}

function gcmDecrypt(
  key: Buffer,
  iv: Buffer,
  body: Buffer,
  tag: Buffer,
  additional?: Buffer,
): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  if (additional !== undefined) decipher.setAAD(additional)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

/**
 * Encrypts a secret. Returns an opaque base64 blob safe to store in Postgres.
 *
 * Layout: magic | keyVersion(4) | kekIv | kekTag | wrappedDek | dekIv | dekTag | ciphertext
 */
export function seal(plaintext: string, kek: Buffer, ctx: SealContext): string {
  assertKey(kek, 'KEK')
  const dek = randomBytes(KEY_BYTES)
  try {
    const wrapped = gcmEncrypt(kek, dek, aad(ctx))
    const sealed = gcmEncrypt(dek, Buffer.from(plaintext, 'utf8'), aad(ctx))

    const header = Buffer.alloc(5)
    header.writeUInt8(MAGIC, 0)
    header.writeUInt32BE(ctx.keyVersion, 1)

    return Buffer.concat([
      header,
      wrapped.iv,
      wrapped.tag,
      wrapped.body,
      sealed.iv,
      sealed.tag,
      sealed.body,
    ]).toString('base64')
  } finally {
    // Not a guarantee under a copying GC, but it removes the obvious lingering copy.
    dek.fill(0)
  }
}

/** Reads the key version without decrypting. Used by rotation tooling. */
export function keyVersionOf(blob: string): number {
  const raw = Buffer.from(blob, 'base64')
  if (raw.length < 5 || raw.readUInt8(0) !== MAGIC) {
    throw new VaultError('Not a recognised vault blob')
  }
  return raw.readUInt32BE(1)
}

/**
 * Decrypts a secret.
 *
 * Throws on any tampering, on a tenant mismatch, or on the wrong key — GCM
 * authentication failure is indistinguishable from all three by design, so the
 * error deliberately does not say which.
 */
export function open(blob: string, kek: Buffer, ctx: Omit<SealContext, 'keyVersion'>): string {
  assertKey(kek, 'KEK')
  const raw = Buffer.from(blob, 'base64')

  const minimum = 5 + IV_BYTES + TAG_BYTES + KEY_BYTES + IV_BYTES + TAG_BYTES
  if (raw.length < minimum || raw.readUInt8(0) !== MAGIC) {
    throw new VaultError('Not a recognised vault blob')
  }

  const keyVersion = raw.readUInt32BE(1)
  const additional = aad({ tenantId: ctx.tenantId, keyVersion })

  let offset = 5
  const take = (n: number): Buffer => {
    const slice = raw.subarray(offset, offset + n)
    offset += n
    return slice
  }

  const kekIv = take(IV_BYTES)
  const kekTag = take(TAG_BYTES)
  const wrappedDek = take(KEY_BYTES)
  const dekIv = take(IV_BYTES)
  const dekTag = take(TAG_BYTES)
  const ciphertext = raw.subarray(offset)

  let dek: Buffer | undefined
  try {
    dek = gcmDecrypt(kek, kekIv, wrappedDek, kekTag, additional)
    return gcmDecrypt(dek, dekIv, ciphertext, dekTag, additional).toString('utf8')
  } catch (cause) {
    throw new VaultError('Could not decrypt credential', { cause })
  } finally {
    dek?.fill(0)
  }
}

/** Re-encrypts under a new key version without exposing the plaintext to callers. */
export function rotate(
  blob: string,
  oldKek: Buffer,
  newKek: Buffer,
  ctx: SealContext,
): string {
  const plaintext = open(blob, oldKek, { tenantId: ctx.tenantId })
  return seal(plaintext, newKek, ctx)
}

export function parseKey(base64: string, label = 'key'): Buffer {
  let key: Buffer
  try {
    key = Buffer.from(base64, 'base64')
  } catch (cause) {
    throw new VaultError(`${label} is not valid base64`, { cause })
  }
  assertKey(key, label)
  return key
}

function assertKey(key: Buffer, label: string): void {
  if (key.length !== KEY_BYTES) {
    throw new VaultError(`${label} must be exactly ${KEY_BYTES} bytes (got ${key.length})`)
  }
  // A key of all zeroes almost always means an unset or misparsed env var.
  if (timingSafeEqual(key, Buffer.alloc(KEY_BYTES))) {
    throw new VaultError(`${label} is all zero bytes — it is probably unset`)
  }
}
