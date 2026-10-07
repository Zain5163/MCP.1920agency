import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  INDUSTRIES,
  INDUSTRY_LABELS,
  businessTypeLine,
  industryOf,
  planOf,
  upgradeMessage,
  usageMonth,
  usageSummary,
  type Industry,
  type Plan,
} from '@social-publisher/core'

import { clientOf, track, type MeterOptions, type UsageAccount } from './metering.ts'
import { callFailure } from './publishing.ts'

/**
 * The free account tools: check_usage and upgrade (decision 0009), and
 * set_business_type (the tenant's industry, for analytics).
 *
 * Never counted and never blocked (FREE_TOOLS in core), so a user who has
 * reached the limit can still see where they stand and how to upgrade.
 * Registered by createAdsPilotServer itself, so both transports always have
 * them and neither can forget.
 */

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] })

export function registerAccountTools(server: McpServer, options: MeterOptions): void {
  const now = () => options.now?.() ?? new Date()

  server.tool(
    'check_usage',
    "Show this account's plan, how many AdsPilot calls it has used this month, how many are left and when they reset. Free to call: it never counts toward the limit.",
    {},
    async () => {
      try {
        const account = await options.account()
        const at = now()
        const usage = await account.usage(usageMonth(at))
        const summary = usageSummary({
          plan: planOf(usage.plan),
          callsUsed: usage.calls,
          now: at,
          planRenewsAt: usage.planRenewsAt,
          upgradeUrl: options.upgradeUrl,
        })
        // The business type rides on check_usage because the AI already calls it
        // to see where the account stands; "not set" is its cue to ask the user
        // (SERVER_INSTRUCTIONS). A stored value off the list reads as not set.
        return text(`${summary}\n${businessTypeLine(industryOf(usage.industry))}`)
      } catch (error) {
        options.log('mcp.check_usage.failed', 'usage could not be read', error)
        return text(callFailure('DB_UNREACHABLE', error instanceof Error ? error.message : String(error)))
      }
    },
  )

  server.tool(
    'upgrade',
    'Get the link to upgrade to Premium (unlimited calls). Free to call: it never counts toward the limit.',
    {},
    async () => {
      // The link matters more than the plan: if the plan cannot be read, the
      // link is still given.
      let account: UsageAccount | undefined
      let plan: Plan | undefined
      let industry: Industry | undefined
      try {
        account = await options.account()
        const usage = await account.usage(usageMonth(now()))
        plan = planOf(usage.plan)
        industry = industryOf(usage.industry)
      } catch (error) {
        options.log('mcp.upgrade.plan_unread', 'plan could not be read; the link is given anyway', error)
      }
      // Asking for the link is the upgrade intent the usage notices exist to
      // create, so it is the funnel's last step until checkout reports back.
      if (account !== undefined) {
        const client = clientOf(server, options)
        track(options, account, 'upgrade_clicked', {
          plan,
          industry,
          transport: options.transport,
          client_name: client?.name,
          client_version: client?.version,
        })
      }
      return text(upgradeMessage(plan, options.upgradeUrl))
    },
  )

  server.tool(
    'set_business_type',
    'Record what kind of business this AdsPilot account is, from a fixed list: ' +
      `${INDUSTRIES.join(', ')}. ` +
      'Ask the user which one fits their business best and use their answer; never guess it from their name, ' +
      'website, Page or posts. Use other when none fits. Free to call: it never counts toward the limit.',
    {
      // An enum, not free text: only one of these codes can ever be stored or
      // reach analytics (industries.ts), and the client shows the AI the choices.
      business_type: z.enum(INDUSTRIES).describe('The category the user chose.'),
    },
    async ({ business_type }) => {
      try {
        const account = await options.account()
        await account.setIndustry(business_type)
        return text(`Business type set: ${INDUSTRY_LABELS[business_type]}.`)
      } catch (error) {
        options.log('mcp.set_business_type.failed', 'the business type could not be saved', error)
        return text(callFailure('DB_UNREACHABLE', error instanceof Error ? error.message : String(error)))
      }
    },
  )
}
