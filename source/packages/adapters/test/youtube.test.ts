import { strict as assert } from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, describe } from 'node:test'

import { PublishError, type MediaRef, type PostDraft, type PublishContext } from '@social-publisher/core'

import {
  YOUTUBE_DEFAULT_CHUNK_BYTES,
  YouTubeAdapter,
  youTubeOptionsFromEnv,
  youtubeTagCharacters,
  type YouTubeAdapterOptions,
} from '../src/youtube.ts'

/**
 * The YouTube adapter against a scripted Google.
 *
 * Nothing here reaches Google: every reply comes from the script, so these
 * prove the protocol as documented, not that YouTube behaves as documented.
 * That has not been checked against the real API yet.
 */

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  rawBody: unknown
  redirect: string | undefined
}

interface Reply {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

/** A reply, a reply computed from the request, or an Error to throw as a network failure. */
type Step = Reply | ((call: Call) => Reply) | Error

function mockGoogle(steps: Step[]) {
  const calls: Call[] = []
  let index = 0

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(url),
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      rawBody: init?.body,
      redirect: init?.redirect,
    }
    calls.push(call)
    const step = steps[Math.min(index, steps.length - 1)] ?? {}
    index += 1
    if (step instanceof Error) throw step
    const reply = typeof step === 'function' ? step(call) : step
    const body =
      reply.body === undefined ? null : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)
    return new Response(body, { status: reply.status ?? 200, headers: reply.headers ?? {} })
  }) as unknown as typeof globalThis.fetch

  return { fetchImpl, calls }
}

const header = (call: Call, name: string): string | undefined =>
  Object.entries(call.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]

const json = (call: Call): Record<string, unknown> => JSON.parse(String(call.rawBody)) as Record<string, unknown>

const CHANNEL = 'UC1920agency'
const SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=SESSION1'

const MINE: Reply = { body: { items: [{ id: CHANNEL }] } }
const STARTED: Reply = { status: 200, headers: { location: SESSION } }
const CREATED = (privacy = 'private'): Reply => ({
  status: 201,
  body: { id: 'VID123', status: { privacyStatus: privacy, uploadStatus: 'uploaded' } },
})
const READ_BACK = (privacy = 'private'): Reply => ({ body: { items: [{ status: { privacyStatus: privacy } }] } })
const googleFailure = (status: number, reason: string, message = `Google says ${reason}`): Reply => ({
  status,
  body: { error: { code: status, message, errors: [{ domain: 'youtube', reason, message }] } },
})

/** A 308 acknowledging everything the request sent, as Google does for a whole chunk. */
const ackChunk = (call: Call): Reply => {
  const last = /bytes (\d+)-(\d+)\//.exec(header(call, 'content-range') ?? '')?.[2]
  return { status: 308, headers: last === undefined ? {} : { range: `bytes=0-${last}` } }
}

const ctx = (over: Partial<PublishContext['connection']> = {}): PublishContext => ({
  connection: {
    id: 'conn-yt',
    tenantId: 't1',
    platform: 'youtube',
    platformAccountId: CHANNEL,
    displayName: '1920 Agency',
    credentialSource: 'platform_app',
    scopes: [],
    needsReauth: false,
    ...over,
  },
  credential: { accessToken: 'YT_TOKEN' },
  idempotencyKey: 'idem-1',
})

async function videoFile(bytes: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yt-'))
  const file = join(dir, 'clip.mp4')
  await writeFile(file, Buffer.alloc(bytes, 7))
  return file
}

const vid = (path: string, over: Partial<MediaRef> = {}): MediaRef => ({
  id: 'v1',
  kind: 'video',
  mime: 'video/mp4',
  bytes: 1,
  localPath: path,
  durationSeconds: 30,
  ...over,
})

const draft = (over: Partial<PostDraft> = {}): PostDraft => ({
  body: 'Launch day\nWe shipped the thing.',
  media: [],
  ...over,
})

const make = (steps: Step[], options: YouTubeAdapterOptions = {}) => {
  const { fetchImpl, calls } = mockGoogle(steps)
  const sleeps: number[] = []
  const yt = new YouTubeAdapter({
    fetch: fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...options,
  })
  return { yt, calls, sleeps }
}

const SMALL_CHUNK = 262_144

const issueCodes = (r: { issues: readonly { code: string; severity: string }[] }, severity = 'error') =>
  r.issues.filter((i) => i.severity === severity).map((i) => i.code)

