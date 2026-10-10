import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { PublishError } from '@social-publisher/core'

import { MetaAdsClient } from '../src/meta-ads.ts'

interface Call {
  method: string
  url: string
  body: Record<string, string>
}

/**
 * Answers by URL rather than by call order, because status() makes three reads
 * and activate() interleaves reads and writes. An order-based mock would couple
 * every test to the exact sequence of calls rather than to what they return.
 */
function routed(routes: Array<[RegExp, unknown]>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const body: Record<string, string> = {}
    if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) body[k] = v
    const href = String(url)
    calls.push({ method: init?.method ?? 'GET', url: href, body })

    if ((init?.method ?? 'GET') === 'POST') return new Response('{"success":true}')
    const match = routes.find(([pattern]) => pattern.test(href))
    return new Response(JSON.stringify(match?.[1] ?? { data: [] }))
  }) as unknown as typeof globalThis.fetch
  return { fetchImpl, calls }
}

const client = (fetchImpl: typeof globalThis.fetch) =>
  new MetaAdsClient({
    accessToken: 'TOKEN',
    account: { adAccountId: '123', pageId: 'P', currency: 'PKR' },
    fetch: fetchImpl,
  })

const campaign = (over: Record<string, unknown> = {}) => [
  /\/c1\?/,
  { id: 'c1', name: 'Camp', status: 'PAUSED', effective_status: 'PAUSED', ...over },
] as [RegExp, unknown]

const adSets = (rows: Record<string, unknown>[]) => [/\/c1\/adsets/, { data: rows }] as [RegExp, unknown]
const ads = (rows: Record<string, unknown>[]) => [/\/c1\/ads\?/, { data: rows }] as [RegExp, unknown]

const ad = (id: string, effective: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  status: 'PAUSED',
  effective_status: effective,
  ...extra,
})

describe('reading what a campaign is really doing', () => {
  test('separates rejected ads from ones still in review', async () => {
    const { fetchImpl } = routed([
      campaign(),
      adSets([{ id: 's1', name: 's', status: 'PAUSED', effective_status: 'PAUSED', daily_budget: '500000' }]),
      ads([
        ad('a1', 'PENDING_REVIEW'),
        ad('a2', 'IN_PROCESS'),
        ad('a3', 'DISAPPROVED', { ad_review_feedback: { global: { POLICY: 'Misleading claims' } } }),
      ]),
    ])
    const status = await client(fetchImpl).status('c1')

    assert.equal(status.inReview.length, 2)
    assert.equal(status.rejected.length, 1)
    assert.equal(status.rejected[0]!.id, 'a3')
  })

  test("keeps Meta's reason for a rejection, so it can be shown", async () => {
    // A rejection with no reason attached is just a different kind of silence.
    const { fetchImpl } = routed([
      campaign(),
      adSets([]),
      ads([ad('a3', 'DISAPPROVED', { ad_review_feedback: { global: { POLICY: 'Misleading claims' } } })]),
    ])
    const status = await client(fetchImpl).status('c1')
    assert.match(JSON.stringify(status.rejected[0]!.reviewFeedback), /Misleading claims/)
  })

  test('sums ad set budgets when the budget lives on the ad sets', async () => {
    const { fetchImpl } = routed([
      campaign(),
      adSets([
        { id: 's1', name: 'a', status: 'PAUSED', effective_status: 'PAUSED', daily_budget: '300000' },
        { id: 's2', name: 'b', status: 'PAUSED', effective_status: 'PAUSED', daily_budget: '200000' },
      ]),
      ads([]),
    ])
    assert.equal((await client(fetchImpl).status('c1')).dailyBudgetMinor, 500_000)
  })

  test('uses the campaign budget when the campaign holds it', async () => {
    const { fetchImpl } = routed([
      campaign({ daily_budget: '900000' }),
      adSets([{ id: 's1', name: 'a', status: 'PAUSED', effective_status: 'PAUSED' }]),
      ads([]),
    ])
    assert.equal((await client(fetchImpl).status('c1')).dailyBudgetMinor, 900_000)
  })
})

describe('what the account already spends', () => {
  test('counts budgets at both levels, because each lives at exactly one', async () => {
    const { fetchImpl, calls } = routed([
      [/\/act_123\/campaigns/, { data: [{ id: 'c', daily_budget: '400000' }, { id: 'd' }] }],
      [/\/act_123\/adsets/, { data: [{ id: 's', daily_budget: '100000' }, { id: 't' }] }],
    ])
    assert.equal(await client(fetchImpl).committedDailySpendMinor(), 500_000)

    // Everything that can spend counts, including objects Meta briefly shows as
    // IN_PROCESS right after an edit; paused ones do not.
    const wanted = encodeURIComponent(JSON.stringify(['ACTIVE', 'IN_PROCESS', 'WITH_ISSUES']))
    assert.ok(calls.every((c) => c.url.includes(`effective_status=${wanted}`)), calls.map((c) => c.url).join('\n'))
    assert.ok(calls.every((c) => !/PAUSED/.test(decodeURIComponent(c.url))))
  })
})

