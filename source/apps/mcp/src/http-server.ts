import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { identifyToken, type TokenIdentity } from '@social-publisher/auth'
import { optional } from '@social-publisher/config'
import { disconnect, health } from '@social-publisher/db'
import { createLogger } from '@social-publisher/telemetry'

import { buildHostedServer, rememberClient } from './hosted-server.ts'

/**
 * Hosted MCP server.
 *
 * One URL for every customer. Their AI client — Claude, ChatGPT, anything that
 * speaks MCP — connects with a bearer token, and that token is what decides which
 * account the request acts on.
 *
 * The load-bearing rule: **a request without a resolvable token never reaches a
 * tool.** Authentication happens once, at the door, and every tool is then built
 * around the resolved TenantScope. There is no code path where a tool runs without
 * a tenant, because the tools are constructed per request from the identity.
 *
 * Every tool is metered against that tenant's plan (metering.ts, decision 0009).
 */

const logger = createLogger({
  slackWebhookUrl: optional('SLACK_WEBHOOK_URL'),
  console: true,
  base: { event: 'mcp' },
})

const PORT = Number(optional('MCP_PORT', '8080'))
const UPGRADE_URL = optional('UPGRADE_URL')

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * JSON-RPC shaped errors, because the caller is an MCP client and a bare HTTP
 * error body would surface to the user as an unexplained disconnect.
 */
function rpcError(res: ServerResponse, status: number, message: string, hint: string): void {
  json(res, status, {
    jsonrpc: '2.0',
    error: { code: status === 401 ? -32001 : -32603, message, data: { hint } },
    id: null,
  })
}

async function authenticate(req: IncomingMessage): Promise<TokenIdentity | null> {
  const header = req.headers.authorization ?? req.headers['x-api-key']
  return await identifyToken(Array.isArray(header) ? header[0] : header)
}

const server = createServer((req, res) => {
  void handle(req, res).catch(async (error: unknown) => {
    await logger.error('mcp.request.crashed', 'unhandled error in request', { data: { error } })
    if (!res.headersSent) {
      rpcError(res, 500, 'Internal error', 'This has been logged. Try again shortly.')
    }
  })
})

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  // Unauthenticated, deliberately: uptime checks must not need a customer token.
  if (url.pathname === '/health') {
    const state = await health()
    json(res, state.reachable ? 200 : 503, {
      ok: state.reachable,
      database: state.reachable ? 'reachable' : 'unreachable',
      latencyMs: state.latencyMs ?? null,
    })
    return
  }

  if (url.pathname !== '/mcp') {
    rpcError(res, 404, 'Not found', 'The MCP endpoint is at /mcp.')
    return
  }

  const identity = await authenticate(req)
  if (identity === null) {
    // Same response for missing, malformed, revoked and expired — a caller must
    // not be able to tell which, or they can probe for valid tokens.
    await logger.warn('mcp.auth.rejected', 'request without a usable token')
    rpcError(
      res,
      401,
      'Unauthorized',
      'Send a valid API token as "Authorization: Bearer adsp_...". Create one in the AdsPilot dashboard.',
    )
    return
  }

  const scoped = logger.child({ tenantId: identity.tenantId })

  /**
   * A fresh server and transport per request.
   *
   * Tools are built around this request's TenantScope, so a tool physically
   * cannot see another tenant — there is no shared, long-lived server holding a
   * tenant that could be mismatched with an incoming request.
   */
  const mcp = buildHostedServer(identity, scoped, { upgradeUrl: UPGRADE_URL })

  const transport = new StreamableHTTPServerTransport({
    // Stateless: every request carries its own token, so there is no session to
    // resume and nothing to confuse between tenants.
    sessionIdGenerator: undefined,
  })

  res.on('close', () => {
    // Set only on the request that carried initialize; remembered so this
    // token's later tool calls, each on a fresh server, can record the client.
    rememberClient(identity.tokenId, mcp.server.getClientVersion())
    void transport.close()
    void mcp.close()
  })

  await mcp.connect(transport)
  await transport.handleRequest(req, res)
}

server.listen(PORT, () => {
  console.log(`[mcp] listening on http://localhost:${PORT}/mcp`)
  console.log(`[mcp] health check at http://localhost:${PORT}/health`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void disconnect().finally(() => process.exit(0))
    })
  })
}
