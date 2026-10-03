import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { PublishError } from '@social-publisher/core'

import {
  DEFAULT_GOOGLE_REDIRECT_URI,
  GOOGLE_BUNDLE_PERMISSIONS,
  GOOGLE_SCOPE_BUNDLES,
  GoogleOAuth,
  GoogleOAuthError,
  GoogleProvider,
  buildGoogleAuthUrl,
  googleProviderConfigFromEnv,
  googleScopes,
  missingGooglePermissions,
} from '../src/google-provider.ts'
import { flattenAccounts } from '../src/provider.ts'

/**
 * Google authorisation and channel discovery against a scripted Google. No
 * real sign-in or API call is made; these prove the documented protocol.
 */

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  form: URLSearchParams | undefined
}

interface Reply {
  status?: number
  body?: unknown
}

function mockGoogle(replies: Array<Reply | Error>) {
  const calls: Call[] = []
  let index = 0
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      form: init?.body instanceof URLSearchParams ? init.body : undefined,
    })
    const next = replies[Math.min(index, replies.length - 1)] ?? {}
    index += 1
    if (next instanceof Error) throw next
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetchImpl, calls }
}

/** A reply whose headers arrive and whose body then breaks off, as a reset socket does. */
const brokenOff = (status: number) =>
  (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError('terminated'))
        },
      }),
      { status },
    )) as unknown as typeof globalThis.fetch

const config = {
  clientId: 'CLIENT_ID.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-not-a-real-secret',
  redirectUri: DEFAULT_GOOGLE_REDIRECT_URI,
}

const UPLOAD = 'https://www.googleapis.com/auth/youtube.upload'
const READONLY = 'https://www.googleapis.com/auth/youtube.readonly'

const TOKENS = {
  access_token: 'ya29.ACCESS',
  expires_in: 3599,
  refresh_token: '1//REFRESH',
  scope: `openid https://www.googleapis.com/auth/userinfo.email ${UPLOAD} ${READONLY}`,
  token_type: 'Bearer',
}
const PERSON = { sub: '1076915035000615071511', email: 'owner@example.com', name: 'Owner' }

describe('the authorise URL', () => {
  const url = new URL(buildGoogleAuthUrl(config, 'STATE', ['youtube']))

  test("is Google's v2 endpoint, asking for a code", () => {
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('client_id'), config.clientId)
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8787/google/callback')
    assert.equal(url.searchParams.get('state'), 'STATE')
  })

  test('separates scopes with spaces, not commas', () => {
    const scope = url.searchParams.get('scope')!
    assert.ok(!scope.includes(','))
    assert.deepEqual(scope.split(' '), ['openid', 'email', 'profile', UPLOAD, READONLY])
  })

  test('asks for offline access, keeps earlier grants, and always shows consent', () => {
    // offline earns a refresh token; prompt=consent earns one again on a reconnect.
    assert.equal(url.searchParams.get('access_type'), 'offline')
    assert.equal(url.searchParams.get('include_granted_scopes'), 'true')
    assert.equal(url.searchParams.get('prompt'), 'consent')
  })

  test('the YouTube bundle is upload plus read-only, not full account management', () => {
    assert.deepEqual([...GOOGLE_SCOPE_BUNDLES.youtube!], [UPLOAD, READONLY])
    assert.ok(!googleScopes(['youtube']).includes('https://www.googleapis.com/auth/youtube'))
  })

  test('never puts the client secret in the URL', () => {
    assert.ok(!buildGoogleAuthUrl(config, 'S', ['youtube']).includes(config.clientSecret))
  })

  test('the provider passes named bundles through', () => {
    const provider = new GoogleProvider(config)
    const scope = new URL(provider.authUrl('S', { scopeBundles: ['youtube'] })).searchParams.get('scope')!
    assert.ok(scope.split(' ').includes(UPLOAD))
  })
})

describe('scope bundles', () => {
  test('no named bundle means YouTube, the only product with anything to post to', () => {
    assert.deepEqual(googleScopes(), googleScopes(['youtube']))
  })

  test('identity is always asked for, and nothing twice', () => {
    const scopes = googleScopes(['identity', 'youtube', 'YouTube'])
    assert.equal(new Set(scopes).size, scopes.length)
    for (const s of ['openid', 'email', 'profile']) assert.ok(scopes.includes(s))
  })

  test('an unknown product is refused, naming the real ones', () => {
    assert.throws(() => googleScopes(['youtub']), (error: unknown) => {
      assert.ok(error instanceof GoogleOAuthError)
      assert.match(error.message, /"youtub"/)
      assert.match(error.message, /Choose from: youtube/)
      return true
    })
  })
})

