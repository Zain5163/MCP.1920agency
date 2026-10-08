import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { WordPressClient, createSafeFetch, type Connector, type WordPressLogin } from '@social-publisher/adapters'
import { policyFor } from '@social-publisher/core'

import type { WordPressAccess, WordPressSite } from '../src/wordpress-access.ts'
import { contentFindings, homepageFindings, pluginFindings, wooFindings } from '../src/wordpress-audit.ts'
import { registerWordPressTools, sniffImage } from '../src/wordpress-tools.ts'

/**
 * The WordPress tools against a fake WordPress site, through the real guarded
 * fetch (only DNS and the socket are fake). No network, no database.
 *
 * The canary: the application password used throughout is a unique string.
 * Every tool result, activity record, backup file and anything written to the
 * console is collected and checked for it at the end.
 */

const CANARY = 'CanaryPw0123456789abcdXY'
const USER = 'owner'
const PUBLIC_IP = '93.184.216.34'

// ------------------------------------------------------------------ console capture (canary)

const consoleSeen: string[] = []
for (const name of ['log', 'error', 'warn', 'info', 'debug'] as const) {
  const original = console[name].bind(console)
  console[name] = (...args: unknown[]) => {
    consoleSeen.push(args.map(String).join(' '))
    original(...args)
  }
}
const outputs: string[] = []

// ------------------------------------------------------------------ fake WordPress

interface Item {
  id: number
  type: 'page' | 'post'
  title: string
  content: string
  excerpt: string
  slug: string
  status: string
  modified: string
}

