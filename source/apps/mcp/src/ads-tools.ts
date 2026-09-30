import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { META_OBJECTIVES, MetaAdsClient, expandForPlacements, type MetaAdAccount } from '@social-publisher/adapters'
import { optional } from '@social-publisher/config'
import {
  checkSpend,
  decide,
  formatApprovalRequest,
  formatMoney,
  totalDailyBudget,
  type AdPlan,
  type SpendLimit,
} from '@social-publisher/core'

import { currentScope } from './context.ts'

/**
 * Advertising tools for the MCP server.
 *
 * **Registered on the local (stdio) server only.** The account and token come
 * from the owner's environment, which makes this single-tenant by construction
 * — exactly right for the owner running their own ads, and exactly wrong for a
 * hosted server where each caller is a different customer. The hosted server
 * gets these tools once ad accounts are stored per tenant, which decision 0005
 * records as the change required first.
 *
 * Every tool that can spend goes through three gates, in this order:
 *
 *   1. **Validation** — the plan is refused outright if it would fail at Meta or
 *      is illegal.
 *   2. **The spend ceiling** — checked against everything the account already
 *      spends, not just this campaign, and refused if no ceiling is configured.
 *   3. **Approval** — a token covering the exact plan, returned only after a
 *      person has seen the cost.
 *
 * The AI can propose anything. What it can execute is decided here, in code.
 */

type ToolResult = { content: Array<{ type: 'text'; text: string }> }
const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })

/** Reads the account from the environment, or explains exactly what is missing. */
function loadClient(): { client: MetaAdsClient; account: MetaAdAccount } | { error: string } {
  const accessToken = optional('META_ADS_ACCESS_TOKEN')
  const adAccountId = optional('META_AD_ACCOUNT_ID')
  const pageId = optional('META_ADS_PAGE_ID')
  const currency = optional('META_AD_ACCOUNT_CURRENCY')

  const missing = [
    ['META_ADS_ACCESS_TOKEN', accessToken],
    ['META_AD_ACCOUNT_ID', adAccountId],
    ['META_ADS_PAGE_ID', pageId],
    ['META_AD_ACCOUNT_CURRENCY', currency],
  ]
    .filter(([, value]) => value === undefined)
    .map(([key]) => key)

  if (missing.length > 0) {
    return {
      error:
        `Ads are not configured. Missing from ~/.social-publisher/.env: ${missing.join(', ')}.\n` +
        'Nothing was created.',
    }
  }

  const instagramId = optional('META_ADS_INSTAGRAM_ID')
  const pixelId = optional('META_PIXEL_ID')
  const account: MetaAdAccount = {
    adAccountId: adAccountId!,
    pageId: pageId!,
    currency: currency!,
    ...(instagramId !== undefined ? { instagramId } : {}),
    ...(pixelId !== undefined ? { pixelId } : {}),
  }
  return { client: new MetaAdsClient({ account, accessToken: accessToken! }), account }
}

/**
 * The spend ceiling, from the environment, in whole currency units.
 *
 * **Refuses when unset, rather than defaulting.** Any default would be a number
 * chosen by the software on the owner's behalf, and a ceiling nobody chose is
 * not a ceiling. Whole units in the file because that is how people think about
 * budgets; converted to minor units immediately, so nothing downstream sees a
 * float.
 */
function loadLimit(currency: string): SpendLimit | { error: string } {
  const daily = optional('META_ADS_DAILY_LIMIT')
  const monthly = optional('META_ADS_MONTHLY_LIMIT')

  if (daily === undefined || monthly === undefined) {
    return {
      error:
        'No spend ceiling is configured, so nothing that can spend will run.\n\n' +
        'Add both to ~/.social-publisher/.env, in whole units of the account currency:\n' +
        `  META_ADS_DAILY_LIMIT=     (most per day across ALL active campaigns, in ${currency})\n` +
        `  META_ADS_MONTHLY_LIMIT=   (most per month, in ${currency})\n\n` +
        'There is deliberately no default: a ceiling the software picked is not one you chose.',
    }
  }

  const parse = (value: string, name: string): number | string => {
    const n = Number(value)
    return Number.isInteger(n) && n > 0 ? n * 100 : `${name} must be a whole number above zero, got "${value}".`
  }
  const d = parse(daily, 'META_ADS_DAILY_LIMIT')
  const m = parse(monthly, 'META_ADS_MONTHLY_LIMIT')
  if (typeof d === 'string') return { error: d }
  if (typeof m === 'string') return { error: m }

  // Optional, unlike the ceiling: a missing floor refuses nothing it should.
  const minimum = optional('META_ADS_DAILY_MINIMUM')
  let min: number | undefined
  if (minimum !== undefined) {
    const parsed = parse(minimum, 'META_ADS_DAILY_MINIMUM')
    if (typeof parsed === 'string') return { error: parsed }
    min = parsed
  }

  return { dailyMaxMinor: d, monthlyMaxMinor: m, ...(min !== undefined ? { dailyMinMinor: min } : {}), currency }
}

