import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  auditAccount,
  audienceFindings,
  breakEvenRoas,
  clickQualityFindings,
  fatigueFindings,
  judgeAds,
  placementFindings,
  readMetrics,
  resultActionsFor,
  sumMetrics,
  type AdWindow,
  type Metrics,
} from '../src/meta-ads-analysis.ts'

/**
 * The owner's first real campaign, 2026-09-30, as Meta returned it. A 13.5%
 * click-through rate that looked excellent, with almost all of the spend on
 * Audience Network and a fifth of clicks reaching the page.
 */
const firstCampaignDay = {
  spend: '285.35',
  impressions: '1801',
  reach: '1214',
  frequency: '1.483526',
  inline_link_clicks: '243',
  inline_link_click_ctr: '13.492504',
  actions: [
    { action_type: 'link_click', value: '243' },
    { action_type: 'landing_page_view', value: '48' },
    { action_type: 'post_engagement', value: '243' },
  ],
}
const firstCampaignPlacements = [
  ['audience_network', 'an_classic', '277.698927', '1574', '233'],
  ['facebook', 'facebook_reels', '1.090153', '27', '2'],
  ['facebook', 'facebook_reels_overlay', '3.570501', '143', '2'],
  ['facebook', 'feed', '2.130299', '49', '4'],
].map(([p, pos, spend, imp, clicks]) => ({
  key: `${p} / ${pos}`,
  metrics: readMetrics({ spend, impressions: imp, inline_link_clicks: clicks, actions: [{ action_type: 'link_click', value: clicks }] }, ['link_click']),
}))

describe('what counts as a result', () => {
  test('comes from the goal, so a traffic campaign is not credited with engagements', () => {
    assert.deepEqual(resultActionsFor('LANDING_PAGE_VIEWS').slice(0, 1), ['landing_page_view'])
    assert.deepEqual(resultActionsFor('CONVERSATIONS'), ['onsite_conversion.messaging_conversation_started_7d'])
    assert.equal(resultActionsFor('OFFSITE_CONVERSIONS', 'PURCHASE')[0], 'omni_purchase')
    assert.equal(resultActionsFor('OFFSITE_CONVERSIONS', 'LEAD')[0], 'offsite_conversion.fb_pixel_lead')
    assert.deepEqual(resultActionsFor(undefined), ['link_click'])
  })

  test('money is read into minor units, and ROAS from purchase value', () => {
    const m = readMetrics(
      {
        spend: '1000.50',
        impressions: '5000',
        actions: [{ action_type: 'omni_purchase', value: '4' }],
        action_values: [{ action_type: 'omni_purchase', value: '3000' }],
      },
      resultActionsFor('VALUE'),
    )
    assert.equal(m.spendMinor, 100050)
    assert.equal(m.results, 4)
    assert.equal(m.costPerResultMinor, 25013)
    assert.equal(m.valueMinor, 300000)
    assert.ok(Math.abs(m.roas! - 2.9985) < 0.001)
  })

  test('adding rows recomputes frequency rather than averaging it', () => {
    const a = readMetrics({ spend: '10', impressions: '300', reach: '100' }, ['link_click'])
    const b = readMetrics({ spend: '10', impressions: '100', reach: '100' }, ['link_click'])
    assert.equal(sumMetrics([a, b], 'link_click').frequency, 2)
  })
})

describe('the analyst, on the first real campaign', () => {
  const total = readMetrics(firstCampaignDay, ['link_click'])

  test('sees that most clicks never reached the page', () => {
    const f = clickQualityFindings(total)
    assert.equal(f.length, 1)
    assert.equal(f[0]!.severity, 'critical')
    assert.match(f[0]!.message, /Only 20% of 243 link clicks/)
    assert.match(f[0]!.action!, /landing page views/)
  })

  test('sees where the money went', () => {
    const f = placementFindings(firstCampaignPlacements)
    const an = f.find((x) => /Audience Network/.test(x.message))!
    assert.equal(an.severity, 'critical')
    assert.match(an.message, /9\d% of the spend/)
    assert.match(an.action!, /exclude_placements/)
  })

  test('says nothing about click quality when there is too little data', () => {
    assert.deepEqual(clickQualityFindings(readMetrics({ inline_link_clicks: '40', actions: [{ action_type: 'landing_page_view', value: '5' }] }, ['link_click'])), [])
  })
})

const m = (over: Partial<Metrics>): Metrics => ({
  spendMinor: 0,
  impressions: 0,
  reach: 0,
  frequency: 0,
  linkClicks: 0,
  landingPageViews: 0,
  linkCtr: 0,
  results: 0,
  resultAction: 'lead',
  valueMinor: 0,
  ...over,
})

