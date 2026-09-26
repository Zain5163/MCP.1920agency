import type { AdIssue, AdPlan, Money } from '@social-publisher/core'

/**
 * Meta advertising guardrails.
 *
 * Ported from `..\\..\\Meta-Ads-Publisher`, a Python tool the owner already built
 * and validated offline. Per the roadmap's own decision (5b.0): **connect it,
 * do not rebuild it.** These rules are the valuable part — they encode real
 * advertising judgement rather than API shape, and re-deriving them from scratch
 * would have thrown away the thinking.
 *
 * The distinction that runs through this file:
 *
 * - **Errors** are things the platform will reject, or that are illegal. They
 *   block.
 * - **Warnings** are judgement calls that cost money quietly. They do not block,
 *   but they must be *seen* before spending starts — a guardrail you can ignore
 *   silently is a guardrail that does nothing.
 *
 * Nothing here calls the API. It runs before anything is created, so a bad plan
 * costs nothing to discover.
 */

/** Meta's current objective vocabulary. The older ones were retired in 2023. */
export const META_OBJECTIVES = [
  'OUTCOME_SALES',
  'OUTCOME_LEADS',
  'OUTCOME_TRAFFIC',
  'OUTCOME_AWARENESS',
  'OUTCOME_ENGAGEMENT',
  'OUTCOME_APP_PROMOTION',
] as const

/** Goals that cannot work without a pixel and a conversion event. */
export const META_CONVERSION_GOALS = new Set(['OFFSITE_CONVERSIONS', 'VALUE', 'LEAD_GENERATION'])

export const META_CTAS = new Set([
  'SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'BOOK_TRAVEL', 'DOWNLOAD',
  'GET_OFFER', 'GET_QUOTE', 'CONTACT_US', 'SUBSCRIBE', 'APPLY_NOW',
  'SEE_MENU', 'ORDER_NOW', 'WHATSAPP_MESSAGE', 'MESSAGE_PAGE', 'NO_BUTTON',
])

/** Legally restricted categories. Targeting is constrained by law, not by choice. */
export const META_SPECIAL_CATEGORIES = new Set([
  'HOUSING',
  'EMPLOYMENT',
  'CREDIT',
  'ISSUES_ELECTIONS_POLITICS',
])

/** Objectives where an ad without a destination is pointless. */
const NEEDS_LINK = new Set(['OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_LEADS'])

export interface MetaGuardrails {
  /** Below this, a creative test teaches you nothing. */
  readonly minAdsPerAdSet: number
  /** Above this, Meta starves most ads of impressions. */
  readonly maxAdsPerAdSet: number
  /** Above this, budget fragmentation slows every ad set out of the learning phase. */
  readonly maxAdSetsPerCampaign: number
  /** Meta needs roughly this many conversions per week, per ad set, to stabilise. */
  readonly learningPhaseConversionsPerWeek: number
  /** A realistic target cost per acquisition, in the account's currency. */
  readonly expectedCpa?: Money
  readonly maxPrimaryTextChars: number
  readonly maxHeadlineChars: number
}

/**
 * Defaults carried over unchanged, because each was chosen for a performance
 * reason rather than as a round number.
 */
export const META_DEFAULT_GUARDRAILS: MetaGuardrails = {
  minAdsPerAdSet: 3,
  maxAdsPerAdSet: 6,
  maxAdSetsPerCampaign: 3,
  learningPhaseConversionsPerWeek: 50,
  maxPrimaryTextChars: 125,
  maxHeadlineChars: 40,
}

export interface MetaCheckContext {
  readonly guardrails?: MetaGuardrails
  /** Whether the ad account has a pixel. Conversion goals are useless without one. */
  readonly hasPixel?: boolean
}

/**
 * The daily budget an ad set needs to leave Meta's learning phase.
 *
 * Derived rather than picked: Meta needs about 50 conversions per week per ad
 * set, so the floor is `CPA × conversions ÷ 7`. Deriving it means the number and
 * the reason cannot drift apart — change the CPA and the floor follows.
 *
 * At a 20.00 CPA that is about 142.86/day. Most advertisers run far below it,
 * and it is the single biggest reason small-budget campaigns underperform: below
 * the floor, delivery stays unstable and cost per result is materially worse no
 * matter how good the creative is.
 */
