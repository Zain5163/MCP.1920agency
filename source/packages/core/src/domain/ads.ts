import type { Platform } from './types.ts'

/**
 * The advertising domain — deliberately separate from publishing.
 *
 * See `decisions/0003-ads-domain-model.md`. The short version:
 *
 * **"Campaign" means different things on different platforms.** LinkedIn's
 * "Campaign" is Meta's "Ad Set", not Meta's "Campaign". Reading both sets of docs
 * in the same week makes that easy to conflate, and the failure is putting a
 * budget on the wrong object — which either does nothing or spends at the wrong
 * level. So this file uses our own names and each adapter translates:
 *
 * | Here      | Meta     | LinkedIn          | Holds                      |
 * |-----------|----------|-------------------|----------------------------|
 * | Campaign  | Campaign | Ad Campaign Group | objective                  |
 * | AdSet     | Ad Set   | Ad Campaign       | budget, schedule, audience |
 * | Ad        | Ad       | Creative          | the creative               |
 *
 * Nothing here spends money on its own. Everything is created paused, and
 * activation is a separate action that goes through the policy layer.
 */

/** What an advertiser is trying to achieve. Platforms name these differently. */
export const AD_OBJECTIVES = [
  'awareness',
  'traffic',
  'engagement',
  'leads',
  'conversions',
  'video_views',
  'app_installs',
] as const

export type AdObjective = (typeof AD_OBJECTIVES)[number]

/**
 * Lifecycle state.
 *
 * `draft` and `paused` are distinct on purpose: a draft has never run, a paused
 * object may have spent money already. Treating them the same would lose the
 * difference between "safe to delete" and "check what it cost first".
 */
export const AD_STATES = ['draft', 'paused', 'active', 'completed', 'archived'] as const

export type AdState = (typeof AD_STATES)[number]

/**
 * An amount of money.
 *
 * Integer minor units (cents), never a float: `0.1 + 0.2 !== 0.3`, and budgets
 * are exactly where that matters. The currency travels with the amount so a bare
 * number can never be mistaken for one in another currency.
 */
export interface Money {
  readonly minor: number
  /** ISO 4217, e.g. 'USD', 'PKR'. */
  readonly currency: string
}

export function money(minor: number, currency: string): Money {
  if (!Number.isInteger(minor)) {
    // Catching this here beats discovering it as a rounding error in a budget.
    throw new RangeError(
      `Money must be whole minor units, got ${minor}. Use 1050 for 10.50, not 10.5.`,
    )
  }
  return { minor, currency }
}

export function formatMoney(value: Money): string {
  return `${(value.minor / 100).toFixed(2)} ${value.currency}`
}

/** A LinkedIn/Meta ad account a tenant can spend from. */
export interface AdAccount {
  readonly id: string
  readonly tenantId: string
  readonly platform: Platform
  /** The platform's own id for the account. */
  readonly platformAccountId: string
  readonly name: string
  readonly currency: string
}

/** Who to show the ads to. Deliberately thin until two platforms are implemented. */
export interface Audience {
  /** ISO 3166 country codes. */
  readonly countries: readonly string[]
  readonly languages?: readonly string[]
  /**
   * Platform-native targeting, passed through untranslated.
   *
   * An escape hatch, and a documented one: LinkedIn's job-title and seniority
   * targeting has no Meta equivalent, and inventing a common abstraction for
   * things that genuinely differ would produce a model that fits neither. What
   * goes in here is the adapter's business.
   */
  readonly platformTargeting?: Readonly<Record<string, unknown>>
}

/** The top level. Holds the objective and nothing that spends. */
export interface CampaignDraft {
  readonly name: string
  readonly objective: AdObjective
}

/** Where the money lives. */
export interface AdSetDraft {
  readonly name: string
  readonly dailyBudget: Money
  readonly audience: Audience
  readonly startAt?: Date
  readonly endAt?: Date
}

/** One creative. */
export interface AdDraft {
  readonly name: string
  readonly body: string
  readonly headline?: string
  readonly landingPageUrl?: string
  /** Media already uploaded to the platform, by its platform id. */
  readonly mediaIds?: readonly string[]
}

/** A whole request: one campaign, its ad sets, and their ads. */
export interface AdPlan {
  readonly campaign: CampaignDraft
  readonly adSets: ReadonlyArray<{
    readonly adSet: AdSetDraft
    readonly ads: readonly AdDraft[]
  }>
}

export interface AdIssue {
  readonly severity: 'error' | 'warning'
  readonly message: string
  /** Where the problem is, for pointing at it in a UI. */
  readonly path: string
}

export type AdValidation =
  | { readonly ok: true; readonly issues: readonly AdIssue[] }
  | { readonly ok: false; readonly issues: readonly AdIssue[] }

/**
 * Checks a plan for problems that would waste money or fail at the platform.
 *
 * Runs before anything is sent. Platform-specific limits are checked by the
 * adapter on top of this; these are the rules that hold everywhere.
 */