describe('validation', () => {
  const yt = new YouTubeAdapter()
  const media = [vid('clip.mp4')]

  test('uses the title it is given', () => {
    const result = yt.validate(draft({ title: 'Our launch', media }))
    assert.equal(result.ok, true)
    assert.deepEqual(issueCodes(result, 'warning').filter((c) => c === 'title_from_text'), [])
  })

  test('without a title, takes the first line of the text and says so', () => {
    const result = yt.validate(draft({ media }))
    assert.equal(result.ok, true)
    const warning = result.issues.find((i) => i.code === 'title_from_text')
    assert.ok(warning !== undefined)
    assert.match(warning.message, /"Launch day"/)
  })

  test('shortens a long first line at a word, inside 100 characters, never splitting an emoji', () => {
    const line = `${'word '.repeat(30)}\u{1F468}‍\u{1F469}‍\u{1F467}`
    const result = yt.validate(draft({ body: `${line}\nrest`, media }))
    const warning = result.issues.find((i) => i.code === 'title_from_text')!
    assert.match(warning.message, /shortened/)
    const title = /"(.*)"\.$/.exec(warning.message)![1]!
    assert.ok([...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(title)].length <= 100)
    assert.ok(title.endsWith('…'))
    assert.ok(!title.includes('  '))
  })

  test('a post with neither a title nor any text cannot be named', () => {
    assert.ok(issueCodes(yt.validate(draft({ body: '  \n ', media }))).includes('title_required'))
  })

  test('refuses an explicit title over 100 characters', () => {
    assert.ok(issueCodes(yt.validate(draft({ title: 'x'.repeat(101), media }))).includes('title_too_long'))
  })

  test('refuses < or > in the title', () => {
    assert.ok(issueCodes(yt.validate(draft({ title: 'A <b> title', media }))).includes('title_invalid_characters'))
  })

  test('counts the description in bytes, not characters', () => {
    // 1,700 euro signs are 1,700 characters but 5,100 bytes.
    const result = yt.validate(draft({ title: 'Price list', body: '€'.repeat(1_700), media }))
    const codes = issueCodes(result)
    assert.ok(codes.includes('description_too_long'))
    assert.ok(!codes.includes('text_too_long'), 'the character count alone would have passed it')
  })

  test('accepts a description of exactly 5,000 bytes', () => {
    const result = yt.validate(draft({ title: 'T', body: 'a'.repeat(5_000), media }))
    assert.ok(!issueCodes(result).includes('description_too_long'))
  })

  test('refuses < or > in the description, which YouTube rejects', () => {
    assert.ok(issueCodes(yt.validate(draft({ title: 'T', body: 'before -> after', media }))).includes('description_invalid_characters'))
  })

  test('needs exactly one video and no images', () => {
    assert.ok(issueCodes(yt.validate(draft({ title: 'T' }))).includes('media_required'))
    const image: MediaRef = { id: 'i', kind: 'image', mime: 'image/png', bytes: 1, localPath: 'a.png' }
    assert.ok(issueCodes(yt.validate(draft({ title: 'T', media: [image] }))).includes('unsupported_media_kind'))
    assert.ok(issueCodes(yt.validate(draft({ title: 'T', media: [vid('a'), vid('b')] }))).includes('too_many_media'))
  })

  test('tags count commas, and quotes around a tag with a space', () => {
    // Google's own examples: Foo-Baz is 7, Foo Baz is 9.
    assert.equal(youtubeTagCharacters(['Foo-Baz']), 7)
    assert.equal(youtubeTagCharacters(['Foo Baz']), 9)
    assert.equal(youtubeTagCharacters(['a', 'b']), 3)
    assert.equal(youtubeTagCharacters([]), 0)
  })

  test('refuses tags over 500 characters in total', () => {
    const tagged = new YouTubeAdapter({ tags: Array.from({ length: 60 }, (_, i) => `tag number ${i}`) })
    assert.ok(issueCodes(tagged.validate(draft({ title: 'T', media }))).includes('tags_too_long'))
  })
})

