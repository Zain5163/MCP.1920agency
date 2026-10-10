import { strict as assert } from 'node:assert'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/**
 * Video pins, rebuilt 2026-10-11 against the Pinterest v5 OpenAPI (5.28.0):
 * register the upload, send the file to the address it returns, wait for
 * processing, then pin by media_id with a cover. The old version sent a URL
 * as a video_id source, which Pinterest does not accept.
 */
describe('video pins', () => {
  interface Seen {
    method: string
    url: string
    json: Record<string, unknown> | undefined
    form: FormData | undefined
    auth: string | undefined
  }

  const UPLOAD_URL = 'https://pinterest-media-upload.s3-accelerate.amazonaws.com/'
  const PARAMS = { key: 'uploads/11/aa/video', policy: 'POLICY', 'x-amz-signature': 'SIG' }

  /** Routes by method and URL; `statuses` is the sequence GET /media/{id} answers. */
  function router(
    options: {
      statuses?: string[]
      register?: unknown
      uploadStatus?: number
    } = {},
  ) {
    const seen: Seen[] = []
    const statuses = [...(options.statuses ?? ['processing', 'succeeded'])]
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      seen.push({
        method,
        url,
        json: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
        form: init?.body instanceof FormData ? init.body : undefined,
        auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
      })
      if (url === 'https://media.example.com/clip.mp4') return new Response(new Uint8Array([1, 2, 3, 4, 5, 6]))
      if (method === 'POST' && url.endsWith('/v5/media')) {
        return new Response(
          JSON.stringify(
            options.register ?? { media_id: '123', media_type: 'video', upload_url: UPLOAD_URL, upload_parameters: PARAMS },
          ),
          { status: 201 },
        )
      }
      if (url === UPLOAD_URL) return new Response(null, { status: options.uploadStatus ?? 204 })
      if (method === 'GET' && url.endsWith('/v5/media/123')) {
        const status = statuses.length > 1 ? statuses.shift()! : statuses[0]!
        return new Response(JSON.stringify({ media_id: '123', media_type: 'video', status }))
      }
      if (method === 'POST' && url.endsWith('/v5/pins')) {
        return new Response(JSON.stringify({ id: 'pin-v1' }), { status: 201 })
      }
      return new Response(JSON.stringify({ message: `unexpected ${method} ${url}` }), { status: 500 })
    }) as unknown as typeof globalThis.fetch
    return { fetchImpl, seen }
  }

  const clip = (over: Partial<MediaRef> = {}): MediaRef => ({
    id: 'v1',
    kind: 'video',
    mime: 'video/mp4',
    bytes: 6,
    publicUrl: 'https://media.example.com/clip.mp4',
    durationSeconds: 30,
    ...over,
  })

  const adapter = (fetchImpl: typeof globalThis.fetch) =>
    new PinterestAdapter({ fetch: fetchImpl, sleep: async () => {}, pollIntervalMs: 1_000 })

  const pinCall = (seen: Seen[]) => seen.find((s) => s.method === 'POST' && s.url.endsWith('/v5/pins'))

  const step = (s: Seen): string => {
    if (s.url === UPLOAD_URL) return 'upload'
    if (s.url.endsWith('/v5/pins')) return 'pin'
    if (s.url.includes('/v5/media/')) return 'poll'
    if (s.url.endsWith('/v5/media')) return 'register'
    return 'download'
  }

  test('registers, uploads, waits, then pins by media_id, never by URL', async () => {
    const { fetchImpl, seen } = router()
    const result = await adapter(fetchImpl).publish(ctx(), draft({ media: [clip()] }))

    const register = seen.find((s) => s.method === 'POST' && s.url.endsWith('/v5/media'))!
    assert.deepEqual(register.json, { media_type: 'video' })
    assert.equal(register.auth, 'Bearer PIN_TOKEN')

    const pin = pinCall(seen)!
    const source = pin.json!.media_source as Record<string, unknown>
    assert.equal(source.source_type, 'video_id')
    assert.equal(source.media_id, '123')
    assert.equal(source.url, undefined, 'a video source has no url field')
    assert.equal(pin.json!.board_id, 'board-12345')
    assert.equal(result.platformPostId, 'pin-v1')

    // Nothing is pinned before processing has finished.
    assert.deepEqual(seen.map(step), ['download', 'register', 'upload', 'poll', 'poll', 'pin'])
  })

  test('the file goes to the upload address as a form: parameters first, then file, and no Pinterest token', async () => {
    const { fetchImpl, seen } = router()
    await adapter(fetchImpl).publish(ctx(), draft({ media: [clip()] }))

    const upload = seen.find((s) => s.url === UPLOAD_URL)!
    assert.equal(upload.method, 'POST')
    assert.equal(upload.auth, undefined, 'the token must never go to the storage address')
    assert.deepEqual([...upload.form!.keys()], ['key', 'policy', 'x-amz-signature', 'file'])
    assert.equal(upload.form!.get('policy'), 'POLICY')
    const file = upload.form!.get('file') as Blob
    assert.equal(file.size, 6)
    assert.equal(file.type, 'video/mp4')
  })

  test('without a thumbnail, a key frame is the cover and the result says so', async () => {
    const { fetchImpl, seen } = router()
    const result = await adapter(fetchImpl).publish(ctx(), draft({ media: [clip()] }))

    const source = pinCall(seen)!.json!.media_source as Record<string, unknown>
    assert.equal(source.cover_image_key_frame_time, 1)
    assert.equal(source.cover_image_url, undefined)
    assert.match(result.notice!, /No thumbnail was given/)
    assert.match(result.notice!, /frame at 1 s/)
  })

  test('a hosted thumbnail becomes cover_image_url, with no notice', async () => {
    const { fetchImpl, seen } = router()
    const thumbnail = img({ id: 't', publicUrl: 'https://media.example.com/cover.jpg' })
    const result = await adapter(fetchImpl).publish(ctx(), draft({ media: [clip({ thumbnail })] }))

    const source = pinCall(seen)!.json!.media_source as Record<string, unknown>
    assert.equal(source.cover_image_url, 'https://media.example.com/cover.jpg')
    assert.equal(source.cover_image_key_frame_time, undefined)
    assert.equal(result.notice, undefined)
  })

  test('a local thumbnail goes inline as Base64 with its content type', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pin-cover-'))
    try {
      const file = join(dir, 'cover.png')
      await writeFile(file, Buffer.from([137, 80, 78, 71]))
      const { fetchImpl, seen } = router()
      const thumbnail = img({ id: 't', mime: 'image/png', publicUrl: undefined, localPath: file })
      await adapter(fetchImpl).publish(ctx(), draft({ media: [clip({ thumbnail })] }))

      const source = pinCall(seen)!.json!.media_source as Record<string, unknown>
      assert.equal(source.cover_image_data, Buffer.from([137, 80, 78, 71]).toString('base64'))
      assert.equal(source.cover_image_content_type, 'image/png')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a thumbnail Pinterest cannot use stops the pin before the video is uploaded', async () => {
    const { fetchImpl, seen } = router()
    const thumbnail = img({ id: 't', mime: 'image/gif', publicUrl: 'https://media.example.com/cover.gif' })
    await assert.rejects(
      () => adapter(fetchImpl).publish(ctx(), draft({ media: [clip({ thumbnail })] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'permanent')
        assert.match(error.message, /JPEG or PNG/)
        assert.match(error.message, /Nothing was uploaded or pinned/)
        return true
      },
    )
    assert.equal(seen.length, 0)
  })

  test('failed processing is permanent, has its own diagnosis, and pins nothing', async () => {
    const { fetchImpl, seen } = router({ statuses: ['processing', 'failed'] })
    await assert.rejects(
      () => adapter(fetchImpl).publish(ctx(), draft({ media: [clip()] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'permanent')
        assert.equal(error.code, 'MEDIA_PROCESSING_FAILED')
        assert.match(error.message, /no pin was created/)
        return true
      },
    )
    assert.equal(pinCall(seen), undefined)
  })

  test('processing that outlasts the timeout is transient, says so, and pins nothing', async () => {
    let clock = 0
    const { fetchImpl, seen } = router({ statuses: ['processing'] })
    const pin = new PinterestAdapter({
      fetch: fetchImpl,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
      pollIntervalMs: 60_000,
      processingTimeoutMs: 5 * 60_000,
    })
    await assert.rejects(
      () => pin.publish(ctx(), draft({ media: [clip()] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'transient')
        assert.equal(error.code, 'MEDIA_PROCESSING_TIMEOUT')
        assert.match(error.message, /still processing the video after 5 minutes/)
        return true
      },
    )
    assert.equal(pinCall(seen), undefined)
    assert.ok(seen.filter((s) => s.method === 'GET' && s.url.endsWith('/v5/media/123')).length >= 2)
  })

  test('storage refusing the file: 400 is permanent, 403 (expired upload permission) is retried', async () => {
    for (const [status, failureClass] of [
      [400, 'permanent'],
      [403, 'transient'],
    ] as const) {
      const { fetchImpl, seen } = router({ uploadStatus: status })
      await assert.rejects(
        () => adapter(fetchImpl).publish(ctx(), draft({ media: [clip()] })),
        (error: unknown) => {
          assert.ok(error instanceof PublishError)
          assert.equal(error.failureClass, failureClass, `HTTP ${status}`)
          assert.match(error.message, /Nothing was pinned/)
          return true
        },
      )
      assert.equal(pinCall(seen), undefined)
    }
  })

  test('a registration without an upload address is retried, not guessed at', async () => {
    const { fetchImpl, seen } = router({ register: { media_id: '123', media_type: 'video' } })
    await assert.rejects(
      () => adapter(fetchImpl).publish(ctx(), draft({ media: [clip()] })),
      (error: unknown) => error instanceof PublishError && error.failureClass === 'transient',
    )
    assert.equal(
      seen.some((s) => s.url === UPLOAD_URL),
      false,
    )
    assert.equal(pinCall(seen), undefined)
  })

  test('a video under the 4-second minimum is refused before any call', async () => {
    const { fetchImpl, seen } = router()
    await assert.rejects(() => adapter(fetchImpl).publish(ctx(), draft({ media: [clip({ durationSeconds: 3 })] })), PublishError)
    assert.equal(seen.length, 0)
  })

  test('images still pin by URL, unchanged', async () => {
    const { fetchImpl, seen } = router()
    await adapter(fetchImpl).publish(ctx(), draft())
    assert.equal(seen.length, 1)
    assert.deepEqual(pinCall(seen)!.json!.media_source, {
      source_type: 'image_url',
      url: 'https://media.example.com/pin.jpg',
    })
  })
})
