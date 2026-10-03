import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  PublishError,
  allCodes,
  capabilitiesFor,
  formatResolution,
  resolutionFor,
  type Platform,
  type PlatformAdapter,
  type PublishResult,
} from '@social-publisher/core'
import { ATTACHMENTS_NOT_STORED_CODE, ATTACHMENTS_NOT_STORED_MESSAGE, NOTICE_CODE } from '@social-publisher/db'
import { PublishService } from '@social-publisher/publisher'
import { Logger } from '@social-publisher/telemetry'

import {
  approvalSummary,
  formatPostList,
  publishNowResolution,
  publishPost,
  type MediaRow,
  type PostRows,
  type PostingDeps,
  type TargetRow,
} from '../src/publishing.ts'
import { registerTools } from '../src/tools.ts'

/**
 * publish_post end to end, with the platforms and the database replaced by
 * fakes: the tool call, the approval, the publish, and the rows it writes.
 *
 * Both transports run this same code (publishing.ts), so these tests cover
 * the stdio server too, which cannot be loaded in a test because it connects
 * to its transport on import.
 */

const TENANT = 'tenant-1'

/** Connection rows as TenantScope.connections() returns them. */
const ACCOUNTS = [
  { id: 'conn-yt', platform: 'youtube', platformAccountId: 'UC1', displayName: 'PSX Ascend' },
  { id: 'conn-fb', platform: 'facebook_page', platformAccountId: 'P1', displayName: 'PSX Page' },
  { id: 'conn-li', platform: 'linkedin', platformAccountId: 'urn:li:person:1', displayName: 'Rana' },
  { id: 'conn-ig', platform: 'instagram', platformAccountId: 'IG1', displayName: 'psx.ascend' },
].map((a) => ({
  ...a,
  tenantId: TENANT,
  credentialSource: 'platform_app',
  scopes: [],
  needsReauth: false,
  expiresAt: null,
  providerAuth: null,
}))

class FakeScope {
  readonly tenantId = TENANT
  readonly created: Array<{ id: string; body: string; createdBy: string; overrides?: unknown }> = []
  readonly activity: Array<{ actor: string; action: string; detail?: Record<string, unknown> }> = []
  listed: unknown[] = []

  async connections() {
    return ACCOUNTS
  }
  async requireConnections(ids: readonly string[]) {
    return ACCOUNTS.filter((a) => ids.includes(a.id))
  }
  async createPost(data: { body: string; createdBy: string; overrides?: unknown }) {
    const post = { id: `post-${this.created.length + 1}`, ...data }
    this.created.push(post)
    return post
  }
  async record(actor: string, action: string, detail?: Record<string, unknown>) {
    this.activity.push({ actor, action, ...(detail !== undefined ? { detail } : {}) })
  }
  async posts() {
    return this.listed
  }
}

class FakeRows implements PostRows {
  readonly targets: TargetRow[] = []
  readonly jobs: Array<{ tenantId: string; targetId: string; runAfter: Date }> = []
  async createTarget(row: TargetRow) {
    this.targets.push(row)
    return { id: `target-${this.targets.length}` }
  }
  async createJob(row: { tenantId: string; targetId: string; runAfter: Date }) {
    this.jobs.push(row)
  }
  readonly media: MediaRow[] = []
  async attachMedia(row: MediaRow) {
    this.media.push(row)
  }
}

/** An adapter that accepts everything and publishes however the test says. */
function adapter(platform: Platform, publish: PlatformAdapter['publish']): PlatformAdapter {
  return { platform, capabilities: capabilitiesFor(platform), validate: () => ({ ok: true, issues: [] }), publish }
}

function harness(adapters: PlatformAdapter[]) {
  const service = new PublishService(adapters)
  const rows = new FakeRows()
  const deps: PostingDeps = {
    service: () => service,
    targetFor: (connection) => ({ connection, withCredential: async (fn) => await fn('token') }),
    rows,
  }
  return { deps, rows, scope: new FakeScope() }
}

const reply = (result: { content: Array<{ text: string }> }): string => result.content[0]!.text

/** The approval token an approval request hands back. */
function tokenIn(approval: string): string {
  const match = /confirm: "([^"]+)"/.exec(approval)
  assert.ok(match !== null, `expected an approval request, got:\n${approval}`)
  return match[1]!
}

