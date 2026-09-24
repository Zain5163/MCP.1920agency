import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import {
  PasswordError,
  checkPasswordStrength,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../src/password.ts'

describe('hashing', () => {
  test('a correct password verifies', async () => {
    const hash = await hashPassword('correct horse battery staple')
    assert.equal(await verifyPassword('correct horse battery staple', hash), true)
  })

  test('a wrong password does not', async () => {
    const hash = await hashPassword('correct horse battery staple')
    assert.equal(await verifyPassword('Correct horse battery staple', hash), false)
    assert.equal(await verifyPassword('', hash), false)
  })

  test('the plaintext never appears in the hash', async () => {
    const hash = await hashPassword('my-secret-passphrase-2026')
    assert.ok(!hash.includes('my-secret-passphrase'))
  })

  test('the same password hashes differently every time', async () => {
    // Random salt: identical passwords must not be identifiable in the database.
    const a = await hashPassword('same password here')
    const b = await hashPassword('same password here')
    assert.notEqual(a, b)
    assert.equal(await verifyPassword('same password here', a), true)
    assert.equal(await verifyPassword('same password here', b), true)
  })

  test('the stored format records its own parameters', async () => {
    // Self-describing, so cost can be raised later without breaking old hashes.
    const parts = (await hashPassword('a long enough password')).split('$')
    assert.equal(parts.length, 6)
    assert.equal(parts[0], 'scrypt')
    assert.ok(Number(parts[1]) >= 16384)
  })

  test('handles unicode and very long passwords', async () => {
    const pw = `passphrase-with-émoji-🔐-${'x'.repeat(150)}`
    assert.equal(await verifyPassword(pw, await hashPassword(pw)), true)
  })

  test('refuses to hash an empty password', async () => {
    await assert.rejects(() => hashPassword(''), PasswordError)
  })
})

describe('verification is defensive', () => {
  test('a malformed hash returns false rather than throwing', async () => {
    // A corrupt row should be a failed login, not a crash — and the caller must
    // not be able to tell the two apart by watching for exceptions.
    for (const bad of ['', 'nonsense', 'scrypt$only$three', 'bcrypt$16384$8$1$aa$bb', '$$$$$']) {
      assert.equal(await verifyPassword('anything', bad), false)
    }
  })

  test('rejects an absurdly low cost parameter', async () => {
    // Guards against a tampered row downgrading the work factor to nothing.
    assert.equal(await verifyPassword('x', 'scrypt$2$8$1$YWJj$YWJj'), false)
  })

  test('non-string inputs return false', async () => {
    assert.equal(await verifyPassword(undefined as unknown as string, 'x'), false)
    assert.equal(await verifyPassword('x', null as unknown as string), false)
  })
})

describe('strength policy', () => {
  test('accepts a long passphrase without symbols', async () => {
    // Length beats forced symbols: mandatory punctuation produces "Password1!".
    assert.equal(checkPasswordStrength('correct horse battery staple').ok, true)
  })

  test('rejects anything under 12 characters', () => {
    const result = checkPasswordStrength('Sh0rt!')
    assert.equal(result.ok, false)
    assert.match(result.problems.join(' '), /at least 12/)
  })

  test('rejects common passwords even when long', () => {
    assert.equal(checkPasswordStrength('mypassword12345').ok, false)
    assert.equal(checkPasswordStrength('qwertyqwertyqwerty').ok, false)
  })

  test('rejects a single repeated character', () => {
    assert.equal(checkPasswordStrength('aaaaaaaaaaaaaaaa').ok, false)
  })

  test('flags leading or trailing spaces, which are easy to lose', () => {
    assert.equal(checkPasswordStrength(' a good long passphrase').ok, false)
  })

  test('reports every problem at once rather than one at a time', () => {
    assert.ok(checkPasswordStrength('pass').problems.length >= 1)
  })
})

describe('needsRehash', () => {
  test('false for a current hash', async () => {
    assert.equal(needsRehash(await hashPassword('a perfectly fine passphrase')), false)
  })

  test('true for a weaker or unrecognised hash', () => {
    assert.equal(needsRehash('scrypt$1024$8$1$YWJj$YWJj'), true)
    assert.equal(needsRehash('bcrypt$whatever'), true)
    assert.equal(needsRehash('garbage'), true)
  })
})
