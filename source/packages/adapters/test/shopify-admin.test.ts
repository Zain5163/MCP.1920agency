import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import {
  ShopifyAdminClient,
  ShopifyError,
  buildAuditFacts,
  summariseSales,
  toProductRow,
  type ShopifyRequest,
} from '../src/shopify-admin.ts'

const SHOP = 'example-store.myshopify.com'

/** A fake Shopify: answers token and GraphQL requests from a script, and records them. */
function fake(script: Array<(r: ShopifyRequest) => { status: number; body: unknown }>) {
  const calls: ShopifyRequest[] = []
  let i = 0
  const transport = async (r: ShopifyRequest) => {
    calls.push(r)
    const step = script[Math.min(i++, script.length - 1)]!
    const out = step(r)
    return { status: out.status, body: typeof out.body === 'string' ? out.body : JSON.stringify(out.body) }
  }
  return { calls, transport }
}
const token = () => ({ status: 200, body: { access_token: 'tok', expires_in: 86_399, scope: 'read_products' } })
const data = (d: unknown) => () => ({ status: 200, body: { data: d } })
const client = (transport: Parameters<typeof makeClient>[0], now: () => number = () => 1_000_000) => makeClient(transport, now)
function makeClient(transport: (r: ShopifyRequest) => Promise<{ status: number; body: string }>, now: () => number) {
  return new ShopifyAdminClient({ shop: SHOP, credentials: { clientId: 'id', clientSecret: 'secret' }, transport, now, sleep: async () => {} })
}

describe('the Shopify client', () => {
  test('refuses anything that is not a myshopify.com address', () => {
    assert.doesNotThrow(() => makeClient(async () => ({ status: 200, body: '' }), Date.now))
    assert.throws(
      () => new ShopifyAdminClient({ shop: 'muzaree.com', credentials: { clientId: 'a', clientSecret: 'b' } }),
      /not a store's myshopify\.com address/,
    )
  })

  test('gets a token once and reuses it until shortly before it expires', async () => {
    let t = 1_000_000
    const f = fake([token, data({ ok: 1 }), data({ ok: 2 }), token, data({ ok: 3 })])
    const c = client(f.transport, () => t)
    await c.graphql('{a}')
    await c.graphql('{b}')
    assert.equal(f.calls.filter((r) => r.path === '/admin/oauth/access_token').length, 1)
    t += 86_399_000 // past expiry minus the one-minute margin
    await c.graphql('{c}')
    assert.equal(f.calls.filter((r) => r.path === '/admin/oauth/access_token').length, 2)
  })

  test('sends the token header and the 2026-10 API path, never the secret, on queries', async () => {
    const f = fake([token, data({ ok: 1 })])
    await client(f.transport).graphql('{a}')
    const q = f.calls[1]!
    assert.equal(q.path, '/admin/api/2026-10/graphql.json')
    assert.equal(q.headers['X-Shopify-Access-Token'], 'tok')
    assert.ok(!q.body.includes('secret'))
  })

  test('a refused token request explains what to check', async () => {
    const f = fake([() => ({ status: 400, body: { error: 'invalid_client' } })])
    await assert.rejects(client(f.transport).graphql('{a}'), (e: unknown) => e instanceof ShopifyError && e.kind === 'auth' && /installed on this store/.test(e.message))
  })

  test('waits and retries once when Shopify throttles', async () => {
    const f = fake([token, () => ({ status: 200, body: { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] } }), data({ ok: 1 })])
    assert.deepEqual(await client(f.transport).graphql('{a}'), { ok: 1 })
  })

  test('a missing permission is reported as access, naming the field', async () => {
    const f = fake([token, () => ({ status: 200, body: { errors: [{ message: 'Access denied for shopPolicies field.', extensions: { code: 'ACCESS_DENIED' } }] } })])
    await assert.rejects(client(f.transport).graphql('{a}'), (e: unknown) => e instanceof ShopifyError && e.kind === 'access' && /shopPolicies/.test(e.message))
  })

  test('a network failure says the route may be broken', async () => {
    const c = makeClient(async () => {
      throw new Error('connect ETIMEDOUT')
    }, Date.now)
    await assert.rejects(c.graphql('{a}'), (e: unknown) => e instanceof ShopifyError && e.kind === 'network' && /SHOPIFY_CONNECT_ADDRESS/.test(e.message))
  })

  test('no query asks for customer personal data', async () => {
    const f = fake([token, (r) => data({ shop: { name: 'x', myshopifyDomain: SHOP, currencyCode: 'PKR', primaryDomain: { url: 'u' }, plan: {} }, productsCount: { count: 0 }, ordersCount: { count: 0 }, themes: { nodes: [] }, products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] }, orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] }, pages: { nodes: [] }, codeDiscountNodes: { nodes: [] } })(r)])
    const c = client(f.transport)
    await c.overview()
    await c.products({ limit: 5 })
    await c.sales(30)
    await c.auditFacts().catch(() => {})
    for (const call of f.calls) {
      assert.doesNotMatch(call.body, /\b(email|phone|firstName|lastName|defaultAddress|shippingAddress|billingAddress)\b/, call.body.slice(0, 80))
    }
  })
})

const variant = (price: string, qty: number, extra: Record<string, unknown> = {}) => ({
  title: `size ${qty}`,
  price,
  compareAtPrice: null,
  inventoryQuantity: qty,
  inventoryItem: { tracked: true, unitCost: null },
  ...extra,
})
const product = (over: Record<string, unknown> = {}) => ({
  title: 'Boot',
  handle: 'boot',
  status: 'ACTIVE',
  onlineStoreUrl: null,
  description: 'x'.repeat(300),
  mediaCount: { count: 5 },
  variants: { nodes: [variant('6000', 3), variant('6000', 0)] },
  ...over,
})

