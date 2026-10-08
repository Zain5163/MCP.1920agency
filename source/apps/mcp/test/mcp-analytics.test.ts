import { strict as assert } from 'node:assert'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import { gunzipSync } from 'node:zlib'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

import { FREE_TOOLS } from '@social-publisher/core'
import { TenantScope, type CountedMonth, type ToolCallInput, type UsageSnapshot } from '@social-publisher/db'
import { Logger } from '@social-publisher/telemetry'

import { buildHostedServer, rememberClient } from '../src/hosted-server.ts'
import { buildLocalServer } from '../src/local-server.ts'
import {
  MCP_ANALYTICS_PROPERTIES,
  createMcpAnalyticsClient,
  mcpAnalyticsBeforeSend,
  resolveServerBuild,
  type McpAnalyticsSetup,
} from '../src/mcp-analytics.ts'
import { createAdsPilotServer } from '../src/mcp-server.ts'
import { METERED, type MeterOptions, type UsageAccount } from '../src/metering.ts'

/**
 * PostHog MCP Analytics, against the real @posthog/mcp and posthog-node code
 * with a fake fetch: nothing reaches the network (the hosted test uses a
 * loopback HTTP server only), no database is touched.
 *
 * The canary is put in every argument and every result; it must never appear
 * in anything handed to fetch.
 */

const CANARY = 'CANARY-7f3a-secret-post-text'
const TENANT = 'tenant-abc123'
const BUILD = 'abc1234def56'
const KEY = 'phc_testkey_not_real'

class FakeAccount implements UsageAccount {
  readonly tenantId: string
  plan: 'free' | 'premium' = 'premium'
  calls = 0
  readonly recorded: Array<ToolCallInput & { counted: boolean }> = []
  constructor(tenantId = TENANT) {
    this.tenantId = tenantId
  }
  async usage(month: string): Promise<UsageSnapshot> {
    return { plan: this.plan, planRenewsAt: null, month, calls: this.calls, noticesShown: [] }
  }
  async recordToolCall(call: ToolCallInput, options: { month: string; count: boolean }): Promise<CountedMonth | null> {
    this.recorded.push({ ...call, counted: options.count })
    if (!options.count) return null
    this.calls += 1
    return { month: options.month, calls: this.calls, noticesShown: [] }
  }
  async markNoticesShown(): Promise<void> {}
  async setIndustry(): Promise<void> {}
}

interface WireEvent {
  event: string
  distinct_id: string
  properties: Record<string, unknown>
}

/** posthog-node with a fetch that records what would have been sent. */
function fakePostHog() {
  const bodies: string[] = []
  const fetch = async (_url: string, options: { headers?: Record<string, string>; body?: unknown }) => {
    const raw = options.body
    let bytes: Buffer
    if (typeof raw === 'string') bytes = Buffer.from(raw)
    else if (raw instanceof Uint8Array) bytes = Buffer.from(raw)
    else if (raw instanceof ArrayBuffer) bytes = Buffer.from(new Uint8Array(raw))
    else if (raw instanceof Blob) bytes = Buffer.from(await raw.arrayBuffer())
    else bytes = Buffer.from(String(raw))
    const encoding = Object.entries(options.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-encoding')?.[1]
    bodies.push((encoding === 'gzip' ? gunzipSync(bytes) : bytes).toString('utf8'))
    return { status: 200, text: async () => '{}', json: async () => ({}) }
  }
  const client = createMcpAnalyticsClient({ apiKey: KEY, host: 'https://eu.i.posthog.com', fetch, flushAt: 1 })
  assert.ok(client !== undefined)
  const events = (): WireEvent[] =>
    bodies.flatMap((body) => {
      const parsed = JSON.parse(body) as { batch?: WireEvent[] }
      return parsed.batch ?? []
    })
  /** Lets the SDK's async pipeline queue the events, then sends them. */
  const drain = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    await client.shutdown(2_000)
  }
  return { client, bodies, events, drain }
}

