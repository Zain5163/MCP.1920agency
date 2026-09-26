import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  ACTION_POLICY,
  canonicalise,
  checkSpend,
  confirmationMatches,
  confirmationToken,
  decide,
  formatApprovalRequest,
  policyFor,
  setConfirmationSecret,
  type SpendLimit,
} from '../src/domain/policy.ts'

setConfirmationSecret(Buffer.alloc(32, 7))

const draft = { body: 'Hello world', accounts: ['a1'] }

describe('risk classification', () => {
  test('reads are low risk', () => {
    for (const action of ['check_status', 'list_accounts', 'list_posts', 'validate_post']) {
      assert.equal(policyFor(action).risk, 'low', action)
    }
  })

  test('scheduling and cancelling are medium — recoverable, not harmless', () => {
    assert.equal(policyFor('schedule_post').risk, 'medium')
    assert.equal(policyFor('cancel_scheduled_post').risk, 'medium')
  })

  test('publishing is high risk and marked irreversible', () => {
    const policy = policyFor('publish_post')
    assert.equal(policy.risk, 'high')
    assert.equal(policy.reversible, false)
  })

  test('an unclassified action fails CLOSED, not open', () => {
    // The property the whole layer rests on. An action nobody classified is far
    // more likely to be new and unconsidered than harmless.
    const policy = policyFor('delete_everything')
    assert.equal(policy.risk, 'high')
    assert.equal(policy.reversible, false)
    assert.equal(policy.spendsMoney, true)
  })

  test('every declared action carries a rationale a person could read', () => {
    for (const [action, policy] of Object.entries(ACTION_POLICY)) {
      assert.ok(policy.rationale.length > 20, `${action} has no real rationale`)
    }
  })
})

describe('deciding', () => {
  const describe_ = () => 'Post "Hello world" to 1 account'

  test('low risk executes without ceremony', () => {
    const d = decide({ action: 'list_accounts', payload: {}, describe: describe_ })
    assert.equal(d.allowed, true)
  })

  test('medium risk executes too', () => {
    const d = decide({ action: 'schedule_post', payload: draft, describe: describe_ })
    assert.equal(d.allowed, true)
  })

  test('high risk is refused the first time, with a token', () => {
    const d = decide({ action: 'publish_post', payload: draft, describe: describe_ })
    assert.equal(d.allowed, false)
    assert.ok(!d.allowed && d.token.length > 20)
  })

  test('high risk executes when the matching token comes back', () => {
    const first = decide({ action: 'publish_post', payload: draft, describe: describe_ })
    assert.equal(first.allowed, false)

    const second = decide({
      action: 'publish_post',
      payload: draft,
      confirmation: first.allowed === false ? first.token : '',
      describe: describe_,
    })
    assert.equal(second.allowed, true)
  })

  /**
   * The point of the whole design. A boolean flag would let a model approve its
   * own changed content; a token over the payload cannot.
   */
  test('a token for one post does NOT authorise different content', () => {
    const approved = decide({ action: 'publish_post', payload: draft, describe: describe_ })
    assert.equal(approved.allowed, false)

    const tampered = decide({
      action: 'publish_post',
      payload: { ...draft, body: 'Hello world!' },
      confirmation: approved.allowed === false ? approved.token : '',
      describe: describe_,
    })
    assert.equal(tampered.allowed, false, 'edited content must need fresh approval')
  })

  test('a token does not authorise a different action', () => {
    const approved = decide({ action: 'publish_post', payload: draft, describe: describe_ })
    const reused = decide({
      action: 'cancel_scheduled_post',
      payload: draft,
      confirmation: approved.allowed === false ? approved.token : '',
      describe: describe_,
    })
    // Medium risk, so allowed anyway — but for its own reason, not the token.
    assert.equal(reused.allowed, true)
    assert.notEqual(confirmationToken('cancel_scheduled_post', draft), confirmationToken('publish_post', draft))
  })

  test('an invented token is rejected', () => {
    const d = decide({
      action: 'publish_post',
      payload: draft,
      confirmation: 'looks-plausible-enough',
      describe: describe_,
    })
    assert.equal(d.allowed, false)
  })

  test('an empty or missing confirmation is rejected', () => {
    assert.equal(confirmationMatches('publish_post', draft, ''), false)
    assert.equal(confirmationMatches('publish_post', draft, undefined), false)
  })

  test('an unclassified action needs approval, by default', () => {
    const d = decide({ action: 'launch_campaign', payload: {}, describe: describe_ })
    assert.equal(d.allowed, false)
  })
})

