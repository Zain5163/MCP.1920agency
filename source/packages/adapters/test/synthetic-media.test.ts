import { strict as assert } from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, describe } from 'node:test'

import { fieldsSentTo, type MediaRef, type PlatformAdapter, type PostDraft, type PublishContext } from '@social-publisher/core'

import { FacebookPageAdapter } from '../src/facebook.ts'
import { InstagramAdapter } from '../src/instagram.ts'
import { LinkedInAdapter } from '../src/linkedin.ts'

/**
 * The AI-media declaration and the title, held against what each adapter
 * really sends.
 *
 * Approval summaries said "Declared as realistic AI-generated or altered
 * media" and showed "Title:" for every target. A recorded request log proved
 * that Facebook, Instagram and LinkedIn text and image posts send exactly the
 * same requests whether the post is declared and titled or not, so neither
 * reaches them. These tests keep the data honest about that: the capability
 * does not claim the declaration, validation warns, and `fieldsSentTo` lists
 * the platform as not told and sending no title. Should one of these adapters
 * start sending either, the first assertion fails and the capability has to
 * change with it. Every reply is scripted; nothing reaches a platform.
 */

/** Every request as one comparable line: method, URL and body. */
function recorder(kind: 'meta' | 'linkedin') {
  const calls: string[] = []
  const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const b: unknown = init.body
    let body = ''
    if (typeof b === 'string') body = b
    else if (b instanceof URLSearchParams) body = b.toString()
    else if (b instanceof FormData) {
      body = JSON.stringify([...b.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '<file>']))
    } else if (b instanceof Uint8Array || b instanceof ArrayBuffer) body = '<bytes>'
    calls.push(`${init.method ?? 'GET'} ${String(url)} ${body}`)

    const u = String(url)
    if (kind === 'meta') {
      if (u.includes('fields=status_code')) return new Response(JSON.stringify({ status_code: 'FINISHED' }), { status: 200 })
      return new Response(JSON.stringify({ id: '111_222', post_id: '111_222' }), { status: 200 })
    }
    if (u.includes('/rest/images?action=initializeUpload')) {
      return new Response(
        JSON.stringify({ value: { uploadUrl: 'https://upload.linkedin.example/x', image: 'urn:li:image:1' } }),
        { status: 200 },
      )
    }
    if (u.startsWith('https://upload.linkedin.example')) return new Response('', { status: 201 })
    if (u.endsWith('/rest/posts')) return new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:9' } })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetchImpl, calls }
}

const ctx = (platform: PublishContext['connection']['platform'], account: string): PublishContext => ({
  connection: {
    id: 'c1',
    tenantId: 't1',
    platform,
    platformAccountId: account,
    displayName: 'Account',
    credentialSource: 'platform_app',
    scopes: [],
    needsReauth: false,
  },
  credential: { accessToken: 'DUMMY' },
  idempotencyKey: 'k',
})

async function jpegOnDisk(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'synthetic-'))
  const file = join(dir, 'ai.jpg')
  await writeFile(file, Buffer.alloc(512, 7))
  return file
}

interface Case {
  readonly name: string
  readonly kind: 'meta' | 'linkedin'
  readonly make: (fetchImpl: typeof globalThis.fetch) => PlatformAdapter
  readonly ctx: PublishContext
  readonly media: (file: string) => MediaRef[]
}

const CASES: readonly Case[] = [
  {
    name: 'Facebook image',
    kind: 'meta',
    make: (fetchImpl) => new FacebookPageAdapter({ fetch: fetchImpl }),
    ctx: ctx('facebook_page', '111'),
    media: (file) => [{ id: 'i', kind: 'image', mime: 'image/jpeg', bytes: 512, localPath: file }],
  },
  {
    name: 'Instagram image',
    kind: 'meta',
    make: (fetchImpl) => new InstagramAdapter({ fetch: fetchImpl, sleep: async () => {}, pollIntervalMs: 0 }),
    ctx: ctx('instagram', '111'),
    media: () => [
      { id: 'i', kind: 'image', mime: 'image/jpeg', bytes: 512, publicUrl: 'https://cdn.example.com/ai.jpg', width: 1080, height: 1080 },
    ],
  },
  {
    name: 'LinkedIn text',
    kind: 'linkedin',
    make: (fetchImpl) => new LinkedInAdapter({ fetch: fetchImpl }),
    ctx: ctx('linkedin', 'urn:li:person:ABC'),
    media: () => [],
  },
  {
    name: 'LinkedIn image',
    kind: 'linkedin',
    make: (fetchImpl) => new LinkedInAdapter({ fetch: fetchImpl }),
    ctx: ctx('linkedin', 'urn:li:person:ABC'),
    media: (file) => [{ id: 'i', kind: 'image', mime: 'image/jpeg', bytes: 512, localPath: file }],
  },
]

async function run(c: Case, draft: PostDraft) {
  const { fetchImpl, calls } = recorder(c.kind)
  const adapter = c.make(fetchImpl)
  const validation = adapter.validate(draft)
  const result = await adapter.publish(c.ctx, draft)
  return { adapter, calls, result, validation }
}

describe('an AI declaration or title that a platform is never sent', () => {
  for (const c of CASES) {
    test(`${c.name}: sends nothing of either, so says so rather than claiming it`, async () => {
      const media = c.media(await jpegOnDisk())
      const plain: PostDraft = { body: 'An AI image', media, syntheticMedia: false }
      const declared: PostDraft = { body: 'An AI image', media, syntheticMedia: true, title: 'My title' }

      const off = await run(c, plain)
      const on = await run(c, declared)

      // What the adapter does: byte-identical requests, no title anywhere.
      assert.deepEqual(on.calls, off.calls)
      assert.ok(!on.calls.join('\n').includes('My title'))
      assert.equal(on.result.notice, undefined)

      // What the data says about it.
      const platform = c.ctx.connection.platform
      assert.notEqual(on.adapter.capabilities.sendsSyntheticMediaDisclosure, true)
      const warning = on.validation.issues.find((i) => i.code === 'synthetic_media_not_sent')
      assert.equal(warning?.severity, 'warning')
      assert.ok(!off.validation.issues.some((i) => i.code === 'synthetic_media_not_sent'))
      assert.deepEqual(fieldsSentTo(declared, [platform]), { titles: [], disclosedTo: [], notDisclosedTo: [platform] })
    })
  }
})
