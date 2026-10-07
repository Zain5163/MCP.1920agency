import { open, readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'

import {
  PublishError,
  classifyHttpStatus,
  classifyNetworkError,
  describePlan,
  effectiveTexts,
  validateAdPlan,
  type AdAsset,
  type AspectRatio,
  type AdPlan,
  type Money,
} from '@social-publisher/core'

import {
  META_CONVERSION_GOALS,
  checkMetaAdPlan,
  eventForObjective,
  goalForObjective,
  isDynamicCreative,
  type MetaCheckContext,
} from './meta-ads-guardrails.ts'
import { adLinks, verifyCampaignSnapshot, type VerifyCheck } from './meta-ads-verify.ts'
import { META_DEFAULT_NAMING, adName, adSetName, campaignName, urlTags } from './meta-ads-naming.ts'

/**
 * Creating Meta ad campaigns.
 *
 * **Nothing in this file can start spending.** Every object is created with
 * `status: PAUSED`, and there is no option to change that. Activation is a
 * separate action that goes through the policy layer, because the asymmetry is
 * stark: a wrongly-created paused campaign costs nothing and is deleted in a
 * second, while a wrongly-created live one spends money while you work out what
 * happened.
 *
 * Objects are created top down — campaign, then ad set, then creative, then ad —
 * because each needs the id of the one above it. That ordering is also the
 * weakness: a failure at step three leaves a half-built campaign, and re-running
 * creates a **second** one rather than resuming. Until that is fixed (IDEAS K3),
 * a partial failure reports exactly what was created so it can be removed by
 * hand.
 */

const GRAPH_BASE = 'https://graph.facebook.com'
export const META_ADS_API_VERSION = 'v25.0'

/** What "automatic placements" means, written out, for excluding one of them. */
export const ALL_PUBLISHER_PLATFORMS = ['facebook', 'instagram', 'messenger', 'audience_network'] as const

/** Meta takes budgets in minor units, as strings. */
function minorUnits(value: Money): string {
  return String(value.minor)
}

/**
 * Attribution windows, by the shorthand people actually use.
 *
 * `7d_click_1d_view` is the sensible default for most accounts: it credits a
 * click up to a week later and a view only on the same day.
 */
const ATTRIBUTION_SPECS: Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>> = {
  '1d_click': [{ event_type: 'CLICK_THROUGH', window_days: 1 }],
  '7d_click': [{ event_type: 'CLICK_THROUGH', window_days: 7 }],
  '1d_click_1d_view': [
    { event_type: 'CLICK_THROUGH', window_days: 1 },
    { event_type: 'VIEW_THROUGH', window_days: 1 },
  ],
  '7d_click_1d_view': [
    { event_type: 'CLICK_THROUGH', window_days: 7 },
    { event_type: 'VIEW_THROUGH', window_days: 1 },
  ],
}

const GENDER_CODES: Readonly<Record<string, readonly number[] | undefined>> = {
  all: undefined,
  male: [1],
  female: [2],
}

/** Everything about the account being spent from. */
export interface MetaAdAccount {
  /** Without the `act_` prefix; it is added where needed. */
  readonly adAccountId: string
  /** The Page the ads are published by. Meta requires one even for Instagram placements. */
  readonly pageId: string
  /**
   * The Instagram **actor** id for ads, which is not the Instagram account id
   * used for publishing. They look alike and are different values: the
   * publishing id is rejected here with “must be a valid Instagram account
   * id”. The ads one comes from the ad account's connected Instagram in
   * Business Settings.
   *
   * Optional. Without it the ads run as the Page, which is valid.
   */
  readonly instagramId?: string
  /** Required for conversion optimisation. Without it, those goals are rejected. */
  readonly pixelId?: string
  readonly currency: string
}

export interface MetaAdsOptions {
  readonly account: MetaAdAccount
  readonly accessToken: string
  readonly apiVersion?: string
  readonly fetch?: typeof globalThis.fetch
  /** How often to check whether an uploaded video is ready. Injectable for tests. */
  readonly pollIntervalMs?: number
}

/** What was created, in the order it was created, so a partial run can be undone. */
export interface CreatedObjects {
  campaignId?: string
  readonly adSetIds: string[]
  readonly creativeIds: string[]
  readonly adIds: string[]
}

export interface CreateResult {
  readonly created: CreatedObjects
  /** Warnings that did not block. Shown, never swallowed. */
  readonly warnings: readonly string[]
  readonly summary: string
}

/** One object's state as Meta reports it, not as we last set it. */
export interface ObjectStatus {
  readonly id: string
  readonly name: string
  /** What we asked for: ACTIVE or PAUSED. */
  readonly status: string
  /**
   * What is actually happening. This is the field that matters: an ad can be
   * `status: ACTIVE` and `effective_status: DISAPPROVED`, which means it was
   * switched on and is not running.
   */
  readonly effectiveStatus: string
  /** Meta's policy reasons, when an ad was rejected. */
  readonly reviewFeedback?: Readonly<Record<string, unknown>>
}

export interface CampaignStatus {
  readonly campaign: ObjectStatus
  readonly adSets: readonly (ObjectStatus & { readonly dailyBudgetMinor?: number })[]
  readonly ads: readonly ObjectStatus[]
  /** Daily spend this campaign commits to once active, in minor units. */
  readonly dailyBudgetMinor: number
  /** Ads Meta has refused. Present even when everything else looks fine. */
  readonly rejected: readonly ObjectStatus[]
  /** Ads still waiting on Meta's policy review. */
  readonly inReview: readonly ObjectStatus[]
  /**
   * When the last ad set stops, if every ad set has an end date. Undefined means
   * at least one runs until someone stops it.
   */
  readonly endsAt?: Date
}

/**
 * Every file an ad will carry, however it was supplied.
 *
 * `assets` is the current form; `creative` with a single file is the older one
 * and is read as one square asset so existing callers keep working.
 */
function assetsOf(ad: AdPlan['adSets'][number]['ads'][number]): AdAsset[] {
  if ((ad.assets?.length ?? 0) > 0) return [...ad.assets!]
  const c = ad.creative
  if ((c?.kind === 'image' || c?.kind === 'video') && c.localPath !== undefined) {
    return [
      {
        kind: c.kind,
        localPath: c.localPath,
        aspectRatio: '1:1',
        ...(c.thumbnailPath !== undefined ? { thumbnailPath: c.thumbnailPath } : {}),
      },
    ]
  }
  return []
}

/**
 * Splits an ad that wants both text variants and placement-specific files.
 *
 * Meta will not combine them in one creative: *"Multiple bodies assets cannot
 * be applied to rule no. 1"* (found live 2026-09-30). When each placement is
 * given its own file, each placement must also resolve to exactly one text.
 *
 * So one ad with five texts and three shapes becomes five ads, each with one
 * text and all three shapes. Both wishes survive: every placement is served the
 * right shape, and Meta still learns which text wins — at the ad level rather
 * than inside one ad. Shorter lists repeat, so five texts with one headline
 * gives five ads sharing that headline.
 *
 * Ads that do not need both are returned untouched.
 */
export function expandForPlacements(plan: AdPlan): AdPlan {
  return {
    ...plan,
    adSets: plan.adSets.map((entry) => ({
      ...entry,
      ads: entry.ads.flatMap((ad) => {
        const assets = assetsOf(ad)
        const shapes = new Set(assets.map((a) => a.aspectRatio))
        const texts = effectiveTexts(ad)
        const variants = Math.max(texts.bodies.length, texts.headlines.length, texts.descriptions.length)
        if (shapes.size < 2 || variants < 2) return [ad]

        const pick = (list: readonly string[], i: number) =>
          list.length === 0 ? [] : [list[i % list.length]!]

        return Array.from({ length: variants }, (_, i) => ({
          ...ad,
          name: `${ad.name}-v${i + 1}`,
          body: pick(texts.bodies, i)[0] ?? ad.body,
          bodies: pick(texts.bodies, i),
          headlines: pick(texts.headlines, i),
          descriptions: pick(texts.descriptions, i),
          assets,
        }))
      }),
    })),
  }
}

/**
 * Website-event tracking on the ad, whatever the campaign's goal.
 *
 * The pixel was attached only to conversion ad sets, as the thing they
 * optimise toward. A traffic campaign therefore launched with **no website
 * tracking at all** — found by the owner in Ads Manager on the first real
 * campaign, 2026-09-30, where "Website events" was unticked and the only dataset
 * tracked was an unrelated one. Tracking and optimising are different jobs:
 * every ad should report what visitors do on the site, so results can be read
 * and later campaigns can optimise on real data.
 *
 * Meta adds its own default entries alongside this one.
 */
export function websiteTracking(pixelId: string | undefined): Record<string, string> {
  if (pixelId === undefined) return {}
  return {
    tracking_specs: JSON.stringify([{ 'action.type': ['offsite_conversion'], fb_pixel: [pixelId] }]),
  }
}

/** A label per aspect ratio, which placement rules then refer to. */
function labelFor(ratio: AspectRatio): string {
  return `ratio_${ratio.replace(':', 'x').replace('.', '_')}`
}

/**
 * Which file each placement gets.
 *
 * Only produced when there is more than one shape to choose between; with one
 * shape Meta crops it to every placement and no rule is needed. Feed prefers
 * 4:5 over 1:1 because it occupies more of the screen; Stories and Reels take
 * 9:16; landscape goes to the right column and the audience network.
 */
function placementRules(assets: readonly AdAsset[]): Array<Record<string, unknown>> {
  const shapes = new Set(assets.map((a) => a.aspectRatio))
  if (shapes.size < 2) return []

  const rules: Array<Record<string, unknown>> = []
  const feedShape: AspectRatio | undefined = shapes.has('4:5') ? '4:5' : shapes.has('1:1') ? '1:1' : undefined

  if (shapes.has('9:16')) {
    rules.push({
      customization_spec: {
        publisher_platforms: ['facebook', 'instagram'],
        facebook_positions: ['story', 'facebook_reels'],
        instagram_positions: ['story', 'reels'],
      },
      image_label: { name: labelFor('9:16') },
      video_label: { name: labelFor('9:16') },
    })
  }
  if (feedShape !== undefined) {
    rules.push({
      customization_spec: {
        publisher_platforms: ['facebook', 'instagram'],
        facebook_positions:
          feedShape === '4:5' && shapes.has('1:1')
            ? ['feed', 'video_feeds']
            : ['feed', 'marketplace', 'video_feeds', 'search'],
        instagram_positions: ['stream', 'explore', 'explore_home', 'profile_feed'],
      },
      image_label: { name: labelFor(feedShape) },
      video_label: { name: labelFor(feedShape) },
    })
  }
  /**
   * With both 1:1 and 4:5 supplied, Feed takes the 4:5 and the square goes to
   * the placements that are square by nature. Without this rule the 1:1 file
   * was uploaded and never served — found by reading the creative back from
   * Meta on 2026-09-30.
   */
  if (feedShape === '4:5' && shapes.has('1:1')) {
    rules.push({
      customization_spec: {
        publisher_platforms: ['facebook'],
        facebook_positions: ['marketplace', 'search', 'right_hand_column'],
      },
      image_label: { name: labelFor('1:1') },
      video_label: { name: labelFor('1:1') },
    })
  }
  if (shapes.has('1.91:1')) {
    rules.push({
      customization_spec: {
        publisher_platforms: ['facebook', 'audience_network'],
        // The square rule above claims the right column when it exists.
        facebook_positions: feedShape === '4:5' && shapes.has('1:1') ? [] : ['right_hand_column'],
        audience_network_positions: ['classic'],
      },
      image_label: { name: labelFor('1.91:1') },
      video_label: { name: labelFor('1.91:1') },
    })
  }

  // Meta applies rules in priority order; numbering them makes that explicit
  // rather than an accident of array order.
  return rules.map((rule, i) => ({ ...rule, priority: i + 1 }))
}

/**
 * Meta's automatic creative changes, off unless explicitly wanted.
 *
 * The owner's instruction, and the right default for an agency: a client
 * approved specific copy and images, and Meta rewriting or retouching them is
 * a change nobody approved.
 */
function enhancementsSpec(allow: boolean): Record<string, unknown> {
  const status = allow ? 'OPT_IN' : 'OPT_OUT'
  return {
    creative_features_spec: Object.fromEntries(
      META_CREATIVE_FEATURES.map((feature) => [feature, { enroll_status: status }]),
    ),
  }
}

/**
 * Meta's automatic creative enhancements, named individually.
 *
 * The single `standard_enhancements` switch was deprecated in API v22 (January
 * 2025) and is now refused outright: *"including standard enhancements field in
 * creative has been deprecated. Please choose to set individual features
 * instead."* Found live 2026-09-30. Each feature has to be set on its own, so
 * opting out means naming every one.
 */
export const META_CREATIVE_FEATURES = [
  'image_templates',
  'image_touchups',
  'text_optimizations',
  'inline_comment',
] as const

/** A question on an instant form. Standard types are pre-filled by Meta. */
export type LeadQuestion =
  | { readonly type: 'FULL_NAME' | 'EMAIL' | 'WORK_EMAIL' | 'PHONE' | 'COMPANY_NAME' | 'JOB_TITLE' | 'CITY' }
  | {
      readonly type: 'CUSTOM'
      readonly key: string
      readonly label: string
      /** Multiple choice when given; free text otherwise. */
      readonly options?: readonly string[]
    }

export interface LeadFormDraft {
  readonly name: string
  readonly questions: readonly LeadQuestion[]
  readonly privacyPolicyUrl: string
  readonly privacyPolicyText?: string
  /** Where people can go after submitting. */
  readonly followUpUrl: string
  /** Adds a review step before submitting. On unless deliberately turned off. */
  readonly higherIntent?: boolean
  readonly thankYouTitle?: string
  readonly thankYouMessage?: string
  readonly locale?: string
}

export interface AdPerformance {
  readonly adId: string
  readonly name: string
  /** In minor units of the account currency. */
  readonly spendMinor: number
  readonly impressions: number
  readonly frequency: number
  readonly linkClicks: number
  /** Percent, e.g. 1.2 means 1.2%. */
  readonly linkCtr: number
  readonly results: number
  readonly resultAction: string
  readonly costPerResultMinor?: number
  /** Plain-language suggestions. Never executed by this code. */
  readonly suggestions: readonly string[]
}

/**
 * Lead actions Meta reports under different names depending on where the lead
 * was captured. Checked in order; the first present is the one counted.
 */
const LEAD_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']

export function assessPerformance(
  row: Record<string, unknown>,
  options: { targetCostMinor?: number; resultAction?: string } = {},
): AdPerformance {
  const num = (v: unknown) => (v === undefined || v === null || v === '' ? 0 : Number(v))
  const actions = (row.actions as Array<{ action_type: string; value: string }> | undefined) ?? []

  const resultAction =
    options.resultAction ??
    LEAD_ACTIONS.find((a) => actions.some((x) => x.action_type === a)) ??
    'link_click'
  const results = num(actions.find((a) => a.action_type === resultAction)?.value)

  // Meta reports spend in major units as a decimal string; convert once.
  const spendMinor = Math.round(num(row.spend) * 100)
  const impressions = num(row.impressions)
  const frequency = num(row.frequency)
  const linkCtr = num(row.inline_link_click_ctr)
  const costPerResultMinor = results > 0 ? Math.round(spendMinor / results) : undefined

  const suggestions: string[] = []
  const target = options.targetCostMinor

  if (spendMinor === 0 && impressions === 0) {
    suggestions.push('No delivery at all. Check it is active and that its ads passed review before judging anything else.')
  }

  if (frequency > 4) {
    suggestions.push(
      `Frequency ${frequency.toFixed(1)}: people have seen this more than four times. It is worn out — replace it with a fresh version of the same idea.`,
    )
  } else if (frequency > 2.5) {
    suggestions.push(
      `Frequency ${frequency.toFixed(1)}: getting familiar. Have a replacement ready; do not pause it until one is live.`,
    )
  }

  if (impressions >= 1000 && linkCtr < 0.8) {
    suggestions.push(
      `Link click-through ${linkCtr.toFixed(2)}% is weak. The hook or the image is not stopping people — test a new opening, not a new audience.`,
    )
  }

  if (target !== undefined && target > 0) {
    const enough = spendMinor >= target * 3
    if (!enough) {
      suggestions.push(
        `Not enough data to judge cost yet: ${(spendMinor / target).toFixed(1)}× the target spent, about 3× is needed.`,
      )
    } else if (results === 0) {
      suggestions.push('Three times the target cost spent with no results. The idea is not working — replace it rather than rework it.')
    } else if (costPerResultMinor! > target * 1.5) {
      suggestions.push(
        `Cost per result is ${(costPerResultMinor! / target).toFixed(1)}× the target with enough data to trust it. Replace the angle.`,
      )
    } else if (costPerResultMinor! <= target) {
      suggestions.push('At or under target cost with enough data. A candidate to keep, and to put more budget behind gradually.')
    }
  }

  return {
    adId: String(row.ad_id ?? ''),
    name: String(row.ad_name ?? ''),
    spendMinor,
    impressions,
    frequency,
    linkClicks: num(row.inline_link_clicks),
    linkCtr,
    results,
    resultAction,
    ...(costPerResultMinor !== undefined ? { costPerResultMinor } : {}),
    suggestions,
  }
}

/** The iframe address inside a preview snippet, with its HTML entities undone. */
export function previewLink(html: string | undefined): string | undefined {
  const match = html?.match(/src="([^"]+)"/)
  return match?.[1]?.replace(/&amp;/g, '&')
}

