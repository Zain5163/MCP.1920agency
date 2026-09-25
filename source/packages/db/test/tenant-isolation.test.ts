import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { db, disconnect } from '../src/client.ts'
import {
  TenantScope,
  TenantScopeError,
  deleteTenantCompletely,
  tenantScopeFor,
} from '../src/tenant-scope.ts'

/**
 * Cross-tenant isolation, exercised against the real database.
 *
 * This is the most important test file in the project. The failure it guards
 * against — one customer's request reaching another customer's social accounts —
 * is the one bug that would end the product. Mocks would not prove anything here,
 * because the thing under test is whether the SQL actually filters.
 *
 * Two throwaway tenants are created, used, and deleted. Nothing outside them is
 * touched.
 */

let alice: TenantScope
let bob: TenantScope
let aliceTenantId: string
let bobTenantId: string
let aliceConnectionId: string
let bobConnectionId: string
let alicePostId: string

const tag = randomUUID().slice(0, 8)

before(async () => {
  const a = await db().tenant.create({ data: { name: `test-alice-${tag}` } })
  const b = await db().tenant.create({ data: { name: `test-bob-${tag}` } })
  aliceTenantId = a.id
  bobTenantId = b.id
  alice = new TenantScope(a.id)
  bob = new TenantScope(b.id)

  const aConn = await db().connection.create({
    data: {
      tenantId: a.id,
      platform: 'facebook_page',
      platformAccountId: `alice-page-${tag}`,
      displayName: 'Alice Page',
      secretCiphertext: 'ciphertext-a',
    },
  })
  const bConn = await db().connection.create({
    data: {
      tenantId: b.id,
      platform: 'facebook_page',
      platformAccountId: `bob-page-${tag}`,
      displayName: 'Bob Page',
      secretCiphertext: 'ciphertext-b',
    },
  })
  aliceConnectionId = aConn.id
  bobConnectionId = bConn.id

  const post = await alice.createPost({ body: `alice private ${tag}`, createdBy: 'test' })
  alicePostId = post.id

  await db().target.create({
    data: {
      tenantId: a.id,
      postId: post.id,
      connectionId: aConn.id,
      state: 'scheduled',
      scheduledFor: new Date(Date.now() + 3_600_000),
      idempotencyKey: `test-${tag}-a`,
    },
  })
  await alice.record('test', 'alice.action', { secretish: 'alice only' })
  await bob.record('test', 'bob.action')
})

after(async () => {
  // Ordered deletion, not tenant.delete() — the Restrict on targets.connection_id
  // blocks a plain cascade and would leave a half-deleted tenant behind.
  for (const id of [aliceTenantId, bobTenantId]) {
    if (id !== undefined) await deleteTenantCompletely(id).catch(() => {})
  }
  await disconnect()
})

describe('a scope cannot be built without a tenant', () => {
  test('rejects an empty id', () => {
    assert.throws(() => new TenantScope(''), TenantScopeError)
    assert.throws(() => new TenantScope('   '), TenantScopeError)
  })

  test('rejects a non-string id', () => {
    assert.throws(() => new TenantScope(undefined as unknown as string), TenantScopeError)
    assert.throws(() => new TenantScope(null as unknown as string), TenantScopeError)
  })

  test('a session for a tenant that no longer exists resolves to nothing', async () => {
    assert.equal(await tenantScopeFor(randomUUID()), null)
  })
})

describe('connections', () => {
  test('each tenant sees only its own', async () => {
    const aliceConns = await alice.connections()
    const bobConns = await bob.connections()

    assert.equal(aliceConns.length, 1)
    assert.equal(aliceConns[0]!.displayName, 'Alice Page')
    assert.equal(bobConns.length, 1)
    assert.equal(bobConns[0]!.displayName, 'Bob Page')
  })

  test("Bob cannot read Alice's connection even with the exact id", async () => {
    // The central case: knowing the id must not be enough.
    assert.notEqual(await alice.connection(aliceConnectionId), null)
    assert.equal(await bob.connection(aliceConnectionId), null)
  })

  test('a foreign id is indistinguishable from a missing one', async () => {
    // Otherwise the API becomes an oracle for which ids exist.
    assert.equal(await bob.connection(aliceConnectionId), null)
    assert.equal(await bob.connection(randomUUID()), null)
  })
})