function fakeWordPress(options: { stripAuth?: boolean; appPasswords?: boolean; role?: 'administrator' | 'subscriber'; pricesIncludeTax?: 'yes' | 'no' } = {}) {
  const items = new Map<number, Item>([
    [10, { id: 10, type: 'page', title: 'Delivery', content: '<p>Old delivery text</p>', excerpt: '', slug: 'delivery', status: 'publish', modified: '2026-10-01T10:00:00' }],
    [11, { id: 11, type: 'page', title: 'Spring offer', content: '<p>Draft offer</p>', excerpt: '', slug: 'spring-offer', status: 'draft', modified: '2026-10-02T10:00:00' }],
    [20, { id: 20, type: 'post', title: 'Hello world!', content: '<p>Welcome</p>', excerpt: '', slug: 'hello-world', status: 'publish', modified: '2026-09-01T10:00:00' }],
  ])
  const revisions = new Map<number, Array<{ id: number; title: string; content: string; excerpt: string; modified: string }>>([
    [10, [{ id: 501, title: 'Delivery (old)', content: '<p>Revision text</p>', excerpt: '', modified: '2026-09-20T10:00:00' }]],
  ])
  const products = new Map<number, Record<string, unknown>>([
    [100, { id: 100, name: 'Chelsea boot', slug: 'chelsea', status: 'publish', type: 'simple', permalink: 'https://www.example.com/p/chelsea', description: '<p>Leather</p>', short_description: '', regular_price: '120', sale_price: '', price: '120', date_on_sale_from: null, date_on_sale_to: null, stock_status: 'instock', images: [{}, {}], variations: [] }],
    [101, { id: 101, name: 'Runner', slug: 'runner', status: 'publish', type: 'variable', permalink: 'https://www.example.com/p/runner', description: '', short_description: '', regular_price: '', sale_price: '', price: '90', date_on_sale_from: null, date_on_sale_to: null, stock_status: 'instock', images: [], variations: [201] }],
  ])
  const media: Array<Record<string, unknown>> = []
  const log: string[] = []
  let nextId = 300
  const expectedAuth = `Basic ${Buffer.from(`${USER}:${CANARY}`).toString('base64')}`
  /** Called on every change, to let a test check the backup was written first. */
  const hooks: { beforeWrite?: (path: string) => void } = {}

  const json = (status: number, body: unknown) => ({ status, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) })
  const view = (i: Item) => ({ id: i.id, title: { raw: i.title }, content: { raw: i.content }, excerpt: { raw: i.excerpt }, slug: i.slug, status: i.status, modified: i.modified, link: `https://www.example.com/${i.slug}/`, parent: 0, template: '' })

  const connect: Connector = async (t) => {
    const url = t.url
    const route = url.searchParams.get('rest_route') ?? url.pathname.replace(/^\/wp-json/, '')
    const method = t.method
    log.push(`${method} ${route}`)
    if (url.pathname === '/' && !url.searchParams.has('rest_route')) {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html><head><title>Example Shop</title><meta name="robots" content="noindex, nofollow"></head><body><h1>Shop</h1><img src="/a.jpg"></body></html>') }
    }
    if (route === '/' || route === '') {
      return json(200, {
        name: 'Example Shop',
        description: 'Just another WordPress site',
        url: 'https://www.example.com',
        home: 'https://www.example.com',
        namespaces: ['wp/v2', 'wc/v3'],
        authentication: options.appPasswords === false ? {} : { 'application-passwords': { endpoints: {} } },
      })
    }
    // Everything else needs the login.
    const auth = options.stripAuth ? undefined : t.headers.authorization
    if (auth === undefined) return json(401, { code: 'rest_not_logged_in', message: 'You are not currently logged in.' })
    if (auth !== expectedAuth) return json(401, { code: 'incorrect_password', message: 'The provided password is an invalid application password.' })

    if (method !== 'GET') hooks.beforeWrite?.(route)
    if (route === '/wp/v2/users/me') {
      const admin = options.role !== 'subscriber'
      return json(200, { id: 1, username: USER, name: 'Owner', roles: [options.role ?? 'administrator'], capabilities: admin ? { edit_posts: true, edit_pages: true, publish_pages: true, publish_posts: true, upload_files: true, manage_options: true, activate_plugins: true, manage_woocommerce: true, edit_products: true } : { read: true } })
    }
    if (route === '/wp/v2/users/me/application-passwords/introspect') return json(200, { uuid: '0f8fad5b-d9cb-469f-a165-70867728950e' })
    if (route.startsWith('/wp/v2/users/me/application-passwords/') && method === 'DELETE') return json(200, { deleted: true })
    if (route === '/wp/v2/plugins') return json(200, [{ plugin: 'hello-dolly/hello', name: 'Hello Dolly', status: 'inactive', version: '1.7' }])
    if (route === '/wp/v2/themes') return json(200, [{ name: { raw: 'Twenty Twenty-Five' }, version: '1.3', stylesheet: 'twentytwentyfive', is_block_theme: true }])
    const list = route.match(/^\/wp\/v2\/(pages|posts)$/)
    if (list !== null) {
      const type = list[1] === 'pages' ? 'page' : 'post'
      if (method === 'POST') {
        const body = JSON.parse(String(t.body)) as Partial<Item>
        const id = nextId++
        const item: Item = { id, type, title: body.title ?? '', content: body.content ?? '', excerpt: body.excerpt ?? '', slug: body.slug ?? `new-${id}`, status: body.status ?? 'draft', modified: '2026-10-08T12:00:00' }
        items.set(id, item)
        return json(201, view(item))
      }
      const all = [...items.values()].filter((i) => i.type === type)
      return { status: 200, headers: { 'x-wp-total': String(all.length) }, body: Buffer.from(JSON.stringify(all.map(view))) }
    }
    const rev = route.match(/^\/wp\/v2\/(pages|posts)\/(\d+)\/revisions$/)
    if (rev !== null) return json(200, revisions.get(Number(rev[2])) ?? [])
    const one = route.match(/^\/wp\/v2\/(pages|posts)\/(\d+)$/)
    if (one !== null) {
      const item = items.get(Number(one[2]))
      if (item === undefined) return json(404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' })
      if (method === 'POST') {
        const body = JSON.parse(String(t.body)) as Partial<Item>
        Object.assign(item, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)), { modified: `2026-10-08T12:00:0${(nextId++) % 10}` })
      }
      return json(200, view(item))
    }
    if (route === '/wp/v2/media' && method === 'POST') {
      const m = { id: nextId++, source_url: 'https://www.example.com/wp-content/uploads/x.png', mime_type: t.headers['content-type'], alt_text: '', title: { raw: '' } }
      media.push(m)
      return json(201, m)
    }
    const med = route.match(/^\/wp\/v2\/media\/(\d+)$/)
    if (med !== null) {
      const m = media.find((x) => x.id === Number(med[1]))!
      if (method === 'POST') {
        const body = JSON.parse(String(t.body)) as { alt_text?: string }
        if (body.alt_text !== undefined) m.alt_text = body.alt_text
      }
      return json(200, m)
    }
    if (route === '/wc/v3/settings/tax/woocommerce_prices_include_tax') return json(200, { value: options.pricesIncludeTax ?? 'no' })
    if (route === '/wc/v3/settings/general/woocommerce_currency') return json(200, { value: 'GBP' })
    if (route === '/wc/v3/settings/general/woocommerce_calc_taxes') return json(200, { value: 'yes' })
    if (route === '/wc/v3/products') return json(200, [...products.values()])
    const prod = route.match(/^\/wc\/v3\/products\/(\d+)$/)
    if (prod !== null) {
      const p = products.get(Number(prod[1]))
      if (p === undefined) return json(404, { code: 'woocommerce_rest_product_invalid_id', message: 'Invalid ID.' })
      if (method === 'PUT') Object.assign(p, JSON.parse(String(t.body)) as object, { price: (JSON.parse(String(t.body)) as { sale_price?: string }).sale_price || p.regular_price })
      return json(200, p)
    }
    return json(404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.' })
  }

  return { items, products, media, log, hooks, connect }
}