function meterFor(account: FakeAccount, mcpAnalytics?: McpAnalyticsSetup): MeterOptions {
  return {
    transport: 'stdio',
    account: async () => account,
    log: () => {},
    ...(mcpAnalytics !== undefined ? { mcpAnalytics } : {}),
  }
}

function registered(server: McpServer): Record<string, { handler: (...args: unknown[]) => unknown }> {
  return (server as unknown as { _registeredTools: Record<string, { handler: (...args: unknown[]) => unknown }> })
    ._registeredTools
}

async function connect(server: McpServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'test-client', version: '1.2.3' })
  await client.connect(clientSide)
  return client
}

/** Allowed on the wire: our list, plus the constants posthog-node adds after every hook. */
const WIRE_ALLOWED = new Set<string>([...MCP_ANALYTICS_PROPERTIES, '$lib', '$lib_version', '$is_server'])

describe('createMcpAnalyticsClient', () => {
  test('no key: no client, so nothing is instrumented', () => {
    assert.equal(createMcpAnalyticsClient({ apiKey: undefined, host: 'https://eu.i.posthog.com' }), undefined)
    assert.equal(createMcpAnalyticsClient({ apiKey: '  ', host: 'https://eu.i.posthog.com' }), undefined)
  })

  test('a personal key or a plain-http host is refused without printing the value', () => {
    const told: string[] = []
    assert.equal(createMcpAnalyticsClient({ apiKey: 'phx_secret123', host: 'https://eu.i.posthog.com', onError: (m) => told.push(m) }), undefined)
    assert.equal(createMcpAnalyticsClient({ apiKey: 'phc_abc', host: 'http://eu.i.posthog.com', onError: (m) => told.push(m) }), undefined)
    assert.equal(told.length, 2)
    for (const message of told) {
      assert.ok(!message.includes('phx_secret123') && !message.includes('phc_abc'), message)
    }
  })
})

describe('without a key the server is exactly as before', () => {
  test('every stored handler is the metered wrapper itself (nothing wrapped around it)', () => {
    const server = buildLocalServer(meterFor(new FakeAccount()))
    for (const [name, tool] of Object.entries(registered(server))) {
      assert.ok((tool.handler as unknown as Record<symbol, unknown>)[METERED] !== undefined, `${name} is wrapped`)
    }
  })
})

describe('tool input schemas are identical with and without instrumentation', () => {
  const sets: Array<[string, (setup?: McpAnalyticsSetup) => McpServer]> = [
    ['local (stdio)', (setup) => buildLocalServer(meterFor(new FakeAccount(), setup))],
    [
      'hosted (http)',
      (setup) =>
        buildHostedServer(
          { tokenId: 'token-1', tenantId: TENANT, userId: 'user-1', scope: new TenantScope(TENANT) },
          new Logger([]),
          { mcpAnalytics: setup },
        ),
    ],
  ]
  for (const [label, build] of sets) {
    test(label, async () => {
      const plain = await connect(build())
      const before = await plain.listTools()
      const posthog = fakePostHog()
      const instrumented = await connect(build({ client: posthog.client, serverBuild: BUILD }))
      const after = await instrumented.listTools()

      assert.ok(before.tools.length >= 10, `expected many tools, found ${before.tools.length}`)
      // Same tools, same order, same input schemas: no injected context,
      // conversation_id or llm_model argument, no virtual tool.
      assert.deepEqual(after, before)
      await posthog.drain()
      // tools/list is not one of the events we send.
      assert.ok(posthog.events().every((e) => e.event !== '$mcp_tools_list'))
    })
  }
})

