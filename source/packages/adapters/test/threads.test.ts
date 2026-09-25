import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { PublishError, type MediaRef, type PostDraft, type PublishContext } from '@social-publisher/core'

import { ThreadsAdapter } from '../src/threads.ts'
import { ThreadsProvider, buildThreadsAuthUrl, THREADS_SCOPES } from '../src/threads-provider.ts'

interface Call {
  method: string
  url: string
  path: string
  params: Record<string, string>
  auth: string | undefined
}

function mockThreads(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  let index = 0

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    const params: Record<string, string> = {}
    for (const [k, v] of u.searchParams) params[k] = v
    if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) params[k] = v

    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      path: u.pathname,
      params,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    })

    const next = responses[Math.min(index, responses.length - 1)]!
    index += 1
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as unknown as typeof globalThis.fetch

  return { fetchImpl, calls }
}

const ctx = (): PublishContext => ({
  connection: {
    id: 'conn-th',
    tenantId: 't1',
    platform: 'threads',
    platformAccountId: '9876543210',
    displayName: '1920agency',
    credentialSource: 'platform_app',
    scopes: ['threads_basic', 'threads_content_publish'],
    needsReauth: false,
  },
  credential: { accessToken: 'TH_TOKEN' },
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

const draft = (over: Partial<PostDraft> = {}): PostDraft => ({ body: 'Hello Threads', media: [], ...over })

const make = (responses: Array<{ status?: number; body: unknown }>) => {
  const { fetchImpl, calls } = mockThreads(responses)
  return {
    th: new ThreadsAdapter({ fetch: fetchImpl, sleep: async () => {}, pollIntervalMs: 1 }),
    calls,
  }
}

const READY = { body: { status: 'FINISHED' } }

describe('text posts', () => {
  test('publishes text alone, which Instagram cannot do', async () => {
    const { th, calls } = make([{ body: { id: 'c1' } }, READY, { body: { id: 'post-1' } }])
    const result = await th.publish(ctx(), draft())

    assert.ok(calls[0]!.path.endsWith('/9876543210/threads'))
    assert.equal(calls[0]!.params.media_type, 'TEXT')
    assert.equal(calls[0]!.params.text, 'Hello Threads')
    assert.equal(result.platformPostId, 'post-1')
  })

  test('targets graph.threads.net, not the Facebook Graph API', async () => {
    // The mistake this guards against: assuming Threads rides on Facebook.
    const { th, calls } = make([{ body: { id: 'c' } }, READY, { body: { id: 'p' } }])
    await th.publish(ctx(), draft())
    for (const call of calls) {
      assert.ok(call.url.startsWith('https://graph.threads.net/'), `wrong host: ${call.url}`)
      assert.ok(!call.url.includes('graph.facebook.com'))
    }
  })

  test('sends the token as a Bearer header, never in the URL', async () => {
    const { th, calls } = make([{ body: { id: 'c' } }, READY, { body: { id: 'p' } }])
    await th.publish(ctx(), draft())
    assert.equal(calls[0]!.auth, 'Bearer TH_TOKEN')
    for (const call of calls) assert.ok(!call.url.includes('TH_TOKEN'))
  })
})

describe('media posts', () => {
  test('publishes a single image', async () => {
    const { th, calls } = make([{ body: { id: 'c' } }, READY, { body: { id: 'p' } }])
    await th.publish(ctx(), draft({ media: [img()] }))

    assert.equal(calls[0]!.params.media_type, 'IMAGE')
    assert.equal(calls[0]!.params.image_url, 'https://media.example.com/a.jpg')
  })

  test('builds a carousel in the given order', async () => {
    const { th, calls } = make([
      { body: { id: 'child-1' } },
      { body: { id: 'child-2' } },
      READY,
      READY,
      { body: { id: 'parent' } },
      READY,
      { body: { id: 'published' } },
    ])

    await th.publish(
      ctx(),
      draft({
        media: [
          img({ id: 'a', publicUrl: 'https://media.example.com/first.jpg' }),
          img({ id: 'b', publicUrl: 'https://media.example.com/second.jpg' }),
        ],
      }),
    )

    const children = calls
      .filter((c) => c.params.is_carousel_item === 'true')
      .map((c) => c.params.image_url)
    assert.deepEqual(children, [
      'https://media.example.com/first.jpg',
      'https://media.example.com/second.jpg',
    ])

    const parent = calls.find((c) => c.params.media_type === 'CAROUSEL')
    assert.ok(parent !== undefined)
    assert.equal(parent.params.children, 'child-1,child-2')
  })

  test('refuses media with no public URL — there is no upload path', async () => {
    const { th, calls } = make([{ body: { id: 'c' } }])
    await assert.rejects(
      () => th.publish(ctx(), draft({ media: [img({ publicUrl: undefined, localPath: 'C:/a.jpg' })] })),
      PublishError,
    )
    assert.equal(calls.length, 0)
  })
})

describe('validation and errors', () => {
  test('refuses text over the 500 character limit', async () => {
    const { th, calls } = make([{ body: { id: 'c' } }])
    await assert.rejects(() => th.publish(ctx(), draft({ body: 'x'.repeat(501) })), PublishError)
    assert.equal(calls.length, 0)
  })

  test('a processing error is permanent', async () => {
    const { th } = make([
      { body: { id: 'c' } },
      { body: { status: 'ERROR', error_message: 'Unsupported format' } },
    ])
    try {
      await th.publish(ctx(), draft({ media: [img()] }))
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'permanent')
      assert.equal(error.platformMessage, 'Unsupported format')
    }
  })

  test('an expired token is a credential failure, via the shared Meta classifier', async () => {
    const { th } = make([{ status: 400, body: { error: { message: 'expired', code: 190 } } }])
    try {
      await th.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'credential')
    }
  })
})

describe('authorisation', () => {
  const config = {
    appId: 'TH_APP',
    appSecret: 'TH_SECRET',
    redirectUri: 'http://localhost:8787/threads/callback',
  }

  test('authorises at threads.net, not facebook.com', async () => {
    const url = new URL(buildThreadsAuthUrl(config, 'STATE'))
    assert.equal(url.origin, 'https://threads.net')
    assert.ok(!url.toString().includes('facebook.com'))
  })

  test('requests the Threads-specific scopes', () => {
    const scopes = new URL(buildThreadsAuthUrl(config, 'S')).searchParams.get('scope')!.split(',')
    assert.deepEqual(scopes, [...THREADS_SCOPES])
    // Facebook scopes would be silently ignored here and fail much later.
    assert.ok(!scopes.includes('pages_manage_posts'))
  })

  test('never puts the app secret in the authorise URL', () => {
    assert.ok(!buildThreadsAuthUrl(config, 'S').includes('TH_SECRET'))
  })

  test('discovery returns exactly one account', async () => {
    // One authorisation is one Threads profile — no equivalent of picking a Page.
    const { fetchImpl } = mockThreads([{ body: { id: '999', username: '1920agency' } }])
    const provider = new ThreadsProvider({ ...config, fetch: fetchImpl })
    const found = await provider.discover('TOKEN')

    assert.equal(found.length, 1)
    assert.equal(found[0]!.platform, 'threads')
    assert.equal(found[0]!.displayName, '1920agency')
  })
})