describe('the resumable upload', () => {
  test('starts a session with the real byte count from disk, not the declared one', async () => {
    const file = await videoFile(1_000)
    const { yt, calls } = make([MINE, STARTED, CREATED(), READ_BACK()])
    await yt.publish(ctx(), draft({ media: [vid(file, { bytes: 999_999 })] }))

    const start = calls[1]!
    assert.equal(start.method, 'POST')
    const url = new URL(start.url)
    assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/upload/youtube/v3/videos')
    assert.equal(url.searchParams.get('uploadType'), 'resumable')
    assert.equal(url.searchParams.get('part'), 'snippet,status')
    assert.equal(header(start, 'X-Upload-Content-Length'), '1000')
    assert.equal(header(start, 'X-Upload-Content-Type'), 'video/mp4')
    assert.equal(header(start, 'Content-Type'), 'application/json; charset=UTF-8')
  })

  test('a 308 means "carry on": each chunk starts after the byte Google acknowledged, and 201 finishes', async () => {
    const size = 600_000
    const file = await videoFile(size)
    const { yt, calls } = make([MINE, STARTED, ackChunk, ackChunk, CREATED(), READ_BACK()], {
      chunkBytes: SMALL_CHUNK,
    })
    const result = await yt.publish(ctx(), draft({ media: [vid(file)] }))

    const puts = calls.filter((c) => c.method === 'PUT')
    assert.deepEqual(
      puts.map((c) => header(c, 'Content-Range')),
      [`bytes 0-262143/${size}`, `bytes 262144-524287/${size}`, `bytes 524288-599999/${size}`],
    )
    assert.deepEqual(
      puts.map((c) => (c.rawBody as Uint8Array).length),
      [262_144, 262_144, size - 524_288],
    )
    assert.ok(puts.every((c) => c.url === SESSION))
    assert.ok(puts.every((c) => c.redirect === 'manual'), 'a 308 must not be followed as a redirect')
    assert.equal(result.platformPostId, 'VID123')
    assert.equal(result.url, 'https://www.youtube.com/watch?v=VID123')
  })

  test('every chunk but the last is the same size and a multiple of 256 KiB', async () => {
    assert.equal(YOUTUBE_DEFAULT_CHUNK_BYTES, 8 * 1024 * 1024)
    assert.equal(YOUTUBE_DEFAULT_CHUNK_BYTES % SMALL_CHUNK, 0)

    const size = 5 * SMALL_CHUNK + 1_234
    const file = await videoFile(size)
    const { yt, calls } = make([MINE, STARTED, ackChunk, ackChunk, CREATED(), READ_BACK()], {
      chunkBytes: 2 * SMALL_CHUNK,
    })
    await yt.publish(ctx(), draft({ media: [vid(file)] }))

    const lengths = calls.filter((c) => c.method === 'PUT').map((c) => (c.rawBody as Uint8Array).length)
    assert.deepEqual(lengths, [2 * SMALL_CHUNK, 2 * SMALL_CHUNK, SMALL_CHUNK + 1_234])
    for (const length of lengths.slice(0, -1)) assert.equal(length % SMALL_CHUNK, 0)
  })

  test('a small file goes up in one request', async () => {
    const file = await videoFile(4_096)
    const { yt, calls } = make([MINE, STARTED, CREATED(), READ_BACK()])
    await yt.publish(ctx(), draft({ media: [vid(file)] }))
    const puts = calls.filter((c) => c.method === 'PUT')
    assert.equal(puts.length, 1)
    assert.equal(header(puts[0]!, 'Content-Range'), 'bytes 0-4095/4096')
  })

  test('refuses a misaligned chunk size up front', () => {
    assert.throws(() => new YouTubeAdapter({ chunkBytes: 1_000_000 }), RangeError)
    assert.throws(() => new YouTubeAdapter({ chunkBytes: 0 }), RangeError)
  })

  test('after a 5xx it asks what arrived, then resumes from there', async () => {
    // Google warns a chunk may have arrived in full, in part or not at all, so
    // the session is asked rather than assumed.
    const size = 3 * SMALL_CHUNK
    const file = await videoFile(size)
    const { yt, calls, sleeps } = make(
      [
        MINE,
        STARTED,
        ackChunk, // chunk 1 accepted
        { status: 503 }, // chunk 2: no idea how much arrived
        { status: 308, headers: { range: `bytes=0-${2 * SMALL_CHUNK - 1}` } }, // it all did
        CREATED(),
        READ_BACK(),
      ],
      { chunkBytes: SMALL_CHUNK },
    )
    await yt.publish(ctx(), draft({ media: [vid(file)] }))

    const puts = calls.filter((c) => c.method === 'PUT')
    const status = puts[2]!
    assert.equal(header(status, 'Content-Range'), `bytes */${size}`)
    assert.equal((status.rawBody as Uint8Array).length, 0)
    assert.equal(header(puts[3]!, 'Content-Range'), `bytes ${2 * SMALL_CHUNK}-${size - 1}/${size}`)
    assert.equal(sleeps.length, 1, 'backs off once before asking')
  })

  test('a dropped connection is resumed the same way', async () => {
    const size = 2 * SMALL_CHUNK
    const file = await videoFile(size)
    const { yt, calls } = make(
      [
        MINE,
        STARTED,
        new TypeError('fetch failed'),
        { status: 308 }, // nothing arrived: no Range header
        ackChunk,
        CREATED(),
        READ_BACK(),
      ],
      { chunkBytes: SMALL_CHUNK },
    )
    const result = await yt.publish(ctx(), draft({ media: [vid(file)] }))

    const ranges = calls.filter((c) => c.method === 'PUT').map((c) => header(c, 'Content-Range'))
    assert.deepEqual(ranges, [
      `bytes 0-262143/${size}`,
      `bytes */${size}`,
      `bytes 0-262143/${size}`,
      `bytes 262144-524287/${size}`,
    ])
    assert.equal(result.platformPostId, 'VID123')
  })

  test('honours Retry-After on a 503', async () => {
    const file = await videoFile(SMALL_CHUNK)
    const { yt, sleeps } = make(
      [MINE, STARTED, { status: 503, headers: { 'retry-after': '7' } }, { status: 308 }, CREATED(), READ_BACK()],
      { chunkBytes: SMALL_CHUNK },
    )
    await yt.publish(ctx(), draft({ media: [vid(file)] }))
    assert.deepEqual(sleeps, [7_000])
  })

  test('gives up after repeated interruptions before the last chunk, as a transient error the worker retries', async () => {
    // Two chunks, so the failing one is not the last: no video can exist yet.
    const file = await videoFile(2 * SMALL_CHUNK)
    const { yt, calls } = make([MINE, STARTED, { status: 503 }], { chunkBytes: SMALL_CHUNK, maxResumeAttempts: 2 })

    await assert.rejects(
      () => yt.publish(ctx(), draft({ media: [vid(file)] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'transient')
        assert.match(error.message, /Nothing was published/)
        return true
      },
    )
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 3)
  })

  test('an expired session before the last chunk is transient, so the job retries with a fresh upload', async () => {
    const file = await videoFile(2 * SMALL_CHUNK)
    const { yt, calls } = make([MINE, STARTED, { status: 404 }], { chunkBytes: SMALL_CHUNK })
    await assert.rejects(
      () => yt.publish(ctx(), draft({ media: [vid(file)] })),
      (error: unknown) => error instanceof PublishError && error.failureClass === 'transient' && error.httpStatus === 404,
    )
    assert.equal(calls.length, 3, 'nothing is sent to a dead session')
  })

  test('a token that runs out mid-upload is transient: the next attempt renews it', async () => {
    const file = await videoFile(2 * SMALL_CHUNK)
    const { yt } = make([MINE, STARTED, { status: 401 }], { chunkBytes: SMALL_CHUNK })
    await assert.rejects(
      () => yt.publish(ctx(), draft({ media: [vid(file)] })),
      (error: unknown) => error instanceof PublishError && error.failureClass === 'transient',
    )
  })

  test('refuses an empty file before opening a session', async () => {
    const file = await videoFile(0)
    const { yt, calls } = make([MINE, STARTED, CREATED()])
    await assert.rejects(
      () => yt.publish(ctx(), draft({ media: [vid(file)] })),
      (error: unknown) => error instanceof PublishError && error.failureClass === 'permanent',
    )
    assert.equal(calls.length, 1, 'only the channel check ran')
  })

  test('downloads media given only a URL, then uploads it', async () => {
    const { yt, calls } = make([MINE, { body: 'x'.repeat(5_000) }, STARTED, CREATED(), READ_BACK()])
    const media: MediaRef = { id: 'v', kind: 'video', mime: 'video/mp4', bytes: 0, publicUrl: 'https://media.example.com/v.mp4' }
    await yt.publish(ctx(), draft({ media: [media] }))

    assert.equal(calls[1]!.url, 'https://media.example.com/v.mp4')
    assert.equal(header(calls[2]!, 'X-Upload-Content-Length'), '5000')
  })

  test('a finished upload with no video id is permanent, so it is not uploaded twice', async () => {
    const file = await videoFile(10)
    const { yt } = make([MINE, STARTED, { status: 201, body: {} }])
    await assert.rejects(
      () => yt.publish(ctx(), draft({ media: [vid(file)] })),
      (error: unknown) =>
        error instanceof PublishError &&
        error.failureClass === 'permanent' &&
        error.code === 'YOUTUBE_UPLOAD_UNCONFIRMED',
    )
  })
})

