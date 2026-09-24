import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  CAPABILITIES,
  PublishError,
  validateAgainstCapabilities,
  type Connection,
  type PlatformAdapter,
  type PostDraft,
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
