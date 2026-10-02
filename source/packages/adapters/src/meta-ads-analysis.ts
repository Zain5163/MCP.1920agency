/**
 * Reading Meta ad results the way a senior media buyer does.
 *
 * Pure functions over rows Meta's insights API returns: no network, no state.
 * The MCP tools fetch the rows; this decides what they mean. Everything here
 * proposes. Nothing changes an ad, and every proposal that would is a separate,
 * approval-gated tool call.
 *
 * Built 2026-10-02 after the first real campaign showed why it is needed: the
 * owner's traffic test reported a 13.5% click-through rate, which looks
 * excellent, while 97% of its spend went to Audience Network and only 20% of
 * its clicks ever loaded the page. A per-ad summary cannot see that. A placement
 * breakdown, and a comparison of clicks with landing page views, can.
 */

// ------------------------------------------------------------------ results

/**
 * Which reported action counts as "a result" for each optimisation goal.
 *
 * Meta reports dozens of action types per row (the owner's account returned 33
 * in one month). Counting the wrong one makes every cost wrong, so the result is
 * taken from what the ad set was told to optimise for, in this order.
 */
export const RESULT_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  LANDING_PAGE_VIEWS: ['landing_page_view', 'omni_landing_page_view'],
  LINK_CLICKS: ['link_click'],
  CONVERSATIONS: ['onsite_conversion.messaging_conversation_started_7d'],
  LEAD_GENERATION: ['onsite_conversion.lead_grouped', 'lead'],
  QUALITY_LEAD: ['onsite_conversion.lead_grouped', 'lead'],
  VALUE: ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase'],
  PAGE_LIKES: ['like'],
  POST_ENGAGEMENT: ['post_engagement'],
}

/** For OFFSITE_CONVERSIONS the result depends on which event the ad set optimises for. */
const EVENT_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  PURCHASE: ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase'],
  LEAD: ['offsite_conversion.fb_pixel_lead', 'lead'],
  COMPLETE_REGISTRATION: ['offsite_conversion.fb_pixel_complete_registration', 'complete_registration'],
  CONTACT: ['offsite_conversion.fb_pixel_contact', 'contact'],
  SCHEDULE: ['offsite_conversion.fb_pixel_schedule', 'schedule'],
  SUBMIT_APPLICATION: ['offsite_conversion.fb_pixel_submit_application', 'submit_application'],
  START_TRIAL: ['offsite_conversion.fb_pixel_start_trial', 'start_trial'],
  ADD_TO_CART: ['offsite_conversion.fb_pixel_add_to_cart', 'add_to_cart'],
  INITIATED_CHECKOUT: ['offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout'],
}

const PURCHASE_VALUE_ACTIONS = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase']

/**
 * Goals whose clicks are meant to open a web page.
 *
 * Click quality (clicks against landing page views) only means something for
 * these. A click on a WhatsApp or Messenger ad opens a chat, never a page, so
 * counting it made the owner's account look 91% wasted when it was not -- found
 * on the first live audit, 2026-10-02.
 */
export const WEBSITE_GOALS = new Set(['LANDING_PAGE_VIEWS', 'LINK_CLICKS', 'OFFSITE_CONVERSIONS', 'VALUE'])

/** The action types that count as a result, for an ad set's goal and event. */
export function resultActionsFor(goal: string | undefined, customEventType?: string): readonly string[] {
  if (goal === 'OFFSITE_CONVERSIONS') {
    return EVENT_ACTIONS[customEventType ?? ''] ?? [...EVENT_ACTIONS.PURCHASE!, ...EVENT_ACTIONS.LEAD!]
  }
  return RESULT_ACTIONS[goal ?? ''] ?? ['link_click']
}

