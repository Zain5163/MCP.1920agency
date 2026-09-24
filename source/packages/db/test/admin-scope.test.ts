import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { AdminAccessError, adminScopeForUser, scopeForUser } from '../src/admin-scope.ts'
import { db, disconnect } from '../src/client.ts'
import { TenantScope, deleteTenantCompletely } from '../src/tenant-scope.ts'

/**
 * Admin access must be deliberate, role-checked and recorded.
 *
 * The risk being tested: an AI agent, or a bug, reaching cross-tenant data without
 * anyone intending it. Every test here is about making that impossible or visible.
 */

const tag = randomUUID().slice(0, 8)
let ownerTenantId: string
let customerTenantId: string
let ownerUserId: string
let memberUserId: string

before(async () => {
  const ownerTenant = await db().tenant.create({ data: { name: `test-op-${tag}` } })
  const customerTenant = await db().tenant.create({ data: { name: `test-cust-${tag}` } })
  ownerTenantId = ownerTenant.id
  customerTenantId = customerTenant.id

  const owner = await db().user.create({
    data: {
      tenantId: ownerTenant.id,
      email: `owner-${tag}@test.local`,
      passwordHash: 'x',
      role: 'owner',
    },
  })
  const member = await db().user.create({
    data: {
      tenantId: customerTenant.id,
      email: `member-${tag}@test.local`,
      passwordHash: 'x',
      role: 'member',
    },
  })
  ownerUserId = owner.id
  memberUserId = member.id
})

after(async () => {
  for (const id of [ownerTenantId, customerTenantId]) {
    if (id !== undefined) await deleteTenantCompletely(id).catch(() => {})
  }
  await disconnect()
})

describe('who can become an admin', () => {
  test('an owner can', async () => {
    const admin = await adminScopeForUser(ownerUserId)
    assert.match(admin.actor.email, /^owner-/)
  })

  test('a member cannot, and the refusal is loud', async () => {
    // Throws rather than returning null: silently downgrading to no access would
    // hide a privilege bug behind an empty result.
    await assert.rejects(() => adminScopeForUser(memberUserId), AdminAccessError)
  })

  test('an unknown user cannot', async () => {
    await assert.rejects(() => adminScopeForUser(randomUUID()), AdminAccessError)
  })

  test('an empty user id cannot', async () => {
    await assert.rejects(() => adminScopeForUser(''), AdminAccessError)
  })
})

describe('there is no escalation path from a tenant scope', () => {
  test('TenantScope exposes nothing that grants cross-tenant access', () => {
    // If someone ever adds asAdmin()/elevate()/impersonate(), this fails on purpose.
    const methods = Object.getOwnPropertyNames(TenantScope.prototype)
    for (const forbidden of ['asAdmin', 'elevate', 'impersonate', 'crossTenant', 'allTenants']) {
      assert.ok(!methods.includes(forbidden), `TenantScope must not expose ${forbidden}`)
    }
  })

  test('an ordinary user scope is pinned to their own tenant', async () => {
    const scope = await scopeForUser(memberUserId)
    assert.equal(scope.tenantId, customerTenantId)
  })
})

describe('opening another account is recorded', () => {
  test('requires a meaningful reason', async () => {
    const admin = await adminScopeForUser(ownerUserId)
    await assert.rejects(() => admin.openTenant(customerTenantId, ''), AdminAccessError)
    await assert.rejects(() => admin.openTenant(customerTenantId, 'x'), AdminAccessError)
  })

  test('writes the audit entry into the account being opened, not the admin one', async () => {
    // The customer must be able to see that we looked. An audit trail kept only on
    // our side is not a trail the customer can rely on.
    const admin = await adminScopeForUser(ownerUserId)
    await admin.openTenant(customerTenantId, 'investigating a failed publish')

    const customerLog = await db().auditLog.findMany({ where: { tenantId: customerTenantId } })
    const entry = customerLog.find((e) => e.action === 'admin.account_opened')
    assert.ok(entry !== undefined, 'the opened account must have the audit entry')
    assert.match(entry.actor, /^admin:owner-/)
    assert.match(JSON.stringify(entry.detail), /investigating a failed publish/)

    const ownerLog = await db().auditLog.findMany({ where: { tenantId: ownerTenantId } })
    assert.equal(
      ownerLog.filter((e) => e.action === 'admin.account_opened').length,
      0,
      'the entry must not be filed under the admin tenant',
    )
  })

  test('returns a scope genuinely pinned to that tenant', async () => {
    const admin = await adminScopeForUser(ownerUserId)
    const scope = await admin.openTenant(customerTenantId, 'support request from customer')
    assert.equal(scope.tenantId, customerTenantId)
  })

  test('refuses an account that does not exist', async () => {
    const admin = await adminScopeForUser(ownerUserId)
    await assert.rejects(() => admin.openTenant(randomUUID(), 'a good enough reason'), AdminAccessError)
  })
})

describe('operational views leak no customer content', () => {
  test('platform stats are counts only', async () => {
    const stats = await adminScopeForUser(ownerUserId).then((a) => a.platformStats())
    assert.ok(stats.tenants >= 2)
    for (const value of Object.values(stats)) assert.equal(typeof value, 'number')
  })

  test('the broken-connections view never returns credentials', async () => {
    await db().connection.create({
      data: {
        tenantId: customerTenantId,
        platform: 'facebook_page',
        platformAccountId: `broken-${tag}`,
        displayName: 'Broken Page',
        secretCiphertext: 'SHOULD-NEVER-APPEAR',
        needsReauth: true,
        reauthReason: 'token revoked',
      },
    })

    const admin = await adminScopeForUser(ownerUserId)
    const rows = await admin.connectionsNeedingAttention()
    const serialised = JSON.stringify(rows)

    assert.ok(serialised.includes('Broken Page'))
    assert.ok(!serialised.includes('SHOULD-NEVER-APPEAR'), 'ciphertext must not be selected')
    assert.ok(!serialised.includes('secretCiphertext'))
  })
})