describe('exchanging the code', () => {
  test('sends the secret in the body, and reads the granted scopes and who signed in', async () => {
    const { fetchImpl, calls } = mockGoogle([{ body: TOKENS }, { body: PERSON }])
    const credential = await new GoogleOAuth({ ...config, fetch: fetchImpl }).exchangeCode('CODE')

    const token = calls[0]!
    assert.equal(token.url, 'https://oauth2.googleapis.com/token')
    assert.equal(token.method, 'POST')
    assert.equal(token.headers.Authorization, undefined)
    assert.equal(token.form!.get('client_secret'), config.clientSecret)
    assert.equal(token.form!.get('grant_type'), 'authorization_code')
    assert.equal(token.form!.get('code'), 'CODE')
    assert.equal(token.form!.get('redirect_uri'), config.redirectUri)

    const userinfo = calls[1]!
    assert.equal(userinfo.url, 'https://openidconnect.googleapis.com/v1/userinfo')
    assert.equal(userinfo.headers.Authorization, 'Bearer ya29.ACCESS')

    assert.equal(credential.accessToken, 'ya29.ACCESS')
    assert.equal(credential.refreshToken, '1//REFRESH')
    assert.deepEqual(credential.grantedScopes, [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      UPLOAD,
      READONLY,
    ])
    assert.equal(credential.externalUserId, PERSON.sub)
    assert.equal(credential.accountLabel, 'owner@example.com')
  })

  test('the hour-long token and the open-ended authorisation are kept apart', async () => {
    // Recording the hour as the authorisation's end would have the refresh
    // runner mark it dead an hour after connecting.
    const { fetchImpl } = mockGoogle([{ body: TOKENS }, { body: PERSON }])
    const credential = await new GoogleOAuth({ ...config, fetch: fetchImpl }).exchangeCode('CODE')
    const minutes = (credential.expiresAt!.getTime() - Date.now()) / 60_000
    assert.ok(minutes > 58 && minutes < 61)
    assert.equal(credential.authorisationExpiresAt, null)
  })

  test('a time-limited grant records when it ends', async () => {
    const { fetchImpl } = mockGoogle([{ body: { ...TOKENS, refresh_token_expires_in: 86_400 } }, { body: PERSON }])
    const credential = await new GoogleOAuth({ ...config, fetch: fetchImpl }).exchangeCode('CODE')
    const hours = (credential.authorisationExpiresAt!.getTime() - Date.now()) / 3_600_000
    assert.ok(hours > 23.9 && hours < 24.1)
  })

  test('a partial grant is recorded as granted, not as requested', async () => {
    const { fetchImpl } = mockGoogle([{ body: { ...TOKENS, scope: `openid ${READONLY}` } }, { body: PERSON }])
    const credential = await new GoogleOAuth({ ...config, fetch: fetchImpl }).exchangeCode('CODE')
    assert.deepEqual(credential.grantedScopes, ['openid', READONLY])
    assert.ok(!credential.grantedScopes!.includes(UPLOAD))
  })

  test('refuses a sign-in that brought no refresh token, before anything is stored', async () => {
    const { refresh_token: _dropped, ...noRefresh } = TOKENS
    const { fetchImpl, calls } = mockGoogle([{ body: noRefresh }, { body: PERSON }])
    await assert.rejects(
      () => new GoogleOAuth({ ...config, fetch: fetchImpl }).exchangeCode('CODE'),
      /no refresh token/,
    )
    assert.equal(calls.length, 1, 'not even the identity lookup runs')
  })

  test('an expired or reused code is explained', async () => {
    const { fetchImpl } = mockGoogle([{ status: 400, body: { error: 'invalid_grant', error_description: 'Bad Request' } }])
    await assert.rejects(
      () => new GoogleOAuth({ ...config, fetch: fetchImpl }).exchangeCode('OLD'),
      (error: unknown) => {
        assert.ok(error instanceof GoogleOAuthError)
        assert.equal(error.platformCode, 'invalid_grant')
        assert.equal(error.failureClass, 'credential')
        return true
      },
    )
  })

  test('a misconfigured client says which settings to check', async () => {
    const { fetchImpl } = mockGoogle([{ status: 401, body: { error: 'invalid_client', error_description: 'Unauthorized' } }])
    await assert.rejects(
      () => new GoogleOAuth({ ...config, fetch: fetchImpl }).exchangeCode('CODE'),
      (error: unknown) => {
        assert.ok(error instanceof GoogleOAuthError)
        assert.equal(error.failureClass, 'permanent')
        assert.match(error.message, /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/)
        return true
      },
    )
  })

  test('an exchange without the redirect it was issued for is refused plainly', async () => {
    const { fetchImpl, calls } = mockGoogle([{ body: TOKENS }])
    const oauth = new GoogleOAuth({ clientId: 'C', clientSecret: 'S', fetch: fetchImpl })
    await assert.rejects(() => oauth.exchangeCode('CODE'), /redirect URI/)
    assert.equal(calls.length, 0)
  })
})