/** Plain words for an action type, for reports a person reads. */
export function describeAction(action: string): string {
  const known: Record<string, string> = {
    landing_page_view: 'landing page views',
    omni_landing_page_view: 'landing page views',
    link_click: 'link clicks',
    'onsite_conversion.messaging_conversation_started_7d': 'conversations started',
    'onsite_conversion.lead_grouped': 'leads',
    lead: 'leads',
    omni_purchase: 'purchases',
    'offsite_conversion.fb_pixel_purchase': 'purchases',
    purchase: 'purchases',
    'offsite_conversion.fb_pixel_lead': 'website leads',
    like: 'Page likes',
    post_engagement: 'post engagements',
  }
  return known[action] ?? action.replace(/^offsite_conversion\.fb_pixel_/, 'website ').replace(/[._]/g, ' ')
}

// ------------------------------------------------------------------ metrics

export interface Metrics {
  /** Minor units of the account currency. */
  readonly spendMinor: number
  readonly impressions: number
  readonly reach: number
  readonly frequency: number
  readonly linkClicks: number
  readonly landingPageViews: number
  /** Percent. */
  readonly linkCtr: number
  readonly results: number
  readonly resultAction: string
  readonly costPerResultMinor?: number
  /** Purchase value reported by the pixel, minor units. Zero when none. */
  readonly valueMinor: number
  /** Purchase value ÷ spend. Undefined without spend or value. */
  readonly roas?: number
}

type Action = { action_type: string; value: string }
const num = (v: unknown): number => (v === undefined || v === null || v === '' ? 0 : Number(v))
const pick = (list: readonly Action[] | undefined, types: readonly string[]): { type?: string; value: number } => {
  for (const t of types) {
    const hit = list?.find((a) => a.action_type === t)
    if (hit !== undefined) return { type: t, value: num(hit.value) }
  }
  return { value: 0 }
}

/** One insights row, read with the given result definition. */
export function readMetrics(row: Record<string, unknown>, resultActions: readonly string[]): Metrics {
  const actions = row.actions as Action[] | undefined
  const values = row.action_values as Action[] | undefined
  const result = pick(actions, resultActions)
  const spendMinor = Math.round(num(row.spend) * 100)
  const valueMinor = Math.round(pick(values, PURCHASE_VALUE_ACTIONS).value * 100)
  const impressions = num(row.impressions)
  const linkClicks = num(row.inline_link_clicks)
  return {
    spendMinor,
    impressions,
    reach: num(row.reach),
    frequency: num(row.frequency),
    linkClicks,
    landingPageViews: pick(actions, ['landing_page_view', 'omni_landing_page_view']).value,
    linkCtr: row.inline_link_click_ctr !== undefined ? num(row.inline_link_click_ctr) : impressions > 0 ? (linkClicks / impressions) * 100 : 0,
    results: result.value,
    resultAction: result.type ?? resultActions[0] ?? 'link_click',
    ...(result.value > 0 ? { costPerResultMinor: Math.round(spendMinor / result.value) } : {}),
    valueMinor,
    ...(spendMinor > 0 && valueMinor > 0 ? { roas: valueMinor / spendMinor } : {}),
  }
}

/** Adds several rows up. Frequency is recomputed, not averaged. */
export function sumMetrics(rows: readonly Metrics[], resultAction: string): Metrics {
  const s = (f: (m: Metrics) => number) => rows.reduce((t, m) => t + f(m), 0)
  const spendMinor = s((m) => m.spendMinor)
  const impressions = s((m) => m.impressions)
  const reach = s((m) => m.reach)
  const linkClicks = s((m) => m.linkClicks)
  const results = s((m) => m.results)
  const valueMinor = s((m) => m.valueMinor)
  return {
    spendMinor,
    impressions,
    reach,
    frequency: reach > 0 ? impressions / reach : 0,
    linkClicks,
    landingPageViews: s((m) => m.landingPageViews),
    linkCtr: impressions > 0 ? (linkClicks / impressions) * 100 : 0,
    results,
    resultAction,
    ...(results > 0 ? { costPerResultMinor: Math.round(spendMinor / results) } : {}),
    valueMinor,
    ...(spendMinor > 0 && valueMinor > 0 ? { roas: valueMinor / spendMinor } : {}),
  }
}

// ----------------------------------------------------------------- findings

export type Severity = 'critical' | 'warning' | 'opportunity' | 'info'

