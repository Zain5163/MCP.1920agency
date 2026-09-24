import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { capabilitiesFor } from '../src/adapters/capabilities.ts'
import { countGraphemes, validateAgainstCapabilities, bodyForPlatform } from '../src/domain/validate.ts'
import type { MediaRef, PostDraft } from '../src/domain/types.ts'

const image = (over: Partial<MediaRef> = {}): MediaRef => ({
  id: 'm1',
  kind: 'image',
  mime: 'image/jpeg',
  bytes: 1000,
  publicUrl: 'https://cdn.example.com/m1.jpg',
  ...over,
})

const video = (over: Partial<MediaRef> = {}): MediaRef => ({
  id: 'v1',
  kind: 'video',
  mime: 'video/mp4',
  bytes: 5000,
  publicUrl: 'https://cdn.example.com/v1.mp4',
  durationSeconds: 30,
  ...over,
})

const draft = (over: Partial<PostDraft> = {}): PostDraft => ({
  body: 'hello world',
  media: [],
  ...over,
})

const errorCodes = (r: { issues: readonly { severity: string; code: string }[] }): string[] =>
  r.issues.filter((i) => i.severity === 'error').map((i) => i.code)

describe('countGraphemes', () => {
  test('counts plain text by character', () => {
    assert.equal(countGraphemes('hello'), 5)
  })

  test('counts a ZWJ emoji family as one character', () => {
    // .length is 11 and [...spread].length is 7, but every platform counts 1.
    assert.equal(countGraphemes('\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'), 1)
  })

  test('counts a flag emoji as one character', () => {
    assert.equal(countGraphemes('\u{1F1F5}\u{1F1F0}'), 1)
  })

  test('counts combining accents as one character', () => {
    assert.equal(countGraphemes('é'), 1)
  })
})

describe('validateAgainstCapabilities', () => {
  test('accepts a simple valid post', () => {
    const result = validateAgainstCapabilities(draft(), 'facebook_page', capabilitiesFor('facebook_page'))
    assert.equal(result.ok, true)
    assert.deepEqual(errorCodes(result), [])
  })

  test('rejects text over the platform limit', () => {
    const result = validateAgainstCapabilities(
      draft({ body: 'a'.repeat(301) }),
      'bluesky',
      capabilitiesFor('bluesky'),
    )
    assert.equal(result.ok, false)
    assert.deepEqual(errorCodes(result), ['text_too_long'])
    assert.match(result.issues[0]!.message, /1 over the 300 limit/)
  })

  test('accepts text exactly at the limit', () => {
    const result = validateAgainstCapabilities(
      draft({ body: 'a'.repeat(300) }),
      'bluesky',
      capabilitiesFor('bluesky'),
    )
    assert.equal(result.ok, true)
  })

  test('rejects a text-only post on Instagram', () => {
    const result = validateAgainstCapabilities(draft(), 'instagram', capabilitiesFor('instagram'))
    assert.equal(result.ok, false)
    assert.ok(errorCodes(result).includes('media_required'))
  })

  test('rejects an entirely empty post', () => {
    const result = validateAgainstCapabilities(
      draft({ body: '   ' }),
      'facebook_page',
      capabilitiesFor('facebook_page'),
    )
    assert.ok(errorCodes(result).includes('empty_post'))
  })

  test('rejects too many media items', () => {
    const result = validateAgainstCapabilities(
      draft({ media: Array.from({ length: 5 }, (_, i) => image({ id: `m${i}` })) }),
      'bluesky',
      capabilitiesFor('bluesky'),
    )
    assert.ok(errorCodes(result).includes('too_many_media'))
  })

  test('rejects mixed image and video where disallowed', () => {
    const result = validateAgainstCapabilities(
      draft({ media: [image(), video()] }),
      'bluesky',
      capabilitiesFor('bluesky'),
    )
    assert.ok(errorCodes(result).includes('mixed_media'))
  })

  test('allows mixed media where the platform permits it', () => {
    const result = validateAgainstCapabilities(
      draft({ body: 'hi', media: [image(), video()] }),
      'instagram',
      capabilitiesFor('instagram'),
    )
    assert.ok(!errorCodes(result).includes('mixed_media'))
  })

  test('rejects a video over the duration limit', () => {
    const result = validateAgainstCapabilities(
      draft({ media: [video({ durationSeconds: 61 })] }),
      'bluesky',
      capabilitiesFor('bluesky'),
    )
    assert.ok(errorCodes(result).includes('video_too_long'))
  })

  test('rejects a video under the minimum duration', () => {
    const result = validateAgainstCapabilities(
      draft({ media: [video({ durationSeconds: 1 })] }),
      'instagram',
      capabilitiesFor('instagram'),
    )
    assert.ok(errorCodes(result).includes('video_too_short'))
  })

  test('warns rather than errors when video duration is unknown', () => {
    const result = validateAgainstCapabilities(
      draft({ media: [video({ durationSeconds: undefined })] }),
      'instagram',
      capabilitiesFor('instagram'),
    )
    assert.ok(!errorCodes(result).includes('video_too_long'))
    assert.ok(result.issues.some((i) => i.severity === 'warning' && i.code === 'unknown_duration'))
  })

  test('rejects images on a video-only platform', () => {
    const result = validateAgainstCapabilities(
      draft({ media: [image()] }),
      'youtube',
      capabilitiesFor('youtube'),
    )
    assert.ok(errorCodes(result).includes('unsupported_media_kind'))
  })

  test('requires https media URLs where the platform fetches media', () => {
    const result = validateAgainstCapabilities(
      draft({ body: 'hi', media: [image({ publicUrl: 'http://cdn.example.com/m1.jpg' })] }),
      'instagram',
      capabilitiesFor('instagram'),
    )
    assert.ok(errorCodes(result).includes('media_not_publicly_hosted'))
  })

  test('does not require https media URLs where the platform accepts uploads', () => {
    const result = validateAgainstCapabilities(
      draft({ media: [image({ publicUrl: 'file:///tmp/m1.jpg' })] }),
      'facebook_page',
      capabilitiesFor('facebook_page'),
    )
    assert.ok(!errorCodes(result).includes('media_not_publicly_hosted'))
  })

  test('rejects a scheduled time in the past', () => {
    const result = validateAgainstCapabilities(
      draft({ scheduledFor: new Date(Date.now() - 60_000) }),
      'facebook_page',
      capabilitiesFor('facebook_page'),
    )
    assert.ok(errorCodes(result).includes('scheduled_in_past'))
  })

  test('validates the per-platform override body, not the shared one', () => {
    const d = draft({
      body: 'a'.repeat(500),
      overrides: { bluesky: { body: 'short version' } },
    })
    assert.equal(bodyForPlatform(d, 'bluesky'), 'short version')
    const result = validateAgainstCapabilities(d, 'bluesky', capabilitiesFor('bluesky'))
    assert.equal(result.ok, true)
  })

  test('reports every problem at once rather than stopping at the first', () => {
    const result = validateAgainstCapabilities(
      draft({
        body: 'a'.repeat(400),
        media: Array.from({ length: 6 }, (_, i) => image({ id: `m${i}` })),
      }),
      'bluesky',
      capabilitiesFor('bluesky'),
    )
    assert.ok(errorCodes(result).length >= 2)
  })
})