describe('the creative strategist', () => {
  test('flags fatigue: click-through down a fifth while frequency climbs', () => {
    const ads: AdWindow[] = [
      { adId: '1', name: 'Tired', previous: m({ impressions: 5000, linkCtr: 1.5, frequency: 1.8 }), current: m({ impressions: 5000, linkCtr: 1.0, frequency: 3.1 }) },
      { adId: '2', name: 'Fine', previous: m({ impressions: 5000, linkCtr: 1.5, frequency: 1.8 }), current: m({ impressions: 5000, linkCtr: 1.45, frequency: 2.0 }) },
    ]
    const f = fatigueFindings(ads)
    assert.equal(f.length, 1)
    assert.match(f[0]!.message, /"Tired"/)
  })

  test('uses who converts for the copy, never for narrowing', () => {
    const rows = [
      { key: '25-34 / female', metrics: m({ spendMinor: 30000, results: 10, costPerResultMinor: 3000 }) },
      { key: '45-54 / male', metrics: m({ spendMinor: 70000, results: 5, costPerResultMinor: 14000 }) },
    ]
    const f = audienceFindings(rows)
    assert.match(f[0]!.message, /25-34 \/ female/)
    assert.match(f[0]!.action!, /Keep targeting broad/)
  })
})

describe('the media buyer', () => {
  const target = { costPerResultMinor: 100000 } // PKR 1,000 per lead

  test('waits until about three times the target is spent', () => {
    const [d] = judgeAds([{ adId: '1', name: 'New', current: m({ spendMinor: 150000, results: 1, costPerResultMinor: 150000 }) }], target)
    assert.equal(d!.verdict, 'wait')
  })

  test('cuts an ad with no results after enough spend', () => {
    const [d] = judgeAds([{ adId: '1', name: 'Dud', current: m({ spendMinor: 320000 }) }], target)
    assert.equal(d!.verdict, 'cut')
  })

  test('scales a clear winner, keeps one near target', () => {
    const d = judgeAds(
      [
        { adId: '1', name: 'Win', current: m({ spendMinor: 400000, results: 6, costPerResultMinor: 66667 }) },
        { adId: '2', name: 'Ok', current: m({ spendMinor: 400000, results: 4, costPerResultMinor: 100000 }) },
      ],
      target,
    )
    assert.deepEqual(d.map((x) => x.verdict), ['scale', 'keep'])
  })

  test('judges e-commerce by ROAS against break-even from the margin', () => {
    assert.equal(breakEvenRoas(0.4), 2.5)
    const [d] = judgeAds(
      [{ adId: '1', name: 'Shop', current: m({ spendMinor: 100000, results: 10, valueMinor: 200000, roas: 2 }) }],
      { margin: 0.4 },
    )
    assert.equal(d!.verdict, 'cut')
    assert.match(d!.reason, /2\.00×, below the 2\.50× break-even/)
  })
})

describe('the auditor', () => {
  const base = { rejectedAds: [], total: m({}), placements: [] }

  test('puts rejected ads and untracked spend first', () => {
    const f = auditAccount({
      ...base,
      adSets: [{ id: 'a', name: 'A', status: 'ACTIVE', optimizationGoal: 'LINK_CLICKS', activeAds: 2, dynamicCreative: false }],
      rejectedAds: [{ id: 'x', name: 'Bad ad', status: 'DISAPPROVED' }],
      total: m({ spendMinor: 50000, results: 0 }),
    })
    assert.equal(f[0]!.severity, 'critical')
    assert.ok(f.some((x) => /link clicks/.test(x.message)))
    assert.ok(f.some((x) => /Fewer than 3/.test(x.message)))
    assert.ok(f.some((x) => /no results recorded/.test(x.message)))
  })

  test('finds ad sets below the learning budget when a target is known', () => {
    const f = auditAccount({
      ...base,
      targetCostMinor: 100000, // PKR 1,000 → floor about PKR 7,143 a day
      adSets: [
        { id: 'a', name: 'A', status: 'ACTIVE', dailyBudgetMinor: 100000, activeAds: 3, dynamicCreative: false },
        { id: 'b', name: 'B', status: 'ACTIVE', dailyBudgetMinor: 100000, activeAds: 3, dynamicCreative: false },
      ],
    })
    assert.ok(f.some((x) => /below the learning budget \(about 7143 a day/.test(x.message)))
  })

  test('a dynamic-creative ad set is not told it has too few ads', () => {
    const f = auditAccount({ ...base, adSets: [{ id: 'a', name: 'A', status: 'ACTIVE', activeAds: 1, dynamicCreative: true }] })
    assert.equal(f.some((x) => /Fewer than 3/.test(x.message)), false)
  })
})

describe('found on the first live run, 2026-10-02', () => {
  test('one ad with no target is not judged against itself', () => {
    const [d] = judgeAds([{ adId: '1', name: 'Only', current: m({ spendMinor: 28535, results: 243, costPerResultMinor: 117 }) }], {})
    assert.equal(d!.verdict, 'wait')
    assert.match(d!.reason, /nothing to be compared with/)
  })

  test('click quality is judged on website ad sets only, not chat ads', () => {
    const f = auditAccount({
      adSets: [],
      rejectedAds: [],
      placements: [],
      // Account-wide: messaging clicks open a chat, so almost none "load a page".
      total: m({ spendMinor: 855662, linkClicks: 568, landingPageViews: 49, results: 149 }),
      // The website part alone is healthy.
      websiteTotal: m({ spendMinor: 30000, linkClicks: 60, landingPageViews: 49 }),
    })
    assert.equal(f.some((x) => /link clicks became landing page views/.test(x.message)), false)
  })
})
