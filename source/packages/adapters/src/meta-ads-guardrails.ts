import { effectiveTexts, type AdIssue, type AdPlan, type Money } from '@social-publisher/core'

/**
 * Meta advertising guardrails.
 *
 * These rules encode advertising judgement, not API shape. Meta will happily
 * accept a campaign that is structurally valid and will still waste money, and
 * most of what follows is about that second kind of problem.
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

/** Older and lower-case names some callers still use. */
const OBJECTIVE_ALIASES: Record<string, string> = {
  sales: 'OUTCOME_SALES',
  conversions: 'OUTCOME_SALES',
  leads: 'OUTCOME_LEADS',
  traffic: 'OUTCOME_TRAFFIC',
  awareness: 'OUTCOME_AWARENESS',
  engagement: 'OUTCOME_ENGAGEMENT',
  app_promotion: 'OUTCOME_APP_PROMOTION',
}

export function normaliseObjective(objective: string): string {
  return OBJECTIVE_ALIASES[objective.toLowerCase()] ?? objective
}

/**
 * The optimisation goal an objective means when the plan names none.
 *
 * The objective is what the business wants to pay for; the goal is what Meta
 * actually hunts for. They must agree. Found live 2026-10-08: a Sales campaign
 * asked for Purchase but named no goal, and creation fell back to LINK_CLICKS,
 * so Meta would have bought clickers for a business that wanted buyers. The owner
 * caught it in Ads Manager before it spent. One function now decides, and both the
 * review and the creation use it, so they cannot disagree again.
 */
export function goalForObjective(objective: string, options: { instantForm: boolean; hasPixel: boolean }): string {
  if (options.instantForm) return 'LEAD_GENERATION'
  switch (normaliseObjective(objective)) {
    case 'OUTCOME_SALES':
    case 'OUTCOME_LEADS':
      return 'OFFSITE_CONVERSIONS'
    case 'OUTCOME_TRAFFIC':
      // Without a pixel Meta cannot count page views, so clicks are all it can see.
      return options.hasPixel ? 'LANDING_PAGE_VIEWS' : 'LINK_CLICKS'
    case 'OUTCOME_AWARENESS':
      return 'REACH'
    case 'OUTCOME_ENGAGEMENT':
      return 'POST_ENGAGEMENT'
    case 'OUTCOME_APP_PROMOTION':
      return 'APP_INSTALLS'
    default:
      return 'LINK_CLICKS'
  }
}

/** The website event an objective means when the plan names none. */
export function eventForObjective(objective: string): string | undefined {
  const o = normaliseObjective(objective)
  if (o === 'OUTCOME_SALES') return 'PURCHASE'
  if (o === 'OUTCOME_LEADS') return 'LEAD'
  return undefined
}

/**
 * The only goals each paid-result objective may use. Anything else optimises
 * for something the business did not ask to pay for.
 */
