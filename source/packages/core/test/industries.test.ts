import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { INDUSTRIES, industryOf } from '../src/domain/industries.ts'
import { codeForFailure } from '../src/domain/resolutions.ts'

describe('industries', () => {
  test('the owner\'s list, in the owner\'s order', () => {
    assert.deepEqual([...INDUSTRIES], ['dentist', 'education', 'real_estate', 'ecommerce', 'tool_website', 'agency', 'other'])
  })

  test('a listed value is read as itself', () => {
    for (const industry of INDUSTRIES) assert.equal(industryOf(industry), industry)
  })

  test('anything else is no industry, not "other"', () => {
    // Free text must never reach analytics, and an unknown value must not inflate 'other'.
    for (const value of ['Dental clinic', 'DENTIST', '', null, undefined, 7, { industry: 'dentist' }]) {
      assert.equal(industryOf(value), undefined)
    }
  })
})

describe('codeForFailure', () => {
  test('the adapter\'s own code wins over the class', () => {
    assert.equal(codeForFailure({ failureClass: 'credential', code: 'QUOTA_EXHAUSTED' }), 'QUOTA_EXHAUSTED')
  })

  test('the class is the fallback', () => {
    assert.equal(codeForFailure({ failureClass: 'credential' }), 'TOKEN_EXPIRED')
    assert.equal(codeForFailure({ failureClass: 'transient' }), 'RATE_LIMITED')
    assert.equal(codeForFailure({ failureClass: 'permanent' }), 'PLATFORM_REJECTED')
  })
})
