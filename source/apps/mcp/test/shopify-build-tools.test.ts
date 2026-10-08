import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { menuLink, menuOutline, productProblem, type MenuLinkTargets } from '../src/shopify-build-tools.ts'

const targets: MenuLinkTargets = {
  collections: new Map([['boots', 'gid://shopify/Collection/1']]),
  pages: new Map([['faq', 'gid://shopify/Page/2']]),
  products: new Map([['chelsea-black', 'gid://shopify/Product/3']]),
}

describe('menu links', () => {
  test('short links become the right Shopify menu items', () => {
    assert.deepEqual(menuLink('home', targets), { type: 'FRONTPAGE', url: '/' })
    assert.deepEqual(menuLink('catalog', targets), { type: 'CATALOG', url: '/collections/all' })
    assert.deepEqual(menuLink('search', targets), { type: 'SEARCH', url: '/search' })
    assert.deepEqual(menuLink('collection:boots', targets), { type: 'COLLECTION', resourceId: 'gid://shopify/Collection/1' })
    assert.deepEqual(menuLink('Page:FAQ', targets), { type: 'PAGE', resourceId: 'gid://shopify/Page/2' })
    assert.deepEqual(menuLink('product:chelsea-black', targets), { type: 'PRODUCT', resourceId: 'gid://shopify/Product/3' })
    assert.deepEqual(menuLink('policy:refund', targets), { type: 'HTTP', url: '/policies/refund-policy' })
    assert.deepEqual(menuLink('/blogs/news', targets), { type: 'HTTP', url: '/blogs/news' })
    assert.deepEqual(menuLink('https://wa.me/923001234567', targets), { type: 'HTTP', url: 'https://wa.me/923001234567' })
  })

  test('a link to something that does not exist is refused, never guessed', () => {
    assert.match((menuLink('collection:sandals', targets) as { error: string }).error, /no collection with the handle "sandals"/)
    assert.match((menuLink('policy:returns', targets) as { error: string }).error, /policy:refund/)
    assert.ok('error' in menuLink('http://insecure.example', targets))
    assert.ok('error' in menuLink('javascript:alert(1)', targets))
  })

  test('the summary shows the menu as the owner will see it', () => {
    assert.equal(menuOutline([{ title: 'Shop', items: [{ title: 'Boots' }] }, { title: 'FAQ' }]), '    • Shop\n        – Boots\n    • FAQ')
  })
})

describe('a new product is checked before the owner is asked', () => {
  const sizes = [{ name: 'Size', values: ['40', '41'] }]
  test('a well-formed product passes', () => {
    assert.equal(productProblem({ options: sizes, variants: [{ options: { Size: '40' }, price: 5500 }, { options: { Size: '41' }, price: 5500, compareAtPrice: 6500 }], images: [{ url: 'https://cdn.example.com/a.jpg' }] }), undefined)
    assert.equal(productProblem({ options: [], variants: [{ options: {}, price: 10 }], images: [] }), undefined)
  })
  test('mistakes that would put a wrong product on sale are refused', () => {
    const cases: Array<[Parameters<typeof productProblem>[0], RegExp]> = [
      [{ options: sizes, variants: [{ options: { Size: '43' }, price: 1 }], images: [] }, /not one of the Size values/],
      [{ options: sizes, variants: [{ options: { Size: '40' }, price: 1 }, { options: { Size: '40' }, price: 1 }], images: [] }, /same combination/],
      [{ options: sizes, variants: [{ options: {}, price: 1 }], images: [] }, /a value for each option/],
      [{ options: sizes, variants: [{ options: { Size: '40' }, price: 5500, compareAtPrice: 5000 }], images: [] }, /"was" price must be higher/],
      [{ options: [], variants: [{ options: {}, price: 1 }, { options: {}, price: 2 }], images: [] }, /exactly one variant/],
      [{ options: [], variants: [{ options: {}, price: 0 }], images: [] }, /price above zero/],
      [{ options: [], variants: [{ options: {}, price: 1 }], images: [{ url: 'file:///C:/photo.jpg' }] }, /public https/],
      [{ options: [{ name: 'Size', values: ['40', '40'] }], variants: [{ options: { Size: '40' }, price: 1 }], images: [] }, /value twice/],
    ]
    for (const [spec, re] of cases) assert.match(productProblem(spec) ?? '', re)
  })
})

describe('building a store needs the owner’s approval', () => {
  test('each build action has its own high-risk policy, not the fallback', async () => {
    const { policyFor } = await import('@social-publisher/core')
    for (const action of ['shopify_create_product', 'shopify_save_collection', 'shopify_save_menu', 'shopify_save_policy']) {
      const policy = policyFor(action)
      assert.equal(policy.risk, 'high', action)
      assert.doesNotMatch(policy.rationale, /no policy entry/, action)
    }
  })
})
