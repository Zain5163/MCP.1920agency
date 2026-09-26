import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { money, type AdPlan } from '@social-publisher/core'

import {
  META_DEFAULT_GUARDRAILS,
  checkMetaAdPlan,
  learningPhaseFloor,
} from '../src/meta-ads-guardrails.ts'

const gbp = (minor: number) => money(minor, 'GBP')

const guards = { ...META_DEFAULT_GUARDRAILS, expectedCpa: gbp(2_000) }

const threeAds = [
  { name: 'a', body: 'Short hook', headline: 'Buy now', landingPageUrl: 'https://1920agency.com' },
  { name: 'b', body: 'Short hook', headline: 'Buy now', landingPageUrl: 'https://1920agency.com' },
  { name: 'c', body: 'Short hook', headline: 'Buy now', landingPageUrl: 'https://1920agency.com' },
]

const plan = (over: Partial<AdPlan> = {}): AdPlan => ({
  campaign: { name: 'Q4 sales', objective: 'OUTCOME_SALES' as never },
  adSets: [
    {
      adSet: {
        name: 'Broad UK',
        dailyBudget: gbp(20_000),
        audience: { countries: ['GB'] },
        optimizationGoal: 'OFFSITE_CONVERSIONS',
        conversionEvent: 'PURCHASE',
      },
      ads: threeAds,
    },
  ],
  ...over,
})

const errors = (issues: ReturnType<typeof checkMetaAdPlan>) =>
  issues.filter((i) => i.severity === 'error')
const warnings = (issues: ReturnType<typeof checkMetaAdPlan>) =>
  issues.filter((i) => i.severity === 'warning')

describe('the learning-phase floor', () => {
  /**
   * The most valuable rule carried over from the Python tool, and the one most
   * advertisers never check.
   */
  test('is derived from the CPA, not picked as a round number', () => {
    // 20.00 CPA x 50 conversions / 7 days = 142.86/day.
    const floor = learningPhaseFloor(guards)
    assert.equal(floor!.minor, 14_286)
    assert.equal(floor!.currency, 'GBP')
  })

  test('follows the CPA when it changes, so the number and the reason cannot drift', () => {
    const cheap = learningPhaseFloor({ ...guards, expectedCpa: gbp(500) })
    assert.equal(cheap!.minor, 3_571)
  })

  test('is undefined without an expected CPA rather than guessed', () => {
    assert.equal(learningPhaseFloor(META_DEFAULT_GUARDRAILS), undefined)
  })

  test('warns when a conversion ad set is below the floor, with the numbers', () => {
    const p = plan()
    const issues = checkMetaAdPlan(
      {
        ...p,
        adSets: [{ ...p.adSets[0]!, adSet: { ...p.adSets[0]!.adSet, dailyBudget: gbp(2_000) } }],
      },
      { guardrails: guards },
    )
    const warning = warnings(issues).find((i) => i.path.includes('dailyBudget'))
    assert.ok(warning, 'expected a learning-phase warning')
    assert.match(warning!.message, /142\.86 GBP/)
    assert.match(warning!.message, /7\.1x short/)
  })

  test('does not warn when the budget clears the floor', () => {
    const issues = checkMetaAdPlan(plan(), { guardrails: guards })
    assert.equal(warnings(issues).some((i) => /learning phase/.test(i.message)), false)
  })

  test('is a warning, never a blocker — it is a judgement call', () => {
    const p = plan()
    const issues = checkMetaAdPlan(
      {
        ...p,
        adSets: [{ ...p.adSets[0]!, adSet: { ...p.adSets[0]!.adSet, dailyBudget: gbp(100) } }],
      },
      { guardrails: guards },
    )
    assert.equal(errors(issues).length, 0)
  })
})

describe('conversion goals', () => {
  test('refuse a conversion goal when the account has no pixel', () => {
    const issues = checkMetaAdPlan(plan(), { guardrails: guards, hasPixel: false })
    assert.ok(errors(issues).some((i) => /pixel/i.test(i.message)))
  })

  test('refuse a conversion goal with no conversion event', () => {
    const p = plan()
    const issues = checkMetaAdPlan(
      {
        ...p,
        adSets: [
          { ...p.adSets[0]!, adSet: { ...p.adSets[0]!.adSet, conversionEvent: undefined } },
        ],
      },
      { guardrails: guards },
    )
    assert.ok(errors(issues).some((i) => i.path.includes('conversionEvent')))
  })

  test('warn when one campaign mixes conversion events', () => {
    // Optimising for different events splits the pixel's signal.
    const p = plan()
    const issues = checkMetaAdPlan(
      {
        ...p,
        adSets: [
          p.adSets[0]!,
          {
            adSet: { ...p.adSets[0]!.adSet, name: 'second', conversionEvent: 'LEAD' },
            ads: threeAds,
          },
        ],
      },
      { guardrails: guards },
    )
    assert.ok(warnings(issues).some((i) => /one event per campaign/.test(i.message)))
  })

  test('warn about interest stacking on a conversion ad set', () => {
    const p = plan()
    const issues = checkMetaAdPlan(
      {
        ...p,
        adSets: [
          {
            ...p.adSets[0]!,
            adSet: {
              ...p.adSets[0]!.adSet,
              audience: { countries: ['GB'], interests: ['Marketing', 'SaaS'] },
            },
          },
        ],
      },
      { guardrails: guards },
    )
    assert.ok(warnings(issues).some((i) => /interest/i.test(i.message)))
  })
})

