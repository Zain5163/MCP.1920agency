import { strict as assert } from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, describe } from 'node:test'

import { PublishError, type MediaRef, type PostDraft, type PublishContext } from '@social-publisher/core'

import { LinkedInAdapter, escapeLittleText } from '../src/linkedin.ts'
import {
  LinkedInProvider,
  buildLinkedInAuthUrl,
  LINKEDIN_MEMBER_SCOPES,
  LINKEDIN_ORGANIZATION_SCOPES,
} from '../src/linkedin-provider.ts'

interface Call {
  method: string
  url: string
  body: Record<string, unknown>
  headers: Record<string, string>
  rawBody: unknown
}

interface Reply {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

function mockLinkedIn(replies: Reply[]) {
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
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      rawBody: init?.body,
    })

    const next = replies[Math.min(index, replies.length - 1)] ?? {}
    index += 1
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: next.headers ?? {},
    })
  }) as unknown as typeof globalThis.fetch

  return { fetchImpl, calls }
}

const ctx = (over: Partial<PublishContext['connection']> = {}): PublishContext => ({
  connection: {
    id: 'conn-li',
    tenantId: 't1',
    platform: 'linkedin',
    // The full URN, not a bare id — it carries the account type too.
    platformAccountId: 'urn:li:person:ABC123',
    displayName: 'Rana Zain Usman',
    credentialSource: 'platform_app',
    scopes: ['w_member_social'],
    needsReauth: false,
    ...over,
  },
  credential: { accessToken: 'LI_TOKEN' },
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

const draft = (over: Partial<PostDraft> = {}): PostDraft => ({
  body: 'Hello LinkedIn',
  media: [],
  ...over,
})

const CREATED: Reply = { status: 201, headers: { 'x-restli-id': 'urn:li:share:999' } }

const make = (replies: Reply[]) => {
  const { fetchImpl, calls } = mockLinkedIn(replies)
  return { li: new LinkedInAdapter({ fetch: fetchImpl }), calls }
}

describe('publishing text', () => {
  test('posts as the author URN held on the connection', async () => {
    const { li, calls } = make([CREATED])
    const result = await li.publish(ctx(), draft())

    assert.equal(calls[0]!.url, 'https://api.linkedin.com/rest/posts')
    assert.equal(calls[0]!.body.author, 'urn:li:person:ABC123')
    assert.equal(result.platformPostId, 'urn:li:share:999')
  })

  test('reads the post id from the x-restli-id header, since the body is empty', async () => {
    // The whole reason this is worth a test: a 201 carries no JSON at all.
    const { li } = make([CREATED])
    const result = await li.publish(ctx(), draft())
    assert.match(result.url!, /linkedin\.com\/feed\/update\/urn:li:share:999/)
  })

  test('fails loudly when LinkedIn accepts the post but returns no id', async () => {
    const { li } = make([{ status: 201 }])
    await assert.rejects(() => li.publish(ctx(), draft()), PublishError)
  })

  test('sends both mandatory LinkedIn headers', async () => {
    const { li, calls } = make([CREATED])
    await li.publish(ctx(), draft())

    assert.match(calls[0]!.headers['LinkedIn-Version']!, /^\d{6}$/)
    assert.equal(calls[0]!.headers['X-Restli-Protocol-Version'], '2.0.0')
  })

  test('posts as an organisation when the connection holds an organisation URN', async () => {
    const { li, calls } = make([CREATED])
    await li.publish(ctx({ platformAccountId: 'urn:li:organization:42' }), draft())
    assert.equal(calls[0]!.body.author, 'urn:li:organization:42')
  })

  test('refuses a bare id rather than letting LinkedIn return an opaque 422', async () => {
    const { li, calls } = make([CREATED])
    try {
      await li.publish(ctx({ platformAccountId: 'ABC123' }), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'credential')
    }
    assert.equal(calls.length, 0)
  })

  test('sends the token as a Bearer header, never in the URL', async () => {
    const { li, calls } = make([CREATED])
    await li.publish(ctx(), draft())
    assert.equal(calls[0]!.headers.Authorization, 'Bearer LI_TOKEN')
    assert.ok(!calls[0]!.url.includes('LI_TOKEN'))
  })
})

describe('little text escaping', () => {
  /**
   * These matter more than they look. An unescaped reserved character does not
   * error — LinkedIn drops everything after it and still reports success.
   */
  test('escapes a bracket that would otherwise truncate the post silently', () => {
    assert.equal(escapeLittleText('Call us (today) please'), 'Call us \\(today\\) please')
  })

  test('escapes every reserved character', () => {
    for (const ch of ['|', '{', '}', '@', '[', ']', '(', ')', '<', '>', '#', '*', '_', '~', '\\']) {
      assert.equal(escapeLittleText(`a${ch}b`), `a\\${ch}b`, `did not escape ${ch}`)
    }
  })

  test('leaves ordinary text alone', () => {
    assert.equal(escapeLittleText('Video editing for brands. 3 spots left!'), 'Video editing for brands. 3 spots left!')
  })

  test('escapes the commentary that is actually sent', async () => {
    const { li, calls } = make([CREATED])
    await li.publish(ctx(), draft({ body: 'New reel (1920 Agency) #video' }))
    assert.equal(calls[0]!.body.commentary, 'New reel \\(1920 Agency\\) \\#video')
  })
})

describe('images', () => {
  const INIT: Reply = {
    body: { value: { uploadUrl: 'https://upload.linkedin.example/abc', image: 'urn:li:image:IMG1' } },
  }

  test('uploads bytes straight from disk when the media is a local file', async () => {
    // A real file, because the point of this path is that nothing is downloaded.
    const dir = await mkdtemp(join(tmpdir(), 'li-'))
    const file = join(dir, 'a.jpg')
    await writeFile(file, Buffer.from([1, 2, 3, 4]))

    const { fetchImpl, calls } = mockLinkedIn([INIT, {}, CREATED])
    const li = new LinkedInAdapter({ fetch: fetchImpl })
    await li.publish(ctx(), draft({ media: [img({ localPath: file, publicUrl: undefined })] }))

    // init, PUT, post — three calls, with no download in between.
    assert.equal(calls.length, 3)
    assert.match(calls[0]!.url, /action=initializeUpload/)
    assert.equal(calls[1]!.method, 'PUT')
    assert.equal((calls[1]!.rawBody as Uint8Array).length, 4)
  })

  test('explains a missing local file instead of failing mid-upload', async () => {
    const { fetchImpl } = mockLinkedIn([INIT, {}, CREATED])
    const li = new LinkedInAdapter({ fetch: fetchImpl })
    await assert.rejects(
      () => li.publish(ctx(), draft({ media: [img({ localPath: 'nope.jpg', publicUrl: undefined })] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'permanent')
        assert.match(error.message, /nope\.jpg/)
        return true
      },
    )
  })

  test('downloads media given only a URL, since LinkedIn will not fetch it', async () => {
    const { fetchImpl, calls } = mockLinkedIn([
      INIT,
      { body: {} }, // the media download
      {}, // the PUT
      CREATED,
    ])
    const li = new LinkedInAdapter({ fetch: fetchImpl })
    await li.publish(ctx(), draft({ media: [img()] }))

    assert.equal(calls[1]!.url, 'https://media.example.com/a.jpg')
    assert.equal(calls[2]!.method, 'PUT')
    assert.equal(calls[2]!.url, 'https://upload.linkedin.example/abc')
    assert.equal(calls[3]!.body.content !== undefined, true)
  })

  test('a single image uses content.media', async () => {
    const { fetchImpl, calls } = mockLinkedIn([INIT, { body: {} }, {}, CREATED])
    const li = new LinkedInAdapter({ fetch: fetchImpl })
    await li.publish(ctx(), draft({ media: [img()] }))

    const content = calls[3]!.body.content as { media?: { id: string } }
    assert.equal(content.media?.id, 'urn:li:image:IMG1')
  })

  test('several images use content.multiImage', async () => {
    const { fetchImpl, calls } = mockLinkedIn([
      INIT, { body: {} }, {},
      INIT, { body: {} }, {},
      CREATED,
    ])
    const li = new LinkedInAdapter({ fetch: fetchImpl })
    await li.publish(ctx(), draft({ media: [img({ id: 'a' }), img({ id: 'b' })] }))

    const content = calls[6]!.body.content as { multiImage?: { images: unknown[] } }
    assert.equal(content.multiImage?.images.length, 2)
  })

})

describe('errors', () => {
  test('classifies an expired token as a credential problem', async () => {
    const { li } = make([{ status: 401, body: { message: 'Invalid access token' } }])
    try {
      await li.publish(ctx(), draft())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'credential')
      assert.equal(error.platformMessage, 'Invalid access token')
    }
  })

  test('a throttle is transient', async () => {
    const { li } = make([{ status: 429, body: { message: 'Throttled' } }])
    await assert.rejects(() => li.publish(ctx(), draft()), (error: unknown) => {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'transient')
      return true
    })
  })

  test('keeps the serviceErrorCode so a failure can be looked up', async () => {
    const { li } = make([{ status: 422, body: { message: 'Duplicate post', serviceErrorCode: 100 } }])
    await assert.rejects(() => li.publish(ctx(), draft()), (error: unknown) => {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'permanent')
      assert.equal(error.platformCode, '100')
      return true
    })
  })
})