/**
 * The plan as an AI supplies it.
 *
 * Budgets are in whole or decimal currency units here, because that is what a
 * person says ("5000 rupees a day"), and converted to integer minor units
 * straight away.
 */
const adShape = z.object({
  name: z.string().describe('Short identifier, e.g. "hook-consistency".'),
  primaryTexts: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe('1 to 5 primary texts, each a different angle. Hook in the first ~125 characters.'),
  headlines: z.array(z.string()).min(1).max(5).describe('1 to 5 headlines, each under ~40 characters.'),
  descriptions: z.array(z.string()).max(5).optional().describe('Up to 5 short descriptions.'),
  landingPageUrl: z
    .string()
    .optional()
    .describe('https URL the ad sends people to. Not needed for instant-form ads.'),
  callToAction: z.string().optional().describe('e.g. LEARN_MORE, SIGN_UP, CONTACT_US, SHOP_NOW.'),
  files: z
    .array(
      z.object({
        path: z.string().describe('Absolute path to a local image or video.'),
        kind: z.enum(['image', 'video']),
        aspectRatio: z
          .enum(['1:1', '4:5', '9:16', '1.91:1'])
          .describe('4:5 for Feed, 9:16 for Stories and Reels, 1:1 square, 1.91:1 landscape.'),
        thumbnailPath: z.string().optional().describe('Video only: the frame to show before it plays.'),
      }),
    )
    .max(20)
    .optional()
    .describe('Supply several shapes and each placement gets the one that fits.'),
  leadFormId: z.string().optional().describe('Instant-form ads only: the id of the lead form to open.'),
  allowMetaEnhancements: z
    .boolean()
    .optional()
    .describe("Let Meta's AI alter the creative. Off unless the user asks for it."),
})

const planShape = {
  campaignName: z.string(),
  objective: z.enum(META_OBJECTIVES),
  adSets: z
    .array(
      z.object({
        name: z.string(),
        dailyBudget: z
          .number()
          .positive()
          .describe('Per day, in the ad account currency, as a person would say it: 5000 means 5,000.'),
        countries: z.array(z.string()).describe('Two-letter ISO codes, e.g. ["PK"].'),
        ageMin: z.number().int().optional(),
        ageMax: z.number().int().optional(),
        optimizationGoal: z
          .string()
          .optional()
          .describe('e.g. LINK_CLICKS. Conversion goals also need a conversionEvent and a pixel.'),
        conversionEvent: z.string().optional(),
        leadDestination: z
          .enum(['website', 'instant_form'])
          .optional()
          .describe('For lead campaigns: a landing page, or a form inside Facebook.'),
        endDate: z.string().optional().describe('ISO date. Without one the campaign runs until stopped.'),
        ads: z.array(adShape),
      }),
    )
    .min(1),
}

type PlanArgs = z.infer<z.ZodObject<typeof planShape>>

