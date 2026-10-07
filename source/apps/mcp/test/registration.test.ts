import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { FREE_TOOLS } from '@social-publisher/core'
import { TenantScope } from '@social-publisher/db'
import { Logger } from '@social-publisher/telemetry'

import { buildHostedServer } from '../src/hosted-server.ts'
import { buildLocalServer } from '../src/local-server.ts'
import { METERED, type MeterOptions } from '../src/metering.ts'

/**
 * No tool can be added unmetered.
 *
 * Builds exactly the tool sets the two transports serve — through the same
 * functions server.ts and http-server.ts call — and checks every registered
 * handler carries the metering mark. A tool added to either transport by any
 * route shows up here; one that is not metered fails the build.
 *
 * Nothing is called, so nothing reaches the database or a platform.
 */

const meter: MeterOptions = {
  transport: 'stdio',
  account: async () => {
    throw new Error('not used: no tool is called here')
  },
  log: () => {},
}

function registered(server: McpServer): Record<string, { handler: unknown }> {
  return (server as unknown as { _registeredTools: Record<string, { handler: unknown }> })._registeredTools
}

function markOf(handler: unknown): unknown {
  return (handler as Record<symbol, unknown>)[METERED]
}

const transports: Array<[string, () => McpServer]> = [
  ['local (stdio)', () => buildLocalServer(meter)],
  [
    'hosted (http)',
    () =>
      buildHostedServer(
        { tokenId: 'token-1', tenantId: 'tenant-1', userId: 'user-1', scope: new TenantScope('tenant-1') },
        new Logger([]),
      ),
  ],
]

for (const [label, build] of transports) {
  describe(`every ${label} tool is metered`, () => {
    const tools = registered(build())
    const names = Object.keys(tools)

    test('finds the tool set (guards against a vacuous pass)', () => {
      assert.ok(names.length >= 10, `expected many tools, found ${names.length}: ${names.join(', ')}`)
      assert.ok(names.includes('publish_post'))
    })

    test('has the free account tools', () => {
      for (const name of FREE_TOOLS) assert.ok(names.includes(name), `${label} is missing ${name}`)
    })

    test('each tool is counted, except the free account tools', () => {
      for (const name of names) {
        const expected = FREE_TOOLS.includes(name) ? 'free' : 'counted'
        assert.equal(markOf(tools[name]!.handler), expected, `${label}: ${name} is not metered as ${expected}`)
      }
    })
  })
}

describe('servers are built in one place', () => {
  test('nothing in src constructs an McpServer except createAdsPilotServer', () => {
    // A server built anywhere else would have no metering installed.
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
    const offenders = readdirSync(src)
      .filter((file) => file.endsWith('.ts') && file !== 'mcp-server.ts')
      .filter((file) => /new\s+McpServer\s*\(/.test(readFileSync(join(src, file), 'utf8')))
    assert.deepEqual(offenders, [])
  })
})