describe('activating', () => {
  const healthy = () =>
    routed([
      campaign(),
      adSets([{ id: 's1', name: 's', status: 'PAUSED', effective_status: 'PAUSED', daily_budget: '500000' }]),
      ads([ad('a1', 'PAUSED'), ad('a2', 'PAUSED')]),
    ])

  test('switches the campaign on LAST, after everything beneath it', async () => {
    // The campaign is the master switch. Doing it last means there is never a
    // moment where part of the campaign is running and part is not.
    const { fetchImpl, calls } = healthy()
    await client(fetchImpl).activate('c1')

    const writes = calls.filter((c) => c.method === 'POST').map((c) => c.url.split('/').pop())
    assert.deepEqual(writes, ['a1', 'a2', 's1', 'c1'])
    for (const call of calls.filter((c) => c.method === 'POST')) {
      assert.equal(call.body.status, 'ACTIVE')
    }
  })

  test('refuses when Meta has rejected an ad, and changes nothing', async () => {
    const { fetchImpl, calls } = routed([
      campaign(),
      adSets([{ id: 's1', name: 's', status: 'PAUSED', effective_status: 'PAUSED' }]),
      ads([ad('a1', 'PAUSED'), ad('a2', 'DISAPPROVED')]),
    ])

    await assert.rejects(() => client(fetchImpl).activate('c1'), PublishError)
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0)
  })
})

describe('pausing', () => {
  test('pauses only the campaign — the one switch that stops everything at once', async () => {
    const { fetchImpl, calls } = routed([
      campaign({ status: 'ACTIVE', effective_status: 'ACTIVE' }),
      adSets([{ id: 's1', name: 's', status: 'ACTIVE', effective_status: 'ACTIVE' }]),
      ads([ad('a1', 'ACTIVE')]),
    ])
    await client(fetchImpl).pause('c1')

    const writes = calls.filter((c) => c.method === 'POST')
    assert.equal(writes.length, 1)
    assert.match(writes[0]!.url, /\/c1$/)
    assert.equal(writes[0]!.body.status, 'PAUSED')
  })
})

describe('adding ads to an ad set that already runs', () => {
  /** A fake Meta that hands out ids for creatives and ads, and can fail on the Nth ad. */
  function meta(failOnAd?: number) {
    const calls: Call[] = []
    let n = 0
    let adCount = 0
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const body: Record<string, string> = {}
      if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) body[k] = v
      const href = String(url)
      calls.push({ method: init?.method ?? 'GET', url: href, body })
      if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ id: 's1', name: 'Broad PK', campaign_id: 'c1', effective_status: 'ACTIVE' }))
      if (/\/ads$/.test(new URL(href).pathname)) {
        adCount++
        if (adCount === failOnAd) return new Response(JSON.stringify({ error: { message: 'Invalid parameter', code: 100 } }), { status: 400 })
      }
      return new Response(JSON.stringify({ id: `id${++n}` }))
    }) as unknown as typeof globalThis.fetch
    return { calls, fetchImpl }
  }
  const one = (name: string) => ({ name, body: 'Rs. 5,999. Free delivery.', bodies: ['Rs. 5,999. Free delivery.', 'Winter is here.'], headlines: ['Chelsea Boots · Rs. 5,999'], landingPageUrl: 'https://example.com/p', callToAction: 'ORDER_NOW' })

  test('each ad is created PAUSED in the given ad set, with website tracking', async () => {
    const { calls, fetchImpl } = meta()
    const c = new MetaAdsClient({ accessToken: 'T', account: { adAccountId: '123', pageId: 'P', currency: 'PKR', pixelId: 'PX' }, fetch: fetchImpl })
    const out = await c.addAds('s1', [one('chelsea-poster'), one('chelsea-sale')] as never)
    assert.equal(out.adIds.length, 2)
    assert.equal(out.campaignId, 'c1')
    const adPosts = calls.filter((x) => x.method === 'POST' && /\/ads$/.test(new URL(x.url).pathname))
    assert.equal(adPosts.length, 2)
    for (const p of adPosts) {
      assert.equal(p.body.adset_id, 's1')
      assert.equal(p.body.status, 'PAUSED')
      assert.match(p.body.tracking_specs ?? '', /PX/)
    }
  })

  test('a failure part-way says exactly which ads exist, all paused', async () => {
    const { fetchImpl } = meta(2)
    const c = new MetaAdsClient({ accessToken: 'T', account: { adAccountId: '123', pageId: 'P', currency: 'PKR' }, fetch: fetchImpl })
    await assert.rejects(c.addAds('s1', [one('a'), one('b')] as never), (e: Error) => /PARTIALLY CREATED in ad set s1/.test(e.message) && /1 ad\(s\)/.test(e.message))
  })
})
