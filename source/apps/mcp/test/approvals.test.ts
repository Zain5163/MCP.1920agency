import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { ApprovalLedger, alreadyUsedText } from '../src/approvals.ts'

/** The ledger behind single-use publish approvals (finding #12). */

const content = { body: 'Hello', accounts: ['conn-1'], media: [] }

describe('the approval ledger', () => {
  test('a claimed token is spent at once, then tells where it went', () => {
    const ledger = new ApprovalLedger()
    const approval = ledger.approvalFor('publish_post', content)
    assert.equal(approval.earlier, undefined)
    assert.deepEqual(approval.payload, content, 'a first send asks for the content as it is')

    const use = ledger.claim('tok-1', approval)
    assert.deepEqual(ledger.useOf('tok-1'), { postId: undefined, finished: false }, 'spent before any await')
    use.attach('post-9')
    use.finish()
    assert.deepEqual(ledger.useOf('tok-1'), { postId: 'post-9', finished: true })
    assert.match(alreadyUsedText(ledger.useOf('tok-1')!), /already used, for post post-9/)
  })

  test('content sent before needs a different approval, which counts the sends', () => {
    const ledger = new ApprovalLedger()
    ledger.claim('tok-1', ledger.approvalFor('publish_post', content)).attach('post-1')
    const second = ledger.approvalFor('publish_post', content)
    assert.deepEqual(second.payload, { ...content, sentBefore: 1 })
    assert.deepEqual(second.earlier, { count: 1, lastPostId: 'post-1' })

    ledger.claim('tok-2', second).attach('post-2')
    assert.deepEqual(ledger.approvalFor('publish_post', content).payload, { ...content, sentBefore: 2 })
    assert.equal(ledger.approvalFor('publish_post', { ...content, body: 'Other' }).earlier, undefined)
  })

  test('a released approval is unspent again, unless the content was sent since', () => {
    const ledger = new ApprovalLedger()
    const first = ledger.claim('tok-1', ledger.approvalFor('publish_post', content))
    first.release()
    assert.equal(ledger.useOf('tok-1'), undefined)
    assert.equal(ledger.approvalFor('publish_post', content).earlier, undefined, 'as if it never happened')

    const a = ledger.claim('tok-a', ledger.approvalFor('publish_post', content))
    ledger.claim('tok-b', ledger.approvalFor('publish_post', content)).attach('post-b')
    a.release()
    assert.equal(ledger.useOf('tok-a'), undefined)
    assert.equal(ledger.approvalFor('publish_post', content).earlier?.count, 2, 'the later send is not undone')
  })
})
