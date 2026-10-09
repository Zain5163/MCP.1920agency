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
    assert.equal(library.size, 70)
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
    assert.match(text, /^70 skills/)
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

  test('serves the web-building additions under their own sources and licences', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    for (const [name, source, licence] of [
      ['core-web-vitals', 'addyosmani/web-quality-skills', 'MIT'],
      ['performance', 'addyosmani/web-quality-skills', 'MIT'],
      ['accessibility', 'addyosmani/web-quality-skills', 'MIT'],
      ['frontend-design', 'anthropics/skills', 'Apache License 2.0'],
    ] as const) {
      assert.equal(library.get(name)?.library.source, source, name)
      const text = await callTool(server, 'get_skill', { name })
      assert.ok(text.includes(source) && text.includes(licence), name)
    }
    // A link into a sibling skill is explained, so the AI can follow it.
    const cwv = await callTool(server, 'get_skill', { name: 'core-web-vitals' })
    assert.match(cwv, /get_skill \{ name: "performance", reference: "references\/MEASUREMENT\.md" \}/)
    assert.ok(library.get('performance')!.references.includes('references/MEASUREMENT.md'))
  })

  test('every vendored source keeps its licence text beside the copy', async () => {
    const { existsSync } = await import('node:fs')
    const root = new URL('../skills-library/', import.meta.url)
    for (const source of LIBRARIES.filter((l) => l.own !== true)) {
      const dir = new URL(`${source.folder}/`, root)
      assert.ok(
        ['LICENSE', 'LICENSE.txt', 'NOTICE.md'].some((f) => existsSync(new URL(f, dir))),
        `${source.folder} has no licence file`,
      )
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

  test('our own skill is framed as ours, not as third-party text', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    const text = await callTool(server, 'get_skill', { name: 'meta-account-manager' })
    assert.ok(text.startsWith('[AdsPilot skill: "meta-account-manager"'))
    assert.doesNotMatch(text.slice(0, 600), /Third-party guidance/)
    assert.match(text, /references\/field-notes\.md/)
    assert.match(text, /references\/research-2026-10\.md/)
  })

  /**
   * The skill is served to every AdsPilot user. Lessons come from client
   * accounts, so the client must never be identifiable from the text.
   */
  test('our own skills never name a client business', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const skill of [...library.values()].filter((s) => s.library.own === true)) {
      for (const file of ['SKILL.md', ...skill.references]) {
        const text = readFileSync(join(skill.dir, ...file.split('/')), 'utf8')
        for (const client of ['Muzaree', 'GradCollective', 'Knightsbridge', 'PSX', 'Syndra']) {
          assert.doesNotMatch(text, new RegExp(client, 'i'), `${skill.name}/${file} names ${client}`)
        }
      }
    }
  })

  /**
   * Our own skills tell the AI which tool to call. A tool name that does not
   * exist sends it looking for something it cannot do, or worse, makes it
   * claim it did. Every shopify_ name in our skills must be a registered tool.
   */
  test('our own skills name only Shopify, WordPress and WooCommerce tools that really exist', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const srcDir = new URL('../src/', import.meta.url)
    const registered = new Set<string>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.ts'))) {
      const code = readFileSync(new URL(file, srcDir), 'utf8')
      for (const [, name] of code.matchAll(/server\.tool\(\s*'([a-z_]+)'/g)) registered.add(name!)
    }
    assert.ok(registered.has('shopify_theme_publish') && registered.has('wordpress_save_content') && registered.has('list_skills'), 'tool scan found nothing')
    for (const skill of [...library.values()].filter((s) => s.library.own === true)) {
      for (const file of ['SKILL.md', ...skill.references]) {
        const text = readFileSync(join(skill.dir, ...file.split('/')), 'utf8')
        for (const [name] of text.matchAll(/(?<![.\w/-])(shopify|wordpress|woocommerce)_[a-z_]+|list_(shopify_stores|wordpress_sites)/g)) {
          // WooCommerce's own option and filter names share the prefix; they are not tools.
          if (/^woocommerce_(checkout|checkout_fields|prices_include_tax|calc_taxes|currency|tax_display_shop|tax_display_cart)$/.test(name)) continue
          assert.ok(registered.has(name), `${skill.name}/${file} names ${name}, which is not a tool`)
        }
      }
    }
  })

  /**
   * The owner (2026-10-08): the website skills must work in every market, not
   * only Pakistan. Each one must send the AI to the country rules, and every
   * market reference the country skill names must really be served.
   */
  test('the website and store skills send the AI to the buyer’s country rules', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const name of [
      'store-builder',
      'landing-page-builder',
      'shopify-theme-developer',
      'web-ui-design',
      'wordpress-site-builder',
      'store-platform-choice',
      'campaign-setup',
    ]) {
      const skill = library.get(name)!
      const text = readFileSync(join(skill.dir, 'SKILL.md'), 'utf8')
      assert.match(text, /selling-by-country/, `${name} does not point to selling-by-country`)
    }
    const markets = library.get('selling-by-country')!
    const named = readFileSync(join(markets.dir, 'SKILL.md'), 'utf8').matchAll(/^\|[^\n]*?`(references\/[a-z-]+\.md)`/gm)
    const listed = [...named].map((m) => m[1]!)
    assert.ok(listed.length >= 9, 'the market table lists too few references')
    for (const ref of listed) assert.ok(markets.references.includes(ref), `${ref} is named but not served`)
    for (const market of ['united-states', 'canada', 'united-kingdom', 'european-union', 'australia', 'new-zealand', 'gulf', 'india', 'pakistan']) {
      assert.ok(markets.references.includes(`references/${market}.md`), `${market} reference missing`)
    }
  })

  test('every market reference is dated, sourced and says it is not legal advice', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const markets = library.get('selling-by-country')!
    for (const ref of markets.references) {
      const text = readFileSync(join(markets.dir, ...ref.split('/')), 'utf8')
      assert.match(text, /\*\*Updated \d{4}-\d{2}-\d{2}\.\*\*/, `${ref} has no date`)
      assert.match(text, /not legal advice/, `${ref} does not say it is not legal advice`)
      assert.match(text, /## Sources/, `${ref} has no sources`)
      assert.match(text, /https:\/\//, `${ref} cites no link`)
    }
  })

  /**
   * AdsPilot has WordPress tools since 2026-10-08. Before anything else the skill
   * must name them and say that every change waits for the user's approval, and
   * that the login is an Application Password, never the user's own password.
   */
  test('the WordPress skill names its tools and the approval rule first', async () => {
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    const text = (await callTool(server, 'get_skill', { name: 'wordpress-site-builder' })).slice(0, 4000)
    assert.match(text, /wordpress_connect_site/)
    assert.match(text, /Every change needs the user['’]s approval/i)
    assert.match(text, /Application Password/)
    assert.match(text, /never\s+the user['’]s own login password/i)
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

  test('every skill they name is served', async () => {
    const { SERVER_INSTRUCTIONS } = await import('../src/playbooks.ts')
    const library = loadLibrary()
    for (const name of ['store-builder', 'landing-page-builder', 'shopify-theme-developer', 'web-ui-design', 'wordpress-site-builder', 'shopify-store-kit', 'campaign-setup', 'selling-by-country']) {
      assert.ok(SERVER_INSTRUCTIONS.includes(name), `instructions miss ${name}`)
      assert.ok(library.has(name), `instructions name ${name}, which is not served`)
    }
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

describe('code templates in AdsPilot’s own skills', () => {
  const library = loadLibrary()

  test('the store kit serves its theme files, and third-party skills stay Markdown-only', () => {
    const kit = library.get('shopify-store-kit')!
    for (const f of ['references/theme/sections/ap-hero.liquid', 'references/theme/snippets/ap-kit-base.liquid', 'references/theme/templates/index.example.json', 'references/theme/config/settings_data.recipe.json']) {
      assert.ok(kit.references.includes(f), f)
    }
    for (const skill of library.values()) {
      if (skill.library.own === true) continue
      for (const r of skill.references) assert.match(r, /\.md$/, `${skill.name}: ${r}`)
    }
  })

  test('a template is served between markers, exactly as stored', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const server = new McpServer({ name: 't', version: '1' })
    registerSkillsLibrary(server)
    const ref = 'references/theme/sections/ap-hero.liquid'
    const text = await callTool(server, 'get_skill', { name: 'shopify-store-kit', reference: ref })
    const body = text.split(`----- BEGIN ${ref} -----
`)[1]!.split(`
----- END ${ref} -----`)[0]
    assert.equal(body, readFileSync(join(library.get('shopify-store-kit')!.dir, ref), 'utf8'))
  })

  test('the kit’s JSON templates parse', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const kit = library.get('shopify-store-kit')!
    for (const r of kit.references.filter((f) => f.endsWith('.json'))) JSON.parse(readFileSync(join(kit.dir, r), 'utf8'))
  })
})
