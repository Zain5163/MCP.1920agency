import { strict as assert } from 'node:assert'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { resetEnvCache } from '../src/env.ts'
import {
  DEFAULT_OAUTH_CALLBACK_PORT,
  FIXED_NAMES,
  OAUTH_REDIRECT_PATHS,
  PRODUCT_DEFAULTS,
  companyName,
  defaultOAuthRedirectUri,
  mcpPort,
  mcpPublicUrl,
  oauthRedirectUri,
  productName,
  productSlug,
  publicBaseUrl,
  renderProductText,
  shopifyAppName,
  wordmarkParts,
} from '../src/product.ts'

/**
 * The product settings: defaults defined once, the environment wins.
 *
 * An empty process env value means "unset" (as everywhere in env.ts), so each
 * test first blanks every name it touches: the owner's real env file can then
 * never change what these tests see.
 */
const NAMES = [
  'PRODUCT_NAME',
  'PRODUCT_SLUG',
  'COMPANY_NAME',
  'SHOPIFY_APP_NAME',
  'PUBLIC_BASE_URL',
  'MCP_PUBLIC_URL',
  'MCP_PORT',
  'OAUTH_REDIRECT_BASE',
  ...Object.keys(OAUTH_REDIRECT_PATHS),
]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const name of NAMES) {
    saved[name] = process.env[name]
    process.env[name] = ''
  }
  resetEnvCache()
})

afterEach(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
  resetEnvCache()
})

function set(name: string, value: string): void {
  process.env[name] = value
  resetEnvCache()
}

describe('product identity', () => {
  test('defaults come from the one object', () => {
    assert.equal(productName(), PRODUCT_DEFAULTS.PRODUCT_NAME)
    assert.equal(productSlug(), PRODUCT_DEFAULTS.PRODUCT_SLUG)
    assert.equal(companyName(), PRODUCT_DEFAULTS.COMPANY_NAME)
    assert.equal(shopifyAppName(), `${PRODUCT_DEFAULTS.COMPANY_NAME} Store Connector`)
    assert.equal(mcpPort(), Number(PRODUCT_DEFAULTS.MCP_PORT))
  })

  test('the environment wins, and is read when asked, not at import', () => {
    set('PRODUCT_NAME', 'NewName')
    set('COMPANY_NAME', 'Acme')
    assert.equal(productName(), 'NewName')
    assert.equal(companyName(), 'Acme')
    assert.equal(shopifyAppName(), 'Acme Store Connector')
    set('SHOPIFY_APP_NAME', 'Acme Shop App')
    assert.equal(shopifyAppName(), 'Acme Shop App')
  })

  test('fixed names do not follow a rename', () => {
    set('PRODUCT_NAME', 'NewName')
    assert.ok(!FIXED_NAMES.PC_WORKER_TASK.includes('NewName'))
  })
})

describe('public addresses', () => {
  test('no public address unless one is configured (the domain lives in deploy/site.env)', () => {
    assert.equal(publicBaseUrl(), undefined)
    set('PUBLIC_BASE_URL', 'https://mcp.example.com//')
    assert.equal(publicBaseUrl(), 'https://mcp.example.com')
  })

  test('the MCP address: explicit, else the public address, else this machine', () => {
    assert.equal(mcpPublicUrl(), 'http://localhost:8080/mcp')
    set('PUBLIC_BASE_URL', 'https://mcp.example.com')
    assert.equal(mcpPublicUrl(), 'https://mcp.example.com/mcp')
    set('MCP_PUBLIC_URL', 'https://other.example.com/mcp')
    assert.equal(mcpPublicUrl(), 'https://other.example.com/mcp')
  })
})

describe('OAuth redirect addresses', () => {
  test('default: this PC, on the default port, with each provider path', () => {
    assert.equal(DEFAULT_OAUTH_CALLBACK_PORT, 8787)
    assert.equal(oauthRedirectUri('META_REDIRECT_URI'), 'http://localhost:8787/callback')
    assert.equal(oauthRedirectUri('GOOGLE_REDIRECT_URI'), 'http://localhost:8787/google/callback')
  })

  test('an explicit *_REDIRECT_URI always wins (existing env files keep working)', () => {
    set('META_REDIRECT_URI', 'https://mcp.example.com/callback')
    set('OAUTH_REDIRECT_BASE', 'https://elsewhere.example.com')
    assert.equal(oauthRedirectUri('META_REDIRECT_URI'), 'https://mcp.example.com/callback')
    assert.equal(defaultOAuthRedirectUri('META_REDIRECT_URI'), 'https://elsewhere.example.com/callback')
  })

  test('OAUTH_REDIRECT_BASE moves every unset one at once', () => {
    set('OAUTH_REDIRECT_BASE', 'https://mcp.example.com/')
    for (const [name, path] of Object.entries(OAUTH_REDIRECT_PATHS)) {
      assert.equal(oauthRedirectUri(name as keyof typeof OAUTH_REDIRECT_PATHS), `https://mcp.example.com${path}`)
    }
  })
})

describe('text we serve', () => {
  test('placeholders are filled from the settings', () => {
    set('PRODUCT_NAME', 'NewName')
    assert.equal(
      renderProductText('{{PRODUCT_NAME}} by {{COMPANY_NAME}} ({{PRODUCT_SLUG}}), {{PRODUCT_NAME}} again; {{ liquid }} kept'),
      `NewName by ${PRODUCT_DEFAULTS.COMPANY_NAME} (${PRODUCT_DEFAULTS.PRODUCT_SLUG}), NewName again; {{ liquid }} kept`,
    )
  })

  test('the wordmark splits before the last inner capital, and survives any name', () => {
    assert.deepEqual(wordmarkParts('AdsPilot'), ['Ads', 'Pilot'])
    assert.deepEqual(wordmarkParts('MySocialHub'), ['MySocial', 'Hub'])
    assert.deepEqual(wordmarkParts('Pilot'), ['Pilot', ''])
    assert.deepEqual(wordmarkParts('lower'), ['lower', ''])
    assert.deepEqual(wordmarkParts(''), ['', ''])
  })
})