describe('creative testing structure', () => {
  test('warns below three ads — fewer is not a test', () => {
    const p = plan()
    const issues = checkMetaAdPlan({ ...p, adSets: [{ ...p.adSets[0]!, ads: [threeAds[0]!] }] }, { guardrails: guards })
    assert.ok(warnings(issues).some((i) => /not a real creative test/.test(i.message)))
  })

  test('warns above six ads — Meta starves them of impressions', () => {
    const p = plan()
    const many = Array.from({ length: 8 }, (_, i) => ({ ...threeAds[0]!, name: `ad${i}` }))
    const issues = checkMetaAdPlan({ ...p, adSets: [{ ...p.adSets[0]!, ads: many }] }, { guardrails: guards })
    assert.ok(warnings(issues).some((i) => /starves/.test(i.message)))
  })

  test('warns above three ad sets — fragmentation splits the pixel’s learning', () => {
    const p = plan()
    const four = Array.from({ length: 4 }, (_, i) => ({
      adSet: { ...p.adSets[0]!.adSet, name: `set${i}` },
      ads: threeAds,
    }))
    const issues = checkMetaAdPlan({ ...p, adSets: four }, { guardrails: guards })
    assert.ok(warnings(issues).some((i) => /Fragmenting budget/.test(i.message)))
  })
})

describe('creative copy and destination', () => {
  test('a missing headline is an error', () => {
    const p = plan()
    const issues = checkMetaAdPlan(
      { ...p, adSets: [{ ...p.adSets[0]!, ads: [{ name: 'a', body: 'text' }] }] },
      { guardrails: guards },
    )
    assert.ok(errors(issues).some((i) => i.path.includes('headline')))
  })

  test('warns when primary text will be truncated', () => {
    const p = plan()
    const issues = checkMetaAdPlan(
      {
        ...p,
        adSets: [
          {
            ...p.adSets[0]!,
            ads: [{ ...threeAds[0]!, body: 'x'.repeat(200) }],
          },
        ],
      },
      { guardrails: guards },
    )
    const warning = warnings(issues).find((i) => i.path.includes('body'))
    assert.match(warning!.message, /See more/)
  })

  test('rejects an invented call to action', () => {
    const p = plan()
    const issues = checkMetaAdPlan(
      { ...p, adSets: [{ ...p.adSets[0]!, ads: [{ ...threeAds[0]!, callToAction: 'BUY_PLEASE' }] }] },
      { guardrails: guards },
    )
    assert.ok(errors(issues).some((i) => i.path.includes('callToAction')))
  })

  test('accepts a real one', () => {
    const p = plan()
    const issues = checkMetaAdPlan(
      { ...p, adSets: [{ ...p.adSets[0]!, ads: [{ ...threeAds[0]!, callToAction: 'SHOP_NOW' }] }] },
      { guardrails: guards },
    )
    assert.equal(errors(issues).length, 0)
  })

  test('a sales objective without a landing page is an error', () => {
    const p = plan()
    const issues = checkMetaAdPlan(
      {
        ...p,
        adSets: [
          { ...p.adSets[0]!, ads: [{ name: 'a', body: 'b', headline: 'c' }] },
        ],
      },
      { guardrails: guards },
    )
    assert.ok(errors(issues).some((i) => i.path.includes('landingPageUrl')))
  })

  test('warns about a video with no thumbnail', () => {
    const p = plan()
    const issues = checkMetaAdPlan(
      {
        ...p,
        adSets: [
          {
            ...p.adSets[0]!,
            ads: [{ ...threeAds[0]!, creative: { kind: 'video', localPath: 'a.mp4' } }],
          },
        ],
      },
      { guardrails: guards },
    )
    assert.ok(warnings(issues).some((i) => /auto-pick a frame/.test(i.message)))
  })

  test('boosting an existing post needs its id', () => {
    const p = plan()
    const issues = checkMetaAdPlan(
      {
        ...p,
        adSets: [{ ...p.adSets[0]!, ads: [{ ...threeAds[0]!, creative: { kind: 'existing_post' } }] }],
      },
      { guardrails: guards },
    )
    assert.ok(errors(issues).some((i) => i.path.includes('postId')))
  })

  test('distinguishes deliberately disabled UTMs from absent ones', () => {
    const p = plan()

    const absent = checkMetaAdPlan(p, { guardrails: guards })
    assert.equal(absent.some((i) => i.path.includes('urlTags')), false)

    const disabled = checkMetaAdPlan(
      { ...p, adSets: [{ ...p.adSets[0]!, ads: [{ ...threeAds[0]!, urlTags: '' }] }] },
      { guardrails: guards },
    )
    assert.ok(warnings(disabled).some((i) => /attributed/.test(i.message)))
  })
})

describe('special ad categories', () => {
  test('an unknown category is refused', () => {
    const issues = checkMetaAdPlan(
      plan({ campaign: { name: 'x', objective: 'OUTCOME_SALES' as never, specialCategories: ['DOGS'] } }),
      { guardrails: guards },
    )
    assert.ok(errors(issues).some((i) => i.path.includes('specialCategories')))
  })

  test('a real one passes', () => {
    const issues = checkMetaAdPlan(
      plan({ campaign: { name: 'x', objective: 'OUTCOME_SALES' as never, specialCategories: ['HOUSING'] } }),
      { guardrails: guards },
    )
    assert.equal(errors(issues).some((i) => i.path.includes('specialCategories')), false)
  })
})

describe('a clean plan', () => {
  test('produces no errors and no warnings at all', () => {
    // Worth asserting: a guardrail set that always complains gets ignored.
    const issues = checkMetaAdPlan(plan(), { guardrails: guards, hasPixel: true })
    assert.deepEqual(issues, [])
  })
})