/**
 * A YouTube that keeps state across attempts, for the duplicate tests.
 *
 * It follows the documented protocol: the video exists the moment a session
 * holds every byte, whatever then happens to the reply, and a status check on
 * a finished session repeats the 201. `lastReply` decides what the request that
 * completes each upload gets back; `statusFailures` how many status checks
 * fail after that, and how.
 */
function fakeChannel(plan: {
  lastReply: 'ok' | 'lost' | 'slow-down'
  statusFailures?: number
  statusFailure?: Reply | Error
}) {
  const videos: string[] = []
  const sessions = new Map<string, { held: number; video?: string }>()
  let statusFailuresLeft = plan.statusFailures ?? 0
  let statusChecks = 0
  let completions = 0
  const dropped = () => new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
  const made = (id: string) =>
    new Response(JSON.stringify({ id, status: { privacyStatus: 'private', uploadStatus: 'uploaded' } }), { status: 201 })

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url)
    const method = init?.method ?? 'GET'
    const headers = (init?.headers as Record<string, string> | undefined) ?? {}
    if (address.includes('/youtube/v3/channels')) return new Response(JSON.stringify(MINE.body))
    if (method === 'GET') return new Response(JSON.stringify(READ_BACK().body))
    if (method === 'POST') {
      const session = `${SESSION.replace('SESSION1', '')}S${sessions.size + 1}`
      sessions.set(session, { held: 0 })
      return new Response(null, { status: 200, headers: { location: session } })
    }

    const session = sessions.get(address)!
    const range = headers['Content-Range'] ?? ''
    if (range.startsWith('bytes */')) {
      statusChecks += 1
      if (statusFailuresLeft > 0) {
        statusFailuresLeft -= 1
        const failure = plan.statusFailure ?? dropped()
        if (failure instanceof Error) throw failure
        return new Response(failure.body === undefined ? null : JSON.stringify(failure.body), {
          status: failure.status ?? 200,
          headers: failure.headers ?? {},
        })
      }
      if (session.video !== undefined) return made(session.video)
      return new Response(null, { status: 308, headers: session.held > 0 ? { range: `bytes=0-${session.held - 1}` } : {} })
    }

    const [, , last, total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(range)!.map(Number) as [number, number, number, number]
    session.held = last + 1
    if (session.held < total) return new Response(null, { status: 308, headers: { range: `bytes=0-${last}` } })
    // Every byte is here: the video now exists on the channel, reply or not.
    const id = `VID${videos.length + 1}`
    videos.push(id)
    session.video = id
    completions += 1
    if (completions === 1 && plan.lastReply === 'lost') throw dropped()
    if (completions === 1 && plan.lastReply === 'slow-down') {
      return new Response(null, { status: 503, headers: { 'retry-after': '120' } })
    }
    return made(id)
  }) as unknown as typeof globalThis.fetch

  return { fetchImpl, videos, statusChecks: () => statusChecks, sessionsOpened: () => sessions.size }
}

/** Publishes the way the worker does: again while the failure is retryable, at most six times. */
async function publishLikeTheWorker(yt: YouTubeAdapter, post: PostDraft): Promise<{ outcomes: string[]; errors: unknown[] }> {
  const outcomes: string[] = []
  const errors: unknown[] = []
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      outcomes.push(`published ${(await yt.publish(ctx(), post)).platformPostId}`)
      break
    } catch (error) {
      errors.push(error)
      const retryable = error instanceof PublishError && error.isRetryable
      outcomes.push(retryable ? 'retryable' : 'final')
      if (!retryable) break
    }
  }
  return { outcomes, errors }
}

const unconfirmedUpload = (error: unknown): boolean => {
  assert.ok(error instanceof PublishError)
  assert.equal(error.code, 'YOUTUBE_UPLOAD_UNCONFIRMED')
  assert.equal(error.failureClass, 'permanent', 'never retryable: a retry would be a second copy')
  assert.match(error.message, /YouTube Studio/)
  assert.doesNotMatch(error.message, /Nothing was published/, 'the video may well exist')
  return true
}

