import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { PublishError } from '@social-publisher/core'

import { FacebookPageEngagement, inspectMetaToken, spamSignals } from '../src/facebook-engagement.ts'

const PAGE = '102223309294786'
const now = () => new Date('2026-10-02T12:00:00Z')

function mock(handler: (url: URL, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: Array<{ url: URL; method: string; body: Record<string, string> }> = []
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    const u = new URL(String(url))
    const body: Record<string, string> = {}
    if (init.body instanceof URLSearchParams) for (const [k, v] of init.body) body[k] = v
    calls.push({ url: u, method: init.method ?? 'GET', body })
    const r = handler(u, init)
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetchImpl, calls }
}

describe('reading comments', () => {
  const { fetchImpl, calls } = mock(() => ({
    body: {
      data: [
        {
          id: 'P1',
          message: 'Our new video editing service',
          comments: {
            data: [
              { id: 'C1', message: 'How much?', from: { id: 'U1', name: 'Ali' }, created_time: '2026-10-02T10:00:00+0000', can_hide: true, comment_count: 1, comments: { data: [{ from: { id: PAGE } }] } },
              { id: 'C2', message: 'Earn $500 a day, whatsapp me +92 300 1234567', from: { id: 'U2', name: 'Spam' }, created_time: '2026-10-02T11:00:00+0000', can_hide: true },
              { id: 'C3', message: 'Thanks all!', from: { id: PAGE, name: '1920 Agency' }, created_time: '2026-10-02T11:30:00+0000' },
            ],
          },
        },
      ],
    },
  }))

  test('knows which comments the Page has answered, newest first, and leaves out its own', async () => {
    const out = await new FacebookPageEngagement({ fetch: fetchImpl, appSecret: 's' }).comments(PAGE, 'T')
    assert.deepEqual(out.map((c) => c.id), ['C2', 'C1'])
    assert.equal(out.find((c) => c.id === 'C1')!.answered, true)
    assert.equal(out.find((c) => c.id === 'C2')!.answered, false)
  })

  test('signs every call with appsecret_proof and reads top-level comments only', () => {
    assert.ok(calls[0]!.url.searchParams.get('appsecret_proof'))
    assert.match(calls[0]!.url.searchParams.get('fields')!, /filter\(toplevel\)/)
  })

  test('spam signs are reasons, not verdicts', () => {
    assert.deepEqual(spamSignals('Earn $500 a day, whatsapp me +92 300 1234567'), [
      'asks people to move to private chat',
      'money or prize bait',
      'contains a phone number',
    ])
    assert.deepEqual(spamSignals('Terrible service, I want a refund'), [])
  })
})

describe('writing comments', () => {
  test('a reply is posted under the comment; hiding is a flag; deleting is a DELETE', async () => {
    const { fetchImpl, calls } = mock(() => ({ body: { id: 'R1', success: true } }))
    const api = new FacebookPageEngagement({ fetch: fetchImpl })
    assert.equal(await api.replyToComment('C1', 'T', 'PKR 5,000 a month'), 'R1')
    await api.setCommentHidden('C2', 'T', true)
    await api.deleteComment('C3', 'T')
    assert.equal(calls[0]!.url.pathname.endsWith('/C1/comments'), true)
    assert.equal(calls[0]!.body.message, 'PKR 5,000 a month')
    assert.equal(calls[1]!.body.is_hidden, 'true')
    assert.equal(calls[2]!.method, 'DELETE')
  })
})