const published = (id: string): PublishResult => ({ platformPostId: id, url: `https://example.com/${id}` })

describe('publish_post (shared by both transports)', () => {
  test('asks for approval first and writes nothing until it is given', async () => {
    let calls = 0
    const { deps, rows, scope } = harness([adapter('facebook_page', async () => (calls += 1, published('fb-1')))])
    const args = { body: 'Launch day', platforms: ['facebook_page' as Platform] }

    const first = reply(await publishPost(scope as never, args, { deps, actor: 'mcp' }))
    assert.match(first, /APPROVAL NEEDED — nothing has been sent/)
    assert.equal(calls, 0)
    assert.equal(scope.created.length, 0)
    assert.equal(rows.targets.length, 0)

    const second = reply(await publishPost(scope as never, { ...args, confirm: tokenIn(first) }, { deps, actor: 'mcp' }))
    assert.match(second, /^PUBLISHED  PSX Page  https:\/\/example.com\/fb-1/)
    assert.equal(calls, 1)
    assert.equal(scope.created[0]!.createdBy, 'mcp')
    assert.equal(rows.targets.length, 1)
    assert.equal(rows.targets[0]!.state, 'published')
    assert.equal(rows.targets[0]!.idempotencyKey, 'post-1:conn-fb')
    assert.deepEqual(scope.activity.map((a) => a.action), ['post.published'])
  })

  test('the hosted tool publishes through the same code, recorded as its user', async () => {
    const { deps, rows, scope } = harness([adapter('facebook_page', async () => published('fb-2'))])
    const server = new McpServer({ name: 't', version: '0' })
    const logged: string[] = []
    const logger = new Logger([{ name: 'memory', write: async (event) => void logged.push(event.event) }])
    registerTools(server, { tokenId: 'tok', tenantId: TENANT, userId: 'user-7', scope: scope as never }, logger, deps)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: Function }> })._registeredTools
    const call = async (args: Record<string, unknown>) => reply(await tools.publish_post!.handler(args, {}))

    const args = { body: 'Launch day', platforms: ['facebook_page'] }
    const approval = await call(args)
    assert.ok(logged.includes('mcp.publish_post.awaiting_approval'))
    const done = await call({ ...args, confirm: tokenIn(approval) })

    assert.match(done, /^PUBLISHED  PSX Page/)
    assert.equal(scope.created[0]!.createdBy, 'mcp:user-7')
    assert.equal(rows.targets[0]!.tenantId, TENANT)
  })
})

describe('the approval says per platform where the title and the AI declaration go (finding #4)', () => {
  const connection = (id: string) => {
    const row = ACCOUNTS.find((a) => a.id === id)!
    return { ...row, platform: row.platform as Platform }
  }

  test("the reviewers' case: an Instagram image declared synthetic is not reported as declared", async () => {
    const { deps, scope } = harness([adapter('instagram', async () => published('ig-1'))])
    const approval = reply(
      await publishPost(
        scope as never,
        {
          body: 'A realistic scene that never happened',
          platforms: ['instagram'],
          syntheticMedia: true,
          media: [{ kind: 'image', mime: 'image/jpeg', publicUrl: 'https://cdn.example.com/ai.jpg' }],
        },
        { deps, actor: 'mcp' },
      ),
    )
    assert.match(approval, /NOT declared on instagram: their API takes no such declaration, so label it in the app\./)
    assert.doesNotMatch(approval, /^Declared as realistic/m, 'Instagram is never sent the declaration')
  })

  test('a mixed post: declared and titled on YouTube only, and the others are named', () => {
    const summary = approvalSummary(
      {
        body: 'Launch day',
        title: 'We shipped it',
        syntheticMedia: true,
        media: [{ id: 'v', kind: 'video', mime: 'video/mp4', bytes: 1, localPath: 'D:/clip.mp4' }],
      },
      [connection('conn-yt'), connection('conn-fb'), connection('conn-li')],
    )
    assert.match(summary, /^Title on youtube: We shipped it$/m)
    assert.match(summary, /^No title on facebook_page, linkedin: they take none for this post\.$/m)
    assert.match(summary, /^Declared as realistic AI-generated or altered media on: youtube$/m)
    assert.match(summary, /^NOT declared on facebook_page, linkedin: their API takes no such declaration/m)
    assert.doesNotMatch(summary, /^Title: /m, 'no title line that claims every platform')
  })

  test('a LinkedIn document carries its title; a LinkedIn text post does not', () => {
    const document = approvalSummary(
      {
        body: 'Slides below',
        title: 'Fix code 10 in 5 steps',
        media: [{ id: 'd', kind: 'document', mime: 'application/pdf', bytes: 1, localPath: 'D:/c.pdf' }],
      },
      [connection('conn-li')],
    )
    assert.match(document, /^Title on linkedin: Fix code 10 in 5 steps$/m)

    const textPost = approvalSummary({ body: 'Just text', title: 'Ignored', media: [] }, [connection('conn-li')])
    assert.match(textPost, /^No title on linkedin: it takes none for this post\.$/m)
    assert.doesNotMatch(textPost, /Title on linkedin/)
  })

  test('nothing is said about a declaration that was not made', () => {
    const summary = approvalSummary({ body: 'Plain post', media: [] }, [connection('conn-fb')])
    assert.doesNotMatch(summary, /declared/i)
    assert.doesNotMatch(summary, /title/i)
  })
})