/** States in which an ad will never deliver, whatever its own status says. */
const REJECTED_STATES = new Set(['DISAPPROVED', 'WITH_ISSUES'])
const IN_REVIEW_STATES = new Set(['IN_PROCESS', 'PENDING_REVIEW'])

export class MetaAdsClient {
  readonly #account: MetaAdAccount
  readonly #token: string
  readonly #version: string
  readonly #fetch: typeof globalThis.fetch
  readonly #pollMs: number

  constructor(options: MetaAdsOptions) {
    this.#account = options.account
    this.#token = options.accessToken
    this.#version = options.apiVersion ?? META_ADS_API_VERSION
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#pollMs = options.pollIntervalMs ?? 3000
  }

  /**
   * Checks a plan without creating anything.
   *
   * Separate from `create` on purpose: this is what an AI should call before
   * asking a person to approve, and it must be impossible for it to have side
   * effects.
   */
  review(requested: AdPlan, context: MetaCheckContext = {}): {
    ok: boolean
    errors: string[]
    warnings: string[]
    summary: string
  } {
    // Reviewed as it will be built, so the ad count and every warning describe
    // the ads that will exist rather than the ones that were asked for.
    const plan = expandForPlacements(requested)
    const base = validateAdPlan(plan)
    const meta = checkMetaAdPlan(plan, {
      ...context,
      hasPixel: context.hasPixel ?? this.#account.pixelId !== undefined,
    })
    const all = [...base.issues, ...meta]

    return {
      ok: !all.some((i) => i.severity === 'error'),
      errors: all.filter((i) => i.severity === 'error').map((i) => `${i.path}: ${i.message}`),
      warnings: all.filter((i) => i.severity === 'warning').map((i) => `${i.path}: ${i.message}`),
      summary: describePlan(plan),
    }
  }