describe('a partial grant', () => {
  /**
   * The connect command asks `missingPermissions` before storing anything.
   * Without it, a sign-in with "Manage your YouTube videos" unticked stored a
   * channel as ready that could never upload: discovery needs only read
   * access, so nothing else noticed.
   */
  const FULL = 'https://www.googleapis.com/auth/youtube'
  const FORCE_SSL = 'https://www.googleapis.com/auth/youtube.force-ssl'
  const PARTNER = 'https://www.googleapis.com/auth/youtubepartner'
  const IDENTITY = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile']
  const provider = new GoogleProvider(config)

  test('upload unticked: discovery still finds the channel, so the grant itself is what says no', async () => {
    const { fetchImpl } = mockGoogle([
      { body: { ...TOKENS, scope: [...IDENTITY, READONLY].join(' ') } },
      { body: PERSON },
      { body: { items: [{ id: 'UC1', snippet: { title: 'My Channel' } }] } },
    ])
    const google = new GoogleProvider({ ...config, fetch: fetchImpl })
    const credential = await google.exchangeCode('CODE')
    // What made the gap: the only gate the connect command had was "found nothing".
    assert.equal(flattenAccounts(await google.discover(credential.accessToken)).length, 1)

    assert.deepEqual(google.missingPermissions(credential.grantedScopes!, ['youtube']), ['Manage your YouTube videos'])
  })

  test('the grant exactly as asked for lacks nothing', () => {
    assert.deepEqual(provider.missingPermissions(TOKENS.scope.split(' '), ['youtube']), [])
  })

  test('a broader YouTube scope granted earlier counts, rather than being compared as a string', () => {
    // include_granted_scopes=true can bring back full `youtube` from an
    // earlier sign-in; it uploads and reads, so refusing it would be wrong.
    assert.deepEqual(provider.missingPermissions(['openid', FULL, READONLY], ['youtube']), [])
    for (const broad of [FULL, FORCE_SSL, PARTNER]) {
      assert.deepEqual(provider.missingPermissions([...IDENTITY, broad], ['youtube']), [], broad)
    }
  })

  test('read access unticked is named too: every upload checks the channel first', () => {
    assert.deepEqual(provider.missingPermissions([...IDENTITY, UPLOAD], ['youtube']), ['View your YouTube account'])
  })

  test('a sign-in with only identity lacks both, upload first', () => {
    assert.deepEqual(provider.missingPermissions(IDENTITY, ['youtube']), [
      'Manage your YouTube videos',
      'View your YouTube account',
    ])
  })

  test('no named product means YouTube, as when signing in', () => {
    assert.deepEqual(provider.missingPermissions([...IDENTITY, READONLY], []), ['Manage your YouTube videos'])
    assert.deepEqual(provider.missingPermissions([...IDENTITY, READONLY], ['  YouTube ']), ['Manage your YouTube videos'])
  })

  test('scopes are matched exactly, as Google reports them case-sensitively', () => {
    assert.deepEqual(missingGooglePermissions([`${UPLOAD}.extra`, READONLY.toUpperCase()], ['youtube']), [
      'Manage your YouTube videos',
      'View your YouTube account',
    ])
  })

  test('an unknown product is refused, as when signing in', () => {
    assert.throws(
      () => provider.missingPermissions(TOKENS.scope.split(' '), ['youtub']),
      (error: unknown) => error instanceof GoogleOAuthError && error.failureClass === 'permanent' && /youtube/.test(error.message),
    )
  })

  test("every product declares what it needs, and its own scopes provide it", () => {
    // A product added to the bundles without a permissions entry would never
    // be checked, so a partial grant of it would connect as ready again.
    for (const bundle of Object.keys(GOOGLE_SCOPE_BUNDLES).filter((b) => b !== 'identity')) {
      assert.ok((GOOGLE_BUNDLE_PERMISSIONS[bundle] ?? []).length > 0, `${bundle} declares no permissions`)
      assert.deepEqual(missingGooglePermissions(googleScopes([bundle]), [bundle]), [], bundle)
    }
  })
})

