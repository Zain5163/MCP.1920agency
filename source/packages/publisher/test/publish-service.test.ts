import { strict as assert } from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, describe } from 'node:test'

import { YouTubeAdapter } from '@social-publisher/adapters'
import {
  CAPABILITIES,
  PublishError,
  validateAgainstCapabilities,
  type Connection,
  type PlatformAdapter,
  type PostDraft,
  type PublishContext,
  type PublishResult,
} from '@social-publisher/core'

import { PublishService, type TargetSpec } from '../src/publish-service.ts'

const connection = (over: Partial<Connection> = {}): Connection => ({
  id: 'conn-fb',
  tenantId: 't1',
  platform: 'facebook_page',
  platformAccountId: '111',
  displayName: '1920 Agency',
  credentialSource: 'platform_app',
  scopes: [],
  needsReauth: false,
  ...over,
})

const target = (conn: Connection, onToken?: (t: string) => void): TargetSpec => ({
  connection: conn,
  withCredential: async (fn) => {
    onToken?.('TOKEN')
    return await fn('TOKEN')
  },
})

/** Adapter whose publish behaviour is supplied per test. */
const fakeAdapter = (
  platform: Connection['platform'],
  publish: () => Promise<PublishResult>,
): PlatformAdapter => ({
  platform,
  capabilities: CAPABILITIES[platform],
  validate: (draft) => validateAgainstCapabilities(draft, platform, CAPABILITIES[platform]),
  publish,
})

const draft = (over: Partial<PostDraft> = {}): PostDraft => ({ body: 'hello', media: [], ...over })

describe('validate', () => {
  test('passes a valid draft for a supported platform', () => {
    const svc = new PublishService([fakeAdapter('facebook_page', async () => ({ platformPostId: '1' }))])
    assert.equal(svc.validate(draft(), ['facebook_page']).ok, true)
  })

  test('flags an unsupported platform rather than failing silently', () => {
    const svc = new PublishService([fakeAdapter('facebook_page', async () => ({ platformPostId: '1' }))])
    const report = svc.validate(draft(), ['tiktok'])
    assert.equal(report.ok, false)
    assert.equal(report.byPlatform.get('tiktok')![0]!.code, 'unsupported_platform')
  })

  test('reports per-platform issues separately', () => {
    const svc = new PublishService([
      fakeAdapter('facebook_page', async () => ({ platformPostId: '1' })),
      fakeAdapter('instagram', async () => ({ platformPostId: '2' })),
    ])
    // Instagram cannot post text alone; Facebook can.
    const report = svc.validate(draft(), ['facebook_page', 'instagram'])
    assert.equal(report.ok, false)
    assert.equal(report.byPlatform.get('facebook_page')!.length, 0)
    assert.ok(report.byPlatform.get('instagram')!.some((i) => i.code === 'media_required'))
  })
})

