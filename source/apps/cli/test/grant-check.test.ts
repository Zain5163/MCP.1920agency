import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { DEFAULT_GOOGLE_REDIRECT_URI, GoogleProvider } from '@social-publisher/adapters'

import { partialGrantRefusal } from '../src/grant-check.ts'

/**
 * Finding #3: `connect:provider google youtube` stored a channel as ready when
 * the owner had unticked "Manage your YouTube videos". Discovery only needs
 * read access, so the channel was found, and every upload to it then failed.
 *
 * The real GoogleProvider does the exchange against a scripted Google, so the
 * granted scopes are read exactly as they are from a real sign-in.
 */

const SCOPE = 'https://www.googleapis.com/auth/'
const IDENTITY = `openid ${SCOPE}userinfo.email ${SCOPE}userinfo.profile`

/** A Google that grants `scope` and answers who signed in. Nothing leaves the process. */
function googleGranting(scope: string): GoogleProvider {
  const fetchImpl = (async (url: string | URL | Request) => {
    if (String(url).includes('userinfo')) {
      return new Response(JSON.stringify({ sub: '123', email: 'owner@example.com', name: 'Owner' }))
    }
    return new Response(
      JSON.stringify({ access_token: 'ya29.A', expires_in: 3599, refresh_token: '1//R', scope, token_type: 'Bearer' }),
    )
  }) as typeof globalThis.fetch
  return new GoogleProvider({
    clientId: 'CLIENT.apps.googleusercontent.com',
    clientSecret: 'not-a-real-secret',
    redirectUri: DEFAULT_GOOGLE_REDIRECT_URI,
    fetch: fetchImpl,
  })
}

describe('connect:provider refuses a sign-in that lacks a permission it needs', () => {
  test('upload unticked: refused, naming the consent-screen label and how to grant it', async () => {
    const google = googleGranting(`${IDENTITY} ${SCOPE}youtube.readonly`)
    const credential = await google.exchangeCode('code-1')
    assert.ok(credential.grantedScopes !== undefined, 'the grant is reported, so it can be judged')

    const refusal = partialGrantRefusal(google, credential.grantedScopes, ['youtube'])

    assert.ok(refusal !== undefined, 'a channel that cannot be uploaded to must not be stored as ready')
    const text = refusal.join('\n')
    assert.match(text, /Google authorised, but without a permission this needs/)
    assert.match(text, /- Manage your YouTube videos/)
    assert.doesNotMatch(text, /View your YouTube account/, 'read access was granted, so it is not listed')
    assert.match(text, /pnpm connect:provider google/, 'the catalogue fix steps follow')
    assert.match(text, /myaccount\.google\.com\/permissions/)
    assert.equal(refusal.at(-1), 'Nothing was stored.')
  })

  test('both unticked: both labels are listed', async () => {
    const google = googleGranting(IDENTITY)
    const credential = await google.exchangeCode('code-2')
    const text = partialGrantRefusal(google, credential.grantedScopes, ['youtube'])!.join('\n')
    assert.match(text, /without permissions this needs/)
    assert.match(text, /- Manage your YouTube videos/)
    assert.match(text, /- View your YouTube account/)
  })

  test('a full grant passes, including a broader scope granted in place of the narrow one', async () => {
    for (const scope of [
      `${IDENTITY} ${SCOPE}youtube.upload ${SCOPE}youtube.readonly`,
      // include_granted_scopes can answer with full `youtube`, which allows uploads too.
      `${IDENTITY} ${SCOPE}youtube ${SCOPE}youtube.readonly`,
    ]) {
      const google = googleGranting(scope)
      const credential = await google.exchangeCode('code-3')
      assert.equal(partialGrantRefusal(google, credential.grantedScopes, ['youtube']), undefined, scope)
    }
  })

  test('a provider that cannot judge its grant is not refused, as before', () => {
    const withoutCheck = { displayName: 'Meta' }
    assert.equal(partialGrantRefusal(withoutCheck, ['pages_show_list'], []), undefined)
    assert.equal(partialGrantRefusal(googleGranting(IDENTITY), undefined, ['youtube']), undefined, 'no grant reported')
  })
})
