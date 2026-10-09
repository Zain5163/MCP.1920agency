import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { bestMonth, breakEven, decompose, toMonthFunnel, type MonthFunnel } from './account-diagnosis.ts'
import { accountArg, guarded, loadClient, type ToolResult } from './ads-tools.ts'

/**
 * Account turnaround tools (get_skill account-turnaround has the method):
 *   diagnose_account_trend   — why cost per sale moved, month by month, step by step
 *   break_even_cost_per_sale — what a sale may cost before the business loses money
 */

const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })
const n0 = (v: number | undefined) => (v === undefined ? '–' : Math.round(v).toLocaleString('en-US'))
const pct = (v: number | undefined, d = 1) => (v === undefined ? '–' : `${(v * 100).toFixed(d)}%`)
const x = (v: number) => `×${v.toFixed(2)}`

function monthTable(months: readonly MonthFunnel[]): string[] {
  return [
    'month    | spend | purchases | cost/purchase | ROAS | avg order | CPM | link CTR | views/click | add to cart | purchase/cart | freq',
    ...months.map((m) =>
      [
        m.month,
        n0(m.spend),
        String(m.purchases),
        n0(m.costPerPurchase),
        m.roas === undefined ? '–' : m.roas.toFixed(1),
        n0(m.averageOrder),
        n0(m.cpm),
        pct(m.linkCtr, 2),
        pct(m.pageViewsPerClick, 0),
        pct(m.addToCartRate),
        pct(m.purchaseRate, 0),
        m.frequency.toFixed(1),
      ].join(' | '),
    ),
  ]
}

export function registerTurnaroundTools(server: McpServer): void {
  server.tool(
    'diagnose_account_trend',
    'The turnaround analyst: pull a Meta ad account month by month (spend, purchases, cost per purchase, ROAS, average order, CPM, link CTR, page views per click, add-to-cart rate, purchase rate, frequency), find its best month, and split the change in cost per purchase between the best and the latest full month into the funnel steps that caused it, ranked, with what each points to. Use first on any account that has been declining or "sometimes works". Reads only.',
    {
      account: accountArg,
      months: z.number().int().min(3).max(24).default(9).describe('How many months back, ending with the current month.'),
      minPurchases: z.number().int().min(5).max(500).default(20).describe('A month needs at least this many purchases to count as the best month.'),
    },
    async ({ account, months, minPurchases }) =>
      await guarded(async () => {
        const loaded = loadClient(account)
        if ('error' in loaded) return text(loaded.error)
        const now = new Date()
        const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1)).toISOString().slice(0, 10)
        const until = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
        const rows = await loaded.client.insights({ level: 'account', since, until, timeIncrement: 'monthly' })
        const all = rows.map(toMonthFunnel).filter((m) => m.spend > 0).sort((a, b) => a.month.localeCompare(b.month))
        if (all.length < 2) return text(`Not enough history in ${loaded.label}: ${all.length} month(s) with spend since ${since}.`)

        const thisMonth = now.toISOString().slice(0, 7)
        const full = all.filter((m) => m.month !== thisMonth)
        const latest = full.at(-1) ?? all.at(-1)!
        const best = bestMonth(full, minPurchases)
        const fmt = (v: number | undefined) => `${n0(v)} ${loaded.account.currency}`

        const lines = [`${loaded.label}: ${all[0]!.month} to ${all.at(-1)!.month}${all.at(-1)!.month === thisMonth ? ' (this month so far)' : ''}.`, '', ...monthTable(all), '']
        if (best === undefined) {
          lines.push(`No month reached ${minPurchases} purchases, so there is no reliable best month to compare with. Lower minPurchases, or judge by the trend above.`)
          return text(lines.join('\n'))
        }
        if (best.month === latest.month) {
          lines.push(`The latest full month (${latest.month}) is also the best: cost per purchase ${fmt(latest.costPerPurchase)}. No decline to explain; scale carefully (+20% steps) and keep creative fresh.`)
          return text(lines.join('\n'))
        }
        const steps = decompose(best, latest)
        const ratio = latest.costPerPurchase! / best.costPerPurchase!
        lines.push(
          `BEST MONTH ${best.month}: ${fmt(best.costPerPurchase)} per purchase. LATEST FULL MONTH ${latest.month}: ${fmt(latest.costPerPurchase)} (${x(ratio)}).`,
          `Average order ${fmt(best.averageOrder)} → ${fmt(latest.averageOrder)}; ROAS ${best.roas?.toFixed(1) ?? '–'} → ${latest.roas?.toFixed(1) ?? '–'}. Judge profit with break_even_cost_per_sale, not cost per purchase alone.`,
          '',
          'WHAT MOVED COST PER PURCHASE (biggest first; above ×1 made it worse, below ×1 helped):',
          ...steps.map(
            (s) =>
              `  ${x(s.effect)}  ${s.label}: ${s.step === 'cpm' ? n0(s.before) : pct(s.before, 2)} → ${s.step === 'cpm' ? n0(s.after) : pct(s.after, 2)}` +
              (s.effect > 1.05 ? `\n         means ${s.meaning}\n         fix: ${s.fixes}` : ''),
          ),
          `  (the steps multiply to ×${steps.reduce((p, s) => p * s.effect, 1).toFixed(2)}; cost per purchase changed ${x(ratio)})`,
          '',
          `Spend ${fmt(best.spend)} → ${fmt(latest.spend)}; frequency ${best.frequency.toFixed(1)} → ${latest.frequency.toFixed(1)}.`,
          latest.spend > best.spend * 1.2 && ratio > 1.2 ? 'Spend was raised while the funnel got worse: scale only on improving rates.' : '',
          '',
          'Next: get_skill account-turnaround for the fix plan; analyze_ad_performance (days 90) to find the ads and formats that sold cheapest; get_ad_activity around the turning points.',
        )
        return text(lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n'))
      }),
  )
  registerBreakEvenTool(server)
}

