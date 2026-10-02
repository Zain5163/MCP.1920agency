import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { PublishError, type MediaRef, type PlatformAdapter, type PublishContext } from '@social-publisher/core'

import { FacebookPageAdapter } from '../src/facebook.ts'
import { InstagramAdapter } from '../src/instagram.ts'
import { LinkedInAdapter } from '../src/linkedin.ts'
import { PinterestAdapter } from '../src/pinterest.ts'
import { ThreadsAdapter } from '../src/threads.ts'
import { YouTubeAdapter } from '../src/youtube.ts'

/**
 * A document (a PDF carousel) is a LinkedIn post kind. Every other adapter must
 * refuse one at validation and never touch the network for it: a platform
 * handed a PDF as if it were an image fails later, and less clearly.
 */

const pdf: MediaRef = {
  id: 'd1',
  kind: 'document',
  mime: 'application/pdf',
  bytes: 1_000,
  localPath: 'D:/assets/carousel.pdf',
  publicUrl: 'https://media.example.com/t1/carousel.pdf',
}

function counting(): { fetch: typeof globalThis.fetch; calls: () => number } {
  let count = 0
  const fetchImpl = (async () => {
    count += 1
    return new Response('{}', { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetch: fetchImpl, calls: () => count }
}

const ctx = (adapter: PlatformAdapter): PublishContext => ({
  connection: {
    id: 'c1',
    tenantId: 't1',
    platform: adapter.platform,
    platformAccountId: 'acct-1',
    displayName: 'Test account',
    credentialSource: 'platform_app',
    scopes: [],
    needsReauth: false,
  },
  credential: { accessToken: 'TOKEN' },
  idempotencyKey: 'idem-1',
})

describe('only the LinkedIn adapter takes a document', () => {
  const others: Array<() => { adapter: PlatformAdapter; calls: () => number }> = [
    () => {
      const f = counting()
      return { adapter: new FacebookPageAdapter({ fetch: f.fetch }), calls: f.calls }
    },
    () => {
      const f = counting()
      return { adapter: new InstagramAdapter({ fetch: f.fetch }), calls: f.calls }
    },
    () => {
      const f = counting()
      return { adapter: new ThreadsAdapter({ fetch: f.fetch }), calls: f.calls }
    },
    () => {
      const f = counting()
      return { adapter: new PinterestAdapter({ fetch: f.fetch }), calls: f.calls }
    },
    () => {
      const f = counting()
      return { adapter: new YouTubeAdapter({ fetch: f.fetch }), calls: f.calls }
    },
  ]

  for (const make of others) {
    const { adapter } = make()
    test(`${adapter.platform} refuses a document at validation, and publishes nothing`, async () => {
      const { adapter: fresh, calls } = make()
      const draft = { body: 'A carousel', title: 'Title', media: [pdf] }

      const validation = fresh.validate(draft)
      assert.equal(validation.ok, false)
      assert.ok(
        validation.issues.some((i) => i.severity === 'error' && i.code === 'unsupported_media_kind'),
        validation.issues.map((i) => i.code).join(', '),
      )

      await assert.rejects(
        () => fresh.publish(ctx(fresh), draft),
        (error: unknown) => {
          assert.ok(error instanceof PublishError)
          assert.equal(error.failureClass, 'permanent')
          return true
        },
      )
      assert.equal(calls(), 0, 'no request may be made for a draft the platform cannot take')
    })
  }

  test('the LinkedIn adapter accepts the same document', () => {
    const validation = new LinkedInAdapter().validate({ body: 'A carousel', title: 'Title', media: [pdf] })
    assert.equal(validation.ok, true, validation.issues.map((i) => i.message).join('; '))
  })
})