  /**
   * Creates the whole plan, paused.
   *
   * Refuses on any error. Warnings do not block, but they are returned and must
   * be surfaced — a guardrail you can ignore silently is a guardrail that does
   * nothing.
   */
  async create(requested: AdPlan, context: MetaCheckContext = {}): Promise<CreateResult> {
    const review = this.review(requested, context)
    const plan = expandForPlacements(requested)
    if (!review.ok) {
      throw new PublishError(
        `This campaign was not created. ${review.errors.length} problem(s):\n  ${review.errors.join('\n  ')}`,
        { failureClass: 'permanent' },
      )
    }

    const created: CreatedObjects = { adSetIds: [], creativeIds: [], adIds: [] }

    try {
      created.campaignId = await this.#createCampaign(plan)

      for (const [index, entry] of plan.adSets.entries()) {
        const adSetId = await this.#createAdSet(plan, entry, created.campaignId, index)
        created.adSetIds.push(adSetId)

        for (const [j, ad] of entry.ads.entries()) {
          const creativeId = await this.#createCreative(ad, j)
          created.creativeIds.push(creativeId)

          const adId = await this.#post('ads', {
            name: adName(META_DEFAULT_NAMING.ad, {
              ...(ad.name !== '' ? { given: ad.name } : {}),
              ...(ad.headline !== undefined ? { headline: ad.headline } : {}),
              ...(ad.creative?.kind !== undefined ? { kind: ad.creative.kind } : {}),
              index: j,
            }),
            adset_id: adSetId,
            creative: JSON.stringify({ creative_id: creativeId }),
            status: 'PAUSED',
            ...websiteTracking(this.#account.pixelId),
          })
          created.adIds.push(adId)
        }
      }
    } catch (error) {
      // Say exactly what exists, because re-running would build a second
      // campaign rather than continuing this one.
      throw new PublishError(
        `${error instanceof Error ? error.message : String(error)}\n\n` +
          `PARTIALLY CREATED, and everything below is PAUSED so nothing is spending:\n` +
          `  campaign: ${created.campaignId ?? 'none'}\n` +
          `  ad sets: ${created.adSetIds.length}, creatives: ${created.creativeIds.length}, ads: ${created.adIds.length}\n` +
          'Delete the campaign in Ads Manager before retrying — re-running creates a second one.',
        {
          // Keep the underlying class. Forcing 'permanent' here hid the fact that
          // a dropped connection is worth retrying.
          failureClass: error instanceof PublishError ? error.failureClass : 'permanent',
          cause: error,
        },
      )
    }