describe('a tool call', () => {
  async function run() {
    const account = new FakeAccount()
    const posthog = fakePostHog()
    const server = createAdsPilotServer('9.9.9', meterFor(account, { client: posthog.client, serverBuild: BUILD }))
    server.tool('canary_echo', 'Echo', { note: z.string() }, async ({ note }) => ({
      content: [{ type: 'text' as const, text: `posted: ${note} https://example.com/p?token=${CANARY}` }],
    }))
    server.tool('canary_fail', 'Fail', { note: z.string() }, async ({ note }) => ({
      content: [{ type: 'text' as const, text: `[TOKEN_EXPIRED] The token expired while posting "${note}".` }],
    }))
    server.tool('canary_throw', 'Throw', { note: z.string() }, async ({ note }) => {
      throw new Error(`exploded on ${note} for someone@example.com`)
    })
    const client = await connect(server)
    for (const name of ['canary_echo', 'canary_fail', 'canary_throw']) {
      await client.callTool({ name, arguments: { note: CANARY } })
    }
    // A name the client invents is its text, not ours.
    await client.callTool({ name: `made_up_${CANARY}`, arguments: { note: CANARY } }).catch(() => undefined)
    await posthog.drain()
    return { account, posthog }
  }

  test('produces one $mcp_tool_call per call, and no argument or result text anywhere on the wire', async () => {
    const { posthog } = await run()
    const wire = posthog.bodies.join('\n')
    assert.ok(posthog.bodies.length > 0, 'nothing was sent')
    assert.ok(!wire.includes(CANARY), 'the canary reached the wire')
    assert.ok(!wire.includes('someone@example.com'))
    assert.ok(!wire.includes('example.com'))

    const calls = posthog.events().filter((e) => e.event === '$mcp_tool_call')
    assert.deepEqual(
      calls.map((e) => e.properties.$mcp_tool_name),
      ['canary_echo', 'canary_fail', 'canary_throw', 'unknown_tool'],
    )
    for (const e of posthog.events()) {
      assert.ok(['$mcp_tool_call', '$mcp_initialize'].includes(e.event), `unexpected event ${e.event}`)
      for (const key of Object.keys(e.properties)) assert.ok(WIRE_ALLOWED.has(key), `${e.event} sent ${key}`)
      assert.equal(e.properties.$geoip_disable, true)
      assert.equal(e.distinct_id, TENANT)
    }
  })

  test('carries the outcome as our catalogue code, the client, the build and the duration', async () => {
    const { posthog } = await run()
    const byTool = new Map(posthog.events().filter((e) => e.event === '$mcp_tool_call').map((e) => [e.properties.$mcp_tool_name, e.properties]))
    const ok = byTool.get('canary_echo')!
    assert.equal(ok.$mcp_is_error, false)
    assert.equal(ok.$mcp_error_type, undefined)
    assert.equal(ok.$mcp_client_name, 'test-client')
    assert.equal(ok.$mcp_client_version, '1.2.3')
    assert.equal(ok.$mcp_server_name, 'adspilot')
    assert.equal(ok.$mcp_server_version, '9.9.9')
    assert.equal(ok.$mcp_server_build, BUILD)
    assert.equal(typeof ok.$mcp_duration_ms, 'number')
    assert.match(String(ok.$session_id), /^ses_/)

    // A failure our tools report in the text, which the SDK alone would call a success.
    assert.equal(byTool.get('canary_fail')!.$mcp_is_error, true)
    assert.equal(byTool.get('canary_fail')!.$mcp_error_type, 'TOKEN_EXPIRED')
    // A throw has no catalogue code.
    assert.equal(byTool.get('canary_throw')!.$mcp_is_error, true)
    assert.equal(byTool.get('canary_throw')!.$mcp_error_type, 'UNKNOWN')
    assert.equal(byTool.get('unknown_tool')!.$mcp_is_error, true)
  })

  test('metering still counts each call exactly once', async () => {
    const { account } = await run()
    // The invented tool never reaches a handler, so it is neither metered nor counted.
    assert.deepEqual(
      account.recorded.map((r) => [r.tool, r.counted, r.ok, r.errorCode]),
      [
        ['canary_echo', true, true, undefined],
        ['canary_fail', true, false, 'TOKEN_EXPIRED'],
        ['canary_throw', true, false, 'UNKNOWN'],
      ],
    )
    assert.equal(account.calls, 3)
  })
})