describe('once the last byte has gone out', () => {
  test('a lost reply is recovered by asking the session, and the video is uploaded once', async () => {
    const file = await videoFile(10_000)
    const channel = fakeChannel({ lastReply: 'lost' })
    const yt = new YouTubeAdapter({ fetch: channel.fetchImpl, sleep: async () => {} })

    const { outcomes } = await publishLikeTheWorker(yt, draft({ media: [vid(file)] }))
    assert.deepEqual(outcomes, ['published VID1'])
    assert.deepEqual(channel.videos, ['VID1'])
  })

  test('a lost reply with the session unreachable after it is unconfirmed, so nothing uploads it twice', async () => {
    // The reviewers' case: one chunk, which is also the last. Before the fix
    // this said "Nothing was published" as a transient error, the retry
    // uploaded the video again, and the channel held VID1 and VID2.
    const file = await videoFile(10_000)
    const channel = fakeChannel({ lastReply: 'lost', statusFailures: 5 })
    const yt = new YouTubeAdapter({ fetch: channel.fetchImpl, sleep: async () => {} })

    const { outcomes, errors } = await publishLikeTheWorker(yt, draft({ media: [vid(file)] }))
    assert.deepEqual(outcomes, ['final'])
    assert.ok(unconfirmedUpload(errors[0]))
    assert.deepEqual(channel.videos, ['VID1'])
    assert.equal(channel.sessionsOpened(), 1)
  })

  test('the same holds for the last of several chunks', async () => {
    const file = await videoFile(600_000)
    const channel = fakeChannel({ lastReply: 'lost', statusFailures: 5 })
    const yt = new YouTubeAdapter({ fetch: channel.fetchImpl, sleep: async () => {}, chunkBytes: SMALL_CHUNK })

    const { outcomes, errors } = await publishLikeTheWorker(yt, draft({ media: [vid(file)] }))
    assert.deepEqual(outcomes, ['final'])
    assert.ok(unconfirmedUpload(errors[0]))
    assert.doesNotMatch((errors[0] as Error).message, /stopped at byte/)
    assert.deepEqual(channel.videos, ['VID1'])
  })

  test('a status check refused after the last chunk is unconfirmed too, whatever the refusal', async () => {
    const refusals: Array<Reply | Error> = [{ status: 404 }, { status: 401 }, googleFailure(400, 'badRequest')]
    for (const statusFailure of refusals) {
      const file = await videoFile(10_000)
      const channel = fakeChannel({ lastReply: 'lost', statusFailures: 1, statusFailure })
      const yt = new YouTubeAdapter({ fetch: channel.fetchImpl, sleep: async () => {} })

      const { outcomes, errors } = await publishLikeTheWorker(yt, draft({ media: [vid(file)] }))
      assert.deepEqual(outcomes, ['final'], JSON.stringify(statusFailure))
      assert.ok(unconfirmedUpload(errors[0]))
      assert.deepEqual(channel.videos, ['VID1'])
    }
  })

  test('a long Retry-After on the last chunk is not given up on blind: the session is asked once first', async () => {
    const file = await videoFile(10_000)
    const channel = fakeChannel({ lastReply: 'slow-down' })
    const sleeps: number[] = []
    const yt = new YouTubeAdapter({ fetch: channel.fetchImpl, sleep: async (ms) => void sleeps.push(ms) })

    const { outcomes } = await publishLikeTheWorker(yt, draft({ media: [vid(file)] }))
    assert.deepEqual(outcomes, ['published VID1'])
    assert.equal(channel.statusChecks(), 1)
    assert.deepEqual(sleeps, [60_000], 'waits the longest inline wait, never the full two minutes')
    assert.deepEqual(channel.videos, ['VID1'])
  })

  test('when that one status check is told to wait as well, the upload is unconfirmed, not "tried again later"', async () => {
    const file = await videoFile(10_000)
    const channel = fakeChannel({
      lastReply: 'slow-down',
      statusFailures: 1,
      statusFailure: { status: 503, headers: { 'retry-after': '120' } },
    })
    const yt = new YouTubeAdapter({ fetch: channel.fetchImpl, sleep: async () => {} })

    const { outcomes, errors } = await publishLikeTheWorker(yt, draft({ media: [vid(file)] }))
    assert.deepEqual(outcomes, ['final'])
    assert.ok(unconfirmedUpload(errors[0]))
    assert.equal(channel.statusChecks(), 1, 'asked once, not repeatedly against the wait')
    assert.deepEqual(channel.videos, ['VID1'])
  })

  test('a long Retry-After before the last chunk still hands the wait to the worker', async () => {
    const file = await videoFile(2 * SMALL_CHUNK)
    const { yt, calls } = make([MINE, STARTED, { status: 503, headers: { 'retry-after': '120' } }], {
      chunkBytes: SMALL_CHUNK,
    })
    await assert.rejects(
      () => yt.publish(ctx(), draft({ media: [vid(file)] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'transient', 'no video can exist before the last byte')
        assert.equal(error.retryAfterSeconds, 120)
        return true
      },
    )
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 1, 'no status check is needed to know that')
  })

  test('a cancel while the last chunk is in flight is unconfirmed; a cancel before it is not', async () => {
    const cancelOn = (chunkIndex: number) => {
      const controller = new AbortController()
      let puts = 0
      const step = (call: Call): Reply => {
        puts += 1
        if (puts === chunkIndex) {
          controller.abort()
          throw new DOMException('This operation was aborted', 'AbortError')
        }
        return ackChunk(call)
      }
      return { controller, step }
    }

    const file = await videoFile(2 * SMALL_CHUNK)

    const late = cancelOn(2)
    const { yt: lateYt } = make([MINE, STARTED, late.step], { chunkBytes: SMALL_CHUNK })
    await assert.rejects(
      () => lateYt.publish({ ...ctx(), signal: late.controller.signal }, draft({ media: [vid(file)] })),
      unconfirmedUpload,
    )

    const early = cancelOn(1)
    const { yt: earlyYt } = make([MINE, STARTED, early.step], { chunkBytes: SMALL_CHUNK })
    await assert.rejects(
      () => earlyYt.publish({ ...ctx(), signal: early.controller.signal }, draft({ media: [vid(file)] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.match(error.message, /cancelled before it finished\. Nothing was published/)
        assert.notEqual(error.code, 'YOUTUBE_UPLOAD_UNCONFIRMED')
        return true
      },
    )
  })
})

describe('what is sent', () => {
  test('the token goes only in the Authorization header, never in a URL or body', async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([MINE, STARTED, CREATED(), READ_BACK()])
    await yt.publish(ctx(), draft({ media: [vid(file)] }))

    for (const call of calls) {
      assert.equal(header(call, 'Authorization'), 'Bearer YT_TOKEN')
      assert.ok(!call.url.includes('YT_TOKEN'), `token in ${call.url}`)
      if (typeof call.rawBody === 'string') assert.ok(!call.rawBody.includes('YT_TOKEN'))
    }
  })

  test('never sends the token to an upload address outside Google', async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([MINE, { status: 200, headers: { location: 'https://upload.example.com/x' } }, CREATED()])
    await assert.rejects(() => yt.publish(ctx(), draft({ media: [vid(file)] })), PublishError)
    assert.ok(!calls.some((c) => c.url.startsWith('https://upload.example.com')))
  })

  test('sends the title, the text as the description, and a string category', async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([MINE, STARTED, CREATED(), READ_BACK()])
    await yt.publish(ctx(), draft({ title: 'Our launch', media: [vid(file)] }))

    const snippet = json(calls[1]!).snippet as Record<string, unknown>
    assert.equal(snippet.title, 'Our launch')
    assert.equal(snippet.description, 'Launch day\nWe shipped the thing.')
    assert.equal(snippet.categoryId, '22')
  })

  test('uses the first line as the title when none is given', async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([MINE, STARTED, CREATED(), READ_BACK()])
    await yt.publish(ctx(), draft({ media: [vid(file)] }))
    assert.equal((json(calls[1]!).snippet as Record<string, unknown>).title, 'Launch day')
  })

  test('declares the audience and the AI disclosure explicitly, false unless asked', async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([MINE, STARTED, CREATED(), READ_BACK()])
    await yt.publish(ctx(), draft({ media: [vid(file)] }))
    const status = json(calls[1]!).status as Record<string, unknown>
    assert.equal(status.selfDeclaredMadeForKids, false)
    assert.equal(status.containsSyntheticMedia, false)
  })

  test('declares synthetic media when the post says so', async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([MINE, STARTED, CREATED(), READ_BACK()])
    await yt.publish(ctx(), draft({ syntheticMedia: true, media: [vid(file)] }))
    assert.equal((json(calls[1]!).status as Record<string, unknown>).containsSyntheticMedia, true)
  })

  test("a scheduled post's title and disclosure, stored as overrides, are what is sent", async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([MINE, STARTED, CREATED(), READ_BACK()])
    await yt.publish(
      ctx(),
      draft({ media: [vid(file)], overrides: { youtube: { title: 'Stored title', syntheticMedia: true } } }),
    )
    const sent = json(calls[1]!)
    assert.equal((sent.snippet as Record<string, unknown>).title, 'Stored title')
    assert.equal((sent.status as Record<string, unknown>).containsSyntheticMedia, true)
  })
})

