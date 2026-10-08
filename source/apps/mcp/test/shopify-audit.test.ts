import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { auditFor, type ShopifyAccess } from '../src/shopify-tools.ts'

/**
 * Store changes are logged under the account that made them.
 *
 * On the hosted server every user has their own stores; the old `audit()` helper
 * wrote to the server's first account, so one customer's store changes were
 * filed under another account (found 2026-10-08). Hosted access now carries its
 * own `record`, and the Shopify tools go through `auditFor`.
 */

const fakeAccess = (record?: ShopifyAccess['record']): ShopifyAccess => ({
  list: async () => [],
  open: async () => ({ error: 'unused' }),
  backupDir: () => 'unused',
  ...(record !== undefined ? { record } : {}),
})

describe('auditFor', () => {
  test("records through the access's own account when it has one", async () => {
    const seen: Array<[string, Record<string, unknown>]> = []
    await auditFor(fakeAccess(async (action, detail) => void seen.push([action, detail])), 'shopify.page.saved', { shop: 'a.myshopify.com' })
    assert.deepEqual(seen, [['shopify.page.saved', { shop: 'a.myshopify.com' }]])
  })

  test('a failing activity log never fails the tool', async () => {
    await assert.doesNotReject(
      auditFor(fakeAccess(async () => { throw new Error('database down') }), 'shopify.product.updated', {}),
    )
  })

  test("no Shopify tool writes to the server-wide audit() any more", () => {
    for (const file of ['shopify-tools.ts', 'shopify-build-tools.ts', 'shopify-hosted.ts']) {
      const src = readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf8')
      const direct = src.match(/await audit\((['`])shopify\./g) ?? []
      assert.equal(direct.length, 0, `${file} still calls audit('shopify...') directly`)
    }
  })
})
