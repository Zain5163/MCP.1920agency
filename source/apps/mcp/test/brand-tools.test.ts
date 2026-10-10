import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { describe, test } from 'node:test'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { handleViewerRequest, verifyViewerToken, type BrandViewer } from '@social-publisher/brands'

import { allBrands, registerBrandTools, type BrandToolOptions } from '../src/brand-tools.ts'
import { SERVER_INSTRUCTIONS } from '../src/playbooks.ts'

/**
 * The brand tools as an AI uses them, with fakes for who is asking: no
 * database, no network. The viewer route is the real one, so a link made by
 * brand_viewer_link is checked to open exactly what it promised.
 */

const OWNER = 'tenant-owner-0001'
const OTHER = 'tenant-other-0002'
const SECRET = 'a-test-viewer-secret-of-at-least-32-chars'
const NOW = new Date('2026-10-10T12:00:00Z')
const BASE = 'https://mcp.example.test'

function server(options: Partial<BrandToolOptions> & { tenant?: string; owner?: string | undefined } = {}): McpServer {
  const s = new McpServer({ name: 't', version: '0' })
  const viewer: BrandViewer = { tenantId: options.tenant ?? OWNER, ownerTenantId: 'owner' in options ? options.owner : OWNER }
  registerBrandTools(s, {
    viewer: async () => viewer,
    settings: () => ({}),
    viewerSecret: () => SECRET,
    publicBaseUrl: () => BASE,
    now: () => NOW,
    ...options,
  })
  return s
}

async function call(s: McpServer, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tools = (s as unknown as { _registeredTools: Record<string, { handler: Function }> })._registeredTools
  const tool = tools[name]
  assert.ok(tool, `${name} is not registered`)
  const result = (await tool.handler(args, {})) as { content: Array<{ text: string }> }
  return result.content[0]!.text
}

describe('list_brands', () => {
  test('the owner sees the four brands', async () => {
    const text = await call(server(), 'list_brands')
    for (const slug of ['1920-agency', 'psx-ascend', 'muzaree', 'product']) assert.ok(text.includes(`${slug}:`), slug)
    assert.match(text, /get_brand/)
  })

  test('another tenant sees none of them, and is told how to proceed', async () => {
    const text = await call(server({ tenant: OTHER }), 'list_brands')
    assert.match(text, /No brand design systems belong to this account/)
    for (const name of ['1920', 'PSX', 'Muzaree']) assert.ok(!text.includes(name), name)
  })

  test('with no owner tenant configured, the owner’s brands are hidden from everyone', async () => {
    const text = await call(server({ owner: undefined }), 'list_brands')
    assert.match(text, /No brand design systems/)
  })
})

