import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { brandFor, brandsFor, canSee } from '../src/access.ts'
import { MAX_LINK_HOURS, expiryFor, signViewerToken, usableSecret, verifyViewerToken } from '../src/link.ts'
import { loadBrands, type LoadedBrand } from '../src/load.ts'
import { escapeHtml, renderMarkdown } from '../src/markdown.ts'
import { handleViewerRequest, type ViewerDeps } from '../src/route.ts'
import { SECTIONS } from '../src/sections.ts'

/**
 * The private viewer's access model, end to end without a socket: signed links
 * that expire and cannot be forged, tenants who see only their own brands, and
 * a page that renders every section from the tokens.
 */

const SECRET = 'test-secret-that-is-long-enough-0123456789'
const OWNER = 'tenant-owner-0001'
const OTHER = 'tenant-other-0002'
const NOW = new Date('2026-10-10T12:00:00Z')
const brands = loadBrands()

function deps(overrides: Partial<ViewerDeps> = {}): ViewerDeps {
  return { brands, secret: SECRET, ownerTenantId: OWNER, settings: {}, now: () => NOW, ...overrides }
}

function token(brand: string, tenant = OWNER, hours = 24, secret = SECRET): string {
  return signViewerToken({ brand, tenant, expires: expiryFor(NOW, hours) }, secret)
}

function get(pathname: string, t: string | null, d: ViewerDeps = deps(), method = 'GET') {
  const res = handleViewerRequest({ method, pathname, token: t }, d)
  return { ...res, text: typeof res.body === 'string' ? res.body : res.body.toString('utf8') }
}

/** Nothing on a refused response may name a brand. */
function assertRefused(res: { status: number; text: string }): void {
  assert.equal(res.status, 404)
  for (const name of ['1920 Agency', 'PSX Ascend', 'Muzaree', 'muzaree', 'psx-ascend', '1920-agency']) {
    assert.ok(!res.text.includes(name), `a refused response mentions ${name}`)
  }
}

describe('signed viewer links', () => {
  test('a genuine link verifies and carries its claims', () => {
    const claims = verifyViewerToken(token('psx-ascend'), SECRET, NOW)
    assert.deepEqual(claims, { brand: 'psx-ascend', tenant: OWNER, expires: expiryFor(NOW, 24) })
  })

  test('an expired link is refused', () => {
    const t = token('psx-ascend', OWNER, 1)
    assert.ok(verifyViewerToken(t, SECRET, new Date(NOW.getTime() + 59 * 60_000)) !== null)
    assert.equal(verifyViewerToken(t, SECRET, new Date(NOW.getTime() + 61 * 60_000)), null)
  })

  test('a forged signature, an edited payload or another secret is refused', () => {
    const t = token('psx-ascend')
    const [v, payload, sig] = t.split('.') as [string, string, string]
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')
    assert.equal(verifyViewerToken(`${v}.${payload}.${flipped}`, SECRET, NOW), null)
    const edited = Buffer.from(JSON.stringify({ b: '*', t: OWNER, e: expiryFor(NOW, 24) })).toString('base64url')
    assert.equal(verifyViewerToken(`${v}.${edited}.${sig}`, SECRET, NOW), null)
    assert.equal(verifyViewerToken(t, 'another-secret-that-is-long-enough-0000', NOW), null)
  })

  test('malformed and absurd tokens are refused, not thrown on', () => {
    for (const bad of [null, undefined, '', 'v1', 'v1..', 'v2.a.b', 'x'.repeat(5000), 'v1.!!!.!!!']) {
      assert.equal(verifyViewerToken(bad as string, SECRET, NOW), null)
    }
    // A token claiming a lifetime longer than any we issue.
    const long = signViewerToken({ brand: '*', tenant: OWNER, expires: Math.floor(NOW.getTime() / 1000) + 30 * 86400 }, SECRET)
    assert.equal(verifyViewerToken(long, SECRET, NOW), null)
  })

  test('a short or missing secret makes no links and accepts none', () => {
    assert.equal(usableSecret('short'), undefined)
    assert.equal(usableSecret(undefined), undefined)
    assert.throws(() => signViewerToken({ brand: '*', tenant: OWNER, expires: 1 }, 'short'))
    assert.equal(verifyViewerToken(token('psx-ascend'), 'short', NOW), null)
  })

  test('expiry is clamped between one hour and seven days', () => {
    const base = Math.floor(NOW.getTime() / 1000)
    assert.equal(expiryFor(NOW, 0) - base, 3600)
    assert.equal(expiryFor(NOW, 10_000) - base, MAX_LINK_HOURS * 3600)
  })
})