describe('authorisation and discovery', () => {
  const config = {
    appId: 'LI_APP',
    appSecret: 'LI_SECRET',
    redirectUri: 'http://localhost:8787/linkedin/callback',
  }

  test('asks only for member scopes by default', () => {
    const url = new URL(buildLinkedInAuthUrl(config, 'STATE'))
    const scopes = url.searchParams.get('scope')!.split(' ')
    assert.deepEqual(scopes, [...LINKEDIN_MEMBER_SCOPES])
    for (const org of LINKEDIN_ORGANIZATION_SCOPES) assert.ok(!scopes.includes(org))
  })

  test('adds organisation scopes only when Community Management is approved', () => {
    const url = new URL(buildLinkedInAuthUrl({ ...config, organizationAccess: true }, 'S'))
    const scopes = url.searchParams.get('scope')!.split(' ')
    assert.ok(scopes.includes('w_organization_social'))
  })

  test('separates scopes with spaces, not commas', () => {
    const url = buildLinkedInAuthUrl(config, 'S')
    assert.ok(!url.includes('%2C'))
  })

  test('never puts the app secret in the authorise URL', () => {
    assert.ok(!buildLinkedInAuthUrl(config, 'S').includes('LI_SECRET'))
  })

  test('discovers the member profile as a full person URN', async () => {
    const { fetchImpl } = mockLinkedIn([
      { body: { sub: 'ABC123', name: 'Rana Zain Usman' } },
      { status: 403, body: { message: 'Not enough permissions' } },
    ])
    const found = await new LinkedInProvider({ ...config, fetch: fetchImpl }).discover('TOKEN')

    assert.equal(found.length, 1)
    assert.equal(found[0]!.externalId, 'urn:li:person:ABC123')
    assert.equal(found[0]!.displayName, 'Rana Zain Usman')
  })

  test('a missing Community Management approval loses pages, not the whole connection', async () => {
    // The common case for a new app. It must not look like a broken connect.
    const { fetchImpl } = mockLinkedIn([
      { body: { sub: 'ABC123', name: 'Rana' } },
      { status: 403, body: { message: 'Not enough permissions' } },
    ])
    const found = await new LinkedInProvider({ ...config, fetch: fetchImpl }).discover('TOKEN')
    assert.equal(found.length, 1)
  })

  test('returns company pages as organisation URNs when access is granted', async () => {
    const { fetchImpl } = mockLinkedIn([
      { body: { sub: 'ABC123', name: 'Rana' } },
      { body: { elements: [{ organization: 'urn:li:organization:42' }] } },
      { body: { localizedName: '1920 Agency' } },
    ])
    const found = await new LinkedInProvider({ ...config, fetch: fetchImpl }).discover('TOKEN')

    assert.equal(found.length, 2)
    assert.equal(found[1]!.externalId, 'urn:li:organization:42')
    assert.equal(found[1]!.displayName, '1920 Agency')
  })

  test('falls back to the URN when a page name cannot be read', async () => {
    const { fetchImpl } = mockLinkedIn([
      { body: { sub: 'A', name: 'R' } },
      { body: { elements: [{ organization: 'urn:li:organization:42' }] } },
      { status: 403, body: { message: 'no' } },
    ])
    const found = await new LinkedInProvider({ ...config, fetch: fetchImpl }).discover('TOKEN')

    assert.equal(found.length, 2)
    assert.equal(found[1]!.displayName, 'urn:li:organization:42')
  })

  test('sends the secret in the form body, not as Basic auth', async () => {
    // Pinterest uses Basic, Meta uses a query parameter, LinkedIn uses the body.
    const { fetchImpl, calls } = mockLinkedIn([{ body: { access_token: 'T', expires_in: 3600 } }])
    const { LinkedInOAuth } = await import('../src/linkedin-provider.ts')
    await new LinkedInOAuth({ ...config, fetch: fetchImpl }).exchangeCode('CODE')

    assert.equal(calls[0]!.headers.Authorization, undefined)
    assert.equal(calls[0]!.body.client_secret, 'LI_SECRET')
  })
})

