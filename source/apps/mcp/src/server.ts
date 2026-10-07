import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { analyticsConfig, optional } from '@social-publisher/config'
import { disconnect, type TenantScope } from '@social-publisher/db'
import { createAnalytics, createLogger, flushOnExit } from '@social-publisher/telemetry'

import { currentScope } from './context.ts'
import { buildLocalServer } from './local-server.ts'

/**
 * AdsPilot MCP server over stdio: the owner's local server.
 *
 * The tools are in local-server.ts; this file only meters them against the
 * local tenant and connects the transport.
 *
 * The local tenant is the owner's and is set to Premium when the plans
 * migration is applied (CURRENT-STATE.md), so metering here records and counts
 * but never blocks. Nothing in this file special-cases that: an account on
 * Premium is unlimited wherever it connects from.
 */

// File and Slack only: on stdio, stdout is the protocol itself, and the console
// sink writes info lines to stdout.
const logger = createLogger({ slackWebhookUrl: optional('SLACK_WEBHOOK_URL'), base: { event: 'mcp' } })

/**
 * Product analytics (PostHog), a no-op without POSTHOG_KEY. Its failures go to
 * the log file and Slack once per kind, never to stdout, which is the protocol.
 */
const analyticsSettings = analyticsConfig()
const analytics = createAnalytics({
  apiKey: analyticsSettings.posthogKey,
  host: analyticsSettings.posthogHost,
  onError: (message) => void logger.warn('analytics.failed', message),
})
flushOnExit(analytics)

/**
 * The tenant, resolved once and kept: it is the same for the life of a local
 * process, and resolving it again for every call would add a query to each.
 * A failed resolution is not kept, so the next call tries again.
 */
let tenant: Promise<TenantScope> | undefined
function localAccount(): Promise<TenantScope> {
  tenant ??= currentScope().catch((error: unknown) => {
    tenant = undefined
    throw error
  })
  return tenant
}

const server = buildLocalServer({
  transport: 'stdio',
  account: localAccount,
  upgradeUrl: optional('UPGRADE_URL'),
  analytics,
  log: (event, message, error) => {
    console.error(`[adspilot] ${message}: ${error instanceof Error ? error.message : String(error)}`)
    void logger.error(event, message, { data: { error } })
  },
})

const transport = new StdioServerTransport()
await server.connect(transport)
// The client went away (VS Code reloaded, the chat closed): send what is
// queued now, since the process may be killed rather than exit on its own.
server.server.onclose = () => void analytics.flush()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Queued analytics go out first (bounded wait); beforeExit does not fire on exit().
    void Promise.allSettled([analytics.shutdown(), disconnect()]).finally(() => process.exit(0))
  })
}
