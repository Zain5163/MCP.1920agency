import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { money, type AdPlan } from '@social-publisher/core'

import { formatVerification, verificationPassed, verifyCampaignSnapshot, type CampaignSnapshot } from '../src/meta-ads-verify.ts'

const account = { pageId: '778648892002721', instagramId: '17841476929259542', pixelId: '1407317194096683' }
const URL_A = 'https://shop.example/collections/boots'

const plan: AdPlan = {
  campaign: { name: 'Boots', objective: 'OUTCOME_SALES' as never, budgetLevel: 'adset' },
  adSets: [
    {
      adSet: { name: 'Broad', dailyBudget: money(500_000, 'PKR'), audience: { countries: ['PK'] }, conversionEvent: 'PURCHASE' },
      ads: [{ name: 'a1', body: 'x', landingPageUrl: URL_A }],
    },
  ],
} as AdPlan

/** As Meta stored the real campaign on 2026-10-08, after the fix. */
function good(): CampaignSnapshot {
  return {
    campaign: { objective: 'OUTCOME_SALES', status: 'PAUSED' },
    adSets: [
      {
        name: 'Broad',
        optimization_goal: 'OFFSITE_CONVERSIONS',
        destination_type: 'WEBSITE',
        promoted_object: { pixel_id: account.pixelId, custom_event_type: 'PURCHASE' },
        daily_budget: '500000',
        targeting: { geo_locations: { countries: ['PK'] }, age_min: 18, age_max: 65 },
      },
    ],
    ads: [
      {
        name: 'a1',
        effective_status: 'PAUSED',
        tracking_specs: [{ 'action.type': ['offsite_conversion'], fb_pixel: [account.pixelId] }],
        creative: {
          object_story_spec: { page_id: account.pageId, instagram_user_id: account.instagramId },
          asset_feed_spec: { link_urls: [{ website_url: URL_A }] },
        },
      },
    ],
    links: { [URL_A]: 200 },
  }
}

const failed = (snap: CampaignSnapshot, expected: AdPlan | undefined = plan) =>
  verifyCampaignSnapshot(snap, account, expected).filter((c) => !c.ok && c.severity === 'error')

describe('read-back verification', () => {
  test('a campaign built as asked passes', () => {
    const checks = verifyCampaignSnapshot(good(), account, plan)
    assert.ok(verificationPassed(checks), formatVerification(checks))
  })

  /**
   * The real failure, 2026-10-08: Sales objective, Purchase event, and the ad
   * set held LINK_CLICKS. Review and creation both "succeeded".
   */
  test('a Sales campaign optimising for link clicks fails', () => {
    const snap = good()
    const bad = { ...snap, adSets: [{ ...snap.adSets[0]!, optimization_goal: 'LINK_CLICKS' }] }
    const f = failed(bad)
    assert.ok(f.some((c) => /must optimise for purchases/.test(c.detail)), formatVerification(f))
    assert.match(formatVerification(verifyCampaignSnapshot(bad, account, plan)), /NOT READY/)
  })

  test('the goal rule holds even when there is no plan to compare with', () => {
    const snap = good()
    const bad = { ...snap, adSets: [{ ...snap.adSets[0]!, optimization_goal: 'LINK_CLICKS' }] }
    assert.ok(failed(bad, undefined).some((c) => /must optimise for purchases/.test(c.detail)))
  })

  test('a different objective from the one asked for fails', () => {
    const snap = good()
    assert.ok(failed({ ...snap, campaign: { objective: 'OUTCOME_TRAFFIC' } }).some((c) => c.what === 'Objective'))
  })

  test('the wrong pixel or event fails', () => {
    const snap = good()
    const wrongPixel = { ...snap, adSets: [{ ...snap.adSets[0]!, promoted_object: { pixel_id: '999', custom_event_type: 'PURCHASE' } }] }
    assert.ok(failed(wrongPixel).some((c) => c.what.startsWith('Pixel')))
    const wrongEvent = { ...snap, adSets: [{ ...snap.adSets[0]!, promoted_object: { pixel_id: account.pixelId, custom_event_type: 'ADD_TO_CART' } }] }
    assert.ok(failed(wrongEvent).some((c) => c.what.startsWith('Conversion event')))
  })

  test('a budget or country different from the plan fails', () => {
    const snap = good()
    assert.ok(failed({ ...snap, adSets: [{ ...snap.adSets[0]!, daily_budget: '5000000' }] }).some((c) => c.what.startsWith('Daily budget')))
    assert.ok(
      failed({ ...snap, adSets: [{ ...snap.adSets[0]!, targeting: { geo_locations: { countries: ['IN'] } } }] }).some((c) =>
        c.what.startsWith('Countries'),
      ),
    )
  })

  test('an ad on the wrong Page or Instagram account fails', () => {
    const snap = good()
    const ad = snap.ads[0]!
    const wrongPage = { ...snap, ads: [{ ...ad, creative: { ...(ad.creative as object), object_story_spec: { page_id: '1', instagram_user_id: account.instagramId } } }] }
    assert.ok(failed(wrongPage).some((c) => c.what.startsWith('Page')))
    const noIg = { ...snap, ads: [{ ...ad, creative: { ...(ad.creative as object), object_story_spec: { page_id: account.pageId } } }] }
    assert.ok(failed(noIg).some((c) => c.what.startsWith('Instagram')))
  })

  test('a landing page that does not load, or is not in the plan, fails', () => {
    const snap = good()
    assert.ok(failed({ ...snap, links: { [URL_A]: 404 } }).some((c) => c.what.startsWith('Page loads')))
    assert.ok(failed({ ...snap, links: { [URL_A]: 0 } }).some((c) => c.what.startsWith('Page loads')))
    const ad = snap.ads[0]!
    const other = { ...snap, ads: [{ ...ad, creative: { ...(ad.creative as object), asset_feed_spec: { link_urls: [{ website_url: 'https://elsewhere.example/' }] } } }] }
    assert.ok(failed(other).some((c) => /not in the plan/.test(c.detail)))
  })

  test('a rejected ad fails, and a missing ad is counted', () => {
    const snap = good()
    assert.ok(failed({ ...snap, ads: [{ ...snap.ads[0]!, effective_status: 'DISAPPROVED' }] }).some((c) => c.what.startsWith('Meta review')))
    assert.ok(failed({ ...snap, ads: [] }).some((c) => c.what === 'Ads'))
  })

  test('the report puts failures first, in plain words', () => {
    const snap = good()
    const text = formatVerification(verifyCampaignSnapshot({ ...snap, links: { [URL_A]: 500 } }, account, plan))
    assert.match(text.split('\n')[0]!, /NOT READY: 1 check\(s\) failed/)
    assert.match(text.split('\n')[1]!, /✗ Page loads/)
  })
})