export function learningPhaseFloor(guardrails: MetaGuardrails): Money | undefined {
  const cpa = guardrails.expectedCpa
  if (cpa === undefined || guardrails.learningPhaseConversionsPerWeek <= 0) return undefined

  return {
    minor: Math.round((cpa.minor * guardrails.learningPhaseConversionsPerWeek) / 7),
    currency: cpa.currency,
  }
}

/**
 * Meta-specific checks, run in addition to the platform-neutral ones in core.
 *
 * Returns issues rather than throwing, so a caller can show every problem at once
 * instead of making someone fix them one at a time.
 */
export function checkMetaAdPlan(plan: AdPlan, context: MetaCheckContext = {}): AdIssue[] {
  const guards = context.guardrails ?? META_DEFAULT_GUARDRAILS
  const issues: AdIssue[] = []

  for (const category of plan.campaign.specialCategories ?? []) {
    if (!META_SPECIAL_CATEGORIES.has(category)) {
      issues.push({
        severity: 'error',
        message: `Unknown special ad category "${category}". Valid: ${[...META_SPECIAL_CATEGORIES].sort().join(', ')}.`,
        path: 'campaign.specialCategories',
      })
    }
  }

  if (plan.adSets.length > guards.maxAdSetsPerCampaign) {
    issues.push({
      severity: 'warning',
      message:
        `${plan.adSets.length} ad sets in one campaign, above the guideline of ${guards.maxAdSetsPerCampaign}. ` +
        'Fragmenting budget splits the pixel’s learning and slows every ad set out of the learning phase. ' +
        'Consolidate unless you are deliberately testing audiences against each other.',
      path: 'adSets',
    })
  }

  const floor = learningPhaseFloor(guards)
  const conversionEvents = new Set<string>()

  plan.adSets.forEach((entry, i) => {
    const at = `adSets[${i}]`
    const { adSet, ads } = entry
    const goal = adSet.optimizationGoal
    const optimisingForConversions = goal !== undefined && META_CONVERSION_GOALS.has(goal)

    if (optimisingForConversions) {
      if (context.hasPixel === false) {
        issues.push({
          severity: 'error',
          message: `Optimising for "${goal}" needs a pixel, and this ad account has none configured.`,
          path: `${at}.optimizationGoal`,
        })
      }
      if (adSet.conversionEvent === undefined) {
        issues.push({
          severity: 'error',
          message: `Optimising for "${goal}" needs a conversion event — Meta cannot optimise toward nothing.`,
          path: `${at}.conversionEvent`,
        })
      } else {
        conversionEvents.add(adSet.conversionEvent)
      }

      if ((adSet.audience.interests?.length ?? 0) > 0) {
        issues.push({
          severity: 'warning',
          message:
            `${adSet.audience.interests!.length} interest(s) on a conversion ad set. Broad targeting with strong ` +
            'creative now outperforms interest stacking in most accounts — consider running broad as the control.',
          path: `${at}.audience.interests`,
        })
      }

      // The budget check that matters most, and the one nobody runs.
      const budget = adSet.dailyBudget ?? sharePerAdSet(plan)
      if (floor !== undefined && budget !== undefined && budget.currency === floor.currency) {
        if (budget.minor < floor.minor) {
          const short = (floor.minor / budget.minor).toFixed(1)
          const perWeek = Math.round(
            (budget.minor / (guards.expectedCpa?.minor ?? 1)) * 7,
          )
          issues.push({
            severity: 'warning',
            message:
              `${fmt(budget)}/day at an expected CPA of ${fmt(guards.expectedCpa!)} yields about ${perWeek} ` +
              `conversions/week. Meta needs about ${guards.learningPhaseConversionsPerWeek}/week per ad set to ` +
              `exit the learning phase, so ${fmt(floor)}/day is the real floor — this is ${short}x short. Below it, ` +
              'delivery stays unstable and cost per result is materially worse however good the creative is.',
            path: `${at}.dailyBudget`,
          })
        }
      }
    }

    if (ads.length > 0 && ads.length < guards.minAdsPerAdSet) {
      issues.push({
        severity: 'warning',
        message:
          `Only ${ads.length} ad(s). Fewer than ${guards.minAdsPerAdSet} is not a real creative test — ` +
          'you learn nothing about which angle works.',
        path: `${at}.ads`,
      })
    }
    if (ads.length > guards.maxAdsPerAdSet) {
      issues.push({
        severity: 'warning',
        message:
          `${ads.length} ads. Above ${guards.maxAdsPerAdSet}, Meta starves most of them of impressions and ` +
          'no ad gets enough data to judge.',
        path: `${at}.ads`,
      })
    }

    ads.forEach((ad, j) => {
      const adAt = `${at}.ads[${j}]`

      if (ad.headline === undefined || ad.headline.trim() === '') {
        issues.push({ severity: 'error', message: 'Meta ads need a headline.', path: `${adAt}.headline` })
      } else if (ad.headline.length > guards.maxHeadlineChars) {
        issues.push({
          severity: 'warning',
          message: `Headline is ${ad.headline.length} characters; it truncates around ${guards.maxHeadlineChars}.`,
          path: `${adAt}.headline`,
        })
      }

      if (ad.body.length > guards.maxPrimaryTextChars) {
        issues.push({
          severity: 'warning',
          message:
            `Primary text is ${ad.body.length} characters. Meta truncates around ` +
            `${guards.maxPrimaryTextChars} behind "See more", so put the hook in the first ` +
            `${guards.maxPrimaryTextChars}.`,
          path: `${adAt}.body`,
        })
      }

      if (ad.callToAction !== undefined && !META_CTAS.has(ad.callToAction)) {
        issues.push({
          severity: 'error',
          message: `"${ad.callToAction}" is not a Meta call to action. Valid: ${[...META_CTAS].sort().join(', ')}.`,
          path: `${adAt}.callToAction`,
        })
      }

      if (NEEDS_LINK.has(plan.campaign.objective.toUpperCase()) && ad.landingPageUrl === undefined) {
        issues.push({
          severity: 'error',
          message: `Objective "${plan.campaign.objective}" sends people somewhere, so this ad needs a landing page.`,
          path: `${adAt}.landingPageUrl`,
        })
      }

      if (ad.creative?.kind === 'video' && ad.creative.thumbnailPath === undefined) {
        issues.push({
          severity: 'warning',
          message:
            'No thumbnail for a video ad. Meta will auto-pick a frame, which is often a bad one. ' +
            'Supply one for control.',
          path: `${adAt}.creative.thumbnailPath`,
        })
      }

      if (ad.creative?.kind === 'existing_post' && ad.creative.postId === undefined) {
        issues.push({
          severity: 'error',
          message: 'Boosting an existing post needs its post id.',
          path: `${adAt}.creative.postId`,
        })
      }

      // Undefined means the adapter generates UTMs. An explicit empty string
      // means someone turned attribution off deliberately, which is a choice
      // worth surfacing rather than a default worth ignoring.
      if (ad.urlTags === '') {
        issues.push({
          severity: 'warning',
          message:
            'URL tags are explicitly empty, so this ad carries no UTMs and cannot be attributed in ' +
            'GA4 or Shopify.',
          path: `${adAt}.urlTags`,
        })
      }
    })
  })

  if (conversionEvents.size > 1) {
    issues.push({
      severity: 'warning',
      message:
        `This campaign optimises for different conversion events (${[...conversionEvents].sort().join(', ')}). ` +
        'That makes results incomparable and splits the pixel’s signal — use one event per campaign.',
      path: 'adSets',
    })
  }

  return issues
}

/** Each ad set's share of a campaign-level budget, for the learning-phase check. */
function sharePerAdSet(plan: AdPlan): Money | undefined {
  const budget = plan.campaign.dailyBudget
  if (budget === undefined || plan.adSets.length === 0) return undefined
  return { minor: Math.round(budget.minor / plan.adSets.length), currency: budget.currency }
}

function fmt(value: Money): string {
  return `${(value.minor / 100).toFixed(2)} ${value.currency}`
}
