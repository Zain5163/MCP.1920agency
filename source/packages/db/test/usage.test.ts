import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { db, disconnect } from '../src/client.ts'
import { TenantScope, deleteTenantCompletely } from '../src/tenant-scope.ts'

/**
 * Usage metering against the real database.
 *
 * Migration 20261008120000_add_plans_and_usage was applied on 2026-10-08 and
 * this file passed against it (6/6), so it now runs with the rest of the db
 * suite. Like that suite it hits the live database: run it at a quiet time.
 * On its own:
 *
 *   pnpm --filter @social-publisher/db run test:usage
 *
 * What a fake cannot prove is the SQL: that the upsert increments atomically,
 * and that one tenant's counter is never another's. Two throwaway tenants are
 * created and deleted; nothing else is touched.
 */

const tag = randomUUID().slice(0, 8)
const MONTH = '2026-10'
let alice: TenantScope
let bob: TenantScope

before(async () => {
  alice = new TenantScope((await db().tenant.create({ data: { name: `test-usage-alice-${tag}` } })).id)
  bob = new TenantScope((await db().tenant.create({ data: { name: `test-usage-bob-${tag}` } })).id)
})

after(async () => {
  await deleteTenantCompletely(alice.tenantId)
  await deleteTenantCompletely(bob.tenantId)
  await disconnect()
})

const call = { tool: 'list_posts', ok: true, durationMs: 12, transport: 'stdio' as const }

describe('usage metering in the database', () => {
  test('a new tenant is Free with nothing used', async () => {
    const usage = await alice.usage(MONTH)
    assert.equal(usage.plan, 'free')
    assert.equal(usage.calls, 0)
    assert.deepEqual(usage.noticesShown, [])
  })

  test('concurrent counted calls each get their own count', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, async () => await alice.recordToolCall(call, { month: MONTH, count: true })),
    )
    const counts = results.map((r) => r!.calls).sort((a, b) => a - b)
    assert.deepEqual(counts, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.equal(await db().toolCall.count({ where: { tenantId: alice.tenantId } }), 10)
  })

  test('an uncounted call is logged but not added to the month', async () => {
    assert.equal(await alice.recordToolCall({ ...call, tool: 'check_usage' }, { month: MONTH, count: false }), null)
    assert.equal((await alice.usage(MONTH)).calls, 10)
    assert.equal(await db().toolCall.count({ where: { tenantId: alice.tenantId, tool: 'check_usage' } }), 1)
  })

  test('notices shown are remembered for the month only', async () => {
    await alice.markNoticesShown(MONTH, [25])
    assert.deepEqual((await alice.usage(MONTH)).noticesShown, [25])
    assert.deepEqual((await alice.usage('2026-11')).noticesShown, [])
  })

  test("one tenant's usage is never another's", async () => {
    const usage = await bob.usage(MONTH)
    assert.equal(usage.calls, 0)
    await bob.markNoticesShown(MONTH, [50])
    assert.deepEqual((await alice.usage(MONTH)).noticesShown, [25])
  })

  test('a failed call keeps its catalogue code', async () => {
    await bob.recordToolCall({ ...call, ok: false, errorCode: 'DB_UNREACHABLE', transport: 'http' }, { month: MONTH, count: true })
    const row = await db().toolCall.findFirst({ where: { tenantId: bob.tenantId } })
    assert.equal(row?.errorCode, 'DB_UNREACHABLE')
    assert.equal(row?.ok, false)
  })
})

/**
 * Needs migration 20261008160000_add_tenant_industry. Before it is applied,
 * these fail on the missing column (as does every usage() above, since the
 * client now selects it).
 */
describe('industry in the database', () => {
  test('a new tenant has no industry', async () => {
    assert.equal((await alice.usage(MONTH)).industry, null)
  })

  test('setIndustry stores a listed code, for this tenant only', async () => {
    await alice.setIndustry('dentist')
    assert.equal((await alice.usage(MONTH)).industry, 'dentist')
    assert.equal((await bob.usage(MONTH)).industry, null)
    await alice.setIndustry('real_estate')
    assert.equal((await alice.usage(MONTH)).industry, 'real_estate')
  })

  test('the CHECK constraint refuses anything not on the list', async () => {
    // Free text must never be stored, even by a caller that skips the enum.
    await assert.rejects(alice.setIndustry('Dental clinic'))
    await assert.rejects(alice.setIndustry('DENTIST'))
    assert.equal((await alice.usage(MONTH)).industry, 'real_estate')
  })

  test('a tenant that no longer exists is a plain error', async () => {
    await assert.rejects(new TenantScope(`missing-${tag}`).setIndustry('other'), /no longer exists/)
  })
})