describe('reading products', () => {
  test('price range, sale price, stock, sold-out sizes and margin from recorded cost', () => {
    const row = toProductRow(
      product({
        variants: {
          nodes: [
            variant('5999', 4, { compareAtPrice: '10999', inventoryItem: { tracked: true, unitCost: { amount: '3500' } } }),
            variant('6599', 0, { inventoryItem: { tracked: true, unitCost: { amount: '3500' } } }),
          ],
        },
      }) as never,
    )
    assert.equal(row.minPrice, 5999)
    assert.equal(row.maxPrice, 6599)
    assert.equal(row.compareAt, 10999)
    assert.equal(row.inventory, 4)
    assert.deepEqual(row.soldOut, ['size 0'])
    assert.ok(Math.abs(row.minMargin! - (5999 - 3500) / 5999) < 1e-9)
  })
})

describe('summarising sales', () => {
  const order = (over: Record<string, unknown> = {}) => ({
    createdAt: '2026-10-01T10:00:00Z',
    cancelledAt: null,
    displayFinancialStatus: 'PENDING',
    displayFulfillmentStatus: 'FULFILLED',
    currentTotalPriceSet: { shopMoney: { amount: '6000.00', currencyCode: 'PKR' } },
    totalRefundedSet: { shopMoney: { amount: '0' } },
    discountCodes: [],
    currentSubtotalLineItemsQuantity: 1,
    customerJourneySummary: { ready: true, lastVisit: { source: 'facebook', utmParameters: { source: 'facebook', medium: 'paid_social', campaign: 'x' } } },
    ...over,
  })

  test('totals, average order, items per order, cancellations, codes and sources', () => {
    const s = summariseSales(
      [
        order(),
        order({ currentTotalPriceSet: { shopMoney: { amount: '12000.00', currencyCode: 'PKR' } }, currentSubtotalLineItemsQuantity: 2, discountCodes: ['WINTER10'] }),
        order({ cancelledAt: '2026-10-02T00:00:00Z' }),
        order({ customerJourneySummary: { ready: false, lastVisit: null } }),
      ] as never,
      30,
      '2026-09-08',
    )
    assert.equal(s.orders, 3)
    assert.equal(s.cancelled, 1)
    assert.equal(s.revenue, 24000)
    assert.equal(s.averageOrder, 8000)
    assert.ok(Math.abs(s.itemsPerOrder - 4 / 3) < 1e-9)
    assert.deepEqual(s.discountCodes, { WINTER10: 1 })
    assert.deepEqual(s.sources, { 'facebook / paid_social': 2 })
    assert.equal(s.attributionPending, 1)
    assert.equal(s.currency, 'PKR')
  })
})

describe('the store audit', () => {
  const overview = { name: 's', domain: SHOP, url: 'u', currency: 'PKR', plan: '', products: 3, orders: 0, liveTheme: 'Dawn', themes: [] }
  const extra = (over: Record<string, unknown> = {}) => ({
    policies: [
      { type: 'REFUND_POLICY', body: 'Exchanges within 7 days.' },
      { type: 'SHIPPING_POLICY', body: 'Delivered in 3 to 5 days.' },
    ],
    pages: { nodes: [{ title: 'FAQ', handle: 'faq' }, { title: 'Size guide', handle: 'size-guide' }, { title: 'Contact', handle: 'contact' }] },
    codeDiscountNodes: { nodes: [{ codeDiscount: { __typename: 'DiscountCodeBasic', title: 'WINTER10', status: 'ACTIVE' } }, { codeDiscount: { __typename: 'DiscountCodeBasic', title: 'OLD', status: 'EXPIRED' } }] },
    ...over,
  })

  test('a well-kept store has no findings', () => {
    const a = buildAuditFacts(overview, [toProductRow(product({ variants: { nodes: [variant('6000', 3)] } }) as never)], extra() as never)
    assert.deepEqual(
      a.findings.filter((f) => f.area !== 'pricing'),
      [],
    )
    assert.deepEqual(a.activeDiscounts, ['WINTER10'])
  })

  test('flags thin pages, sold-out listings, missing policies and pages', () => {
    const rows = [
      toProductRow(product({ mediaCount: { count: 1 }, description: 'short' }) as never),
      toProductRow(product({ title: 'Gone', variants: { nodes: [variant('6000', 0)] } }) as never),
    ]
    const a = buildAuditFacts(overview, rows, extra({ policies: [], pages: { nodes: [] } }) as never)
    const areas = a.findings.map((f) => `${f.area}:${f.severity}`)
    for (const want of ['products:high', 'products:medium', 'stock:high', 'stock:medium', 'trust:high', 'pages:medium']) {
      assert.ok(areas.includes(want), `${want} missing from ${areas.join(', ')}`)
    }
  })

  test('without the policies permission it says so instead of claiming none exist', () => {
    const a = buildAuditFacts(overview, [toProductRow(product() as never)], extra({ policies: undefined }) as never)
    assert.ok(a.findings.some((f) => /could not be read/.test(f.finding)))
    assert.ok(!a.findings.some((f) => /No refund policy/i.test(f.finding)))
  })

  test('gift cards are not judged as products', () => {
    const gift = toProductRow(product({ title: 'Gift Card', isGiftCard: true, mediaCount: { count: 0 }, variants: { nodes: [variant('10', 0)] } }) as never)
    const a = buildAuditFacts(overview, [gift], extra() as never)
    assert.equal(a.activeProducts, 0)
    assert.ok(!a.findings.some((f) => /Gift Card/.test(f.finding)))
  })
})
