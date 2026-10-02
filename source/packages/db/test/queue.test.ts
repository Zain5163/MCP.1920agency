import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { db, disconnect } from '../src/client.ts'
import { touchJob } from '../src/queue.ts'
import { deleteTenantCompletely } from '../src/tenant-scope.ts'

/**
 * The job heartbeat, exercised against the real database.
 *
 * What matters is the WHERE clause: a worker may extend its own running lock
 * and nobody else's. A mock would only prove the mock.
 *
 * The job is created so that no real worker can take it while the test runs:
 * locked five minutes ago (reclaimStale waits fifteen) and due tomorrow (so even
 * a queued copy is not claimable). It lives in a throwaway tenant that is
 * deleted afterwards.
 */

const tag = randomUUID().slice(0, 8)
const workerId = `test-worker-${tag}`
let tenantId: string
let jobId: string

before(async () => {
  const tenant = await db().tenant.create({ data: { name: `test-queue-${tag}` } })
  tenantId = tenant.id
  const connection = await db().connection.create({
    data: {
      tenantId,
      platform: 'facebook_page',
      platformAccountId: `queue-page-${tag}`,
      displayName: 'Queue Test Page',
      secretCiphertext: 'not-a-real-ciphertext',
    },
  })
  const post = await db().post.create({ data: { tenantId, body: `heartbeat ${tag}`, createdBy: 'test' } })
  const target = await db().target.create({
    data: {
      tenantId,
      postId: post.id,
      connectionId: connection.id,
      state: 'publishing',
      scheduledFor: new Date(Date.now() + 86_400_000),
      idempotencyKey: `test-${tag}-queue`,
    },
  })
  const job = await db().job.create({
    data: {
      tenantId,
      targetId: target.id,
      state: 'running',
      runAfter: new Date(Date.now() + 86_400_000),
      lockedAt: new Date(Date.now() - 5 * 60_000),
      lockedBy: workerId,
    },
  })
  jobId = job.id
})

after(async () => {
  if (tenantId !== undefined) await deleteTenantCompletely(tenantId).catch(() => {})
  await disconnect()
})

const lockedAt = async (): Promise<number> =>
  (await db().job.findUniqueOrThrow({ where: { id: jobId } })).lockedAt!.getTime()

describe('touchJob — keeping a long job locked', () => {
  test('a worker extends its own running lock', async () => {
    const before = await lockedAt()
    assert.equal(await touchJob(jobId, workerId), true)
    assert.ok((await lockedAt()) > before, 'the lock should be fresh again')
  })

  test("another worker cannot extend a lock it does not hold", async () => {
    const before = await lockedAt()
    assert.equal(await touchJob(jobId, `someone-else-${tag}`), false)
    assert.equal(await lockedAt(), before)
  })

  test('a job that is no longer running is not touched', async () => {
    await db().job.update({ where: { id: jobId }, data: { state: 'queued' } })
    assert.equal(await touchJob(jobId, workerId), false)
  })
})
