import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { bestMonth, breakEven, decompose, toMonthFunnel } from '../src/account-diagnosis.ts'

/** An Insights row as Meta returns it (account level, one month). */
function row(month: string, v: { spend: number; impressions: number; clicks: number; lpv: number; atc: number; purchases: number; revenue: number; frequency?: number }) {
  return {
    date_start: `${month}-01`,
    spend: String(v.spend),
    impressions: String(v.impressions),
    inline_link_clicks: String(v.clicks),
    frequency: String(v.frequency ?? 2),
    actions: [
      { action_type: 'landing_page_view', value: String(v.lpv) },
      { action_type: 'offsite_conversion.fb_pixel_add_to_cart', value: String(v.atc) },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: String(v.purchases) },
    ],
    action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: String(v.revenue) }],
  }
}

// Shaped on a real 2026 decline: cost per purchase 2.2× with add-to-cart, CPM and CTR all worse.
const good = toMonthFunnel(row('2026-02', { spend: 166_735, impressions: 664_283, clicks: 15_544, lpv: 12_176, atc: 724, purchases: 262, revenue: 1_351_920 }))
const bad = toMonthFunnel(row('2026-09', { spend: 223_639, impressions: 653_915, clicks: 11_509, lpv: 9_068, atc: 315, purchases: 160, revenue: 1_125_280, frequency: 2.9 }))

describe('the monthly funnel', () => {
  test('derives every rate from what Meta reports', () => {
    assert.equal(good.month, '2026-02')
    assert.ok(Math.abs(good.cpm! - 251) < 1)
    assert.ok(Math.abs(good.costPerPurchase! - 636) < 1)
    assert.ok(Math.abs(good.averageOrder! - 5160) < 1)
    assert.ok(Math.abs(good.addToCartRate! - 0.0595) < 0.001)
  })

  test('a month with no purchases has no cost per purchase, rather than a fake one', () => {
    const empty = toMonthFunnel(row('2026-04', { spend: 1000, impressions: 5000, clicks: 50, lpv: 40, atc: 0, purchases: 0, revenue: 0 }))
    assert.equal(empty.costPerPurchase, undefined)
    assert.equal(empty.purchaseRate, undefined)
  })

  test('the best month needs enough purchases to count', () => {
    const lucky = toMonthFunnel(row('2026-03', { spend: 1000, impressions: 5000, clicks: 100, lpv: 80, atc: 10, purchases: 5, revenue: 30_000 }))
    assert.equal(bestMonth([good, bad, lucky], 20)!.month, '2026-02')
    assert.equal(bestMonth([good, bad, lucky], 1)!.month, '2026-03')
  })
})

describe('splitting a change in cost per purchase into funnel steps', () => {
  const steps = decompose(good, bad)

  test('the step effects multiply to the change in cost per purchase', () => {
    const product = steps.reduce((p, s) => p * s.effect, 1)
    assert.ok(Math.abs(product - bad.costPerPurchase! / good.costPerPurchase!) < 1e-9)
  })

  test('the biggest cause comes first, and an improved step shows below 1', () => {
    assert.equal(steps[0]!.step, 'addToCartRate')
    assert.ok(steps[0]!.effect > 1.6)
    assert.ok(steps.find((s) => s.step === 'purchaseRate')!.effect < 1)
    assert.ok(steps.find((s) => s.step === 'cpm')!.effect > 1.3)
  })
})

describe('break-even cost per sale', () => {
  const base = { orderValue: 6000, itemsPerOrder: 1, costPerItem: 3500, deliveryCost: 400, percentTaken: 6.1, refusedPercent: 30, refusedOrderCost: 980 }

  test('real cash-on-delivery costs and refusals set the line', () => {
    const b = breakEven(base)
    assert.equal(Math.round(b.profitPerDeliveredOrder), 1734)
    assert.equal(Math.round(b.breakEvenCostPerPurchase), 920)
  })

  test('fewer refusals and a two-item bundle raise what a sale may cost', () => {
    assert.ok(breakEven({ ...base, refusedPercent: 20 }).breakEvenCostPerPurchase > 1100)
    assert.equal(Math.round(breakEven({ ...base, orderValue: 11_998, itemsPerOrder: 2 }).breakEvenCostPerPurchase), 2412)
  })

  test('a price below cost loses money at any ad cost', () => {
    assert.ok(breakEven({ ...base, orderValue: 3499 }).breakEvenCostPerPurchase < 0)
  })
})
