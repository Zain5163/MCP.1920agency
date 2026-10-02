import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { test, describe } from 'node:test'

import { seal } from '../src/envelope.ts'
import {
  NeedsReauthError,
  TokenVault,
  type CredentialRecord,
  type CredentialStore,
  type StoredCredential,
} from '../src/vault.ts'

const KEK = randomBytes(32)

class FakeStore implements CredentialStore {
  rows = new Map<string, CredentialRecord>()
  reauthCalls: Array<{ connectionId: string; reason: string }> = []

  async load(connectionId: string, tenantId: string): Promise<CredentialRecord | null> {
    return this.rows.get(`${tenantId}:${connectionId}`) ?? null
  }

  async save(record: {
    connectionId: string
    tenantId: string
    secretCiphertext: string
    keyVersion: number
    expiresAt: Date | null
  }): Promise<void> {
    this.rows.set(`${record.tenantId}:${record.connectionId}`, {
      connectionId: record.connectionId,
      tenantId: record.tenantId,
      secretCiphertext: record.secretCiphertext,
      expiresAt: record.expiresAt,
    })
  }

  async markNeedsReauth(connectionId: string, _tenantId: string, reason: string): Promise<void> {
    this.reauthCalls.push({ connectionId, reason })
  }
}

const makeVault = (store: CredentialStore, now?: () => Date) =>
  new TokenVault({ kek: KEK, keyVersion: 1, store, ...(now ? { now } : {}) })

describe('TokenVault', () => {
  test('stores and hands back a credential inside the callback', async () => {
    const store = new FakeStore()
    const vault = makeVault(store)
    await vault.store('conn-1', 'tenant-a', { accessToken: 'tok-123' })

    let seen: string | undefined
    const result = await vault.withCredential('conn-1', 'tenant-a', async (cred) => {
      seen = cred.accessToken
      return 'done'
    })

    assert.equal(seen, 'tok-123')
    assert.equal(result, 'done')
  })

  test('what lands in the store is encrypted, not the raw token', async () => {
    const store = new FakeStore()
    await makeVault(store).store('conn-1', 'tenant-a', { accessToken: 'tok-123' })
    const row = store.rows.get('tenant-a:conn-1')
    assert.ok(row !== undefined)
    assert.ok(!row.secretCiphertext.includes('tok-123'))
  })

  test('another tenant cannot read the credential', async () => {
    const store = new FakeStore()
    const vault = makeVault(store)
    await vault.store('conn-1', 'tenant-a', { accessToken: 'tok-123' })

    await assert.rejects(
      () => vault.withCredential('conn-1', 'tenant-b', async () => 'nope'),
      /No credential stored/,
    )
  })

  test('a ciphertext copied into another tenant row still fails to decrypt', async () => {
    // Simulates a database-level cross-tenant row copy.
    const store = new FakeStore()
    const vault = makeVault(store)
    await vault.store('conn-1', 'tenant-a', { accessToken: 'tok-123' })
    const stolen = store.rows.get('tenant-a:conn-1')!

    store.rows.set('tenant-b:conn-1', { ...stolen, tenantId: 'tenant-b' })

    await assert.rejects(
      () => vault.withCredential('conn-1', 'tenant-b', async () => 'nope'),
      /Could not decrypt credential/,
    )
  })

  test('throws clearly when no credential exists', async () => {
    await assert.rejects(
      () => makeVault(new FakeStore()).withCredential('missing', 'tenant-a', async () => 1),
      /No credential stored/,
    )
  })
})

