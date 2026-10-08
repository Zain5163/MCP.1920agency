import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { identifyToken, type TokenIdentity } from '@social-publisher/auth'
import { analyticsConfig, optional } from '@social-publisher/config'
import { disconnect, health } from '@social-publisher/db'
import { createAnalytics, createLogger, flushOnExit } from '@social-publisher/telemetry'

import { buildHostedServer, rememberClient } from './hosted-server.ts'
import { createMcpAnalyticsClient, resolveServerBuild, type McpAnalyticsSetup } from './mcp-analytics.ts'
import { handleShopifyCallback } from './shopify-hosted.ts'

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

/**
 * Product analytics, one client for the process: it batches across requests,
 * which a per-request client could not. A no-op without POSTHOG_KEY.
 */
const analyticsSettings = analyticsConfig()
const analytics = createAnalytics({
  apiKey: analyticsSettings.posthogKey,
  host: analyticsSettings.posthogHost,
  onError: (message) => void logger.warn('analytics.failed', message),
})
flushOnExit(analytics)

/**
 * PostHog MCP Analytics ($mcp_tool_call), one posthog-node client for the
 * process: it batches across requests (20 events or 10 s), and every request's
 * fresh server is instrumented onto it. Undefined without POSTHOG_KEY, and then
 * nothing is instrumented. BUILD_SHA comes from docker-compose.yml.
 */
const mcpAnalyticsClient = createMcpAnalyticsClient({
  apiKey: analyticsSettings.posthogKey,
  host: analyticsSettings.posthogHost,
  onError: (message) => void logger.warn('mcp_analytics.failed', message),
})
const mcpAnalytics: McpAnalyticsSetup | undefined =
  mcpAnalyticsClient === undefined ? undefined : { client: mcpAnalyticsClient, serverBuild: resolveServerBuild() }

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

  // Shopify sends the store owner's browser here after they approve the app.
  // Unauthenticated by design; trust comes from Shopify's signature and AdsPilot's
  // signed state (shopify-hosted.ts).
  if (url.pathname === '/shopify' && req.method === 'GET') {
    const body =
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>AdsPilot store connector</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">' +
      '<h1 style="font-size:1.3rem">AdsPilot works from your AI chat</h1>' +
      '<p>AdsPilot runs inside Claude, ChatGPT or another AI assistant, not in this window.</p>' +
      '<p>To link this store to your AdsPilot account: open your AI chat with AdsPilot connected and say ' +
      '<b>&ldquo;connect my Shopify store&rdquo;</b> with your store&rsquo;s myshopify.com address, then approve in Shopify.</p>' +
      '<p>After that, ask it to audit your store, check sales, or improve a page. ' +
      'Nothing changes on your store without your approval in the chat.</p></body>'
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
    res.end(body)
    return
  }
  if (url.pathname === '/shopify/callback' && req.method === 'GET') {
    await handleShopifyCallback(url, res, {
      log: (event, data) => void logger.info(event, 'shopify connect', { data }),
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
  const mcp = buildHostedServer(identity, scoped, { upgradeUrl: UPGRADE_URL, analytics, mcpAnalytics })

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
      // Queued analytics go out first (bounded wait); beforeExit does not fire on exit().
      // Docker sends SIGTERM on stop and allows 15 s (stop_grace_period); both waits are 3 s.
      void Promise.allSettled([analytics.shutdown(), mcpAnalyticsClient?.shutdown(3_000), disconnect()]).finally(() =>
        process.exit(0),
      )
    })
  })
}
