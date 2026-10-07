import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { CountedMonth, ToolCallInput, UsageSnapshot } from '@social-publisher/db'

import { createAdsPilotServer } from '../src/mcp-server.ts'
import { installMetering, outcomeOf, type MeterOptions, type UsageAccount } from '../src/metering.ts'

/**
 * The metering wrapper, against an in-memory account. No database: the SQL is
 * tested separately (packages/db/test/usage.after-migration.ts).
 */

const LINK = 'https://adspilot.example/upgrade'
const NOW = new Date('2026-10-08T10:00:00Z')

/** An account held in memory, with the same contract as TenantScope. */
class FakeAccount implements UsageAccount {
  readonly tenantId = 'tenant-1'
  plan: 'free' | 'premium' = 'free'
  calls = 0
  shown: number[] = []
  readonly recorded: Array<ToolCallInput & { counted: boolean; month: string }> = []
  failRead = false
  failWrite = false

  async usage(month: string): Promise<UsageSnapshot> {
    if (this.failRead) throw new Error("Can't reach database server")
    return { plan: this.plan, planRenewsAt: null, month, calls: this.calls, noticesShown: [...this.shown] }
  }

  async recordToolCall(call: ToolCallInput, options: { month: string; count: boolean }): Promise<CountedMonth | null> {
    if (this.failWrite) throw new Error("Can't reach database server")
    this.recorded.push({ ...call, counted: options.count, month: options.month })
    if (!options.count) return null
    this.calls += 1
    return { month: options.month, calls: this.calls, noticesShown: [...this.shown] }
  }

  async markNoticesShown(_month: string, thresholds: readonly number[]): Promise<void> {
    this.shown.push(...thresholds)
  }
}

function setup(overrides: Partial<MeterOptions> = {}) {
  const account = new FakeAccount()
  const logged: string[] = []
  let ran = 0
  const options: MeterOptions = {
    transport: 'http',
    account: async () => account,
    userId: 'user-1',
    upgradeUrl: LINK,
    log: (event) => logged.push(event),
    now: () => NOW,
    ...overrides,
  }
  const server = createAdsPilotServer('test', options)
  server.tool('list_posts', 'test tool', {}, async () => {
    ran += 1
    return { content: [{ type: 'text' as const, text: 'two posts' }] }
  })
  return { account, logged, server, ran: () => ran }
}

type Result = { content: Array<{ type: string; text: string }> }

async function call(server: McpServer, name: string, args: Record<string, unknown> = {}): Promise<Result> {
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: Function }> })._registeredTools
  return (await tools[name]!.handler(args, {})) as Result
}

describe('every call is recorded and counted', () => {
  test('a successful call: tool, ok, duration, user, transport, month', async () => {
    const { account, server } = setup()
    const result = await call(server, 'list_posts')
    assert.equal(result.content[0]!.text, 'two posts')
    assert.equal(account.calls, 1)
    const row = account.recorded[0]!
    assert.equal(row.tool, 'list_posts')
    assert.equal(row.ok, true)
    assert.equal(row.errorCode, undefined)
    assert.equal(row.userId, 'user-1')
    assert.equal(row.transport, 'http')
    assert.equal(row.month, '2026-10')
    assert.equal(row.counted, true)
    assert.ok(row.durationMs >= 0)
  })

  test('nothing about the call content is recorded', async () => {
    const { account, server } = setup()
    server.tool('validate_post', 'test', { body: z.string() }, async ({ body }) => ({
      content: [{ type: 'text' as const, text: `checked ${body}` }],
    }))
    await call(server, 'validate_post', { body: 'secret launch copy' })
    assert.doesNotMatch(JSON.stringify(account.recorded), /secret launch copy/)
  })

  test('a catalogue failure is recorded with its code, and still counts', async () => {
    const { account, server } = setup()
    server.tool('check_status', 'test', {}, async () => ({
      content: [{ type: 'text' as const, text: '[DB_UNREACHABLE] The database could not be reached.\n\nWhy: ...' }],
    }))
    await call(server, 'check_status')
    assert.equal(account.recorded[0]!.ok, false)
    assert.equal(account.recorded[0]!.errorCode, 'DB_UNREACHABLE')
    assert.equal(account.calls, 1)
  })

  test('a tool that throws is recorded as UNKNOWN and the error still reaches the SDK', async () => {
    const { account, server } = setup()
    server.tool('broken', 'test', {}, async () => {
      throw new Error('boom')
    })
    await assert.rejects(() => call(server, 'broken'), /boom/)
    assert.equal(account.recorded[0]!.ok, false)
    assert.equal(account.recorded[0]!.errorCode, 'UNKNOWN')
  })

  test('tools registered with registerTool are metered too', async () => {
    const { account, server } = setup()
    server.registerTool('other', { description: 'test' }, async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }))
    await call(server, 'other')
    assert.equal(account.recorded[0]!.tool, 'other')
  })
})

