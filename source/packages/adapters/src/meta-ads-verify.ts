import type { AdPlan } from '@social-publisher/core'

import { eventForObjective, normaliseObjective } from './meta-ads-guardrails.ts'

/**
 * Read-back verification: what Meta actually stored, compared with what was
 * asked for and with rules that must always hold.
 *
 * Why it exists. On 2026-10-08 a Sales campaign was created optimising for link
 * clicks. The plan was reviewed, the approval summary said "Sales", and creation
 * succeeded, yet Meta held a different goal from the one requested. The owner
 * found it in Ads Manager. A review checks the request; only reading the result
 * back checks the outcome. The owner's rule since then: check every setting two or
 * three times before anything goes live, for every platform and every user. So
 * this runs after creation, and again before activation, which it can block.
 */

export interface MetaVerifyAccount {
  readonly pageId: string
  readonly instagramId?: string
  readonly pixelId?: string
}

/** What Meta returned, as read by MetaAdsClient.verify. */
export interface CampaignSnapshot {
  readonly campaign: Record<string, unknown>
  readonly adSets: ReadonlyArray<Record<string, unknown>>
  readonly ads: ReadonlyArray<Record<string, unknown>>
  /** Landing page → HTTP status (0 when it could not be reached). */
  readonly links?: Readonly<Record<string, number>>
}

export interface VerifyCheck {
  readonly ok: boolean
  /** A failed check blocks activation; a warning is shown but does not. */
  readonly severity: 'error' | 'warning'
  readonly what: string
  readonly detail: string
}

const SALES_GOALS = new Set(['OFFSITE_CONVERSIONS', 'VALUE'])
const LEAD_GOALS = new Set(['OFFSITE_CONVERSIONS', 'LEAD_GENERATION', 'QUALITY_LEAD'])
const BAD_AD_STATES = new Set(['DISAPPROVED', 'WITH_ISSUES'])

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v))
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
const sortJoin = (xs: readonly string[]) => [...xs].sort().join(',')

/** Every landing URL an ad's creative sends people to. */
export function adLinks(ad: Record<string, unknown>): string[] {
  const creative = obj(ad.creative)
  const story = obj(creative.object_story_spec)
  const feed = obj(creative.asset_feed_spec)
  const links: string[] = []
  const link = str(obj(story.link_data).link)
  if (link !== '') links.push(link)
  const videoLink = str(obj(obj(obj(story.video_data).call_to_action).value).link)
  if (videoLink !== '') links.push(videoLink)
  for (const u of (feed.link_urls as Array<Record<string, unknown>> | undefined) ?? []) {
    const w = str(u.website_url)
    if (w !== '') links.push(w)
  }
  return [...new Set(links)]
}

