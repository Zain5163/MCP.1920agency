import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { productSlug } from '@social-publisher/config'

import { registerAccountTools } from './account-tools.ts'
import { instrumentMcpAnalytics } from './mcp-analytics.ts'
import { installMetering, type MeterOptions } from './metering.ts'
import { serverInstructions } from './playbooks.ts'

/**
 * The only place an AdsPilot MCP server is built, for both transports.
 *
 * Metering is installed here, before any tool exists, so every tool registered
 * afterwards — by any module, through any helper — is metered (metering.ts).
 * The free account tools are registered here too, so no transport can ship
 * without check_usage and upgrade. A test fails if `new McpServer` appears
 * anywhere else in src.
 *
 * PostHog MCP Analytics is installed here too, after metering and before any
 * tool, when a key is configured (meter.mcpAnalytics). It wraps around the
 * metered handlers without changing any tool's schema (mcp-analytics.ts).
 */
export function createAdsPilotServer(version: string, meter: MeterOptions): McpServer {
  const server = new McpServer({ name: productSlug(), version }, { instructions: serverInstructions() })
  installMetering(server, meter)
  if (meter.mcpAnalytics !== undefined) instrumentMcpAnalytics(server, meter.mcpAnalytics, meter)
  registerAccountTools(server, meter)
  return server
}