describe('expiry and refresh', () => {
  const past = new Date('2026-01-01T00:00:00Z')
  const future = new Date('2026-01-01T02:00:00Z')
  const now = () => new Date('2026-01-01T01:00:00Z')

  test('does not refresh a credential that is still valid', async () => {
    const store = new FakeStore()
    const vault = makeVault(store, now)
    await vault.store('c', 't', { accessToken: 'good', expiresAt: future })

    let refreshed = false
    const token = await vault.withCredential(
      'c',
      't',
      async (cred) => cred.accessToken,
      async (cur) => {
        refreshed = true
        return cur
      },
    )

    assert.equal(token, 'good')
    assert.equal(refreshed, false)
  })

  test('refreshes an expired credential and persists the new one', async () => {
    const store = new FakeStore()
    const vault = makeVault(store, now)
    await vault.store('c', 't', { accessToken: 'old', refreshToken: 'r1', expiresAt: past })

    const token = await vault.withCredential(
      'c',
      't',
      async (cred) => cred.accessToken,
      async (): Promise<StoredCredential> => ({
        accessToken: 'new',
        refreshToken: 'r2',
        expiresAt: future,
      }),
    )

    assert.equal(token, 'new')
    // The refreshed credential must be persisted, or every publish re-refreshes.
    const again = await vault.withCredential('c', 't', async (cred) => cred.accessToken)
    assert.equal(again, 'new')
  })

  test('refreshes inside the skew window, before actual expiry', async () => {
    const store = new FakeStore()
    const vault = makeVault(store, now)
    // Expires in 2 minutes; default skew is 5, so this must refresh.
    await vault.store('c', 't', {
      accessToken: 'old',
      refreshToken: 'r1',
      expiresAt: new Date('2026-01-01T01:02:00Z'),
    })

    const token = await vault.withCredential(
      'c',
      't',
      async (cred) => cred.accessToken,
      async () => ({ accessToken: 'new', expiresAt: future }),
    )
    assert.equal(token, 'new')
  })

  test('marks needs_reauth when expired with no refresh token', async () => {
    const store = new FakeStore()
    const vault = makeVault(store, now)
    await vault.store('c', 't', { accessToken: 'old', expiresAt: past })

    await assert.rejects(
      () => vault.withCredential('c', 't', async () => 1, async (cur) => cur),
      NeedsReauthError,
    )
    assert.equal(store.reauthCalls.length, 1)
  })

  test('marks needs_reauth when the refresh call fails', async () => {
    const store = new FakeStore()
    const vault = makeVault(store, now)
    await vault.store('c', 't', { accessToken: 'old', refreshToken: 'r1', expiresAt: past })

    await assert.rejects(
      () =>
        vault.withCredential(
          'c',
          't',
          async () => 1,
          async () => {
            throw new Error('platform said no')
          },
        ),
      NeedsReauthError,
    )
    assert.deepEqual(store.reauthCalls, [{ connectionId: 'c', reason: 'refresh failed' }])
  })

  test('a credential with no expiry is never treated as expiring', async () => {
    const store = new FakeStore()
    const vault = makeVault(store, now)
    await vault.store('c', 't', { accessToken: 'forever' })
    assert.equal(
      await vault.withCredential('c', 't', async (cred) => cred.accessToken),
      'forever',
    )
  })

  test('expiresAt survives the encrypt/decrypt round trip as a Date', async () => {
    const store = new FakeStore()
    const vault = makeVault(store, now)
    await vault.store('c', 't', { accessToken: 'x', expiresAt: future })
    await vault.withCredential('c', 't', async (cred) => {
      assert.ok(cred.expiresAt instanceof Date)
      assert.equal(cred.expiresAt.toISOString(), future.toISOString())
      return 1
    })
  })

  test('a refresh that returns only a new access token keeps the refresh token', async () => {
    // Google returns no new refresh token on refresh. Replacing the credential
    // with the reply would leave nothing to refresh with an hour later.
    const store = new FakeStore()
    const vault = makeVault(store, now)
    await vault.store('c', 't', {
      accessToken: 'old',
      refreshToken: 'r1',
      expiresAt: past,
      scopes: ['a'],
      authorisationExpiresAt: null,
    })

    await vault.withCredential('c', 't', async () => 1, async () => ({ accessToken: 'new', expiresAt: future }))

    await vault.withCredential('c', 't', async (cred) => {
      assert.equal(cred.accessToken, 'new')
      assert.equal(cred.refreshToken, 'r1')
      assert.deepEqual(cred.scopes, ['a'])
      assert.equal(cred.authorisationExpiresAt, null)
      return 1
    })
  })

  test('a transient refresh failure is passed on without marking the account dead', async () => {
    // One network blip during an hourly refresh must not disable a channel.
    const store = new FakeStore()
    const vault = makeVault(store, now)
    await vault.store('c', 't', { accessToken: 'old', refreshToken: 'r1', expiresAt: past })
    const blip = Object.assign(new Error('Could not reach Google'), { failureClass: 'transient' })

    await assert.rejects(
      () => vault.withCredential('c', 't', async () => 1, async () => { throw blip }),
      (error: unknown) => error === blip,
    )
    assert.deepEqual(store.reauthCalls, [])
  })

  test('a refused refresh keeps its cause, so the reason can be reported', async () => {
    const store = new FakeStore()
    const vault = makeVault(store, now)
    await vault.store('c', 't', { accessToken: 'old', refreshToken: 'r1', expiresAt: past })
    const refused = Object.assign(new Error('invalid_grant'), { failureClass: 'credential' })

    await assert.rejects(
      () => vault.withCredential('c', 't', async () => 1, async () => { throw refused }),
      (error: unknown) => {
        assert.ok(error instanceof NeedsReauthError)
        assert.equal(error.cause, refused)
        return true
      },
    )
    assert.equal(store.reauthCalls.length, 1)
  })

  test('a failure to save after a successful refresh does not mark the account dead', async () => {
    // The platform already said yes; a database hiccup is not a revoked token.
    const store = new FakeStore()
    const vault = makeVault(store, now)
    await vault.store('c', 't', { accessToken: 'old', refreshToken: 'r1', expiresAt: past })
    store.save = async () => {
      throw new Error('database unavailable')
    }

    await assert.rejects(
      () => vault.withCredential('c', 't', async () => 1, async () => ({ accessToken: 'new', expiresAt: future })),
      /database unavailable/,
    )
    assert.deepEqual(store.reauthCalls, [])
  })
})

