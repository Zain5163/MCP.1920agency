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

/** Who to show the ads to. */
export interface Audience {
  /** ISO 3166 country codes, two letters, uppercase. */
  readonly countries: readonly string[]
  readonly languages?: readonly string[]
  /** Both platforms enforce a legal minimum of 18. */
  readonly ageMin?: number
  readonly ageMax?: number
  readonly genders?: 'all' | 'male' | 'female'
  /**
   * Interest or attribute targeting, by the platform's own names.
   *
   * Kept as plain strings rather than an enum because the vocabularies do not
   * overlap at all — LinkedIn targets job titles and seniority, Meta targets
   * interests — and a shared enum would fit neither.
   */
  readonly interests?: readonly string[]
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

/**
 * Where the budget lives.
 *
 * `campaign` is Meta's CBO — one budget, the platform moves spend to whichever ad
 * set is winning. `adset` fixes each ad set's own budget. **Setting both is an
 * error on Meta**, not a preference, so this has to be explicit rather than
 * inferred from which field happens to be filled.
 */
export type BudgetLevel = 'campaign' | 'adset'

/** The top level. Holds the objective, and the budget when the level is campaign. */
export interface CampaignDraft {
  readonly name: string
  readonly objective: AdObjective
  readonly budgetLevel?: BudgetLevel
  /** Only when `budgetLevel` is `campaign`. */
  readonly dailyBudget?: Money
  /**
   * Regulated categories. Housing, employment, credit and political ads are
   * legally restricted in how they may be targeted, and the platform enforces it.
   */
  readonly specialCategories?: readonly string[]
}

/** Where the money lives when the budget level is `adset`. */
export interface AdSetDraft {
  readonly name: string
  /** Omitted when the campaign holds the budget instead. */
  readonly dailyBudget?: Money
  readonly audience: Audience
  readonly startAt?: Date
  readonly endAt?: Date
  /** What the platform should optimise delivery for, in its own vocabulary. */
  readonly optimizationGoal?: string
  /** The conversion the pixel reports, when optimising for conversions. */
  readonly conversionEvent?: string
  /**
   * Where a lead is captured. `website` sends people to a landing page and needs
   * a pixel to report back; `instant_form` opens a form inside the app and needs
   * a lead form on the Page instead. They have different requirements, which is
   * why this is explicit rather than inferred from which fields are filled.
   */
  readonly leadDestination?: 'website' | 'instant_form'
}

/**
 * The shapes a file can be delivered in, by the placements they suit.
 *
 * `1:1` and `4:5` for Feed, `9:16` for Stories and Reels, `1.91:1` for
 * landscape placements. One ad can carry several, and each placement is served
 * the one that fits, instead of one file being cropped to all of them.
 */
export const ASPECT_RATIOS = ['1:1', '4:5', '9:16', '1.91:1'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

/** One file an ad can show, and the shape it is. */
export interface AdAsset {
  readonly kind: 'image' | 'video'
  readonly localPath: string
  readonly aspectRatio: AspectRatio
  /** Video only. Without one the platform picks a frame, usually badly. */
  readonly thumbnailPath?: string
}

/**
 * Per-ad limits confirmed against Meta's `asset_feed_spec` documentation on
 * 2026-09-30. Enforced here as errors, not advice: exceeding them is refused
 * by Meta, and refusing locally names the field and the limit.
 */
export const AD_VARIANT_LIMITS = {
  bodies: 5,
  headlines: 5,
  descriptions: 5,
  images: 10,
  videos: 10,
} as const

/** What the ad is made of. */
export interface AdCreative {
  readonly kind: 'image' | 'video' | 'existing_post'
  /** Local file, for image and video. */
  readonly localPath?: string
  /** For `existing_post`: boost something already published. */
  readonly postId?: string
  /** Video only. Without one the platform picks a frame, usually badly. */
  readonly thumbnailPath?: string
}

/** One creative. */
export interface AdDraft {
  readonly name: string
  /** The primary text. With `bodies` set, this is ignored in favour of them. */
  readonly body: string
  readonly headline?: string
  /**
   * Up to five variants of each text. The platform shows different
   * combinations to different people and learns which work, which is delivery
   * optimisation rather than an A/B test: it will not report a winner, it will
   * simply spend more on what performs.
   */
  readonly bodies?: readonly string[]
  readonly headlines?: readonly string[]
  readonly descriptions?: readonly string[]
  /** Files in one or more aspect ratios. Each placement gets the shape that fits. */
  readonly assets?: readonly AdAsset[]
  /**
   * Whether the platform may alter the creative with its own AI — touch-ups,
   * rewritten text, added music. **Off unless explicitly turned on.** An agency
   * is paid for the creative it approved, and a client who sees rewritten copy
   * under their name did not approve that.
   */
  readonly platformEnhancements?: boolean
  /** An existing instant form, for `leadDestination: 'instant_form'`. */
  readonly leadFormId?: string
  readonly landingPageUrl?: string
  readonly callToAction?: string
  readonly creative?: AdCreative
  /** Media already uploaded to the platform, by its platform id. */
  readonly mediaIds?: readonly string[]
  /**
   * Explicitly empty means attribution was disabled on purpose. Undefined means
   * the adapter generates them. The difference matters: one is a choice, the
   * other is a default.
   */
  readonly urlTags?: string
}

/** The texts an ad will actually carry, whichever way they were supplied. */
export function effectiveTexts(ad: AdDraft): {
  bodies: readonly string[]
  headlines: readonly string[]
  descriptions: readonly string[]
} {
  const clean = (list: readonly string[] | undefined) =>
    (list ?? []).map((t) => t.trim()).filter((t) => t !== '')
  const bodies = clean(ad.bodies)
  const headlines = clean(ad.headlines)
  return {
    bodies: bodies.length > 0 ? bodies : clean([ad.body]),
    headlines: headlines.length > 0 ? headlines : clean(ad.headline !== undefined ? [ad.headline] : []),
    descriptions: clean(ad.descriptions),
  }
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

  /**
   * Budget belongs at exactly one level.
   *
   * Meta rejects a request that sets both, and the error it returns does not say
   * that is the problem. Catching it here turns a confusing platform failure into
   * a sentence that names the fix.
   */
  const level: BudgetLevel = plan.campaign.budgetLevel ?? 'adset'
  const anyAdSetBudget = plan.adSets.some((e) => e.adSet.dailyBudget !== undefined)

  if (level === 'campaign') {
    if (plan.campaign.dailyBudget === undefined) {
      issues.push({
        severity: 'error',
        message: 'Budget level is campaign, so campaign.dailyBudget is required.',
        path: 'campaign.dailyBudget',
      })
    }
    if (anyAdSetBudget) {
      issues.push({
        severity: 'error',
        message:
          'Both a campaign budget and ad set budgets are set. Platforms reject both at once — remove the ad set budgets, or change budgetLevel to adset.',
        path: 'adSets',
      })
    }
  } else if (plan.campaign.dailyBudget !== undefined) {
    issues.push({
      severity: 'error',
      message:
        'A campaign budget is set but budget level is adset. Remove one, or the platform decides which you meant.',
      path: 'campaign.dailyBudget',
    })
  }

  const currencies = new Set<string>()

  plan.adSets.forEach((entry, i) => {
    const at = `adSets[${i}]`
    const { adSet, ads } = entry

    if (adSet.name.trim() === '') {
      issues.push({ severity: 'error', message: 'The ad set needs a name.', path: `${at}.name` })
    }

    if (adSet.dailyBudget !== undefined) {
      currencies.add(adSet.dailyBudget.currency)
      if (adSet.dailyBudget.minor <= 0) {
        issues.push({
          severity: 'error',
          message: 'A daily budget must be greater than zero.',
          path: `${at}.dailyBudget`,
        })
      }
    } else if (level === 'adset') {
      issues.push({
        severity: 'error',
        message: 'Budget level is adset, so this ad set needs its own daily budget.',
        path: `${at}.dailyBudget`,
      })
    }

    const { ageMin = 18, ageMax = 65 } = adSet.audience
    if (ageMin < 18) {
      // Not a guardrail we chose; platforms enforce it.
      issues.push({
        severity: 'error',
        message: 'Age targeting cannot start below 18.',
        path: `${at}.audience.ageMin`,
      })
    }
    if (ageMin > ageMax) {
      issues.push({
        severity: 'error',
        message: `Minimum age ${ageMin} is above maximum age ${ageMax}, so this targets nobody.`,
        path: `${at}.audience.ageMin`,
      })
    }

    const bad = adSet.audience.countries.filter((c) => !/^[A-Z]{2}$/.test(c))
    if (bad.length > 0) {
      issues.push({
        severity: 'error',
        message: `Countries must be two-letter uppercase ISO codes. Got: ${bad.join(', ')}.`,
        path: `${at}.audience.countries`,
      })
    }

    /**
     * Regulated categories restrict targeting by law, and the platform enforces
     * it by rejecting the ad rather than by quietly widening the audience.
     */
    if ((plan.campaign.specialCategories?.length ?? 0) > 0) {
      const narrowed =
        (adSet.audience.genders !== undefined && adSet.audience.genders !== 'all') ||
        ageMin !== 18 ||
        ageMax !== 65
      if (narrowed) {
        issues.push({
          severity: 'error',
          message:
            'This campaign is in a special ad category (housing, employment, credit or politics), so age and gender must stay at 18-65, all genders. That is a legal restriction, not a preference.',
          path: `${at}.audience`,
        })
      }
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
      const texts = effectiveTexts(ad)
      if (texts.bodies.length === 0) {
        issues.push({ severity: 'error', message: 'The ad has no text.', path: `${adAt}.body` })
      }

      const counts: Array<[keyof typeof AD_VARIANT_LIMITS, number, string]> = [
        ['bodies', texts.bodies.length, 'primary texts'],
        ['headlines', texts.headlines.length, 'headlines'],
        ['descriptions', texts.descriptions.length, 'descriptions'],
        ['images', (ad.assets ?? []).filter((a) => a.kind === 'image').length, 'images'],
        ['videos', (ad.assets ?? []).filter((a) => a.kind === 'video').length, 'videos'],
      ]
      for (const [key, count, label] of counts) {
        if (count > AD_VARIANT_LIMITS[key]) {
          issues.push({
            severity: 'error',
            message: `${count} ${label}, above the limit of ${AD_VARIANT_LIMITS[key]} per ad.`,
            path: `${adAt}.${key}`,
          })
        }
      }

      for (const [label, list] of [
        ['primary texts', texts.bodies],
        ['headlines', texts.headlines],
        ['descriptions', texts.descriptions],
      ] as const) {
        if (new Set(list.map((t) => t.toLowerCase())).size < list.length) {
          // A duplicate is not rejected, it is wasted: the platform tests the
          // same thing twice and learns nothing from the second copy.
          issues.push({
            severity: 'warning',
            message: `Two of the ${label} are identical, so one variant slot is wasted.`,
            path: adAt,
          })
        }
      }

      for (const asset of ad.assets ?? []) {
        if (!(ASPECT_RATIOS as readonly string[]).includes(asset.aspectRatio)) {
          issues.push({
            severity: 'error',
            message: `Aspect ratio "${asset.aspectRatio}" is not one of ${ASPECT_RATIOS.join(', ')}.`,
            path: `${adAt}.assets`,
          })
        }
      }
      if (ad.landingPageUrl !== undefined && !/^https:\/\//i.test(ad.landingPageUrl)) {
        issues.push({
          severity: 'error',
          message: 'The landing page must be https. Platforms reject plain http, and so do browsers.',
          path: `${adAt}.landingPageUrl`,
        })
      }
      if (
        (ad.mediaIds?.length ?? 0) === 0 &&
        (ad.assets?.length ?? 0) === 0 &&
        ad.creative === undefined &&
        ad.landingPageUrl === undefined &&
        ad.leadFormId === undefined
      ) {
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
  // With a campaign-level budget the ad set figures are absent by design, and
  // summing them would report zero for a campaign that spends every day.
  if (plan.campaign.budgetLevel === 'campaign') return plan.campaign.dailyBudget

  const budgets = plan.adSets
    .map((e) => e.adSet.dailyBudget)
    .filter((b): b is Money => b !== undefined)

  const first = budgets[0]
  if (first === undefined) return undefined

  let minor = 0
  for (const budget of budgets) {
    // Refuses rather than converting: see decisions/0003.
    if (budget.currency !== first.currency) return undefined
    minor += budget.minor
  }
  return { minor, currency: first.currency }
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

  const openEnded = plan.adSets.some((e) => e.adSet.endAt === undefined)

  if (total !== undefined) {
    lines.push(`Daily budget: ${formatMoney(total)}`)
    /**
     * The figure a person approves on, so it has to be the real one. A two-week
     * campaign was summarised as "roughly 150,000 per month" when it would
     * cost about 70,000 in total — found in the live approval summary.
     */
    if (openEnded) {
      lines.push(
        `Roughly ${formatMoney({ minor: total.minor * 30, currency: total.currency })} per month, ` +
          'and it keeps spending until someone stops it',
      )
    } else {
      const now = Date.now()
      const days = Math.max(
        1,
        Math.ceil(
          Math.max(
            ...plan.adSets.map(
              (e) => (e.adSet.endAt!.getTime() - (e.adSet.startAt?.getTime() ?? now)) / 86_400_000,
            ),
          ),
        ),
      )
      lines.push(
        `Runs about ${days} day(s): roughly ${formatMoney({ minor: total.minor * days, currency: total.currency })} in total`,
      )
    }
  }

  if (openEnded) lines.push('At least one ad set has NO end date.')

  lines.push('Everything will be created PAUSED. Nothing spends until it is activated separately.')
  return lines.join('\n')
}
