import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  ALL_PUBLISHER_PLATFORMS,
  auditAccount,
  audienceFindings,
  clickQualityFindings,
  describeAction,
  fatigueFindings,
  judgeAds,
  placementFindings,
  readMetrics,
  resultActionsFor,
  sumMetrics,
  WEBSITE_GOALS,
  type AdWindow,
  type BreakdownRow,
  type Finding,
  type Metrics,
  type MetaAdsClient,
} from '@social-publisher/adapters'
import { checkSpend, formatApprovalRequest, formatMoney } from '@social-publisher/core'

import { accountArg, audit, decideOn, guarded, loadClient, loadLimit, type ToolResult } from './ads-tools.ts'

/**
 * The Meta performance team: the data a senior media buyer reads, and the few
 * changes they make (roadmap 5b.7, built 2026-10-02).
 *
 * Reading is free and changes nothing. Every change — budget, switching
 * something on, placements — goes through approval, and anything that can raise
 * spending also goes through the owner's spend ceiling. Switching something OFF
 * needs no approval, for the same reason `pause_campaign` does not: stopping
 * spend must never wait.
 *
 * The thinking — which specialist looks at what, in which order — lives in the
 * `meta-performance` playbook and the `review_meta_account` prompt. This file
 * supplies the facts those roles work from.
 */

const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })
const confirmArg = z.string().optional().describe('The token from the approval summary, once the user has said yes.')

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000))

/** Two equal windows ending yesterday: [current] and the one before it. */
function windows(days: number) {
  return {
    current: { since: daysAgo(days), until: daysAgo(1) },
    previous: { since: daysAgo(days * 2), until: daysAgo(days + 1) },
  }
}

interface Context {
  client: MetaAdsClient
  currency: string
  /** Result definition per ad set id. */
  resultsBy: Map<string, readonly string[]>
  /** Ad sets whose clicks should open a web page. */
  website: Set<string>
  /** The definition of whichever goal spent most, for account-wide breakdowns. */
  dominant: readonly string[]
  overview: Awaited<ReturnType<MetaAdsClient['adSetsOverview']>>
}

async function context(client: MetaAdsClient, currency: string, campaignId?: string): Promise<Context> {
  const overview = await client.adSetsOverview(campaignId)
  const resultsBy = new Map(overview.map((a) => [a.id, resultActionsFor(a.optimizationGoal, a.customEventType)]))
  const website = new Set(overview.filter((a) => WEBSITE_GOALS.has(a.optimizationGoal ?? '')).map((a) => a.id))
  // The goal with the most active budget decides what "a result" means in the
  // account-wide breakdowns; mixed goals are reported per ad.
  const byGoal = new Map<string, number>()
  for (const a of overview) {
    const key = JSON.stringify(resultActionsFor(a.optimizationGoal, a.customEventType))
    byGoal.set(key, (byGoal.get(key) ?? 0) + (a.dailyBudgetMinor ?? 1))
  }
  const dominant = JSON.parse([...byGoal].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '["link_click"]') as string[]
  return { client, currency, resultsBy, website, dominant, overview }
}

function breakdown(rows: Array<Record<string, unknown>>, keys: string[], results: readonly string[]): BreakdownRow[] {
  return rows.map((r) => ({ key: keys.map((k) => String(r[k] ?? '?')).join(' / '), metrics: readMetrics(r, results) }))
}

function money(currency: string) {
  return (minor: number) => formatMoney({ minor, currency })
}

function line(m: Metrics, fmt: (n: number) => string): string {
  return [
    `spent ${fmt(m.spendMinor)}`,
    `${m.results} ${describeAction(m.resultAction)}`,
    m.costPerResultMinor !== undefined ? `${fmt(m.costPerResultMinor)} each` : undefined,
    m.roas !== undefined ? `ROAS ${m.roas.toFixed(2)}×` : undefined,
    `frequency ${m.frequency.toFixed(1)}`,
    `link CTR ${m.linkCtr.toFixed(2)}%`,
    m.linkClicks > 0 && m.landingPageViews > 0 ? `${Math.round((m.landingPageViews / m.linkClicks) * 100)}% of clicks loaded the page` : undefined,
  ]
    .filter((x) => x !== undefined)
    .join(', ')
}