/** DNS for the tests: the shop is public; the others are what an attacker would type. */
const DNS: Record<string, string[]> = {
  'www.example.com': [PUBLIC_IP],
  'images.example.net': [PUBLIC_IP],
  'internal.example.com': ['10.0.0.5'],
  'metadata.example.com': ['169.254.169.254'],
  'example.com': [PUBLIC_IP],
}

// ------------------------------------------------------------------ fake access

const tmp = mkdtempSync(join(tmpdir(), 'wp-tools-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

function harness(siteOptions: Parameters<typeof fakeWordPress>[0] = {}, extraConnect?: Connector) {
  const wp = fakeWordPress(siteOptions)
  const connections: string[] = []
  const fetch = createSafeFetch({
    resolver: async (host) => {
      const list = DNS[host]
      if (list === undefined) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
      return list.map((address) => ({ address, family: 4 }))
    },
    connect: async (t) => {
      connections.push(t.url.hostname)
      if (t.url.hostname === 'example.com') return { status: 301, headers: { location: 'https://evil.example.org/wp-json/' }, body: Buffer.from('') }
      if (t.url.hostname !== 'www.example.com' && extraConnect !== undefined) return await extraConnect(t)
      return await wp.connect(t)
    },
  })
  const sites = new Map<string, { site: WordPressSite; login: WordPressLogin }>()
  const records: Array<{ action: string; detail: Record<string, unknown> }> = []
  const backupRoot = mkdtempSync(join(tmp, 'b-'))
  const access: WordPressAccess = {
    fetch,
    list: async () => [...sites.values()].map((s) => s.site),
    open: async (selector) => {
      const hit = [...sites.values()].find((s) => s.site.key === selector || s.site.url === selector || s.site.name === selector)
      if (hit === undefined) return { error: `No connected WordPress site called "${selector}".` }
      return { site: hit.site, client: new WordPressClient({ siteUrl: hit.site.url, restMode: hit.site.restMode, fetch, login: async () => hit.login }) }
    },
    save: async (site, login) => void sites.set(site.url, { site: { ...site, key: site.url.replace(/^https:\/\//, '') }, login }),
    disconnect: async (selector) => {
      const hit = [...sites.values()].find((s) => s.site.key === selector)
      if (hit === undefined) return { error: 'none' }
      sites.delete(hit.site.url)
      return hit.site
    },
    backupDir: (site) => join(backupRoot, site.key.replace(/[^a-z0-9.-]/gi, '_')),
    record: async (action, detail) => {
      records.push({ action, detail })
      outputs.push(JSON.stringify({ action, detail }))
    },
  }
  const server = new McpServer({ name: 't', version: '1' })
  registerWordPressTools(server, access)
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: Function; inputSchema?: { parse: (a: unknown) => unknown } }> })._registeredTools
    const tool = tools[name]
    assert.ok(tool, `${name} is not registered`)
    const parsed = tool.inputSchema !== undefined ? tool.inputSchema.parse(args) : args
    const result = (await tool.handler(parsed, {})) as { content: Array<{ text: string }> }
    const out = result.content.map((c) => c.text).join('\n')
    outputs.push(out)
    return out
  }
  const connectSite = async () => await call('wordpress_connect_site', { siteUrl: 'https://www.example.com', username: USER, applicationPassword: CANARY.replace(/(.{4})/g, '$1 ').trim() })
  const tokenOf = (out: string) => out.match(/confirm: "([^"]+)"/)?.[1]
  return { wp, access, sites, records, call, connectSite, tokenOf, connections, backupRoot }
}

const writes = (log: readonly string[]) => log.filter((l) => !l.startsWith('GET '))

// ------------------------------------------------------------------ connection and SSRF

describe('connecting a site', () => {
  test('a good login connects, and the password is never repeated back', async () => {
    const h = harness()
    const out = await h.connectSite()
    assert.match(out, /Connected Example Shop/)
    assert.match(out, /administrator/)
    assert.match(out, /Revoke/)
    assert.equal(h.sites.size, 1)
    assert.equal([...h.sites.values()][0]!.login.password, CANARY, 'stored without the spaces')
    assert.ok(!out.includes(CANARY))
  })

  test('http is refused before anything is fetched', async () => {
    const h = harness()
    const out = await h.call('wordpress_connect_site', { siteUrl: 'http://www.example.com', username: USER, applicationPassword: CANARY })
    assert.match(out, /Not connected/)
    assert.match(out, /https/)
    assert.equal(h.connections.length, 0)
    assert.equal(h.sites.size, 0)
  })

  test('a site on a private address is refused, nothing is sent and nothing saved', async () => {
    for (const host of ['internal.example.com', 'metadata.example.com', '10.1.2.3', 'localhost', '[::1]']) {
      const h = harness()
      const out = await h.call('wordpress_connect_site', { siteUrl: `https://${host}`, username: USER, applicationPassword: CANARY })
      assert.match(out, /FAILED|Not connected/, host)
      assert.match(out, /public/, host)
      assert.equal(h.connections.length, 0, `${host}: nothing may be sent`)
      assert.equal(h.sites.size, 0, host)
    }
  })

  test('a redirect to another host is refused, naming the address to use', async () => {
    const h = harness()
    const out = await h.call('wordpress_connect_site', { siteUrl: 'https://example.com', username: USER, applicationPassword: CANARY })
    assert.match(out, /evil\.example\.org/)
    assert.match(out, /connect that address instead/)
    assert.deepEqual(h.connections, ['example.com'])
    assert.equal(h.sites.size, 0)
  })

  test('a wrong application password says how to make a new one', async () => {
    const h = harness()
    const out = await h.call('wordpress_connect_site', { siteUrl: 'https://www.example.com', username: USER, applicationPassword: 'Wrong0Wrong0Wrong0Wrong0' })
    assert.match(out, /refused the application password/)
    assert.match(out, /Users > Profile/)
    assert.equal(h.sites.size, 0)
  })

  test('a login password (not an application password) is refused before it is sent', async () => {
    const h = harness()
    const out = await h.call('wordpress_connect_site', { siteUrl: 'https://www.example.com', username: USER, applicationPassword: 'my-normal-login-pass!' })
    assert.match(out, /Application Password/)
    assert.equal(h.connections.length, 0)
  })

  test('a stripped Authorization header is diagnosed, with the server fix', async () => {
    const h = harness({ stripAuth: true })
    const out = await h.connectSite()
    assert.match(out, /Authorization/)
    assert.match(out, /htaccess/)
    assert.equal(h.sites.size, 0)
  })

  test('application passwords turned off names Wordfence\'s default switch', async () => {
    const h = harness({ appPasswords: false, stripAuth: true })
    const out = await h.connectSite()
    assert.match(out, /does not offer Application Passwords/)
    assert.match(out, /Wordfence/)
  })

  test('a user who cannot edit anything is not connected', async () => {
    const h = harness({ role: 'subscriber' })
    const out = await h.connectSite()
    assert.match(out, /cannot edit pages or posts/)
    assert.equal(h.sites.size, 0)
  })

  test('disconnecting revokes the password on the site and forgets it', async () => {
    const h = harness()
    await h.connectSite()
    const out = await h.call('wordpress_disconnect_site', { site: 'www.example.com' })
    assert.match(out, /revoked on the site/)
    assert.ok(h.wp.log.some((l) => l.startsWith('DELETE /wp/v2/users/me/application-passwords/')))
    assert.equal(h.sites.size, 0)
  })
})

// ------------------------------------------------------------------ reads

describe('reading a site (no approval needed)', () => {
  test('overview, lists, one page and the audit work and change nothing', async () => {
    const h = harness()
    await h.connectSite()
    const before = h.wp.log.length
    const overview = await h.call('wordpress_site_overview', { site: 'www.example.com' })
    assert.match(overview, /Twenty Twenty-Five/)
    assert.match(overview, /WooCommerce: active/)
    assert.match(overview, /GBP/)
    const list = await h.call('wordpress_list_content', { site: 'www.example.com', type: 'page' })
    assert.match(list, /\[10\] Delivery/)
    const page = await h.call('wordpress_read_content', { site: 'www.example.com', type: 'page', id: 10 })
    assert.match(page, /Old delivery text/)
    const audit = await h.call('wordpress_site_audit', { site: 'www.example.com' })
    assert.match(audit, /noindex/)
    assert.match(audit, /Just another WordPress site/)
    assert.match(audit, /inactive plugin/)
    assert.match(audit, /no photo/)
    assert.doesNotMatch(audit, /score|\/100/i)
    const products = await h.call('woocommerce_products', { site: 'www.example.com' })
    assert.match(products, /Chelsea boot/)
    assert.deepEqual(writes(h.wp.log.slice(before)), [], 'reads made a change')
  })
})

// ------------------------------------------------------------------ approvals

describe('every change needs the user\'s approval', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['wordpress_save_content', { site: 'www.example.com', type: 'page', id: 10, content: '<p>New</p>' }],
    ['wordpress_save_content', { site: 'www.example.com', type: 'page', title: 'FAQ', content: '<p>Q</p>' }],
    ['wordpress_publish_content', { site: 'www.example.com', type: 'page', id: 11 }],
    ['wordpress_publish_content', { site: 'www.example.com', type: 'page', id: 10, unpublish: true }],
    ['wordpress_upload_media', { site: 'www.example.com', url: 'https://images.example.net/a.png', altText: 'A boot' }],
    ['wordpress_restore_backup', { site: 'www.example.com', type: 'page', id: 10, revisionId: 501 }],
    ['woocommerce_update_product', { site: 'www.example.com', productId: 100, regularPrice: '110' }],
  ]
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
  const images: Connector = async () => ({ status: 200, headers: { 'content-type': 'image/png' }, body: png })

  for (const [tool, args] of cases) {
    test(`${tool} ${JSON.stringify(args).slice(0, 60)}: nothing is written without the token`, async () => {
      const h = harness({}, images)
      await h.connectSite()
      const before = h.wp.log.length
      const out = await h.call(tool, args)
      assert.match(out, /APPROVAL NEEDED/)
      assert.ok(h.tokenOf(out) !== undefined)
      assert.deepEqual(writes(h.wp.log.slice(before)), [])
      // A made-up token is not an approval.
      const forged = await h.call(tool, { ...args, confirm: 'made-up-token' })
      assert.match(forged, /APPROVAL NEEDED/)
      assert.deepEqual(writes(h.wp.log.slice(before)), [])
    })
  }

  test('each WordPress change has its own high-risk policy, not the fallback', () => {
    for (const action of ['wordpress_save_content', 'wordpress_publish_content', 'wordpress_upload_media', 'wordpress_restore_backup', 'woocommerce_update_product']) {
      const p = policyFor(action)
      assert.equal(p.risk, 'high', action)
      assert.doesNotMatch(p.rationale, /no policy entry/, action)
    }
  })

  test('the approval covers the exact content: a different text needs a new approval', async () => {
    const h = harness()
    await h.connectSite()
    const first = await h.call('wordpress_save_content', { site: 'www.example.com', type: 'page', id: 10, content: '<p>New</p>' })
    const edited = await h.call('wordpress_save_content', { site: 'www.example.com', type: 'page', id: 10, content: '<p>Other</p>', confirm: h.tokenOf(first) })
    assert.match(edited, /APPROVAL NEEDED/)
    assert.deepEqual(writes(h.wp.log), [])
  })

  test('if the page changed after the summary, the approval no longer matches', async () => {
    const h = harness()
    await h.connectSite()
    const first = await h.call('wordpress_save_content', { site: 'www.example.com', type: 'page', id: 10, content: '<p>New</p>' })
    h.wp.items.get(10)!.content = '<p>Someone else edited this meanwhile</p>'
    const again = await h.call('wordpress_save_content', { site: 'www.example.com', type: 'page', id: 10, content: '<p>New</p>', confirm: h.tokenOf(first) })
    assert.match(again, /APPROVAL NEEDED/)
    assert.match(again, /Someone else edited/)
  })

  test('the summary of a live page says visitors see it at once', async () => {
    const h = harness()
    await h.connectSite()
    const out = await h.call('wordpress_save_content', { site: 'www.example.com', type: 'page', id: 10, content: '<p>New</p>' })
    assert.match(out, /LIVE/)
    assert.match(out, /Old delivery text/)
  })
})

