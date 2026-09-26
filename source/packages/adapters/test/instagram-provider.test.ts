import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  INSTAGRAM_SCOPES,
  InstagramOAuth,
  InstagramProvider,
  buildInstagramAuthUrl,
} from '../src/instagram-provider.ts'

interface Call { method: string; url: string; body: Record<string, string> }

function mockIg(replies: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  let i = 0
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const body: Record<string, string> = {}
    if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) body[k] = v
    calls.push({ method: init?.method ?? 'GET', url: String(url), body })
    const next = replies[Math.min(i, replies.length - 1)]!
    i += 1
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetchImpl, calls }
}

const config = {
  appId: 'IG_APP',
  appSecret: 'IG_SECRET',
  redirectUri: 'http://localhost:8787/instagram/callback',
}

describe('authorising', () => {
  test('asks Instagram, not Facebook', () => {
    // The whole point: this path never touches a Facebook Page.
    const url = new URL(buildInstagramAuthUrl(config, 'STATE'))
    assert.equal(url.hostname, 'www.instagram.com')
  })

  test('requests the publishing scope', () => {
    const url = new URL(buildInstagramAuthUrl(config, 'S'))
    const scopes = url.searchParams.get('scope')!.split(',')
    assert.deepEqual(scopes, [...INSTAGRAM_SCOPES])
    assert.ok(scopes.includes('instagram_business_content_publish'))
  })

  test('uses the current scope names, not the ones retired in 2025', () => {
    const scope = new URL(buildInstagramAuthUrl(config, 'S')).searchParams.get('scope')!
    assert.ok(!/(^|,)business_basic(,|$)/.test(scope))
    assert.ok(scope.includes('instagram_business_basic'))
  })

  test('never puts the app secret in the authorise URL', () => {
    assert.ok(!buildInstagramAuthUrl(config, 'S').includes('IG_SECRET'))
  })
})

describe('tokens', () => {
  test('exchanges TWICE — a one-hour token would die overnight', async () => {
    const { fetchImpl, calls } = mockIg([
      { body: { access_token: 'SHORT' } },
      { body: { access_token: 'LONG', expires_in: 5_184_000 } },
    ])
    const credential = await new InstagramOAuth({ ...config, fetch: fetchImpl }).exchangeCode('CODE')

    assert.equal(calls.length, 2)
    assert.match(calls[1]!.url, /ig_exchange_token/)
    assert.equal(credential.accessToken, 'LONG')
    assert.ok(credential.expiresAt !== undefined)
  })

  test('the long-lived token is dated, so expiry can be seen coming', async () => {
    const { fetchImpl } = mockIg([
      { body: { access_token: 'SHORT' } },
      { body: { access_token: 'LONG', expires_in: 5_184_000 } },
    ])
    const credential = await new InstagramOAuth({ ...config, fetch: fetchImpl }).exchangeCode('C')
    const days = (credential.expiresAt!.getTime() - Date.now()) / 86_400_000
    assert.ok(days > 59 && days < 61, `expected about 60 days, got ${days}`)
  })

  test('refreshes, unlike a Page token which never expires', async () => {
    const { fetchImpl, calls } = mockIg([{ body: { access_token: 'FRESH', expires_in: 5_184_000 } }])
    const result = await new InstagramProvider({ ...config, fetch: fetchImpl }).refresh('OLD')

    assert.match(calls[0]!.url, /refresh_access_token/)
    assert.equal(result.accessToken, 'FRESH')
  })

  test('a refusal is explained, not swallowed', async () => {
    const { fetchImpl } = mockIg([{ status: 400, body: { error_message: 'Invalid token' } }])
    await assert.rejects(
      () => new InstagramProvider({ ...config, fetch: fetchImpl }).refresh('OLD'),
      /Invalid token/,
    )
  })
})

describe('discovery', () => {
  test('one authorisation is one account', async () => {
    const { fetchImpl } = mockIg([
      { body: { id: '17841400000000000', username: '1920agency', account_type: 'BUSINESS' } },
    ])
    const found = await new InstagramProvider({ ...config, fetch: fetchImpl }).discover('TOKEN')

    assert.equal(found.length, 1)
    assert.equal(found[0]!.platform, 'instagram')
    assert.equal(found[0]!.externalId, '17841400000000000')
    assert.equal(found[0]!.displayName, '@1920agency')
  })

  test('reads from the Instagram host, never the Facebook one', async () => {
    const { fetchImpl, calls } = mockIg([{ body: { id: '1', username: 'x' } }])
    await new InstagramProvider({ ...config, fetch: fetchImpl }).discover('TOKEN')
    assert.match(calls[0]!.url, /^https:\/\/graph\.instagram\.com\//)
  })

  test('registers under its own key, so it cannot replace the Meta provider', () => {
    const provider = new InstagramProvider(config)
    assert.equal(provider.key, 'instagram')
    assert.notEqual(provider.key, 'meta')
  })
})
