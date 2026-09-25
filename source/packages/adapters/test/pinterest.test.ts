import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { PublishError, type MediaRef, type PostDraft, type PublishContext } from '@social-publisher/core'

import { PinterestAdapter } from '../src/pinterest.ts'
import { PinterestProvider, buildPinterestAuthUrl, PINTEREST_SCOPES } from '../src/pinterest-provider.ts'

interface Call {
  method: string
  url: string
  body: Record<string, unknown>
  auth: string | undefined
}

function mockPinterest(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  let index = 0

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    let body: Record<string, unknown> = {}
    if (typeof init?.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>
    else if (init?.body instanceof URLSearchParams) {
      for (const [k, v] of init.body) body[k] = v
    }

    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      body,
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
    id: 'conn-pin',
    tenantId: 't1',
    platform: 'pinterest',
    // The BOARD id, not a profile id — that is the whole modelling point.
    platformAccountId: 'board-12345',
    displayName: 'Marketing Tips',
    credentialSource: 'platform_app',
    scopes: ['pins:write'],
    needsReauth: false,
  },
  credential: { accessToken: 'PIN_TOKEN' },
  idempotencyKey: 'idem-1',
})

const img = (over: Partial<MediaRef> = {}): MediaRef => ({
  id: 'm1',
  kind: 'image',
  mime: 'image/jpeg',
  bytes: 100,
  publicUrl: 'https://media.example.com/pin.jpg',
  ...over,
})

const draft = (over: Partial<PostDraft> = {}): PostDraft => ({
  body: 'Great headline\nAnd the longer description underneath.',
  media: [img()],
  ...over,
})

const make = (responses: Array<{ status?: number; body: unknown }>) => {
  const { fetchImpl, calls } = mockPinterest(responses)
  return { pin: new PinterestAdapter({ fetch: fetchImpl }), calls }
}

describe('publishing a pin', () => {
  test('posts to the board held on the connection', async () => {
    const { pin, calls } = make([{ body: { id: 'pin-999' } }])
    const result = await pin.publish(ctx(), draft())

    assert.ok(calls[0]!.url.endsWith('/v5/pins'))
    assert.equal(calls[0]!.body.board_id, 'board-12345')
    assert.equal(result.platformPostId, 'pin-999')
    assert.match(result.url!, /pinterest\.com\/pin\/pin-999/)
  })

  test('splits the first line into the title and the rest into the description', async () => {
    // Pinterest has two text fields where our drafts have one. Splitting on the
    // first line matches how people write anyway.
    const { pin, calls } = make([{ body: { id: 'p' } }])
    await pin.publish(ctx(), draft())

    assert.equal(calls[0]!.body.title, 'Great headline')
    assert.equal(calls[0]!.body.description, 'And the longer description underneath.')
  })

  test('uses the whole text as description when there is only one line', async () => {
    const { pin, calls } = make([{ body: { id: 'p' } }])
    await pin.publish(ctx(), draft({ body: 'Just one line' }))

    assert.equal(calls[0]!.body.title, 'Just one line')
    assert.equal(calls[0]!.body.description, 'Just one line')
  })

  test('truncates a title past the 100 character field limit', async () => {
    const { pin, calls } = make([{ body: { id: 'p' } }])
    await pin.publish(ctx(), draft({ body: `${'x'.repeat(150)}\nbody` }))
    assert.equal((calls[0]!.body.title as string).length, 100)
  })

  test('sends the media as a fetchable URL', async () => {
    const { pin, calls } = make([{ body: { id: 'p' } }])
    await pin.publish(ctx(), draft())

    const source = calls[0]!.body.media_source as Record<string, string>
    assert.equal(source.source_type, 'image_url')
    assert.equal(source.url, 'https://media.example.com/pin.jpg')
  })

  test('sends the token as a Bearer header, never in the URL', async () => {
    const { pin, calls } = make([{ body: { id: 'p' } }])
    await pin.publish(ctx(), draft())
    assert.equal(calls[0]!.auth, 'Bearer PIN_TOKEN')
    assert.ok(!calls[0]!.url.includes('PIN_TOKEN'))
  })
})

