import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { META_OBJECTIVES, MetaAdsClient, type MetaAdAccount } from '@social-publisher/adapters'
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

  return { dailyMaxMinor: d, monthlyMaxMinor: m, currency }
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
  body: z.string().describe('Primary text. Meta truncates around 125 characters.'),
  headline: z.string().describe('Headline. Truncates around 40 characters.'),
  landingPageUrl: z.string().describe('https URL the ad sends people to.'),
  callToAction: z.string().optional().describe('e.g. LEARN_MORE, SHOP_NOW, CONTACT_US.'),
  imagePath: z.string().optional().describe('Absolute path to a local image for the creative.'),
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
        ...(entry.endDate !== undefined ? { endAt: new Date(entry.endDate) } : {}),
      },
      ads: entry.ads.map((ad) => ({
        name: ad.name,
        body: ad.body,
        headline: ad.headline,
        landingPageUrl: ad.landingPageUrl,
        ...(ad.callToAction !== undefined ? { callToAction: ad.callToAction } : {}),
        ...(ad.imagePath !== undefined
          ? { creative: { kind: 'image' as const, localPath: ad.imagePath } }
          : {}),
      })),
    })),
  }
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

        if (review.errors.length > 0) {
          lines.push('WILL NOT BE CREATED — fix these first:', ...review.errors.map((e) => `  • ${e}`), '')
        }
        if (review.warnings.length > 0) {
          lines.push('Warnings (do not block, but read them):', ...review.warnings.map((w) => `  • ${w}`))
        }
        if (review.ok && review.warnings.length === 0) lines.push('No problems found.')
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
          const spend = checkSpend(limit, { dailyMinor: total.minor, currency: total.currency }, committed)
          if (!spend.ok) return text(`Nothing was created. ${spend.reason}`)
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
