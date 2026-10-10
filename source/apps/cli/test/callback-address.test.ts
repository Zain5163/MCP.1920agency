import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

import { OAUTH_REDIRECT_PATHS } from '@social-publisher/config'

import {
  BOUNCE_PORT,
  CallbackAddressError,
  bounceNotice,
  listenAddress,
} from '../src/callback-address.ts'

/**
 * Where the connect commands listen, for both kinds of redirect address.
 *
 * Before 2026-10-08 the port came straight from the redirect address, so an
 * https address (needed while Meta's app is Live) made the CLI listen on port
 * 80 and the code never arrived. Pure inputs and outputs: no browser, no
 * provider, no database, no socket.
 */

const HOSTED = 'https://mcp.example.test'

describe('localhost redirect addresses (caught directly, as before)', () => {
  test('port and path come from the address', () => {
    assert.deepEqual(listenAddress('http://localhost:8787/callback'), {
      port: 8787,
      path: '/callback',
      bounced: false,
    })
    assert.deepEqual(listenAddress('http://localhost:9100/threads/callback'), {
      port: 9100,
      path: '/threads/callback',
      bounced: false,
    })
  })

  test('no port in the address means port 80, unchanged from before', () => {
    assert.equal(listenAddress('http://localhost/callback').port, 80)
  })

  test('127.0.0.1 and [::1] count as this PC too', () => {
    assert.equal(listenAddress('http://127.0.0.1:8787/google/callback').bounced, false)
    assert.equal(listenAddress('http://[::1]:8787/google/callback').bounced, false)
  })

  test('an OAUTH_CALLBACK_PORT that agrees is accepted', () => {
    assert.equal(listenAddress('http://localhost:8787/callback', '8787').port, 8787)
  })

  test('an OAUTH_CALLBACK_PORT that disagrees is refused, before any browser opens', () => {
    // The browser goes to the address's port; listening elsewhere waits forever.
    assert.throws(
      () => listenAddress('http://localhost:8787/callback', '9000'),
      (error: unknown) =>
        error instanceof CallbackAddressError &&
        /OAUTH_CALLBACK_PORT is 9000/.test(error.message) &&
        /port 8787/.test(error.message),
    )
  })

  test('https on localhost is refused: the listener speaks plain http', () => {
    assert.throws(() => listenAddress('https://localhost:8787/callback'), CallbackAddressError)
  })

  test('no bounce line is printed', () => {
    const address = listenAddress('http://localhost:8787/callback')
    assert.equal(bounceNotice('http://localhost:8787/callback', address), undefined)
  })
})

describe('https redirect addresses (bounced back to this PC by the hosted server)', () => {
  test('listens on 8787 by default, with the path of the https address', () => {
    assert.equal(BOUNCE_PORT, 8787)
    assert.deepEqual(listenAddress(`${HOSTED}/callback`), {
      port: 8787,
      path: '/callback',
      bounced: true,
    })
    assert.deepEqual(listenAddress(`${HOSTED}/linkedin-page/callback`), {
      port: 8787,
      path: '/linkedin-page/callback',
      bounced: true,
    })
  })

  test('the port of the https address is never used (it would be 443)', () => {
    assert.equal(listenAddress(`${HOSTED}/google/callback`).port, 8787)
    assert.equal(listenAddress(`${HOSTED}:8443/google/callback`).port, 8787)
  })

  test('OAUTH_CALLBACK_PORT overrides the default', () => {
    assert.equal(listenAddress(`${HOSTED}/instagram/callback`, '9123').port, 9123)
  })

  test('a blank OAUTH_CALLBACK_PORT is the same as none', () => {
    assert.equal(listenAddress(`${HOSTED}/callback`, '').port, 8787)
    assert.equal(listenAddress(`${HOSTED}/callback`, '   ').port, 8787)
  })

  test('the bounce line names the host and the port, and nothing secret', () => {
    const address = listenAddress(`${HOSTED}/threads/callback`)
    const line = bounceNotice(`${HOSTED}/threads/callback`, address)
    assert.ok(line !== undefined)
    assert.match(line, /mcp\.example\.test/)
    assert.match(line, /localhost:8787/)
    assert.equal(line.split('\n').length, 1)
  })
})

describe('bad settings say what to fix', () => {
  for (const bad of ['0', '65536', 'abc', '87.5', '-1', '8787x']) {
    test(`OAUTH_CALLBACK_PORT="${bad}" is refused`, () => {
      assert.throws(
        () => listenAddress(`${HOSTED}/callback`, bad),
        (error: unknown) =>
          error instanceof CallbackAddressError && /not a port number/.test(error.message),
      )
    })
  }

  test('a redirect address that is not a URL is refused with the variable to fix', () => {
    assert.throws(
      () => listenAddress('not a url'),
      (error: unknown) => error instanceof CallbackAddressError && /_REDIRECT_URI/.test(error.message),
    )
  })
})

/**
 * The Caddy bounce and the CLI must agree on the paths. A provider whose path
 * is missing from the Caddy matcher gets a 404 from the server after the owner
 * approved the dialog; a path in Caddy that no provider uses is surface for
 * nothing. Read from the files themselves, so a new provider cannot drift.
 */
describe('the Caddy bounce matches exactly the callback paths the CLI uses', () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

  const cliPaths = readFileSync(join(REPO, '.env.example'), 'utf8')
    .split(/\r?\n/)
    .map((line) => /^[A-Z_]+_REDIRECT_URI=(.+)$/.exec(line.trim())?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => listenAddress(value).path)
    .sort()

  // The template the gate's site file is rendered from (deploy/scripts/caddy-site.sh).
  const caddy = readFileSync(join(REPO, 'deploy', 'caddy', 'site.caddy.template'), 'utf8')
  const sitePort = /^OAUTH_BOUNCE_PORT=(\d+)\s*$/m.exec(readFileSync(join(REPO, 'deploy', 'site.env'), 'utf8'))?.[1]
  const configPaths = Object.values(OAUTH_REDIRECT_PATHS).slice().sort()
  const matcher = /@oauth \{([\s\S]*?)\}/.exec(caddy)?.[1] ?? ''
  const caddyPaths = (/^\s*path (.+)$/m.exec(matcher)?.[1] ?? '').trim().split(/\s+/).sort()

  test('found the paths on both sides (guards against a broken parse)', () => {
    assert.ok(cliPaths.length >= 7, `expected the CLI's redirect addresses, found ${cliPaths.length}`)
    assert.ok(caddyPaths.length >= 7, `expected the Caddy matcher's paths, found ${caddyPaths.length}`)
  })

  test('same set, no more and no less', () => {
    assert.deepEqual(caddyPaths, cliPaths)
  })

  test('the defaults in packages/config are the same set too', () => {
    assert.deepEqual(configPaths, caddyPaths)
  })

  test('the bounce is GET only and goes to the fixed listener port', () => {
    assert.match(matcher, /^\s*method GET\s*$/m)
    assert.match(caddy, /redir http:\/\/localhost:\{\{OAUTH_BOUNCE_PORT\}\}\{uri\} 302/)
    // site.env fills that placeholder; it must be the port the listener uses.
    assert.equal(Number(sitePort), BOUNCE_PORT)
  })
})