describe('validation', () => {
  test('refuses a text-only pin — Pinterest has no such thing', async () => {
    const { pin, calls } = make([{ body: { id: 'p' } }])
    await assert.rejects(() => pin.publish(ctx(), draft({ media: [] })), PublishError)
    assert.equal(calls.length, 0)
  })

  test('refuses media with no public URL', async () => {
    const { pin, calls } = make([{ body: { id: 'p' } }])
    await assert.rejects(
      () => pin.publish(ctx(), draft({ media: [img({ publicUrl: undefined, localPath: 'C:/a.jpg' })] })),
      PublishError,
    )
    assert.equal(calls.length, 0)
  })

  test('refuses more than one media item — a pin holds one', async () => {
    const { pin } = make([{ body: { id: 'p' } }])
    await assert.rejects(
      () => pin.publish(ctx(), draft({ media: [img({ id: 'a' }), img({ id: 'b' })] })),
      PublishError,
    )
  })
})

describe('errors', () => {
  test('classifies an auth failure as a credential problem', async () => {
    const { pin } = make([{ status: 401, body: { message: 'Authentication failed' } }])
    try {
      await pin.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'credential')
      assert.equal(error.platformMessage, 'Authentication failed')
    }
  })

  test('a rate limit is transient', async () => {
    const { pin } = make([{ status: 429, body: { message: 'Too many requests' } }])
    try {
      await pin.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'transient')
    }
  })

  test('a rejected pin is permanent', async () => {
    const { pin } = make([{ status: 400, body: { message: 'Image too small', code: 25 } }])
    try {
      await pin.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'permanent')
      assert.equal(error.platformCode, '25')
    }
  })
})

describe('authorisation and discovery', () => {
  const config = {
    appId: 'PIN_APP',
    appSecret: 'PIN_SECRET',
    redirectUri: 'http://localhost:8787/pinterest/callback',
  }

  test('authorises at pinterest.com with the write scopes', () => {
    const url = new URL(buildPinterestAuthUrl(config, 'STATE'))
    assert.equal(url.origin, 'https://www.pinterest.com')
    const scopes = url.searchParams.get('scope')!.split(',')
    assert.deepEqual(scopes, [...PINTEREST_SCOPES])
    assert.ok(scopes.includes('pins:write'))
  })

  test('never puts the app secret in the authorise URL', () => {
    assert.ok(!buildPinterestAuthUrl(config, 'S').includes('PIN_SECRET'))
  })

  test('discovers one connectable account per board', async () => {
    // Each board is its own target, so "post to Recipes only" is expressible.
    const { fetchImpl } = mockPinterest([
      {
        body: {
          items: [
            { id: 'b1', name: 'Marketing Tips' },
            { id: 'b2', name: 'Client Work' },
          ],
        },
      },
    ])
    const found = await new PinterestProvider({ ...config, fetch: fetchImpl }).discover('TOKEN')

    assert.equal(found.length, 2)
    assert.deepEqual(
      found.map((a) => a.displayName),
      ['Marketing Tips', 'Client Work'],
    )
    assert.equal(found[0]!.externalId, 'b1')
    assert.equal(found[0]!.platform, 'pinterest')
  })

  test('authenticates the token exchange with HTTP Basic, not a body secret', async () => {
    // Different from every Meta flow here, and an easy one to get wrong.
    const { fetchImpl, calls } = mockPinterest([{ body: { access_token: 'T', expires_in: 3600 } }])
    const { PinterestOAuth } = await import('../src/pinterest-provider.ts')
    await new PinterestOAuth({ ...config, fetch: fetchImpl }).exchangeCode('CODE')

    assert.ok(calls[0]!.auth!.startsWith('Basic '))
    assert.ok(!JSON.stringify(calls[0]!.body).includes('PIN_SECRET'))
  })
})
