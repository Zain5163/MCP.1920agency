import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import { YouTubeAdapter } from '@social-publisher/adapters'
import { overridesForStorage } from '@social-publisher/core'

import { draftFromStored, type StoredPost } from '../src/draft.ts'

/**
 * Finding #11: a hosted schedule_post stored no media rows, so at its slot the
 * worker rebuilt the draft with no attachments and every YouTube schedule
 * failed with media_required. schedule_post now stores them (its own test);
 * this shows the rows it stores are enough for the worker.
 */

const noNetwork = (async () => {
  throw new Error('no network in this test')
}) as typeof fetch

const BODY = ['My clip title', 'A description of the clip.'].join('\n')

/** The post as the worker loads it, with the rows schedule_post now writes. */
function storedPost(media: StoredPost['media']): StoredPost {
  return {
    body: BODY,
    overrides: JSON.parse(JSON.stringify(overridesForStorage({ body: BODY, media: [], title: 'My clip' }, ['youtube']) ?? null)),
    media,
  }
}

const hostedVideo = {
  media: {
    id: 'asset-1',
    mime: 'video/mp4',
    bytes: 0,
    publicUrl: 'https://cdn.example.com/clip.mp4',
    width: null,
    height: null,
    durationSeconds: null,
  },
}

describe('the worker rebuilds a scheduled post from its rows', () => {
  test('a hosted video schedule rebuilds into a draft YouTube accepts', () => {
    const draft = draftFromStored(storedPost([hostedVideo]))

    assert.deepEqual(draft.media, [
      { id: 'asset-1', kind: 'video', mime: 'video/mp4', bytes: 0, publicUrl: 'https://cdn.example.com/clip.mp4' },
    ])
    assert.equal(draft.overrides?.youtube?.title, 'My clip', 'the stored title travels too')

    const result = new YouTubeAdapter({ fetch: noNetwork }).validate(draft)
    assert.equal(result.ok, true, JSON.stringify(result.issues))
  })

  test("without the rows, the reviewers' failure: YouTube refuses a draft with no video", () => {
    const result = new YouTubeAdapter({ fetch: noNetwork }).validate(draftFromStored(storedPost([])))
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.severity === 'error' && i.code === 'media_required'), JSON.stringify(result.issues))
  })

  test('a PDF row comes back as a document, dimensions only when stored', () => {
    const draft = draftFromStored({
      body: 'Slides',
      overrides: null,
      media: [{ media: { ...hostedVideo.media, id: 'd', mime: 'application/pdf', width: 1080, height: null } }],
    })
    assert.equal(draft.media[0]!.kind, 'document')
    assert.equal(draft.media[0]!.width, 1080)
    assert.equal('height' in draft.media[0]!, false)
    assert.equal('overrides' in draft, false)
  })
})