describe('canonical payloads', () => {
  test('key order does not change the token', () => {
    // Two callers describing the same post are making the same request.
    assert.equal(
      confirmationToken('publish_post', { a: 1, b: 2 }),
      confirmationToken('publish_post', { b: 2, a: 1 }),
    )
  })

  test('array order DOES change it — order is content', () => {
    assert.notEqual(canonicalise(['a', 'b']), canonicalise(['b', 'a']))
  })

  test('nested objects are canonicalised too', () => {
    assert.equal(canonicalise({ x: { p: 1, q: 2 } }), canonicalise({ x: { q: 2, p: 1 } }))
  })

  test('undefined fields are ignored, so an absent key equals an unset one', () => {
    assert.equal(canonicalise({ a: 1, b: undefined }), canonicalise({ a: 1 }))
  })

  test('a null value is not the same as an absent one', () => {
    assert.notEqual(canonicalise({ a: 1, b: null }), canonicalise({ a: 1 }))
  })
})

describe('the approval message', () => {
  test('says nothing has happened, and how to proceed', () => {
    const d = decide({
      action: 'publish_post',
      payload: draft,
      describe: () => 'Post "Hello world" to Facebook',
    })
    assert.equal(d.allowed, false)
    const message = formatApprovalRequest(d as Extract<typeof d, { allowed: false }>)

    assert.match(message, /nothing has been sent/i)
    assert.match(message, /Hello world/)
    assert.match(message, /cannot be undone/i)
    // R1: an error is only useful if it says how to fix it.
    assert.match(message, /confirm:/)
  })
})

describe('spend ceilings', () => {
  const limit: SpendLimit = {
    dailyMaxMinor: 10_000,
    monthlyMaxMinor: 200_000,
    currency: 'USD',
  }

  test('a budget inside the limit passes', () => {
    assert.equal(checkSpend(limit, { dailyMinor: 5_000, currency: 'USD' }).ok, true)
  })

  test('a budget over the daily limit fails with the numbers in it', () => {
    const result = checkSpend(limit, { dailyMinor: 20_000, currency: 'USD' })
    assert.equal(result.ok, false)
    assert.ok(!result.ok && result.reason.includes('200.00 USD'))
  })

  test('existing commitments count toward the limit', () => {
    // Ten campaigns at $50 is $500, whatever each one looks like alone.
    assert.equal(checkSpend(limit, { dailyMinor: 5_000, currency: 'USD' }, 9_000).ok, false)
  })

  test('a daily budget under the limit can still break the monthly one', () => {
    const tight: SpendLimit = { dailyMaxMinor: 10_000, monthlyMaxMinor: 50_000, currency: 'USD' }
    assert.equal(checkSpend(tight, { dailyMinor: 9_000, currency: 'USD' }).ok, false)
  })

  test('a mismatched currency is refused, never converted', () => {
    const result = checkSpend(limit, { dailyMinor: 5_000, currency: 'PKR' })
    assert.equal(result.ok, false)
    assert.ok(!result.ok && /no conversion/i.test(result.reason))
  })

  test('zero and negative budgets are refused', () => {
    assert.equal(checkSpend(limit, { dailyMinor: 0, currency: 'USD' }).ok, false)
    assert.equal(checkSpend(limit, { dailyMinor: -5_000, currency: 'USD' }).ok, false)
  })
})