// ------------------------------------------------------------------ backup, write, read back

describe('backup, then change, then read back', () => {
  test('an approved change is backed up before it is written, then read back', async () => {
    const h = harness()
    await h.connectSite()
    const site = [...h.sites.values()][0]!.site
    const dir = h.access.backupDir(site)
    let backupExistedAtWrite: boolean | undefined
    h.wp.hooks.beforeWrite = () => (backupExistedAtWrite = existsSync(dir) && readdirSync(dir).length > 0)
    const args = { site: 'www.example.com', type: 'page', id: 10, title: 'Delivery and returns', content: '<p>Delivered in 2-3 days</p>' }
    const first = await h.call('wordpress_save_content', args)
    const mark = h.wp.log.length
    const done = await h.call('wordpress_save_content', { ...args, confirm: h.tokenOf(first) })
    assert.match(done, /Done, and read back/)
    assert.equal(backupExistedAtWrite, true, 'the backup was written before the change')
    assert.deepEqual(h.wp.log.slice(mark), ['GET /wp/v2/pages/10', 'POST /wp/v2/pages/10', 'GET /wp/v2/pages/10'])
    const [file] = readdirSync(dir)
    const saved = JSON.parse(readFileSync(join(dir, file!), 'utf8')) as { content: { content: string; title: string } }
    assert.equal(saved.content.content, '<p>Old delivery text</p>')
    assert.equal(h.wp.items.get(10)!.title, 'Delivery and returns')
    assert.ok(h.records.some((r) => r.action === 'wordpress.content.updated'))
  })

  test('a new page is always created as a draft, and publishing is its own approval', async () => {
    const h = harness()
    await h.connectSite()
    const args = { site: 'www.example.com', type: 'page', title: 'FAQ', content: '<p>Questions</p>', slug: 'faq' }
    const first = await h.call('wordpress_save_content', args)
    assert.match(first, /DRAFT/)
    const done = await h.call('wordpress_save_content', { ...args, confirm: h.tokenOf(first) })
    assert.match(done, /draft \(not public\)/)
    const created = [...h.wp.items.values()].find((i) => i.slug === 'faq')!
    assert.equal(created.status, 'draft')
    const pub = await h.call('wordpress_publish_content', { site: 'www.example.com', type: 'page', id: created.id })
    assert.match(pub, /APPROVAL NEEDED/)
    const live = await h.call('wordpress_publish_content', { site: 'www.example.com', type: 'page', id: created.id, confirm: h.tokenOf(pub) })
    assert.match(live, /published \(public\)/)
    assert.equal(created.status, 'publish')
  })

  test('a read-back that differs is reported, never called done', async () => {
    const h = harness()
    await h.connectSite()
    // The site strips the script, as WordPress does for users without unfiltered_html.
    h.wp.hooks.beforeWrite = () => queueMicrotask(() => (h.wp.items.get(10)!.content = '<p>Hi</p>'))
    const args = { site: 'www.example.com', type: 'page', id: 10, content: '<p>Hi</p><script>x()</script>' }
    const first = await h.call('wordpress_save_content', args)
    const done = await h.call('wordpress_save_content', { ...args, confirm: h.tokenOf(first) })
    assert.match(done, /read-back differs/)
    assert.match(done, /unfiltered_html/)
    assert.doesNotMatch(done, /^Site:[\s\S]*Done, and read back/)
  })
})

