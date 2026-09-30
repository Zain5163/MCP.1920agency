import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerSetupTools } from '../src/setup-tools.ts'

async function callTool(server: McpServer, name: string, args: Record<string, unknown>): Promise<string> {
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: Function }> })._registeredTools
  const result = (await tools[name]!.handler(args, {})) as { content: Array<{ text: string }> }
  return result.content[0]!.text
}

describe('creating Meta business assets needs approval first', () => {
  process.env.META_ADS_ACCESS_TOKEN ??= 'test-token'

  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['create_business', { name: 'Acme', vertical: 'OTHER', primaryPageId: 'p1' }, /Meta does not allow deleting one/],
    ['create_ad_account', { businessId: 'b1', name: 'Acme', currency: 'PKR', timezoneId: 105 }, /closed later but never deleted/],
    ['create_pixel', { adAccountId: '777', name: 'acme.com' }, /one per ad account/],
  ]

  for (const [tool, args, consequence] of cases) {
    test(`${tool} asks, says it is permanent, and calls nothing`, async () => {
      const realFetch = globalThis.fetch
      let called = false
      globalThis.fetch = (async () => {
        called = true
        throw new Error('must not be called')
      }) as typeof fetch
      try {
        const server = new McpServer({ name: 't', version: '0' })
        registerSetupTools(server)
        const reply = await callTool(server, tool, args)
        assert.match(reply, /APPROVAL NEEDED/)
        assert.match(reply, consequence)
        assert.doesNotMatch(reply, /is public/)
        assert.equal(called, false)
      } finally {
        globalThis.fetch = realFetch
      }
    })
  }

  test('a made-up token does not create anything', async () => {
    const realFetch = globalThis.fetch
    let called = false
    globalThis.fetch = (async () => {
      called = true
      throw new Error('must not be called')
    }) as typeof fetch
    try {
      const server = new McpServer({ name: 't', version: '0' })
      registerSetupTools(server)
      const reply = await callTool(server, 'create_pixel', { adAccountId: '777', name: 'acme.com', confirm: 'yes' })
      assert.match(reply, /APPROVAL NEEDED/)
      assert.equal(called, false)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