export function validateAdPlan(plan: AdPlan): AdValidation {
  const issues: AdIssue[] = []

  if (plan.campaign.name.trim() === '') {
    issues.push({ severity: 'error', message: 'The campaign needs a name.', path: 'campaign.name' })
  }
  if (plan.adSets.length === 0) {
    issues.push({
      severity: 'error',
      message: 'A campaign with no ad sets cannot run and cannot be fixed later without rebuilding it.',
      path: 'adSets',
    })
  }

  const currencies = new Set<string>()

  plan.adSets.forEach((entry, i) => {
    const at = `adSets[${i}]`
    const { adSet, ads } = entry

    if (adSet.name.trim() === '') {
      issues.push({ severity: 'error', message: 'The ad set needs a name.', path: `${at}.name` })
    }

    currencies.add(adSet.dailyBudget.currency)

    if (adSet.dailyBudget.minor <= 0) {
      issues.push({
        severity: 'error',
        message: 'A daily budget must be greater than zero.',
        path: `${at}.dailyBudget`,
      })
    }

    if (adSet.audience.countries.length === 0) {
      // Not a platform rule everywhere, but an untargeted ad set spends money on
      // an audience nobody chose, which is worse than an error.
      issues.push({
        severity: 'error',
        message: 'Targeting no country at all means the platform decides who sees this. Choose at least one.',
        path: `${at}.audience.countries`,
      })
    }

    if (adSet.startAt !== undefined && adSet.endAt !== undefined && adSet.endAt <= adSet.startAt) {
      issues.push({
        severity: 'error',
        message: 'The end date is on or before the start date, so this would never run.',
        path: `${at}.endAt`,
      })
    }

    if (adSet.endAt === undefined) {
      // The single easiest way to spend far more than intended.
      issues.push({
        severity: 'warning',
        message: 'No end date: this runs until someone stops it. Set one unless that is intended.',
        path: `${at}.endAt`,
      })
    }

    if (ads.length === 0) {
      issues.push({
        severity: 'error',
        message: 'An ad set with no ads cannot deliver.',
        path: `${at}.ads`,
      })
    }

    ads.forEach((ad, j) => {
      const adAt = `${at}.ads[${j}]`
      if (ad.body.trim() === '') {
        issues.push({ severity: 'error', message: 'The ad has no text.', path: `${adAt}.body` })
      }
      if (ad.landingPageUrl !== undefined && !/^https:\/\//i.test(ad.landingPageUrl)) {
        issues.push({
          severity: 'error',
          message: 'The landing page must be https. Platforms reject plain http, and so do browsers.',
          path: `${adAt}.landingPageUrl`,
        })
      }
      if ((ad.mediaIds?.length ?? 0) === 0 && ad.landingPageUrl === undefined) {
        issues.push({
          severity: 'warning',
          message: 'No media and no landing page: this ad has nothing for anyone to do.',
          path: adAt,
        })
      }
    })
  })

  if (currencies.size > 1) {
    // An ad account has ONE currency. Mixing them means at least one ad set is
    // wrong, and guessing which would be worse than refusing.
    issues.push({
      severity: 'error',
      message: `Ad sets mix currencies (${[...currencies].sort().join(', ')}). One ad account holds one currency.`,
      path: 'adSets',
    })
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}

/** Total daily spend a plan commits to, for checking against a ceiling. */
export function totalDailyBudget(plan: AdPlan): Money | undefined {
  const first = plan.adSets[0]
  if (first === undefined) return undefined

  const currency = first.adSet.dailyBudget.currency
  let minor = 0
  for (const { adSet } of plan.adSets) {
    // Refuses rather than converting: see decisions/0003.
    if (adSet.dailyBudget.currency !== currency) return undefined
    minor += adSet.dailyBudget.minor
  }
  return { minor, currency }
}

/**
 * A one-line summary for an approval prompt.
 *
 * The person approving needs the number that matters most, and it is not the
 * daily budget — it is what this costs if nobody touches it for a month.
 */
export function describePlan(plan: AdPlan): string {
  const total = totalDailyBudget(plan)
  const adCount = plan.adSets.reduce((n, e) => n + e.ads.length, 0)

  const lines = [
    `Campaign: ${plan.campaign.name}`,
    `Objective: ${plan.campaign.objective}`,
    `${plan.adSets.length} ad set(s), ${adCount} ad(s)`,
  ]

  if (total !== undefined) {
    lines.push(`Daily budget: ${formatMoney(total)}`)
    lines.push(`Roughly ${formatMoney({ minor: total.minor * 30, currency: total.currency })} per month if left running`)
  }

  const openEnded = plan.adSets.some((e) => e.adSet.endAt === undefined)
  if (openEnded) lines.push('At least one ad set has NO end date.')

  lines.push('Everything will be created PAUSED. Nothing spends until it is activated separately.')
  return lines.join('\n')
}
