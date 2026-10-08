import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { findShopifyStore, readShopifyStores } from '../src/shopify-tools.ts'

function file(contents: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'shops-')), 'shopify-stores.json')
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents))
  return path
}
const practice = { key: 'practice', name: 'Practice store', shop: '1920-agency-test-store.myshopify.com' }

describe('the Shopify store list', () => {
  test('no file means no stores, not an error', () => {
    assert.deepEqual(readShopifyStores(join(tmpdir(), 'nope', 'shopify-stores.json')), [])
  })

  test('reads stores and finds one by key, name or address', () => {
    const list = readShopifyStores(file({ stores: [practice] }))
    assert.ok(Array.isArray(list))
    for (const s of ['practice', 'Practice store', '1920-agency-test-store.myshopify.com', 'https://1920-agency-test-store.myshopify.com/admin']) {
      const hit = findShopifyStore(s, list)
      assert.ok(!('error' in hit) && hit.key === 'practice', s)
    }
  })

  test('refuses a custom domain in place of the myshopify address', () => {
    assert.ok('error' in (readShopifyStores(file({ stores: [{ ...practice, shop: 'muzaree.com' }] })) as object))
  })

  test('refuses duplicates and malformed files', () => {
    assert.ok('error' in (readShopifyStores(file({ stores: [practice, { ...practice, key: 'other' }] })) as object))
    assert.ok('error' in (readShopifyStores(file('{ nope')) as object))
  })

  test('an unknown store names the known ones', () => {
    const list = readShopifyStores(file({ stores: [practice] }))
    assert.ok(Array.isArray(list))
    const miss = findShopifyStore('muzaree', list)
    assert.ok('error' in miss && /Practice store/.test(miss.error))
  })
})
