import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { MetaAdsClient, assessPerformance, previewLink } from '../src/meta-ads.ts'

const row = (over: Record<string, unknown> = {}) => ({
  ad_id: 'a1',
  ad_name: 'hook-1',
  spend: '1500.00',
  impressions: '20000',
  frequency: '1.8',
  inline_link_clicks: '300',
  inline_link_click_ctr: '1.5',
  actions: [{ action_type: 'lead', value: '3' }],
  ...over,
})

describe('reading performance', () => {
  test('spend is converted to minor units once, from the decimal string Meta sends', () => {
    assert.equal(assessPerformance(row()).spendMinor, 150_000)
  })

  test('counts leads under whichever name Meta reported them', () => {
    const r = assessPerformance(row({ actions: [{ action_type: 'onsite_conversion.lead_grouped', value: '4' }] }))
    assert.equal(r.results, 4)
    assert.equal(r.costPerResultMinor, 37_500)
  })

  test('falls back to link clicks when there are no lead actions', () => {
    const r = assessPerformance(row({ actions: [{ action_type: 'link_click', value: '300' }] }))
    assert.equal(r.resultAction, 'link_click')
  })

  test('refuses to judge cost before about three times the target is spent', () => {
    // An early "no results" is usually just early.
    const r = assessPerformance(row({ spend: '100.00', actions: [] }), { targetCostMinor: 50_000 })
    assert.ok(r.suggestions.some((s) => /Not enough data/.test(s)))
    assert.equal(r.suggestions.some((s) => /not working/.test(s)), false)
  })

  test('three times the target with nothing to show says replace it', () => {
    const r = assessPerformance(row({ spend: '1500.00', actions: [] }), { targetCostMinor: 50_000 })
    assert.ok(r.suggestions.some((s) => /not working/.test(s)))
  })

  test('at or under target with enough data is a keeper', () => {
    const r = assessPerformance(row({ spend: '1500.00', actions: [{ action_type: 'lead', value: '4' }] }), {
      targetCostMinor: 50_000,
    })
    assert.ok(r.suggestions.some((s) => /candidate to keep/.test(s)))
  })

  test('gives no cost verdict at all without a target', () => {
    const r = assessPerformance(row({ spend: '9000.00', actions: [] }))
    assert.equal(r.suggestions.some((s) => /target/.test(s)), false)
  })

  test('warns on fatigue before it is critical, and says replace when it is', () => {
    assert.ok(assessPerformance(row({ frequency: '3.1' })).suggestions.some((s) => /getting familiar/.test(s)))
    assert.ok(assessPerformance(row({ frequency: '4.6' })).suggestions.some((s) => /worn out/.test(s)))
  })

  test('flags weak click-through only once there are enough impressions', () => {
    assert.ok(assessPerformance(row({ inline_link_click_ctr: '0.4' })).suggestions.some((s) => /weak/.test(s)))
    assert.equal(
      assessPerformance(row({ impressions: '300', inline_link_click_ctr: '0.4' })).suggestions.some((s) => /weak/.test(s)),
      false,
    )
  })

  test('no delivery is named before anything else is judged', () => {
    const r = assessPerformance(row({ spend: '0', impressions: '0', actions: [] }))
    assert.match(r.suggestions[0]!, /No delivery/)
  })
})

describe('previews', () => {
  test('extracts the render address and undoes the HTML entities', () => {
    const html = '<iframe src="https://business.facebook.com/ads/api/preview_iframe.php?d=AQ&amp;t=AQ2" width="540"></iframe>'
    assert.equal(previewLink(html), 'https://business.facebook.com/ads/api/preview_iframe.php?d=AQ&t=AQ2')
  })

  test('returns nothing rather than a broken link when there is no iframe', () => {
    assert.equal(previewLink('<p>no preview</p>'), undefined)
    assert.equal(previewLink(undefined), undefined)
  })
})

