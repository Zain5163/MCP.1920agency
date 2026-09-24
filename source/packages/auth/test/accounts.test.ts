import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { db, deleteTenantCompletely, disconnect } from '@social-publisher/db'

import { AuthError, authenticate, changePassword, createUser, findUser } from '../src/accounts.ts'

const tag = randomUUID().slice(0, 8)
const email = `user-${tag}@test.local`
const password = 'a perfectly good passphrase'

let tenantId: string
let userId: string

before(async () => {
  const tenant = await db().tenant.create({ data: { name: `test-auth-${tag}` } })
  tenantId = tenant.id
  const user = await createUser({ email, password, tenantId, role: 'owner' })
  userId = user.id
})

after(async () => {
  if (tenantId !== undefined) await deleteTenantCompletely(tenantId).catch(() => {})
  await disconnect()
})

describe('creating accounts', () => {
  test('stores a hash, never the password', async () => {
    const row = await db().user.findUnique({ where: { id: userId } })
    assert.ok(!row!.passwordHash.includes(password))
    assert.match(row!.passwordHash, /^scrypt\$/)
  })

  test('normalises the email so case and spacing cannot create duplicates', async () => {
    const found = await db().user.findUnique({ where: { email } })
    assert.equal(found!.email, email.toLowerCase())
    await assert.rejects(
      () => createUser({ email: `  ${email.toUpperCase()}  `, password, tenantId }),
      AuthError,
    )
  })

  test('rejects a weak password with specific reasons', async () => {
    try {
      await createUser({ email: `weak-${tag}@test.local`, password: 'short', tenantId })
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof AuthError)
      assert.ok(error.problems.length > 0, 'must say what is wrong, not just that it is wrong')
    }
  })

  test('rejects a malformed email', async () => {
    await assert.rejects(
      () => createUser({ email: 'not-an-email', password, tenantId }),
      AuthError,
    )
  })

  test('the user belongs to the tenant it was created in', async () => {
    const user = await findUser(userId)
    assert.equal(user!.tenantId, tenantId)
    assert.equal(user!.role, 'owner')
  })
})

describe('signing in', () => {
  test('correct credentials return the user', async () => {
    const user = await authenticate(email, password)
    assert.notEqual(user, null)
    assert.equal(user!.id, userId)
  })

  test('email is case-insensitive', async () => {
    assert.notEqual(await authenticate(email.toUpperCase(), password), null)
  })

  test('a wrong password returns null', async () => {
    assert.equal(await authenticate(email, 'not the right passphrase'), null)
  })

  test('an unknown email returns null, exactly like a wrong password', async () => {
    // Identical outcome, so a caller cannot tell which accounts exist.
    assert.equal(await authenticate(`nobody-${tag}@test.local`, password), null)
  })

  test('rejecting an unknown user is not measurably faster', async () => {
    // A missing user skips hashing unless we deliberately hash anyway. If it were
    // faster, login timing would reveal which emails are registered.
    const timeOf = async (fn: () => Promise<unknown>): Promise<number> => {
      const started = process.hrtime.bigint()
      await fn()
      return Number(process.hrtime.bigint() - started) / 1e6
    }

    const missing = await timeOf(() => authenticate(`ghost-${tag}@test.local`, password))
    const wrongPassword = await timeOf(() => authenticate(email, 'wrong passphrase here'))

    // Generous bound — this catches "skipped the hash entirely", not microseconds.
    assert.ok(
      missing > wrongPassword * 0.4,
      `unknown-email rejection was suspiciously fast (${missing.toFixed(1)}ms vs ${wrongPassword.toFixed(1)}ms)`,
    )
  })

  test('records the last login time', async () => {
    await authenticate(email, password)
    const row = await db().user.findUnique({ where: { id: userId } })
    assert.ok(row!.lastLoginAt !== null)
  })
})

describe('changing a password', () => {
  test('requires the current one', async () => {
    await assert.rejects(
      () => changePassword(userId, 'wrong current password', 'a brand new passphrase'),
      AuthError,
    )
  })

  test('enforces strength on the new one', async () => {
    await assert.rejects(() => changePassword(userId, password, 'weak'), AuthError)
  })

  test('the old password stops working once changed', async () => {
    const next = 'another entirely different passphrase'
    await changePassword(userId, password, next)

    assert.equal(await authenticate(email, password), null)
    assert.notEqual(await authenticate(email, next), null)

    await changePassword(userId, next, password)
  })
})