describe('tenant isolation', () => {
  test('the owner tenant sees its four brands; another tenant sees none', () => {
    assert.equal(brandsFor(brands, { tenantId: OWNER, ownerTenantId: OWNER }).length, 4)
    assert.equal(brandsFor(brands, { tenantId: OTHER, ownerTenantId: OWNER }).length, 0)
    assert.equal(brandFor(brands, 'psx-ascend', { tenantId: OTHER, ownerTenantId: OWNER }), undefined)
  })

  test('with no owner tenant configured, nobody sees the owner’s brands (fail closed)', () => {
    assert.equal(brandsFor(brands, { tenantId: OWNER, ownerTenantId: undefined }).length, 0)
    assert.equal(brandsFor(brands, { tenantId: '', ownerTenantId: '' }).length, 0)
  })

  test('a brand owned by a specific tenant is that tenant’s alone', () => {
    const own = brands.get('muzaree')!
    const theirs: LoadedBrand = { ...own, brand: { ...own.brand, ownership: { tenant: OTHER, note: 'x' } } }
    assert.ok(canSee(theirs.brand, { tenantId: OTHER, ownerTenantId: OWNER }))
    assert.ok(!canSee(theirs.brand, { tenantId: OWNER, ownerTenantId: OWNER }))
  })
})

describe('the /brands routes', () => {
  test('no index and no page without a valid link', () => {
    assertRefused(get('/brands', null))
    assertRefused(get('/brands/psx-ascend', null))
    assertRefused(get('/brands/psx-ascend', 'garbage'))
    assertRefused(get('/brands/nope', token('*')))
  })

  test('an all-brands link opens the index of that tenant’s brands only', () => {
    const res = get('/brands', token('*'))
    assert.equal(res.status, 200)
    for (const name of ['1920 Agency', 'PSX Ascend', 'Muzaree']) assert.ok(res.text.includes(name), name)
    const other = get('/brands', token('*', OTHER))
    assert.equal(other.status, 200)
    assert.ok(!other.text.includes('PSX Ascend') && !other.text.includes('Muzaree'))
  })

  test('a one-brand link opens that brand and nothing else', () => {
    const t = token('psx-ascend')
    assert.equal(get('/brands/psx-ascend', t).status, 200)
    assertRefused(get('/brands/muzaree', t))
    assertRefused(get('/brands', t))
  })

  test('another tenant’s link cannot open the owner’s brand', () => {
    assertRefused(get('/brands/psx-ascend', token('psx-ascend', OTHER)))
    assertRefused(get('/brands/psx-ascend', token('*', OTHER)))
  })

  test('expired and forged links are refused', () => {
    const t = token('psx-ascend', OWNER, 1)
    assertRefused(get('/brands/psx-ascend', t, deps({ now: () => new Date(NOW.getTime() + 2 * 3600_000) })))
    assertRefused(get('/brands/psx-ascend', token('psx-ascend', OWNER, 24, 'a-different-secret-that-is-long-enough!!')))
  })

  test('without the secret configured, even a once-valid link is refused', () => {
    assertRefused(get('/brands/psx-ascend', token('psx-ascend'), deps({ secret: undefined })))
  })

  test('only GET and HEAD', () => {
    const res = get('/brands/psx-ascend', token('psx-ascend'), deps(), 'POST')
    assert.equal(res.status, 405)
    assert.equal(res.headers.allow, 'GET, HEAD')
  })

  test('every response is private: noindex, no-store, no referrer, a CSP that loads nothing', () => {
    for (const res of [get('/brands/psx-ascend', token('psx-ascend')), get('/brands', null)]) {
      assert.match(res.headers['x-robots-tag']!, /noindex/)
      assert.match(res.headers['cache-control']!, /no-store/)
      assert.equal(res.headers['referrer-policy'], 'no-referrer')
      assert.match(res.headers['content-security-policy']!, /default-src 'none'/)
      assert.doesNotMatch(res.headers['content-security-policy']!, /script-src/)
    }
  })

  test('downloads serve only the listed files, by exact name', () => {
    const t = token('*')
    const json = get('/brands/1920-agency/files/brand.json', t)
    assert.equal(json.status, 200)
    assert.match(json.headers['content-disposition']!, /attachment/)
    assert.equal(JSON.parse(json.text).slug, '1920-agency')
    assert.equal(get('/brands/1920-agency/files/primary-white.png', t).status, 200)
    assert.equal(get('/brands/muzaree/files/OFL-PlayfairDisplay.txt', t).status, 200)
    assertRefused(get('/brands/1920-agency/files/Manrope.woff2', t))
    assertRefused(get('/brands/1920-agency/files/..', t))
    assertRefused(get('/brands/1920-agency/files/../../../package.json', t))
    assertRefused(get('/brands/1920-agency/files/%2e%2e%2fbrand.json', t))
  })
})

