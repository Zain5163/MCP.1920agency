import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  PublishError,
  backoffMs,
  classifyHttpStatus,
  classifyNetworkError,
} from '../src/domain/errors.ts'

describe('classifyHttpStatus', () => {
  test('treats auth failures as credential problems', () => {
    assert.equal(classifyHttpStatus(401), 'credential')
    assert.equal(classifyHttpStatus(403), 'credential')
  })

  test('treats rate limiting as transient', () => {
    assert.equal(classifyHttpStatus(429), 'transient')
  })

  test('treats server errors as transient', () => {
    assert.equal(classifyHttpStatus(500), 'transient')
    assert.equal(classifyHttpStatus(503), 'transient')
  })

  test('treats other client errors as permanent so we do not burn quota retrying', () => {
    assert.equal(classifyHttpStatus(400), 'permanent')
    assert.equal(classifyHttpStatus(404), 'permanent')
    assert.equal(classifyHttpStatus(422), 'permanent')
  })
})

describe('classifyNetworkError', () => {
  test('retries connection-level failures', () => {
    assert.equal(classifyNetworkError({ code: 'ECONNRESET' }), 'transient')
    assert.equal(classifyNetworkError({ code: 'ETIMEDOUT' }), 'transient')
    assert.equal(classifyNetworkError({ code: 'UND_ERR_CONNECT_TIMEOUT' }), 'transient')
  })

  test('does not retry unrecognised errors', () => {
    assert.equal(classifyNetworkError({ code: 'NOPE' }), 'permanent')
    assert.equal(classifyNetworkError(new Error('boom')), 'permanent')
    assert.equal(classifyNetworkError(null), 'permanent')
  })
})

describe('PublishError', () => {
  test('only transient failures are retryable', () => {
    assert.equal(new PublishError('x', { failureClass: 'transient' }).isRetryable, true)
    assert.equal(new PublishError('x', { failureClass: 'permanent' }).isRetryable, false)
    assert.equal(new PublishError('x', { failureClass: 'credential' }).isRetryable, false)
  })

  test('preserves the platform message verbatim for display', () => {
    const err = new PublishError('Publish failed', {
      failureClass: 'permanent',
      platformMessage: 'The aspect ratio 21:9 is not supported.',
      platformCode: 'IG_400',
    })
    assert.equal(err.platformMessage, 'The aspect ratio 21:9 is not supported.')
    assert.equal(err.platformCode, 'IG_400')
  })
})

describe('backoffMs', () => {
  test('grows exponentially with the attempt number', () => {
    const noJitter = () => 1
    assert.equal(backoffMs(1, { baseMs: 1000, random: noJitter }), 1000)
    assert.equal(backoffMs(2, { baseMs: 1000, random: noJitter }), 2000)
    assert.equal(backoffMs(3, { baseMs: 1000, random: noJitter }), 4000)
  })

  test('respects the cap', () => {
    const noJitter = () => 1
    assert.equal(backoffMs(40, { baseMs: 1000, maxMs: 60_000, random: noJitter }), 60_000)
  })

  test('applies jitter so simultaneous targets do not retry in lockstep', () => {
    // Full jitter means the delay is somewhere in [0, exponential), not a fixed value.
    assert.equal(backoffMs(3, { baseMs: 1000, random: () => 0 }), 0)
    assert.ok(backoffMs(3, { baseMs: 1000, random: () => 0.5 }) < 4000)
  })

  test('never returns a negative delay', () => {
    assert.ok(backoffMs(0, { baseMs: 1000, random: () => 0.5 }) >= 0)
  })
})
