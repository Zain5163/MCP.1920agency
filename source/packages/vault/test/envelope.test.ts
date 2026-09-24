import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { test, describe } from 'node:test'

import { keyVersionOf, open, parseKey, rotate, seal, VaultError } from '../src/envelope.ts'

const KEK = randomBytes(32)
const OTHER_KEK = randomBytes(32)
const CTX = { tenantId: 'tenant-a', keyVersion: 1 }

describe('seal / open', () => {
  test('round-trips a secret', () => {
    const blob = seal('super-secret-token', KEK, CTX)
    assert.equal(open(blob, KEK, { tenantId: 'tenant-a' }), 'super-secret-token')
  })

  test('round-trips unicode and long values', () => {
    const secret = `${'x'.repeat(4000)}–émoji-🔐`
    const blob = seal(secret, KEK, CTX)
    assert.equal(open(blob, KEK, { tenantId: 'tenant-a' }), secret)
  })

  test('round-trips an empty string', () => {
    const blob = seal('', KEK, CTX)
    assert.equal(open(blob, KEK, { tenantId: 'tenant-a' }), '')
  })

  test('the ciphertext does not contain the plaintext', () => {
    const blob = seal('needle-in-haystack', KEK, CTX)
    assert.ok(!Buffer.from(blob, 'base64').toString('utf8').includes('needle'))
    assert.ok(!blob.includes('needle'))
  })

  test('encrypting the same secret twice produces different ciphertext', () => {
    // Fresh DEK and IV each time, so identical secrets are not correlatable in the DB.
    assert.notEqual(seal('same', KEK, CTX), seal('same', KEK, CTX))
  })
})

describe('tenant binding', () => {
  test('another tenant cannot open the blob', () => {
    const blob = seal('secret', KEK, CTX)
    assert.throws(() => open(blob, KEK, { tenantId: 'tenant-b' }), VaultError)
  })

  test('a blob moved into another tenant row is rejected', () => {
    // The exact cross-tenant attack the AAD binding exists to stop.
    const stolen = seal('tenant-a-token', KEK, { tenantId: 'tenant-a', keyVersion: 1 })
    assert.throws(() => open(stolen, KEK, { tenantId: 'tenant-b' }), VaultError)
  })
})

describe('tamper resistance', () => {
  test('the wrong KEK cannot open the blob', () => {
    const blob = seal('secret', KEK, CTX)
    assert.throws(() => open(blob, OTHER_KEK, { tenantId: 'tenant-a' }), VaultError)
  })

  test('a flipped ciphertext byte is detected', () => {
    const raw = Buffer.from(seal('secret', KEK, CTX), 'base64')
    raw[raw.length - 1] ^= 0xff
    assert.throws(() => open(raw.toString('base64'), KEK, { tenantId: 'tenant-a' }), VaultError)
  })

  test('a flipped wrapped-DEK byte is detected', () => {
    const raw = Buffer.from(seal('secret', KEK, CTX), 'base64')
    raw[30] ^= 0xff
    assert.throws(() => open(raw.toString('base64'), KEK, { tenantId: 'tenant-a' }), VaultError)
  })

  test('a tampered key version is detected', () => {
    const raw = Buffer.from(seal('secret', KEK, CTX), 'base64')
    raw.writeUInt32BE(99, 1)
    assert.throws(() => open(raw.toString('base64'), KEK, { tenantId: 'tenant-a' }), VaultError)
  })

  test('truncated and junk input are rejected cleanly', () => {
    assert.throws(() => open('', KEK, { tenantId: 'tenant-a' }), VaultError)
    assert.throws(() => open('aGVsbG8=', KEK, { tenantId: 'tenant-a' }), VaultError)
    const raw = Buffer.from(seal('secret', KEK, CTX), 'base64')
    assert.throws(
      () => open(raw.subarray(0, 20).toString('base64'), KEK, { tenantId: 'tenant-a' }),
      VaultError,
    )
  })
})

describe('key versioning and rotation', () => {
  test('key version is readable without decrypting', () => {
    assert.equal(keyVersionOf(seal('s', KEK, { tenantId: 'tenant-a', keyVersion: 7 })), 7)
  })

  test('rotation re-encrypts under a new key and version', () => {
    const v1 = seal('secret', KEK, { tenantId: 'tenant-a', keyVersion: 1 })
    const v2 = rotate(v1, KEK, OTHER_KEK, { tenantId: 'tenant-a', keyVersion: 2 })

    assert.equal(keyVersionOf(v2), 2)
    assert.equal(open(v2, OTHER_KEK, { tenantId: 'tenant-a' }), 'secret')
    // The old key must no longer work on the rotated blob.
    assert.throws(() => open(v2, KEK, { tenantId: 'tenant-a' }), VaultError)
  })
})

describe('parseKey', () => {
  test('accepts a valid 32-byte base64 key', () => {
    assert.equal(parseKey(randomBytes(32).toString('base64')).length, 32)
  })

  test('rejects a wrong-length key', () => {
    assert.throws(() => parseKey(randomBytes(16).toString('base64')), VaultError)
  })

  test('rejects an all-zero key, which means an unset env var', () => {
    assert.throws(() => parseKey(Buffer.alloc(32).toString('base64')), VaultError)
  })
})