// ------------------------------------------------------------------ rollback

describe('rollback', () => {
  test('a saved version is put back, and the version it replaces is saved too', async () => {
    const h = harness()
    await h.connectSite()
    const args = { site: 'www.example.com', type: 'page', id: 10, content: '<p>Changed</p>' }
    await h.call('wordpress_save_content', { ...args, confirm: h.tokenOf(await h.call('wordpress_save_content', args)) })
    assert.equal(h.wp.items.get(10)!.content, '<p>Changed</p>')
    const list = await h.call('wordpress_list_backups', { site: 'www.example.com', type: 'page', id: 10 })
    const file = list.match(/(\S+-page-10\.json)/)![1]!
    assert.match(list, /revision 501/)
    const ask = await h.call('wordpress_restore_backup', { site: 'www.example.com', file })
    assert.match(ask, /APPROVAL NEEDED/)
    assert.match(ask, /Old delivery text/)
    const done = await h.call('wordpress_restore_backup', { site: 'www.example.com', file, confirm: h.tokenOf(ask) })
    assert.match(done, /Restored, and read back/)
    assert.equal(h.wp.items.get(10)!.content, '<p>Old delivery text</p>')
    const site = [...h.sites.values()][0]!.site
    assert.equal(readdirSync(h.access.backupDir(site)).length, 2)
  })

  test('a WordPress revision can be restored', async () => {
    const h = harness()
    await h.connectSite()
    const args = { site: 'www.example.com', type: 'page', id: 10, revisionId: 501 }
    const ask = await h.call('wordpress_restore_backup', args)
    const done = await h.call('wordpress_restore_backup', { ...args, confirm: h.tokenOf(ask) })
    assert.match(done, /Restored revision 501/)
    assert.equal(h.wp.items.get(10)!.content, '<p>Revision text</p>')
  })

  test('a backup file name cannot reach outside the backups folder', async () => {
    const h = harness()
    await h.connectSite()
    await assert.rejects(h.call('wordpress_restore_backup', { site: 'www.example.com', file: '../../secret.json' }))
  })
})

