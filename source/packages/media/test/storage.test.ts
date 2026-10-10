import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { test, describe } from 'node:test'

import {
  MediaStore,
  MediaUploadError,
  SUPABASE_FREE_FILE_LIMIT_BYTES,
  mimeForPath,
  tooLargeForStorageMessage,
} from '../src/storage.ts'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  bodyLength: number
}

function mockFetch(responses: Array<{ status?: number; body?: string }>) {
  const calls: Call[] = []
  let index = 0
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      bodyLength: body instanceof Uint8Array ? body.length : 0,
    })
    const next = responses[Math.min(index, responses.length - 1)] ?? { status: 200 }
    index += 1
    return new Response(next.body ?? '{}', { status: next.status ?? 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetchImpl, calls }
}

const store = (responses: Array<{ status?: number; body?: string }>) => {
  const { fetchImpl, calls } = mockFetch(responses)
  return {
    media: new MediaStore({
      supabaseUrl: 'https://proj.supabase.co',
      serviceRoleKey: 'SERVICE_KEY',
      bucket: 'media',
      fetch: fetchImpl,
    }),
    calls,
  }
}

const bytes = new Uint8Array([1, 2, 3, 4, 5])
const sha = createHash('sha256').update(bytes).digest('hex')

describe('mimeForPath', () => {
  test('maps known extensions', () => {
    assert.equal(mimeForPath('a.jpg'), 'image/jpeg')
    assert.equal(mimeForPath('a.PNG'), 'image/png')
    assert.equal(mimeForPath('a.mp4'), 'video/mp4')
  })

  test('returns undefined for unknown extensions', () => {
    assert.equal(mimeForPath('a.psd'), undefined)
    assert.equal(mimeForPath('noext'), undefined)
  })
})

describe('upload', () => {
  test('uploads and returns a public URL', async () => {
    const { media, calls } = store([{ status: 200 }])
    const result = await media.upload(bytes, { mime: 'image/png', tenantId: 't1' })

    assert.equal(calls[0]!.method, 'POST')
    assert.equal(calls[0]!.url, `https://proj.supabase.co/storage/v1/object/media/t1/${sha}.png`)
    assert.equal(
      result.publicUrl,
      `https://proj.supabase.co/storage/v1/object/public/media/t1/${sha}.png`,
    )
    assert.equal(result.reused, false)
    assert.equal(result.bytes, 5)
  })

  test('names objects by content hash, so the same file uploads once', async () => {
    const { media } = store([{ status: 200 }])
    const a = await media.upload(bytes, { mime: 'image/png', tenantId: 't1' })
    const b = await media.upload(bytes, { mime: 'image/png', tenantId: 't1' })
    assert.equal(a.key, b.key)
    assert.equal(a.sha256, sha)
  })

  test('different content produces a different key', async () => {
    const { media } = store([{ status: 200 }])
    const a = await media.upload(bytes, { mime: 'image/png', tenantId: 't1' })
    const b = await media.upload(new Uint8Array([9, 9]), { mime: 'image/png', tenantId: 't1' })
    assert.notEqual(a.key, b.key)
  })

  test('scopes the key by tenant', async () => {
    const { media } = store([{ status: 200 }])
    const a = await media.upload(bytes, { mime: 'image/png', tenantId: 'tenant-a' })
    const b = await media.upload(bytes, { mime: 'image/png', tenantId: 'tenant-b' })
    assert.ok(a.key.startsWith('tenant-a/'))
    assert.ok(b.key.startsWith('tenant-b/'))
  })

  test('treats a 409 as "already uploaded" rather than an error', async () => {
    // Content-addressed keys mean a duplicate is success, not failure — this is
    // what makes a retried publish safe.
    const { media } = store([{ status: 409 }])
    const result = await media.upload(bytes, { mime: 'image/png', tenantId: 't1' })
    assert.equal(result.reused, true)
    assert.equal(result.publicUrl.endsWith(`${sha}.png`), true)
  })

  test('treats Supabase\'s HTTP 400 duplicate envelope as already uploaded', async () => {
    // Observed in production: Supabase returns 400 with "statusCode":"409" in the
    // BODY, not a real 409 status. Checking response.status alone misses it and a
    // perfectly good re-publish fails.
    const { media } = store([
      {
        status: 400,
        body: '{"statusCode":"409","error":"Duplicate","message":"The resource already exists","code":"KeyAlreadyExists"}',
      },
    ])
    const result = await media.upload(bytes, { mime: 'image/png', tenantId: 't1' })
    assert.equal(result.reused, true)
    assert.equal(result.publicUrl.endsWith(`${sha}.png`), true)
  })

  test('a genuine 400 is still an error, not mistaken for a duplicate', async () => {
    const { media } = store([{ status: 400, body: '{"message":"Invalid request"}' }])
    await assert.rejects(() => media.upload(bytes, { mime: 'image/png', tenantId: 't1' }))
  })

  test('sends the service key and content type', async () => {
    const { media, calls } = store([{ status: 200 }])
    await media.upload(bytes, { mime: 'image/png', tenantId: 't1' })
    assert.equal(calls[0]!.headers.Authorization, 'Bearer SERVICE_KEY')
    assert.equal(calls[0]!.headers['content-type'], 'image/png')
  })

  test('sets long immutable caching, since the key is the content hash', async () => {
    const { media, calls } = store([{ status: 200 }])
    await media.upload(bytes, { mime: 'image/png', tenantId: 't1' })
    assert.match(calls[0]!.headers['cache-control']!, /immutable/)
  })

  test('explains a missing bucket in plain language', async () => {
    const { media } = store([{ status: 400, body: '{"message":"Bucket not found"}' }])
    await assert.rejects(
      () => media.upload(bytes, { mime: 'image/png', tenantId: 't1' }),
      /bucket does not exist/i,
    )
  })

  test('explains a rejected service key', async () => {
    const { media } = store([{ status: 401, body: 'unauthorized' }])
    await assert.rejects(
      () => media.upload(bytes, { mime: 'image/png', tenantId: 't1' }),
      /service_role key was rejected/i,
    )
  })

  test('explains an oversized file the bucket refuses although it is under the plan cap', async () => {
    const { media } = store([{ status: 413 }])
    await assert.rejects(
      () => media.upload(bytes, { mime: 'image/png', tenantId: 't1' }),
      (error: unknown) => {
        assert.ok(error instanceof MediaUploadError)
        assert.equal(error.code, 'STORAGE_REJECTED')
        assert.match(error.message, /refused this file as too large \(HTTP 413\)/)
        assert.match(error.message, /bucket "media" has a lower limit of its own/)
        return true
      },
    )
  })

  test('recognises "too large" sent as HTTP 400 with the status in the body', async () => {
    const { media } = store([{ status: 400, body: '{"statusCode":"413","error":"Payload too large"}' }])
    await assert.rejects(() => media.upload(bytes, { mime: 'image/png', tenantId: 't1' }), /too large \(HTTP 413\)/)
  })

  test('surfaces the status code on the error', async () => {
    const { media } = store([{ status: 500, body: 'boom' }])
    try {
      await media.upload(bytes, { mime: 'image/png', tenantId: 't1' })
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof MediaUploadError)
      assert.equal(error.status, 500)
    }
  })
})