export interface Finding {
  readonly severity: Severity
  /** Which specialist raised it, for the report. */
  readonly area: 'tracking' | 'placement' | 'audience' | 'creative' | 'budget' | 'structure' | 'delivery'
  readonly message: string
  /** What to do about it, in words. When it maps to a tool, the tool is named. */
  readonly action?: string
}

const pct = (n: number) => `${Math.round(n * 100)}%`

/**
 * Whether clicks turn into people seeing the page.
 *
 * The cheapest trap in Meta advertising: optimise for clicks and Meta finds the
 * people and placements that click most, including accidental taps. Landing page
 * views count only visitors whose page actually loaded.
 */
export function clickQualityFindings(total: Metrics): Finding[] {
  if (total.linkClicks < 100 || total.landingPageViews === 0) return []
  const rate = total.landingPageViews / total.linkClicks
  if (rate >= 0.6) return []
  return [
    {
      severity: rate < 0.35 ? 'critical' : 'warning',
      area: 'tracking',
      message:
        `Only ${pct(rate)} of ${total.linkClicks} link clicks became landing page views. ` +
        'Most clicks are accidental or leave before the page loads, so the click-through rate overstates the result.',
      action:
        'Optimise for landing page views instead of link clicks, and check the placement breakdown for where the empty clicks come from. A slow page causes the same symptom.',
    },
  ]
}

export interface BreakdownRow {
  /** e.g. "audience_network / an_classic" or "25-34 / female". */
  readonly key: string
  readonly metrics: Metrics
}

/**
 * Where the money went by placement, and whether it bought anything.
 *
 * Meta spreads spend across placements by its own prediction of results for the
 * goal it was given. Given a weak goal (clicks) it will happily spend most of the
 * budget where clicks are cheapest, which is often where they are worthless.
 */
export function placementFindings(rows: readonly BreakdownRow[]): Finding[] {
  const out: Finding[] = []
  const total = rows.reduce((t, r) => t + r.metrics.spendMinor, 0)
  if (total === 0) return out
  const totalResults = rows.reduce((t, r) => t + r.metrics.results, 0)

  const an = rows.filter((r) => r.key.startsWith('audience_network'))
  const anSpend = an.reduce((t, r) => t + r.metrics.spendMinor, 0)
  if (anSpend / total >= 0.4) {
    const anClicks = an.reduce((t, r) => t + r.metrics.linkClicks, 0)
    out.push({
      severity: 'critical',
      area: 'placement',
      message:
        `Audience Network took ${pct(anSpend / total)} of the spend` +
        (anClicks > 0 ? `, with ${anClicks} link clicks` : '') +
        '. It is third-party apps and sites; for most traffic and lead campaigns its clicks rarely turn into visits or customers.',
      action:
        'Exclude Audience Network from this ad set (exclude_placements), or switch the goal to landing page views or a conversion and let Meta re-learn.',
    })
  }

  for (const r of rows) {
    const share = r.metrics.spendMinor / total
    if (share < 0.25 || r.key.startsWith('audience_network')) continue
    const resultShare = totalResults > 0 ? r.metrics.results / totalResults : 0
    if (totalResults >= 10 && resultShare < share / 2) {
      out.push({
        severity: 'warning',
        area: 'placement',
        message: `${r.key} took ${pct(share)} of the spend but delivered ${pct(resultShare)} of the results.`,
        action: 'Check the creative fits this placement (shape, safe zones, sound off). Excluding it is the last resort, not the first.',
      })
    }
  }
  return out
}

/**
 * Who is converting, for the copy, not the targeting.
 *
 * Under Meta's current ranking, broad targeting wins and narrowing usually
 * hurts. So an age or gender that converts well is a reason to write the next
 * creative for those people, which steers delivery without restricting it.
 */