describe('renewing', () => {
  test('keeps the refresh token Google does not resend', async () => {
    const { fetchImpl, calls } = mockGoogle([{ body: { access_token: 'ya29.NEW', expires_in: 3599 } }])
    const renewed = await new GoogleProvider({ ...config, fetch: fetchImpl }).refreshCredential({
      accessToken: 'ya29.OLD',
      refreshToken: '1//KEEP',
    })
    assert.equal(renewed.accessToken, 'ya29.NEW')
    assert.equal(renewed.refreshToken, '1//KEEP')
    assert.equal(calls[0]!.form!.get('grant_type'), 'refresh_token')
    assert.equal(calls[0]!.form!.get('client_id'), config.clientId)
  })

  test('takes a rotated refresh token when Google sends one', async () => {
    const { fetchImpl } = mockGoogle([{ body: { access_token: 'ya29.NEW', expires_in: 3599, refresh_token: '1//ROTATED' } }])
    const renewed = await new GoogleOAuth({ ...config, fetch: fetchImpl }).refreshWithToken('1//OLD')
    assert.equal(renewed.refreshToken, '1//ROTATED')
  })

  test('invalid_grant is a credential failure, so the vault asks for a reconnect', async () => {
    const { fetchImpl } = mockGoogle([{ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }])
    await assert.rejects(
      () => new GoogleOAuth({ ...config, fetch: fetchImpl }).refreshWithToken('1//DEAD'),
      (error: unknown) => {
        assert.ok(error instanceof PublishError, 'a PublishError, so the publisher can report it precisely')
        assert.equal(error.failureClass, 'credential')
        assert.equal(error.code, 'GOOGLE_TOKEN_REVOKED')
        assert.equal(error.platformMessage, 'Token has been expired or revoked.')
        return true
      },
    )
  })

  test('a network blip while renewing is transient, so the vault marks nothing', async () => {
    const { fetchImpl } = mockGoogle([new TypeError('fetch failed')])
    await assert.rejects(
      () => new GoogleOAuth({ ...config, fetch: fetchImpl }).refreshWithToken('1//R'),
      (error: unknown) => error instanceof GoogleOAuthError && error.failureClass === 'transient',
    )
  })

  test('a throttled or failing token endpoint is transient', async () => {
    for (const status of [429, 500, 503]) {
      const { fetchImpl } = mockGoogle([{ status, body: { error: 'temporarily_unavailable' } }])
      await assert.rejects(
        () => new GoogleOAuth({ ...config, fetch: fetchImpl }).refreshWithToken('1//R'),
        (error: unknown) => error instanceof GoogleOAuthError && error.failureClass === 'transient',
        `HTTP ${status}`,
      )
    }
  })

  test('a reply that breaks off before its body is read is transient, so the vault marks nothing', async () => {
    // The reviewers' case: headers arrive, then the socket drops. response.text()
    // rejected with a bare TypeError, the vault saw no failure class, and it
    // marked a working channel as needing reconnection.
    for (const status of [200, 400]) {
      await assert.rejects(
        () => new GoogleOAuth({ ...config, fetch: brokenOff(status) }).refreshWithToken('1//R'),
        (error: unknown) => {
          assert.ok(error instanceof GoogleOAuthError, `HTTP ${status}`)
          assert.equal(error.failureClass, 'transient')
          assert.match(error.message, /broke off/)
          assert.equal((error.cause as Error).message, 'terminated')
          return true
        },
      )
    }
  })

  test('a token endpoint answering with something other than Google is transient, not a dead token', async () => {
    for (const status of [400, 502]) {
      const fetchImpl = (async () =>
        new Response('<html><body>Network login required</body></html>', { status })) as unknown as typeof globalThis.fetch
      await assert.rejects(
        () => new GoogleOAuth({ ...config, fetch: fetchImpl }).refreshWithToken('1//R'),
        (error: unknown) => {
          assert.ok(error instanceof GoogleOAuthError)
          assert.equal(error.failureClass, 'transient', `HTTP ${status}`)
          assert.doesNotMatch(error.message, /refused/)
          return true
        },
      )
    }
  })

  test('a credential with no refresh token is dead, not retryable', async () => {
    const { fetchImpl, calls } = mockGoogle([{ body: {} }])
    await assert.rejects(
      () => new GoogleOAuth({ ...config, fetch: fetchImpl }).refreshCredential({ accessToken: 'ya29.X' }),
      (error: unknown) => error instanceof GoogleOAuthError && error.failureClass === 'credential',
    )
    assert.equal(calls.length, 0)
  })
})