export function verifyCampaignSnapshot(
  snap: CampaignSnapshot,
  account: MetaVerifyAccount,
  expected?: AdPlan,
): VerifyCheck[] {
  const checks: VerifyCheck[] = []
  const add = (ok: boolean, what: string, detail: string, severity: 'error' | 'warning' = 'error') =>
    checks.push({ ok, severity, what, detail })

  const objective = normaliseObjective(str(snap.campaign.objective))

  // 1. The campaign is the kind of campaign that was asked for.
  if (expected !== undefined) {
    const want = normaliseObjective(String(expected.campaign.objective))
    add(objective === want, 'Objective', objective === want ? objective : `Meta has ${objective}, asked for ${want}`)
  } else {
    add(objective !== '', 'Objective', objective || 'Meta returned no objective')
  }

  // 2. Every ad set hunts for what the objective pays for.
  const expectedSets = expected?.adSets ?? []
  snap.adSets.forEach((set, i) => {
    const name = str(set.name) || `ad set ${i + 1}`
    const goal = str(set.optimization_goal)
    const promoted = obj(set.promoted_object)
    const event = str(promoted.custom_event_type)

    if (objective === 'OUTCOME_SALES') {
      add(SALES_GOALS.has(goal), `Optimisation goal: ${name}`,
        SALES_GOALS.has(goal) ? `${goal} (purchases)` : `${goal}: a Sales campaign must optimise for purchases, not this`)
    } else if (objective === 'OUTCOME_LEADS') {
      add(LEAD_GOALS.has(goal), `Optimisation goal: ${name}`,
        LEAD_GOALS.has(goal) ? `${goal} (leads)` : `${goal}: a Leads campaign must optimise for leads, not this`)
    } else if (objective === 'OUTCOME_TRAFFIC' && account.pixelId !== undefined) {
      add(goal === 'LANDING_PAGE_VIEWS', `Optimisation goal: ${name}`,
        goal === 'LANDING_PAGE_VIEWS' ? goal : `${goal}: with a pixel, Traffic should optimise for landing page views`, 'warning')
    } else {
      add(goal !== '', `Optimisation goal: ${name}`, goal || 'none returned', 'warning')
    }

    // 3. Website results are counted by the right pixel and event.
    const instantForm = str(set.destination_type) === 'ON_AD'
    if ((objective === 'OUTCOME_SALES' || objective === 'OUTCOME_LEADS') && !instantForm) {
      const pixelOk = account.pixelId !== undefined && str(promoted.pixel_id) === account.pixelId
      add(pixelOk, `Pixel: ${name}`, pixelOk ? str(promoted.pixel_id) : `ad set uses pixel "${str(promoted.pixel_id)}", account pixel is "${account.pixelId ?? 'none'}"`)
      const wantEvent = expectedSets[i]?.adSet.conversionEvent ?? eventForObjective(objective)
      const eventOk = wantEvent === undefined || event === wantEvent
      add(eventOk, `Conversion event: ${name}`, eventOk ? event : `Meta has "${event}", asked for "${wantEvent}"`)
    }

    // 4. Money, place and people match the request.
    const want = expectedSets.length === snap.adSets.length ? expectedSets[i] : undefined
    if (want !== undefined) {
      const wantBudget = want.adSet.dailyBudget?.minor
      if (wantBudget !== undefined) {
        const got = Number(set.daily_budget ?? NaN)
        add(got === wantBudget, `Daily budget: ${name}`, got === wantBudget ? String(got / 100) : `Meta has ${got / 100}, asked for ${wantBudget / 100}`)
      }
      const targeting = obj(set.targeting)
      const countries = ((obj(targeting.geo_locations).countries as string[] | undefined) ?? []).map(String)
      const wantCountries = want.adSet.audience.countries
      add(sortJoin(countries) === sortJoin(wantCountries), `Countries: ${name}`,
        sortJoin(countries) === sortJoin(wantCountries) ? countries.join(', ') : `Meta has ${countries.join(', ') || 'none'}, asked for ${wantCountries.join(', ')}`)
    }
  })

  if (expected !== undefined) {
    add(snap.adSets.length === expected.adSets.length, 'Ad sets', `${snap.adSets.length} created, ${expected.adSets.length} asked for`)
    const wantAds = expected.adSets.reduce((n, s) => n + s.ads.length, 0)
    add(snap.ads.length === wantAds, 'Ads', `${snap.ads.length} created, ${wantAds} asked for`)
  } else {
    add(snap.ads.length > 0, 'Ads', `${snap.ads.length} ad(s)`)
  }

  // 5. Every ad: right Page and Instagram, a real destination, tracked, not rejected.
  const wantLinks = new Set(
    (expected?.adSets ?? []).flatMap((s) => s.ads.map((a) => a.landingPageUrl).filter((u): u is string => u !== undefined)),
  )
  snap.ads.forEach((ad, i) => {
    const name = str(ad.name) || `ad ${i + 1}`
    const story = obj(obj(ad.creative).object_story_spec)
    const page = str(story.page_id)
    add(page === account.pageId, `Page: ${name}`, page === account.pageId ? page : `ad posts as Page "${page}", account Page is "${account.pageId}"`)
    if (account.instagramId !== undefined) {
      const ig = str(story.instagram_user_id || story.instagram_actor_id)
      add(ig === account.instagramId, `Instagram: ${name}`, ig === account.instagramId ? ig : `ad uses Instagram "${ig || 'none'}", account Instagram is "${account.instagramId}"`)
    }

    const links = adLinks(ad)
    const instantForm = links.length === 0 && objective === 'OUTCOME_LEADS'
    if (!instantForm && objective !== 'OUTCOME_AWARENESS' && objective !== 'OUTCOME_ENGAGEMENT') {
      add(links.length > 0, `Landing page: ${name}`, links.length > 0 ? links.join(', ') : 'no destination URL on the ad')
      for (const link of links) {
        if (wantLinks.size > 0 && !wantLinks.has(link)) add(false, `Landing page: ${name}`, `${link} was not in the plan`)
        if (!link.startsWith('https://')) add(false, `Landing page: ${name}`, `${link} is not https`)
        const status = snap.links?.[link]
        if (status !== undefined) {
          add(status > 0 && status < 400, `Page loads: ${link}`, status > 0 ? `HTTP ${status}` : 'could not be reached')
        }
      }
    }

    if (account.pixelId !== undefined) {
      const specs = (ad.tracking_specs as Array<Record<string, unknown>> | undefined) ?? []
      const tracked = specs.some((s) => ((s.fb_pixel as unknown[] | undefined) ?? []).map(String).includes(account.pixelId!))
      add(tracked, `Website tracking: ${name}`, tracked ? `pixel ${account.pixelId}` : 'the ad does not report website events to the pixel', 'warning')
    }

    const state = str(ad.effective_status)
    add(!BAD_AD_STATES.has(state), `Meta review: ${name}`, BAD_AD_STATES.has(state) ? `${state}: it will not run` : state || 'unknown')
  })

  return checks
}

/** Plain report for a person: failures first, then warnings, then a count. */
export function formatVerification(checks: readonly VerifyCheck[]): string {
  const failed = checks.filter((c) => !c.ok && c.severity === 'error')
  const warned = checks.filter((c) => !c.ok && c.severity === 'warning')
  const passed = checks.filter((c) => c.ok)
  return [
    failed.length === 0
      ? `Verified against Meta: ${passed.length} check(s) passed${warned.length > 0 ? `, ${warned.length} warning(s)` : ''}.`
      : `NOT READY: ${failed.length} check(s) failed. Do not activate until fixed.`,
    ...failed.map((c) => `  ✗ ${c.what}: ${c.detail}`),
    ...warned.map((c) => `  ! ${c.what}: ${c.detail}`),
    ...passed.map((c) => `  ✓ ${c.what}: ${c.detail}`),
  ].join('\n')
}

export function verificationPassed(checks: readonly VerifyCheck[]): boolean {
  return !checks.some((c) => !c.ok && c.severity === 'error')
}

