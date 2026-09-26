import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  describePlan,
  formatMoney,
  money,
  totalDailyBudget,
  validateAdPlan,
  type AdPlan,
} from '../src/domain/ads.ts'

const usd = (minor: number) => money(minor, 'USD')

const plan = (over: Partial<AdPlan> = {}): AdPlan => ({
  campaign: { name: 'Lead gen Q4', objective: 'leads' },
  adSets: [
    {
      adSet: {
        name: 'US business owners',
        dailyBudget: usd(5_000),
        audience: { countries: ['US'] },
        endAt: new Date('2026-12-31'),
      },
      ads: [{ name: 'Ad 1', body: 'Book a call', landingPageUrl: 'https://1920agency.com' }],
    },
  ],
  ...over,
})

describe('money', () => {
  test('refuses a fractional amount rather than rounding it', () => {
    // The whole reason money is integer minor units.
    assert.throws(() => money(10.5, 'USD'), RangeError)
  })

  test('the error says what to write instead', () => {
    try {
      money(10.5, 'USD')
      assert.fail('should have thrown')
    } catch (error) {
      assert.match((error as Error).message, /1050/)
    }
  })

  test('formats for a human', () => {
    assert.equal(formatMoney(usd(5_000)), '50.00 USD')
    assert.equal(formatMoney(usd(1)), '0.01 USD')
  })

  test('adds without floating-point drift', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004. In minor units it is 30.
    const total = totalDailyBudget(
      plan({
        adSets: [
          { adSet: { name: 'a', dailyBudget: usd(10), audience: { countries: ['US'] } }, ads: [{ name: 'x', body: 'y' }] },
          { adSet: { name: 'b', dailyBudget: usd(20), audience: { countries: ['US'] } }, ads: [{ name: 'x', body: 'y' }] },
        ],
      }),
    )
    assert.equal(total!.minor, 30)
  })
})

describe('validating a plan', () => {
  test('a sound plan passes', () => {
    const result = validateAdPlan(plan())
    assert.equal(result.ok, true)
  })

  test('a campaign with no ad sets is refused', () => {
    const result = validateAdPlan(plan({ adSets: [] }))
    assert.equal(result.ok, false)
  })

  test('a zero or negative budget is refused', () => {
    for (const minor of [0, -5_000]) {
      const p = plan()
      const result = validateAdPlan({
        ...p,
        adSets: [{ ...p.adSets[0]!, adSet: { ...p.adSets[0]!.adSet, dailyBudget: usd(minor) } }],
      })
      assert.equal(result.ok, false, `${minor} should be refused`)
    }
  })

  test('targeting no country at all is an error, not a warning', () => {
    // An untargeted ad set spends money on an audience nobody chose.
    const p = plan()
    const result = validateAdPlan({
      ...p,
      adSets: [{ ...p.adSets[0]!, adSet: { ...p.adSets[0]!.adSet, audience: { countries: [] } } }],
    })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.path.includes('countries') && i.severity === 'error'))
  })

  test('an end date before the start date is refused', () => {
    const p = plan()
    const result = validateAdPlan({
      ...p,
      adSets: [
        {
          ...p.adSets[0]!,
          adSet: {
            ...p.adSets[0]!.adSet,
            startAt: new Date('2026-12-01'),
            endAt: new Date('2026-11-01'),
          },
        },
      ],
    })
    assert.equal(result.ok, false)
  })

  test('no end date warns but does not block', () => {
    // Legitimate for an always-on campaign, and the easiest way to overspend.
    const p = plan()
    const result = validateAdPlan({
      ...p,
      adSets: [{ ...p.adSets[0]!, adSet: { ...p.adSets[0]!.adSet, endAt: undefined } }],
    })
    assert.equal(result.ok, true)
    assert.ok(result.issues.some((i) => i.severity === 'warning' && i.path.includes('endAt')))
  })

  test('an ad set with no ads is refused', () => {
    const p = plan()
    const result = validateAdPlan({ ...p, adSets: [{ ...p.adSets[0]!, ads: [] }] })
    assert.equal(result.ok, false)
  })

  test('a plain http landing page is refused', () => {
    const p = plan()
    const result = validateAdPlan({
      ...p,
      adSets: [
        { ...p.adSets[0]!, ads: [{ name: 'a', body: 'b', landingPageUrl: 'http://1920agency.com' }] },
      ],
    })
    assert.equal(result.ok, false)
  })

  test('mixed currencies are refused, never converted', () => {
    // One ad account holds one currency, so a mix means one ad set is wrong.
    const result = validateAdPlan(
      plan({
        adSets: [
          { adSet: { name: 'a', dailyBudget: usd(5_000), audience: { countries: ['US'] } }, ads: [{ name: 'x', body: 'y' }] },
          {
            adSet: { name: 'b', dailyBudget: money(5_000, 'PKR'), audience: { countries: ['PK'] } },
            ads: [{ name: 'x', body: 'y' }],
          },
        ],
      }),
    )
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => /currenc/i.test(i.message)))
  })

  test('an ad with nothing to click warns', () => {
    const p = plan()
    const result = validateAdPlan({
      ...p,
      adSets: [{ ...p.adSets[0]!, ads: [{ name: 'a', body: 'text only' }] }],
    })
    assert.ok(result.issues.some((i) => i.severity === 'warning'))
  })

  test('every issue says where it is', () => {
    const result = validateAdPlan(plan({ adSets: [] }))
    for (const issue of result.issues) assert.ok(issue.path.length > 0)
  })
})

describe('total budget', () => {
  test('sums the ad sets', () => {
    const total = totalDailyBudget(
      plan({
        adSets: [
          { adSet: { name: 'a', dailyBudget: usd(5_000), audience: { countries: ['US'] } }, ads: [] },
          { adSet: { name: 'b', dailyBudget: usd(2_500), audience: { countries: ['US'] } }, ads: [] },
        ],
      }),
    )
    assert.equal(formatMoney(total!), '75.00 USD')
  })

  test('refuses to total across currencies', () => {
    const total = totalDailyBudget(
      plan({
        adSets: [
          { adSet: { name: 'a', dailyBudget: usd(5_000), audience: { countries: ['US'] } }, ads: [] },
          { adSet: { name: 'b', dailyBudget: money(5_000, 'PKR'), audience: { countries: ['PK'] } }, ads: [] },
        ],
      }),
    )
    assert.equal(total, undefined)
  })
})

describe('the approval summary', () => {
  test('leads with the monthly cost, not just the daily one', () => {
    // 50/day reads as small. 1500/month is the number that changes minds.
    const summary = describePlan(plan())
    assert.match(summary, /50\.00 USD/)
    assert.match(summary, /1500\.00 USD/)
    assert.match(summary, /per month/i)
  })

  test('says plainly that nothing will spend yet', () => {
    assert.match(describePlan(plan()), /PAUSED/)
  })

  test('calls out an ad set with no end date', () => {
    const p = plan()
    const summary = describePlan({
      ...p,
      adSets: [{ ...p.adSets[0]!, adSet: { ...p.adSets[0]!.adSet, endAt: undefined } }],
    })
    assert.match(summary, /NO end date/i)
  })
})