describe('requireConnections — the publish path', () => {
  test('resolves ids the tenant owns', async () => {
    const rows = await alice.requireConnections([aliceConnectionId])
    assert.equal(rows.length, 1)
  })

  test("refuses outright when an id belongs to someone else", async () => {
    // This is the exact shape of the catastrophic bug: a publish request naming a
    // connection id from another account.
    await assert.rejects(() => bob.requireConnections([aliceConnectionId]), TenantScopeError)
  })

  test('refuses the whole batch rather than silently publishing the valid subset', async () => {
    // Quietly dropping the foreign id would hide a serious bug behind a partial success.
    await assert.rejects(
      () => bob.requireConnections([bobConnectionId, aliceConnectionId]),
      TenantScopeError,
    )
  })

  test('refuses an id that does not exist at all', async () => {
    await assert.rejects(() => alice.requireConnections([randomUUID()]), TenantScopeError)
  })

  test('an empty list is not an error', async () => {
    assert.deepEqual(await alice.requireConnections([]), [])
  })
})

describe('posts, targets and queue', () => {
  test("Bob's post list does not contain Alice's post", async () => {
    const bobPosts = await bob.posts()
    assert.ok(!bobPosts.some((p) => p.id === alicePostId))
    assert.ok(!bobPosts.some((p) => p.body.includes('alice private')))
  })

  test("Bob cannot fetch Alice's post by id", async () => {
    assert.notEqual(await alice.post(alicePostId), null)
    assert.equal(await bob.post(alicePostId), null)
  })

  test('targets are scoped', async () => {
    assert.equal((await alice.targets()).length, 1)
    assert.equal((await bob.targets()).length, 0)
  })

  test('queued jobs are scoped', async () => {
    const aliceTarget = (await alice.targets())[0]!
    await db().job.create({
      data: { tenantId: aliceTenantId, targetId: aliceTarget.id, runAfter: new Date() },
    })

    assert.equal((await alice.queuedJobs()).length, 1)
    assert.equal((await bob.queuedJobs()).length, 0)
  })

  test("Bob cannot cancel Alice's scheduled target", async () => {
    const aliceTarget = (await alice.targets())[0]!

    assert.equal(await bob.cancelTarget(aliceTarget.id), false)

    const afterBob = await db().target.findUnique({ where: { id: aliceTarget.id } })
    assert.equal(afterBob!.state, 'scheduled', 'Bob must not have changed it')

    assert.equal(await alice.cancelTarget(aliceTarget.id), true)
  })
})

describe('activity log', () => {
  test('each tenant sees only its own entries', async () => {
    const aliceLog = await alice.activity()
    const bobLog = await bob.activity()

    assert.ok(aliceLog.some((e) => e.action === 'alice.action'))
    assert.ok(!bobLog.some((e) => e.action === 'alice.action'))
    assert.ok(bobLog.some((e) => e.action === 'bob.action'))
  })

  test('detail written by one tenant never appears for another', async () => {
    const bobLog = await bob.activity()
    assert.ok(!JSON.stringify(bobLog).includes('alice only'))
  })
})

describe('writes are stamped with the owning tenant', () => {
  test('a post created through a scope belongs to that scope', async () => {
    const created = await bob.createPost({ body: `bob post ${tag}`, createdBy: 'test' })
    assert.equal(created.tenantId, bobTenantId)
    assert.equal(await alice.post(created.id), null)
  })

  test('an audit entry cannot be written into another tenant', async () => {
    const entry = await bob.record('test', 'scoped.write')
    assert.equal(entry.tenantId, bobTenantId)
  })
})

