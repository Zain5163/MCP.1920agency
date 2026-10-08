import { strict as assert } from 'node:assert'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'

// Test keys: process env wins over the owner's env file.
process.env.SHOPIFY_CONNECTOR_CLIENT_ID = 'test-client'
process.env.SHOPIFY_CONNECTOR_CLIENT_SECRET = 'test-secret'
process.env.PUBLIC_BASE_URL = 'https://mcp.example.com'

const { resetEnvCache } = await import('@social-publisher/config')
resetEnvCache()
const { signState } = await import('@social-publisher/adapters')
const { handleShopifyCallback, shopifyHostedConfig, SHOPIFY_SCOPES } = await import('../src/shopify-hosted.ts')

const SHOP = 'example-store.myshopify.com'

function fakeResponse() {
  const out: { status?: number; headers?: Record<string, unknown>; body?: string } = {}
  const res = {
    writeHead(status: number, headers: Record<string, unknown>) {
      out.status = status
      out.headers = headers
      return res
    },
    end(body: string) {
      out.body = body
    },
  }
  return { res: res as never, out }
}

/** A callback URL as Shopify would send it, signed with the app secret. */
function callback(params: Record<string, string>, secret = 'test-secret'): URL {
  const q = new URLSearchParams(params)
  const message = [...q.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&')
  q.set('hmac', createHmac('sha256', secret).update(message).digest('hex'))
  return new URL(`https://mcp.example.com/shopify/callback?${q.toString()}`)
}

function stateFor(tenantId: string, shop = SHOP, expiresAt = Date.now() + 60_000): string {
  const config = shopifyHostedConfig()
  assert.ok(!('error' in config))
  return signState({ tenantId, shop, expiresAt }, config.stateKey)
}

const tokens = { accessToken: 'shpat_t', expiresAt: new Date(Date.now() + 3_600_000), refreshToken: 'r', refreshExpiresAt: new Date(Date.now() + 7_776_000_000), scopes: ['read_products'] }

describe('the Shopify callback page', () => {
  test('a valid callback stores the token under the account that asked', async () => {
    const saved: Array<{ tenantId: string; shop: string }> = []
    const { res, out } = fakeResponse()
    await handleShopifyCallback(callback({ code: 'c1', shop: SHOP, state: stateFor('tenant-A'), timestamp: '1' }), res, {
      exchange: async () => tokens,
      shopName: async () => 'Example Store',
      save: async (input) => void saved.push({ tenantId: input.tenantId, shop: input.shop }),
    })
    assert.equal(out.status, 200)
    assert.match(out.body!, /Example Store is connected/)
    assert.deepEqual(saved, [{ tenantId: 'tenant-A', shop: SHOP }])
    assert.equal(out.headers!['cache-control'], 'no-store')
  })

  test('a callback Shopify did not sign is refused and nothing is saved', async () => {
    let saved = false
    const { res, out } = fakeResponse()
    await handleShopifyCallback(callback({ code: 'c1', shop: SHOP, state: stateFor('tenant-A') }, 'wrong-secret'), res, {
      exchange: async () => tokens,
      save: async () => void (saved = true),
    })
    assert.equal(out.status, 400)
    assert.equal(saved, false)
  })

  test('a link made for one store cannot connect another', async () => {
    let saved = false
    const { res, out } = fakeResponse()
    await handleShopifyCallback(callback({ code: 'c1', shop: 'other-store.myshopify.com', state: stateFor('tenant-A', SHOP) }), res, {
      exchange: async () => tokens,
      save: async () => void (saved = true),
    })
    assert.equal(out.status, 400)
    assert.match(out.body!, /made for example-store/)
    assert.equal(saved, false)
  })

  test('an expired or forged state is refused', async () => {
    for (const state of [stateFor('tenant-A', SHOP, Date.now() - 1), 'forged.state']) {
      const { res, out } = fakeResponse()
      await handleShopifyCallback(callback({ code: 'c1', shop: SHOP, state }), res, { exchange: async () => tokens, save: async () => assert.fail('saved') })
      assert.equal(out.status, 400, state)
    }
  })

  test('a failed exchange says to start again, and saves nothing', async () => {
    const { res, out } = fakeResponse()
    await handleShopifyCallback(callback({ code: 'used', shop: SHOP, state: stateFor('tenant-A') }), res, {
      exchange: async () => {
        throw new Error('invalid_request')
      },
      save: async () => assert.fail('saved'),
    })
    assert.equal(out.status, 502)
  })

  test('what Shopify sends is shown escaped, never as HTML', async () => {
    const { res, out } = fakeResponse()
    await handleShopifyCallback(callback({ code: 'c1', shop: SHOP, state: stateFor('tenant-A') }), res, {
      exchange: async () => tokens,
      shopName: async () => '<script>alert(1)</script>',
      save: async () => {},
    })
    assert.doesNotMatch(out.body!, /<script>alert/)
    assert.match(out.body!, /&lt;script&gt;/)
  })

  test('the scopes asked for match the app configuration', async () => {
    const { readFileSync } = await import('node:fs')
    const toml = readFileSync(new URL('../../../../integrations/shopify-app/shopify.app.toml', import.meta.url), 'utf8')
    const fromToml = toml.match(/scopes = "([^"]+)"/)![1]!.split(',').sort()
    assert.deepEqual(SHOPIFY_SCOPES.split(',').sort(), fromToml)
  })
})
