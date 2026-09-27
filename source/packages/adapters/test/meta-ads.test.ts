import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { PublishError, money, type AdPlan } from '@social-publisher/core'

import { MetaAdsClient } from '../src/meta-ads.ts'

const gbp = (minor: number) => money(minor, 'GBP')

interface Call {
  url: string
  body: Record<string, string>
}

function mockMeta(replies: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  let i = 0
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const body: Record<string, string> = {}
    if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) body[k] = v
    calls.push({ url: String(url), body })
    const next = replies[Math.min(i, replies.length - 1)]!
    i += 1
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetchImpl, calls }
}

const account = {
  adAccountId: '123456',
  pageId: '102223309294786',
  instagramId: '17841452630711887',
  pixelId: '999',
  currency: 'GBP',
}

const ads = [
  { name: 'a', body: 'Short', headline: 'Buy', landingPageUrl: 'https://1920agency.com' },
  { name: 'b', body: 'Short', headline: 'Buy', landingPageUrl: 'https://1920agency.com' },
  { name: 'c', body: 'Short', headline: 'Buy', landingPageUrl: 'https://1920agency.com' },
]

const plan = (over: Partial<AdPlan> = {}): AdPlan => ({
  campaign: { name: 'Q4 leads', objective: 'OUTCOME_LEADS' as never },
  adSets: [
    {
      adSet: {
        name: 'Broad GB',
        dailyBudget: gbp(20_000),
        audience: { countries: ['GB'] },
        optimizationGoal: 'OFFSITE_CONVERSIONS',
        conversionEvent: 'LEAD',
        endAt: new Date('2026-12-31T00:00:00Z'),
      },
      ads,
    },
  ],
  ...over,
})

const client = (fetchImpl: typeof globalThis.fetch) =>
  new MetaAdsClient({ account, accessToken: 'TOKEN', fetch: fetchImpl })

const OK = { body: { id: 'obj_1' } }

describe('reviewing without creating', () => {
  test('never calls the API', () => {
    // It must be impossible for the thing an AI calls before asking for approval
    // to have side effects.
    const { fetchImpl, calls } = mockMeta([OK])
    const result = client(fetchImpl).review(plan())
    assert.equal(calls.length, 0)
    assert.equal(result.ok, true)
  })

  test('the summary leads with the monthly cost', () => {
    const { fetchImpl } = mockMeta([OK])
    assert.match(client(fetchImpl).review(plan()).summary, /per month/i)
  })

  test('combines platform-neutral and Meta-specific problems', () => {
    const { fetchImpl } = mockMeta([OK])
    const p = plan()
    const result = client(fetchImpl).review({
      ...p,
      adSets: [
        {
          ...p.adSets[0]!,
          ads: [{ name: 'a', body: 'no headline', landingPageUrl: 'https://x.com' }],
        },
      ],
    })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => /headline/i.test(e)))
  })
})

describe('creating', () => {
  test('everything is created PAUSED', async () => {
    // The rule the whole design rests on.
    const { fetchImpl, calls } = mockMeta([OK])
    await client(fetchImpl).create(plan())

    assert.ok(calls.length > 0)
    for (const call of calls) {
      if (call.body.status !== undefined) {
        assert.equal(call.body.status, 'PAUSED', `${call.url} was not paused`)
      }
    }
  })

  test('creates campaign, ad set, creatives and ads in that order', async () => {
    const { fetchImpl, calls } = mockMeta([OK])
    const result = await client(fetchImpl).create(plan())

    const edges = calls.map((c) => c.url.split('/').pop())
    assert.equal(edges[0], 'campaigns')
    assert.equal(edges[1], 'adsets')
    assert.equal(edges[2], 'adcreatives')
    assert.equal(edges[3], 'ads')

    assert.equal(result.created.adSetIds.length, 1)
    assert.equal(result.created.adIds.length, 3)
  })

  test('targets the account with the act_ prefix', async () => {
    const { fetchImpl, calls } = mockMeta([OK])
    await client(fetchImpl).create(plan())
    assert.match(calls[0]!.url, /\/act_123456\/campaigns$/)
  })

  test('budgets are sent in minor units', async () => {
    const { fetchImpl, calls } = mockMeta([OK])
    await client(fetchImpl).create(plan())
    const adset = calls.find((c) => c.url.endsWith('/adsets'))!
    assert.equal(adset.body.daily_budget, '20000')
  })

  test('a conversion goal carries the pixel and the event', async () => {
    const { fetchImpl, calls } = mockMeta([OK])
    await client(fetchImpl).create(plan())
    const adset = calls.find((c) => c.url.endsWith('/adsets'))!
    const promoted = JSON.parse(adset.body.promoted_object!) as Record<string, string>

    assert.equal(promoted.pixel_id, '999')
    assert.equal(promoted.custom_event_type, 'LEAD')
  })

  test('the creative carries the Page and the Instagram account', async () => {
    const { fetchImpl, calls } = mockMeta([OK])
    await client(fetchImpl).create(plan())
    const creative = calls.find((c) => c.url.endsWith('/adcreatives'))!
    const story = JSON.parse(creative.body.object_story_spec!) as Record<string, unknown>

    assert.equal(story.page_id, '102223309294786')
    assert.equal(story.instagram_actor_id, '17841452630711887')
  })

  test('UTM placeholders reach Meta unexpanded', async () => {
    const { fetchImpl, calls } = mockMeta([OK])
    await client(fetchImpl).create(plan())
    const creative = calls.find((c) => c.url.endsWith('/adcreatives'))!
    assert.match(creative.body.url_tags!, /\{\{campaign\.name\}\}/)
  })

  test('refuses an invalid plan without calling the API at all', async () => {
    const { fetchImpl, calls } = mockMeta([OK])
    const p = plan()
    await assert.rejects(
      () => client(fetchImpl).create({ ...p, adSets: [{ ...p.adSets[0]!, ads: [] }] }),
      PublishError,
    )
    assert.equal(calls.length, 0)
  })

  test('warnings are returned, never swallowed', async () => {
    const { fetchImpl } = mockMeta([OK])
    const p = plan()
    const result = await client(fetchImpl).create({
      ...p,
      adSets: [{ ...p.adSets[0]!, ads: [ads[0]!] }],
    })
    assert.ok(result.warnings.some((w) => /creative test/.test(w)))
  })
})

describe('when something fails partway', () => {
  test('says exactly what exists, because re-running would duplicate it', async () => {
    const { fetchImpl } = mockMeta([
      { body: { id: 'camp_1' } },
      { status: 400, body: { error: { message: 'Invalid targeting', code: 100 } } },
    ])

    try {
      await client(fetchImpl).create(plan())
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(error instanceof PublishError)
      assert.match(error.message, /camp_1/)
      assert.match(error.message, /PAUSED so nothing is spending/)
      assert.match(error.message, /creates a second one/)
    }
  })

  test('prefers the human-readable message when Meta sends one', async () => {
    // error_user_msg is usually far better than the developer message.
    const { fetchImpl } = mockMeta([
      {
        status: 400,
        body: {
          error: {
            message: 'Invalid parameter',
            error_user_msg: 'Your ad account is not authorised to run ads in this country.',
          },
        },
      },
    ])
    try {
      await client(fetchImpl).create(plan())
      assert.fail('should have thrown')
    } catch (error) {
      assert.match((error as Error).message, /not authorised to run ads/)
    }
  })
})