function toPlan(args: PlanArgs, currency: string): AdPlan {
  return {
    campaign: { name: args.campaignName, objective: args.objective as never, budgetLevel: 'adset' },
    adSets: args.adSets.map((entry) => ({
      adSet: {
        name: entry.name,
        dailyBudget: { minor: Math.round(entry.dailyBudget * 100), currency },
        audience: {
          countries: entry.countries,
          ...(entry.ageMin !== undefined ? { ageMin: entry.ageMin } : {}),
          ...(entry.ageMax !== undefined ? { ageMax: entry.ageMax } : {}),
        },
        ...(entry.optimizationGoal !== undefined ? { optimizationGoal: entry.optimizationGoal } : {}),
        ...(entry.conversionEvent !== undefined ? { conversionEvent: entry.conversionEvent } : {}),
        ...(entry.leadDestination !== undefined ? { leadDestination: entry.leadDestination } : {}),
        ...(entry.endDate !== undefined ? { endAt: new Date(entry.endDate) } : {}),
      },
      ads: entry.ads.map((ad) => ({
        name: ad.name,
        body: ad.primaryTexts[0] ?? '',
        bodies: ad.primaryTexts,
        headlines: ad.headlines,
        ...(ad.descriptions !== undefined ? { descriptions: ad.descriptions } : {}),
        ...(ad.landingPageUrl !== undefined ? { landingPageUrl: ad.landingPageUrl } : {}),
        ...(ad.callToAction !== undefined ? { callToAction: ad.callToAction } : {}),
        ...(ad.leadFormId !== undefined ? { leadFormId: ad.leadFormId } : {}),
        ...(ad.allowMetaEnhancements === true ? { platformEnhancements: true } : {}),
        ...(ad.files !== undefined
          ? {
              assets: ad.files.map((f) => ({
                kind: f.kind,
                localPath: f.path,
                aspectRatio: f.aspectRatio,
                ...(f.thumbnailPath !== undefined ? { thumbnailPath: f.thumbnailPath } : {}),
              })),
            }
          : {}),
      })),
    })),
  }
}

/**
 * How many days the plan runs, if every ad set has an end date.
 *
 * One open-ended ad set makes the whole plan open-ended, because it keeps
 * spending after the others stop.
 */
function durationDays(plan: AdPlan): number | undefined {
  const now = Date.now()
  let longest = 0
  for (const { adSet } of plan.adSets) {
    if (adSet.endAt === undefined) return undefined
    const start = adSet.startAt?.getTime() ?? now
    longest = Math.max(longest, (adSet.endAt.getTime() - start) / 86_400_000)
  }
  return longest > 0 ? longest : undefined
}

async function audit(action: string, detail: Record<string, unknown>): Promise<void> {
  // An audit failure must never be why an ad was or was not created, so it is
  // attempted and not allowed to throw.
  try {
    const scope = await currentScope()
    await scope.record('mcp', action, detail)
  } catch {
    // Recorded in telemetry by the caller's own logging, not here.
  }
}