describe('the expiry column records when the authorisation dies', () => {
  const hour = new Date('2026-01-01T02:00:00Z')
  const month = new Date('2026-02-01T00:00:00Z')

  test('without an authorisation expiry it follows the token expiry, as before', async () => {
    const store = new FakeStore()
    await makeVault(store).store('c', 't', { accessToken: 'x', expiresAt: month })
    assert.equal(store.rows.get('t:c')!.expiresAt?.toISOString(), month.toISOString())
  })

  test('an authorisation expiry is what the column records, not the hourly token', async () => {
    const store = new FakeStore()
    await makeVault(store).store('c', 't', { accessToken: 'x', expiresAt: hour, authorisationExpiresAt: month })
    assert.equal(store.rows.get('t:c')!.expiresAt?.toISOString(), month.toISOString())
  })

  test('null means no known end, and is written as null rather than the token expiry', async () => {
    // Otherwise the refresh runner marks a Google connection dead an hour in.
    const store = new FakeStore()
    await makeVault(store).store('c', 't', { accessToken: 'x', expiresAt: hour, authorisationExpiresAt: null })
    assert.equal(store.rows.get('t:c')!.expiresAt, null)
  })

  test('the authorisation expiry survives the round trip, as a Date or as null', async () => {
    const store = new FakeStore()
    const vault = makeVault(store, () => new Date('2026-01-01T00:00:00Z'))
    await vault.store('a', 't', { accessToken: 'x', expiresAt: hour, authorisationExpiresAt: month })
    await vault.store('b', 't', { accessToken: 'y', expiresAt: hour, authorisationExpiresAt: null })

    await vault.withCredential('a', 't', async (cred) => {
      assert.ok(cred.authorisationExpiresAt instanceof Date)
      assert.equal(cred.authorisationExpiresAt.toISOString(), month.toISOString())
      return 1
    })
    await vault.withCredential('b', 't', async (cred) => {
      assert.equal(cred.authorisationExpiresAt, null)
      return 1
    })
  })

  test('a refresh keeps the authorisation expiry in the column', async () => {
    const store = new FakeStore()
    const vault = makeVault(store, () => new Date('2026-01-01T03:00:00Z'))
    await vault.store('c', 't', { accessToken: 'old', refreshToken: 'r', expiresAt: hour, authorisationExpiresAt: null })

    await vault.withCredential(
      'c',
      't',
      async () => 1,
      async () => ({ accessToken: 'new', expiresAt: new Date('2026-01-01T04:00:00Z') }),
    )
    assert.equal(store.rows.get('t:c')!.expiresAt, null)
  })
})

describe('no credential escape hatch', () => {
  test('the vault exposes no method that returns a plaintext credential', () => {
    const vault = makeVault(new FakeStore())
    const methods = new Set<string>()
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(vault))) {
      methods.add(name)
    }
    // If a getToken/read/decrypt style accessor is ever added, this fails on purpose.
    assert.deepEqual([...methods].sort(), ['constructor', 'store', 'withCredential'])
  })

  test('a raw sealed blob is unreadable without going through the vault', () => {
    const blob = seal(JSON.stringify({ accessToken: 'tok' }), KEK, {
      tenantId: 't',
      keyVersion: 1,
    })
    assert.ok(!blob.includes('tok'))
  })
})