describe('every tool is still metered once when instrumented', () => {
  const sets: Array<[string, (account: FakeAccount, setup: McpAnalyticsSetup) => McpServer]> = [
    ['local (stdio)', (account, setup) => buildLocalServer(meterFor(account, setup))],
    [
      'hosted (http)',
      (account, setup) =>
        buildHostedServer(
          { tokenId: 'token-1', tenantId: TENANT, userId: 'user-1', scope: new TenantScope(TENANT) },
          new Logger([]),
          { mcpAnalytics: setup, meter: { account: async () => account } },
        ),
    ],
  ]
  for (const [label, build] of sets) {
    test(label, async () => {
      // Free plan at its allowance: a counted tool returns the limit message and
      // does no work, so no tool here touches a database or a platform.
      const account = new FakeAccount()
      account.plan = 'free'
      account.calls = 200
      const posthog = fakePostHog()
      const tools = registered(build(account, { client: posthog.client }))
      const names = Object.keys(tools)
      assert.ok(names.length >= 10)
      for (const name of names) {
        const before = account.recorded.length
        // What the SDK stores is the analytics wrapper; the metered handler must be inside it.
        await tools[name]!.handler(name === 'set_business_type' ? { business_type: 'agency' } : {}, {})
        const added = account.recorded.slice(before)
        assert.equal(added.length, 1, `${label}: ${name} was recorded ${added.length} times`)
        assert.equal(added[0]!.counted, false, `${label}: ${name}`) // free tools are not counted; refused ones neither
        if (!FREE_TOOLS.includes(name)) assert.equal(added[0]!.errorCode, 'USAGE_LIMIT_REACHED', `${label}: ${name}`)
      }
      await posthog.client.shutdown(500)
    })
  }
})

describe('hosted: stateless streamable HTTP, one server per request', () => {
  test('events carry the tenant behind the token, and no Mcp-Session-Id header is added', async () => {
    const posthog = fakePostHog()
    const account = new FakeAccount(TENANT)
    const identity = { tokenId: 'token-h1', tenantId: TENANT, userId: 'user-1', scope: new TenantScope(TENANT) }
    const sessionHeaders: Array<string | null> = []

    const http: Server = createServer((req, res) => {
      void (async () => {
        const mcp = buildHostedServer(identity, new Logger([]), {
          mcpAnalytics: { client: posthog.client, serverBuild: BUILD },
          meter: { account: async () => account },
        })
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        res.on('close', () => {
          rememberClient(identity.tokenId, mcp.server.getClientVersion())
          void transport.close()
          void mcp.close()
        })
        await mcp.connect(transport)
        await transport.handleRequest(req, res)
      })()
    })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    const port = (http.address() as AddressInfo).port

    try {
      const fetchWithHeaders: typeof fetch = async (input, init) => {
        const response = await fetch(input, init)
        sessionHeaders.push(response.headers.get('mcp-session-id'))
        return response
      }
      const client = new Client({ name: 'hosted-client', version: '4.5.6' })
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { fetch: fetchWithHeaders }))
      await client.callTool({ name: 'check_usage', arguments: {} })
      await client.close()
    } finally {
      await new Promise<void>((resolve) => http.close(() => resolve()))
    }
    await posthog.drain()

    assert.ok(sessionHeaders.length > 0)
    assert.ok(sessionHeaders.every((h) => h === null), `a session header was sent: ${sessionHeaders.join(',')}`)
    const call = posthog.events().find((e) => e.event === '$mcp_tool_call')
    assert.ok(call !== undefined, 'no tool call event')
    assert.equal(call.distinct_id, TENANT)
    assert.equal(call.properties.$mcp_tool_name, 'check_usage')
    for (const e of posthog.events()) {
      for (const key of Object.keys(e.properties)) assert.ok(WIRE_ALLOWED.has(key), `${e.event} sent ${key}`)
    }
  })
})