describe('the Free limit', () => {
  test('at 200 calls the tool does no work and the limit message comes back', async () => {
    const { account, server, ran } = setup()
    account.calls = 200
    const result = await call(server, 'list_posts')
    assert.equal(ran(), 0, 'the tool must not run')
    assert.match(result.content[0]!.text, /^\[USAGE_LIMIT_REACHED\]/)
    assert.match(result.content[0]!.text, /reset on 1 November 2026 \(UTC\)/)
    assert.match(result.content[0]!.text, new RegExp(LINK.replace(/[.]/g, '\\.')))
    // Recorded as refused, not counted again.
    assert.equal(account.calls, 200)
    assert.equal(account.recorded[0]!.errorCode, 'USAGE_LIMIT_REACHED')
    assert.equal(account.recorded[0]!.counted, false)
  })

  test('the 200th call still runs', async () => {
    const { account, server, ran } = setup()
    account.calls = 199
    await call(server, 'list_posts')
    assert.equal(ran(), 1)
    assert.equal(account.calls, 200)
  })

  test('Premium is never blocked and never shown a notice', async () => {
    const { account, server, ran } = setup()
    account.plan = 'premium'
    account.calls = 5000
    const result = await call(server, 'list_posts')
    assert.equal(ran(), 1)
    assert.equal(result.content[0]!.text, 'two posts')
    assert.equal(account.calls, 5001, 'Premium calls are still counted, for the fair-use limit later')
  })

  test('check_usage and upgrade work at the limit and are not counted', async () => {
    const { account, server } = setup()
    account.calls = 200
    const usage = await call(server, 'check_usage')
    assert.match(usage.content[0]!.text, /200 of 200 \(0 left\)/)
    assert.match(usage.content[0]!.text, /Resets: 1 November 2026/)
    const upgrade = await call(server, 'upgrade')
    assert.match(upgrade.content[0]!.text, new RegExp(LINK.replace(/[.]/g, '\\.')))
    assert.equal(account.calls, 200)
    assert.deepEqual(
      account.recorded.map((r) => [r.tool, r.counted]),
      [['check_usage', false], ['upgrade', false]],
    )
  })

  test('without UPGRADE_URL the texts say so in plain words and invent no link', async () => {
    const { account, server } = setup({ upgradeUrl: undefined })
    account.calls = 200
    const result = await call(server, 'list_posts')
    assert.match(result.content[0]!.text, /waitlist/)
    assert.doesNotMatch(result.content[0]!.text, /https?:/)
  })
})