// ------------------------------------------------------------------ media

describe('uploading media', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
  test('a real image is uploaded after approval and read back', async () => {
    const h = harness({}, async () => ({ status: 200, headers: {}, body: png }))
    await h.connectSite()
    const args = { site: 'www.example.com', url: 'https://images.example.net/boot.jpg', altText: 'Black chelsea boot' }
    const ask = await h.call('wordpress_upload_media', args)
    assert.match(ask, /boot\.png \(image\/png/)
    const done = await h.call('wordpress_upload_media', { ...args, confirm: h.tokenOf(ask) })
    assert.match(done, /read back from WordPress/)
    assert.equal(h.wp.media[0]!.alt_text, 'Black chelsea boot')
  })
  test('something that is not an image (by content) is refused', async () => {
    const h = harness({}, async () => ({ status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from('<svg onload="alert(1)"></svg>') }))
    await h.connectSite()
    const out = await h.call('wordpress_upload_media', { site: 'www.example.com', url: 'https://images.example.net/a.png', altText: 'x' })
    assert.match(out, /does not return a JPEG, PNG/)
  })
  test('an image address on a private network is refused', async () => {
    const h = harness()
    await h.connectSite()
    const out = await h.call('wordpress_upload_media', { site: 'www.example.com', url: 'https://metadata.example.com/latest/meta-data/', altText: 'x' })
    assert.match(out, /could not be fetched/)
    assert.match(out, /link-local|metadata/)
  })
  test('sniffing knows the common formats', () => {
    assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime, 'image/jpeg')
    assert.equal(sniffImage(Buffer.from('RIFF0000WEBPVP8 '))?.mime, 'image/webp')
    assert.equal(sniffImage(Buffer.from('<html>')), undefined)
  })
})

