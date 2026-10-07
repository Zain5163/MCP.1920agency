import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import {
  FREE_MONTHLY_CALLS,
  USAGE_NOTICE_THRESHOLDS,
  formatDay,
  isFreeTool,
  limitMessage,
  meterCall,
  planOf,
  resetDate,
  upgradeMessage,
  upgradeTarget,
  usageMonth,
  usageSummary,
} from '../src/domain/plans.ts'
import { resolutionFor } from '../src/domain/resolutions.ts'

const LINK = 'https://adspilot.example/upgrade'

/** Runs a whole month of Free calls and collects every notice, as the wrapper would. */
function runMonth(calls: number): Array<{ call: number; notice: string }> {
  const shown: number[] = []
  const notices: Array<{ call: number; notice: string }> = []
  for (let n = 1; n <= calls; n++) {
    const decision = meterCall({ plan: 'free', callsBefore: n - 1, callsAfter: n, noticesShown: shown, upgradeUrl: LINK })
    shown.push(...decision.newlyShown)
    if (decision.notice !== undefined) notices.push({ call: n, notice: decision.notice })
  }
  return notices
}

describe('the Free allowance (decision 0009)', () => {
  test('is 200 calls with notices at 25, 50, 75, 85, 90, 95 and 99%', () => {
    assert.equal(FREE_MONTHLY_CALLS, 200)
    assert.deepEqual([...USAGE_NOTICE_THRESHOLDS], [25, 50, 75, 85, 90, 95, 99])
  })

  test('the 200th call runs and the 201st does not', () => {
    assert.equal(meterCall({ plan: 'free', callsBefore: 199, callsAfter: 200, noticesShown: [] }).allowed, true)
    assert.equal(meterCall({ plan: 'free', callsBefore: 200, callsAfter: 201, noticesShown: [] }).allowed, false)
    assert.equal(meterCall({ plan: 'free', callsBefore: 350, callsAfter: 351, noticesShown: [] }).allowed, false)
  })

  test('a whole month shows each notice exactly once, on the crossing call', () => {
    const notices = runMonth(200)
    assert.deepEqual(
      notices.map((n) => n.call),
      [50, 100, 150, 170, 180, 190, 198],
    )
  })

  test('the 90% notice reads as the decision words it', () => {
    const at90 = runMonth(200).find((n) => n.call === 180)
    assert.equal(
      at90?.notice,
      `USAGE NOTICE: You've used 90% of your free calls this month (180 of 200). Premium is $9/month for unlimited use: ${LINK}.`,
    )
  })

  test('a threshold already shown this month is not shown again', () => {
    const decision = meterCall({ plan: 'free', callsBefore: 179, callsAfter: 180, noticesShown: [25, 50, 75, 85, 90] })
    assert.equal(decision.notice, undefined)
    assert.deepEqual(decision.newlyShown, [])
  })

  test('calls between thresholds carry nothing', () => {
    const decision = meterCall({ plan: 'free', callsBefore: 10, callsAfter: 11, noticesShown: [] })
    assert.deepEqual(decision, { allowed: true, newlyShown: [] })
  })

  test('a jump across several thresholds marks all and says the highest', () => {
    const decision = meterCall({ plan: 'free', callsBefore: 40, callsAfter: 160, noticesShown: [] })
    assert.deepEqual(decision.newlyShown, [25, 50, 75])
    assert.match(decision.notice ?? '', /used 75%/)
  })

  test('a blocked call carries no notice and marks nothing', () => {
    const decision = meterCall({ plan: 'free', callsBefore: 200, callsAfter: 201, noticesShown: [] })
    assert.deepEqual(decision, { allowed: false, newlyShown: [] })
  })
})

describe('Premium', () => {
  test('is never blocked and never shown a notice', () => {
    for (const before of [0, 49, 179, 200, 5000]) {
      const decision = meterCall({ plan: 'premium', callsBefore: before, callsAfter: before + 1, noticesShown: [] })
      assert.deepEqual(decision, { allowed: true, newlyShown: [] })
    }
  })

  test('only the exact stored value is Premium; anything else is Free', () => {
    assert.equal(planOf('premium'), 'premium')
    for (const value of ['free', 'Premium', '', null, undefined, 42]) assert.equal(planOf(value), 'free')
  })
})

