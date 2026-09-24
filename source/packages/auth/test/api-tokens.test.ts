import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { db, deleteTenantCompletely, disconnect } from '@social-publisher/db'

import { createUser } from '../src/accounts.ts'
import { TokenError, identifyToken, issueToken, listTokens, revokeToken } from '../src/api-tokens.ts'

/**
 * API token resolution is the single point where a hosted MCP request becomes a
 * tenant. If it is wrong, one customer's AI reaches another customer's accounts —
 * so these tests matter as much as the isolation tests themselves.
 */

const tag = randomUUID().slice(0, 8)
let aliceTenant: string
let bobTenant: string
let aliceUser: string
let bobUser: string
let aliceToken: string

before(async () => {
  const a = await db().tenant.create({ data: { name: `test-tok-a-${tag}` } })
  const b = await db().tenant.create({ data: { name: `test-tok-b-${tag}` } })
  aliceTenant = a.id
  bobTenant = b.id

  aliceUser = (
    await createUser({
      email: `alice-${tag}@test.local`,
      password: 'a perfectly good passphrase',
      tenantId: a.id,
      role: 'owner',
    })
  ).id
  bobUser = (
    await createUser({
      email: `bob-${tag}@test.local`,
      password: 'another perfectly good one',
      tenantId: b.id,
    })
  ).id

  aliceToken = (await issueToken({ userId: aliceUser, name: 'Alice laptop' })).token
})

after(async () => {
  for (const id of [aliceTenant, bobTenant]) {
    if (id !== undefined) await deleteTenantCompletely(id).catch(() => {})
  }
  await disconnect()
})

describe('issuing', () => {
  test('returns a token exactly once and never stores it', async () => {
    const issued = await issueToken({ userId: aliceUser, name: 'Another client' })
    assert.ok(issued.token.startsWith('adsp_'))
    assert.ok(issued.token.length > 40)

    const stored = await db().apiToken.findUnique({ where: { id: issued.id } })
    assert.ok(!stored!.tokenHash.includes(issued.token), 'the raw token must never be stored')
  })

  test('two tokens are never the same', async () => {
    const a = await issueToken({ userId: aliceUser, name: 'one' })
    const b = await issueToken({ userId: aliceUser, name: 'two' })
    assert.notEqual(a.token, b.token)
  })

  test('the stored prefix cannot reconstruct the token', async () => {
    const issued = await issueToken({ userId: aliceUser, name: 'prefix check' })
    assert.ok(issued.prefix.length < 15)
    assert.ok(issued.token.startsWith(issued.prefix))
  })

  test('requires a name, so tokens are identifiable later', async () => {
    await assert.rejects(() => issueToken({ userId: aliceUser, name: '   ' }), TokenError)
  })

  test('refuses an unknown user', async () => {
    await assert.rejects(() => issueToken({ userId: randomUUID(), name: 'x' }), TokenError)
  })
})

describe('identifying — the security boundary', () => {
  test('a valid token resolves to its own tenant', async () => {
    const identity = await identifyToken(aliceToken)
    assert.notEqual(identity, null)
    assert.equal(identity!.tenantId, aliceTenant)
    assert.equal(identity!.scope.tenantId, aliceTenant)
  })

  test("Alice's token never resolves to Bob's tenant", async () => {
    // The catastrophic bug, stated directly.
    const identity = await identifyToken(aliceToken)
    assert.notEqual(identity!.tenantId, bobTenant)
  })

  test('accepts the Bearer prefix or a bare token', async () => {
    assert.notEqual(await identifyToken(`Bearer ${aliceToken}`), null)
    assert.notEqual(await identifyToken(aliceToken), null)
  })

  test('every kind of bad input returns null, not an error', async () => {
    // Identical outcomes so a caller cannot distinguish "wrong" from "malformed"
    // and use the difference to probe.
    for (const bad of [
      undefined,
      '',
      'nonsense',
      'Bearer ',
      'adsp_',
      'adsp_tooshort',
      `adsp_${'x'.repeat(43)}`,
      aliceToken.slice(0, -4),
      `${aliceToken}extra`,
    ]) {
      assert.equal(await identifyToken(bad as string | undefined), null, `should reject: ${bad}`)
    }
  })

  test('a single flipped character is rejected', async () => {
    const tampered = `${aliceToken.slice(0, -1)}${aliceToken.slice(-1) === 'A' ? 'B' : 'A'}`
    assert.equal(await identifyToken(tampered), null)
  })

  test('a revoked token stops working immediately', async () => {
    const issued = await issueToken({ userId: aliceUser, name: 'to be revoked' })
    assert.notEqual(await identifyToken(issued.token), null)

    assert.equal(await revokeToken(aliceUser, issued.id), true)
    assert.equal(await identifyToken(issued.token), null)
  })

  test('an expired token stops working', async () => {
    const issued = await issueToken({ userId: aliceUser, name: 'short lived' })
    await db().apiToken.update({
      where: { id: issued.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    assert.equal(await identifyToken(issued.token), null)
  })

  test('records last use without failing the request', async () => {
    const issued = await issueToken({ userId: aliceUser, name: 'usage tracked' })
    await identifyToken(issued.token)
    await new Promise((r) => setTimeout(r, 300))
    const row = await db().apiToken.findUnique({ where: { id: issued.id } })
    assert.ok(row!.lastUsedAt !== null)
  })
})

describe('listing and revoking', () => {
  test('listing never exposes a hash or a token', async () => {
    const tokens = await listTokens(aliceUser)
    const serialised = JSON.stringify(tokens)
    assert.ok(!serialised.includes('tokenHash'))
    assert.ok(!serialised.includes(aliceToken))
  })

  test('a user only sees their own tokens', async () => {
    await issueToken({ userId: bobUser, name: 'Bob token' })
    const aliceTokens = await listTokens(aliceUser)
    assert.ok(!aliceTokens.some((t) => t.name === 'Bob token'))
  })

  test("revoking someone else's token is a no-op, not an error", async () => {
    // Returning false rather than throwing means Bob learns nothing about
    // whether that id exists.
    const issued = await issueToken({ userId: aliceUser, name: 'not yours' })
    assert.equal(await revokeToken(bobUser, issued.id), false)
    assert.notEqual(await identifyToken(issued.token), null, 'must still work')
  })

  test('revoking twice reports false the second time', async () => {
    const issued = await issueToken({ userId: aliceUser, name: 'double revoke' })
    assert.equal(await revokeToken(aliceUser, issued.id), true)
    assert.equal(await revokeToken(aliceUser, issued.id), false)
  })
})
