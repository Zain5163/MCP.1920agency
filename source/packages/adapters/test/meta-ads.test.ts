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

  test('the summary states the total cost', () => {
    // This plan ends on a fixed date, so the total is real rather than a
    // monthly guess.
    const { fetchImpl } = mockMeta([OK])
    assert.match(client(fetchImpl).review(plan()).summary, /in total/i)
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

describe('budget-sharing, which Meta demands', () => {
  test('ad-set budgets require is_adset_budget_sharing_enabled', async () => {
    // Found live: Meta refuses the campaign outright without this field, and its
    // error names the field but not that it applies only to this case.
    const { fetchImpl, calls } = mockMeta([OK])
    await client(fetchImpl).create(plan())

    const campaign = calls.find((c) => c.url.endsWith('/campaigns'))!
    assert.equal(campaign.body.is_adset_budget_sharing_enabled, 'false')
  })

  test('a campaign-level budget does not send it', async () => {
    const { fetchImpl, calls } = mockMeta([OK])
    const p = plan()
    await client(fetchImpl).create({
      ...p,
      campaign: { ...p.campaign, budgetLevel: 'campaign', dailyBudget: gbp(20_000) },
      adSets: [{ ...p.adSets[0]!, adSet: { ...p.adSets[0]!.adSet, dailyBudget: undefined } }],
    })

    const campaign = calls.find((c) => c.url.endsWith('/campaigns'))!
    assert.equal(campaign.body.is_adset_budget_sharing_enabled, undefined)
    assert.equal(campaign.body.daily_budget, '20000')
  })
})

describe('attribution windows', () => {
  test('a conversion goal gets the 7-day click window', async () => {
    const { fetchImpl, calls } = mockMeta([OK])
    await client(fetchImpl).create(plan())

    const adset = calls.find((c) => c.url.endsWith('/adsets'))!
    const spec = JSON.parse(adset.body.attribution_spec!) as Array<{ window_days: number }>
    assert.equal(spec.length, 2)
  })

  test('a click goal sends NONE — Meta only allows (1, 0) and rejects the rest', async () => {
    // Found live. The click is the outcome, so there is nothing to attribute a
    // week later. Omitting it lets Meta apply a default that cannot be rejected.
    const { fetchImpl, calls } = mockMeta([OK])
    const p = plan()
    await client(fetchImpl).create({
      ...p,
      adSets: [
        {
          ...p.adSets[0]!,
          adSet: {
            ...p.adSets[0]!.adSet,
            optimizationGoal: 'LINK_CLICKS',
            conversionEvent: undefined,
          },
        },
      ],
    })

    const adset = calls.find((c) => c.url.endsWith('/adsets'))!
    assert.equal(adset.body.attribution_spec, undefined)
  })
})

describe('Advantage audience versus a fixed age range', () => {
  test('default ages keep Advantage audience on', async () => {
    const { fetchImpl, calls } = mockMeta([OK])
    await client(fetchImpl).create(plan())

    const adset = calls.find((c) => c.url.endsWith('/adsets'))!
    const targeting = JSON.parse(adset.body.targeting!) as Record<string, unknown>
    assert.deepEqual(targeting.targeting_automation, { advantage_audience: 1 })
  })

  test('a narrowed age range sets the flag to 0, explicitly', async () => {
    // Found live. With Advantage audience on, age is a suggestion Meta expands
    // past, so narrowing it is refused with a message that never names the cause.
    const { fetchImpl, calls } = mockMeta([OK])
    const p = plan()
    await client(fetchImpl).create({
      ...p,
      adSets: [
        {
          ...p.adSets[0]!,
          adSet: {
            ...p.adSets[0]!.adSet,
            audience: { countries: ['GB'], ageMin: 25, ageMax: 55 },
          },
        },
      ],
    })

    const adset = calls.find((c) => c.url.endsWith('/adsets'))!
    const targeting = JSON.parse(adset.body.targeting!) as Record<string, unknown>
    // Sent explicitly as 0, never omitted: Meta refuses an ad set that leaves
    // the flag out entirely.
    assert.deepEqual(targeting.targeting_automation, { advantage_audience: 0 })
    assert.equal(targeting.age_min, 25)
    assert.equal(targeting.age_max, 55)
  })
})

describe('website tracking', () => {
  test('every ad tracks website events with the pixel, even on a traffic campaign', async () => {
    // Found by the owner on the first real campaign: a traffic ad launched with
    // "Website events" unticked, because the pixel was only attached to
    // conversion ad sets.
    const { fetchImpl, calls } = mockMeta([OK])
    const p = plan()
    await client(fetchImpl).create({
      ...p,
      campaign: { ...p.campaign, objective: 'OUTCOME_TRAFFIC' as never },
      adSets: [
        {
          ...p.adSets[0]!,
          adSet: { ...p.adSets[0]!.adSet, optimizationGoal: 'LINK_CLICKS', conversionEvent: undefined },
        },
      ],
    })
    for (const ad of calls.filter((c) => c.url.endsWith('/ads'))) {
      const specs = JSON.parse(ad.body.tracking_specs!) as Array<Record<string, string[]>>
      assert.deepEqual(specs[0], { 'action.type': ['offsite_conversion'], fb_pixel: ['999'] })
    }
  })

  test('without a pixel, nothing is invented', async () => {
    const { fetchImpl, calls } = mockMeta([OK])
    await new MetaAdsClient({ account: { ...account, pixelId: undefined }, accessToken: 'T', fetch: fetchImpl }).create({
      ...plan(),
      adSets: [
        {
          ...plan().adSets[0]!,
          adSet: { ...plan().adSets[0]!.adSet, optimizationGoal: 'LINK_CLICKS', conversionEvent: undefined },
        },
      ],
    })
    assert.equal(calls.find((c) => c.url.endsWith('/ads'))!.body.tracking_specs, undefined)
  })
})