describe('a target that went out with a notice is recorded and listed as uploaded (finding #7)', () => {
  const NOTICE = 'Uploaded as private, not published. Only the channel can see it.'

  test('the publish stores the notice with its code, and list_posts says "uploaded"', async () => {
    const { deps, rows, scope } = harness([
      adapter('youtube', async () => ({ platformPostId: 'VID1', url: 'https://www.youtube.com/watch?v=VID1', notice: NOTICE })),
    ])
    const args = { body: 'Launch video', platforms: ['youtube' as Platform] }
    const approval = reply(await publishPost(scope as never, args, { deps, actor: 'mcp' }))
    const done = reply(await publishPost(scope as never, { ...args, confirm: tokenIn(approval) }, { deps, actor: 'mcp' }))

    assert.match(done, /^UPLOADED   PSX Ascend/)
    assert.equal(rows.targets[0]!.state, 'published')
    assert.equal(rows.targets[0]!.platformMessage, NOTICE)
    assert.equal(rows.targets[0]!.errorCode, NOTICE_CODE)

    const listed = formatPostList([
      {
        createdAt: new Date('2026-10-03T10:00:00Z'),
        body: 'Launch video',
        targets: [{ ...rows.targets[0]!, platformUrl: rows.targets[0]!.platformUrl ?? null, platformMessage: NOTICE, errorCode: NOTICE_CODE, connection: { displayName: 'PSX Ascend' } }],
      },
    ])
    assert.ok(
      listed.includes('    uploaded   PSX Ascend  https://www.youtube.com/watch?v=VID1  — Uploaded as private'),
      listed,
    )
    assert.doesNotMatch(listed, /^ {4}published/m, 'not listed as published')
  })

  test('a plain success has no code, and an older row with a stale message stays "published"', async () => {
    const { deps, rows, scope } = harness([adapter('facebook_page', async () => published('fb-9'))])
    const args = { body: 'Hello', platforms: ['facebook_page' as Platform] }
    const approval = reply(await publishPost(scope as never, args, { deps, actor: 'mcp' }))
    await publishPost(scope as never, { ...args, confirm: tokenIn(approval) }, { deps, actor: 'mcp' })
    assert.equal(rows.targets[0]!.errorCode, null)
    assert.equal(rows.targets[0]!.platformMessage, null)

    const listed = formatPostList([
      {
        createdAt: new Date('2026-10-03T10:00:00Z'),
        body: 'Hello',
        targets: [{ state: 'published', platformUrl: null, platformMessage: 'Rate limited', errorCode: null, connection: { displayName: 'PSX Page' } }],
      },
    ])
    assert.match(listed, /^    published  PSX Page/m)
  })
})

