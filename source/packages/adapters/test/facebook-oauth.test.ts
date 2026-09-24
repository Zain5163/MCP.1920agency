import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  FACEBOOK_SCOPES,
  FacebookOAuth,
  OAuthError,
  buildAuthUrl,
  createState,
  statesMatch,
} from '../src/facebook-oauth.ts'

const config = {
  appId: 'APP123',
  appSecret: 'SECRET456',
  redirectUri: 'http://localhost:8787/callback',
  apiVersion: 'v25.0',
}

function mockFetch(responses: Array<{ status?: number; body: unknown }>) {
  const urls: string[] = []
  let index = 0
  const fetchImpl = (async (url: string | URL | Request) => {
    urls.push(String(url))
    const next = responses[Math.min(index, responses.length - 1)]!
    index += 1
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetchImpl, urls }
}

describe('state / CSRF', () => {
  test('generates distinct, non-trivial states', () => {
    const a = createState()
    const b = createState()
    assert.notEqual(a, b)
    assert.ok(a.length >= 40)
  })

  test('matches identical states', () => {
    const s = createState()
    assert.equal(statesMatch(s, s), true)
  })

  test('rejects different states', () => {
    assert.equal(statesMatch(createState(), createState()), false)
  })

  test('rejects a length mismatch without throwing', () => {
    // timingSafeEqual throws on unequal lengths; the guard must handle it.
    assert.equal(statesMatch('short', 'a-much-longer-value'), false)
  })

  test('rejects an empty state', () => {
    assert.equal(statesMatch('', createState()), false)
  })
})

describe('buildAuthUrl', () => {
  test('targets the dialog endpoint with the pinned version', () => {
    const url = new URL(buildAuthUrl(config, 'STATE1'))
    assert.equal(url.origin + url.pathname, 'https://www.facebook.com/v25.0/dialog/oauth')
  })

  test('includes app id, redirect, state and response type', () => {
    const url = new URL(buildAuthUrl(config, 'STATE1'))
    assert.equal(url.searchParams.get('client_id'), 'APP123')
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8787/callback')
    assert.equal(url.searchParams.get('state'), 'STATE1')
    assert.equal(url.searchParams.get('response_type'), 'code')
  })

  test('requests the publishing scopes, including Instagram up front', () => {
    const scopes = new URL(buildAuthUrl(config, 'S')).searchParams.get('scope')!.split(',')
    assert.ok(scopes.includes('pages_manage_posts'))
    assert.ok(scopes.includes('instagram_content_publish'))
    assert.deepEqual(scopes, [...FACEBOOK_SCOPES])
  })

  test('never puts the app secret in the dialog URL', () => {
    assert.ok(!buildAuthUrl(config, 'S').includes('SECRET456'))
  })
})

describe('token exchange', () => {
  test('exchanges a code for a short-lived token', async () => {
    const { fetchImpl, urls } = mockFetch([{ body: { access_token: 'SHORT', expires_in: 3600 } }])
    const oauth = new FacebookOAuth({ ...config, fetch: fetchImpl })
    const token = await oauth.exchangeCode('CODE1')

    assert.equal(token.accessToken, 'SHORT')
    assert.ok(token.expiresAt instanceof Date)
    assert.ok(urls[0]!.includes('/oauth/access_token'))
    assert.ok(urls[0]!.includes('code=CODE1'))
  })

  test('exchanges a short-lived token for a long-lived one', async () => {
    const { fetchImpl, urls } = mockFetch([
      { body: { access_token: 'LONG', expires_in: 5_184_000 } },
    ])
    const oauth = new FacebookOAuth({ ...config, fetch: fetchImpl })
    const token = await oauth.exchangeForLongLived('SHORT')

    assert.equal(token.accessToken, 'LONG')
    assert.ok(urls[0]!.includes('grant_type=fb_exchange_token'))
    // ~60 days out, not ~1 hour.
    const days = (token.expiresAt!.getTime() - Date.now()) / 86_400_000
    assert.ok(days > 50, `expected a long-lived token, got ${days} days`)
  })

  test('treats a missing expires_in as a non-expiring token', async () => {
    const { fetchImpl } = mockFetch([{ body: { access_token: 'FOREVER' } }])
    const oauth = new FacebookOAuth({ ...config, fetch: fetchImpl })
    assert.equal((await oauth.exchangeForLongLived('X')).expiresAt, undefined)
  })

  test('throws when no token comes back', async () => {
    const { fetchImpl } = mockFetch([{ body: {} }])
    const oauth = new FacebookOAuth({ ...config, fetch: fetchImpl })
    await assert.rejects(() => oauth.exchangeCode('CODE'), OAuthError)
  })

  test('surfaces a Facebook error message', async () => {
    const { fetchImpl } = mockFetch([
      { status: 400, body: { error: { message: 'This authorization code has expired.', code: 100 } } },
    ])
    const oauth = new FacebookOAuth({ ...config, fetch: fetchImpl })
    await assert.rejects(() => oauth.exchangeCode('OLD'), /This authorization code has expired/)
  })

  test('does not crash on a non-JSON response', async () => {
    const fetchImpl = (async () =>
      new Response('<html>502</html>', { status: 502 })) as unknown as typeof globalThis.fetch
    const oauth = new FacebookOAuth({ ...config, fetch: fetchImpl })
    await assert.rejects(() => oauth.exchangeCode('C'), /non-JSON/)
  })
})

describe('listPages', () => {
  test('returns pages with their own tokens', async () => {
    const { fetchImpl } = mockFetch([
      {
        body: {
          data: [
            { id: '111', name: '1920 Agency', access_token: 'PAGE_TOK_1', category: 'Marketing' },
            { id: '222', name: 'Other Page', access_token: 'PAGE_TOK_2' },
          ],
        },
      },
    ])
    const pages = await new FacebookOAuth({ ...config, fetch: fetchImpl }).listPages('LONG')

    assert.equal(pages.length, 2)
    assert.equal(pages[0]!.name, '1920 Agency')
    assert.equal(pages[0]!.accessToken, 'PAGE_TOK_1')
    assert.equal(pages[1]!.category, undefined)
  })

  test('surfaces a linked Instagram account so it can be connected later', async () => {
    const { fetchImpl } = mockFetch([
      {
        body: {
          data: [
            {
              id: '111',
              name: '1920 Agency',
              access_token: 'T',
              instagram_business_account: { id: 'IG999' },
            },
          ],
        },
      },
    ])
    const pages = await new FacebookOAuth({ ...config, fetch: fetchImpl }).listPages('LONG')
    assert.equal(pages[0]!.instagramAccountId, 'IG999')
  })

  test('returns an empty list rather than throwing when the user manages no pages', async () => {
    const { fetchImpl } = mockFetch([{ body: { data: [] } }])
    assert.deepEqual(await new FacebookOAuth({ ...config, fetch: fetchImpl }).listPages('L'), [])
  })

  test('signs the call with appsecret_proof', async () => {
    // A stolen token alone should not be usable against our app.
    const { fetchImpl, urls } = mockFetch([{ body: { data: [] } }])
    await new FacebookOAuth({ ...config, fetch: fetchImpl }).listPages('LONG')
    assert.ok(urls[0]!.includes('appsecret_proof='))
    assert.ok(!urls[0]!.includes('SECRET456'))
  })
})

describe('debugToken', () => {
  test('reports validity, scopes and expiry', async () => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const { fetchImpl } = mockFetch([
      { body: { data: { is_valid: true, scopes: ['pages_manage_posts'], expires_at: expires } } },
    ])
    const info = await new FacebookOAuth({ ...config, fetch: fetchImpl }).debugToken('T')

    assert.equal(info.isValid, true)
    assert.deepEqual(info.scopes, ['pages_manage_posts'])
    assert.ok(info.expiresAt instanceof Date)
  })

  test('treats expires_at of 0 as never expiring', async () => {
    // Page tokens from a long-lived user token report 0 here.
    const { fetchImpl } = mockFetch([
      { body: { data: { is_valid: true, scopes: [], expires_at: 0 } } },
    ])
    const info = await new FacebookOAuth({ ...config, fetch: fetchImpl }).debugToken('T')
    assert.equal(info.expiresAt, undefined)
  })

  test('reports an invalid token as invalid rather than throwing', async () => {
    const { fetchImpl } = mockFetch([{ body: { data: { is_valid: false } } }])
    const info = await new FacebookOAuth({ ...config, fetch: fetchImpl }).debugToken('T')
    assert.equal(info.isValid, false)
  })
})