// ------------------------------------------------------------------ WooCommerce

describe('WooCommerce products', () => {
  test('the price summary states the currency and that prices exclude tax, with the market rule', async () => {
    const h = harness({ pricesIncludeTax: 'no' })
    await h.connectSite()
    const out = await h.call('woocommerce_update_product', { site: 'www.example.com', productId: 100, salePrice: '99', saleTo: '2026-11-30' })
    assert.match(out, /GBP/)
    assert.match(out, /EXCLUDING tax/)
    assert.match(out, /selling-by-country/)
    assert.match(out, /"was" price/)
  })
  test('prices entered with tax say so', async () => {
    const h = harness({ pricesIncludeTax: 'yes' })
    await h.connectSite()
    assert.match(await h.call('woocommerce_update_product', { site: 'www.example.com', productId: 100, regularPrice: '130' }), /INCLUDING tax/)
  })
  test('an approved price change is backed up, written and read back', async () => {
    const h = harness()
    await h.connectSite()
    const args = { site: 'www.example.com', productId: 100, regularPrice: '130' }
    const done = await h.call('woocommerce_update_product', { ...args, confirm: h.tokenOf(await h.call('woocommerce_update_product', args)) })
    assert.match(done, /read back from WooCommerce/)
    assert.equal(h.wp.products.get(100)!.regular_price, '130')
    const site = [...h.sites.values()][0]!.site
    assert.equal(readdirSync(h.access.backupDir(site)).length, 1)
  })
  test('a variable product\'s price needs the variation', async () => {
    const h = harness()
    await h.connectSite()
    assert.match(await h.call('woocommerce_update_product', { site: 'www.example.com', productId: 101, regularPrice: '80' }), /variationId/)
  })
  test('a sale price at or above the regular price is refused', async () => {
    const h = harness()
    await h.connectSite()
    assert.match(await h.call('woocommerce_update_product', { site: 'www.example.com', productId: 100, salePrice: '150' }), /must be lower/)
  })
})