describe('the brand page', () => {
  for (const [slug] of brands) {
    test(`${slug}: renders every section with live examples and no script`, () => {
      const res = get(`/brands/${slug}`, token('*'))
      assert.equal(res.status, 200)
      const html = res.text
      for (const s of SECTIONS) assert.ok(html.includes(`<section id="${s.id}"`), `${slug} is missing section ${s.id}`)
      assert.ok(!/<script/i.test(html), 'the page must not contain a script')
      assert.ok(!/(src|href)="https?:\/\//.test(html.replace(/<a href="https:\/\/[^"]+" rel="noopener noreferrer nofollow"/g, '')), 'nothing loads from another site')
      assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive">/)
      const brand = brands.get(slug)!.brand
      assert.equal((html.match(/class="swatch"/g) ?? []).length, brand.colors.length, 'one swatch per colour')
      assert.equal((html.match(/class="ad-fig ad-/g) ?? []).length, brand.adCreatives.placements.length, 'one sample ad per placement')
      for (const ratio of ['1:1', '4:5', '9:16']) assert.ok(html.includes(` · ${ratio} · `), `${slug} has no ${ratio} sample`)
      assert.ok(html.includes('class="cmp-'), 'components are rendered')
      assert.ok(html.includes('class="type-sample"'), 'type specimens are rendered')
      if (brand.status !== 'imported') assert.ok(html.includes('Proposed · owner to confirm'))
    })
  }

  test('fonts and logos are inlined, so nothing is fetched', () => {
    const html = get('/brands/1920-agency', token('*')).text
    assert.match(html, /@font-face\{font-family:"b-1920-agency-manrope";src:url\("data:font\/woff2;base64,/)
    assert.match(html, /\.lg-1920-agency-primary-white\{background:url\("data:image\/png;base64,/)
  })

  test('the product page shows a marked placeholder, never the working name as a logo', () => {
    const html = get('/brands/product', token('*'), deps({ settings: { productName: 'AdsPilot' } })).text
    assert.ok(html.includes('Placeholder · name not final · not a logo'))
    assert.ok(!/<span class="(wordmark|ad-wordmark)"[^>]*>AdsPilot</.test(html))
  })

  test('the PSX page shows the original logo file and never a typeset wordmark', () => {
    const html = get('/brands/psx-ascend', token('*')).text
    assert.ok(html.includes('lg-psx-ascend-horizontal'))
    assert.ok(!html.includes('class="wordmark"') && !html.includes('class="ad-wordmark"'))
  })
})

describe('the guideline renderer cannot inject markup', () => {
  test('escapes HTML and allows only https links', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> [x](javascript:alert(1)) [y](https://example.com)')
    assert.ok(!html.includes('<script>'))
    assert.ok(!html.includes('href="javascript'))
    assert.ok(html.includes('href="https://example.com"'))
    assert.equal(escapeHtml(`"'<>&`), '&quot;&#39;&lt;&gt;&amp;')
  })
})