export function audienceFindings(rows: readonly BreakdownRow[]): Finding[] {
  const out: Finding[] = []
  const totalSpend = rows.reduce((t, r) => t + r.metrics.spendMinor, 0)
  const totalResults = rows.reduce((t, r) => t + r.metrics.results, 0)
  if (totalSpend === 0 || totalResults < 10) return out
  const avg = totalSpend / totalResults

  const best = [...rows]
    .filter((r) => r.metrics.results >= 3 && r.metrics.costPerResultMinor !== undefined)
    .sort((a, b) => a.metrics.costPerResultMinor! - b.metrics.costPerResultMinor!)[0]
  if (best !== undefined && best.metrics.costPerResultMinor! <= avg * 0.7) {
    out.push({
      severity: 'opportunity',
      area: 'audience',
      message: `${best.key} gets results at ${pct(best.metrics.costPerResultMinor! / avg)} of the average cost.`,
      action: 'Write the next creative for these people by name. Keep targeting broad; the copy does the steering.',
    })
  }
  for (const r of rows) {
    const share = r.metrics.spendMinor / totalSpend
    if (share >= 0.2 && r.metrics.results === 0) {
      out.push({
        severity: 'warning',
        area: 'audience',
        message: `${r.key} took ${pct(share)} of the spend with no results.`,
        action: 'Usually a creative that speaks to the wrong reader. Narrowing the age range switches off audience expansion; prefer new copy.',
      })
    }
  }
  return out
}

export interface AdWindow {
  readonly adId: string
  readonly name: string
  readonly current: Metrics
  readonly previous?: Metrics
}

/**
 * Creative fatigue: the same people seeing the same ad until they stop reacting.
 *
 * Compares two equal windows. A falling click-through rate with rising
 * frequency is fatigue; a rising cost with a steady click-through rate is more
 * often the auction (a season, a competitor) than the ad.
 */
export function fatigueFindings(ads: readonly AdWindow[]): Finding[] {
  const out: Finding[] = []
  for (const ad of ads) {
    const { current: c, previous: p } = ad
    if (p === undefined || p.impressions < 1000 || c.impressions < 1000) continue
    const ctrDrop = p.linkCtr > 0 ? (p.linkCtr - c.linkCtr) / p.linkCtr : 0
    if (ctrDrop >= 0.2 && c.frequency >= 2.5) {
      out.push({
        severity: 'warning',
        area: 'creative',
        message: `"${ad.name}": click-through fell ${pct(ctrDrop)} while frequency reached ${c.frequency.toFixed(1)}. It is wearing out.`,
        action: 'Launch a fresh version of the same idea (new hook, new image) beside it, then pause this one once the new one is delivering.',
      })
    }
    if (
      p.costPerResultMinor !== undefined &&
      c.costPerResultMinor !== undefined &&
      c.results >= 5 &&
      c.costPerResultMinor >= p.costPerResultMinor * 1.3 &&
      ctrDrop < 0.1
    ) {
      out.push({
        severity: 'info',
        area: 'delivery',
        message: `"${ad.name}": cost per result rose ${pct(c.costPerResultMinor / p.costPerResultMinor - 1)} with a steady click-through rate.`,
        action: 'More likely the auction than the ad. Check CPM; do not replace a creative that people still respond to.',
      })
    }
  }
  return out
}

export interface Targets {
  /** Target cost per result, minor units. */
  readonly costPerResultMinor?: number
  /** Target return on ad spend, e.g. 3 for 3×. */
  readonly roas?: number
  /** Gross margin, 0–1. Gives the break-even ROAS when no target is set. */
  readonly margin?: number
}

/** 1 ÷ margin: below this, every sale loses money on the first order. */
export const breakEvenRoas = (margin: number): number => 1 / margin

export interface Decision {
  readonly adId: string
  readonly name: string
  readonly verdict: 'scale' | 'keep' | 'cut' | 'wait'
  readonly reason: string
}

/**
 * The media buyer's call on each ad, from its numbers against the target.
 *
 * Three rules, deliberately conservative:
 *   - nothing is judged before ~3× the target cost is spent on it;
 *   - a cut needs that data and either no results or 1.5× the target cost;
 *   - a scale means +20% on the ad set, then 3–5 days' wait, because larger
 *     jumps restart Meta's learning.
 *
 * With no target the account's own average is the yardstick, and the report
 * says so: "better than average" is not the same as "profitable".
 */