/** Pure maths; also offered on the hosted server. */
export function registerBreakEvenTool(server: McpServer): void {
  server.tool(
    'break_even_cost_per_sale',
    "What a sale (an order placed, as Meta counts it) can cost in ads before the business loses money, from the business's real costs: order value, items per order, cost per item (with packaging), delivery the business pays, taxes and fees as a percentage, and the share of cash-on-delivery orders refused. Shows the effect of fewer refusals and of a bundle. Use before setting any cost-per-purchase target. Reads nothing; changes nothing.",
    {
      orderValue: z.number().positive().describe('What the customer pays for one order.'),
      itemsPerOrder: z.number().positive().default(1),
      costPerItem: z.number().nonnegative().describe('Cost per item, packaging included.'),
      deliveryCost: z.number().nonnegative().default(0).describe('Delivery the business pays per delivered order (0 if the customer pays).'),
      percentTaken: z.number().min(0).max(60).default(0).describe('Taxes and fees as a percentage of the order value, e.g. 6.1.'),
      refusedPercent: z.number().min(0).max(80).default(0).describe('Share of orders refused or returned, in percent.'),
      refusedOrderCost: z.number().nonnegative().optional().describe('Cost of one refused order; default: delivery both ways.'),
      bundleOrderValue: z.number().positive().optional().describe('Optional: price of a two-item bundle, to compare.'),
      currency: z.string().default('PKR'),
    },
    async (i) =>
      await guarded(async () => {
        const refusedOrderCost = i.refusedOrderCost ?? i.deliveryCost * 2
        const base = { ...i, refusedOrderCost }
        const b = breakEven(base)
        const c = (v: number) => `${i.currency} ${Math.round(v).toLocaleString('en-US')}`
        const lines = [
          `Profit per delivered order (before ads): ${c(b.profitPerDeliveredOrder)}`,
          `Break-even cost per purchase at ${i.refusedPercent}% refused: ${c(b.breakEvenCostPerPurchase)}`,
          b.breakEvenCostPerPurchase <= 0 ? 'This order loses money before any ad cost. Do not advertise it at this price.' : `A sensible target keeps about half: around ${c(b.breakEvenCostPerPurchase / 2)} per purchase; above ${c(b.breakEvenCostPerPurchase)} every sale loses money.`,
          '',
          'If fewer orders were refused:',
          ...[i.refusedPercent - 10, i.refusedPercent - 20]
            .filter((r) => r >= 0)
            .map((r) => `  ${r}% refused → break-even ${c(breakEven({ ...base, refusedPercent: r }).breakEvenCostPerPurchase)}`),
        ]
        if (i.bundleOrderValue !== undefined) {
          const bundle = breakEven({ ...base, orderValue: i.bundleOrderValue, itemsPerOrder: 2 })
          lines.push('', `Two-item bundle at ${c(i.bundleOrderValue)}: profit per delivered order ${c(bundle.profitPerDeliveredOrder)}, break-even ${c(bundle.breakEvenCostPerPurchase)} per purchase.`)
        }
        lines.push('', 'Not counted: staff, platform and app fees. Ask the business for any cost missing here rather than guessing.')
        return text(lines.join('\n'))
      }),
  )
}
