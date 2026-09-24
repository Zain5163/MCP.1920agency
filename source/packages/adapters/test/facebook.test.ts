import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { PublishError, type MediaRef, type PostDraft, type PublishContext } from '@social-publisher/core'

import { FacebookPageAdapter } from '../src/facebook.ts'

interface Call {
  url: string
  headers: Record<string, string>
  fields: Record<string, string>
  files: Record<string, { name: string; type: string; size: number }>
}

/** Records every Graph call and replays queued responses in order. */
function mockGraph(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  let index = 0

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body as FormData
    const fields: Call['fields'] = {}
    const files: Call['files'] = {}
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') fields[key] = value
      else files[key] = { name: value.name, type: value.type, size: value.size }
    }
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      fields,
      files,
    })

    const next = responses[Math.min(index, responses.length - 1)]!
    index += 1
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch

  return { fetchImpl, calls }
}

const ctx = (): PublishContext => ({
  connection: {
    id: 'conn-1',
    tenantId: 'tenant-1',
    platform: 'facebook_page',
    platformAccountId: '1234567890',
    displayName: '1920 Agency',
    credentialSource: 'platform_app',
    scopes: ['pages_manage_posts'],
    needsReauth: false,
  },
  credential: { accessToken: 'PAGE_TOKEN_XYZ' },
  idempotencyKey: 'idem-1',
})

const draft = (over: Partial<PostDraft> = {}): PostDraft => ({
  body: 'Hello from 1920 Agency',
  media: [],
  ...over,
})

const localImage = (over: Partial<MediaRef> = {}): MediaRef => ({
  id: 'm1',
  kind: 'image',
  mime: 'image/jpeg',
  bytes: 3,
  localPath: 'C:\\pics\\promo.jpg',
  ...over,
})

const readMedia = async () => new Uint8Array([1, 2, 3])

const adapter = (responses: Array<{ status?: number; body: unknown }>) => {
  const { fetchImpl, calls } = mockGraph(responses)
  return {
    fb: new FacebookPageAdapter({ fetch: fetchImpl, readMedia, apiVersion: 'v25.0' }),
    calls,
  }
}

describe('text posts', () => {
  test('posts a message to the page feed', async () => {
    const { fb, calls } = adapter([{ body: { id: '1234_5678' } }])
    const result = await fb.publish(ctx(), draft())

    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.url, 'https://graph.facebook.com/v25.0/1234567890/feed')
    assert.equal(calls[0]!.fields.message, 'Hello from 1920 Agency')
    assert.equal(result.platformPostId, '1234_5678')
  })

  test('sends the token as a Bearer header, never in the URL', async () => {
    // URLs leak into logs, proxies and error traces; headers do not.
    const { fb, calls } = adapter([{ body: { id: '1' } }])
    await fb.publish(ctx(), draft())

    assert.equal(calls[0]!.headers.Authorization, 'Bearer PAGE_TOKEN_XYZ')
    assert.ok(!calls[0]!.url.includes('PAGE_TOKEN_XYZ'))
    assert.ok(!calls[0]!.url.includes('access_token'))
  })

  test('honours the pinned API version', async () => {
    const { fetchImpl, calls } = mockGraph([{ body: { id: '1' } }])
    const fb = new FacebookPageAdapter({ fetch: fetchImpl, apiVersion: 'v99.0' })
    await fb.publish(ctx(), draft())
    assert.ok(calls[0]!.url.includes('/v99.0/'))
  })
})

describe('photo posts', () => {
  test('uploads a single local photo with the caption', async () => {
    const { fb, calls } = adapter([{ body: { id: 'photo-1', post_id: '1234_9999' } }])
    const result = await fb.publish(ctx(), draft({ media: [localImage()] }))

    assert.equal(calls[0]!.url, 'https://graph.facebook.com/v25.0/1234567890/photos')
    assert.equal(calls[0]!.fields.caption, 'Hello from 1920 Agency')
    assert.equal(calls[0]!.files.source!.type, 'image/jpeg')
    assert.equal(calls[0]!.files.source!.name, 'promo.jpg')
    // The feed story, not the photo object, is what a person would open.
    assert.equal(result.platformPostId, '1234_9999')
  })

  test('falls back to the photo id when no feed story is returned', async () => {
    const { fb } = adapter([{ body: { id: 'photo-only' } }])
    const result = await fb.publish(ctx(), draft({ media: [localImage()] }))
    assert.equal(result.platformPostId, 'photo-only')
  })

  test('prefers a public URL over uploading bytes when one exists', async () => {
    const { fb, calls } = adapter([{ body: { id: 'p', post_id: 'x' } }])
    await fb.publish(
      ctx(),
      draft({ media: [localImage({ publicUrl: 'https://cdn.example.com/a.jpg' })] }),
    )
    assert.equal(calls[0]!.fields.url, 'https://cdn.example.com/a.jpg')
    assert.equal(calls[0]!.files.source, undefined)
  })

  test('multi-photo uploads unpublished then attaches them to one feed story', async () => {
    const { fb, calls } = adapter([
      { body: { id: 'mid-1' } },
      { body: { id: 'mid-2' } },
      { body: { id: '1234_final' } },
    ])
    const result = await fb.publish(
      ctx(),
      draft({ media: [localImage({ id: 'a' }), localImage({ id: 'b' })] }),
    )

    assert.equal(calls.length, 3)
    assert.equal(calls[0]!.fields.published, 'false')
    assert.equal(calls[1]!.fields.published, 'false')
    assert.equal(calls[2]!.url, 'https://graph.facebook.com/v25.0/1234567890/feed')
    assert.equal(calls[2]!.fields['attached_media[0]'], '{"media_fbid":"mid-1"}')
    assert.equal(calls[2]!.fields['attached_media[1]'], '{"media_fbid":"mid-2"}')
    assert.equal(result.platformPostId, '1234_final')
  })
})

