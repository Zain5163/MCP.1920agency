import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { PublishError, type MediaRef, type PostDraft, type PublishContext } from '@social-publisher/core'

import { InstagramAdapter } from '../src/instagram.ts'

interface Call {
  method: string
  path: string
  params: Record<string, string>
}

function mockGraph(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  let index = 0

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    const params: Record<string, string> = {}
    for (const [k, v] of u.searchParams) params[k] = v
    if (typeof init?.body === 'object' && init.body instanceof URLSearchParams) {
      for (const [k, v] of init.body) params[k] = v
    }
    calls.push({ method: init?.method ?? 'GET', path: u.pathname, params })

    const next = responses[Math.min(index, responses.length - 1)]!
    index += 1
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as unknown as typeof globalThis.fetch

  return { fetchImpl, calls }
}

const ctx = (): PublishContext => ({
  connection: {
    id: 'conn-ig',
    tenantId: 't1',
    platform: 'instagram',
    platformAccountId: '17841452630711887',
    displayName: '1920 Agency IG',
    credentialSource: 'platform_app',
    scopes: ['instagram_content_publish'],
    needsReauth: false,
  },
  credential: { accessToken: 'IG_TOKEN' },
  idempotencyKey: 'idem-1',
})

const img = (over: Partial<MediaRef> = {}): MediaRef => ({
  id: 'm1',
  kind: 'image',
  mime: 'image/jpeg',
  bytes: 100,
  publicUrl: 'https://media.example.com/a.jpg',
  ...over,
})

const vid = (over: Partial<MediaRef> = {}): MediaRef => ({
  id: 'v1',
  kind: 'video',
  mime: 'video/mp4',
  bytes: 5000,
  publicUrl: 'https://media.example.com/a.mp4',
  durationSeconds: 30,
  ...over,
})

const draft = (over: Partial<PostDraft> = {}): PostDraft => ({
  body: 'Caption here',
  media: [img()],
  ...over,
})

const make = (responses: Array<{ status?: number; body: unknown }>) => {
  const { fetchImpl, calls } = mockGraph(responses)
  return {
    ig: new InstagramAdapter({
      fetch: fetchImpl,
      apiVersion: 'v25.0',
      sleep: async () => {},
      pollIntervalMs: 1,
    }),
    calls,
  }
}

const FINISHED = { body: { status_code: 'FINISHED' } }

describe('single image', () => {
  test('creates a container, waits, then publishes', async () => {
    const { ig, calls } = make([
      { body: { id: 'container-1' } },
      FINISHED,
      { body: { id: 'media-99' } },
    ])
    const result = await ig.publish(ctx(), draft())

    assert.equal(calls[0]!.method, 'POST')
    assert.ok(calls[0]!.path.endsWith('/17841452630711887/media'))
    assert.equal(calls[0]!.params.image_url, 'https://media.example.com/a.jpg')
    assert.equal(calls[0]!.params.caption, 'Caption here')

    assert.equal(calls[1]!.method, 'GET')

    assert.equal(calls[2]!.method, 'POST')
    assert.ok(calls[2]!.path.endsWith('/media_publish'))
    assert.equal(calls[2]!.params.creation_id, 'container-1')

    assert.equal(result.platformPostId, 'media-99')
  })

  test('sends the token as a Bearer header, not in the URL', async () => {
    const { ig, calls } = make([{ body: { id: 'c' } }, FINISHED, { body: { id: 'm' } }])
    await ig.publish(ctx(), draft())
    for (const c of calls) assert.ok(!JSON.stringify(c.params).includes('IG_TOKEN'))
  })
})

describe('video / reels', () => {
  test('publishes a video as a Reel with video_url', async () => {
    const { ig, calls } = make([{ body: { id: 'c' } }, FINISHED, { body: { id: 'm' } }])
    await ig.publish(ctx(), draft({ media: [vid()] }))

    assert.equal(calls[0]!.params.video_url, 'https://media.example.com/a.mp4')
    assert.equal(calls[0]!.params.media_type, 'REELS')
  })

  test('polls until processing finishes rather than publishing early', async () => {
    // Publishing an IN_PROGRESS container fails with a misleading error, so the
    // wait is required for correctness, not just politeness.
    const { ig, calls } = make([
      { body: { id: 'c' } },
      { body: { status_code: 'IN_PROGRESS' } },
      { body: { status_code: 'IN_PROGRESS' } },
      { body: { status_code: 'FINISHED' } },
      { body: { id: 'm' } },
    ])
    const result = await ig.publish(ctx(), draft({ media: [vid()] }))

    const gets = calls.filter((c) => c.method === 'GET')
    assert.equal(gets.length, 3)
    assert.equal(result.platformPostId, 'm')
  })

  test('treats a processing ERROR as permanent', async () => {
    const { ig } = make([
      { body: { id: 'c' } },
      { body: { status_code: 'ERROR', status: 'Video format not supported' } },
    ])
    try {
      await ig.publish(ctx(), draft({ media: [vid()] }))
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'permanent')
      assert.equal(error.platformMessage, 'Video format not supported')
    }
  })

  test('treats an expired container as permanent', async () => {
    const { ig } = make([{ body: { id: 'c' } }, { body: { status_code: 'EXPIRED' } }])
    try {
      await ig.publish(ctx(), draft({ media: [vid()] }))
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'permanent')
    }
  })

  test('treats a processing timeout as transient so it can retry', async () => {
    const { fetchImpl } = mockGraph([{ body: { id: 'c' } }, { body: { status_code: 'IN_PROGRESS' } }])
    const ig = new InstagramAdapter({
      fetch: fetchImpl,
      sleep: async () => {},
      pollIntervalMs: 10,
      processingTimeoutMs: 0,
    })
    try {
      await ig.publish(ctx(), draft({ media: [vid()] }))
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'transient')
      assert.equal(error.isRetryable, true)
    }
  })
})