describe('retrying a failed target', () => {
  test('a failed target is queued again with a clean slate', async () => {
    const post = await alice.createPost({ body: `retry test ${tag}`, createdBy: 'test' })
    const target = await db().target.create({
      data: {
        tenantId: aliceTenantId,
        postId: post.id,
        connectionId: aliceConnectionId,
        state: 'failed',
        attempts: 4,
        failureClass: 'permanent',
        platformMessage: 'aspect ratio unsupported',
        idempotencyKey: `retry-${tag}`,
      },
    })

    assert.equal(await alice.retryTarget(target.id), 'queued')

    const after = await db().target.findUnique({ where: { id: target.id } })
    assert.equal(after!.state, 'scheduled')
    // Attempts reset so the retry gets a full backoff budget, and the old error
    // is cleared so a stale message cannot be mistaken for a new one.
    assert.equal(after!.attempts, 0)
    assert.equal(after!.platformMessage, null)
    assert.equal(after!.failureClass, null)

    const job = await db().job.findFirst({ where: { targetId: target.id } })
    assert.ok(job !== null, 'a job must exist for the worker to pick up')
    assert.equal(job.state, 'queued')
  })

  test('a published target is never retried', async () => {
    // Re-running a successful publish posts a second copy, which is worse than
    // any failure it might be fixing.
    const post = await alice.createPost({ body: `published ${tag}`, createdBy: 'test' })
    const target = await db().target.create({
      data: {
        tenantId: aliceTenantId,
        postId: post.id,
        connectionId: aliceConnectionId,
        state: 'published',
        platformPostId: 'already_out_123',
        idempotencyKey: `published-${tag}`,
      },
    })

    assert.equal(await alice.retryTarget(target.id), 'already_published')
    const after = await db().target.findUnique({ where: { id: target.id } })
    assert.equal(after!.state, 'published', 'state must be untouched')
  })

  test('a target carrying a platform post id is never retried, whatever its state', async () => {
    // The idempotency guard matters more than the state column: if the platform
    // accepted it, it went out.
    const post = await alice.createPost({ body: `half ${tag}`, createdBy: 'test' })
    const target = await db().target.create({
      data: {
        tenantId: aliceTenantId,
        postId: post.id,
        connectionId: aliceConnectionId,
        state: 'failed',
        platformPostId: 'went_out_anyway',
        idempotencyKey: `half-${tag}`,
      },
    })
    assert.equal(await alice.retryTarget(target.id), 'already_published')
  })

  test("Bob cannot retry Alice's failed target", async () => {
    const post = await alice.createPost({ body: `bob retry ${tag}`, createdBy: 'test' })
    const target = await db().target.create({
      data: {
        tenantId: aliceTenantId,
        postId: post.id,
        connectionId: aliceConnectionId,
        state: 'failed',
        idempotencyKey: `bobretry-${tag}`,
      },
    })

    assert.equal(await bob.retryTarget(target.id), 'not_found')
    const after = await db().target.findUnique({ where: { id: target.id } })
    assert.equal(after!.state, 'failed', 'Bob must not have changed it')
  })

  test('repeated retries reuse one job rather than piling them up', async () => {
    const post = await alice.createPost({ body: `repeat ${tag}`, createdBy: 'test' })
    const target = await db().target.create({
      data: {
        tenantId: aliceTenantId,
        postId: post.id,
        connectionId: aliceConnectionId,
        state: 'failed',
        idempotencyKey: `repeat-${tag}`,
      },
    })

    await alice.retryTarget(target.id)
    await db().target.update({ where: { id: target.id }, data: { state: 'failed' } })
    await alice.retryTarget(target.id)

    assert.equal(await db().job.count({ where: { targetId: target.id } }), 1)
  })
})
