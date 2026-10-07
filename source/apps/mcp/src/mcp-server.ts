import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerAccountTools } from './account-tools.ts'
import { installMetering, type MeterOptions } from './metering.ts'
import { SERVER_INSTRUCTIONS } from './playbooks.ts'

/**
 * The only place an AdsPilot MCP server is built, for both transports.
 *
 * Metering is installed here, before any tool exists, so every tool registered
 * afterwards — by any module, through any helper — is metered (metering.ts).
 * The free account tools are registered here too, so no transport can ship
 * without check_usage and upgrade. A test fails if `new McpServer` appears
 * anywhere else in src.
 */
export function createAdsPilotServer(version: string, meter: MeterOptions): McpServer {
  const server = new McpServer({ name: 'adspilot', version }, { instructions: SERVER_INSTRUCTIONS })
  installMetering(server, meter)
  registerAccountTools(server, meter)
  return server
}
