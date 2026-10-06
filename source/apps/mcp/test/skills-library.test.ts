import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { COVERED_ELSEWHERE, LIBRARIES, framing, loadLibrary, registerSkillsLibrary } from '../src/skills-library.ts'
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

  test('loads every skill in the pinned copies', () => {
    assert.equal(library.size, 54)
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
    assert.match(text, /^54 skills/)
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

  test('serves the four advertising-skills additions under their own source', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    for (const name of [
      'schwartz-awareness-mapper',
      'mechanism-builder',
      'conversion-path-builder',
      'full-funnel-campaign-orchestrator',
    ]) {
      assert.equal(library.get(name)?.library.source, 'realkimbarrett/advertising-skills', name)
      const text = await callTool(server, 'get_skill', { name })
      assert.match(text, /realkimbarrett\/advertising-skills/, name)
      assert.doesNotMatch(text, /coreyhaines31/, name)
    }
  })

  /**
   * The orchestrator we keep names skills we chose not to serve. An AI that
   * follows it must be sent to the deeper skill that replaces each one.
   */
  test('a skill left out on purpose points to its replacement', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    assert.match(await callTool(server, 'get_skill', { name: 'avatar-extraction' }), /customer-research/)
    assert.match(await callTool(server, 'get_skill', { name: 'performance-diagnosis' }), /meta-performance/)
    for (const name of Object.keys(COVERED_ELSEWHERE)) assert.ok(!library.has(name), `${name} is served after all`)
  })

  test('every replacement it points to really exists', () => {
    for (const target of Object.values(COVERED_ELSEWHERE)) {
      for (const [, skill] of target.matchAll(/get_skill \{ name: "([^"]+)" \}/g)) {
        assert.ok(library.has(skill!), `${skill} is not served`)
      }
    }
  })

  test('two sources serving the same name stop the server rather than one vanishing', () => {
    const twice = [LIBRARIES[0]!, { ...LIBRARIES[0]!, source: 'someone/else' }]
    assert.throws(() => loadLibrary(undefined, twice), /both provide/)
  })

  test('the framing tells the AI our playbooks win where both apply', () => {
    assert.match(framing('ads', 'SKILL.md'), /playbook wins/)
  })
})

describe('our own playbooks', () => {
  test('every playbook loads and is served by name', async () => {
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
    // Every platform except Meta is planning-only, and must say so near the top
    // so the AI tells the user before writing a word.
    for (const { key } of PLAYBOOKS.filter((p) => !p.key.startsWith('meta-'))) {
      const text = await callTool(server, 'get_playbook', { platform: key })
      assert.match(text.slice(0, 900), /cannot (be )?launch/i, key)
    }
  })
})

describe('the instructions every client receives on connecting', () => {
  test('point the AI at every playbook and at the skills, by the names the tools use', async () => {
    const { SERVER_INSTRUCTIONS } = await import('../src/playbooks.ts')
    for (const { key } of PLAYBOOKS) assert.ok(SERVER_INSTRUCTIONS.includes(key), `instructions miss ${key}`)
    for (const tool of ['get_playbook', 'list_skills', 'get_skill']) assert.ok(SERVER_INSTRUCTIONS.includes(tool))
  })

  test('the tools they name really exist', () => {
    const server = new McpServer({ name: 't', version: '0' })
    registerPlaybooks(server)
    registerSkillsLibrary(server)
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools
    for (const tool of ['get_playbook', 'list_skills', 'get_skill']) assert.ok(tools[tool], `${tool} not registered`)
  })
})

describe('playbooks stay current', () => {
  test('every playbook carries a date the server can read', async () => {
    const { readFileSync } = await import('node:fs')
    const { playbookDate } = await import('../src/playbooks.ts')
    for (const { key } of PLAYBOOKS) {
      const md = readFileSync(new URL(`../playbooks/${key}.md`, import.meta.url), 'utf8')
      assert.ok(playbookDate(md) !== undefined, `${key} has no "**Updated YYYY-MM-DD.**" line`)
    }
  })

  test('an old playbook warns the AI to check before relying on it; a fresh one does not', async () => {
    const { withFreshness } = await import('../src/playbooks.ts')
    const md = '# X\n\n**Updated 2026-01-01.** Something.'
    assert.equal(withFreshness(md, new Date('2026-02-01T00:00:00Z')), md)
    assert.match(withFreshness(md, new Date('2026-09-30T00:00:00Z')), /272 days old/)
  })
})
