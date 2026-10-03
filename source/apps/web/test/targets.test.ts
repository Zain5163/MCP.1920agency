import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import {
  ATTACHMENTS_NOT_STORED_CODE,
  ATTACHMENTS_NOT_STORED_MESSAGE,
  NOTICE_CODE,
  failedColumns,
  publishedColumns,
} from '@social-publisher/db'

import { targetView } from '../src/lib/targets.ts'

/**
 * Finding #7: the dashboard showed a private YouTube upload as a green
 * "published" with a view link, and never showed its notice.
 */

// The notice the YouTube adapter returns for an unaudited, private upload.
const NOTICE =
  'Uploaded as private, not published. This Google Cloud project has not passed the YouTube API audit, ' +
  'and YouTube restricts uploads from unaudited projects to private viewing, so only the channel can see it.'

describe('the dashboard draws each target from what its row says', () => {
  test("the reviewers' case: a private upload is 'uploaded' in the warn colour, with its notice and no Retry", () => {
    // Exactly what every recorder now writes for a successful upload with a notice.
    const row = { ...publishedColumns({ platformPostId: 'VID123', url: 'https://www.youtube.com/watch?v=VID123', notice: NOTICE }) }
    assert.equal(row.errorCode, NOTICE_CODE)

    const view = targetView(row)
    assert.equal(view.label, 'uploaded')
    assert.equal(view.tone, 'warn')
    assert.deepEqual(view.note, { kind: 'notice', text: NOTICE })
    assert.equal(view.retry, false, 'it went out: a retry would upload it twice')
  })

  test('a plain success is green and offers nothing', () => {
    const view = targetView(publishedColumns({ platformPostId: 'fb-1' }))
    assert.deepEqual(view, { label: 'published', tone: 'ok', retry: false })
  })

  test('an older published row still holding the error of an earlier attempt is not taken for a notice', () => {
    // Before notices, a retry that succeeded kept the previous attempt's error.
    const view = targetView({ state: 'published', errorCode: null, platformMessage: 'Rate limited, try later' })
    assert.deepEqual(view, { label: 'published', tone: 'ok', retry: false })
  })

  test("finding #6, the reviewers' case: a failed post whose document was never stored offers no Retry, and says why", () => {
    // What `post --document carousel.pdf --publish` now records when LinkedIn refuses the upload.
    const row = {
      state: 'failed',
      ...failedColumns(
        { failureClass: 'transient', message: 'LinkedIn rejected the document upload (HTTP 503). Nothing was posted.', platformCode: '503' },
        { attachmentsStored: false },
      ),
    }
    assert.equal(row.errorCode, ATTACHMENTS_NOT_STORED_CODE)

    const view = targetView(row)
    assert.equal(view.retry, false, 'a Retry would post the carousel text without its slides')
    assert.equal(view.noRetry, ATTACHMENTS_NOT_STORED_MESSAGE)
    assert.deepEqual(view.note, { kind: 'failure', text: row.platformMessage }, "the platform's reason is still shown")
    assert.equal(view.label, 'failed')

    // Stored attachments: the platform's own code is kept and Retry is offered.
    const stored = { state: 'failed', ...failedColumns({ failureClass: 'transient', message: 'x', platformCode: '503' }, { attachmentsStored: true }) }
    assert.equal(stored.errorCode, '503')
    assert.equal(targetView(stored).retry, true)

    assert.equal(targetView({ ...row, state: 'needs_reauth' }).retry, false, 'not after reconnecting either')
  })

  test('failures show their reason and offer a Retry; scheduled posts are amber', () => {
    assert.deepEqual(targetView({ state: 'failed', errorCode: '190', platformMessage: 'Token expired' }), {
      label: 'failed',
      tone: 'bad',
      note: { kind: 'failure', text: 'Token expired' },
      retry: true,
    })
    assert.equal(targetView({ state: 'needs_reauth', errorCode: null, platformMessage: null }).retry, true)
    assert.deepEqual(targetView({ state: 'scheduled', errorCode: null, platformMessage: null }), {
      label: 'scheduled',
      tone: 'warn',
      retry: false,
    })
  })
})
