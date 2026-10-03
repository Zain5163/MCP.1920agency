import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import type { MediaRef } from '@social-publisher/core'

import { fieldsSentLines } from '../src/fields-sent.ts'

/**
 * Finding #4: `post --synthetic` printed "Declared as realistic AI-generated
 * or altered media." and then PUBLISHED for a Facebook image, which Meta is
 * never told; "Title:" was printed for platforms that drop it.
 */

const image: MediaRef = { id: 'i', kind: 'image', mime: 'image/jpeg', bytes: 1, localPath: 'D:/ai.jpg' }
const video: MediaRef = { id: 'v', kind: 'video', mime: 'video/mp4', bytes: 1, localPath: 'D:/clip.mp4' }
const pdf: MediaRef = { id: 'd', kind: 'document', mime: 'application/pdf', bytes: 1, localPath: 'D:/c.pdf' }

describe('post says per platform where the title and the AI declaration go', () => {
  test("the reviewers' case: a Facebook image with --synthetic is not declared there", () => {
    const lines = fieldsSentLines({ body: 'x', media: [image], syntheticMedia: true }, ['facebook_page'])
    assert.deepEqual(lines.declaration, [
      'NOT declared on facebook_page: their API takes no such declaration, so label it in the app.',
    ])
  })

  test('declared and titled on YouTube, and the platforms that are not are named', () => {
    const lines = fieldsSentLines(
      { body: 'x', media: [video], title: 'Launch', syntheticMedia: true },
      ['youtube', 'instagram', 'youtube'],
    )
    assert.deepEqual(lines.titles, ['Title on youtube: Launch', 'No title on instagram: it takes none for this post.'])
    assert.deepEqual(lines.declaration, [
      'Declared as realistic AI-generated or altered media on: youtube',
      'NOT declared on instagram: their API takes no such declaration, so label it in the app.',
    ])
  })

  test('a LinkedIn document is titled; a LinkedIn image post is not', () => {
    assert.deepEqual(fieldsSentLines({ body: 'x', media: [pdf], title: 'Five steps' }, ['linkedin']).titles, [
      'Title on linkedin: Five steps',
    ])
    assert.deepEqual(fieldsSentLines({ body: 'x', media: [image], title: 'Five steps' }, ['linkedin']).titles, [
      'No title on linkedin: it takes none for this post.',
    ])
  })

  test('no title and no declaration given: nothing is printed', () => {
    assert.deepEqual(fieldsSentLines({ body: 'x', media: [video] }, ['youtube', 'facebook_page']), {
      titles: [],
      declaration: [],
    })
  })
})