    return {
      created,
      warnings: review.warnings,
      summary: review.summary,
    }
  }

  /**
   * What a campaign is really doing, read from Meta.
   *
   * Exists because creation succeeding says nothing about delivery. Ads go
   * through policy review after they are created, and can be rejected hours
   * later with everything upstream still reporting success. This reads
   * `effective_status` and the review feedback so a rejection is visible
   * instead of looking like a quiet campaign.
   */
  /**
   * Reads a campaign back from Meta and checks it against the plan it was built
   * from (when given) and against rules that must always hold: the goal matches
   * the objective, the right pixel and event, Page and Instagram, budgets,
   * countries, every landing page loads, no ad rejected. See meta-ads-verify.ts.
   */
  async verify(campaignId: string, expected?: AdPlan): Promise<VerifyCheck[]> {
    const campaign = (await this.#get(campaignId, { fields: 'id,name,objective,status,daily_budget' })) as Record<string, unknown>
    const adSets = (await this.#get(`${campaignId}/adsets`, {
      fields: 'id,name,status,optimization_goal,promoted_object,destination_type,daily_budget,targeting{geo_locations,age_min,age_max}',
      limit: '100',
    })) as { data?: Record<string, unknown>[] }
    const ads = (await this.#get(`${campaignId}/ads`, {
      fields: 'id,name,status,effective_status,tracking_specs,creative{object_story_spec,asset_feed_spec}',
      limit: '100',
    })) as { data?: Record<string, unknown>[] }

    // Each landing page is loaded once, as a visitor would, following redirects.
    const links: Record<string, number> = {}
    for (const url of new Set((ads.data ?? []).flatMap(adLinks))) {
      try {
        const response = await this.#fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15_000) })
        links[url] = response.status
      } catch {
        links[url] = 0
      }
    }

    // Reviewed as built: an ad with several texts and shapes becomes several ads.
    const plan = expected !== undefined ? expandForPlacements(expected) : undefined
    return verifyCampaignSnapshot(
      { campaign, adSets: adSets.data ?? [], ads: ads.data ?? [], links },
      {
        pageId: this.#account.pageId,
        ...(this.#account.instagramId !== undefined ? { instagramId: this.#account.instagramId } : {}),
        ...(this.#account.pixelId !== undefined ? { pixelId: this.#account.pixelId } : {}),
      },
      plan,
    )
  }

  async status(campaignId: string): Promise<CampaignStatus> {
    const campaign = await this.#get(campaignId, {
      fields: 'id,name,status,effective_status,daily_budget',
    })
    const adSets = await this.#get(`${campaignId}/adsets`, {
      fields: 'id,name,status,effective_status,daily_budget,end_time',
      limit: '100',
    })
    const ads = await this.#get(`${campaignId}/ads`, {
      fields: 'id,name,status,effective_status,ad_review_feedback',
      limit: '100',
    })

    const toStatus = (row: Record<string, unknown>): ObjectStatus => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      status: String(row.status ?? ''),
      effectiveStatus: String(row.effective_status ?? ''),
      ...(row.ad_review_feedback !== undefined
        ? { reviewFeedback: row.ad_review_feedback as Record<string, unknown> }
        : {}),
    })

    const adSetRows = ((adSets as { data?: Record<string, unknown>[] }).data ?? []).map((row) => ({
      ...toStatus(row),
      ...(row.daily_budget !== undefined ? { dailyBudgetMinor: Number(row.daily_budget) } : {}),
    }))
    const adRows = ((ads as { data?: Record<string, unknown>[] }).data ?? []).map(toStatus)

    // A campaign budget (CBO) and ad set budgets are mutually exclusive, so
    // whichever is present is the whole daily commitment.
    const campaignBudget = (campaign as { daily_budget?: string }).daily_budget
    const dailyBudgetMinor =
      campaignBudget !== undefined
        ? Number(campaignBudget)
        : adSetRows.reduce((sum, row) => sum + (row.dailyBudgetMinor ?? 0), 0)

    const ends = ((adSets as { data?: Array<{ end_time?: string }> }).data ?? []).map((r) => r.end_time)
    const endsAt =
      ends.length > 0 && ends.every((e) => e !== undefined && e !== '')
        ? new Date(Math.max(...ends.map((e) => new Date(e!).getTime())))
        : undefined

    return {
      campaign: toStatus(campaign as Record<string, unknown>),
      adSets: adSetRows,
      ads: adRows,
      dailyBudgetMinor,
      ...(endsAt !== undefined ? { endsAt } : {}),
      rejected: adRows.filter((a) => REJECTED_STATES.has(a.effectiveStatus)),
      inReview: adRows.filter((a) => IN_REVIEW_STATES.has(a.effectiveStatus)),
    }
  }

  /**
   * Daily spend the account already commits to, across everything running.
   *
   * A spend ceiling that looks only at the campaign being approved is useless:
   * ten campaigns at 50 a day is 500 a day, whatever each one looks like
   * alone. This is the figure the ceiling is checked against.
   */
  async committedDailySpendMinor(): Promise<number> {
    const account = `act_${this.#account.adAccountId}`
    const campaigns = await this.#get(`${account}/campaigns`, {
      fields: 'id,daily_budget,effective_status',
      effective_status: JSON.stringify(['ACTIVE']),
      limit: '200',
    })
    const adSets = await this.#get(`${account}/adsets`, {
      fields: 'id,daily_budget,effective_status',
      effective_status: JSON.stringify(['ACTIVE']),
      limit: '500',
    })

    const sum = (rows: unknown) =>
      ((rows as { data?: { daily_budget?: string }[] }).data ?? []).reduce(
        (total, row) => total + (row.daily_budget !== undefined ? Number(row.daily_budget) : 0),
        0,
      )
    // CBO campaigns carry the budget; their ad sets carry none. ABO is the
    // reverse. Summing both levels therefore counts each budget once.
    return sum(campaigns) + sum(adSets)
  }

  /**
   * Starts spending.
   *
   * Ads and ad sets are switched on **first** and the campaign **last**. The
   * campaign is the master switch: while it is paused nothing below it
   * delivers, so doing it last means there is never a moment where part of the
   * campaign is running and part is not.
   *
   * This method does not decide whether activation is allowed. That is the
   * policy layer's job, and it must have run before this is called.
   */
  async activate(campaignId: string): Promise<CampaignStatus> {
    const current = await this.status(campaignId)
    if (current.rejected.length > 0) {
      throw new PublishError(
        `${current.rejected.length} ad(s) in this campaign were rejected by Meta's review, so ` +
          'activating would spend on a campaign that cannot deliver them. Fix or remove them first.',
        { failureClass: 'permanent' },
      )
    }

    for (const ad of current.ads) await this.#update(ad.id, { status: 'ACTIVE' })
    for (const adSet of current.adSets) await this.#update(adSet.id, { status: 'ACTIVE' })
    await this.#update(campaignId, { status: 'ACTIVE' })

    return await this.status(campaignId)
  }

  /**
   * Stops spending.
   *
   * The campaign alone is paused, and first: it is the one switch that stops
   * everything beneath it at once. Pausing each ad in turn would leave the rest
   * spending while it worked through them.
   */
  async pause(campaignId: string): Promise<CampaignStatus> {
    await this.#update(campaignId, { status: 'PAUSED' })
    return await this.status(campaignId)
  }

  // ------------------------------------------------------- performance team

  /**
   * Raw insights rows for the account or one campaign, ad set or ad, following
   * Meta's paging up to `maxRows`.
   *
   * Breakdowns and daily rows are what separate a media buyer from a summary:
   * the owner's first campaign looked excellent per ad and was mostly wasted by
   * placement.
   */
  async insights(options: {
    objectId?: string
    level: 'account' | 'campaign' | 'adset' | 'ad'
    datePreset?: string
    since?: string
    until?: string
    breakdowns?: string
    timeIncrement?: number
    maxRows?: number
  }): Promise<Array<Record<string, unknown>>> {
    const id = options.objectId ?? `act_${this.#account.adAccountId}`
    const params: Record<string, string> = {
      level: options.level,
      fields: [
        'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name',
        'spend,impressions,reach,frequency,inline_link_clicks,inline_link_click_ctr,cpm',
        'actions,action_values,purchase_roas',
      ].join(','),
      limit: '500',
    }
    if (options.since !== undefined && options.until !== undefined) {
      params.time_range = JSON.stringify({ since: options.since, until: options.until })
    } else {
      params.date_preset = options.datePreset ?? 'last_7d'
    }
    if (options.breakdowns !== undefined) params.breakdowns = options.breakdowns
    if (options.timeIncrement !== undefined) params.time_increment = String(options.timeIncrement)

    const rows: Array<Record<string, unknown>> = []
    let page = (await this.#get(`${id}/insights`, params)) as {
      data?: Array<Record<string, unknown>>
      paging?: { next?: string }
    }
    const max = options.maxRows ?? 2000
    for (;;) {
      rows.push(...(page.data ?? []))
      if (rows.length >= max || page.paging?.next === undefined) break
      page = (await this.#send(page.paging.next, { method: 'GET' })) as typeof page
    }
    return rows.slice(0, max)
  }

  /** Every ad set (optionally in one campaign) with what the audit needs to know. */
  async adSetsOverview(campaignId?: string): Promise<
    Array<{
      id: string
      name: string
      status: string
      campaignId: string
      optimizationGoal?: string
      customEventType?: string
      dailyBudgetMinor?: number
      dynamicCreative: boolean
      learningStatus?: string
      ads: Array<{ id: string; name: string; status: string }>
    }>
  > {
    const path = campaignId !== undefined ? `${campaignId}/adsets` : `act_${this.#account.adAccountId}/adsets`
    const data = (await this.#get(path, {
      fields:
        'id,name,effective_status,campaign_id,optimization_goal,promoted_object,daily_budget,is_dynamic_creative,learning_stage_info,ads.limit(50){id,name,effective_status}',
      limit: '200',
    })) as { data?: Array<Record<string, unknown>> }

    return (data.data ?? []).map((r) => {
      const promoted = r.promoted_object as { custom_event_type?: string } | undefined
      const learning = r.learning_stage_info as { status?: string } | undefined
      const ads = ((r.ads as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? []).map((a) => ({
        id: String(a.id),
        name: String(a.name ?? ''),
        status: String(a.effective_status ?? ''),
      }))
      return {
        id: String(r.id),
        name: String(r.name ?? ''),
        status: String(r.effective_status ?? ''),
        campaignId: String(r.campaign_id ?? ''),
        ...(r.optimization_goal !== undefined ? { optimizationGoal: String(r.optimization_goal) } : {}),
        ...(promoted?.custom_event_type !== undefined ? { customEventType: promoted.custom_event_type } : {}),
        ...(r.daily_budget !== undefined ? { dailyBudgetMinor: Number(r.daily_budget) } : {}),
        dynamicCreative: r.is_dynamic_creative === true,
        ...(learning?.status !== undefined ? { learningStatus: learning.status } : {}),
        ads,
      }
    })
  }

  /**
   * The ad account's change history: who changed what, when, from what to what.
   *
   * The auditor's answer to "what changed just before results dropped?". Meta's
   * own Ads MCP offers activity logs (2026-04); this reads the same history
   * through the Marketing API with the token already held.
   */
  async activity(options: { since?: Date; limit?: number } = {}): Promise<
    Array<{ at: Date; what: string; objectType: string; objectName: string; by?: string; from?: string; to?: string }>
  > {
    const params: Record<string, string> = {
      fields: 'event_time,event_type,translated_event_type,object_type,object_name,actor_name,extra_data',
      limit: String(options.limit ?? 50),
    }
    if (options.since !== undefined) params.since = String(Math.floor(options.since.getTime() / 1000))
    const data = (await this.#get(`act_${this.#account.adAccountId}/activities`, params)) as { data?: Array<Record<string, unknown>> }
    return (data.data ?? []).map((a) => {
      let from: string | undefined
      let to: string | undefined
      try {
        const extra = JSON.parse(String(a.extra_data ?? '{}')) as { old_value?: unknown; new_value?: unknown }
        if (extra.old_value !== undefined) from = typeof extra.old_value === 'object' ? JSON.stringify(extra.old_value) : String(extra.old_value)
        if (extra.new_value !== undefined) to = typeof extra.new_value === 'object' ? JSON.stringify(extra.new_value) : String(extra.new_value)
      } catch {
        // extra_data is free-form; a value that is not JSON is simply not shown.
      }
      return {
        at: new Date(String(a.event_time)),
        what: String(a.translated_event_type ?? a.event_type ?? ''),
        objectType: String(a.object_type ?? ''),
        objectName: String(a.object_name ?? ''),
        ...(a.actor_name !== undefined ? { by: String(a.actor_name) } : {}),
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
      }
    })
  }

  /** Reads one object's fields; for checks before a change. */
  async readObject(id: string, fields: string): Promise<Record<string, unknown>> {
    return (await this.#get(id, { fields })) as Record<string, unknown>
  }

  /**
   * Sets an ad set's or campaign's daily budget. Spends money from the moment it
   * applies; the approval and the spend ceiling are checked by the caller.
   */
  async setDailyBudget(id: string, dailyBudgetMinor: number): Promise<void> {
    await this.#update(id, { daily_budget: String(Math.round(dailyBudgetMinor)) })
  }

  /** Switches one ad, ad set or campaign on or off. */
  async setDelivery(id: string, on: boolean): Promise<void> {
    await this.#update(id, { status: on ? 'ACTIVE' : 'PAUSED' })
  }

  /**
   * Removes placements from an ad set, keeping everything else in its targeting.
   *
   * With automatic placements an ad set has no `publisher_platforms` at all, so
   * "everything except Audience Network" has to be written out as the list of
   * the others. This restarts Meta's learning for the ad set.
   *
   * @returns the platforms the ad set targets afterwards.
   */
  async excludePlacements(adSetId: string, exclude: readonly string[]): Promise<string[]> {
    const current = await this.readObject(adSetId, 'targeting')
    const targeting = { ...((current.targeting as Record<string, unknown> | undefined) ?? {}) }
    const before = (targeting.publisher_platforms as string[] | undefined) ?? [...ALL_PUBLISHER_PLATFORMS]
    const after = before.filter((p) => !exclude.includes(p))
    if (after.length === 0) {
      throw new PublishError('Excluding those would leave the ad set with nowhere to show.', { failureClass: 'permanent' })
    }
    targeting.publisher_platforms = after
    for (const platform of exclude) delete targeting[`${platform}_positions`]
    await this.#update(adSetId, { targeting: JSON.stringify(targeting) })
    return after
  }

  /**
   * Builds one creative on its own, with no campaign around it.
   *
   * A creative is a standalone object in the ad account: it cannot spend and
   * needs nothing above it. That makes it the safe way to check that a set of
   * texts and files is accepted, and to preview it, before a campaign exists.
   */
  async createCreative(ad: AdPlan['adSets'][number]['ads'][number]): Promise<string> {
    return await this.#createCreative(ad, 0)
  }

  /**
   * How a creative will actually look, rendered by Meta.
   *
   * Returns an iframe snippet per placement. Worth more in an approval step
   * than any description, because it is what people will see.
   */
  async preview(creativeId: string, formats: readonly string[] = ['MOBILE_FEED_STANDARD', 'INSTAGRAM_STORY']): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const format of formats) {
      const data = (await this.#get(`${creativeId}/previews`, { ad_format: format })) as {
        data?: Array<{ body?: string }>
      }
      const body = data.data?.[0]?.body
      if (body !== undefined) out[format] = body
    }
    return out
  }

  /**
   * Creates an instant form on the Page, so a lead campaign needs nothing made
   * by hand in Meta first.
   *
   * Forms belong to the Page, not the ad account, so this acts with the **Page's
   * own token**, fetched with the system user's. That only works because the
   * Page is assigned to the system user — the same assignment the creatives
   * needed.
   *
   * A form is not public on its own. Nobody sees it until an ad opens it.
   *
   * Defaults follow the playbook: **Higher Intent** (a review step before
   * submitting), because frictionless forms produce leads who do not remember
   * signing up. Turn it off only on purpose.
   */
  async createLeadForm(form: LeadFormDraft): Promise<string> {
    if (form.questions.length === 0) {
      throw new PublishError('A lead form needs at least one question.', { failureClass: 'permanent' })
    }
    const custom = form.questions.filter((q) => q.type === 'CUSTOM').length
    if (custom > 3) {
      // The playbook's limit, enforced: four or more custom questions and
      // people abandon the form.
      throw new PublishError(
        `${custom} custom questions. Keep it to three or fewer — more and people abandon the form.`,
        { failureClass: 'permanent' },
      )
    }
    if (!/^https:\/\//i.test(form.privacyPolicyUrl)) {
      throw new PublishError('Meta requires an https privacy policy link on every lead form.', {
        failureClass: 'permanent',
      })
    }

    const page = (await this.#get(this.#account.pageId, { fields: 'access_token' })) as { access_token?: string }
    if (page.access_token === undefined) {
      throw new PublishError(
        "Could not act as the Page. Assign the Page to the system user in Business Settings, with 'Manage Page'.",
        { failureClass: 'credential' },
      )
    }

    const questions = form.questions.map((q) =>
      q.type === 'CUSTOM'
        ? {
            type: 'CUSTOM',
            key: q.key,
            label: q.label,
            ...(q.options !== undefined
              ? { options: q.options.map((value, i) => ({ value, key: `${q.key}_${i + 1}` })) }
              : {}),
          }
        : { type: q.type },
    )

    const body: Record<string, string> = {
      name: form.name,
      questions: JSON.stringify(questions),
      privacy_policy: JSON.stringify({ url: form.privacyPolicyUrl, link_text: form.privacyPolicyText ?? 'Privacy policy' }),
      follow_up_action_url: form.followUpUrl,
      is_optimized_for_quality: String(form.higherIntent ?? true),
      locale: form.locale ?? 'EN_US',
      ...(form.thankYouMessage !== undefined
        ? {
            thank_you_page: JSON.stringify({
              title: form.thankYouTitle ?? 'Thanks — we have your details',
              body: form.thankYouMessage,
              button_type: 'VIEW_WEBSITE',
              button_text: 'Visit website',
              website_url: form.followUpUrl,
            }),
          }
        : {}),
    }

    const data = (await this.#send(`${GRAPH_BASE}/${this.#version}/${this.#account.pageId}/leadgen_forms`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, access_token: page.access_token }),
    })) as { id?: string }

    if (data.id === undefined) {
      throw new PublishError('Meta accepted the form but returned no id.', { failureClass: 'transient' })
    }
    return data.id
  }

  /**
   * How each ad in a campaign is doing, with what the numbers suggest.
   *
   * Reports and suggests; never acts. Every suggestion is a judgement a person
   * should make with context this cannot see — a sale that closed offline, a
   * seasonal dip, an ad still learning. The rules follow the playbook:
   *
   * - **Enough data** means about three times the target cost spent. Below that
   *   a verdict is a guess, and an early "no results" is often just early.
   * - **Fatigue** by frequency: the same people seeing an ad more than ~2.5
   *   times is a warning, more than 4 is past the point of return.
   * - **Weak click-through** below 0.8% once there are enough impressions to
   *   say so.
   *
   * `targetCostMinor` is optional. Without it there is no honest way to call a
   * cost good or bad, so no cost verdict is given.
   */
  async performance(
    campaignId: string,
    options: { datePreset?: string; targetCostMinor?: number; resultAction?: string } = {},
  ): Promise<AdPerformance[]> {
    const data = (await this.#get(`${campaignId}/insights`, {
      level: 'ad',
      date_preset: options.datePreset ?? 'last_7d',
      fields:
        'ad_id,ad_name,spend,impressions,reach,frequency,inline_link_clicks,inline_link_click_ctr,cpm,actions,cost_per_action_type',
      limit: '200',
    })) as { data?: Array<Record<string, unknown>> }

    return (data.data ?? []).map((row) => assessPerformance(row, options))
  }

  /**
   * How a proposed ad will look, before anything exists.
   *
   * Meta renders a creative spec directly through `generatepreviews`, so the
   * approval step can show the actual ad — in Feed, in Stories — rather than a
   * description of one. Returns a link per placement that opens the render in
   * a browser.
   *
   * The links are short-lived; Meta signs them. They are for looking at now,
   * not for storing.
   */
  async previewAd(
    ad: AdPlan['adSets'][number]['ads'][number],
    formats: readonly string[] = ['MOBILE_FEED_STANDARD', 'INSTAGRAM_STANDARD', 'INSTAGRAM_STORY'],
  ): Promise<Record<string, string>> {
    const built = await this.#buildCreative(ad, 0)
    const creative: Record<string, unknown> = {}
    for (const key of ['object_story_spec', 'asset_feed_spec', 'degrees_of_freedom_spec', 'object_story_id']) {
      const value = built[key]
      if (value !== undefined) creative[key] = key === 'object_story_id' ? value : JSON.parse(value)
    }

    const out: Record<string, string> = {}
    for (const format of formats) {
      try {
        const data = (await this.#get(`act_${this.#account.adAccountId}/generatepreviews`, {
          creative: JSON.stringify(creative),
          ad_format: format,
        })) as { data?: Array<{ body?: string }> }
        const link = previewLink(data.data?.[0]?.body)
        if (link !== undefined) out[format] = link
      } catch {
        // A placement that cannot preview this creative is not a failure of the
        // others. It is simply absent from the result.
      }
    }
    return out
  }

  async #get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${GRAPH_BASE}/${this.#version}/${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    url.searchParams.set('access_token', this.#token)
    return await this.#send(url.toString(), { method: 'GET' })
  }

  async #update(id: string, body: Record<string, string>): Promise<void> {
    await this.#send(`${GRAPH_BASE}/${this.#version}/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, access_token: this.#token }),
    })
  }

  async #createCampaign(plan: AdPlan): Promise<string> {
    const body: Record<string, string> = {
      name: campaignName(META_DEFAULT_NAMING.campaign, plan.campaign.name, plan.campaign.objective),
      objective: plan.campaign.objective,
      // Not configurable. See the file comment.
      status: 'PAUSED',
      special_ad_categories: JSON.stringify(plan.campaign.specialCategories ?? []),
      buying_type: 'AUCTION',
    }

    if (plan.campaign.budgetLevel === 'campaign' && plan.campaign.dailyBudget !== undefined) {
      body.daily_budget = minorUnits(plan.campaign.dailyBudget)
      body.bid_strategy = 'LOWEST_COST_WITHOUT_CAP'
    } else {
      /**
       * Mandatory whenever the budget sits on the ad sets rather than the
       * campaign. Meta refuses the campaign outright without it, and the error
       * names the field but not the fact that it is only required in this case.
       *
       * `false` keeps each ad set's budget its own. `true` lets Meta move up to
       * 20% between them, which is reasonable but is a spending decision, so it
       * is not something to switch on by default on someone's behalf.
       */
      body.is_adset_budget_sharing_enabled = 'false'
    }

    return await this.#post('campaigns', body)
  }

  async #createAdSet(
    plan: AdPlan,
    entry: AdPlan['adSets'][number],
    campaignId: string,
    index: number,
  ): Promise<string> {
    const { adSet } = entry
    const instantForm = adSet.leadDestination === 'instant_form'
    /**
     * Traffic optimises for landing page views when a pixel can see them.
     *
     * It was LINK_CLICKS for everything not an instant form. The first real
     * campaign (2026-09-30) showed the cost: a 13.5% click-through rate, 97% of
     * spend on Audience Network, and only 20% of clicks ever loading the page.
     * Meta finds the people a goal asks for; ask for clicks and it finds
     * clickers. Without a pixel Meta cannot count page views, so clicks remain.
     */
    const goal =
      adSet.optimizationGoal ??
      goalForObjective(String(plan.campaign.objective), { instantForm, hasPixel: this.#account.pixelId !== undefined })
    // A Sales or Leads plan that names no event means Purchase or Lead.
    const conversionEvent = adSet.conversionEvent ?? eventForObjective(String(plan.campaign.objective))

    const body: Record<string, string> = {
      name: adSetName(META_DEFAULT_NAMING.adSet, {
        ...(adSet.name !== '' ? { given: adSet.name } : {}),
        countries: adSet.audience.countries,
        ...(adSet.audience.interests !== undefined ? { interests: adSet.audience.interests } : {}),
        optimizationGoal: goal,
      }),
      campaign_id: campaignId,
      status: 'PAUSED',
      billing_event: 'IMPRESSIONS',
      optimization_goal: goal,
      targeting: JSON.stringify(this.#targeting(adSet.audience)),
    }

    /**
     * Attribution windows are constrained by the optimisation goal, and Meta
     * rejects the combination rather than adjusting it.
     *
     * A 7-day click plus 1-day view window only makes sense when optimising for
     * conversions, because there is a conversion to attribute. Optimising for
     * clicks allows only (1, 0) — the click *is* the outcome, so there is nothing
     * to attribute a week later.
     *
     * Sending nothing for click goals lets Meta apply its own default, which is
     * correct by definition and cannot be rejected. Found live: the hardcoded
     * 7d_click_1d_view failed with “the following combinations… are allowed:
     * (1, 0)”.
     */
    if (META_CONVERSION_GOALS.has(goal)) {
      body.attribution_spec = JSON.stringify(ATTRIBUTION_SPECS['7d_click_1d_view'])
    }

    if (adSet.dailyBudget !== undefined) {
      body.daily_budget = minorUnits(adSet.dailyBudget)
      body.bid_strategy = 'LOWEST_COST_WITHOUT_CAP'
    }

    // Set at creation or never: Meta will not switch an existing ad set to
    // dynamic creative, so a mistake here means rebuilding the ad set.
    if (entry.ads.some(isDynamicCreative)) body.is_dynamic_creative = 'true'

    /**
     * The pixel and event are what the algorithm actually optimises toward.
     * Without them a conversion goal is a request Meta cannot act on.
     */
    /**
     * An instant form is captured on the Page, inside Meta, so the ad set
     * promotes the Page and delivers "on ad" rather than to a website. No pixel
     * is involved.
     */
    if (instantForm) {
      body.promoted_object = JSON.stringify({ page_id: this.#account.pageId })
      body.destination_type = 'ON_AD'
    } else if (conversionEvent !== undefined && this.#account.pixelId !== undefined) {
      body.promoted_object = JSON.stringify({
        pixel_id: this.#account.pixelId,
        custom_event_type: conversionEvent,
      })
      body.destination_type = 'WEBSITE'
    }

    if (adSet.startAt !== undefined) body.start_time = adSet.startAt.toISOString()
    if (adSet.endAt !== undefined) body.end_time = adSet.endAt.toISOString()

    return await this.#post('adsets', body)
  }

  #targeting(audience: AdPlan['adSets'][number]['adSet']['audience']): Record<string, unknown> {
    /**
     * Advantage audience and a hard age range are mutually exclusive.
     *
     * With advantage audience on, Meta treats the age bounds as a *suggestion*
     * and expands past them when it finds cheaper results. Narrowing the range
     * is then rejected — with the memorable message “you can add a lower maximum
     * age as a suggestion instead”, which does not mention the setting causing it.
     *
     * The flag is also **mandatory**: omitting it is refused with “you need to
     * enable or disable the Advantage audience feature”. So it is always sent,
     * explicitly 1 or 0.
     *
     * An explicit age range is read as what it is: a decision to hold the
     * audience fixed, so the flag goes to 0. Left at the defaults it goes to 1,
     * where it is the better-performing choice in most accounts.
     */
    const narrowedAge =
      (audience.ageMin !== undefined && audience.ageMin !== 18) ||
      (audience.ageMax !== undefined && audience.ageMax !== 65)

    const spec: Record<string, unknown> = {
      geo_locations: { countries: audience.countries },
      age_min: audience.ageMin ?? 18,
      age_max: audience.ageMax ?? 65,
      targeting_automation: { advantage_audience: narrowedAge ? 0 : 1 },
    }

    const genders = GENDER_CODES[audience.genders ?? 'all']
    if (genders !== undefined) spec.genders = genders
    if (audience.languages !== undefined) spec.locales = audience.languages

    if ((audience.interests?.length ?? 0) > 0) {
      spec.flexible_spec = [{ interests: audience.interests!.map((id) => ({ id: String(id) })) }]
    }

    // Anything the caller knows that this model does not, passed through as-is.
    return { ...spec, ...(audience.platformTargeting ?? {}) }
  }

  async #createCreative(ad: AdPlan['adSets'][number]['ads'][number], index: number): Promise<string> {
    return await this.#post('adcreatives', await this.#buildCreative(ad, index))
  }

  /**
   * Everything a creative is made of, without creating it.
   *
   * Split out so the same spec can be *previewed* before anything exists:
   * Meta renders a spec directly, which is what lets an approval show the ad as
   * people will see it rather than a description of it. Media is uploaded here,
   * which stores it in the ad account's library but makes nothing public and
   * spends nothing.
   */
  async #buildCreative(
    ad: AdPlan['adSets'][number]['ads'][number],
    index: number,
  ): Promise<Record<string, string>> {
    const name = `${ad.name !== '' ? ad.name : `ad-${index + 1}`}-creative`

    // Boosting something already published: the post carries its own copy and
    // link, so supplying them again would be ignored at best.
    if (ad.creative?.kind === 'existing_post') {
      return { name, object_story_id: ad.creative.postId! }
    }

    const texts = effectiveTexts(ad)
    const assets = assetsOf(ad)

    // An instant form still needs a link in the creative, even though nobody
    // is sent there. The Page itself is the honest value when none was given.
    const link = ad.landingPageUrl ?? `https://www.facebook.com/${this.#account.pageId}`
    const callToAction: Record<string, unknown> = {
      type: ad.callToAction ?? (ad.leadFormId !== undefined ? 'SIGN_UP' : 'LEARN_MORE'),
      value: ad.leadFormId !== undefined ? { lead_gen_form_id: ad.leadFormId, link } : { link },
    }

    const storySpec: Record<string, unknown> = {
      page_id: this.#account.pageId,
      // instagram_user_id, not the older instagram_actor_id: Meta refused the old
      // field for Muzaree's account on 2026-10-08 ("must be a valid Instagram
      // account id") while its own live ads carry instagram_user_id.
      ...(this.#account.instagramId !== undefined
        ? { instagram_user_id: this.#account.instagramId }
        : {}),
    }

    const body: Record<string, string> = {
      name,
      // Meta fills these at click time; they must reach it unexpanded.
      url_tags: urlTags(ad.urlTags),
      degrees_of_freedom_spec: JSON.stringify(enhancementsSpec(ad.platformEnhancements === true)),
    }

    /**
     * One text and at most one file is an ordinary creative. Anything more —
     * several texts, or files in several shapes — uses Meta's asset feed, which
     * is how one ad carries up to five of each and serves each placement the
     * right file.
     */
    // One description is an ordinary field, not a reason to use the asset
    // feed: using it for a single description made the ad a dynamic creative,
    // with all the restrictions that brings, for no benefit.
    const flexible =
      texts.bodies.length > 1 ||
      texts.headlines.length > 1 ||
      texts.descriptions.length > 1 ||
      assets.length > 1

    if (!flexible) {
      const asset = assets[0]
      if (asset?.kind === 'video') {
        const video = await this.#uploadVideo(asset)
        storySpec.video_data = {
          video_id: video.id,
          ...(video.thumbnailHash !== undefined
            ? { image_hash: video.thumbnailHash }
            : { image_url: video.thumbnailUrl }),
          message: texts.bodies[0],
          title: texts.headlines[0],
          call_to_action: callToAction,
        }
      } else {
        storySpec.link_data = {
          link,
          message: texts.bodies[0],
          name: texts.headlines[0],
          ...(texts.descriptions[0] !== undefined ? { description: texts.descriptions[0] } : {}),
          call_to_action: callToAction,
          ...(asset !== undefined ? { image_hash: await this.#uploadImage(asset.localPath) } : {}),
        }
      }
      body.object_story_spec = JSON.stringify(storySpec)
      return body
    }

    const images: Array<Record<string, unknown>> = []
    const videos: Array<Record<string, unknown>> = []
    for (const asset of assets) {
      const adlabels = [{ name: labelFor(asset.aspectRatio) }]
      if (asset.kind === 'image') {
        images.push({ hash: await this.#uploadImage(asset.localPath), adlabels })
      } else {
        const video = await this.#uploadVideo(asset)
        videos.push({
          video_id: video.id,
          ...(video.thumbnailHash !== undefined
            ? { thumbnail_hash: video.thumbnailHash }
            : { thumbnail_url: video.thumbnailUrl }),
          adlabels,
        })
      }
    }

    const rules = placementRules(assets)
    const feed: Record<string, unknown> = {
      bodies: texts.bodies.map((text) => ({ text })),
      titles: texts.headlines.map((text) => ({ text })),
      ...(texts.descriptions.length > 0
        ? { descriptions: texts.descriptions.map((text) => ({ text })) }
        : {}),
      link_urls: [{ website_url: link }],
      call_to_action_types: [callToAction.type],
      ...(images.length > 0 ? { images } : {}),
      ...(videos.length > 0 ? { videos } : {}),
      ad_formats: [
        images.length > 0 && videos.length > 0
          ? 'AUTOMATIC_FORMAT'
          : videos.length > 0
            ? 'SINGLE_VIDEO'
            : 'SINGLE_IMAGE',
      ],
      ...(rules.length > 0
        ? { optimization_type: 'PLACEMENT', asset_customization_rules: rules }
        : {}),
    }

    body.object_story_spec = JSON.stringify(storySpec)
    body.asset_feed_spec = JSON.stringify(feed)
    return body
  }

  /**
   * Uploads a video and waits until Meta has processed it.
   *
   * Always in chunks, whatever the size. Meta's resumable upload is three
   * phases — start, transfer, finish — and Meta says which byte range it wants
   * next after every chunk. The file is read from disk one chunk at a time, so
   * a 2 GB video costs no more memory than a 2 MB one. One code path rather
   * than a "small file" shortcut, because the shortcut held the whole file in
   * memory and capped uploads at 100 MB.
   *
   * Upload and readiness are separate events: a creative that references a
   * video still processing is refused, so this polls until it is ready.
   */
  async #uploadVideo(asset: AdAsset): Promise<{ id: string; thumbnailUrl?: string; thumbnailHash?: string }> {
    const size = (await stat(asset.localPath).catch(() => undefined))?.size
    if (size === undefined) {
      throw new PublishError(`Could not read the video at ${asset.localPath}`, { failureClass: 'permanent' })
    }
    // Meta's reported ceiling for ad video files.
    if (size > 4 * 1024 * 1024 * 1024) {
      throw new PublishError(
        `The video is ${(size / 1024 / 1024 / 1024).toFixed(1)} GB, above Meta's 4 GB limit for ad videos.`,
        { failureClass: 'permanent' },
      )
    }

    const url = `${GRAPH_BASE}/${this.#version}/act_${this.#account.adAccountId}/advideos`
    const form = (fields: Record<string, string>, chunk?: Uint8Array) => {
      const f = new FormData()
      f.append('access_token', this.#token)
      for (const [k, v] of Object.entries(fields)) f.append(k, v)
      if (chunk !== undefined) f.append('video_file_chunk', new Blob([chunk]), basename(asset.localPath))
      return f
    }

    const started = (await this.#send(url, {
      method: 'POST',
      body: form({ upload_phase: 'start', file_size: String(size) }),
    })) as { upload_session_id?: string; video_id?: string; start_offset?: string; end_offset?: string }

    const session = started.upload_session_id
    const videoId = started.video_id
    if (session === undefined || videoId === undefined) {
      throw new PublishError('Meta did not open an upload session for the video.', { failureClass: 'transient' })
    }

    const handle = await open(asset.localPath, 'r')
    try {
      let from = Number(started.start_offset ?? 0)
      let to = Number(started.end_offset ?? size)
      let guard = 0
      while (from < to) {
        // Meta chooses each range. A server that stops advancing would
        // otherwise loop forever, so the number of rounds is bounded.
        if (++guard > 10_000) {
          throw new PublishError('The video upload stopped making progress.', { failureClass: 'transient' })
        }
        const length = to - from
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await handle.read(buffer, 0, length, from)
        if (bytesRead !== length) {
          throw new PublishError('The video file changed while it was being uploaded.', { failureClass: 'transient' })
        }
        const next = (await this.#send(url, {
          method: 'POST',
          body: form(
            { upload_phase: 'transfer', upload_session_id: session, start_offset: String(from) },
            new Uint8Array(buffer),
          ),
        })) as { start_offset?: string; end_offset?: string }
        from = Number(next.start_offset ?? to)
        to = Number(next.end_offset ?? to)
      }
    } finally {
      await handle.close()
    }

    await this.#send(url, {
      method: 'POST',
      body: form({ upload_phase: 'finish', upload_session_id: session }),
    })
    const uploaded = { id: videoId }

    const deadline = Date.now() + 5 * 60 * 1000
    for (;;) {
      const state = (await this.#get(uploaded.id, { fields: 'status' })) as {
        status?: { video_status?: string }
      }
      const status = state.status?.video_status
      if (status === 'ready') break
      if (status === 'error') {
        throw new PublishError('Meta could not process the video. Check its format and encoding.', {
          failureClass: 'permanent',
        })
      }
      if (Date.now() > deadline) {
        throw new PublishError('Meta was still processing the video after 5 minutes.', {
          failureClass: 'transient',
        })
      }
      await new Promise((resolve) => setTimeout(resolve, this.#pollMs))
    }

    // A thumbnail the owner chose beats one Meta picked, which is often a poor
    // frame. Only when none was given is Meta's preferred one used.
    if (asset.thumbnailPath !== undefined) {
      return { id: uploaded.id, thumbnailHash: await this.#uploadImage(asset.thumbnailPath) }
    }
    const thumbs = (await this.#get(`${uploaded.id}/thumbnails`, { fields: 'uri,is_preferred' })) as {
      data?: Array<{ uri?: string; is_preferred?: boolean }>
    }
    const preferred = thumbs.data?.find((t) => t.is_preferred) ?? thumbs.data?.[0]
    if (preferred?.uri === undefined) {
      throw new PublishError('Meta processed the video but offered no thumbnail. Supply one.', {
        failureClass: 'permanent',
      })
    }
    return { id: uploaded.id, thumbnailUrl: preferred.uri }
  }

  /** Uploads an image and returns its hash, which is what a creative references. */
  async #uploadImage(path: string): Promise<string> {
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await readFile(path))
    } catch (cause) {
      throw new PublishError(`Could not read the creative image at ${path}`, {
        failureClass: 'permanent',
        cause,
      })
    }

    const form = new FormData()
    form.append('access_token', this.#token)
    form.append('filename', new Blob([bytes]), basename(path))

    const url = `${GRAPH_BASE}/${this.#version}/act_${this.#account.adAccountId}/adimages`
    const data = await this.#send(url, { method: 'POST', body: form })

    // Meta keys the response by filename rather than returning a flat object.
    const images = (data as { images?: Record<string, { hash?: string }> }).images ?? {}
    const hash = Object.values(images)[0]?.hash
    if (hash === undefined) {
      throw new PublishError(`Meta accepted the image upload but returned no hash for ${path}.`, {
        failureClass: 'transient',
      })
    }
    return hash
  }

  async #post(edge: string, body: Record<string, string>): Promise<string> {
    const url = `${GRAPH_BASE}/${this.#version}/act_${this.#account.adAccountId}/${edge}`
    const form = new URLSearchParams({ ...body, access_token: this.#token })

    const data = await this.#send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    })

    const id = (data as { id?: string }).id
    if (id === undefined) {
      throw new PublishError(`Meta created something on ${edge} but returned no id.`, {
        failureClass: 'transient',
      })
    }
    return id
  }

  async #send(url: string, init: RequestInit): Promise<unknown> {
    let response: Response
    try {
      response = await this.#fetch(url, init)
    } catch (cause) {
      throw new PublishError('Could not reach the Meta Marketing API', {
        failureClass: classifyNetworkError(cause),
        cause,
      })
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      throw new PublishError(`Meta returned a response that was not JSON (HTTP ${response.status})`, {
        failureClass: response.ok ? 'permanent' : 'transient',
        httpStatus: response.status,
      })
    }

    if (!response.ok) {
      const error = (parsed as { error?: { message?: string; error_user_msg?: string; code?: number } })
        .error
      // error_user_msg is the human-readable one when Meta bothers to send it,
      // and it is usually far better than the developer message.
      const message = error?.error_user_msg ?? error?.message ?? `HTTP ${response.status}`
      throw new PublishError(`Meta rejected the request: ${message}`, {
        failureClass: classifyHttpStatus(response.status),
        platformMessage: message,
        ...(error?.code !== undefined ? { platformCode: String(error.code) } : {}),
        httpStatus: response.status,
      })
    }

    return parsed
  }
}