describe('carousel', () => {
  test('creates child containers, waits for each, then a parent', async () => {
    const { ig, calls } = make([
      { body: { id: 'child-1' } },
      { body: { id: 'child-2' } },
      FINISHED,
      FINISHED,
      { body: { id: 'parent-1' } },
      FINISHED,
      { body: { id: 'media-carousel' } },
    ])
    const result = await ig.publish(
      ctx(),
      draft({ media: [img({ id: 'a' }), img({ id: 'b', publicUrl: 'https://media.example.com/b.jpg' })] }),
    )

    assert.equal(calls[0]!.params.is_carousel_item, 'true')
    assert.equal(calls[1]!.params.is_carousel_item, 'true')

    const parent = calls.find((c) => c.params.media_type === 'CAROUSEL')
    assert.ok(parent !== undefined, 'expected a CAROUSEL parent container')
    assert.equal(parent.params.children, 'child-1,child-2')
    assert.equal(parent.params.caption, 'Caption here')

    assert.equal(result.platformPostId, 'media-carousel')
  })
})

describe('validation', () => {
  test('refuses a text-only post without calling the API', async () => {
    const { ig, calls } = make([{ body: { id: 'c' } }])
    await assert.rejects(() => ig.publish(ctx(), draft({ media: [] })), PublishError)
    assert.equal(calls.length, 0)
  })

  test('refuses media with no public URL, since there is no upload fallback', async () => {
    const { ig, calls } = make([{ body: { id: 'c' } }])
    try {
      await ig.publish(ctx(), draft({ media: [img({ publicUrl: undefined, localPath: 'C:\\a.jpg' })] }))
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'permanent')
      assert.equal(calls.length, 0)
    }
  })

  test('refuses a caption over the 2200 character limit', async () => {
    const { ig } = make([{ body: { id: 'c' } }])
    await assert.rejects(
      () => ig.publish(ctx(), draft({ body: 'x'.repeat(2201) })),
      /not valid for Instagram/,
    )
  })
})

describe('errors', () => {
  test('an expired token is a credential failure', async () => {
    const { ig } = make([
      { status: 400, body: { error: { message: 'Token expired', code: 190 } } },
    ])
    try {
      await ig.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'credential')
    }
  })

  test('a rate limit is transient', async () => {
    const { ig } = make([{ status: 400, body: { error: { message: 'limit', code: 4 } } }])
    try {
      await ig.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'transient')
    }
  })
})

describe('quota', () => {
  test('reports remaining posts in the 24h window', async () => {
    const { fetchImpl } = mockGraph([
      { body: { data: [{ quota_usage: 12, config: { quota_total: 100 } }] } },
    ])
    const ig = new InstagramAdapter({ fetch: fetchImpl })
    assert.equal(await ig.remainingQuota(ctx()), 88)
  })

  test('never lets a quota lookup failure block publishing', async () => {
    const { fetchImpl } = mockGraph([{ status: 500, body: {} }])
    const ig = new InstagramAdapter({ fetch: fetchImpl })
    assert.equal(await ig.remainingQuota(ctx()), undefined)
  })
})

describe('carousel ordering', () => {
  test('children are created and attached in the order given', async () => {
    // The order the composer shows must be the order Instagram receives. This is
    // the one thing people get wrong about carousels, and it is invisible until
    // the post is already live.
    const { fetchImpl, calls } = mockGraph([
      { body: { id: 'child-1' } },
      { body: { id: 'child-2' } },
      { body: { id: 'child-3' } },
      FINISHED,
      FINISHED,
      FINISHED,
      { body: { id: 'parent' } },
      FINISHED,
      { body: { id: 'published' } },
    ])
    const ig = new InstagramAdapter({ fetch: fetchImpl, sleep: async () => {}, pollIntervalMs: 1 })

    await ig.publish(
      ctx(),
      draft({
        media: ['first', 'second', 'third'].map((name) =>
          img({ id: name, publicUrl: `https://media.example.com/${name}.jpg` }),
        ),
      }),
    )

    const children = calls
      .filter((c) => c.params.is_carousel_item === 'true')
      .map((c) => c.params.image_url)

    assert.deepEqual(children, [
      'https://media.example.com/first.jpg',
      'https://media.example.com/second.jpg',
      'https://media.example.com/third.jpg',
    ])

    const parent = calls.find((c) => c.params.media_type === 'CAROUSEL')
    assert.ok(parent !== undefined)
    assert.equal(parent.params.children, 'child-1,child-2,child-3')
  })
})