describe('instant forms', () => {
  const calls: Array<{ url: string; body: Record<string, string> }> = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const body: Record<string, string> = {}
    if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) body[k] = v
    calls.push({ url: String(url), body })
    if (String(url).includes('fields=access_token')) return new Response(JSON.stringify({ access_token: 'PAGE_TOKEN' }))
    return new Response(JSON.stringify({ id: 'FORM1' }))
  }) as unknown as typeof globalThis.fetch

  const client = new MetaAdsClient({
    accessToken: 'SYSTEM_TOKEN',
    account: { adAccountId: '1', pageId: 'PAGE', currency: 'PKR' },
    fetch: fetchImpl,
  })

  const form = {
    name: 'f',
    questions: [{ type: 'FULL_NAME' as const }, { type: 'PHONE' as const }],
    privacyPolicyUrl: 'https://1920agency.com/privacy-policy/',
    followUpUrl: 'https://1920agency.com',
  }

  test('acts as the Page, with the Page token rather than the system token', async () => {
    calls.length = 0
    assert.equal(await client.createLeadForm(form), 'FORM1')
    const create = calls.find((c) => c.url.endsWith('/PAGE/leadgen_forms'))!
    assert.equal(create.body.access_token, 'PAGE_TOKEN')
  })

  test('Higher Intent is on unless deliberately turned off', async () => {
    calls.length = 0
    await client.createLeadForm(form)
    assert.equal(calls.find((c) => c.url.includes('leadgen_forms'))!.body.is_optimized_for_quality, 'true')
  })

  test('four custom questions are refused, because people abandon long forms', async () => {
    const q = (key: string) => ({ type: 'CUSTOM' as const, key, label: key })
    await assert.rejects(
      () => client.createLeadForm({ ...form, questions: [q('a'), q('b'), q('c'), q('d')] }),
      /three or fewer/,
    )
  })

  test('a privacy policy on plain http is refused before Meta is asked', async () => {
    await assert.rejects(
      () => client.createLeadForm({ ...form, privacyPolicyUrl: 'http://1920agency.com/privacy' }),
      /https privacy policy/,
    )
  })
})

describe('a sales campaign is judged on purchases, never on clicks', () => {
  // Found live 2026-10-09: an ad with no purchase yet was reported as
  // "17 link clicks, PKR 23 each, under target" against a PKR 700 purchase target.
  test('the objective decides what counts as a result', async () => {
    const { resultActionsForObjective, PURCHASE_ACTIONS } = await import('../src/meta-ads.ts')
    assert.deepEqual(resultActionsForObjective('OUTCOME_SALES'), PURCHASE_ACTIONS)
    assert.ok(resultActionsForObjective('OUTCOME_LEADS')!.includes('lead'))
    assert.equal(resultActionsForObjective('OUTCOME_TRAFFIC'), undefined)
  })

  test('no purchases yet means zero purchases, not a click count', async () => {
    const { assessPerformance, PURCHASE_ACTIONS } = await import('../src/meta-ads.ts')
    const row = { spend: '390.68', impressions: '1200', frequency: '1.2', inline_link_click_ctr: '1.46', actions: [{ action_type: 'link_click', value: '17' }] }
    const p = assessPerformance(row, { targetCostMinor: 70_000, resultActions: PURCHASE_ACTIONS })
    assert.equal(p.results, 0)
    assert.match(p.resultAction, /purchase/)
    assert.equal(p.costPerResultMinor, undefined)
  })

  test('purchases are counted from the pixel event when present', async () => {
    const { assessPerformance, PURCHASE_ACTIONS } = await import('../src/meta-ads.ts')
    const row = { spend: '2301.30', impressions: '8000', frequency: '1.2', inline_link_click_ctr: '1.19', actions: [{ action_type: 'link_click', value: '99' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' }] }
    const p = assessPerformance(row, { targetCostMinor: 70_000, resultActions: PURCHASE_ACTIONS })
    assert.equal(p.results, 2)
    assert.equal(p.costPerResultMinor, 115_065)
  })
})