describe('privacy, reported honestly', () => {
  test('uploads private until the project is audited, whatever is configured, and says so', async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([MINE, STARTED, CREATED('private'), READ_BACK('private')], { privacy: 'public' })
    const result = await yt.publish(ctx(), draft({ media: [vid(file)] }))

    assert.equal((json(calls[1]!).status as Record<string, unknown>).privacyStatus, 'private')
    assert.match(result.notice!, /^Uploaded as private, not published/)
    assert.match(result.notice!, /YOUTUBE_UPLOADS_AUDITED/)
  })

  test('reads back the privacy YouTube actually applied', async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([MINE, STARTED, CREATED(), READ_BACK()])
    await yt.publish(ctx(), draft({ media: [vid(file)] }))

    const readBack = new URL(calls[3]!.url)
    assert.equal(readBack.pathname, '/youtube/v3/videos')
    assert.equal(readBack.searchParams.get('part'), 'status')
    assert.equal(readBack.searchParams.get('id'), 'VID123')
  })

  test('once audited, a public upload is published and carries no notice', async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([MINE, STARTED, CREATED('public'), READ_BACK('public')], {
      audited: true,
      privacy: 'public',
    })
    const result = await yt.publish(ctx(), draft({ media: [vid(file)] }))

    assert.equal((json(calls[1]!).status as Record<string, unknown>).privacyStatus, 'public')
    assert.equal(result.notice, undefined)
  })

  test('reports what YouTube applied when it is not what was asked for', async () => {
    const file = await videoFile(10)
    const { yt } = make([MINE, STARTED, CREATED('public'), READ_BACK('private')], { audited: true, privacy: 'public' })
    const result = await yt.publish(ctx(), draft({ media: [vid(file)] }))
    assert.match(result.notice!, /Uploaded as private, not public as requested/)
  })

  test('an unlisted upload says it is unlisted', async () => {
    const file = await videoFile(10)
    const { yt } = make([MINE, STARTED, CREATED('unlisted'), READ_BACK('unlisted')], { audited: true, privacy: 'unlisted' })
    assert.match((await yt.publish(ctx(), draft({ media: [vid(file)] }))).notice!, /unlisted/)
  })

  test('a failed read-back never fails a finished upload, and the result says it is unconfirmed', async () => {
    // The video exists. Throwing now would have the worker upload it again.
    const file = await videoFile(10)
    const { yt } = make([MINE, STARTED, CREATED('public'), { status: 500 }], { audited: true, privacy: 'public' })
    const result = await yt.publish(ctx(), draft({ media: [vid(file)] }))

    assert.equal(result.platformPostId, 'VID123')
    assert.match(result.notice!, /confirm it failed/)
  })
})

describe('one token, one channel', () => {
  test('checks which channel the token belongs to before anything else', async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([MINE, STARTED, CREATED(), READ_BACK()])
    await yt.publish(ctx(), draft({ media: [vid(file)] }))

    const check = new URL(calls[0]!.url)
    assert.equal(check.pathname, '/youtube/v3/channels')
    assert.equal(check.searchParams.get('part'), 'id')
    assert.equal(check.searchParams.get('mine'), 'true')
  })

  test("refuses a token for another channel, and uploads nothing", async () => {
    const file = await videoFile(10)
    const { yt, calls } = make([{ body: { items: [{ id: 'UCsomeoneElse' }] } }, STARTED, CREATED()])
    await assert.rejects(
      () => yt.publish(ctx(), draft({ media: [vid(file)] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.code, 'YOUTUBE_WRONG_CHANNEL')
        assert.equal(error.failureClass, 'credential')
        assert.match(error.message, /UCsomeoneElse/)
        return true
      },
    )
    assert.equal(calls.length, 1)
  })

  test('an account with no channel is told so, whichever way Google says it', async () => {
    const file = await videoFile(10)
    for (const reply of [{ body: { items: [] } }, googleFailure(401, 'youtubeSignupRequired')]) {
      const { yt, calls } = make([reply])
      await assert.rejects(
        () => yt.publish(ctx(), draft({ media: [vid(file)] })),
        (error: unknown) => {
          assert.ok(error instanceof PublishError)
          assert.equal(error.code, 'YOUTUBE_NO_CHANNEL')
          assert.equal(error.failureClass, 'permanent', 'reconnecting cannot create a channel')
          return true
        },
      )
      assert.equal(calls.length, 1)
    }
  })
})