describe('usage notices', () => {
  test('the call that crosses 90% carries the notice, once', async () => {
    const { account, server } = setup()
    account.calls = 179
    account.shown = [25, 50, 75, 85]
    const crossing = await call(server, 'list_posts')
    assert.equal(
      crossing.content[0]!.text,
      `two posts\n\nUSAGE NOTICE: You've used 90% of your free calls this month (180 of 200). Premium is $9/month for unlimited use: ${LINK}.`,
    )
    assert.deepEqual(account.shown, [25, 50, 75, 85, 90])

    const next = await call(server, 'list_posts')
    assert.equal(next.content[0]!.text, 'two posts')
  })

  test('a result with no text gets the notice as its own text', async () => {
    const { account, server } = setup()
    server.tool('picture', 'test', {}, async () => ({ content: [{ type: 'image' as const, data: 'AA==', mimeType: 'image/png' }] }))
    account.calls = 49
    const result = await call(server, 'picture')
    assert.equal(result.content.length, 2)
    assert.match(result.content[1]!.text, /USAGE NOTICE: You've used 25%/)
  })
})

describe('metering never breaks a call', () => {
  test('usage cannot be read: the call runs (fail open), is still recorded, and it is logged', async () => {
    const { account, server, ran, logged } = setup()
    account.failRead = true
    account.calls = 500 // over the limit, but unreadable
    const result = await call(server, 'list_posts')
    assert.equal(ran(), 1)
    assert.equal(result.content[0]!.text, 'two posts', 'no notice without a readable plan')
    assert.deepEqual(logged, ['mcp.usage.read_failed'])
    assert.equal(account.recorded.length, 1)
  })

  test('the call cannot be recorded: the result comes back unchanged, and it is logged', async () => {
    const { account, server, logged } = setup()
    account.failWrite = true
    const result = await call(server, 'list_posts')
    assert.equal(result.content[0]!.text, 'two posts')
    assert.deepEqual(logged, ['mcp.usage.record_failed'])
  })

  test('no account can be resolved: the call runs unmetered, and it is logged', async () => {
    const { server, ran, logged } = setup({
      account: async () => {
        throw new Error('No account is set up yet.')
      },
    })
    const result = await call(server, 'list_posts')
    assert.equal(ran(), 1)
    assert.equal(result.content[0]!.text, 'two posts')
    assert.deepEqual(logged, ['mcp.usage.account_unresolved'])
  })
})

describe('the AI client is recorded from initialize', () => {
  test('clientInfo from a real initialize handshake', async () => {
    const { account, server } = setup()
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await server.connect(serverSide)
    const client = new Client({ name: 'claude-code', version: '2.1.0' })
    await client.connect(clientSide)

    await client.callTool({ name: 'list_posts', arguments: {} })
    assert.equal(account.recorded[0]!.clientName, 'claude-code')
    assert.equal(account.recorded[0]!.clientVersion, '2.1.0')
    await client.close()
  })

  test('the stateless fallback is used when this server never saw initialize', async () => {
    const { account, server } = setup({ clientInfo: () => ({ name: 'cursor', version: '1.0' }) })
    await call(server, 'list_posts')
    assert.equal(account.recorded[0]!.clientName, 'cursor')
  })

  test('a client name is stored at a bounded length', async () => {
    const { account, server } = setup({ clientInfo: () => ({ name: 'x'.repeat(5000), version: '1' }) })
    await call(server, 'list_posts')
    assert.equal(account.recorded[0]!.clientName!.length, 120)
  })
})

describe('installing metering', () => {
  test('twice is refused, so no call is ever counted twice', () => {
    const { server } = setup()
    assert.throws(() => installMetering(server, { transport: 'http', account: async () => new FakeAccount(), log: () => {} }), /already installed/)
  })

  test('task tools, which would bypass the wrapper, are refused', () => {
    const { server } = setup()
    const tasks = (server as unknown as { experimental: { tasks: { registerToolTask: Function } } }).experimental.tasks
    assert.throws(() => tasks.registerToolTask('long', {}, {}), /not metered/)
  })
})

describe('reading a result', () => {
  test('only a known catalogue code at the start is a failure', () => {
    const r = (text: string, isError?: boolean) => ({ content: [{ type: 'text', text }], ...(isError ? { isError } : {}) })
    assert.deepEqual(outcomeOf(r('[TOKEN_EXPIRED] The token expired.')), { ok: false, errorCode: 'TOKEN_EXPIRED' })
    assert.deepEqual(outcomeOf(r('[NOT_A_CODE] text')), { ok: true })
    assert.deepEqual(outcomeOf(r('Posts:\n[TOKEN_EXPIRED] an old target')), { ok: true })
    assert.deepEqual(outcomeOf(r('FAILED: something')), { ok: false, errorCode: 'UNKNOWN' })
    assert.deepEqual(outcomeOf(r('anything', true)), { ok: false, errorCode: 'UNKNOWN' })
    assert.deepEqual(outcomeOf(undefined), { ok: true })
  })
})