export function judgeAds(ads: readonly AdWindow[], targets: Targets): Decision[] {
  const all = sumMetrics(ads.map((a) => a.current), ads[0]?.current.resultAction ?? 'link_click')
  const target =
    targets.costPerResultMinor ?? (all.costPerResultMinor !== undefined ? all.costPerResultMinor : undefined)
  // A ROAS target is a goal with tolerance either side. Break-even from the
  // margin is a floor: under it every sale loses money, so there is no "near".
  const breakEven = targets.roas === undefined && targets.margin !== undefined ? breakEvenRoas(targets.margin) : undefined
  const roasTarget = targets.roas ?? breakEven

  // With no target, the yardstick is the other ads. One ad alone has nothing to
  // be compared with, and "100% of the average" would be a verdict on itself.
  const alone = targets.costPerResultMinor === undefined && roasTarget === undefined && ads.length < 2

  return ads.map((ad) => {
    const m = ad.current
    const base = { adId: ad.adId, name: ad.name }
    if (alone) {
      return { ...base, verdict: 'wait', reason: 'No target given, and a single ad has nothing to be compared with. Give a target cost per result or ROAS.' }
    }
    if (roasTarget !== undefined && m.spendMinor > 0 && m.valueMinor > 0) {
      if (m.results < 5) return { ...base, verdict: 'wait', reason: `ROAS ${m.roas!.toFixed(2)}× on ${m.results} purchase(s): too few to trust.` }
      const r = m.roas!.toFixed(2)
      const t = roasTarget.toFixed(2)
      if (breakEven !== undefined) {
        if (m.roas! < breakEven) return { ...base, verdict: 'cut', reason: `ROAS ${r}×, below the ${t}× break-even: each sale loses money on the first order.` }
        if (m.roas! >= breakEven * 1.5) return { ...base, verdict: 'scale', reason: `ROAS ${r}×, well clear of the ${t}× break-even.` }
        return { ...base, verdict: 'keep', reason: `ROAS ${r}×, above the ${t}× break-even but with a thin margin.` }
      }
      if (m.roas! >= roasTarget * 1.2) return { ...base, verdict: 'scale', reason: `ROAS ${r}× against a ${t}× target.` }
      if (m.roas! < roasTarget * 0.8) return { ...base, verdict: 'cut', reason: `ROAS ${r}×, below the ${t}× target with enough purchases to judge.` }
      return { ...base, verdict: 'keep', reason: `ROAS ${r}×, near the ${t}× target.` }
    }
    const yard = targets.costPerResultMinor !== undefined ? 'target' : 'account average'
    if (target === undefined) {
      return { ...base, verdict: 'wait', reason: 'No results anywhere yet, so there is nothing to compare against.' }
    }
    if (m.spendMinor < target * 3) {
      return { ...base, verdict: 'wait', reason: `Spent ${(m.spendMinor / target).toFixed(1)}× the ${yard} cost; about 3× is needed to judge.` }
    }
    if (m.results === 0) return { ...base, verdict: 'cut', reason: `Three times the ${yard} cost spent with no results.` }
    const ratio = m.costPerResultMinor! / target
    if (ratio >= 1.5) return { ...base, verdict: 'cut', reason: `Cost per result ${ratio.toFixed(1)}× the ${yard}, with enough data.` }
    if (ratio <= 0.8) return { ...base, verdict: 'scale', reason: `Cost per result ${pct(ratio)} of the ${yard}, with enough data.` }
    return { ...base, verdict: 'keep', reason: `Cost per result ${pct(ratio)} of the ${yard}.` }
  })
}

// -------------------------------------------------------------------- audit

export interface AuditAdSet {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly optimizationGoal?: string
  readonly dailyBudgetMinor?: number
  readonly activeAds: number
  readonly dynamicCreative: boolean
  /** Meta's own learning status: LEARNING, SUCCESS (exited) or FAIL (limited). */
  readonly learningStatus?: string
}