describe('errors, classified by what Google says', () => {
  const failingStart = async (reply: Reply) => {
    const file = await videoFile(10)
    const { yt } = make([MINE, reply])
    try {
      await yt.publish(ctx(), draft({ media: [vid(file)] }))
    } catch (error) {
      assert.ok(error instanceof PublishError)
      return error
    }
    assert.fail('should have thrown')
  }

  test('a spent quota is transient and waits for the midnight Pacific reset, not "token expired"', async () => {
    const error = await failingStart(googleFailure(403, 'quotaExceeded'))
    assert.equal(error.failureClass, 'transient')
    assert.equal(error.code, 'QUOTA_EXHAUSTED')
    assert.ok(error.retryAfterSeconds !== undefined && error.retryAfterSeconds > 0)
    assert.ok(error.retryAfterSeconds <= 86_400 + 300)
  })

  test('a rate limit is transient', async () => {
    const error = await failingStart(googleFailure(403, 'rateLimitExceeded'))
    assert.equal(error.failureClass, 'transient')
    assert.equal(error.code, 'RATE_LIMITED')
  })

  test('an unticked permission is permanent, with its own diagnosis', async () => {
    const error = await failingStart(googleFailure(403, 'insufficientPermissions'))
    assert.equal(error.failureClass, 'permanent')
    assert.equal(error.code, 'GOOGLE_SCOPE_NOT_GRANTED')
  })

  test('a switched-off API is permanent, with its own diagnosis', async () => {
    const error = await failingStart(googleFailure(403, 'accessNotConfigured'))
    assert.equal(error.failureClass, 'permanent')
    assert.equal(error.code, 'GOOGLE_API_NOT_ENABLED')
  })

  test("the channel's own daily limit is waited out", async () => {
    const error = await failingStart(googleFailure(400, 'uploadLimitExceeded'))
    assert.equal(error.failureClass, 'transient')
    assert.equal(error.code, 'YOUTUBE_CHANNEL_UPLOAD_LIMIT')
    assert.equal(error.retryAfterSeconds, 86_400)
  })

  test('a refused token is a credential problem', async () => {
    const { yt } = make([googleFailure(401, 'authError', 'Invalid Credentials')])
    await assert.rejects(
      () => yt.publish(ctx(), draft({ media: [vid('clip.mp4')] })),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'credential')
        assert.equal(error.code, 'GOOGLE_TOKEN_REVOKED')
        return true
      },
    )
  })

  test("an unrecognised 403 is not mistaken for a dead token", async () => {
    const error = await failingStart(googleFailure(403, 'forbiddenPrivacySetting'))
    assert.equal(error.failureClass, 'permanent')
  })

  test("keeps Google's own message verbatim and its reason as the platform code", async () => {
    const error = await failingStart(googleFailure(400, 'invalidTitle', 'The request metadata specifies an invalid or empty video title.'))
    assert.equal(error.platformMessage, 'The request metadata specifies an invalid or empty video title.')
    assert.equal(error.platformCode, 'invalidTitle')
    assert.equal(error.failureClass, 'permanent')
  })

  test('a draft that is invalid at publish time is refused before any call', async () => {
    const { yt, calls } = make([MINE])
    await assert.rejects(() => yt.publish(ctx(), draft({ title: 'T' })), (error: unknown) => {
      assert.ok(error instanceof PublishError)
      assert.equal(error.failureClass, 'permanent')
      // The worker is where a scheduled post loses its video, so the error says so.
      assert.match(error.message, /scheduled/)
      return true
    })
    assert.equal(calls.length, 0)
  })
})

