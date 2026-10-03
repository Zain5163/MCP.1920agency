import { strict as assert } from 'node:assert'
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, describe } from 'node:test'

import {
  CAPABILITIES,
  PublishError,
  countGraphemes,
  validateAgainstCapabilities,
  type MediaRef,
  type PostDraft,
  type PublishContext,
} from '@social-publisher/core'

import {
  LINKEDIN_DOCUMENT_TITLE_SHOWN,
  LinkedInAdapter,
  escapeLittleText,
  type LinkedInAdapterOptions,
} from '../src/linkedin.ts'
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
  /** Sent as is instead of JSON, e.g. the bytes of a downloaded file. */
  raw?: string | Uint8Array
  headers?: Record<string, string>
  /** Thrown instead of answering, as a dropped connection does. */
  error?: Error
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
    if (next.error !== undefined) throw next.error
    return new Response(next.raw !== undefined ? next.raw : next.body === undefined ? '' : JSON.stringify(next.body), {
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

  test('the organisation app asks for organisation scopes ONLY', () => {
    // It has no Sign In with OpenID Connect product, and asking for a scope an
    // app does not hold fails the whole dialog rather than dropping that scope.
    const url = new URL(buildLinkedInAuthUrl({ ...config, organizationAccess: true }, 'S'))
    const scopes = url.searchParams.get('scope')!.split(' ')

    assert.ok(scopes.includes('w_organization_social'))
    assert.ok(!scopes.includes('openid'), 'must not ask for a scope this app lacks')
    assert.ok(!scopes.includes('w_member_social'))
  })

  test('the two apps register under different keys', () => {
    // The same key would mean the second registration silently replaced the first.
    const member = new LinkedInProvider(config)
    const page = new LinkedInProvider({ ...config, organizationAccess: true })

    assert.equal(member.key, 'linkedin')
    assert.equal(page.key, 'linkedin_page')
    assert.notEqual(member.displayName, page.displayName)
  })

  test('the organisation app never calls userinfo, having no OIDC', async () => {
    const { fetchImpl, calls } = mockLinkedIn([
      { body: { elements: [{ organization: 'urn:li:organization:42' }] } },
      { body: { localizedName: '1920 Agency' } },
    ])
    const found = await new LinkedInProvider({
      ...config,
      organizationAccess: true,
      fetch: fetchImpl,
    }).discover('TOKEN')

    assert.equal(calls.some((c) => c.url.includes('userinfo')), false)
    assert.equal(found.length, 1)
    assert.equal(found[0]!.externalId, 'urn:li:organization:42')
  })

  test('the organisation app explains an empty page list rather than connecting nothing', async () => {
    // This is the state while Community Management approval is still pending: the
    // call succeeds and returns nothing, which reads like "you admin no pages".
    const { fetchImpl } = mockLinkedIn([{ body: { elements: [] } }])
    await assert.rejects(
      () =>
        new LinkedInProvider({ ...config, organizationAccess: true, fetch: fetchImpl }).discover(
          'TOKEN',
        ),
      /pending|no company pages/i,
    )
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
    ])
    const found = await new LinkedInProvider({ ...config, fetch: fetchImpl }).discover('TOKEN')

    assert.equal(found.length, 1)
    assert.equal(found[0]!.externalId, 'urn:li:person:ABC123')
    assert.equal(found[0]!.displayName, 'Rana Zain Usman')
  })

  test('the member app connects fine with no organisation access at all', async () => {
    // It never asks for any, so a missing Community Management approval is not
    // even visible on this path.
    const { fetchImpl } = mockLinkedIn([{ body: { sub: 'ABC123', name: 'Rana' } }])
    const found = await new LinkedInProvider({ ...config, fetch: fetchImpl }).discover('TOKEN')
    assert.equal(found.length, 1)
  })

  test('the member app returns the profile and nothing else', async () => {
    // Company pages belong to the organisation app now. A member app that also
    // listed them would be promising something it cannot post to.
    const { fetchImpl } = mockLinkedIn([{ body: { sub: 'ABC123', name: 'Rana' } }])
    const found = await new LinkedInProvider({ ...config, fetch: fetchImpl }).discover('TOKEN')

    assert.equal(found.length, 1)
    assert.match(found[0]!.externalId, /^urn:li:person:/)
  })

  test('falls back to the URN when a page name cannot be read', async () => {
    const { fetchImpl } = mockLinkedIn([
      { body: { elements: [{ organization: 'urn:li:organization:42' }] } },
      { status: 403, body: { message: 'no' } },
    ])
    const found = await new LinkedInProvider({
      ...config,
      organizationAccess: true,
      fetch: fetchImpl,
    }).discover('TOKEN')

    assert.equal(found.length, 1)
    assert.equal(found[0]!.displayName, 'urn:li:organization:42')
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
  /**
   * The mocked download returns JSON.stringify([1,2,3,4,5]), which is 11 bytes,
   * so the byte ranges have to cover exactly those 11 bytes.
   *
   * That precision matters: the adapter now reads each part from disk and fails
   * on a short read, because a short read means the file changed mid-upload and
   * sending the padding would upload silent corruption. Ranges that overshoot
   * the file — which these fixtures originally had — used to pass only
   * because the old in-memory version returned empty slices without complaint.
   */
  const DOWNLOAD: Reply = { body: [1, 2, 3, 4, 5] }
  const TOTAL = JSON.stringify([1, 2, 3, 4, 5]).length

  const VIDEO_INIT = (parts: number): Reply => {
    const per = Math.ceil(TOTAL / parts)
    return {
      body: {
        value: {
          video: 'urn:li:video:VID1',
          uploadToken: 'TOKEN',
          uploadInstructions: Array.from({ length: parts }, (_, i) => ({
            uploadUrl: `https://upload.linkedin.example/part${i}`,
            firstByte: i * per,
            lastByte: Math.min(i * per + per - 1, TOTAL - 1),
          })),
        },
      },
    }
  }

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
      DOWNLOAD, // the media download
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
    assert.equal(request.fileSizeBytes, TOTAL)
  })

  test('uploads every part and finalises with the ETags in order', async () => {
    const { fetchImpl, calls } = mockLinkedIn([
      DOWNLOAD,
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
      DOWNLOAD,
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
      DOWNLOAD,
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
      DOWNLOAD,
      { body: { value: { video: 'urn:li:video:X' } } },
    ])
    const li = new LinkedInAdapter({ fetch: fetchImpl })

    await assert.rejects(() => li.publish(ctx(), draft({ media: [vid()] })), PublishError)
    assert.equal(calls.some((c) => c.method === 'PUT'), false)
  })
})

