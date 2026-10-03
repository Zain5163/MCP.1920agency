import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { describe, test } from 'node:test'

import { capabilitiesFor, type PlatformAdapter } from '@social-publisher/core'
import { PublishService } from '@social-publisher/publisher'
import { TokenVault, type CredentialRecord, type CredentialStore, type StoredCredential } from '@social-publisher/vault'

import { credentialFor } from '../src/credential.ts'

/**
 * The renewal the CLI hands an adapter mid-publish (findings #1, #2, #8).
 *
 * Run against the real vault with an in-memory store, because what matters is
 * what ends up stored: the merged credential, the refresh token kept, and the
 * authorisation's "no end" not overwritten by the new token's hour.
 */

class MemoryStore implements CredentialStore {
  rows = new Map<string, CredentialRecord>()
  reauth: string[] = []
  failSaves = false

  async load(connectionId: string, tenantId: string): Promise<CredentialRecord | null> {
    return this.rows.get(`${tenantId}:${connectionId}`) ?? null
  }

  async save(record: { connectionId: string; tenantId: string; secretCiphertext: string; keyVersion: number; expiresAt: Date | null }): Promise<void> {
    if (this.failSaves) throw new Error('connection pool exhausted')
    this.rows.set(`${record.tenantId}:${record.connectionId}`, {
      connectionId: record.connectionId,
      tenantId: record.tenantId,
      secretCiphertext: record.secretCiphertext,
      expiresAt: record.expiresAt,
    })
  }

  async markNeedsReauth(connectionId: string, _tenantId: string, reason: string): Promise<void> {
    this.reauth.push(`${connectionId}:${reason}`)
  }
}

const connection = { id: 'conn-yt', tenantId: 'tenant-1', displayName: 'PSX Ascend' }
const HOUR = 3_600_000

async function setUp(credential: StoredCredential): Promise<{ vault: TokenVault; store: MemoryStore }> {
  const store = new MemoryStore()
  const vault = new TokenVault({ kek: randomBytes(32), keyVersion: 1, store })
  await vault.store(connection.id, connection.tenantId, credential)
  return { vault, store }
}

/** What the vault holds now, read the way an adapter would get it. */
async function storedNow(vault: TokenVault): Promise<StoredCredential> {
  return await vault.withCredential(connection.id, connection.tenantId, async (cred) => cred)
}