describe('publish', () => {
  const keys = { idempotencyKeyFor: (id: string) => `idem-${id}` }

  test('publishes to a single target and reports success', async () => {
    const svc = new PublishService([
      fakeAdapter('facebook_page', async () => ({ platformPostId: 'fb-1', url: 'https://fb/1' })),
    ])
    const report = await svc.publish(draft(), [target(connection())], keys)

    assert.equal(report.allSucceeded, true)
    assert.equal(report.succeeded[0]!.result!.platformPostId, 'fb-1')
    assert.equal(report.failed.length, 0)
  })

  test('obtains the credential through the vault callback, never directly', async () => {
    let handed = false
    const svc = new PublishService([
      fakeAdapter('facebook_page', async () => ({ platformPostId: '1' })),
    ])
    await svc.publish(draft(), [target(connection(), () => { handed = true })], keys)
    assert.equal(handed, true)
  })

  test('one platform failing does not stop the others', async () => {
    // The central reason posts and targets are separate: partial success is normal.
    const svc = new PublishService([
      fakeAdapter('facebook_page', async () => ({ platformPostId: 'fb-1' })),
      fakeAdapter('instagram', async () => {
        throw new PublishError('boom', { failureClass: 'permanent', platformMessage: 'Bad ratio' })
      }),
    ])

    const report = await svc.publish(
      draft({ media: [] }),
      [
        target(connection()),
        target(connection({ id: 'conn-ig', platform: 'instagram', displayName: 'IG' })),
      ],
      keys,
    )

    assert.equal(report.allSucceeded, false)
    assert.equal(report.succeeded.length, 1)
    assert.equal(report.succeeded[0]!.platform, 'facebook_page')
    assert.equal(report.failed.length, 1)
    assert.equal(report.failed[0]!.error!.message, 'Bad ratio')
  })

  test('marks transient failures retryable with a delay', async () => {
    const svc = new PublishService([
      fakeAdapter('facebook_page', async () => {
        throw new PublishError('rate limited', { failureClass: 'transient', retryAfterSeconds: 120 })
      }),
    ])
    const report = await svc.publish(draft(), [target(connection())], keys)

    assert.equal(report.failed[0]!.error!.retryable, true)
    assert.equal(report.failed[0]!.error!.retryAfterMs, 120_000)
  })

  test('marks permanent failures not retryable and gives no delay', async () => {
    const svc = new PublishService([
      fakeAdapter('facebook_page', async () => {
        throw new PublishError('nope', { failureClass: 'permanent' })
      }),
    ])
    const report = await svc.publish(draft(), [target(connection())], keys)

    assert.equal(report.failed[0]!.error!.retryable, false)
    assert.equal(report.failed[0]!.error!.retryAfterMs, undefined)
  })

  test('skips a connection already flagged as needing reauth', async () => {
    let called = false
    const svc = new PublishService([
      fakeAdapter('facebook_page', async () => {
        called = true
        return { platformPostId: '1' }
      }),
    ])
    const report = await svc.publish(
      draft(),
      [target(connection({ needsReauth: true }))],
      keys,
    )

    assert.equal(called, false, 'must not call the platform with a known-dead connection')
    assert.equal(report.failed[0]!.error!.failureClass, 'credential')
    assert.match(report.failed[0]!.error!.message, /needs reconnecting/i)
  })

  test('reports a missing adapter instead of throwing', async () => {
    const svc = new PublishService([])
    const report = await svc.publish(draft(), [target(connection())], keys)
    assert.equal(report.failed.length, 1)
    assert.match(report.failed[0]!.error!.message, /No adapter is built/)
  })

  test('passes a distinct idempotency key per connection', async () => {
    const seen: string[] = []
    const adapter: PlatformAdapter = {
      platform: 'facebook_page',
      capabilities: CAPABILITIES.facebook_page,
      validate: () => ({ ok: true, issues: [] }),
      publish: async (ctx) => {
        seen.push(ctx.idempotencyKey)
        return { platformPostId: 'x' }
      },
    }
    const svc = new PublishService([adapter])
    await svc.publish(
      draft(),
      [target(connection({ id: 'a' })), target(connection({ id: 'b' }))],
      keys,
    )
    assert.deepEqual(seen.sort(), ['idem-a', 'idem-b'])
  })

  test("carries the adapter's notice through, so a private upload is never reported as published", async () => {
    const svc = new PublishService([
      fakeAdapter('facebook_page', async () => ({
        platformPostId: 'v1',
        notice: 'Uploaded as private: the project has not passed the audit.',
      })),
    ])
    const report = await svc.publish(draft(), [target(connection())], keys)
    assert.equal(report.succeeded[0]!.result!.notice, 'Uploaded as private: the project has not passed the audit.')
  })

  test('passes the precise catalogue code through when the adapter names one', async () => {
    const svc = new PublishService([
      fakeAdapter('facebook_page', async () => {
        throw new PublishError('out of quota', { failureClass: 'transient', code: 'QUOTA_EXHAUSTED' })
      }),
    ])
    const report = await svc.publish(draft(), [target(connection())], keys)
    assert.equal(report.failed[0]!.error!.code, 'QUOTA_EXHAUSTED')
  })

  test('leaves the code out when the adapter did not name one', async () => {
    const svc = new PublishService([
      fakeAdapter('facebook_page', async () => {
        throw new PublishError('nope', { failureClass: 'permanent' })
      }),
    ])
    const report = await svc.publish(draft(), [target(connection())], keys)
    assert.equal(report.failed[0]!.error!.code, undefined)
  })

  test('a credential the vault refused is a credential failure, not a rejected post', async () => {
    // Reported as permanent, the worker filed it as failed and MCP said the
    // platform refused the content, when the fix was to reconnect.
    class NeedsReauthError extends Error {
      constructor(message: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = 'NeedsReauthError'
      }
    }
    const svc = new PublishService([fakeAdapter('facebook_page', async () => ({ platformPostId: '1' }))])
    const dead: TargetSpec = {
      connection: connection(),
      withCredential: async () => {
        throw new NeedsReauthError('Credential refresh failed. Reconnect the account.', {
          cause: new PublishError('Google refused to renew', {
            failureClass: 'credential',
            platformMessage: 'Token has been expired or revoked.',
            platformCode: 'invalid_grant',
            code: 'GOOGLE_TOKEN_REVOKED',
          }),
        })
      },
    }

    const report = await svc.publish(draft(), [dead], keys)
    const error = report.failed[0]!.error!
    assert.equal(error.failureClass, 'credential')
    assert.equal(error.retryable, false)
    assert.equal(error.code, 'GOOGLE_TOKEN_REVOKED')
    assert.equal(error.platformCode, 'invalid_grant')
    assert.match(error.message, /Reconnect the account\. Token has been expired or revoked\./)
  })

  test('a refused credential with no recorded cause is still a credential failure', async () => {
    const svc = new PublishService([fakeAdapter('facebook_page', async () => ({ platformPostId: '1' }))])
    const dead: TargetSpec = {
      connection: connection(),
      withCredential: async () => {
        throw Object.assign(new Error('Credential expired and cannot be refreshed. Reconnect the account.'), {
          name: 'NeedsReauthError',
        })
      },
    }
    const report = await svc.publish(draft(), [dead], keys)
    assert.equal(report.failed[0]!.error!.failureClass, 'credential')
    assert.equal(report.failed[0]!.error!.code, undefined)
  })

  test('a non-PublishError is still reported, not swallowed', async () => {
    const svc = new PublishService([
      fakeAdapter('facebook_page', async () => {
        throw new TypeError('unexpected')
      }),
    ])
    const report = await svc.publish(draft(), [target(connection())], keys)
    assert.equal(report.failed[0]!.error!.message, 'unexpected')
    assert.equal(report.failed[0]!.error!.retryable, false)
  })

  test("hands the caller's renewal to the adapter as renewAccessToken, and nothing when there is none", async () => {
    const contexts: PublishContext[] = []
    const adapter: PlatformAdapter = {
      platform: 'facebook_page',
      capabilities: CAPABILITIES.facebook_page,
      validate: () => ({ ok: true, issues: [] }),
      publish: async (ctx) => {
        contexts.push(ctx)
        return { platformPostId: ctx.renewAccessToken === undefined ? 'no renewal' : await ctx.renewAccessToken() }
      },
    }
    const renewing: TargetSpec = {
      connection: connection({ id: 'a' }),
      withCredential: async (fn) => await fn('TOKEN', async () => 'RENEWED'),
    }
    const report = await new PublishService([adapter]).publish(draft(), [renewing, target(connection({ id: 'b' }))], keys)

    assert.deepEqual(
      report.succeeded.map((o) => o.result!.platformPostId),
      ['RENEWED', 'no renewal'],
    )
    // Absent, not undefined: an adapter tells "cannot renew" by the key's absence.
    assert.equal('renewAccessToken' in contexts.find((c) => c.connection.id === 'b')!, false)
  })

  test('an upload that outlives its token finishes in one attempt when the caller renews inside the vault callback', async () => {
    // The contract the apps follow: `renew` is built inside the vault callback
    // from the adapter's refreshCredential, merges what the refresh returned
    // into the credential (as the vault does, so the refresh token survives)
    // and stores the result before handing the new token over.
    const dir = await mkdtemp(join(tmpdir(), 'pub-yt-'))
    const file = join(dir, 'clip.mp4')
    const size = 3 * 262_144
    await writeFile(file, Buffer.alloc(size, 1))

    let stored: { accessToken: string; refreshToken?: string; expiresAt?: Date } = {
      accessToken: 'ya29.OLD',
      refreshToken: '1//KEEP',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    }
    const refreshCredential = async () => ({ accessToken: 'ya29.NEW', expiresAt: new Date(Date.now() + 3_600_000) })

    const session = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=S1'
    const puts: string[] = []
    let held = 0
    let sessions = 0
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers as Record<string, string> | undefined) ?? {}
      const auth = headers.Authorization ?? ''
      if (String(url).includes('/youtube/v3/channels')) return new Response(JSON.stringify({ items: [{ id: 'UC1' }] }))
      if (init?.method === 'POST') {
        sessions += 1
        return new Response(null, { status: 200, headers: { location: session } })
      }
      if (init?.method === 'GET') return new Response(JSON.stringify({ items: [{ status: { privacyStatus: 'private' } }] }))
      const range = headers['Content-Range'] ?? ''
      puts.push(`${range} ${auth}`)
      // The old token runs out after the first chunk.
      if (auth === 'Bearer ya29.OLD' && held > 0) return new Response(null, { status: 401 })
      if (range.startsWith('bytes */')) return new Response(null, { status: 308, headers: { range: `bytes=0-${held - 1}` } })
      const last = Number(/bytes \d+-(\d+)\//.exec(range)![1])
      held = last + 1
      if (held === size) {
        return new Response(JSON.stringify({ id: 'VID1', status: { privacyStatus: 'private' } }), { status: 201 })
      }
      return new Response(null, { status: 308, headers: { range: `bytes=0-${last}` } })
    }) as unknown as typeof globalThis.fetch

    const youtube = new YouTubeAdapter({ fetch: fetchImpl, chunkBytes: 262_144, sleep: async () => {} })
    const channel: TargetSpec = {
      connection: connection({ id: 'conn-yt', platform: 'youtube', platformAccountId: 'UC1' }),
      withCredential: async (fn) => {
        let current = stored // what the vault hands to its callback
        const renew = async (): Promise<string> => {
          current = { ...current, ...(await refreshCredential()) }
          stored = current // vault.store(connectionId, tenantId, current)
          return current.accessToken
        }
        return await fn(current.accessToken, renew)
      },
    }

    const report = await new PublishService([youtube]).publish(
      draft({ body: 'Launch day\nWe shipped it.', media: [{ id: 'v', kind: 'video', mime: 'video/mp4', bytes: size, localPath: file }] }),
      [channel],
      keys,
    )

    assert.equal(report.allSucceeded, true, JSON.stringify(report.failed[0]?.error))
    assert.equal(report.succeeded[0]!.result!.platformPostId, 'VID1')
    assert.equal(sessions, 1, 'one session: the upload carried on rather than starting again')
    assert.deepEqual(puts, [
      `bytes 0-262143/${size} Bearer ya29.OLD`,
      `bytes 262144-524287/${size} Bearer ya29.OLD`,
      `bytes */${size} Bearer ya29.NEW`,
      `bytes 262144-524287/${size} Bearer ya29.NEW`,
      `bytes 524288-786431/${size} Bearer ya29.NEW`,
    ])
    assert.equal(stored.accessToken, 'ya29.NEW', 'the renewed token is stored for the next publish')
    assert.equal(stored.refreshToken, '1//KEEP', 'merged, so the refresh token survives')
  })

  test('targets publish concurrently rather than one after another', async () => {
    let active = 0
    let peak = 0
    const slow = async (): Promise<PublishResult> => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 20))
      active -= 1
      return { platformPostId: 'x' }
    }
    const svc = new PublishService([fakeAdapter('facebook_page', slow)])
    await svc.publish(
      draft(),
      [target(connection({ id: 'a' })), target(connection({ id: 'b' }))],
      keys,
    )
    assert.equal(peak, 2)
  })
})
