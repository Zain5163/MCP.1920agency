import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  classifyGoogleError,
  classifyGoogleOAuthError,
  googleError,
  parseRetryAfter,
  secondsUntilQuotaReset,
  type GoogleErrorBody,
} from '../src/google-errors.ts'

const body = (reason: string, message = reason): GoogleErrorBody => ({
  error: { code: 0, message, errors: [{ domain: 'youtube', reason, message }] },
})

describe('classifying by reason, not by status', () => {
  test('quota and rate limits are transient even though they arrive as 403', () => {
    // Read by status alone, every one of these would say "token expired".
    for (const reason of ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded']) {
      assert.equal(classifyGoogleError(body(reason), 403).failureClass, 'transient', reason)
    }
    assert.equal(classifyGoogleError(body('quotaExceeded'), 403).code, 'QUOTA_EXHAUSTED')
    assert.equal(classifyGoogleError(body('rateLimitExceeded'), 403).code, 'RATE_LIMITED')
  })

  test('permission, API and channel problems are permanent with their own diagnosis', () => {
    assert.deepEqual(classifyGoogleError(body('insufficientPermissions'), 403), {
      failureClass: 'permanent',
      code: 'GOOGLE_SCOPE_NOT_GRANTED',
    })
    assert.deepEqual(classifyGoogleError(body('accessNotConfigured'), 403), {
      failureClass: 'permanent',
      code: 'GOOGLE_API_NOT_ENABLED',
    })
    assert.deepEqual(classifyGoogleError(body('youtubeSignupRequired'), 401), {
      failureClass: 'permanent',
      code: 'YOUTUBE_NO_CHANNEL',
    })
  })

  test("a channel's daily upload limit is waited out for a day", () => {
    const result = classifyGoogleError(body('uploadLimitExceeded'), 400)
    assert.equal(result.failureClass, 'transient')
    assert.equal(result.code, 'YOUTUBE_CHANNEL_UPLOAD_LIMIT')
    assert.equal(result.retryAfterSeconds, 86_400)
  })

  test('falls back on the status when there is no reason', () => {
    assert.equal(classifyGoogleError({}, 401).failureClass, 'credential')
    assert.equal(classifyGoogleError({}, 401).code, 'GOOGLE_TOKEN_REVOKED')
    assert.equal(classifyGoogleError({}, 429).failureClass, 'transient')
    assert.equal(classifyGoogleError({}, 503).failureClass, 'transient')
    assert.equal(classifyGoogleError({}, 400).failureClass, 'permanent')
    // Not credential: an unrecognised refusal is rarely a dead token.
    assert.equal(classifyGoogleError({}, 403).failureClass, 'permanent')
  })
})

describe("the token endpoint's own errors", () => {
  test('invalid_grant means the authorisation is gone', () => {
    assert.deepEqual(classifyGoogleOAuthError({ error: 'invalid_grant' }, 400), {
      failureClass: 'credential',
      code: 'GOOGLE_TOKEN_REVOKED',
    })
  })

  test('a misconfigured client is permanent but not the token', () => {
    for (const error of ['invalid_client', 'unauthorized_client', 'deleted_client']) {
      const result = classifyGoogleOAuthError({ error }, 401)
      assert.equal(result.failureClass, 'permanent')
      assert.equal(result.code, undefined)
    }
  })

  test('a throttled or failing endpoint is transient', () => {
    assert.equal(classifyGoogleOAuthError({}, 429).failureClass, 'transient')
    assert.equal(classifyGoogleOAuthError({ error: 'internal_failure' }, 500).failureClass, 'transient')
  })
})

describe('when the quota comes back', () => {
  test('waits until just after midnight Pacific', () => {
    // 07:00 UTC on 2 October 2026 is midnight in Los Angeles (PDT, UTC-7).
    assert.equal(secondsUntilQuotaReset(new Date('2026-10-02T07:00:00Z')), 86_400 + 300)
    // One minute before midnight there.
    assert.equal(secondsUntilQuotaReset(new Date('2026-10-02T06:59:00Z')), 60 + 300)
  })

  test('follows the clock change rather than a fixed offset', () => {
    // 08:00 UTC is midnight in Los Angeles in winter (PST, UTC-8).
    assert.equal(secondsUntilQuotaReset(new Date('2026-12-02T08:00:00Z')), 86_400 + 300)
  })
})

describe('Retry-After', () => {
  test('reads seconds and HTTP dates, and ignores nonsense', () => {
    const now = new Date('2026-10-02T12:00:00Z')
    assert.equal(parseRetryAfter('120', now), 120)
    assert.equal(parseRetryAfter('Fri, 02 Oct 2026 12:01:00 GMT', now), 60)
    assert.equal(parseRetryAfter('soon', now), undefined)
    assert.equal(parseRetryAfter(null, now), undefined)
  })

  test("the platform's Retry-After wins over a computed wait", () => {
    const error = googleError(body('quotaExceeded'), 403, { what: 'Uploading', retryAfter: '42' })
    assert.equal(error.retryAfterSeconds, 42)
  })
})

describe('the PublishError it builds', () => {
  test("keeps Google's message verbatim, the reason as the code, and names the resolution", () => {
    const error = googleError(body('insufficientPermissions', 'Request had insufficient authentication scopes.'), 403, {
      what: 'Starting the YouTube upload',
    })
    assert.equal(error.platformMessage, 'Request had insufficient authentication scopes.')
    assert.equal(error.platformCode, 'insufficientPermissions')
    assert.equal(error.httpStatus, 403)
    assert.equal(error.code, 'GOOGLE_SCOPE_NOT_GRANTED')
    assert.match(error.message, /^Starting the YouTube upload failed: /)
  })

  test('still says something useful about an empty body', () => {
    const error = googleError({}, 502, { what: 'Uploading' })
    assert.equal(error.failureClass, 'transient')
    assert.match(error.message, /HTTP 502/)
  })
})