describe('mcpAnalyticsBeforeSend', () => {
  const filter = mcpAnalyticsBeforeSend((name) => name === 'publish_post')
  const base = { distinct_id: TENANT, timestamp: '2026-10-08T10:00:00.000Z', type: 'capture' as const }

  test('drops every event but $mcp_tool_call and $mcp_initialize', async () => {
    for (const event of ['$identify', '$exception', '$mcp_tools_list', '$mcp_resource_read', '$mcp_feedback', '$mcp_custom', 'anything']) {
      assert.equal(await filter({ ...base, event, properties: { $mcp_tool_name: 'publish_post' } }), null, event)
    }
  })

  test('keeps only the allow-list and drops arguments, results, messages, headers and person data', async () => {
    const out = await filter({
      ...base,
      event: '$mcp_tool_call',
      properties: {
        $mcp_tool_name: 'publish_post',
        $mcp_parameters: { arguments: { text: CANARY } },
        $mcp_response: { content: [{ type: 'text', text: CANARY }] },
        $mcp_error_message: CANARY,
        $mcp_input_keys: ['text'],
        $mcp_client_user_agent: 'claude-code/2.1.0 (cli)',
        $mcp_vendor_client: 'x',
        $mcp_intent: CANARY,
        $mcp_llm_model: 'model',
        $mcp_tool_description: 'Publish a post',
        $set: { email: 'a@b.c' },
        $groups: { company: 'x' },
        custom: CANARY,
        $mcp_is_error: false,
        $mcp_duration_ms: 12.4,
        $session_id: 'ses_0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        $mcp_client_name: 'claude-code',
        $mcp_client_version: '2.1.0',
      },
    })
    assert.ok(out)
    assert.deepEqual(out.properties, {
      $mcp_source: 'posthog_mcp_analytics',
      $geoip_disable: true,
      $session_id: 'ses_0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      $mcp_client_name: 'claude-code',
      $mcp_client_version: '2.1.0',
      $mcp_duration_ms: 12,
      $mcp_tool_name: 'publish_post',
      $mcp_resource_name: 'publish_post',
      $mcp_is_error: false,
    })
  })

  test('an unknown tool name, an email as distinct id and unsafe values do not pass', async () => {
    const unknown = await filter({ ...base, event: '$mcp_tool_call', properties: { $mcp_tool_name: `send ${CANARY}` } })
    assert.equal(unknown?.properties.$mcp_tool_name, 'unknown_tool')
    assert.equal(await filter({ ...base, distinct_id: 'owner@example.com', event: '$mcp_tool_call', properties: {} }), null)
    const unsafe = await filter({
      ...base,
      event: '$mcp_initialize',
      properties: { $mcp_client_name: 'https://evil.example/?q=1', $mcp_client_version: 'Bearer abcdefghijklmnopqrstuvwxyz', $session_id: 'not-a-session', $mcp_server_build: 'latest' },
    })
    assert.deepEqual(unsafe?.properties, { $mcp_source: 'posthog_mcp_analytics', $geoip_disable: true })
  })

  test('the error code comes from the catalogue, never from the message text', async () => {
    const fromResponse = await filter({
      ...base,
      event: '$mcp_tool_call',
      properties: { $mcp_tool_name: 'publish_post', $mcp_is_error: false, $mcp_response: { content: [{ type: 'text', text: '[RATE_LIMITED] slow down' }] } },
    })
    assert.equal(fromResponse?.properties.$mcp_is_error, true)
    assert.equal(fromResponse?.properties.$mcp_error_type, 'RATE_LIMITED')
    const fromMessage = await filter({
      ...base,
      event: '$mcp_tool_call',
      properties: { $mcp_tool_name: 'publish_post', $mcp_is_error: true, $mcp_error_type: 'Error', $mcp_error_message: `[NOT_A_CODE] ${CANARY}` },
    })
    assert.equal(fromMessage?.properties.$mcp_error_type, 'UNKNOWN')
  })
})

describe('resolveServerBuild', () => {
  test('BUILD_SHA when it is a SHA; nothing when it is not', () => {
    assert.equal(resolveServerBuild({ BUILD_SHA: 'ABC1234DEF56' }), 'abc1234def56')
    assert.equal(resolveServerBuild({ BUILD_SHA: 'latest' }), undefined)
    assert.equal(resolveServerBuild({ BUILD_SHA: 'abc; rm -rf /' }), undefined)
  })
})
