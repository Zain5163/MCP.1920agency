import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { TokenIdentity } from '@social-publisher/auth'
import type { Analytics, Logger } from '@social-publisher/telemetry'

import type { McpAnalyticsSetup } from './mcp-analytics.ts'
import { createAdsPilotServer } from './mcp-server.ts'
import type { ClientInfo, MeterOptions } from './metering.ts'
import { registerPlaybooks } from './playbooks.ts'
import type { PostingDeps } from './publishing.ts'
import { registerHostedShopifyTools } from './shopify-hosted.ts'
import { registerBreakEvenTool } from './turnaround-tools.ts'
import { registerSkillsLibrary } from './skills-library.ts'
import { registerTools } from './tools.ts'
import { hostedWordPressAccess } from './wordpress-access.ts'
import { registerWordPressTools } from './wordpress-tools.ts'

/**
 * The hosted (HTTP) tool set for one request's identity, on a metered server.
 *
 * Built here rather than inline in http-server.ts so a test can build exactly
 * what a customer's request gets and check every tool is metered.
 */
export function buildHostedServer(
  identity: TokenIdentity,
  logger: Logger,
  options: {
    upgradeUrl?: string | undefined
    deps?: PostingDeps
    meter?: Partial<MeterOptions>
    /** One per process, shared by every request's server (http-server.ts). */
    analytics?: Analytics
    /** PostHog MCP Analytics: one client per process too; each request's server is instrumented. */
    mcpAnalytics?: McpAnalyticsSetup | undefined
  } = {},
): McpServer {
  const server = createAdsPilotServer('0.3.0', {
    transport: 'http',
    // Already resolved from the token at the door: no query per call.
    account: async () => identity.scope,
    userId: identity.userId,
    clientInfo: () => clientFor(identity.tokenId),
    upgradeUrl: options.upgradeUrl,
    analytics: options.analytics,
    mcpAnalytics: options.mcpAnalytics,
    log: (event, message, error) => {
      void logger.error(event, message, { tenantId: identity.tenantId, data: { error } })
    },
    ...options.meter,
  })
  registerTools(server, identity, logger, options.deps, options.analytics)
  // Playbooks only: static text, no credentials. Ads tools stay local (decision 0005).
  // Each user's own Shopify stores, with their own encrypted tokens (shopify-hosted.ts).
  registerHostedShopifyTools(server, identity.tenantId)
  // Each user's own WordPress sites, with their own encrypted Application Passwords.
  registerWordPressTools(server, hostedWordPressAccess(identity.tenantId))
  // Pure maths, no account access: safe on the metered server.
  registerBreakEvenTool(server)
  registerPlaybooks(server)
  registerSkillsLibrary(server)
  return server
}

/**
 * Which AI client each API token last initialized with.
 *
 * The hosted transport is stateless: a client's initialize request and its
 * later tool calls arrive as separate HTTP requests, each on a fresh server, so
 * the server handling a tool call never saw the clientInfo. Remembered per
 * token (its id, never the secret) and per process; after a restart the name is
 * unknown until the client next initializes, which it does at every new
 * session. Bounded so a flood of tokens cannot grow it without limit.
 */
const clients = new Map<string, ClientInfo>()
const MAX_REMEMBERED = 10_000

export function rememberClient(tokenId: string, info: ClientInfo | undefined): void {
  if (info === undefined) return
  clients.delete(tokenId)
  clients.set(tokenId, { name: info.name, version: info.version })
  // Map keeps insertion order, so the first key is the least recently seen.
  if (clients.size > MAX_REMEMBERED) clients.delete(clients.keys().next().value!)
}

export function clientFor(tokenId: string): ClientInfo | undefined {
  return clients.get(tokenId)
}