describe('hosted schedule_post stores the attachments the worker will need (finding #11)', () => {
  function hostedTools(adapters: PlatformAdapter[]) {
    const h = harness(adapters)
    const server = new McpServer({ name: 't', version: '0' })
    const logger = new Logger([{ name: 'memory', write: async () => {} }])
    registerTools(server, { tokenId: 'tok', tenantId: TENANT, userId: 'user-7', scope: h.scope as never }, logger, h.deps)
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: Function }> })._registeredTools
    return { ...h, call: async (name: string, args: Record<string, unknown>) => reply(await tools[name]!.handler(args, {})) }
  }

  test("the reviewers' case: a scheduled YouTube video keeps its video", async () => {
    const { call, rows, scope } = hostedTools([adapter('youtube', async () => published('never'))])
    const at = new Date(Date.now() + 3_600_000).toISOString()
    const answer = await call('schedule_post', {
      body: ['My clip title', 'A description of the clip.'].join('\n'),
      platforms: ['youtube'],
      media: [{ kind: 'video', publicUrl: 'https://cdn.example.com/clip.mp4', mime: 'video/mp4' }],
      at,
    })

    assert.match(answer, /^Scheduled for /)
    assert.deepEqual(rows.media, [
      {
        tenantId: TENANT,
        postId: scope.created[0]!.id,
        position: 0,
        r2Key: '',
        publicUrl: 'https://cdn.example.com/clip.mp4',
        mime: 'video/mp4',
        bytes: 0,
      },
    ])
    assert.equal(rows.targets[0]!.state, 'scheduled')
    assert.equal(rows.jobs.length, 1)
  })

  test('attachments keep their order, and a post without any stores none', async () => {
    const { call, rows } = hostedTools([adapter('instagram', async () => published('never'))])
    const at = new Date(Date.now() + 3_600_000).toISOString()
    await call('schedule_post', {
      body: 'Carousel',
      platforms: ['instagram'],
      media: [
        { kind: 'image', publicUrl: 'https://cdn.example.com/1.jpg', mime: 'image/jpeg' },
        { kind: 'image', publicUrl: 'https://cdn.example.com/2.jpg', mime: 'image/jpeg' },
      ],
      at,
    })
    assert.deepEqual(rows.media.map((m) => [m.position, m.publicUrl]), [
      [0, 'https://cdn.example.com/1.jpg'],
      [1, 'https://cdn.example.com/2.jpg'],
    ])

    const text = hostedTools([adapter('facebook_page', async () => published('never'))])
    await text.call('schedule_post', { body: 'Just words', platforms: ['facebook_page'], at })
    assert.deepEqual(text.rows.media, [])
  })
})

describe('a failed post whose attachments were not stored is never retried without them (finding #6)', () => {
  const rejectedUpload = async (): Promise<PublishResult> => {
    throw new PublishError('LinkedIn rejected the video upload (HTTP 503). Nothing was posted.', {
      failureClass: 'transient',
      platformCode: '503',
    })
  }

  async function publishApproved(adapters: PlatformAdapter[], args: Record<string, unknown>) {
    const h = harness(adapters)
    const approval = reply(await publishPost(h.scope as never, args as never, { deps: h.deps, actor: 'mcp' }))
    const done = reply(await publishPost(h.scope as never, { ...args, confirm: tokenIn(approval) } as never, { deps: h.deps, actor: 'mcp' }))
    return { ...h, done }
  }

  test("the reviewers' case: a local file that fails is marked, and the answer says how to send it", async () => {
    const { rows, done } = await publishApproved([adapter('linkedin', rejectedUpload)], {
      body: 'Slides below. Save it for the next time code 10 shows up.',
      platforms: ['linkedin'],
      media: [{ kind: 'video', localPath: 'D:/clip.mp4', mime: 'video/mp4' }],
    })

    assert.deepEqual(rows.media, [], 'a local file cannot be stored for a later rebuild')
    assert.equal(rows.targets[0]!.state, 'failed')
    assert.equal(rows.targets[0]!.errorCode, ATTACHMENTS_NOT_STORED_CODE)
    assert.match(rows.targets[0]!.platformMessage!, /HTTP 503/, "the platform's reason is kept")
    assert.ok(done.includes(`NOTE: ${ATTACHMENTS_NOT_STORED_MESSAGE}`), done)

    const listed = formatPostList([
      {
        createdAt: new Date('2026-10-03T10:00:00Z'),
        body: 'Slides below',
        targets: [{ state: 'failed', platformUrl: null, platformMessage: rows.targets[0]!.platformMessage!, errorCode: ATTACHMENTS_NOT_STORED_CODE, connection: { displayName: 'Rana' } }],
      },
    ])
    assert.ok(listed.includes('(not retryable: Its attachments were not stored'), listed)
  })

  test('an attachment with a public URL is stored, so its failed target stays retryable', async () => {
    const { rows, done } = await publishApproved([adapter('linkedin', rejectedUpload)], {
      body: 'Hello',
      platforms: ['linkedin'],
      media: [{ kind: 'image', publicUrl: 'https://cdn.example.com/a.jpg', mime: 'image/jpeg' }],
    })

    assert.equal(rows.media.length, 1)
    assert.equal(rows.media[0]!.publicUrl, 'https://cdn.example.com/a.jpg')
    assert.equal(rows.targets[0]!.errorCode, '503', 'the platform code, not the mark')
    assert.doesNotMatch(done, /NOTE: Its attachments/)
  })

  test('one local file among hosted ones is enough to mark it', async () => {
    const { rows } = await publishApproved([adapter('linkedin', rejectedUpload)], {
      body: 'Two pictures',
      platforms: ['linkedin'],
      media: [
        { kind: 'image', publicUrl: 'https://cdn.example.com/a.jpg', mime: 'image/jpeg' },
        { kind: 'image', localPath: 'D:/b.jpg', mime: 'image/jpeg' },
      ],
    })
    assert.equal(rows.media.length, 1)
    assert.equal(rows.targets[0]!.errorCode, ATTACHMENTS_NOT_STORED_CODE)
  })

  test('a success from a local file is recorded as usual: only failures can be retried', async () => {
    const { rows } = await publishApproved([adapter('linkedin', async () => published('li-1'))], {
      body: 'Hello',
      platforms: ['linkedin'],
      media: [{ kind: 'video', localPath: 'D:/clip.mp4', mime: 'video/mp4' }],
    })
    assert.equal(rows.targets[0]!.state, 'published')
    assert.equal(rows.targets[0]!.errorCode, null)
  })
})

