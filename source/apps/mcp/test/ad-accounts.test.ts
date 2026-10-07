import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { findAdAccount, readAdAccounts } from '../src/ad-accounts.ts'
import { decideOn, type LoadedAccount } from '../src/ads-tools.ts'

function file(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'adacc-'))
  const path = join(dir, 'ad-accounts.json')
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents))
  return path
}

const muzaree = {
  key: 'muzaree',
  name: 'Muzaree',
  adAccountId: 'act_144042365972084',
  pageId: '778648892002721',
  instagramId: '17841476929259542',
  pixelId: '1407317194096683',
  currency: 'pkr',
  dailyLimit: 10000,
  monthlyLimit: 300000,
}
const agency = { key: '1920agency', name: '1920 Agency', adAccountId: '853868739015298', pageId: '102223309294786', currency: 'PKR' }

describe('the ad account list', () => {
  test('no file means no named accounts, not an error', () => {
    assert.deepEqual(readAdAccounts(join(tmpdir(), 'does-not-exist', 'ad-accounts.json')), [])
  })

  test('reads accounts and normalises ids and currency', () => {
    const list = readAdAccounts(file({ accounts: [muzaree, agency] }))
    assert.ok(Array.isArray(list))
    assert.equal(list[0]!.adAccountId, '144042365972084')
    assert.equal(list[0]!.currency, 'PKR')
    assert.equal(list[1]!.dailyLimit, undefined)
  })

  /**
   * A broken entry must stop the work rather than be skipped: a silently
   * missing account would send the campaign to the default account instead.
   */
  test('refuses a malformed entry instead of skipping it', () => {
    for (const bad of [
      { ...muzaree, adAccountId: 'muzaree' },
      { ...muzaree, pageId: undefined },
      { ...muzaree, currency: 'rupees' },
      { ...muzaree, dailyLimit: 5000, monthlyLimit: undefined },
      { ...muzaree, dailyLimit: -1 },
    ]) {
      assert.ok('error' in (readAdAccounts(file({ accounts: [bad] })) as object), JSON.stringify(bad))
    }
    assert.ok('error' in (readAdAccounts(file('{ not json')) as object))
  })

  test('refuses two accounts that share a name, key or id', () => {
    assert.ok('error' in (readAdAccounts(file({ accounts: [muzaree, { ...agency, adAccountId: '144042365972084' }] })) as object))
    assert.ok('error' in (readAdAccounts(file({ accounts: [muzaree, { ...agency, name: 'MUZAREE' }] })) as object))
  })

  test('finds an account by key, name or id, ignoring case and act_', () => {
    const list = readAdAccounts(file({ accounts: [muzaree, agency] }))
    assert.ok(Array.isArray(list))
    for (const selector of ['muzaree', 'Muzaree', 'MUZAREE', '144042365972084', 'act_144042365972084']) {
      const hit = findAdAccount(selector, list)
      assert.ok(!('error' in hit) && hit.name === 'Muzaree', selector)
    }
  })

  test('an unknown account is refused and the known ones are named', () => {
    const list = readAdAccounts(file({ accounts: [muzaree, agency] }))
    assert.ok(Array.isArray(list))
    const miss = findAdAccount('gradcollective', list)
    assert.ok('error' in miss)
    assert.match(miss.error, /Muzaree/)
    assert.match(miss.error, /Nothing was done/)
  })
})

describe('approvals are bound to the account', () => {
  const loaded = (id: string, name: string) =>
    ({ account: { adAccountId: id, pageId: '1', currency: 'PKR' }, label: `${name} (act_${id})` }) as unknown as LoadedAccount

  test('the summary names the account first', () => {
    const gate = decideOn(loaded('144042365972084', 'Muzaree'), {
      action: 'activate_campaign',
      payload: { campaignId: 'c1', dailyBudgetMinor: 500000 },
      describe: () => 'Activate "X"',
    })
    assert.equal(gate.allowed, false)
    assert.ok(gate.summary?.startsWith('Ad account: Muzaree (act_144042365972084)'))
  })

  /**
   * The safety property. Approving a campaign in one client's account must not
   * produce a token that also works for the same request in another account.
   */
  test('a yes given for one account does not work on another', () => {
    const request = { action: 'activate_campaign', payload: { campaignId: 'c1', dailyBudgetMinor: 500000 }, describe: () => 'x' }
    const forMuzaree = decideOn(loaded('144042365972084', 'Muzaree'), request)
    assert.ok(forMuzaree.token)
    const reused = decideOn(loaded('853868739015298', '1920 Agency'), { ...request, confirmation: forMuzaree.token })
    assert.equal(reused.allowed, false)
    const same = decideOn(loaded('144042365972084', 'Muzaree'), { ...request, confirmation: forMuzaree.token })
    assert.equal(same.allowed, true)
  })
})
