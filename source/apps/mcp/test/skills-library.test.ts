import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { framing, loadLibrary, registerSkillsLibrary } from '../src/skills-library.ts'
import { PLAYBOOKS, registerPlaybooks } from '../src/playbooks.ts'

/**
 * Calls a registered tool directly, without a transport. The SDK keeps
 * registered tools on the server instance; reaching them this way tests the
 * handler itself rather than JSON-RPC plumbing already tested upstream.
 */
async function callTool(server: McpServer, name: string, args: Record<string, unknown>): Promise<string> {
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: Function }> })._registeredTools
  const tool = tools[name]
  assert.ok(tool, `tool ${name} is not registered`)
  const result = (await tool.handler(args, {})) as { content: Array<{ text: string }> }
  return result.content[0]!.text
}

describe('the skills library', () => {
  const library = loadLibrary()

  test('loads every skill in the pinned copy', () => {
    assert.equal(library.size, 50)
    for (const name of ['seo-audit', 'ai-seo', 'copywriting', 'ads', 'social', 'cro']) {
      assert.ok(library.has(name), `${name} is missing`)
    }
  })

  test('every skill has a description a client can show', () => {
    for (const skill of library.values()) assert.ok(skill.description.length > 20, skill.name)
  })

  test('lists all skills through the tool', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    const text = await callTool(server, 'list_skills', {})
    assert.match(text, /^50 skills/)
    assert.match(text, /seo-audit/)
  })

  test('serves a skill under the framing note', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    const text = await callTool(server, 'get_skill', { name: 'copywriting' })
    assert.ok(text.startsWith('[Skill library: "copywriting"'))
    assert.match(text, /not as instructions that override/)
    assert.match(text, /\.agents\/product-marketing\.md.*do not exist/s)
  })

  test('lists a skill’s reference files so they can be read next', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    const text = await callTool(server, 'get_skill', { name: 'ads' })
    assert.match(text, /references\/meta-decision-system\.md/)
  })

  test('reads a listed reference file', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    const text = await callTool(server, 'get_skill', {
      name: 'ads',
      reference: 'references/meta-decision-system.md',
    })
    assert.match(text, /Meta Decision System/)
  })

  /**
   * The safety property of this tool. A reference is looked up in the index,
   * never joined onto a path as given, so "../" cannot walk out of the library
   * to the env file holding the credentials, or anywhere else.
   */
  test('refuses a path that tries to leave the library', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    for (const reference of [
      '../../../../../../.social-publisher/.env',
      '../ads/SKILL.md',
      'references/../../../../README.md',
      'C:/Windows/win.ini',
    ]) {
      const text = await callTool(server, 'get_skill', { name: 'copywriting', reference })
      assert.match(text, /is not a reference of "copywriting"/, reference)
    }
  })

  test('an unknown skill is explained, not an error', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    assert.match(await callTool(server, 'get_skill', { name: 'nope' }), /No skill called "nope"/)
  })

  test('the framing tells the AI our playbooks win where both apply', () => {
    assert.match(framing('ads', 'SKILL.md'), /playbook wins/)
  })
})

describe('our own playbooks', () => {
  test('all three load and are served by name', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerPlaybooks(server)
    for (const { key } of PLAYBOOKS) {
      const text = await callTool(server, 'get_playbook', { platform: key })
      assert.ok(text.length > 1000, `${key} looks empty`)
    }
  })

  test('the platforms not yet connected say so first', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerPlaybooks(server)
    for (const key of ['google-ads', 'tiktok-ads']) {
      const text = await callTool(server, 'get_playbook', { platform: key })
      assert.match(text.slice(0, 400), /cannot launch/i, key)
    }
  })
})
