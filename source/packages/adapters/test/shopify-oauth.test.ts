import { strict as assert } from 'node:assert'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'

import { ShopifyAdminClient, type ShopifyRequest } from '../src/shopify-admin.ts'
import {
  authorizeUrl,
  exchangeCode,
  normaliseShop,
  refreshAccessToken,
  signState,
  verifyShopifyHmac,
  verifyState,
} from '../src/shopify-oauth.ts'

import { productName } from '@social-publisher/config'
const KEY = 'server-only-secret'
const SHOP = 'example-store.myshopify.com'

describe('the connect link state', () => {
  test('round-trips the account and store, and expires', () => {
    const token = signState({ tenantId: 't1', shop: SHOP, expiresAt: 2_000 }, KEY)
    const ok = verifyState(token, KEY, 1_000)
    assert.ok(!('error' in ok) && ok.tenantId === 't1' && ok.shop === SHOP)
    assert.match((verifyState(token, KEY, 3_000) as { error: string }).error, /expired/)
  })

  /** The property that stops a link being moved into someone else's account. */
  test('a state edited to point at another account is refused', () => {
    const token = signState({ tenantId: 't1', shop: SHOP, expiresAt: 9e15 }, KEY)
    const [body, mac] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), tenantId: 't2' })).toString('base64url')
    assert.match((verifyState(`${forged}.${mac}`, KEY) as { error: string }).error, new RegExp(`not issued by ${productName()}`))
    assert.match((verifyState(token, 'other-key') as { error: string }).error, new RegExp(`not issued by ${productName()}`))
    assert.ok('error' in verifyState('garbage', KEY))
  })
})

describe("Shopify's callback signature", () => {
  const signed = (params: Record<string, string>, secret = KEY) => {
    const q = new URLSearchParams(params)
    const message = [...q.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&')
    q.set('hmac', createHmac('sha256', secret).update(message).digest('hex'))
    return q
  }

  test('accepts a correctly signed callback', () => {
    assert.ok(verifyShopifyHmac(signed({ code: 'abc', shop: SHOP, state: 's', timestamp: '1700000000' }), KEY))
  })

  test('refuses a changed parameter, a wrong secret, or a missing signature', () => {
    const q = signed({ code: 'abc', shop: SHOP, state: 's', timestamp: '1' })
    q.set('shop', 'attacker.myshopify.com')
    assert.equal(verifyShopifyHmac(q, KEY), false)
    assert.equal(verifyShopifyHmac(signed({ code: 'abc', shop: SHOP }, 'wrong'), KEY), false)
    assert.equal(verifyShopifyHmac(new URLSearchParams({ code: 'abc', shop: SHOP }), KEY), false)
  })
})

describe('store addresses', () => {
  test('accepts a handle or a myshopify address, refuses anything else', () => {
    assert.equal(normaliseShop('example-store'), SHOP)
    assert.equal(normaliseShop('https://Example-Store.myshopify.com/admin'), SHOP)
    for (const bad of ['muzaree.com', 'evil.com/x.myshopify.com', 'a b', '']) assert.equal(normaliseShop(bad), undefined, bad)
  })

  test('the consent link goes to the store itself, with the state and redirect', () => {
    const u = new URL(authorizeUrl({ shop: SHOP, clientId: 'cid', scopes: 'read_products', redirectUri: 'https://mcp.example.com/shopify/callback', state: 'st' }))
    assert.equal(u.host, SHOP)
    assert.equal(u.pathname, '/admin/oauth/authorize')
    assert.equal(u.searchParams.get('state'), 'st')
    assert.equal(u.searchParams.get('redirect_uri'), 'https://mcp.example.com/shopify/callback')
  })
})

describe('tokens', () => {
  const capture = (status: number, body: unknown) => {
    const calls: ShopifyRequest[] = []
    return { calls, transport: async (r: ShopifyRequest) => (calls.push(r), { status, body: JSON.stringify(body) }) }
  }

  test('the code is exchanged for an expiring token and its refresh token', async () => {
    const f = capture(200, { access_token: 'shpat_x', expires_in: 3600, refresh_token: 'r1', refresh_token_expires_in: 7_776_000, scope: 'read_products,read_orders' })
    const t = await exchangeCode({ shop: SHOP, clientId: 'cid', clientSecret: 'sec', code: 'c' }, f.transport, () => 0)
    assert.equal(JSON.parse(f.calls[0]!.body).expiring, 1)
    assert.equal(t.accessToken, 'shpat_x')
    assert.equal(t.expiresAt?.getTime(), 3_600_000)
    assert.equal(t.refreshExpiresAt?.getTime(), 7_776_000_000)
    assert.deepEqual(t.scopes, ['read_products', 'read_orders'])
  })

  test('a refresh sends the refresh-token grant', async () => {
    const f = capture(200, { access_token: 'shpat_y', expires_in: 3600, refresh_token: 'r2' })
    await refreshAccessToken({ shop: SHOP, clientId: 'cid', clientSecret: 'sec', refreshToken: 'r1' }, f.transport)
    const body = JSON.parse(f.calls[0]!.body)
    assert.equal(body.grant_type, 'refresh_token')
    assert.equal(body.refresh_token, 'r1')
  })

  test('a refused exchange is an auth error, never a silent empty token', async () => {
    const f = capture(400, { error: 'invalid_request', error_description: 'code already used' })
    await assert.rejects(exchangeCode({ shop: SHOP, clientId: 'c', clientSecret: 's', code: 'x' }, f.transport), /code already used/)
  })

  test('a client fed by a token provider asks for a fresh token after a 401', async () => {
    const asked: boolean[] = []
    let n = 0
    const client = new ShopifyAdminClient({
      shop: SHOP,
      tokenProvider: async ({ forceRefresh }) => (asked.push(forceRefresh), 'tok'),
      transport: async () => (n++ === 0 ? { status: 401, body: '{}' } : { status: 200, body: JSON.stringify({ data: { ok: 1 } }) }),
    })
    assert.deepEqual(await client.graphql('{a}'), { ok: 1 })
    assert.deepEqual(asked, [false, true])
  })
})