describe('Messenger and the 24-hour rule', () => {
  const inbox = mock(() => ({
    body: {
      data: [
        {
          id: 'T1',
          updated_time: '2026-10-02T09:00:00+0000',
          participants: { data: [{ id: 'U1', name: 'Sara' }, { id: PAGE, name: '1920 Agency' }] },
          messages: { data: [{ message: 'Is this available?', from: { id: 'U1' }, created_time: '2026-10-02T09:00:00+0000' }] },
        },
        {
          id: 'T2',
          updated_time: '2026-09-28T09:00:00+0000',
          participants: { data: [{ id: 'U2', name: 'Bilal' }, { id: PAGE }] },
          messages: { data: [{ message: 'Hello', from: { id: 'U2' }, created_time: '2026-09-28T09:00:00+0000' }] },
        },
      ],
    },
  }))

  test('a fresh message can be answered; a four-day-old one cannot', async () => {
    const [fresh, old] = await new FacebookPageEngagement({ fetch: inbox.fetchImpl, now }).conversations(PAGE, 'T')
    assert.equal(fresh!.customer, 'Sara')
    assert.equal(fresh!.waiting, true)
    assert.equal(fresh!.canReply, true)
    assert.equal(old!.canReply, false)
  })

  test('sending outside the window is refused before Meta is called', async () => {
    const { fetchImpl, calls } = mock(() => ({ body: { message_id: 'M1' } }))
    const api = new FacebookPageEngagement({ fetch: fetchImpl, now })
    await assert.rejects(api.sendMessage(PAGE, 'T', 'U2', 'hi', new Date('2026-09-28T09:00:00Z')), /24-hour/)
    assert.equal(calls.length, 0)
    assert.equal(await api.sendMessage(PAGE, 'T', 'U1', 'Yes, it is', new Date('2026-10-02T09:00:00Z')), 'M1')
    assert.equal(calls[0]!.body.messaging_type, 'RESPONSE')
    assert.deepEqual(JSON.parse(calls[0]!.body.recipient!), { id: 'U1' })
  })
})

describe('insights', () => {
  test('a metric Meta has retired is listed, not fatal', async () => {
    const { fetchImpl } = mock((url) =>
      url.searchParams.get('metric') === 'page_impressions_unique'
        ? { status: 400, body: { error: { message: 'The value must be a valid insights metric', code: 100 } } }
        : { body: { data: [{ name: url.searchParams.get('metric'), values: [{ value: 3 }, { value: 4 }] }] } },
    )
    const r = await new FacebookPageEngagement({ fetch: fetchImpl, now }).insights(PAGE, 'T', ['page_post_engagements', 'page_impressions_unique'])
    assert.deepEqual(r.values, [{ metric: 'page_post_engagements', total: 7 }])
    assert.deepEqual(r.unavailable, ['page_impressions_unique'])
  })

  test('a dead token is still an error, not "unavailable"', async () => {
    const { fetchImpl } = mock(() => ({ status: 401, body: { error: { message: 'Session has expired', code: 190 } } }))
    await assert.rejects(new FacebookPageEngagement({ fetch: fetchImpl }).insights(PAGE, 'T', ['page_post_engagements']), PublishError)
  })
})

describe('checking a stored token', () => {
  test('the 2026-10-02 case: a Page token stripped to ads permissions is caught', async () => {
    const { fetchImpl } = mock(() => ({
      body: {
        data: {
          is_valid: false,
          type: 'PAGE',
          scopes: ['read_insights', 'ads_management', 'ads_read', 'public_profile'],
          error: { message: 'Any of the pages_read_engagement ... permission(s) must be granted' },
        },
      },
    }))
    const h = await inspectMetaToken({ token: 'T', appId: 'A', appSecret: 'S', required: ['pages_show_list', 'pages_manage_posts'], fetch: fetchImpl })
    assert.equal(h.valid, false)
    assert.deepEqual(h.missing, ['pages_show_list', 'pages_manage_posts'])
  })

  test('a healthy token passes', async () => {
    const { fetchImpl } = mock(() => ({ body: { data: { is_valid: true, scopes: ['pages_show_list', 'pages_manage_posts'] } } }))
    const h = await inspectMetaToken({ token: 'T', appId: 'A', appSecret: 'S', required: ['pages_show_list', 'pages_manage_posts'], fetch: fetchImpl })
    assert.equal(h.valid, true)
  })
})