describe('video', () => {
  const VIDEO_INIT = (parts: number): Reply => ({
    body: {
      value: {
        video: 'urn:li:video:VID1',
        uploadToken: 'TOKEN',
        uploadInstructions: Array.from({ length: parts }, (_, i) => ({
          uploadUrl: `https://upload.linkedin.example/part${i}`,
          firstByte: i * 10,
          lastByte: i * 10 + 9,
        })),
      },
    },
  })

  const PART = (etag: string): Reply => ({ headers: { etag } })

  const vid = (over: Partial<MediaRef> = {}): MediaRef => ({
    id: 'v1',
    kind: 'video',
    mime: 'video/mp4',
    bytes: 20,
    publicUrl: 'https://media.example.com/a.mp4',
    ...over,
  })

  test('initialises with the REAL byte count, not a declared one', async () => {
    // fileSizeBytes decides how many parts come back, so a wrong figure yields
    // instructions that do not match the file.
    // The media is fetched FIRST, because the real length is what decides how
    // many parts come back. JSON.stringify([1,2,3,4,5]) is 11 bytes.
    const { fetchImpl, calls } = mockLinkedIn([
      { body: [1, 2, 3, 4, 5] }, // the media download
      VIDEO_INIT(1),
      PART('"etag-0"'),
      {},
      CREATED,
    ])
    const li = new LinkedInAdapter({ fetch: fetchImpl })
    await li.publish(ctx(), draft({ media: [vid({ bytes: 999_999 })] }))

    const init = calls.find((c) => c.url.includes('initializeUpload'))!
    const request = init.body.initializeUploadRequest as { fileSizeBytes: number }
    assert.notEqual(request.fileSizeBytes, 999_999, 'must not trust the declared size')
    assert.equal(request.fileSizeBytes, 11)
  })

  test('uploads every part and finalises with the ETags in order', async () => {
    const { fetchImpl, calls } = mockLinkedIn([
      { body: [1, 2, 3, 4, 5] },
      VIDEO_INIT(3),
      PART('"e0"'),
      PART('"e1"'),
      PART('"e2"'),
      {},
      CREATED,
    ])
    const li = new LinkedInAdapter({ fetch: fetchImpl })
    await li.publish(ctx(), draft({ media: [vid()] }))

    const puts = calls.filter((c) => c.method === 'PUT')
    assert.equal(puts.length, 3)

    const finalize = calls.find((c) => c.url.includes('finalizeUpload'))!
    const request = finalize.body.finalizeUploadRequest as {
      video: string
      uploadToken: string
      uploadedPartIds: string[]
    }
    assert.equal(request.video, 'urn:li:video:VID1')
    assert.equal(request.uploadToken, 'TOKEN')
    assert.deepEqual(request.uploadedPartIds, ['"e0"', '"e1"', '"e2"'])
  })

  test('a part with no ETag stops the upload rather than finalising a broken video', async () => {
    const { fetchImpl, calls } = mockLinkedIn([
      { body: [1] },
      VIDEO_INIT(2),
      PART('"e0"'),
      { headers: {} }, // second part returns no ETag
      {},
      CREATED,
    ])
    const li = new LinkedInAdapter({ fetch: fetchImpl })

    await assert.rejects(() => li.publish(ctx(), draft({ media: [vid()] })), PublishError)
    assert.equal(calls.some((c) => c.url.includes('finalizeUpload')), false)
  })

  test('the finished video is referenced as content.media', async () => {
    const { fetchImpl, calls } = mockLinkedIn([
      { body: [1] },
      VIDEO_INIT(1),
      PART('"e0"'),
      {},
      CREATED,
    ])
    const li = new LinkedInAdapter({ fetch: fetchImpl })
    await li.publish(ctx(), draft({ media: [vid()] }))

    const post = calls.find((c) => c.url.endsWith('/rest/posts'))!
    const content = post.body.content as { media?: { id: string } }
    assert.equal(content.media?.id, 'urn:li:video:VID1')
  })

  test('refuses a video mixed with images — LinkedIn has no such container', async () => {
    const { li, calls } = make([CREATED])
    await assert.rejects(
      () => li.publish(ctx(), draft({ media: [img(), vid()] })),
      PublishError,
    )
    assert.equal(calls.length, 0)
  })

  test('refuses more than one video', async () => {
    const { li } = make([CREATED])
    await assert.rejects(
      () => li.publish(ctx(), draft({ media: [vid({ id: 'a' }), vid({ id: 'b' })] })),
      PublishError,
    )
  })

  test('missing upload instructions fail before any PUT', async () => {
    const { fetchImpl, calls } = mockLinkedIn([
      { body: [1] },
      { body: { value: { video: 'urn:li:video:X' } } },
    ])
    const li = new LinkedInAdapter({ fetch: fetchImpl })

    await assert.rejects(() => li.publish(ctx(), draft({ media: [vid()] })), PublishError)
    assert.equal(calls.some((c) => c.method === 'PUT'), false)
  })
})