describe('large media is never held in memory whole', () => {
  /**
   * The defect this guards against: the first version read the entire file into
   * one Uint8Array before slicing it. Fine for an image, an out-of-memory crash
   * for a large video on a busy worker.
   *
   * A unit test cannot measure memory, so it asserts the observable consequence
   * instead — each part sent is only as large as its own byte range, and the
   * ranges come from LinkedIn rather than from anything we buffered.
   */
  test('each PUT carries only its own 4 MB range, not the whole file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'li-big-'))
    const file = join(dir, 'big.mp4')
    // 10 MB: three parts at LinkedIn's 4 MB boundary.
    const size = 10 * 1024 * 1024
    await writeFile(file, Buffer.alloc(size, 9))

    const PART_BYTES = 4 * 1024 * 1024
    const ranges = [
      { firstByte: 0, lastByte: PART_BYTES - 1 },
      { firstByte: PART_BYTES, lastByte: PART_BYTES * 2 - 1 },
      { firstByte: PART_BYTES * 2, lastByte: size - 1 },
    ]

    const { fetchImpl, calls } = mockLinkedIn([
      {
        body: {
          value: {
            video: 'urn:li:video:BIG',
            uploadToken: 'T',
            uploadInstructions: ranges.map((r, i) => ({
              uploadUrl: `https://upload.linkedin.example/p${i}`,
              ...r,
            })),
          },
        },
      },
      { headers: { etag: '"a"' } },
      { headers: { etag: '"b"' } },
      { headers: { etag: '"c"' } },
      {},
      CREATED,
    ])

    const li = new LinkedInAdapter({ fetch: fetchImpl })
    await li.publish(
      ctx(),
      draft({
        media: [
          { id: 'v', kind: 'video', mime: 'video/mp4', bytes: size, localPath: file },
        ],
      }),
    )

    const puts = calls.filter((c) => c.method === 'PUT')
    assert.equal(puts.length, 3)
    assert.equal((puts[0]!.rawBody as Uint8Array).length, PART_BYTES)
    assert.equal((puts[1]!.rawBody as Uint8Array).length, PART_BYTES)
    assert.equal((puts[2]!.rawBody as Uint8Array).length, size - PART_BYTES * 2)

    // The declared size is ignored; the real file length is what is sent.
    const init = calls[0]!.body.initializeUploadRequest as { fileSizeBytes: number }
    assert.equal(init.fileSizeBytes, size)
  })
})

