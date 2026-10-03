import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { authorisationsToSearch } from '../src/lib/accounts.ts'

/**
 * Lower finding: the Accounts page warned 'No provider is registered for
 * "linkedin"' on every load, because it searched every stored authorisation
 * and the web app registers no LinkedIn provider.
 */

const registeredHere = (provider: string) => provider === 'meta' || provider === 'google'

describe('the Accounts page searches only authorisations it can use', () => {
  test("the reviewers' case: a stored LinkedIn authorisation is skipped, not reported", () => {
    const meta = { id: 'a1', provider: 'meta', needsReauth: false }
    const linkedin = { id: 'a2', provider: 'linkedin', needsReauth: false }
    assert.deepEqual(authorisationsToSearch([meta, linkedin], registeredHere), { usable: [meta] })
  })

  test('every registered and usable authorisation is searched', () => {
    const meta = { id: 'a1', provider: 'meta', needsReauth: false }
    const google = { id: 'a3', provider: 'google', needsReauth: false }
    assert.deepEqual(authorisationsToSearch([meta, google], registeredHere), { usable: [meta, google] })
  })

  test('the explanations stay accurate when there is nothing to search', () => {
    assert.match((authorisationsToSearch([], registeredHere) as { error: string }).error, /No authorisation stored yet/)

    const onlyCli = authorisationsToSearch([{ provider: 'linkedin', needsReauth: false }], registeredHere)
    assert.match((onlyCli as { error: string }).error, /None of the stored authorisations can add accounts on this page/)
    assert.doesNotMatch((onlyCli as { error: string }).error, /expired/, 'it did not expire')

    const expired = authorisationsToSearch(
      [{ provider: 'meta', needsReauth: true }, { provider: 'linkedin', needsReauth: false }],
      registeredHere,
    )
    assert.match((expired as { error: string }).error, /expired/)
  })
})