describe('get_brand', () => {
  test('returns the usage rules, every section’s guidelines and parseable tokens', async () => {
    const text = await call(server(), 'get_brand', { brand: '1920-agency' })
    assert.match(text, /Never draw, retype, recolour or generate a logo/)
    assert.match(text, /PROPOSED/)
    for (const title of ['## Colours', '## Typography', '## Logo', '## Ad creatives', '## Social templates']) assert.ok(text.includes(title), title)
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!))
    assert.equal(blocks.length, 11)
    const colours = blocks.find((b) => 'colors' in b) as { colors: Array<{ hex: string }>; contrastPairs: Array<{ ratio: number }> }
    assert.ok(colours.colors.some((c) => c.hex === '#7B2CBF'))
    assert.equal(colours.contrastPairs[0]!.ratio, 19.5)
  })

  test('one section on its own', async () => {
    const text = await call(server(), 'get_brand', { brand: 'muzaree', section: 'ad-creatives' })
    assert.ok(text.includes('## Ad creatives'))
    assert.ok(!text.includes('## Typography'))
    assert.match(text, /"ratio": "9:16"/)
  })

  test('PSX carries its review rule and its logo-only rule', async () => {
    const text = await call(server(), 'get_brand', { brand: 'psx-ascend', section: 'logo' })
    assert.match(text, /Jeff, Dan and Rick/)
    assert.match(text, /two colours/)
  })

  test('another tenant’s brand is answered exactly like a brand that does not exist', async () => {
    const theirs = await call(server({ tenant: OTHER }), 'get_brand', { brand: 'psx-ascend' })
    const missing = await call(server({ tenant: OTHER }), 'get_brand', { brand: 'no-such-brand' })
    assert.equal(theirs.replace('psx-ascend', 'X'), missing.replace('no-such-brand', 'X'))
    assert.ok(!theirs.includes('Forest') && !theirs.includes('#62D044'))
  })

  test('local file paths only on the local transport', async () => {
    const local = await call(server({ localPaths: true }), 'get_brand', { brand: '1920-agency', section: 'logo' })
    // Paths may contain spaces (a Windows user folder), so match up to the file name.
    const path = / at (.+primary-white\.png)/.exec(local)?.[1]
    assert.ok(path !== undefined && existsSync(path), `no usable local path in: ${local.slice(0, 400)}`)
    const hosted = await call(server(), 'get_brand', { brand: '1920-agency', section: 'logo' })
    assert.ok(!/[A-Za-z]:\\|\/source\/packages\//.test(hosted.split('## Logo')[0]!), 'a hosted answer must not reveal server paths')
    assert.match(hosted, /brand_viewer_link/)
  })

  test('the product’s placeholder never shows the working name', async () => {
    const s = server({ settings: () => ({ productName: 'AdsPilot' }) })
    const text = await call(s, 'get_brand', { brand: 'product', section: 'logo' })
    assert.match(text, /Placeholder only: "Product name"/)
  })

  test('a failure to tell who is asking is a catalogue failure, not a throw', async () => {
    const s = server({ viewer: async () => { throw new Error("Can't reach database server") } })
    const text = await call(s, 'get_brand', { brand: '1920-agency' })
    assert.match(text, /^\[DB_UNREACHABLE\]/)
  })
})

describe('brand_viewer_link', () => {
  test('without a usable secret it explains what to configure', async () => {
    for (const secret of [undefined, 'too-short']) {
      const text = await call(server({ viewerSecret: () => secret }), 'brand_viewer_link', { brand: 'psx-ascend' })
      assert.match(text, /^\[CONFIG_MISSING\]/)
      assert.match(text, /BRAND_VIEW_SECRET/)
    }
  })

  test('makes a link that the viewer accepts for that brand and tenant, and nothing more', async () => {
    const text = await call(server(), 'brand_viewer_link', { brand: 'psx-ascend', hours: 2 })
    const url = new URL(/https:\/\/\S+/.exec(text)![0])
    assert.equal(url.origin, BASE)
    assert.equal(url.pathname, '/brands/psx-ascend')
    const token = url.searchParams.get('t')!
    assert.deepEqual(verifyViewerToken(token, SECRET, NOW), { brand: 'psx-ascend', tenant: OWNER, expires: NOW.getTime() / 1000 + 7200 })

    const deps = { brands: allBrands(), secret: SECRET, ownerTenantId: OWNER, settings: {}, now: () => NOW }
    assert.equal(handleViewerRequest({ method: 'GET', pathname: url.pathname, token }, deps).status, 200)
    assert.equal(handleViewerRequest({ method: 'GET', pathname: '/brands/muzaree', token }, deps).status, 404)
    const later = { ...deps, now: () => new Date(NOW.getTime() + 3 * 3600_000) }
    assert.equal(handleViewerRequest({ method: 'GET', pathname: url.pathname, token }, later).status, 404)
  })

  test('without a brand, one link opens every brand of the account', async () => {
    const text = await call(server(), 'brand_viewer_link')
    assert.match(text, /all 4 of this account's brands/)
    assert.match(text, /\/brands\?t=/)
  })

  test('another tenant gets no link to the owner’s brands', async () => {
    assert.match(await call(server({ tenant: OTHER }), 'brand_viewer_link', { brand: 'psx-ascend' }), /No brand "psx-ascend" belongs to this account/)
    assert.match(await call(server({ tenant: OTHER }), 'brand_viewer_link'), /nothing to link to/)
  })

  test('the secret never appears in what the tool returns', async () => {
    const text = await call(server(), 'brand_viewer_link')
    assert.ok(!text.includes(SECRET))
  })
})

describe('the AI is told to load the brand first', () => {
  test('the server instructions name all three tools', () => {
    for (const name of ['list_brands', 'get_brand', 'brand_viewer_link']) assert.ok(SERVER_INSTRUCTIONS.includes(name), name)
  })
})