describe('documents (PDF carousels)', () => {
  /**
   * Request shapes from the Documents API on Microsoft Learn, checked
   * 2026-10-02: initializeUpload with the owner, one PUT of the whole file to
   * the uploadUrl, then content.media { id, title } on the post.
   */
  const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n', 'latin1')

  const DOC_INIT: Reply = {
    body: {
      value: {
        uploadUrlExpiresAt: 1650567510704,
        uploadUrl: 'https://www.linkedin.com/dms-uploads/DOC1/uploadedDocument/0',
        document: 'urn:li:document:DOC1',
      },
    },
  }
  const DOC_PUT: Reply = { status: 201 }
  const DOC_STATUS = (status: string): Reply => ({
    body: { id: 'urn:li:document:DOC1', owner: 'urn:li:person:ABC123', status },
  })

  const doc = (over: Partial<MediaRef> = {}): MediaRef => ({
    id: 'd1',
    kind: 'document',
    mime: 'application/pdf',
    bytes: PDF_BYTES.length,
    ...over,
  })

  async function onDisk(bytes: Uint8Array = PDF_BYTES, name = 'carousel.pdf'): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'li-doc-'))
    const file = join(dir, name)
    await writeFile(file, bytes)
    return file
  }

  const makeDocs = (replies: Reply[], options: Partial<LinkedInAdapterOptions> = {}) => {
    const { fetchImpl, calls } = mockLinkedIn(replies)
    const sleeps: number[] = []
    const li = new LinkedInAdapter({
      fetch: fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      ...options,
    })
    return { li, calls, sleeps }
  }

  const posts = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/rest/posts'))
  const codes = (issues: readonly { severity: string; code: string }[], severity: string) =>
    issues.filter((i) => i.severity === severity).map((i) => i.code)
  const sentTitle = (calls: Call[]) => (posts(calls)[0]!.body.content as { media: { title?: string } }).media.title

  test('from disk: initialise with the owner, one PUT of the whole file, then a post naming the document', async () => {
    const file = await onDisk()
    const { li, calls, sleeps } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), CREATED])
    const result = await li.publish(
      ctx(),
      draft({
        body: 'The limits (checked) #MetaAds',
        title: 'What one Meta ad can carry',
        media: [doc({ localPath: file })],
      }),
    )

    assert.equal(calls.length, 4)

    const init = calls[0]!
    assert.equal(init.method, 'POST')
    assert.equal(init.url, 'https://api.linkedin.com/rest/documents?action=initializeUpload')
    assert.deepEqual(init.body, { initializeUploadRequest: { owner: 'urn:li:person:ABC123' } })
    assert.match(init.headers['LinkedIn-Version']!, /^\d{6}$/)
    assert.equal(init.headers['X-Restli-Protocol-Version'], '2.0.0')
    assert.equal(init.headers.Authorization, 'Bearer LI_TOKEN')

    const put = calls[1]!
    assert.equal(put.method, 'PUT')
    assert.equal(put.url, 'https://www.linkedin.com/dms-uploads/DOC1/uploadedDocument/0')
    assert.equal(put.headers.Authorization, 'Bearer LI_TOKEN')
    assert.equal(put.headers['content-type'], 'application/pdf')
    // The whole file in one piece: no parts and no finalize call for a document.
    assert.deepEqual(Buffer.from(put.rawBody as Uint8Array), PDF_BYTES)
    assert.equal(calls.some((c) => c.url.includes('finalizeUpload')), false)

    const status = calls[2]!
    assert.equal(status.method, 'GET')
    assert.equal(status.url, 'https://api.linkedin.com/rest/documents/urn%3Ali%3Adocument%3ADOC1')
    assert.equal(status.rawBody, undefined)
    assert.match(status.headers['LinkedIn-Version']!, /^\d{6}$/)
    assert.equal(status.headers['X-Restli-Protocol-Version'], '2.0.0')

    const post = calls[3]!
    assert.equal(post.url, 'https://api.linkedin.com/rest/posts')
    assert.deepEqual(post.body.content, {
      media: { id: 'urn:li:document:DOC1', title: 'What one Meta ad can carry' },
    })
    assert.equal(post.body.commentary, 'The limits \\(checked\\) \\#MetaAds')
    assert.equal(post.body.lifecycleState, 'PUBLISHED')

    assert.equal(result.platformPostId, 'urn:li:share:999')
    assert.equal(result.notice, undefined)
    assert.deepEqual(sleeps, [])
  })

  test('the title is plain text, never escaped like the commentary', async () => {
    const file = await onDisk()
    const { li, calls } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), CREATED])
    await li.publish(ctx(), draft({ title: 'Meta "code 10" (#permissions)', media: [doc({ localPath: file })] }))
    assert.equal(sentTitle(calls), 'Meta "code 10" (#permissions)')
  })

  test("LinkedIn's own title override wins over the draft's", async () => {
    const file = await onDisk()
    const { li, calls } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), CREATED])
    await li.publish(
      ctx(),
      draft({
        title: 'Shared title',
        overrides: { linkedin: { title: 'LinkedIn title' } },
        media: [doc({ localPath: file })],
      }),
    )
    assert.equal(sentTitle(calls), 'LinkedIn title')
  })

  test('without a title, the first line of the text becomes it, shortened at a word, and validation says so', async () => {
    const file = await onDisk()
    const body = '\nOne Meta ad can carry a lot more than most people ever put in it, by far.\nSecond line.'
    const { li, calls } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), CREATED])
    const d = draft({ body, title: '   ', media: [doc({ localPath: file })] })

    const validation = li.validate(d)
    assert.equal(validation.ok, true)
    assert.ok(codes(validation.issues, 'warning').includes('document_title_from_text'))

    await li.publish(ctx(), d)
    const title = sentTitle(calls)!
    assert.ok(countGraphemes(title) <= LINKEDIN_DOCUMENT_TITLE_SHOWN, `"${title}" is too long`)
    assert.ok(title.endsWith('…'))
    assert.ok(title.startsWith('One Meta ad can carry'))
    assert.ok(!title.includes(' …'), 'cut at a word, without a dangling space')
  })

  test('a short first line is used whole', () => {
    const li = new LinkedInAdapter()
    const validation = li.validate(draft({ body: 'Three gates.\nMore text', media: [doc({ localPath: 'x.pdf' })] }))
    const issue = validation.issues.find((i) => i.code === 'document_title_from_text')!
    assert.match(issue.message, /"Three gates\."/)
  })

  test('with no title and no text, the file name is the title', async () => {
    const file = await onDisk(PDF_BYTES, 'Meta ad limits.pdf')
    const { li, calls } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), CREATED])
    const d = draft({ body: '', media: [doc({ localPath: file })] })

    assert.ok(codes(li.validate(d).issues, 'warning').includes('document_title_from_file'))
    await li.publish(ctx(), d)
    assert.equal(sentTitle(calls), 'Meta ad limits')
  })

  test('a hosted copy with no title or text is titled "Document", never by its hash', () => {
    const li = new LinkedInAdapter()
    const validation = li.validate(
      draft({
        body: '',
        media: [doc({ publicUrl: 'https://media.example.com/t1/9f86d081884c7d659a2feaa0c55ad015.pdf' })],
      }),
    )
    const issue = validation.issues.find((i) => i.code === 'document_title_default')!
    assert.match(issue.message, /"Document"/)
  })

  test("a title past LinkedIn's composer limit is a warning, and is sent unchanged", async () => {
    const title = 'Meta "code 10" permission errors: stop guessing, ask 3 questions'
    assert.ok(countGraphemes(title) > LINKEDIN_DOCUMENT_TITLE_SHOWN)
    const file = await onDisk()
    const { li, calls } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), CREATED])
    const d = draft({ title, media: [doc({ localPath: file })] })

    const validation = li.validate(d)
    assert.equal(validation.ok, true)
    const warning = validation.issues.find((i) => i.code === 'document_title_long')!
    assert.equal(warning.severity, 'warning')
    assert.match(warning.message, /64 characters/)

    await li.publish(ctx(), d)
    assert.equal(sentTitle(calls), title)
  })

  test('a title over 200 characters is refused before anything is sent', async () => {
    const { li, calls } = makeDocs([CREATED])
    const d = draft({ title: 'a'.repeat(201), media: [doc({ localPath: 'x.pdf' })] })
    assert.ok(codes(li.validate(d).issues, 'error').includes('title_too_long'))
    await assert.rejects(() => li.publish(ctx(), d), PublishError)
    assert.equal(calls.length, 0)
  })

  test('a document with an image, or with a video, is refused before any call', async () => {
    const clip: MediaRef = { id: 'v', kind: 'video', mime: 'video/mp4', bytes: 9, localPath: 'v.mp4' }
    for (const other of [img(), clip]) {
      const { li, calls } = makeDocs([CREATED])
      const d = draft({ media: [doc({ localPath: 'x.pdf' }), other] })
      assert.ok(codes(li.validate(d).issues, 'error').includes('mixed_media'), `with ${other.kind}`)
      await assert.rejects(
        () => li.publish(ctx(), d),
        (error: unknown) => {
          assert.ok(error instanceof PublishError)
          assert.equal(error.failureClass, 'permanent')
          return true
        },
      )
      assert.equal(calls.length, 0)
    }
  })

  test('two documents in one post are refused before any call', async () => {
    const { li, calls } = makeDocs([CREATED])
    const d = draft({ media: [doc({ id: 'a', localPath: 'a.pdf' }), doc({ id: 'b', localPath: 'b.pdf' })] })
    assert.ok(codes(li.validate(d).issues, 'error').includes('too_many_documents'))
    await assert.rejects(() => li.publish(ctx(), d), PublishError)
    assert.equal(calls.length, 0)
  })

  test('a document type LinkedIn does not take is refused', async () => {
    const { li, calls } = makeDocs([CREATED])
    const d = draft({ media: [doc({ mime: 'text/plain', localPath: 'notes.txt' })] })
    const validation = li.validate(d)
    assert.ok(codes(validation.issues, 'error').includes('document_type_unsupported'))
    assert.match(validation.issues.find((i) => i.code === 'document_type_unsupported')!.message, /text\/plain/)
    await assert.rejects(() => li.publish(ctx(), d), PublishError)
    assert.equal(calls.length, 0)
  })

  test('PowerPoint and Word files pass as LinkedIn documents', () => {
    const li = new LinkedInAdapter()
    for (const mime of [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]) {
      const validation = li.validate(draft({ title: 'T', media: [doc({ mime, localPath: 'deck.x' })] }))
      assert.equal(validation.ok, true, mime)
    }
  })

  test('an empty file is refused before anything is registered with LinkedIn', async () => {
    const file = await onDisk(new Uint8Array(0))
    const { li, calls } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), CREATED])
    await assert.rejects(
      () => li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file, bytes: 0 })] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'permanent')
        assert.match(error.message, /empty/)
        return true
      },
    )
    assert.equal(calls.length, 0)
  })

  test('a file labelled PDF that is not one is refused before anything is registered', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const file = await onDisk(png, 'fake.pdf')
    const { li, calls } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), CREATED])
    await assert.rejects(
      () => li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'permanent')
        assert.match(error.message, /does not start like one/)
        return true
      },
    )
    assert.equal(calls.length, 0)
  })

  test('a PDF signature a little way into the file still counts, as PDF readers allow', async () => {
    const file = await onDisk(Buffer.concat([Buffer.from('\r\n\r\n'), PDF_BYTES]))
    const { li, calls } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), CREATED])
    await li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] }))
    assert.equal(posts(calls).length, 1)
  })

  test('the 100 MB limit is checked against the real file, not the declared size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'li-doc-big-'))
    const file = join(dir, 'big.pdf')
    try {
      await writeFile(file, '')
      await truncate(file, 100_000_001)
      const { li, calls } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), CREATED])
      // Declared small, so validation passes and only the real size can catch it.
      await assert.rejects(
        () => li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file, bytes: 1_000 })] })),
        (error: unknown) => {
          assert.ok(error instanceof PublishError)
          assert.equal(error.failureClass, 'permanent')
          assert.match(error.message, /over LinkedIn's limit/)
          return true
        },
      )
      assert.equal(calls.length, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('a hosted document (a scheduled post) is downloaded first, then uploaded byte for byte', async () => {
    const { li, calls } = makeDocs([{ raw: PDF_BYTES }, DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), CREATED])
    await li.publish(ctx(), draft({ title: 'T', media: [doc({ publicUrl: 'https://media.example.com/t1/abc.pdf' })] }))

    assert.equal(calls[0]!.url, 'https://media.example.com/t1/abc.pdf')
    assert.match(calls[1]!.url, /\/rest\/documents\?action=initializeUpload$/)
    assert.equal(calls[2]!.method, 'PUT')
    assert.deepEqual(Buffer.from(calls[2]!.rawBody as Uint8Array), PDF_BYTES)
    assert.equal(posts(calls).length, 1)
  })

  test('waits while LinkedIn processes the document, then posts', async () => {
    const file = await onDisk()
    const { li, calls, sleeps } = makeDocs(
      [DOC_INIT, DOC_PUT, DOC_STATUS('WAITING_UPLOAD'), DOC_STATUS('PROCESSING'), DOC_STATUS('AVAILABLE'), CREATED],
      { documentPollIntervalMs: 1_234 },
    )
    const result = await li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] }))
    assert.deepEqual(sleeps, [1_234, 1_234])
    assert.equal(calls.filter((c) => c.method === 'GET').length, 3)
    assert.equal(posts(calls).length, 1)
    // Seen AVAILABLE, so it is plainly published.
    assert.equal(result.notice, undefined)
  })

  test('a document LinkedIn could not process is never posted, and says why', async () => {
    const file = await onDisk()
    const { li, calls } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('PROCESSING_FAILED'), CREATED])
    await assert.rejects(
      () => li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'permanent')
        assert.equal(error.code, 'MEDIA_PROCESSING_FAILED')
        assert.match(error.message, /nothing was posted/)
        return true
      },
    )
    assert.equal(posts(calls).length, 0)
  })

  test('still processing after the last check: transient, and nothing is posted', async () => {
    const file = await onDisk()
    const { li, calls, sleeps } = makeDocs(
      [DOC_INIT, DOC_PUT, DOC_STATUS('PROCESSING'), DOC_STATUS('PROCESSING'), DOC_STATUS('PROCESSING'), CREATED],
      { documentStatusChecks: 3 },
    )
    await assert.rejects(
      () => li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'transient')
        assert.equal(error.code, 'MEDIA_PROCESSING_TIMEOUT')
        return true
      },
    )
    assert.equal(sleeps.length, 2)
    assert.equal(posts(calls).length, 0)
  })

  test('a token that may not read the status (a member token) pauses once, then posts', async () => {
    const file = await onDisk()
    const forbidden: Reply = {
      status: 403,
      body: {
        message: 'Accessing this document resource is forbidden. Please check your permissions for this resource',
        status: 403,
      },
    }
    const { li, calls, sleeps } = makeDocs([DOC_INIT, DOC_PUT, forbidden, CREATED], { documentUnreadableWaitMs: 999 })
    const result = await li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] }))
    assert.deepEqual(sleeps, [999])
    assert.equal(calls.filter((c) => c.method === 'GET').length, 1, 'one read, no retry loop on a 403')
    assert.equal(posts(calls).length, 1)
    assert.equal(result.platformPostId, 'urn:li:share:999')
    // Posted on trust, so it must not be reported as plainly published: a
    // notice is what turns PUBLISHED into UPLOADED with a note everywhere.
    assert.match(result.notice!, /not confirmed as published/)
    assert.match(result.notice!, /could not read whether LinkedIn finished processing the document/)
    assert.match(result.notice!, /Check on LinkedIn that it shows the document's pages/)
  })

  test('the default pause for an unreadable status is 15 seconds', async () => {
    const file = await onDisk()
    const { li, sleeps } = makeDocs([DOC_INIT, DOC_PUT, { body: {} }, CREATED])
    const result = await li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] }))
    assert.deepEqual(sleeps, [15_000])
    assert.match(result.notice!, /not confirmed as published/)
  })

  test('a status read that fails partway through the polling still posts, but not as confirmed', async () => {
    // LinkedIn last said PROCESSING; the next read failed. The post goes out
    // after the pause, as the agreed fix keeps it, so the result must say the
    // document was never seen processed.
    const file = await onDisk()
    const serverError: Reply = { status: 500, body: { message: 'Internal Server Error', status: 500 } }
    const { li, calls, sleeps } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('PROCESSING'), serverError, CREATED])
    const result = await li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] }))
    assert.deepEqual(sleeps, [3_000, 15_000])
    assert.equal(calls.filter((c) => c.method === 'GET').length, 2)
    assert.equal(posts(calls).length, 1)
    assert.match(result.notice!, /not confirmed as published/)
  })

  test('a status read lost to the network posts after the pause, but not as confirmed', async () => {
    const file = await onDisk()
    const { li, sleeps } = makeDocs([DOC_INIT, DOC_PUT, { error: new TypeError('fetch failed') }, CREATED])
    const result = await li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] }))
    assert.deepEqual(sleeps, [15_000])
    assert.equal(result.platformPostId, 'urn:li:share:999')
    assert.match(result.notice!, /not confirmed as published/)
  })

  test('no upload address: transient, and nothing is uploaded or posted', async () => {
    const file = await onDisk()
    const { li, calls } = makeDocs([{ body: { value: { document: 'urn:li:document:X' } } }, DOC_PUT, CREATED])
    await assert.rejects(
      () => li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'transient')
        return true
      },
    )
    assert.equal(calls.some((c) => c.method === 'PUT'), false)
    assert.equal(posts(calls).length, 0)
  })

  test('a refused upload is not posted; a 5xx is worth retrying, a 4xx is not', async () => {
    for (const [status, failureClass] of [
      [400, 'permanent'],
      [503, 'transient'],
    ] as const) {
      const file = await onDisk()
      const { li, calls } = makeDocs([DOC_INIT, { status }, DOC_STATUS('AVAILABLE'), CREATED])
      await assert.rejects(
        () => li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] })),
        (error: unknown) => {
          assert.ok(error instanceof PublishError)
          assert.equal(error.failureClass, failureClass)
          assert.equal(error.httpStatus, status)
          return true
        },
      )
      assert.equal(calls.some((c) => c.method === 'GET'), false)
      assert.equal(posts(calls).length, 0)
    }
  })

  test('a post refused because its media is still waiting for upload is retried later', async () => {
    const file = await onDisk()
    const waiting: Reply = {
      status: 400,
      body: { message: 'Media asset is waiting upload', code: 'MEDIA_ASSET_WAITING_UPLOAD', status: 400 },
    }
    const { li } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), waiting])
    await assert.rejects(
      () => li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'transient')
        return true
      },
    )
  })

  test('a post refused because its media failed processing is not retried, and has its own diagnosis', async () => {
    const file = await onDisk()
    const failed: Reply = { status: 400, body: { message: 'Media asset failed processing', status: 400 } }
    const { li } = makeDocs([DOC_INIT, DOC_PUT, DOC_STATUS('AVAILABLE'), failed])
    await assert.rejects(
      () => li.publish(ctx(), draft({ title: 'T', media: [doc({ localPath: file })] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'permanent')
        assert.equal(error.code, 'MEDIA_PROCESSING_FAILED')
        return true
      },
    )
  })

  test('text, image and video posts are validated exactly as before documents existed', () => {
    const li = new LinkedInAdapter()
    const clip: MediaRef = { id: 'v', kind: 'video', mime: 'video/mp4', bytes: 9, localPath: 'v.mp4' }
    for (const d of [draft(), draft({ title: 'ignored here', media: [img()] }), draft({ media: [clip] })]) {
      assert.deepEqual(li.validate(d), validateAgainstCapabilities(d, 'linkedin', CAPABILITIES.linkedin))
    }
  })

  test('an image post still sends no title', async () => {
    const { fetchImpl, calls } = mockLinkedIn([
      { body: { value: { uploadUrl: 'https://upload.linkedin.example/abc', image: 'urn:li:image:IMG1' } } },
      { body: {} },
      {},
      CREATED,
    ])
    const result = await new LinkedInAdapter({ fetch: fetchImpl }).publish(
      ctx(),
      draft({ title: 'Not for images', media: [img()] }),
    )
    assert.deepEqual(posts(calls)[0]!.body.content, { media: { id: 'urn:li:image:IMG1' } })
    // Only a document has processing to confirm; an image post reads as it always did.
    assert.equal(result.notice, undefined)
  })
})