describe('the CLI hands an adapter a way to renew its token mid-publish', () => {
  test('renew starts from the latest credential, stores the merged result and resolves to the new token', async () => {
    const { vault, store } = await setUp({
      accessToken: 'ya29.OLD',
      refreshToken: '1//KEEP',
      expiresAt: new Date(Date.now() + 30 * 60_000),
      authorisationExpiresAt: null,
    })
    const given: StoredCredential[] = []
    let issued = 0
    const refresh = async (current: StoredCredential): Promise<StoredCredential> => {
      given.push(current)
      issued += 1
      return { accessToken: `ya29.NEW${issued}`, expiresAt: new Date(Date.now() + HOUR) }
    }

    const withCredential = credentialFor(vault, connection, refresh, () => {})
    const seen = await withCredential(async (token, renew) => {
      assert.ok(renew !== undefined, 'a renewable credential comes with a renewal')
      return [token, await renew(), await renew()]
    })

    assert.deepEqual(seen, ['ya29.OLD', 'ya29.NEW1', 'ya29.NEW2'])
    assert.deepEqual(
      given.map((c) => c.accessToken),
      ['ya29.OLD', 'ya29.NEW1'],
      'the second renewal starts from the first one, not from what the vault handed over',
    )
    assert.ok(given.every((c) => c.refreshToken === '1//KEEP'))

    const after = await storedNow(vault)
    assert.equal(after.accessToken, 'ya29.NEW2', 'the renewed token is kept for the next publish')
    assert.equal(after.refreshToken, '1//KEEP', 'merged, so the refresh token survives')
    assert.equal(after.authorisationExpiresAt, null)
    assert.equal(
      store.rows.get('tenant-1:conn-yt')!.expiresAt,
      null,
      "the authorisation's expiry column keeps \"no end\", not the token's hour",
    )
    assert.deepEqual(store.reauth, [])
  })

  test('there is no renewal without a refresh function or without a refresh token', async () => {
    const renewable = await setUp({ accessToken: 'tok', refreshToken: 'r', expiresAt: new Date(Date.now() + HOUR) })
    const noRefreshFn = await credentialFor(renewable.vault, connection, undefined, () => {})(
      async (_token, renew) => renew,
    )
    assert.equal(noRefreshFn, undefined)

    const plain = await setUp({ accessToken: 'page-token' })
    const noRefreshToken = await credentialFor(plain.vault, connection, async (c) => c, () => {})(
      async (_token, renew) => renew,
    )
    assert.equal(noRefreshToken, undefined, 'a token that cannot be renewed is offered no renewal')
  })

  test('a renewed token that cannot be saved is still handed over, and the failure is logged without it', async () => {
    const { vault, store } = await setUp({ accessToken: 'ya29.OLD', refreshToken: '1//KEEP', expiresAt: new Date(Date.now() + HOUR) })
    store.failSaves = true
    const logged: string[] = []
    const token = await credentialFor(vault, connection, async () => ({ accessToken: 'ya29.NEW' }), (m) => logged.push(m))(
      async (_token, renew) => await renew!(),
    )

    assert.equal(token, 'ya29.NEW', 'the upload carries on: the token is valid whether or not it was saved')
    assert.equal(logged.length, 1)
    assert.match(logged[0]!, /PSX Ascend.*could not save/)
    assert.doesNotMatch(logged[0]!, /ya29|1\/\/KEEP/, 'no token in the log')
  })

  test('a refresh failure reaches the adapter unchanged and marks nothing', async () => {
    const { vault, store } = await setUp({ accessToken: 'ya29.OLD', refreshToken: '1//KEEP', expiresAt: new Date(Date.now() + HOUR) })
    const failure = Object.assign(new Error('Google did not answer'), { failureClass: 'transient' })
    const caught = await credentialFor(vault, connection, async () => { throw failure }, () => {})(async (_token, renew) => {
      try {
        await renew!()
        return undefined
      } catch (error) {
        return error
      }
    })

    assert.equal(caught, failure, 'the adapter classifies it; nothing here rewraps it')
    assert.deepEqual(store.reauth, [], 'a failed renewal is not a dead connection')
    assert.equal((await storedNow(vault)).accessToken, 'ya29.OLD')
  })

  test('through the publisher, the adapter receives the renewal as renewAccessToken', async () => {
    const { vault } = await setUp({ accessToken: 'ya29.OLD', refreshToken: '1//KEEP', expiresAt: new Date(Date.now() + HOUR) })
    const adapter: PlatformAdapter = {
      platform: 'youtube',
      capabilities: capabilitiesFor('youtube'),
      validate: () => ({ ok: true, issues: [] }),
      // Stands in for an upload whose token runs out partway.
      publish: async (ctx) => ({ platformPostId: `${ctx.credential.accessToken}>${await ctx.renewAccessToken!()}` }),
    }
    const report = await new PublishService([adapter]).publish(
      { body: 'Launch day', media: [] },
      [
        {
          connection: {
            ...connection,
            platform: 'youtube',
            platformAccountId: 'UC1',
            credentialSource: 'platform_app',
            scopes: [],
            needsReauth: false,
          },
          withCredential: credentialFor(vault, connection, async () => ({ accessToken: 'ya29.NEW' }), () => {}),
        },
      ],
      { idempotencyKeyFor: () => 'post-1:conn-yt' },
    )

    assert.equal(report.succeeded[0]?.result?.platformPostId, 'ya29.OLD>ya29.NEW', JSON.stringify(report.failed[0]?.error))
  })
})
