import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { allCodes, formatResolution, resolutionFor } from '../src/domain/resolutions.ts'

describe('the catalogue as a whole', () => {
  test('every code has a complete, usable entry', () => {
    // The project rule is that no error may say only what broke. This test is the
    // rule made enforceable — a new code with a thin entry fails here.
    for (const code of allCodes()) {
      const r = resolutionFor(code)
      assert.equal(r.code, code)
      assert.ok(r.what.length > 10, `${code}: 'what' is too thin`)
      assert.ok(r.why.length > 20, `${code}: 'why' is too thin`)
      assert.ok(r.fix.length > 0, `${code}: has no fix steps`)
      for (const step of r.fix) {
        assert.ok(step.length > 10, `${code}: fix step is too thin: "${step}"`)
      }
    }
  })

  test('no entry restates the symptom as the cause', () => {
    // "Why" must explain, not echo. Identical text means nobody wrote a real cause.
    for (const code of allCodes()) {
      const r = resolutionFor(code)
      assert.notEqual(r.why, r.what, `${code}: 'why' just repeats 'what'`)
    }
  })

  test('retryable errors never demand human action', () => {
    // An agent that retries something only a human can fix loops forever.
    for (const code of allCodes()) {
      const r = resolutionFor(code)
      if (r.retryable) {
        assert.equal(r.needsHuman, false, `${code}: marked retryable AND needsHuman`)
      }
    }
  })

  test('covers the failure classes the engine actually produces', () => {
    const codes = allCodes()
    for (const expected of [
      'TOKEN_EXPIRED',
      'RATE_LIMITED',
      'TEXT_TOO_LONG',
      'MEDIA_NOT_HOSTED',
      'DB_PAUSED',
      'STORAGE_NOT_PUBLIC',
    ] as const) {
      assert.ok(codes.includes(expected), `missing catalogue entry: ${expected}`)
    }
  })
})

describe('classification steers agent behaviour', () => {
  test('rate limiting retries without bothering anyone', () => {
    const r = resolutionFor('RATE_LIMITED')
    assert.equal(r.retryable, true)
    assert.equal(r.needsHuman, false)
  })

  test('a revoked token stops and asks for a person', () => {
    const r = resolutionFor('TOKEN_REVOKED')
    assert.equal(r.retryable, false)
    assert.equal(r.needsHuman, true)
  })

  test('a platform rejection is never retried', () => {
    // Retrying content the platform already refused just burns quota.
    assert.equal(resolutionFor('PLATFORM_REJECTED').retryable, false)
  })

  test('the Google and YouTube failures each have their own diagnosis', () => {
    const codes = allCodes()
    for (const expected of [
      'GOOGLE_SCOPE_NOT_GRANTED',
      'GOOGLE_API_NOT_ENABLED',
      'GOOGLE_TOKEN_REVOKED',
      'YOUTUBE_NO_CHANNEL',
      'YOUTUBE_WRONG_CHANNEL',
      'YOUTUBE_CHANNEL_UPLOAD_LIMIT',
    ] as const) {
      assert.ok(codes.includes(expected), `missing catalogue entry: ${expected}`)
    }
  })

  test('only a person can fix a missing permission, a switched-off API or a dead Google token', () => {
    for (const code of ['GOOGLE_SCOPE_NOT_GRANTED', 'GOOGLE_API_NOT_ENABLED', 'GOOGLE_TOKEN_REVOKED'] as const) {
      const r = resolutionFor(code)
      assert.equal(r.retryable, false, code)
      assert.equal(r.needsHuman, true, code)
    }
  })

  test("a channel's daily upload limit waits it out rather than asking anyone", () => {
    const r = resolutionFor('YOUTUBE_CHANNEL_UPLOAD_LIMIT')
    assert.equal(r.retryable, true)
    assert.equal(r.needsHuman, false)
  })

  test('the quota explanation no longer carries the stale Instagram figure', () => {
    assert.ok(!resolutionFor('QUOTA_EXHAUSTED').why.includes('50 per 24 hours'))
  })
})

describe('formatResolution', () => {
  test('includes the code, cause and numbered steps', () => {
    const output = formatResolution(resolutionFor('TOKEN_EXPIRED'))
    assert.match(output, /\[TOKEN_EXPIRED\]/)
    assert.match(output, /Why:/)
    assert.match(output, /How to fix:/)
    assert.match(output, /^ {2}1\. /m)
  })

  test('appends platform detail when there is any', () => {
    const output = formatResolution(resolutionFor('PLATFORM_REJECTED'), 'Aspect ratio 21:9 unsupported')
    assert.match(output, /Detail: Aspect ratio 21:9 unsupported/)
  })

  test('omits the detail section when there is none', () => {
    assert.ok(!formatResolution(resolutionFor('TOKEN_EXPIRED')).includes('Detail:'))
    assert.ok(!formatResolution(resolutionFor('TOKEN_EXPIRED'), '   ').includes('Detail:'))
  })

  test('states plainly whether retrying helps', () => {
    assert.match(formatResolution(resolutionFor('RATE_LIMITED')), /retried automatically/)
    assert.match(formatResolution(resolutionFor('TOKEN_EXPIRED')), /needs a person to act/)
  })

  test('UNKNOWN still gives the reader somewhere to go', () => {
    // Even an uncatalogued failure must not be a dead end.
    const output = formatResolution(resolutionFor('UNKNOWN'))
    assert.match(output, /How to fix:/)
    assert.match(output, /Report it/)
  })
})
