import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { selectTargets } from '../src/domain/targets.ts'
import type { Connection } from '../src/domain/types.ts'

const conn = (id: string, platform: string, displayName: string, needsReauth = false): Connection =>
  ({ id, tenantId: 't', platform, platformAccountId: id, displayName, credentialSource: 'oauth', scopes: [], needsReauth }) as unknown as Connection

// The owner's situation on 2026-10-02: many Pages from one login.
const all = [
  conn('fb1', 'facebook_page', '1920 Agency'),
  conn('fb2', 'facebook_page', 'Knightsbridge Healthcare'),
  conn('fb3', 'facebook_page', 'Muzaree'),
  conn('ig1', 'instagram', '1920 Agency (Instagram)'),
  conn('li1', 'linkedin', 'Zain Usman'),
  conn('fb4', 'facebook_page', 'Old Page', true),
]

describe('choosing who a post goes to', () => {
  test('naming a platform with several Pages is refused, listing them', () => {
    const r = selectTargets(all, { platforms: ['facebook_page' as never] })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.match(r.message, /Nothing was posted/)
      assert.match(r.message, /1920 Agency, Knightsbridge Healthcare, Muzaree/)
      assert.doesNotMatch(r.message, /Old Page/)
    }
  })

  test('naming no platform at all is refused too, rather than posting everywhere', () => {
    assert.equal(selectTargets(all, {}).ok, false)
  })

  test('a platform with one account still works without naming it', () => {
    const r = selectTargets(all, { platforms: ['linkedin' as never] })
    assert.equal(r.ok, true)
    if (r.ok) assert.deepEqual(r.chosen.map((c) => c.id), ['li1'])
  })

  test('named accounts are exactly what is posted to, by name in any case or by id', () => {
    const r = selectTargets(all, { accounts: ['1920 agency', 'ig1'] })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.deepEqual(r.chosen.map((c) => c.id), ['fb1', 'ig1'])
      assert.deepEqual([...r.platforms].sort(), ['facebook_page', 'instagram'])
    }
  })

  test('a name that matches nothing stops the whole post', () => {
    const r = selectTargets(all, { accounts: ['1920 Agency', 'Typo Page'] })
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.message, /"Typo Page"/)
  })

  test('an account needing reconnection is never chosen, even by name', () => {
    assert.equal(selectTargets(all, { accounts: ['Old Page'] }).ok, false)
  })
})