describe('a publish-now failure never promises an automatic retry (finding #9)', () => {
  test("the reviewers' case: a spent YouTube quota says when to publish again, not that it will be retried", async () => {
    const quota = async (): Promise<PublishResult> => {
      throw new PublishError('The YouTube upload quota for today is used up.', {
        failureClass: 'transient',
        code: 'QUOTA_EXHAUSTED',
        platformCode: 'quotaExceeded',
        retryAfterSeconds: 77_087,
      })
    }
    const { deps, scope } = harness([adapter('youtube', quota)])
    const args = { body: 'Launch video', platforms: ['youtube' as Platform], media: [{ kind: 'video' as const, localPath: 'D:/clip.mp4', mime: 'video/mp4' }] }
    const approval = reply(await publishPost(scope as never, args, { deps, actor: 'mcp' }))
    const before = Date.now()
    const done = reply(await publishPost(scope as never, { ...args, confirm: tokenIn(approval) }, { deps, actor: 'mcp' }))

    assert.match(done, /^FAILED     PSX Ascend/)
    assert.match(done, /\[QUOTA_EXHAUSTED\]/)
    assert.doesNotMatch(done, /automatic/i)
    const when = /call publish_post again after (\S+), without confirm/.exec(done)
    assert.ok(when !== null, done)
    const wait = Date.parse(when[1]!) - before
    assert.ok(wait > 77_000_000 && wait < 77_200_000, `the quota's own wait, not a guess: ${wait}`)
  })

  test('no retryable catalogue entry is shown with an automatic retry', () => {
    for (const code of allCodes()) {
      const resolution = resolutionFor(code)
      if (!resolution.retryable) continue
      const text = publishNowResolution({ failureClass: 'transient', code, retryAfterMs: 30_000 })
      assert.doesNotMatch(text, /automatic/i, code)
      assert.match(text, /Nothing retries a post that was published now/, code)
      assert.match(text, /How to fix:\n {2}1\. /, `${code} still has a step to follow`)
    }
  })

  test('a failure that is not retryable reads exactly as the catalogue has it', () => {
    const error = { failureClass: 'permanent', code: 'PLATFORM_REJECTED' as const, platformCode: '100' }
    assert.equal(publishNowResolution(error), formatResolution(resolutionFor('PLATFORM_REJECTED'), '100'))
  })
})