const GOALS_ALLOWED: Record<string, ReadonlySet<string>> = {
  OUTCOME_SALES: new Set(['OFFSITE_CONVERSIONS', 'VALUE']),
  OUTCOME_LEADS: new Set(['OFFSITE_CONVERSIONS', 'LEAD_GENERATION', 'QUALITY_LEAD']),
}

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

    /**
     * Instant-form leads are captured inside Meta, so the website machinery
     * does not apply: no pixel reports them, no conversion event names them,
     * and no landing page is visited. Treating them like website leads refused
     * every instant-form campaign for missing things it never needs.
     */
    const instantForm = adSet.leadDestination === 'instant_form'

    // Checked as it will be built: the goal and event creation will really use.
    const objective = normaliseObjective(String(plan.campaign.objective))
    const goal =
      adSet.optimizationGoal ?? goalForObjective(objective, { instantForm, hasPixel: context.hasPixel !== false })
    const conversionEvent = adSet.conversionEvent ?? eventForObjective(objective)
    const optimisingForConversions = META_CONVERSION_GOALS.has(goal)

    const allowed = GOALS_ALLOWED[objective]
    if (allowed !== undefined && !allowed.has(goal)) {
      const wants = objective === 'OUTCOME_SALES' ? 'purchases' : 'leads'
      issues.push({
        severity: 'error',
        message:
          `A ${objective === 'OUTCOME_SALES' ? 'Sales' : 'Leads'} campaign must optimise for ${wants}, not "${goal}". ` +
          `Meta finds the people a goal asks for: optimise for clicks and it finds clickers, not ${wants === 'purchases' ? 'buyers' : 'leads'}. ` +
          `Leave optimizationGoal out (it becomes ${objective === 'OUTCOME_SALES' ? 'OFFSITE_CONVERSIONS on Purchase' : 'OFFSITE_CONVERSIONS on Lead, or LEAD_GENERATION for an instant form'}), or set it to one of: ${[...allowed].join(', ')}.`,
        path: `${at}.optimizationGoal`,
      })
    }
    if (objective === 'OUTCOME_SALES' && context.hasPixel === false) {
      issues.push({
        severity: 'error',
        message: 'A Sales campaign needs the website pixel to see purchases, and this ad account has none configured.',
        path: `${at}.conversionEvent`,
      })
    }

    if (instantForm) {
      if (goal !== undefined && goal !== 'LEAD_GENERATION') {
        issues.push({
          severity: 'error',
          message: `Instant-form ads optimise for LEAD_GENERATION, not "${goal}".`,
          path: `${at}.optimizationGoal`,
        })
      }
      ads.forEach((ad, j) => {
        if (ad.leadFormId === undefined || ad.leadFormId.trim() === '') {
          issues.push({
            severity: 'error',
            message: 'An instant-form ad needs the id of the lead form it opens.',
            path: `${at}.ads[${j}].leadFormId`,
          })
        }
      })
    }

    if (optimisingForConversions && !instantForm) {
      if (context.hasPixel === false) {
        issues.push({
          severity: 'error',
          message: `Optimising for "${goal}" needs a pixel, and this ad account has none configured.`,
          path: `${at}.optimizationGoal`,
        })
      }
      if (conversionEvent === undefined) {
        issues.push({
          severity: 'error',
          message: `Optimising for "${goal}" needs a conversion event — Meta cannot optimise toward nothing.`,
          path: `${at}.conversionEvent`,
        })
      } else {
        conversionEvents.add(conversionEvent)
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

    const dynamic = ads.filter(isDynamicCreative)
    if (dynamic.length > 0 && ads.length > 1) {
      issues.push({
        severity: 'error',
        message:
          'An ad with several texts rotates them inside one ad, and Meta allows only ONE such ad per ad set. ' +
          'Put each in its own ad set, or combine their texts into one ad (up to 5 of each).',
        path: `${at}.ads`,
      })
    }

    // An ad that rotates several texts (dynamic creative, or text variations on an image) tests
    // each text as an angle, so count angles rather than ads.
    const rotating = (ad: (typeof ads)[number]) => isDynamicCreative(ad) || usesTextVariations(ad)
    const angles = ads.reduce((n, ad) => n + (rotating(ad) ? Math.max(1, effectiveTexts(ad).bodies.length) : 1), 0)
    if (ads.length > 0 && angles < guards.minAdsPerAdSet) {
      issues.push({
        severity: 'warning',
        message:
          `Only ${angles} angle(s) across ${ads.length} ad(s). Fewer than ${guards.minAdsPerAdSet} is not a real creative test — ` +
          'you learn nothing about which angle works. Add primary texts with different angles, or more ads.',
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
      const texts = effectiveTexts(ad)

      if (texts.headlines.length === 0) {
        issues.push({ severity: 'error', message: 'Meta ads need a headline.', path: `${adAt}.headline` })
      }
      texts.headlines.forEach((headline, k) => {
        if (headline.length > guards.maxHeadlineChars) {
          issues.push({
            severity: 'warning',
            message: `Headline ${k + 1} is ${headline.length} characters; it truncates around ${guards.maxHeadlineChars}.`,
            path: `${adAt}.headlines[${k}]`,
          })
        }
      })

      /**
       * Long copy is not the problem it used to be. Since Meta's 2025 ranking
       * change, longer primary text often performs better, because it gives the
       * algorithm more to understand who the ad is for. What still matters is
       * that the first ~125 characters, all that shows before "See more", carry
       * the hook. So this warns about where the hook is, not about length.
       */
      texts.bodies.forEach((body, k) => {
        if (body.length > guards.maxPrimaryTextChars) {
          issues.push({
            severity: 'warning',
            message:
              `Primary text ${k + 1} is ${body.length} characters. Long copy is fine and often better, but ` +
              `only the first ~${guards.maxPrimaryTextChars} show before "See more" — make sure the hook is there.`,
            path: `${adAt}.bodies[${k}]`,
          })
        }
      })

      if (ad.callToAction !== undefined && !META_CTAS.has(ad.callToAction)) {
        issues.push({
          severity: 'error',
          message: `"${ad.callToAction}" is not a Meta call to action. Valid: ${[...META_CTAS].sort().join(', ')}.`,
          path: `${adAt}.callToAction`,
        })
      }

      if (
        !instantForm &&
        NEEDS_LINK.has(plan.campaign.objective.toUpperCase()) &&
        ad.landingPageUrl === undefined
      ) {
        issues.push({
          severity: 'error',
          message: `Objective "${plan.campaign.objective}" sends people somewhere, so this ad needs a landing page.`,
          path: `${adAt}.landingPageUrl`,
        })
      }

      const videoWithoutThumbnail =
        (ad.creative?.kind === 'video' && ad.creative.thumbnailPath === undefined) ||
        (ad.assets ?? []).some((a) => a.kind === 'video' && a.thumbnailPath === undefined)
      if (videoWithoutThumbnail) {
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

/**
 * Whether an ad is what Meta calls a *dynamic creative*: several texts rotated
 * inside one ad, with one shape.
 *
 * Found on the real ad account on 2026-09-30, and invisible in the sandbox
 * because standalone creatives never hit it: *"Dynamic creative ads can only be
 * created under dynamic creative ad sets."* The ad set has to be marked for it
 * when it is created, and **such an ad set may hold only one ad.**
 *
 * An ad with several texts *and* several shapes is not one: it is split into one
 * ad per text before creation (see `expandForPlacements`), and each of those
 * carries a single text.
 */
export function isDynamicCreative(ad: AdPlan['adSets'][number]['ads'][number]): boolean {
  const texts = effectiveTexts(ad)
  const shapes = new Set((ad.assets ?? []).map((a) => a.aspectRatio))
  // Since 2026-10-11 an IMAGE ad (or one without a file) with several texts is built as Meta's
  // "text variations" (asset_feed_spec optimization_type DEGREES_OF_FREEDOM with link_data),
  // which ordinary ad sets accept, several per ad set (verified live). Only a VIDEO with several
  // texts still needs a dynamic-creative ad set: text variations on video are not yet verified.
  const video = (ad.assets ?? []).some((a) => a.kind === 'video')
  return (
    video &&
    shapes.size < 2 &&
    (texts.bodies.length > 1 || texts.headlines.length > 1 || texts.descriptions.length > 1)
  )
}

/** An image ad (or no file) with several texts and one shape: built as Meta's text variations. */
export function usesTextVariations(ad: AdPlan['adSets'][number]['ads'][number]): boolean {
  const texts = effectiveTexts(ad)
  const assets = ad.assets ?? []
  const shapes = new Set(assets.map((a) => a.aspectRatio))
  return (
    shapes.size < 2 &&
    assets.length <= 1 &&
    !assets.some((a) => a.kind === 'video') &&
    (texts.bodies.length > 1 || texts.headlines.length > 1 || texts.descriptions.length > 1)
  )
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