function findingLines(findings: readonly Finding[]): string[] {
  if (findings.length === 0) return ['  None. Nothing structural stands out in this data.']
  const icon = { critical: '✗', warning: '!', opportunity: '+', info: '·' } as const
  return findings.flatMap((f) => [`  ${icon[f.severity]} [${f.area}] ${f.message}`, ...(f.action !== undefined ? [`      → ${f.action}`] : [])])
}

/** Rejects budgets that are not whole minor units, or not positive. */
const budgetArg = z.number().positive().describe('New daily budget in whole units of the account currency, e.g. 600 for PKR 600.')

export function registerPerformanceTools(server: McpServer): void {
  server.tool(
    'analyze_ad_performance',
    'The analyst: read a Meta campaign (or the whole account) the way a senior media buyer does — totals and ROAS, every ad, where the money went by placement, who converts by age and gender, this period against the last, and a scale / keep / cut / wait call on each ad. Reads only; changes nothing.',
    {
      campaignId: z.string().optional().describe('Omit for the whole ad account.'),
      days: z.number().int().min(3).max(90).default(7).describe('Length of the period, ending yesterday. Compared with the same length before it.'),
      targetCostPerResult: z.number().positive().optional().describe('What a result should cost, in the account currency.'),
      targetRoas: z.number().positive().optional().describe('Target return on ad spend, e.g. 3 for 3×.'),
      marginPercent: z.number().min(1).max(100).optional().describe('Product gross margin. Gives break-even ROAS (1 ÷ margin) when there is no ROAS target.'),
      account: accountArg,
    },
    async ({ campaignId, days, targetCostPerResult, targetRoas, marginPercent, account }) =>
      await guarded(async () => {
        const loaded = loadClient(account)
        if ('error' in loaded) return text(loaded.error)
        const ctx = await context(loaded.client, loaded.account.currency, campaignId)
        const fmt = money(ctx.currency)
        const w = windows(days)
        const scope = campaignId !== undefined ? { objectId: campaignId } : {}

        const [cur, prev, place, demo] = await Promise.all([
          loaded.client.insights({ ...scope, level: 'ad', ...w.current }),
          loaded.client.insights({ ...scope, level: 'ad', ...w.previous }),
          loaded.client.insights({ ...scope, level: campaignId !== undefined ? 'campaign' : 'account', ...w.current, breakdowns: 'publisher_platform,platform_position' }),
          loaded.client.insights({ ...scope, level: campaignId !== undefined ? 'campaign' : 'account', ...w.current, breakdowns: 'age,gender' }),
        ])

        const resultsFor = (row: Record<string, unknown>) => ctx.resultsBy.get(String(row.adset_id)) ?? ctx.dominant
        const prevBy = new Map(prev.map((r) => [String(r.ad_id), readMetrics(r, resultsFor(r))]))
        const ads: AdWindow[] = cur.map((r) => {
          const p = prevBy.get(String(r.ad_id))
          return { adId: String(r.ad_id), name: String(r.ad_name ?? ''), current: readMetrics(r, resultsFor(r)), ...(p !== undefined ? { previous: p } : {}) }
        })

        if (ads.length === 0) {
          return text(`No delivery between ${w.current.since} and ${w.current.until}. A campaign that did not run reports nothing; try more days.`)
        }

        // Ads optimising for different things are totalled and judged apart:
        // adding conversations to link clicks gives a number that means nothing.
        const adSetOf = new Map(cur.map((r) => [String(r.ad_id), String(r.adset_id)]))
        const groups = new Map<string, AdWindow[]>()
        for (const a of ads) groups.set(a.current.resultAction, [...(groups.get(a.current.resultAction) ?? []), a])
        const webAds = ads.filter((a) => ctx.website.has(adSetOf.get(a.adId) ?? ''))
        const webTotal = webAds.length > 0 ? sumMetrics(webAds.map((a) => a.current), 'link_click') : undefined
        const total = sumMetrics(ads.map((a) => a.current), ads[0]!.current.resultAction)
        const placements = breakdown(place, ['publisher_platform', 'platform_position'], ctx.dominant)
        const audience = breakdown(demo, ['age', 'gender'], ctx.dominant)
        const margin = marginPercent !== undefined ? marginPercent / 100 : undefined
        const targets = {
          ...(targetCostPerResult !== undefined ? { costPerResultMinor: Math.round(targetCostPerResult * 100) } : {}),
          ...(targetRoas !== undefined ? { roas: targetRoas } : {}),
          ...(margin !== undefined ? { margin } : {}),
        }
        const decisions = [...groups.values()].flatMap((g) => judgeAds(g, targets))
        const findings = [
          ...(webTotal !== undefined ? clickQualityFindings(webTotal) : []),
          ...placementFindings(placements),
          ...audienceFindings(audience),
          ...fatigueFindings(ads),
        ]

        const topPlacements = [...placements].sort((a, b) => b.metrics.spendMinor - a.metrics.spendMinor).slice(0, 6)
        const out = [
          `Period ${w.current.since} to ${w.current.until}${campaignId !== undefined ? `, campaign ${campaignId}` : ', whole account'}.`,
          '',
          groups.size > 1 ? 'TOTAL, BY WHAT EACH AD OPTIMISES FOR' : 'TOTAL',
          ...[...groups.entries()].flatMap(([action, g]) => {
            const now = sumMetrics(g.map((a) => a.current), action)
            const before = g.some((a) => a.previous) ? sumMetrics(g.flatMap((a) => (a.previous ? [a.previous] : [])), action) : undefined
            return [`  ${line(now, fmt)}`, ...(before !== undefined ? [`    previous ${days} days: ${line(before, fmt)}`] : [])]
          }),
          ...(groups.size > 1 ? [`  all together: spent ${fmt(total.spendMinor)}`] : []),
          ...(margin !== undefined ? [`  break-even ROAS at ${marginPercent}% margin: ${(1 / margin).toFixed(2)}×`] : []),
          '',
          'BY AD',
          ...ads.map((a) => `  ${a.name}\n    ${line(a.current, fmt)}`),
          '',
          'WHERE THE MONEY WENT (placements, by spend)',
          ...topPlacements.map(
            (p) =>
              `  ${p.key}: ${Math.round((p.metrics.spendMinor / Math.max(1, total.spendMinor)) * 100)}% of spend, ${p.metrics.linkClicks} link clicks` +
              (p.metrics.resultAction !== 'link_click' ? `, ${p.metrics.results} ${describeAction(p.metrics.resultAction)}` : ''),
          ),
          '',
          'FINDINGS',
          ...findingLines(findings),
          '',
          `DECISIONS${targetCostPerResult === undefined && targetRoas === undefined && margin === undefined ? ' (no target given: judged against the account average, which is not the same as profitable)' : ''}`,
          ...decisions.map((d) => `  ${d.verdict.toUpperCase().padEnd(5)} ${d.name} — ${d.reason}`),
          '',
          'These are proposals. Nothing has been changed. Scaling means about +20% on the ad set (change_budget), then 3–5 days before judging again; a cut is set_ad_delivery off.',
        ]
        return text(out.join('\n'))
      }),
  )

  server.tool(
    'audit_ad_account',
    'The auditor: check a Meta ad account (or one campaign) for structural problems that waste money whatever the ads say — rejected ads, clicks-as-the-goal, learning-limited ad sets, budgets below the learning floor, too few or too many ads, junk placements, spend with no tracked results. Reads only; changes nothing.',
    {
      campaignId: z.string().optional(),
      days: z.number().int().min(7).max(90).default(30),
      targetCostPerResult: z.number().positive().optional().describe('Enables the learning-budget check (cost × 50 ÷ 7 per ad set).'),
      account: accountArg,
    },
    async ({ campaignId, days, targetCostPerResult, account }) =>
      await guarded(async () => {
        const loaded = loadClient(account)
        if ('error' in loaded) return text(loaded.error)
        const ctx = await context(loaded.client, loaded.account.currency, campaignId)
        const w = windows(days)
        const scope = campaignId !== undefined ? { objectId: campaignId } : {}
        const level = campaignId !== undefined ? 'campaign' : 'account'
        const [totals, place] = await Promise.all([
          loaded.client.insights({ ...scope, level: 'adset', ...w.current }),
          loaded.client.insights({ ...scope, level, ...w.current, breakdowns: 'publisher_platform,platform_position' }),
        ])
        const rejected = ctx.overview.flatMap((a) => a.ads.filter((ad) => ad.status === 'DISAPPROVED' || ad.status === 'WITH_ISSUES'))
        const findings = auditAccount({
          adSets: ctx.overview.map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status,
            ...(a.optimizationGoal !== undefined ? { optimizationGoal: a.optimizationGoal } : {}),
            ...(a.dailyBudgetMinor !== undefined ? { dailyBudgetMinor: a.dailyBudgetMinor } : {}),
            activeAds: a.ads.filter((ad) => ad.status === 'ACTIVE').length,
            dynamicCreative: a.dynamicCreative,
            ...(a.learningStatus !== undefined ? { learningStatus: a.learningStatus } : {}),
          })),
          rejectedAds: rejected,
          total: sumMetrics(totals.map((r) => readMetrics(r, ctx.resultsBy.get(String(r.adset_id)) ?? ctx.dominant)), ctx.dominant[0] ?? 'link_click'),
          websiteTotal: sumMetrics(
            totals.filter((r) => ctx.website.has(String(r.adset_id))).map((r) => readMetrics(r, ['link_click'])),
            'link_click',
          ),
          placements: breakdown(place, ['publisher_platform', 'platform_position'], ctx.dominant),
          ...(targetCostPerResult !== undefined ? { targetCostMinor: Math.round(targetCostPerResult * 100) } : {}),
        })
        const active = ctx.overview.filter((a) => a.status === 'ACTIVE').length
        return text(
          [
            `Audit of ${campaignId !== undefined ? `campaign ${campaignId}` : 'the ad account'}, last ${days} days: ${ctx.overview.length} ad set(s), ${active} active.`,
            '',
            ...findingLines(findings),
            '',
            'Nothing has been changed. Each → line says what would fix it; changes need the user’s approval.',
          ].join('\n'),
        )
      }),
  )

  server.tool(
    'get_ad_activity',
    'The ad account’s change history: who changed what and when (status, budgets, targeting, review results). Use it to answer "what changed before results moved?". Reads only.',
    { days: z.number().int().min(1).max(90).default(14), limit: z.number().int().min(1).max(200).default(50), account: accountArg },
    async ({ days, limit, account }) =>
      await guarded(async () => {
        const loaded = loadClient(account)
        if ('error' in loaded) return text(loaded.error)
        const rows = await loaded.client.activity({ since: new Date(Date.now() - days * 86_400_000), limit })
        if (rows.length === 0) return text(`No changes recorded in the last ${days} days.`)
        const kind: Record<string, string> = { CAMPAIGN_GROUP: 'campaign', CAMPAIGN: 'ad set', ADGROUP: 'ad', AD_ACCOUNT: 'account' }
        return text(
          [
            `${rows.length} change(s) in the last ${days} days, newest first:`,
            '',
            ...rows.map(
              (r) =>
                `• ${r.at.toISOString().slice(0, 16).replace('T', ' ')} UTC — ${r.what} — ${kind[r.objectType] ?? r.objectType.toLowerCase()} "${r.objectName}"` +
                (r.from !== undefined || r.to !== undefined ? `: ${r.from ?? '?'} → ${r.to ?? '?'}` : '') +
                (r.by !== undefined ? ` (by ${r.by})` : ''),
            ),
          ].join('\n'),
        )
      }),
  )

  server.tool(
    'change_budget',
    'The media buyer’s main lever: set the daily budget of a Meta ad set (or a campaign using campaign budget). Needs the user’s approval and stays inside the spend ceiling. Warns when the change is over 20%, which restarts Meta’s learning.',
    { id: z.string().describe('Ad set id, or campaign id when the budget is set on the campaign.'), newDailyBudget: budgetArg, confirm: confirmArg, account: accountArg },
    async ({ id, newDailyBudget, confirm, account }) =>
      await guarded(async () => {
        const loaded = loadClient(account)
        if ('error' in loaded) return text(loaded.error)
        const limit = loadLimit(loaded.account.currency, loaded.limits)
        if ('error' in limit) return text(limit.error)

        const obj = await loaded.client.readObject(id, 'name,daily_budget,effective_status')
        if (obj.daily_budget === undefined) {
          return text('That object has no daily budget of its own. If the budget sits on the campaign (or the ad set), change it there.')
        }
        const oldMinor = Number(obj.daily_budget)
        const newMinor = Math.round(newDailyBudget * 100)
        const active = obj.effective_status === 'ACTIVE'
        const committed = await loaded.client.committedDailySpendMinor()
        const spend = checkSpend(
          limit,
          { dailyMinor: newMinor, currency: loaded.account.currency },
          active ? committed - oldMinor : committed,
        )
        if (!spend.ok) return text(`Not changed. ${spend.reason}`)

        const fmt = money(loaded.account.currency)
        const change = oldMinor > 0 ? (newMinor - oldMinor) / oldMinor : 1
        const gate = decideOn(loaded, {
          action: 'change_budget',
          payload: { id, oldMinor, newMinor },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () =>
            [
              `Change the daily budget of "${String(obj.name)}"`,
              `  ${fmt(oldMinor)} → ${fmt(newMinor)} per day (${change >= 0 ? '+' : ''}${Math.round(change * 100)}%)`,
              `  status: ${String(obj.effective_status).toLowerCase()}${active ? ' — takes effect immediately' : ' — applies when it is switched on'}`,
              ...(Math.abs(change) > 0.2
                ? ['', `Warning: a change over 20% restarts Meta’s learning phase. The usual step is about +20% (${fmt(Math.round(oldMinor * 1.2))}), then 3–5 days’ wait.`]
                : []),
            ].join('\n'),
        })
        if (!gate.allowed) return text(formatApprovalRequest(gate))
        await loaded.client.setDailyBudget(id, newMinor)
        await audit('ads.budget.changed', { id, oldMinor, newMinor })
        const after = await loaded.client.readObject(id, 'daily_budget')
        return text(`Done. Meta now reports a daily budget of ${fmt(Number(after.daily_budget))} for "${String(obj.name)}".`)
      }),
  )

  server.tool(
    'set_ad_delivery',
    'Switch one Meta ad, ad set or campaign on or off. OFF happens at once with no approval — stopping spend never waits. ON needs the user’s approval, and an ad set with its own budget must fit the spend ceiling.',
    { id: z.string(), on: z.boolean(), confirm: confirmArg, account: accountArg },
    async ({ id, on, confirm, account }) =>
      await guarded(async () => {
        const loaded = loadClient(account)
        if ('error' in loaded) return text(loaded.error)
        const obj = await loaded.client.readObject(id, 'name,effective_status,daily_budget')
        const name = String(obj.name ?? id)

        if (!on) {
          await loaded.client.setDelivery(id, false)
          await audit('ads.delivery.off', { id })
          return text(`"${name}" in ${loaded.label} is switched off. It stops spending now; nothing else was changed.`)
        }

        const limit = loadLimit(loaded.account.currency, loaded.limits)
        if ('error' in limit) return text(limit.error)
        if (obj.daily_budget !== undefined) {
          const spend = checkSpend(
            limit,
            { dailyMinor: Number(obj.daily_budget), currency: loaded.account.currency },
            await loaded.client.committedDailySpendMinor(),
          )
          if (!spend.ok) return text(`Not switched on. ${spend.reason}`)
        }
        const fmt = money(loaded.account.currency)
        const gate = decideOn(loaded, {
          action: 'set_ad_delivery',
          payload: { id, on: true },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () =>
            [
              `Switch on "${name}" (now ${String(obj.effective_status).toLowerCase()})`,
              ...(obj.daily_budget !== undefined ? [`  its budget: ${fmt(Number(obj.daily_budget))} per day`] : ['  spends from the budget of the ad set or campaign above it']),
              'It delivers only if everything above it is switched on too.',
            ].join('\n'),
        })
        if (!gate.allowed) return text(formatApprovalRequest(gate))
        await loaded.client.setDelivery(id, true)
        await audit('ads.delivery.on', { id })
        return text(`"${name}" is switched on.`)
      }),
  )

  server.tool(
    'exclude_placements',
    'Stop a Meta ad set showing on some placements — most often Audience Network, when it takes the spend and returns empty clicks. Needs the user’s approval. Restarts the ad set’s learning.',
    {
      adSetId: z.string(),
      exclude: z.array(z.enum(ALL_PUBLISHER_PLATFORMS)).min(1),
      confirm: confirmArg,
      account: accountArg,
    },
    async ({ adSetId, exclude, confirm, account }) =>
      await guarded(async () => {
        const loaded = loadClient(account)
        if ('error' in loaded) return text(loaded.error)
        const obj = await loaded.client.readObject(adSetId, 'name,targeting')
        const gate = decideOn(loaded, {
          action: 'exclude_placements',
          payload: { adSetId, exclude: [...exclude].sort() },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => `Stop "${String(obj.name)}" showing on: ${exclude.join(', ')}.\nEverything else in its targeting stays as it is. Meta re-learns the ad set after this change.`,
        })
        if (!gate.allowed) return text(formatApprovalRequest(gate))
        const after = await loaded.client.excludePlacements(adSetId, exclude)
        await audit('ads.placements.excluded', { adSetId, exclude })
        return text(`Done. "${String(obj.name)}" now shows on: ${after.join(', ')}.`)
      }),
  )
}
