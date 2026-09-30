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

describe('ads actions', () => {
  test('anything that starts or accelerates spending is high risk', () => {
    for (const action of ['create_ad_plan', 'activate_campaign', 'update_budget']) {
      assert.equal(policyFor(action).risk, 'high', action)
    }
  })

  test('pausing is medium — refusing to stop spending would be worse', () => {
    assert.equal(policyFor('pause_campaign').risk, 'medium')
  })

  test('reading spend is low risk', () => {
    assert.equal(policyFor('get_ad_performance').risk, 'low')
    assert.equal(policyFor('list_ad_accounts').risk, 'low')
  })

  test('activating and raising a budget are marked as spending money', () => {
    assert.equal(policyFor('activate_campaign').spendsMoney, true)
    assert.equal(policyFor('update_budget').spendsMoney, true)
  })

  test('creating a paused plan does not itself spend', () => {
    // It commits a budget, but nothing leaves the account until activation.
    assert.equal(policyFor('create_ad_plan').spendsMoney, false)
    assert.equal(policyFor('create_ad_plan').risk, 'high')
  })

  test('activation needs a token covering that exact campaign', () => {
    const first = decide({
      action: 'activate_campaign',
      payload: { campaignId: 'c1', dailyBudgetMinor: 5_000 },
      describe: () => 'Activate: 50.00 USD/day',
    })
    assert.equal(first.allowed, false)

    const raised = decide({
      action: 'activate_campaign',
      payload: { campaignId: 'c1', dailyBudgetMinor: 50_000 },
      confirmation: first.allowed === false ? first.token : '',
      describe: () => 'Activate: 500.00 USD/day',
    })
    assert.equal(raised.allowed, false, 'a ten-fold budget change must need fresh approval')
  })
})

describe('a minimum daily spend', () => {
  const limit = { dailyMaxMinor: 1_000_000, monthlyMaxMinor: 10_000_000, dailyMinMinor: 100_000, currency: 'PKR' }

  test('refuses a budget too small to learn from', () => {
    const result = checkSpend(limit, { dailyMinor: 50_000, currency: 'PKR' })
    assert.equal(result.ok, false)
    assert.ok(!result.ok && /below the minimum of 1000\.00 PKR/.test(result.reason))
  })

  test('allows the minimum itself', () => {
    assert.equal(checkSpend(limit, { dailyMinor: 100_000, currency: 'PKR' }).ok, true)
  })
})

describe('a campaign with an end date', () => {
  // The owner's own limits: PKR 10,000/day, PKR 100,000/month.
  const owner = { dailyMaxMinor: 1_000_000, monthlyMaxMinor: 10_000_000, currency: 'PKR' }

  test('a 7-day campaign at the daily ceiling fits the monthly one', () => {
    // 10,000 x 7 = 70,000, inside 100,000. Assuming thirty days refused it.
    assert.equal(checkSpend(owner, { dailyMinor: 1_000_000, currency: 'PKR', durationDays: 7 }).ok, true)
  })

  test('the same budget with no end date does not', () => {
    const result = checkSpend(owner, { dailyMinor: 1_000_000, currency: 'PKR' })
    assert.equal(result.ok, false)
    assert.ok(!result.ok && /no end date/.test(result.reason))
  })

  test('running longer than a month is still counted as one month', () => {
    assert.equal(checkSpend(owner, { dailyMinor: 300_000, currency: 'PKR', durationDays: 90 }).ok, true)
  })

  test('campaigns already running are counted as running all month', () => {
    // 60,000 already committed for the month plus 5,000 x 10 days = 110,000.
    const result = checkSpend(owner, { dailyMinor: 500_000, currency: 'PKR', durationDays: 10 }, 200_000)
    assert.equal(result.ok, false)
  })
})

describe('the approval tells the truth about each action', () => {
  const ask = (action: string) => {
    const d = decide({ action, payload: { x: 1 }, describe: () => 'summary' })
    assert.equal(d.allowed, false)
    return formatApprovalRequest(d as Extract<typeof d, { allowed: false }>)
  }

  test('publishing is public and irreversible', () => {
    assert.match(ask('publish_post'), /public and cannot be undone/)
  })

  test('activating says it spends money that cannot be recovered', () => {
    assert.match(ask('activate_campaign'), /spends real money/)
    assert.doesNotMatch(ask('activate_campaign'), /public/)
  })

  test('creating a paused plan does not claim to be public or spending', () => {
    // It said "public and cannot be undone" for every approval until 2026-09-30.
    const text = ask('create_ad_plan')
    assert.match(text, /nothing spends yet/)
    assert.doesNotMatch(text, /cannot be undone/)
  })
})