describe('isPubliclyReachable', () => {
  test('true when the URL responds ok', async () => {
    const { media } = store([{ status: 200 }])
    assert.equal(await media.isPubliclyReachable('https://x/y'), true)
  })

  test('false when the object is private', async () => {
    // A private bucket surfaces as a confusing Instagram-side error much later,
    // so this check exists to fail early and clearly.
    const { media } = store([{ status: 400 }])
    assert.equal(await media.isPubliclyReachable('https://x/y'), false)
  })

  test('false rather than throwing on a network error', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline')
    }) as unknown as typeof globalThis.fetch
    const media = new MediaStore({
      supabaseUrl: 'https://proj.supabase.co',
      serviceRoleKey: 'K',
      bucket: 'media',
      fetch: fetchImpl,
    })
    assert.equal(await media.isPubliclyReachable('https://x/y'), false)
  })
})

describe('the per-file storage cap (Supabase Free plan, 50 MB; 2026-10-11)', () => {
  test('defaults to 50 MB, the Free plan cap, and can be set', () => {
    assert.equal(SUPABASE_FREE_FILE_LIMIT_BYTES, 50 * 1024 * 1024)
    assert.equal(store([]).media.maxFileBytes, SUPABASE_FREE_FILE_LIMIT_BYTES)
    const pro = new MediaStore({ supabaseUrl: 'https://p.supabase.co', serviceRoleKey: 'K', bucket: 'media', maxFileBytes: 500 })
    assert.equal(pro.maxFileBytes, 500)
  })

  test('a video over the cap fails before anything is sent, naming the cap, the plan and what to do', async () => {
    const { media, calls } = store([{ status: 200 }])
    const big = new Uint8Array(SUPABASE_FREE_FILE_LIMIT_BYTES + 1)
    await assert.rejects(
      () => media.upload(big, { mime: 'video/mp4', tenantId: 't1' }),
      (error: unknown) => {
        assert.ok(error instanceof MediaUploadError)
        assert.equal(error.code, 'STORAGE_REJECTED')
        assert.match(error.message, /^This video is 50 MB, over the 50 MB per-file limit of the media storage/)
        assert.match(error.message, /Supabase Storage on the Free plan/)
        assert.match(error.message, /nothing was posted/)
        assert.match(error.message, /publish it immediately from the local file/)
        assert.match(error.message, /decision V4/)
        return true
      },
    )
    assert.equal(calls.length, 0, 'nothing reaches storage')
  })

  test('a file on disk over the cap is refused by its size, before it is read', async () => {
    const { mkdtemp, rm, truncate, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'media-cap-'))
    try {
      const file = join(dir, 'clip.mp4')
      await writeFile(file, '')
      await truncate(file, 120 * 1024 * 1024)
      const { media, calls } = store([{ status: 200 }])
      await assert.rejects(() => media.uploadFile(file, { tenantId: 't1' }), /This video is 120 MB, over the 50 MB per-file limit/)
      assert.equal(calls.length, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('assertFits lets a caller refuse early, before reading the bytes at all', () => {
    const { media } = store([])
    assert.doesNotThrow(() => media.assertFits(SUPABASE_FREE_FILE_LIMIT_BYTES, 'video/mp4'))
    assert.throws(() => media.assertFits(SUPABASE_FREE_FILE_LIMIT_BYTES + 1, 'image/png'), /This file is .* Use a file under 50 MB/)
  })

  test('the message names the size, the cap and the plan', () => {
    const message = tooLargeForStorageMessage(200 * 1024 * 1024, SUPABASE_FREE_FILE_LIMIT_BYTES, 'video/quicktime')
    assert.match(message, /200 MB, over the 50 MB per-file limit/)
    assert.match(message, /Free plan/)
  })
})