describe('months and reset dates are UTC', () => {
  test('the month a moment falls in', () => {
    assert.equal(usageMonth(new Date('2026-10-08T12:00:00Z')), '2026-10')
    assert.equal(usageMonth(new Date('2026-12-31T23:59:59Z')), '2026-12')
    // Already November in UTC+5 but still October in UTC: UTC decides.
    assert.equal(usageMonth(new Date('2026-10-31T21:00:00Z')), '2026-10')
  })

  test('the reset is the 1st of next month, across a year end', () => {
    assert.equal(resetDate(new Date('2026-10-08T12:00:00Z')).toISOString(), '2026-11-01T00:00:00.000Z')
    assert.equal(resetDate(new Date('2026-12-15T00:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z')
    assert.equal(formatDay(resetDate(new Date('2026-12-15T00:00:00Z'))), '1 January 2027')
  })
})

describe('the limit message', () => {
  const message = limitMessage({ callsUsed: 200, now: new Date('2026-10-20T00:00:00Z'), upgradeUrl: LINK })

  test('says nothing was done, when it resets and how to upgrade', () => {
    assert.match(message, /^\[USAGE_LIMIT_REACHED\] /)
    assert.match(message, /\(200 of 200\), so this request was not carried out/)
    assert.match(message, /reset on 1 November 2026 \(UTC\)/)
    assert.match(message, new RegExp(`\\$9/month for unlimited use: ${LINK.replace(/[.]/g, '\\.')}`))
    assert.match(message, /check_usage and upgrade still work/)
  })

  test('its code has a full catalogue entry that says not to retry', () => {
    const resolution = resolutionFor('USAGE_LIMIT_REACHED')
    assert.equal(resolution.retryable, false)
    assert.equal(resolution.needsHuman, true)
  })
})

describe('the upgrade link', () => {
  test('is used when it is an https link', () => {
    assert.equal(upgradeTarget(LINK), LINK)
    assert.equal(upgradeTarget(`  ${LINK} `), LINK)
  })

  test('falls back to plain words when missing or unsafe, never an invented link', () => {
    for (const bad of [undefined, '', 'http://insecure.example', 'javascript:alert(1)', 'not a url']) {
      const text = upgradeTarget(bad)
      assert.doesNotMatch(text, /https?:|javascript:/, String(bad))
      assert.match(text, /waitlist/)
    }
  })
})

describe('check_usage and upgrade texts', () => {
  const now = new Date('2026-10-08T00:00:00Z')

  test('Free shows used, left, reset and the offer', () => {
    const text = usageSummary({ plan: 'free', callsUsed: 37, now, upgradeUrl: LINK })
    assert.match(text, /Plan: Free \(200 calls a month\)/)
    assert.match(text, /37 of 200 \(163 left\)/)
    assert.match(text, /Resets: 1 November 2026 \(UTC\)/)
    assert.match(text, /\$9\/month/)
  })

  test('Free over the allowance shows none left, not a negative', () => {
    assert.match(usageSummary({ plan: 'free', callsUsed: 203, now }), /203 of 200 \(0 left\)/)
  })

  test('Premium shows unlimited and no offer', () => {
    const text = usageSummary({ plan: 'premium', callsUsed: 900, now, planRenewsAt: new Date('2026-11-03T00:00:00Z') })
    assert.match(text, /Premium \(unlimited/)
    assert.match(text, /Calls this month: 900/)
    assert.match(text, /Renews: 3 November 2026/)
    assert.doesNotMatch(text, /\$9/)
  })

  test('upgrade gives the link, or says Premium is already on', () => {
    assert.match(upgradeMessage('free', LINK), new RegExp(LINK.replace(/[.]/g, '\\.')))
    assert.match(upgradeMessage(undefined, undefined), /waitlist/)
    assert.match(upgradeMessage('premium', LINK), /already on Premium/)
  })

  test('only the account tools are free', () => {
    assert.equal(isFreeTool('check_usage'), true)
    assert.equal(isFreeTool('upgrade'), true)
    assert.equal(isFreeTool('set_business_type'), true)
    for (const name of ['publish_post', 'get_playbook', 'check_status', 'list_skills']) assert.equal(isFreeTool(name), false)
  })
})