describe('renewing the hour-long access token', () => {
  test('without the OAuth client there is no refreshCredential, so the vault knows it cannot renew', () => {
    assert.equal(new YouTubeAdapter().refreshCredential, undefined)
  })

  test('with it, renews with the refresh token and keeps that token', async () => {
    const { fetchImpl, calls } = mockGoogle([{ body: { access_token: 'NEW', expires_in: 3599, token_type: 'Bearer' } }])
    const yt = new YouTubeAdapter({ fetch: fetchImpl, oauth: { clientId: 'CID', clientSecret: 'CSECRET' } })
    const renewed = await yt.refreshCredential!({ accessToken: 'OLD', refreshToken: 'R1' })

    assert.equal(renewed.accessToken, 'NEW')
    assert.equal(renewed.refreshToken, 'R1')
    const minutes = (renewed.expiresAt!.getTime() - Date.now()) / 60_000
    assert.ok(minutes > 58 && minutes < 61)

    const call = calls[0]!
    assert.equal(call.url, 'https://oauth2.googleapis.com/token')
    const form = new URLSearchParams(String(call.rawBody))
    assert.equal(form.get('grant_type'), 'refresh_token')
    assert.equal(form.get('refresh_token'), 'R1')
    assert.equal(form.get('client_secret'), 'CSECRET')
  })

  test('a revoked refresh token is a credential failure the vault turns into "reconnect"', async () => {
    const { fetchImpl } = mockGoogle([{ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }])
    const yt = new YouTubeAdapter({ fetch: fetchImpl, oauth: { clientId: 'C', clientSecret: 'S' } })
    await assert.rejects(
      () => yt.refreshCredential!({ accessToken: 'OLD', refreshToken: 'R1' }),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.equal(error.failureClass, 'credential')
        assert.equal(error.code, 'GOOGLE_TOKEN_REVOKED')
        return true
      },
    )
  })

  test('a network failure while renewing is transient, so the vault marks nothing', async () => {
    const { fetchImpl } = mockGoogle([new TypeError('fetch failed')])
    const yt = new YouTubeAdapter({ fetch: fetchImpl, oauth: { clientId: 'C', clientSecret: 'S' } })
    await assert.rejects(
      () => yt.refreshCredential!({ accessToken: 'OLD', refreshToken: 'R1' }),
      (error: unknown) => (error as { failureClass?: string }).failureClass === 'transient',
    )
  })

  test('a Google outage while renewing is transient too', async () => {
    const { fetchImpl } = mockGoogle([{ status: 503, body: { error: 'backend_error' } }])
    const yt = new YouTubeAdapter({ fetch: fetchImpl, oauth: { clientId: 'C', clientSecret: 'S' } })
    await assert.rejects(
      () => yt.refreshCredential!({ accessToken: 'OLD', refreshToken: 'R1' }),
      (error: unknown) => (error as { failureClass?: string }).failureClass === 'transient',
    )
  })

  test('a credential with no refresh token cannot be renewed', async () => {
    const { fetchImpl, calls } = mockGoogle([{ body: {} }])
    const yt = new YouTubeAdapter({ fetch: fetchImpl, oauth: { clientId: 'C', clientSecret: 'S' } })
    await assert.rejects(
      () => yt.refreshCredential!({ accessToken: 'OLD' }),
      (error: unknown) => (error as { failureClass?: string }).failureClass === 'credential',
    )
    assert.equal(calls.length, 0)
  })
})

describe('settings from the environment', () => {
  const env = (values: Record<string, string>) => (key: string) => values[key]

  test('defaults to private, unaudited, People & Blogs, and no OAuth client', () => {
    const options = youTubeOptionsFromEnv(env({}))
    assert.equal(options.audited, false)
    assert.equal(options.privacy, 'private')
    assert.equal(options.categoryId, '22')
    assert.equal(options.oauth, undefined)
  })

  test('a typo never makes a video public', () => {
    const options = youTubeOptionsFromEnv(env({ YOUTUBE_DEFAULT_PRIVACY: 'pubic', YOUTUBE_UPLOADS_AUDITED: 'ture' }))
    assert.equal(options.privacy, 'private')
    assert.equal(options.audited, false)
  })

  test('reads the configured values and the client', () => {
    const options = youTubeOptionsFromEnv(
      env({
        YOUTUBE_DEFAULT_PRIVACY: 'Unlisted',
        YOUTUBE_UPLOADS_AUDITED: 'true',
        YOUTUBE_CATEGORY_ID: '27',
        GOOGLE_CLIENT_ID: 'CID',
        GOOGLE_CLIENT_SECRET: 'CS',
      }),
    )
    assert.equal(options.privacy, 'unlisted')
    assert.equal(options.audited, true)
    assert.equal(options.categoryId, '27')
    assert.deepEqual(options.oauth, { clientId: 'CID', clientSecret: 'CS' })
  })
})

describe('limits on the upload loop', () => {
  test('a session that keeps giving back ground is stopped, not chased forever', async () => {
    // Each chunk is acknowledged, then a status check reports less than before.
    // The last chunk is among those sent, and its final reply was a 503, so
    // the stop is reported as unconfirmed rather than "nothing was published".
    const size = 2 * SMALL_CHUNK
    const file = await videoFile(size)
    let flip = false
    const { yt, calls } = make(
      [
        MINE,
        STARTED,
        (call: Call) => {
          if (header(call, 'content-range')?.startsWith('bytes */') === true) {
            return { status: 308, headers: { range: `bytes=0-${SMALL_CHUNK - 1}` } }
          }
          flip = !flip
          return flip ? ackChunk(call) : { status: 503 }
        },
      ],
      { chunkBytes: SMALL_CHUNK },
    )
    await assert.rejects(() => yt.publish(ctx(), draft({ media: [vid(file)] })), unconfirmedUpload)
    assert.ok(calls.length < 40, `stopped after ${calls.length} calls`)
  })

  test('a session that gives back ground before the last chunk ever goes out stops as transient', async () => {
    // The first chunk is acknowledged, the second always fails, and the
    // session then says it holds nothing. The third, last, chunk is never
    // sent, so no video can exist and a retry is safe.
    const size = 3 * SMALL_CHUNK
    const file = await videoFile(size)
    const { yt, calls } = make(
      [
        MINE,
        STARTED,
        (call: Call) => {
          const range = header(call, 'content-range') ?? ''
          if (range.startsWith('bytes */')) return { status: 308 }
          return range.startsWith('bytes 0-') ? ackChunk(call) : { status: 503 }
        },
      ],
      { chunkBytes: SMALL_CHUNK },
    )
    await assert.rejects(
      () => yt.publish(ctx(), draft({ media: [vid(file)] })),
      (error: unknown) =>
        error instanceof PublishError && error.failureClass === 'transient' && /Nothing was published/.test(error.message),
    )
    assert.ok(calls.length < 40, `stopped after ${calls.length} calls`)
    assert.ok(!calls.some((c) => header(c, 'content-range')?.startsWith(`bytes ${2 * SMALL_CHUNK}-`) === true))
  })

  test('warns that a video over 15 minutes needs a verified channel', () => {
    const result = new YouTubeAdapter().validate(
      draft({ title: 'Long one', media: [vid('a.mp4', { durationSeconds: 20 * 60 })] }),
    )
    assert.equal(result.ok, true, 'a warning, not an error: only YouTube knows if the channel is verified')
    assert.ok(result.issues.some((i) => i.code === 'long_video_needs_verification' && i.severity === 'warning'))
  })
})