describe('discovery', () => {
  test('one connectable account per channel, identified by channel id', async () => {
    const { fetchImpl, calls } = mockGoogle([{ body: { items: [{ id: 'UC123', snippet: { title: '1920 Agency' } }] } }])
    const found = await new GoogleProvider({ ...config, fetch: fetchImpl }).discover('ya29.TOKEN')

    assert.deepEqual(found, [
      { externalId: 'UC123', platform: 'youtube', displayName: '1920 Agency', accessToken: 'ya29.TOKEN' },
    ])
    const url = new URL(calls[0]!.url)
    assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/youtube/v3/channels')
    assert.equal(url.searchParams.get('part'), 'snippet')
    assert.equal(url.searchParams.get('mine'), 'true')
    assert.equal(calls[0]!.headers.Authorization, 'Bearer ya29.TOKEN')
  })

  test('an account with no channel connects nothing rather than failing, either way Google says it', async () => {
    for (const reply of [
      { body: { items: [] } },
      { body: {} },
      { status: 401, body: { error: { code: 401, message: 'Unauthorized', errors: [{ reason: 'youtubeSignupRequired' }] } } },
    ]) {
      const { fetchImpl } = mockGoogle([reply])
      assert.deepEqual(await new GoogleProvider({ ...config, fetch: fetchImpl }).discover('T'), [])
    }
  })

  test('an unticked read permission connects nothing, and the hint says why', async () => {
    const { fetchImpl } = mockGoogle([
      { status: 403, body: { error: { code: 403, message: 'Insufficient Permission', errors: [{ reason: 'insufficientPermissions' }] } } },
    ])
    const provider = new GoogleProvider({ ...config, fetch: fetchImpl })
    assert.deepEqual(await provider.discover('T'), [])
    assert.match(provider.noAccountsHint, /View your YouTube account/)
    assert.match(provider.noAccountsHint, /channel/)
  })

  test('a spent quota during discovery is not swallowed as "no channel"', async () => {
    const { fetchImpl } = mockGoogle([
      { status: 403, body: { error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } } },
    ])
    await assert.rejects(
      () => new GoogleProvider({ ...config, fetch: fetchImpl }).discover('T'),
      (error: unknown) => error instanceof PublishError && error.failureClass === 'transient',
    )
  })

  test('a reply that breaks off during discovery or sign-in is transient, not "no channel"', async () => {
    const isBlip = (error: unknown) => error instanceof GoogleOAuthError && error.failureClass === 'transient'
    await assert.rejects(() => new GoogleProvider({ ...config, fetch: brokenOff(200) }).discover('T'), isBlip)
    await assert.rejects(() => new GoogleOAuth({ ...config, fetch: brokenOff(200) }).userinfo('T'), isBlip)
  })
})

describe('registration and settings', () => {
  test('registers under its own key, with its own callback path', () => {
    const provider = new GoogleProvider(config)
    assert.equal(provider.key, 'google')
    assert.equal(new URL(provider.redirectUri).pathname, '/google/callback')
    assert.deepEqual([...provider.platforms], ['youtube'])
  })

  test('is not configured without both a client id and a secret', () => {
    assert.equal(googleProviderConfigFromEnv(() => undefined), undefined)
    assert.equal(googleProviderConfigFromEnv((k) => (k === 'GOOGLE_CLIENT_ID' ? 'id' : undefined)), undefined)
  })

  test('defaults the redirect to the /google/callback convention', () => {
    const settings = googleProviderConfigFromEnv((k) => ({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' })[k])
    assert.deepEqual(settings, { clientId: 'id', clientSecret: 's', redirectUri: 'http://localhost:8787/google/callback' })
  })
})
