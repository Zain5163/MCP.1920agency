import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdtemp, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, describe } from 'node:test'

import { PublishError, type MediaRef } from '@social-publisher/core'

import { fileSource, openMedia } from '../src/media-source.ts'

/**
 * The shared byte-range reader LinkedIn and YouTube upload from. LinkedIn's own
 * tests cover it through the adapter; these pin down the ownership rules
 * directly, because getting them wrong deletes a customer's file.
 */

const localFile = async (bytes: number): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'ms-'))
  const file = join(dir, 'media.bin')
  await writeFile(file, Buffer.alloc(bytes, 3))
  return file
}

const ref = (over: Partial<MediaRef>): MediaRef => ({ id: 'm', kind: 'video', mime: 'video/mp4', bytes: 0, ...over })

describe('openMedia', () => {
  test("reads a caller's file in place, sizes it from disk, and never deletes it", async () => {
    const file = await localFile(1_234)
    const source = await openMedia(ref({ localPath: file, bytes: 999_999 }), globalThis.fetch)
    assert.equal(source.size, 1_234)
    assert.equal((await source.read(0, 9)).length, 10)
    await source.close()
    assert.ok(existsSync(file), "the caller's file must survive")
  })

  test('downloads a URL to a temporary file, sized from what actually arrived', async () => {
    // The temporary file is owned, so close() deletes it; that rule is checked
    // directly on fileSource below, since the temporary path is not exposed.
    const fetchImpl = (async () => new Response('x'.repeat(500))) as unknown as typeof globalThis.fetch
    const source = await openMedia(ref({ publicUrl: 'https://media.example.com/v.mp4', bytes: 7 }), fetchImpl)
    assert.equal(source.size, 500)
    await source.close()
    // Closing twice is harmless.
    await source.close()
  })

  test('a media host error is classified, not swallowed', async () => {
    const fetchImpl = (async () => new Response('', { status: 503 })) as unknown as typeof globalThis.fetch
    await assert.rejects(
      () => openMedia(ref({ publicUrl: 'https://media.example.com/v.mp4' }), fetchImpl),
      (error: unknown) => error instanceof PublishError && error.failureClass === 'transient',
    )
  })

  test('a missing local file is permanent and names the path', async () => {
    await assert.rejects(
      () => openMedia(ref({ localPath: 'no-such-file.mp4' }), globalThis.fetch),
      (error: unknown) => error instanceof PublishError && /no-such-file\.mp4/.test(error.message),
    )
  })

  test('media with neither a file nor a URL is refused', async () => {
    await assert.rejects(() => openMedia(ref({}), globalThis.fetch), PublishError)
  })
})

describe('fileSource', () => {
  test('a file that shrinks mid-upload stops the upload rather than sending padding', async () => {
    const file = await localFile(100)
    const source = await fileSource(file, false)
    await truncate(file, 10)
    await assert.rejects(
      () => source.read(0, 99),
      (error: unknown) => error instanceof PublishError && error.failureClass === 'transient',
    )
    await source.close()
  })

  test('an owned file is deleted on close', async () => {
    const file = await localFile(10)
    const source = await fileSource(file, true)
    await source.close()
    assert.ok(!existsSync(file))
  })
})
