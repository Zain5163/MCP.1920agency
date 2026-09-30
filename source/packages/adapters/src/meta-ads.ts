import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import {
  PublishError,
  classifyHttpStatus,
  classifyNetworkError,
  describePlan,
  validateAdPlan,
  type AdPlan,
  type Money,
} from '@social-publisher/core'

import {
  META_CONVERSION_GOALS,
  checkMetaAdPlan,
  type MetaCheckContext,
} from './meta-ads-guardrails.ts'
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
}

/** States in which an ad will never deliver, whatever its own status says. */
const REJECTED_STATES = new Set(['DISAPPROVED', 'WITH_ISSUES'])
const IN_REVIEW_STATES = new Set(['IN_PROCESS', 'PENDING_REVIEW'])

export class MetaAdsClient {
  readonly #account: MetaAdAccount
  readonly #token: string
  readonly #version: string
  readonly #fetch: typeof globalThis.fetch

  constructor(options: MetaAdsOptions) {
    this.#account = options.account
    this.#token = options.accessToken
    this.#version = options.apiVersion ?? META_ADS_API_VERSION
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  /**
   * Checks a plan without creating anything.
   *
   * Separate from `create` on purpose: this is what an AI should call before
   * asking a person to approve, and it must be impossible for it to have side
   * effects.
   */
  review(plan: AdPlan, context: MetaCheckContext = {}): {
    ok: boolean
    errors: string[]
    warnings: string[]
    summary: string
  } {
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
  async create(plan: AdPlan, context: MetaCheckContext = {}): Promise<CreateResult> {
    const review = this.review(plan, context)
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
  async status(campaignId: string): Promise<CampaignStatus> {
    const campaign = await this.#get(campaignId, {
      fields: 'id,name,status,effective_status,daily_budget',
    })
    const adSets = await this.#get(`${campaignId}/adsets`, {
      fields: 'id,name,status,effective_status,daily_budget',
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

    return {
      campaign: toStatus(campaign as Record<string, unknown>),
      adSets: adSetRows,
      ads: adRows,
      dailyBudgetMinor,
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
    const goal = adSet.optimizationGoal ?? 'LINK_CLICKS'

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

    /**
     * The pixel and event are what the algorithm actually optimises toward.
     * Without them a conversion goal is a request Meta cannot act on.
     */
    if (adSet.conversionEvent !== undefined && this.#account.pixelId !== undefined) {
      body.promoted_object = JSON.stringify({
        pixel_id: this.#account.pixelId,
        custom_event_type: adSet.conversionEvent,
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
    const name = `${ad.name !== '' ? ad.name : `ad-${index + 1}`}-creative`

    // Boosting something already published: the post carries its own copy and
    // link, so supplying them again would be ignored at best.
    if (ad.creative?.kind === 'existing_post') {
      return await this.#post('adcreatives', {
        name,
        object_story_id: ad.creative.postId!,
      })
    }

    const linkData: Record<string, unknown> = {
      link: ad.landingPageUrl,
      message: ad.body,
      name: ad.headline,
      call_to_action: { type: ad.callToAction ?? 'LEARN_MORE' },
    }

    if (ad.creative?.kind === 'image' && ad.creative.localPath !== undefined) {
      linkData.image_hash = await this.#uploadImage(ad.creative.localPath)
    }

    const body: Record<string, string> = {
      name,
      object_story_spec: JSON.stringify({
        page_id: this.#account.pageId,
        ...(this.#account.instagramId !== undefined
          ? { instagram_actor_id: this.#account.instagramId }
          : {}),
        link_data: linkData,
      }),
      // Meta fills these at click time; they must reach it unexpanded.
      url_tags: urlTags(ad.urlTags),
    }

    return await this.#post('adcreatives', body)
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