async function guarded(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn()
  } catch (error) {
    return text(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function registerAdsTools(server: McpServer): void {
  server.tool(
    'review_ad_plan',
    'Check a Meta ad campaign plan WITHOUT creating anything: cost, errors, and best-practice warnings. Always run this before create_ad_plan and show the result to the user.',
    planShape,
    async (args) =>
      await guarded(async () => {
        const loaded = loadClient()
        if ('error' in loaded) return text(loaded.error)

        const plan = toPlan(args, loaded.account.currency)
        const review = loaded.client.review(plan)
        const lines = [review.summary, '']
        let budgetBlocked = false

        const limit = loadLimit(loaded.account.currency)
        const total = totalDailyBudget(plan)
        if (!('error' in limit) && total !== undefined) {
          const committed = await loaded.client.committedDailySpendMinor()
          const days = durationDays(plan)
          const spend = checkSpend(
            limit,
            { dailyMinor: total.minor, currency: total.currency, ...(days !== undefined ? { durationDays: days } : {}) },
            committed,
          )
          if (!spend.ok) {
            lines.push(`WILL NOT BE CREATED — budget: ${spend.reason}`, '')
            budgetBlocked = true
          }
        }

        if (review.errors.length > 0) {
          lines.push('WILL NOT BE CREATED — fix these first:', ...review.errors.map((e) => `  • ${e}`), '')
        }
        if (review.warnings.length > 0) {
          lines.push('Warnings (do not block, but read them):', ...review.warnings.map((w) => `  • ${w}`))
        }
        // Only when nothing at all stands in the way. Printing it under a budget
        // refusal contradicted the line above it.
        if (review.ok && review.warnings.length === 0 && !budgetBlocked) lines.push('No problems found.')
        return text(lines.join('\n'))
      }),
  )

  server.tool(
    'create_ad_plan',
    'Create a Meta ad campaign. Everything is created PAUSED and cannot spend until activate_campaign. Call once WITHOUT a confirm token to get the approval summary, show it to the user, and only call again with the token once they approve.',
    { ...planShape, confirm: z.string().optional().describe('Approval token from the previous call.') },
    async (args) =>
      await guarded(async () => {
        const loaded = loadClient()
        if ('error' in loaded) return text(loaded.error)

        const limit = loadLimit(loaded.account.currency)
        if ('error' in limit) return text(limit.error)

        const { confirm, ...planArgs } = args
        const plan = toPlan(planArgs, loaded.account.currency)

        const review = loaded.client.review(plan)
        if (!review.ok) {
          return text(`Nothing was created.\n\n${review.errors.map((e) => `• ${e}`).join('\n')}`)
        }

        /**
         * Checked at creation as well as at activation. Creating does not spend,
         * but a plan that could never be activated within the ceiling is better
         * refused now than discovered after the work of building it.
         */
        const total = totalDailyBudget(plan)
        if (total !== undefined) {
          const committed = await loaded.client.committedDailySpendMinor()
          const days = durationDays(plan)
          const spend = checkSpend(
            limit,
            { dailyMinor: total.minor, currency: total.currency, ...(days !== undefined ? { durationDays: days } : {}) },
            committed,
          )
          if (!spend.ok) return text(`Nothing was created. ${spend.reason}`)
        }

        /**
         * The real ad, rendered by Meta, shown at the moment of approval. A
         * description of an ad is not what people will see; this is. Only on
         * the first call — the approving call does not need to render it again.
         */
        const previews: string[] = []
        if (confirm === undefined) {
          // The first ad that will actually exist. A requested ad with several
          // texts and several shapes is split before creation, so previewing the
          // request would show an ad nobody will ever see.
          const first = expandForPlacements(plan).adSets[0]?.ads[0]
          if (first !== undefined) {
            try {
              const links = await loaded.client.previewAd(first)
              for (const [format, link] of Object.entries(links)) previews.push(`  ${format}: ${link}`)
            } catch {
              previews.push('  (Meta could not render a preview for this ad.)')
            }
          }
        }

        const gate = decide({
          action: 'create_ad_plan',
          payload: planArgs,
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () =>
            [
              review.summary,
              ...(review.warnings.length > 0
                ? ['', 'Warnings:', ...review.warnings.map((w) => `  • ${w}`)]
                : []),
              ...(previews.length > 0
                ? ['', 'How the first ad will look (open in a browser; links expire):', ...previews]
                : []),
            ].join('\n'),
        })
        if (!gate.allowed) return text(formatApprovalRequest(gate))

        const result = await loaded.client.create(plan)
        await audit('ads.plan.created', {
          campaignId: result.created.campaignId,
          ads: result.created.adIds.length,
          dailyMinor: total?.minor,
        })

        return text(
          [
            'Created, everything PAUSED. Nothing is spending.',
            `  campaign  ${result.created.campaignId}`,
            `  ad sets   ${result.created.adSetIds.length}`,
            `  ads       ${result.created.adIds.length}`,
            '',
            'Meta now reviews the ads, which can take hours. Check with get_campaign_status',
            'before activating: an ad can be rejected after it was created successfully.',
          ].join('\n'),
        )
      }),
  )

  server.tool(
    'get_campaign_status',
    "Read what a Meta campaign is actually doing, including ads rejected or still in Meta's policy review.",
    { campaignId: z.string() },
    async ({ campaignId }) =>
      await guarded(async () => {
        const loaded = loadClient()
        if ('error' in loaded) return text(loaded.error)

        const status = await loaded.client.status(campaignId)
        const lines = [
          `Campaign ${status.campaign.name}: ${status.campaign.effectiveStatus}`,
          `Daily budget: ${formatMoney({ minor: status.dailyBudgetMinor, currency: loaded.account.currency })}`,
          '',
          ...status.ads.map((ad) => `  ${ad.effectiveStatus.padEnd(16)} ${ad.name}`),
        ]
        if (status.rejected.length > 0) {
          lines.push('', `REJECTED by Meta (${status.rejected.length}) — these will not run:`)
          for (const ad of status.rejected) {
            lines.push(`  ${ad.name}: ${JSON.stringify(ad.reviewFeedback ?? 'no reason given')}`)
          }
        }
        if (status.inReview.length > 0) {
          lines.push('', `${status.inReview.length} ad(s) still in Meta's review.`)
        }
        return text(lines.join('\n'))
      }),
  )

  server.tool(
    'activate_campaign',
    'Start a paused Meta campaign. THIS SPENDS REAL MONEY until stopped. Call once WITHOUT a confirm token to get the approval summary, show it to the user, and only call again with the token once they approve.',
    { campaignId: z.string(), confirm: z.string().optional() },
    async ({ campaignId, confirm }) =>
      await guarded(async () => {
        const loaded = loadClient()
        if ('error' in loaded) return text(loaded.error)

        const limit = loadLimit(loaded.account.currency)
        if ('error' in limit) return text(limit.error)

        const status = await loaded.client.status(campaignId)
        if (status.rejected.length > 0) {
          return text(
            `Not activated. ${status.rejected.length} ad(s) were rejected by Meta. Run get_campaign_status for the reasons.`,
          )
        }

        const committed = await loaded.client.committedDailySpendMinor()
        const spend = checkSpend(
          limit,
          { dailyMinor: status.dailyBudgetMinor, currency: loaded.account.currency },
          committed,
        )
        if (!spend.ok) return text(`Not activated. ${spend.reason}`)

        const daily = { minor: status.dailyBudgetMinor, currency: loaded.account.currency }
        const gate = decide({
          action: 'activate_campaign',
          // The budget is part of what is approved. If it changes between the
          // approval and the second call, the token no longer matches.
          payload: { campaignId, dailyBudgetMinor: status.dailyBudgetMinor },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () =>
            [
              `Activate "${status.campaign.name}"`,
              `  ${formatMoney(daily)} per day, roughly ${formatMoney({ minor: daily.minor * 30, currency: daily.currency })} per month`,
              `  ${status.ads.length} ad(s)${status.inReview.length > 0 ? `, ${status.inReview.length} still in review` : ''}`,
              '',
              'Money leaves the ad account from this moment until the campaign is paused.',
            ].join('\n'),
        })
        if (!gate.allowed) return text(formatApprovalRequest(gate))

        const after = await loaded.client.activate(campaignId)
        await audit('ads.campaign.activated', { campaignId, dailyMinor: status.dailyBudgetMinor })
        return text(`Activated. Campaign is now ${after.campaign.effectiveStatus}. Use pause_campaign to stop it.`)
      }),
  )

  server.tool(
    'preview_ad',
    'Show how one ad will look on Facebook and Instagram, rendered by Meta, before anything is created. Returns links to open in a browser.',
    { ad: adShape },
    async ({ ad }) =>
      await guarded(async () => {
        const loaded = loadClient()
        if ('error' in loaded) return text(loaded.error)
        const [draft] = toPlan(
          { campaignName: 'preview', objective: 'OUTCOME_TRAFFIC', adSets: [{ name: 'p', dailyBudget: 1, countries: ['PK'], ads: [ad] }] },
          loaded.account.currency,
        ).adSets[0]!.ads
        const wrapped = toPlan(
          { campaignName: 'preview', objective: 'OUTCOME_TRAFFIC', adSets: [{ name: 'p', dailyBudget: 1, countries: ['PK'], ads: [ad] }] },
          loaded.account.currency,
        )
        const actual = expandForPlacements(wrapped).adSets[0]!.ads
        const links = await loaded.client.previewAd(actual[0] ?? draft!)
        const note =
          actual.length > 1
            ? `This ad becomes ${actual.length} ads when created (one per text, each with every shape). Showing the first.`
            : ''
        if (Object.keys(links).length === 0) return text('Meta could not render a preview for this ad.')
        return text(
          [
            ...(note !== '' ? [note, ''] : []),
            'Open these in a browser. They are signed by Meta and expire, so look now rather than saving them.',
            ...Object.entries(links).map(([format, link]) => `  ${format}: ${link}`),
          ].join('\n'),
        )
      }),
  )

  server.tool(
    'get_ad_performance',
    'Read how each ad in a Meta campaign is doing — spend, results, cost per result, frequency, click-through — with suggestions. Suggests only; changes nothing.',
    {
      campaignId: z.string(),
      datePreset: z.string().optional().describe('e.g. last_7d (default), last_14d, last_30d, maximum.'),
      targetCostPerResult: z
        .number()
        .positive()
        .optional()
        .describe('What a result should cost, in the account currency. Without it no cost verdict is given.'),
    },
    async ({ campaignId, datePreset, targetCostPerResult }) =>
      await guarded(async () => {
        const loaded = loadClient()
        if ('error' in loaded) return text(loaded.error)
        const rows = await loaded.client.performance(campaignId, {
          ...(datePreset !== undefined ? { datePreset } : {}),
          ...(targetCostPerResult !== undefined ? { targetCostMinor: Math.round(targetCostPerResult * 100) } : {}),
        })
        if (rows.length === 0) {
          return text('No data for this period. A campaign that has not run, or has not spent yet, reports nothing.')
        }
        const money = (minor: number) => formatMoney({ minor, currency: loaded.account.currency })
        const lines = rows.flatMap((r) => [
          `${r.name}`,
          `  spent ${money(r.spendMinor)}, ${r.results} ${r.resultAction.replace(/_/g, ' ')}(s)` +
            (r.costPerResultMinor !== undefined ? `, ${money(r.costPerResultMinor)} each` : '') +
            `, frequency ${r.frequency.toFixed(1)}, link CTR ${r.linkCtr.toFixed(2)}%`,
          ...r.suggestions.map((s) => `  → ${s}`),
          '',
        ])
        lines.push('These are suggestions. Nothing has been paused or changed.')
        return text(lines.join('\n'))
      }),
  )

  server.tool(
    'create_lead_form',
    'Create an instant form on the Facebook Page for lead ads, so nothing has to be built by hand in Meta. Higher Intent by default. The form is not public until an ad opens it.',
    {
      name: z.string(),
      questions: z
        .array(
          z.union([
            z.object({ type: z.enum(['FULL_NAME', 'EMAIL', 'WORK_EMAIL', 'PHONE', 'COMPANY_NAME', 'JOB_TITLE', 'CITY']) }),
            z.object({
              type: z.literal('CUSTOM'),
              key: z.string(),
              label: z.string(),
              options: z.array(z.string()).optional().describe('Multiple choice answers. Omit for free text.'),
            }),
          ]),
        )
        .min(1)
        .describe('Standard fields are pre-filled by Meta. At most 3 custom questions.'),
      privacyPolicyUrl: z.string().describe('https link to the business privacy policy. Required by Meta.'),
      followUpUrl: z.string().describe('Where people can go after submitting.'),
      thankYouMessage: z.string().optional(),
      higherIntent: z.boolean().optional().describe('Adds a review step. On unless deliberately turned off.'),
    },
    async (args) =>
      await guarded(async () => {
        const loaded = loadClient()
        if ('error' in loaded) return text(loaded.error)
        const id = await loaded.client.createLeadForm(args)
        await audit('ads.leadform.created', { formId: id })
        return text(
          `Lead form created: ${id}\nUse it as leadFormId on each ad, with leadDestination "instant_form" on the ad set.`,
        )
      }),
  )

  server.tool(
    'pause_campaign',
    'Stop a Meta campaign spending. Takes effect immediately and can be undone by activating again.',
    { campaignId: z.string() },
    async ({ campaignId }) =>
      await guarded(async () => {
        const loaded = loadClient()
        if ('error' in loaded) return text(loaded.error)

        // No approval gate, deliberately. Stopping spend is the one action that
        // must never wait on a confirmation round trip; a wrong pause costs
        // delivery, a slow pause costs money.
        const after = await loaded.client.pause(campaignId)
        await audit('ads.campaign.paused', { campaignId })
        return text(`Paused. Campaign is now ${after.campaign.effectiveStatus}. Nothing is spending.`)
      }),
  )
}