export interface AuditInput {
  readonly adSets: readonly AuditAdSet[]
  readonly rejectedAds: ReadonlyArray<{ id: string; name: string; status: string }>
  readonly total: Metrics
  /** Only the ad sets meant to send people to a website, for click quality. */
  readonly websiteTotal?: Metrics
  readonly placements: readonly BreakdownRow[]
  /** Expected cost per result, minor units, for the learning-budget check. */
  readonly targetCostMinor?: number
}

/**
 * The account auditor: structural problems that cost money whatever the ads say.
 */
export function auditAccount(input: AuditInput): Finding[] {
  const out: Finding[] = []

  if (input.rejectedAds.length > 0) {
    out.push({
      severity: 'critical',
      area: 'delivery',
      message: `${input.rejectedAds.length} ad(s) rejected or with issues: ${input.rejectedAds.slice(0, 5).map((a) => `"${a.name}" (${a.status.toLowerCase()})`).join(', ')}.`,
      action: 'Read the rejection reason with get_campaign_status; fix the ad or request a review. A rejected ad is not running.',
    })
  }

  const active = input.adSets.filter((a) => a.status === 'ACTIVE')
  const clicks = active.filter((a) => a.optimizationGoal === 'LINK_CLICKS')
  if (clicks.length > 0) {
    out.push({
      severity: 'warning',
      area: 'tracking',
      message: `${clicks.length} active ad set(s) optimise for link clicks: ${clicks.map((a) => `"${a.name}"`).join(', ')}.`,
      action: 'Clicks are the easiest result to buy and the least useful. Use landing page views for traffic, or a conversion event if the pixel records one.',
    })
  }

  const limited = active.filter((a) => a.learningStatus === 'FAIL')
  if (limited.length > 0) {
    out.push({
      severity: 'warning',
      area: 'budget',
      message: `${limited.length} ad set(s) are "learning limited": ${limited.map((a) => `"${a.name}"`).join(', ')}. Meta cannot find ~50 results a week for them.`,
      action: 'Combine ad sets, raise the budget, or optimise for a more frequent event. Do not keep editing them.',
    })
  }

  if (input.targetCostMinor !== undefined) {
    const floor = Math.round((input.targetCostMinor * 50) / 7)
    const small = active.filter((a) => a.dailyBudgetMinor !== undefined && a.dailyBudgetMinor < floor)
    if (small.length >= 2) {
      out.push({
        severity: 'opportunity',
        area: 'structure',
        message: `${small.length} active ad sets each run below the learning budget (about ${(floor / 100).toFixed(0)} a day at this cost per result).`,
        action: 'Fewer ad sets with more budget each learn faster. Consider merging them into one, with the ads side by side.',
      })
    }
  } else if (active.length >= 4) {
    out.push({
      severity: 'info',
      area: 'structure',
      message: `${active.length} active ad sets. Many small ad sets split the data Meta learns from.`,
      action: 'Give a target cost per result to check them against the learning budget.',
    })
  }

  for (const a of active) {
    if (a.dynamicCreative || a.activeAds === 0) continue
    if (a.activeAds < 3) {
      out.push({
        severity: 'opportunity',
        area: 'creative',
        message: `"${a.name}" runs ${a.activeAds} ad(s). Fewer than 3 is not a creative test.`,
        action: 'Add 2–4 genuinely different angles beside it.',
      })
    } else if (a.activeAds > 6) {
      out.push({
        severity: 'info',
        area: 'creative',
        message: `"${a.name}" runs ${a.activeAds} ads; past about 6, most get too little delivery to learn from.`,
        action: 'Pause the ones with least delivery after a week.',
      })
    }
  }

  out.push(...clickQualityFindings(input.websiteTotal ?? input.total))
  out.push(...placementFindings(input.placements))

  if (input.total.spendMinor > 0 && input.total.results === 0) {
    out.push({
      severity: 'critical',
      area: 'tracking',
      message: 'Money was spent in this period with no results recorded for the goal at all.',
      action: 'Check the pixel is firing the event (check_ad_setup) before judging any ad. No results is often no tracking.',
    })
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}