describe('video posts', () => {
  test('posts a video to the videos edge with the body as description', async () => {
    const { fb, calls } = adapter([{ body: { id: 'vid-1' } }])
    await fb.publish(
      ctx(),
      draft({
        media: [
          { id: 'v', kind: 'video', mime: 'video/mp4', bytes: 3, localPath: '/tmp/a.mp4', durationSeconds: 30 },
        ],
      }),
    )
    assert.equal(calls[0]!.url, 'https://graph.facebook.com/v25.0/1234567890/videos')
    assert.equal(calls[0]!.fields.description, 'Hello from 1920 Agency')
  })

  test('uses file_url rather than url for a hosted video', async () => {
    const { fb, calls } = adapter([{ body: { id: 'vid-1' } }])
    await fb.publish(
      ctx(),
      draft({
        media: [
          {
            id: 'v',
            kind: 'video',
            mime: 'video/mp4',
            bytes: 3,
            publicUrl: 'https://cdn.example.com/a.mp4',
            durationSeconds: 30,
          },
        ],
      }),
    )
    assert.equal(calls[0]!.fields.file_url, 'https://cdn.example.com/a.mp4')
  })
})

describe('validation before publishing', () => {
  test('refuses an empty draft without calling Graph at all', async () => {
    const { fb, calls } = adapter([{ body: { id: '1' } }])
    await assert.rejects(() => fb.publish(ctx(), draft({ body: '   ' })), PublishError)
    assert.equal(calls.length, 0)
  })

  test('a validation refusal is permanent, not retryable', async () => {
    const { fb } = adapter([{ body: { id: '1' } }])
    await fb.publish(ctx(), draft()).catch(() => {})
    try {
      await fb.publish(ctx(), draft({ body: '' }))
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'permanent')
      assert.equal(error.isRetryable, false)
    }
  })
})

describe('error handling', () => {
  const graphFail = (code: number, message = 'nope', status = 400) => ({
    status,
    body: { error: { message, code, fbtrace_id: 'trace-1' } },
  })

  test('an expired token is a credential failure, not a retry', async () => {
    const { fb } = adapter([graphFail(190, 'Error validating access token')])
    try {
      await fb.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'credential')
      assert.equal(error.isRetryable, false)
    }
  })

  test('a rate limit is transient and retryable', async () => {
    const { fb } = adapter([graphFail(32, 'Page request limit reached')])
    try {
      await fb.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'transient')
      assert.equal(error.isRetryable, true)
    }
  })

  test('a missing permission is permanent, because refreshing cannot add a scope', async () => {
    const { fb } = adapter([graphFail(200, 'Permissions error')])
    try {
      await fb.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'permanent')
    }
  })

  test('a 500 is transient even without a Graph error code', async () => {
    const { fb } = adapter([{ status: 500, body: {} }])
    try {
      await fb.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'transient')
    }
  })

  test('prefers error_user_msg and passes it through verbatim', async () => {
    const { fb } = adapter([
      {
        status: 400,
        body: {
          error: {
            message: 'OAuthException: (#100) blah',
            error_user_msg: 'Your photo could not be posted because it is too small.',
            code: 100,
          },
        },
      },
    ])
    try {
      await fb.publish(ctx(), draft({ media: [localImage()] }))
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(
        error.platformMessage,
        'Your photo could not be posted because it is too small.',
      )
    }
  })

  test('detects an error body returned with a 200 status', async () => {
    // Graph occasionally returns 200 with an error envelope.
    const { fb } = adapter([{ status: 200, body: { error: { message: 'bad', code: 100 } } }])
    await assert.rejects(() => fb.publish(ctx(), draft()), PublishError)
  })

  test('a non-JSON response does not crash the adapter', async () => {
    const fetchImpl = (async () =>
      new Response('<html>gateway timeout</html>', { status: 504 })) as unknown as typeof globalThis.fetch
    const fb = new FacebookPageAdapter({ fetch: fetchImpl })
    try {
      await fb.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'transient')
    }
  })

  test('a network failure is classified, not swallowed', async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    }) as unknown as typeof globalThis.fetch
    const fb = new FacebookPageAdapter({ fetch: fetchImpl })
    try {
      await fb.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'transient')
    }
  })

  test('the access token never appears in a thrown error', async () => {
    const { fb } = adapter([graphFail(190, 'Error validating access token')])
    try {
      await fb.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(!JSON.stringify({ ...(error as object), msg: String(error) }).includes('PAGE_TOKEN_XYZ'))
    }
  })
})
