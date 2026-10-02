import { strict as assert } from 'node:assert'
import { test, describe, before, after } from 'node:test'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerPerformanceTools } from '../src/performance-tools.ts'

async function callTool(server: McpServer, name: string, args: Record<string, unknown>): Promise<string> {
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: Function }> })._registeredTools
  const result = (await tools[name]!.handler(args, {})) as { content: Array<{ text: string }> }
  return result.content[0]!.text
}

/** Meta, faked: reads answer, writes are recorded and never leave the machine. */
const posts: string[] = []
const realFetch = globalThis.fetch

describe('the performance team changes nothing without approval', () => {
  before(() => {
    process.env.META_ADS_ACCESS_TOKEN ??= 't'
    process.env.META_AD_ACCOUNT_ID ??= '1'
    process.env.META_ADS_PAGE_ID ??= '2'
    process.env.META_AD_ACCOUNT_CURRENCY ??= 'PKR'
    process.env.META_ADS_DAILY_LIMIT ??= '10000'
    process.env.META_ADS_MONTHLY_LIMIT ??= '300000'
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        posts.push(String(url))
        return new Response(JSON.stringify({ success: true }))
      }
      const u = new URL(String(url))
      const body = /\/(campaigns|adsets)$/.test(u.pathname)
        ? { data: [] }
        : { name: 'Leads PK', daily_budget: '50000', effective_status: 'ACTIVE', targeting: {} }
      return new Response(JSON.stringify(body))
    }) as typeof fetch
  })
  after(() => {
    globalThis.fetch = realFetch
  })

  const server = () => {
    const s = new McpServer({ name: 't', version: '0' })
    registerPerformanceTools(s)
    return s
  }

  test('a budget change asks first, shows old and new, and warns past 20%', async () => {
    posts.length = 0
    const reply = await callTool(server(), 'change_budget', { id: 'AS1', newDailyBudget: 1000 })
    assert.match(reply, /APPROVAL NEEDED/)
    assert.match(reply, /500\.00 PKR → 1000\.00 PKR per day \(\+100%\)/)
    assert.match(reply, /restarts Meta’s learning/)
    assert.match(reply, /changes real daily spending/)
    assert.equal(posts.length, 0)
  })

  test('a made-up token changes nothing', async () => {
    posts.length = 0
    const reply = await callTool(server(), 'change_budget', { id: 'AS1', newDailyBudget: 600, confirm: 'yes' })
    assert.match(reply, /APPROVAL NEEDED/)
    assert.equal(posts.length, 0)
  })

  test('switching off happens at once, with no approval', async () => {
    posts.length = 0
    const reply = await callTool(server(), 'set_ad_delivery', { id: 'AD1', on: false })
    assert.match(reply, /switched off/)
    assert.equal(posts.length, 1)
  })

  test('switching on asks first', async () => {
    posts.length = 0
    const reply = await callTool(server(), 'set_ad_delivery', { id: 'AD1', on: true })
    assert.match(reply, /APPROVAL NEEDED/)
    assert.equal(posts.length, 0)
  })

  test('excluding placements asks first and says learning restarts', async () => {
    posts.length = 0
    const reply = await callTool(server(), 'exclude_placements', { adSetId: 'AS1', exclude: ['audience_network'] })
    assert.match(reply, /APPROVAL NEEDED/)
    assert.match(reply, /restarts Meta’s learning/)
    assert.equal(posts.length, 0)
  })
})