// ------------------------------------------------------------------ audit rules

describe('audit findings are facts, from what the site returned', () => {
  test('home page checks', () => {
    const { findings } = homepageFindings({ status: 200, html: '<html><head><title>Shop</title></head><body><img src="a.jpg" loading="lazy"></body></html>', bytes: 100, headers: {} })
    const text = findings.map((f) => f.finding).join('\n')
    assert.match(text, /no meta description/)
    assert.match(text, /viewport/)
    assert.match(text, /no H1/)
    assert.match(text, /lazy-loaded/)
    assert.match(text, /page cache/)
    const cached = homepageFindings({ status: 200, html: '<html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Boots"></head><body><h1>Boots</h1></body></html>', bytes: 100, headers: { 'cf-cache-status': 'HIT' } })
    assert.ok(!cached.findings.some((f) => /page cache|viewport|meta description/.test(f.finding)))
  })
  test('plugin, content and product checks', () => {
    assert.match(pluginFindings([{ plugin: 'wordpress-seo/wp-seo', name: 'Yoast', status: 'active', version: '1' }, { plugin: 'seo-by-rank-math/rank-math', name: 'Rank Math', status: 'active', version: '1' }]).map((f) => f.finding).join(), /2 SEO plugins/)
    const c = contentFindings({ index: { name: 'X', description: '', url: '', home: '', namespaces: [], applicationPasswords: true, timezone: '' }, restMode: 'query', pages: [], posts: [], woo: true }).map((f) => f.finding).join('\n')
    assert.match(c, /plain permalinks/)
    assert.match(c, /refund or returns/)
    assert.match(c, /Contact/)
    assert.match(wooFindings([{ id: 1, name: 'A', slug: 'a', status: 'publish', type: 'simple', permalink: '', description: '', shortDescription: '', regularPrice: '1', salePrice: '', price: '1', dateOnSaleFrom: null, dateOnSaleTo: null, stockStatus: 'outofstock', images: 0, variations: [] }]).map((f) => f.finding).join('\n'), /no photo[\s\S]*out of stock/)
  })
})

// ------------------------------------------------------------------ canary

describe('no secret is ever shown, logged or saved', () => {
  test('the application password appears in no output, record, backup or console line', () => {
    const encoded = Buffer.from(`${USER}:${CANARY}`).toString('base64')
    assert.ok(outputs.length > 30, `expected many tool outputs, saw ${outputs.length}`)
    const backups: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name))
        else backups.push(readFileSync(join(dir, e.name), 'utf8'))
      }
    }
    walk(tmp)
    assert.ok(backups.length > 0, 'expected backup files to check')
    for (const [label, texts] of [['tool output', outputs], ['console', consoleSeen], ['backup file', backups]] as const) {
      for (const t of texts) {
        assert.ok(!t.includes(CANARY), `${label} contains the password`)
        assert.ok(!t.includes(encoded), `${label} contains the encoded login`)
        assert.ok(!/CanaryPw/i.test(t.replace(/\s+/g, '')), `${label} contains part of the password`)
      }
    }
  })
})
