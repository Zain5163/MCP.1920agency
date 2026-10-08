import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { createSafeFetch } from '../src/safe-http.ts'
import { WordPressClient, WordPressError, explainWordPressError, normaliseSiteUrl } from '../src/wordpress.ts'

const SITE = 'https://www.example.com'
const CANARY = 'Canary7Pass9Word1234abcd'

describe('the site address', () => {
  test('is normalised to the https site root', () => {
    assert.equal(normaliseSiteUrl('www.Example.com'), SITE)
    assert.equal(normaliseSiteUrl('https://www.example.com/'), SITE)
    assert.equal(normaliseSiteUrl('https://www.example.com/wp-admin/'), SITE)
    assert.equal(normaliseSiteUrl('https://www.example.com/blog/wp-json/wp/v2'), `${SITE}/blog`)
  })
  test('http and private addresses are refused with a reason', () => {
    for (const raw of ['http://www.example.com', 'https://192.168.1.10', 'https://localhost']) {
      const r = normaliseSiteUrl(raw)
      assert.ok(typeof r !== 'string', raw)
    }
  })
})

describe('every WordPress failure says why and how to fix it (R1)', () => {
  const explain = (status: number, code: string | undefined, extra: Partial<Parameters<typeof explainWordPressError>[0]> = {}) =>
    explainWordPressError({ status, json: code === undefined ? undefined : { code, message: 'msg' }, body: '', authSent: true, site: SITE, route: '/wp/v2/users/me', ...extra })

  test('a wrong application password', () => {
    const e = explain(401, 'incorrect_password')
    assert.equal(e.kind, 'auth')
    assert.match(e.message, /Application Password/)
    assert.match(e.message, /Users > Profile/)
    assert.match(e.message, /not the password you log in with/)
  })
  test('an unknown user', () => assert.match(explain(401, 'invalid_username').message, /Username/))
  test('application passwords turned off, naming the usual switch', () => {
    const e = explain(401, 'application_passwords_disabled')
    assert.match(e.message, /Wordfence/)
    assert.match(e.message, /Brute Force Protection/)
  })
  test('a login sent but not received means the header was stripped', () => {
    const e = explain(401, 'rest_not_logged_in')
    assert.match(e.message, /Authorization/)
    assert.match(e.message, /htaccess/)
  })
  test('a role that cannot do it says which role can', () => {
    const e = explain(403, 'rest_cannot_edit')
    assert.equal(e.kind, 'forbidden')
    assert.match(e.message, /Editor|Administrator/)
  })
  test('a firewall page instead of JSON', () => {
    const e = explain(403, undefined, { body: '<html>Access denied</html>' })
    assert.equal(e.kind, 'blocked')
    assert.match(e.message, /firewall/)
    assert.match(e.message, /allow/)
  })
  test('a Cloudflare challenge', () => {
    const e = explain(403, undefined, { headers: { 'cf-mitigated': 'challenge' } })
    assert.equal(e.kind, 'blocked')
    assert.match(e.message, /Cloudflare/)
  })
  test('WooCommerce missing', () => {
    const e = explain(404, 'rest_no_route', { route: '/wc/v3/products' })
    assert.match(e.message, /WooCommerce/)
    assert.match(e.message, /active/)
  })
  test('a broken site', () => assert.match(explain(500, undefined).message, /try again|error log/))
})

/** A tiny fake WordPress behind the real guarded fetch. */
function fakeSite(handler: (method: string, path: string, headers: Readonly<Record<string, string>>) => { status: number; json?: unknown; html?: string }) {
  const seen: Array<{ method: string; path: string; headers: Readonly<Record<string, string>> }> = []
  const fetch = createSafeFetch({
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: async (t) => {
      const path = `${t.url.pathname}${t.url.search}`
      seen.push({ method: t.method, path, headers: t.headers })
      const r = handler(t.method, path, t.headers)
      return { status: r.status, headers: {}, body: Buffer.from(r.html ?? JSON.stringify(r.json ?? {})) }
    },
  })
  return { fetch, seen }
}

describe('the client', () => {
  test('finds the REST API on plain permalinks through ?rest_route=', async () => {
    const site = fakeSite((_m, path) =>
      path.startsWith('/?rest_route=') ? { status: 200, json: { name: 'Shop', description: '', url: SITE, home: SITE, namespaces: ['wp/v2'], authentication: { 'application-passwords': {} } } } : { status: 404, html: '<html>404</html>' },
    )
    const index = await new WordPressClient({ siteUrl: SITE, fetch: site.fetch }).discover()
    assert.equal(index.restMode, 'query')
    assert.equal(index.applicationPasswords, true)
  })

  test('a site that is not WordPress gets a sentence saying how to check', async () => {
    const site = fakeSite(() => ({ status: 404, html: '<html>nope</html>' }))
    await assert.rejects(new WordPressClient({ siteUrl: SITE, fetch: site.fetch }).discover(), (e: unknown) => e instanceof WordPressError && /wp-json/.test(e.message))
  })

  test('sends the login as Basic auth, spaces removed, and never puts it in an error', async () => {
    const site = fakeSite(() => ({ status: 401, json: { code: 'incorrect_password', message: 'The provided password is an invalid application password.' } }))
    const client = new WordPressClient({ siteUrl: SITE, fetch: site.fetch, login: async () => ({ username: 'owner', password: CANARY.replace(/(.{4})/g, '$1 ') }) })
    let message = ''
    await client.me().catch((e: Error) => (message = `${e.message} ${e.stack ?? ''} ${JSON.stringify(e)}`))
    assert.equal(site.seen[0]!.headers.authorization, `Basic ${Buffer.from(`owner:${CANARY}`).toString('base64')}`)
    assert.ok(!message.includes(CANARY))
    assert.ok(!message.includes(Buffer.from(`owner:${CANARY}`).toString('base64')))
    assert.ok(!JSON.stringify(client).includes(CANARY), 'the client keeps no copy of the password')
  })
})
