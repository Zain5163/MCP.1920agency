import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { capabilitiesFor } from '../src/adapters/capabilities.ts'
import { mediaKindForMime } from '../src/domain/media.ts'
import {
  countGraphemes,
  validateAgainstCapabilities,
  bodyForPlatform,
  fieldsSentTo,
  overridesForStorage,
  syntheticMediaForPlatform,
  titleForPlatform,
  titleIsSent,
} from '../src/domain/validate.ts'
import { PLATFORMS, type MediaRef, type PostDraft } from '../src/domain/types.ts'

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

describe('aspect ratio', () => {
  const sized = (w: number, h: number): MediaRef => image({ width: w, height: h })

  test('accepts a square image on Instagram', () => {
    const result = validateAgainstCapabilities(
      draft({ body: 'hi', media: [sized(1080, 1080)] }),
      'instagram',
      capabilitiesFor('instagram'),
    )
    assert.ok(!errorCodes(result).includes('aspect_ratio_unsupported'))
  })

  test('accepts 4:5 portrait and 1.91:1 landscape, the documented bounds', () => {
    for (const [w, h] of [[1080, 1350], [1080, 566]] as const) {
      const result = validateAgainstCapabilities(
        draft({ body: 'hi', media: [sized(w, h)] }),
        'instagram',
        capabilitiesFor('instagram'),
      )
      assert.ok(
        !errorCodes(result).includes('aspect_ratio_unsupported'),
        `${w}x${h} should be accepted`,
      )
    }
  })

  test('rejects a too-tall image', () => {
    // Instagram fails container creation for these with an error that reads like
    // a permissions problem, so catching it here is the whole point.
    const result = validateAgainstCapabilities(
      draft({ body: 'hi', media: [sized(500, 1500)] }),
      'instagram',
      capabilitiesFor('instagram'),
    )
    assert.ok(errorCodes(result).includes('aspect_ratio_unsupported'))
  })

  test('rejects a too-wide image', () => {
    const result = validateAgainstCapabilities(
      draft({ body: 'hi', media: [sized(2000, 500)] }),
      'instagram',
      capabilitiesFor('instagram'),
    )
    assert.ok(errorCodes(result).includes('aspect_ratio_unsupported'))
  })

  test('says what the image is and what the limit is', () => {
    const result = validateAgainstCapabilities(
      draft({ body: 'hi', media: [sized(2000, 500)] }),
      'instagram',
      capabilitiesFor('instagram'),
    )
    const issue = result.issues.find((i) => i.code === 'aspect_ratio_unsupported')!
    assert.match(issue.message, /2000x500/)
    assert.match(issue.message, /4\.00:1/)
  })

  test('warns rather than blocking when dimensions are unknown', () => {
    // A wrongly-rejected valid post is worse than a late failure.
    const result = validateAgainstCapabilities(
      draft({ body: 'hi', media: [image()] }),
      'instagram',
      capabilitiesFor('instagram'),
    )
    assert.ok(!errorCodes(result).includes('aspect_ratio_unsupported'))
    assert.ok(result.issues.some((i) => i.code === 'unknown_dimensions'))
  })

  test('does not apply to platforms with no declared range', () => {
    const result = validateAgainstCapabilities(
      draft({ media: [sized(4000, 200)] }),
      'facebook_page',
      capabilitiesFor('facebook_page'),
    )
    assert.ok(!errorCodes(result).includes('aspect_ratio_unsupported'))
  })
})

describe('per-platform overrides end to end', () => {
  test('each platform validates against its own text', () => {
    // The point of overrides: a long Facebook caption must not make an Instagram
    // post invalid when Instagram has its own shorter one.
    const d = draft({
      body: 'a'.repeat(2500),
      media: [image()],
      overrides: { instagram: { body: 'short and punchy' } },
    })

    const ig = validateAgainstCapabilities(d, 'instagram', capabilitiesFor('instagram'))
    assert.equal(ig.ok, true, 'Instagram should validate against its override')

    const fb = validateAgainstCapabilities(d, 'facebook_page', capabilitiesFor('facebook_page'))
    assert.equal(fb.ok, true, 'Facebook allows the long shared text')
  })

  test('an override that is itself too long still fails', () => {
    const d = draft({
      body: 'fine',
      media: [image()],
      overrides: { instagram: { body: 'x'.repeat(2500) } },
    })
    const result = validateAgainstCapabilities(d, 'instagram', capabilitiesFor('instagram'))
    assert.equal(result.ok, false)
    assert.ok(errorCodes(result).includes('text_too_long'))
  })

  test('a platform with no override falls back to the shared text', () => {
    const d = draft({
      body: 'shared',
      media: [image()],
      overrides: { instagram: { body: 'instagram only' } },
    })
    assert.equal(bodyForPlatform(d, 'instagram'), 'instagram only')
    assert.equal(bodyForPlatform(d, 'facebook_page'), 'shared')
  })
})

describe('titles', () => {
  test('a titled platform declares how long its title may be', () => {
    // The UI shows a title field from this number, never from a platform name.
    assert.equal(capabilitiesFor('youtube').titleMaxLength, 100)
    assert.equal(capabilitiesFor('facebook_page').titleMaxLength, undefined)
  })

  test('the platform override wins over the draft title', () => {
    const d = draft({ title: 'Shared', overrides: { youtube: { title: 'Own' } } })
    assert.equal(titleForPlatform(d, 'youtube'), 'Own')
    assert.equal(titleForPlatform(d, 'pinterest'), 'Shared')
  })

  test('a blank title is no title, so a blank override cannot hide the real one', () => {
    // Forms and AI callers send '' for an empty field.
    assert.equal(titleForPlatform(draft({ title: '   ' }), 'youtube'), undefined)
    const d = draft({ title: 'Real', overrides: { youtube: { title: '' } } })
    assert.equal(titleForPlatform(d, 'youtube'), 'Real')
  })

  test('surrounding whitespace is dropped', () => {
    assert.equal(titleForPlatform(draft({ title: '  Hello  ' }), 'youtube'), 'Hello')
  })

  test('rejects a title over the platform limit', () => {
    const result = validateAgainstCapabilities(
      draft({ title: 'a'.repeat(101), media: [video()] }),
      'youtube',
      capabilitiesFor('youtube'),
    )
    assert.ok(errorCodes(result).includes('title_too_long'))
    assert.match(result.issues.find((i) => i.code === 'title_too_long')!.message, /1 over the 100 limit/)
  })

  test('accepts a title exactly at the limit', () => {
    const result = validateAgainstCapabilities(
      draft({ title: 'a'.repeat(100), media: [video()] }),
      'youtube',
      capabilitiesFor('youtube'),
    )
    assert.ok(!errorCodes(result).includes('title_too_long'))
  })

  test('counts a title in graphemes, like the body', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'
    const result = validateAgainstCapabilities(
      draft({ title: family.repeat(100), media: [video()] }),
      'youtube',
      capabilitiesFor('youtube'),
    )
    assert.ok(!errorCodes(result).includes('title_too_long'))
  })

  test('a platform with no title field ignores a long title', () => {
    const result = validateAgainstCapabilities(
      draft({ title: 'a'.repeat(500) }),
      'facebook_page',
      capabilitiesFor('facebook_page'),
    )
    assert.equal(result.ok, true)
  })

  test('a missing title is not an error here; the adapter decides the fallback', () => {
    const result = validateAgainstCapabilities(draft({ media: [video()] }), 'youtube', capabilitiesFor('youtube'))
    assert.ok(!errorCodes(result).includes('title_too_long'))
  })

  test('LinkedIn sends a title only with a document; every YouTube video has one; Facebook never', () => {
    const pdf: MediaRef = { id: 'd', kind: 'document', mime: 'application/pdf', bytes: 9, localPath: 'c.pdf' }
    const linkedin = capabilitiesFor('linkedin')
    assert.equal(titleIsSent(draft({ title: 'T', media: [pdf] }), linkedin), true)
    for (const media of [[], [image()], [video()]]) {
      assert.equal(titleIsSent(draft({ title: 'T', media }), linkedin), false, `${media[0]?.kind ?? 'text'} post`)
    }
    assert.equal(titleIsSent(draft({ title: 'T', media: [video()] }), capabilitiesFor('youtube')), true)
    assert.equal(titleIsSent(draft({ title: 'T', media: [image()] }), capabilitiesFor('facebook_page')), false)
  })

  test('a title that is never sent is never too long', () => {
    // A LinkedIn text, image or video post drops the title, so its length
    // cannot be a reason to refuse the post, as it was before documents existed.
    for (const media of [[], [image({ localPath: 'a.jpg' })], [video({ localPath: 'a.mp4' })]]) {
      const result = validateAgainstCapabilities(
        draft({ title: 'a'.repeat(201), media }),
        'linkedin',
        capabilitiesFor('linkedin'),
      )
      assert.ok(!errorCodes(result).includes('title_too_long'), `${media[0]?.kind ?? 'text'} post`)
    }
  })
})

describe('AI disclosure', () => {
  test('defaults to an explicit false, never undefined', () => {
    assert.equal(syntheticMediaForPlatform(draft(), 'youtube'), false)
  })

  test('the draft flag applies everywhere, and an override wins for its platform', () => {
    const d = draft({ syntheticMedia: true, overrides: { instagram: { syntheticMedia: false } } })
    assert.equal(syntheticMediaForPlatform(d, 'youtube'), true)
    assert.equal(syntheticMediaForPlatform(d, 'instagram'), false)
  })

  test('only YouTube sends the declaration, so only its capability says so', () => {
    const telling = PLATFORMS.filter((p) => capabilitiesFor(p).sendsSyntheticMediaDisclosure === true)
    assert.deepEqual(telling, ['youtube'])
  })

  test('declared for a platform that is not told: a warning there, never an error', () => {
    for (const platform of ['facebook_page', 'instagram', 'linkedin'] as const) {
      const result = validateAgainstCapabilities(
        draft({ syntheticMedia: true, media: [image({ width: 1080, height: 1080 })] }),
        platform,
        capabilitiesFor(platform),
      )
      const issue = result.issues.find((i) => i.code === 'synthetic_media_not_sent')
      assert.ok(issue !== undefined, `${platform} should warn`)
      assert.equal(issue.severity, 'warning')
      assert.equal(issue.platform, platform)
      assert.match(issue.message, /does not send that declaration/)
      assert.match(issue.message, /Label it in the platform's app/)
      assert.equal(result.ok, true, `${platform}: the post itself is still valid`)
    }
  })

  test('YouTube, which is told, gets no such warning', () => {
    const result = validateAgainstCapabilities(
      draft({ syntheticMedia: true, media: [video()] }),
      'youtube',
      capabilitiesFor('youtube'),
    )
    assert.ok(!result.issues.some((i) => i.code === 'synthetic_media_not_sent'))
  })

  test('nothing to warn about when nothing is declared, or an override withdraws it', () => {
    const caps = capabilitiesFor('instagram')
    const media = [image({ width: 1080, height: 1080 })]
    for (const d of [
      draft({ media }),
      draft({ media, syntheticMedia: false }),
      draft({ media, syntheticMedia: true, overrides: { instagram: { syntheticMedia: false } } }),
    ]) {
      assert.ok(!validateAgainstCapabilities(d, 'instagram', caps).issues.some((i) => i.code === 'synthetic_media_not_sent'))
    }
  })
})

describe('what each platform is sent', () => {
  const pdf: MediaRef = { id: 'd', kind: 'document', mime: 'application/pdf', bytes: 9, localPath: 'c.pdf' }

  test('a cross-post says where the declaration goes and where it does not', () => {
    const sent = fieldsSentTo(draft({ title: 'Launch', syntheticMedia: true, media: [video()] }), [
      'youtube',
      'facebook_page',
      'linkedin',
    ])
    assert.deepEqual(sent.titles, [{ platform: 'youtube', title: 'Launch' }])
    assert.deepEqual(sent.disclosedTo, ['youtube'])
    assert.deepEqual(sent.notDisclosedTo, ['facebook_page', 'linkedin'])
  })

  test('an Instagram-only post shows no title and is declared nowhere', () => {
    // The approval summary for exactly this post said "Title: Launch" and
    // "Declared as realistic AI-generated or altered media.".
    const sent = fieldsSentTo(draft({ title: 'Launch', syntheticMedia: true, media: [image()] }), ['instagram'])
    assert.deepEqual(sent, { titles: [], disclosedTo: [], notDisclosedTo: ['instagram'] })
  })

  test('a LinkedIn document carries its title; a LinkedIn text post does not', () => {
    assert.deepEqual(fieldsSentTo(draft({ title: 'Carousel', media: [pdf] }), ['linkedin']).titles, [
      { platform: 'linkedin', title: 'Carousel' },
    ])
    assert.deepEqual(fieldsSentTo(draft({ title: 'Carousel' }), ['linkedin']).titles, [])
  })

  test('each platform once, however many of its accounts are targeted', () => {
    const sent = fieldsSentTo(draft({ title: 'T', syntheticMedia: true, media: [video()] }), [
      'youtube',
      'instagram',
      'youtube',
      'instagram',
    ])
    assert.deepEqual(sent.titles, [{ platform: 'youtube', title: 'T' }])
    assert.deepEqual(sent.disclosedTo, ['youtube'])
    assert.deepEqual(sent.notDisclosedTo, ['instagram'])
  })

  test("a platform's own title and declaration are the ones reported", () => {
    const d = draft({
      title: 'Shared',
      syntheticMedia: true,
      media: [video()],
      overrides: { youtube: { title: 'Own' }, facebook_page: { syntheticMedia: false } },
    })
    const sent = fieldsSentTo(d, ['youtube', 'facebook_page', 'linkedin'])
    assert.deepEqual(sent.titles, [{ platform: 'youtube', title: 'Own' }])
    assert.deepEqual(sent.notDisclosedTo, ['linkedin'])
  })

  test('nothing set, nothing listed; a blank title is no title', () => {
    assert.deepEqual(fieldsSentTo(draft({ media: [video()] }), ['youtube', 'instagram']), {
      titles: [],
      disclosedTo: [],
      notDisclosedTo: [],
    })
    assert.deepEqual(fieldsSentTo(draft({ title: '  ', media: [video()] }), ['youtube']).titles, [])
  })

  test('it reads capabilities, never platform names: a caller may supply its own', () => {
    const telling = (platform: (typeof PLATFORMS)[number]) => ({
      ...capabilitiesFor(platform),
      sendsSyntheticMediaDisclosure: true,
    })
    const sent = fieldsSentTo(draft({ syntheticMedia: true, media: [image()] }), ['instagram'], telling)
    assert.deepEqual(sent.disclosedTo, ['instagram'])
    assert.deepEqual(sent.notDisclosedTo, [])
  })
})

describe('overrides stored with a scheduled post', () => {
  test('a plain post stores nothing', () => {
    assert.equal(overridesForStorage(draft(), ['youtube', 'facebook_page']), undefined)
  })

  test('the title and disclosure are copied into every target platform', () => {
    // There is no title column, so this is how the worker gets them back.
    const stored = overridesForStorage(draft({ title: 'T', syntheticMedia: true }), ['youtube', 'linkedin'])
    assert.deepEqual(stored, {
      youtube: { title: 'T', syntheticMedia: true },
      linkedin: { title: 'T', syntheticMedia: true },
    })
  })

  test("a platform's own override still wins, and other overrides are kept", () => {
    const d = draft({
      title: 'Shared',
      overrides: { youtube: { title: 'Own', body: 'yt text' }, bluesky: { body: 'short' } },
    })
    const stored = overridesForStorage(d, ['youtube'])!
    assert.deepEqual(stored.youtube, { title: 'Own', body: 'yt text' })
    assert.deepEqual(stored.bluesky, { body: 'short' })
  })

  test('rebuilding a draft from what was stored resolves the same title and disclosure', () => {
    // Exactly what the worker does: body, media and overrides, nothing else.
    const original = draft({ title: 'Launch day', syntheticMedia: true })
    const stored = overridesForStorage(original, ['youtube'])
    const rebuilt: PostDraft = { body: original.body, media: [], ...(stored !== undefined ? { overrides: stored } : {}) }
    assert.equal(titleForPlatform(rebuilt, 'youtube'), 'Launch day')
    assert.equal(syntheticMediaForPlatform(rebuilt, 'youtube'), true)
  })
})

describe('documents', () => {
  const pdf = (over: Partial<MediaRef> = {}): MediaRef => ({
    id: 'd1',
    kind: 'document',
    mime: 'application/pdf',
    bytes: 1_672_687,
    localPath: 'D:/assets/carousel.pdf',
    ...over,
  })

  test('only LinkedIn takes documents', () => {
    const taking = PLATFORMS.filter((p) => capabilitiesFor(p).mediaKinds.includes('document'))
    assert.deepEqual(taking, ['linkedin'])
  })

  test('LinkedIn takes one document on its own', () => {
    const result = validateAgainstCapabilities(draft({ media: [pdf()] }), 'linkedin', capabilitiesFor('linkedin'))
    assert.equal(result.ok, true)
    assert.deepEqual(errorCodes(result), [])
  })

  test('every other platform refuses a document', () => {
    for (const platform of PLATFORMS.filter((p) => p !== 'linkedin')) {
      const result = validateAgainstCapabilities(
        draft({ media: [pdf({ publicUrl: 'https://cdn.example.com/d1.pdf' })] }),
        platform,
        capabilitiesFor(platform),
      )
      assert.equal(result.ok, false, `${platform} should refuse a document`)
      assert.ok(errorCodes(result).includes('unsupported_media_kind'), `${platform}: ${errorCodes(result).join(', ')}`)
      assert.ok(!errorCodes(result).includes('too_many_documents'), `${platform}: the document rules are LinkedIn's only`)
    }
  })

  test('two documents in one post are refused', () => {
    const result = validateAgainstCapabilities(
      draft({ media: [pdf({ id: 'a' }), pdf({ id: 'b' })] }),
      'linkedin',
      capabilitiesFor('linkedin'),
    )
    assert.ok(errorCodes(result).includes('too_many_documents'))
    assert.match(result.issues.find((i) => i.code === 'too_many_documents')!.message, /carries one/)
  })

  test('a document with an image or a video is refused as mixed media', () => {
    for (const other of [image({ localPath: 'a.jpg' }), video({ localPath: 'a.mp4' })]) {
      const result = validateAgainstCapabilities(draft({ media: [pdf(), other] }), 'linkedin', capabilitiesFor('linkedin'))
      assert.ok(errorCodes(result).includes('mixed_media'), `with ${other.kind}`)
      assert.ok(!errorCodes(result).includes('unsupported_media_kind'))
      assert.match(result.issues.find((i) => i.code === 'mixed_media')!.message, /document is posted on its own/)
    }
  })

  test('images with video keep the message they always had', () => {
    const result = validateAgainstCapabilities(draft({ media: [image(), video()] }), 'bluesky', capabilitiesFor('bluesky'))
    assert.equal(result.issues.find((i) => i.code === 'mixed_media')!.message, 'Images and video cannot be combined in one post here.')
  })

  test('a document over 100 MB is refused, and one exactly at it is not', () => {
    const over = validateAgainstCapabilities(
      draft({ media: [pdf({ bytes: 100_000_001 })] }),
      'linkedin',
      capabilitiesFor('linkedin'),
    )
    assert.ok(errorCodes(over).includes('document_too_large'))
    assert.match(over.issues.find((i) => i.code === 'document_too_large')!.message, /over the 100 MB limit/)

    const at = validateAgainstCapabilities(draft({ media: [pdf({ bytes: 100_000_000 })] }), 'linkedin', capabilitiesFor('linkedin'))
    assert.ok(!errorCodes(at).includes('document_too_large'))
  })

  test('a document needs a file or a URL to upload from', () => {
    const result = validateAgainstCapabilities(
      draft({ media: [pdf({ localPath: undefined })] }),
      'linkedin',
      capabilitiesFor('linkedin'),
    )
    assert.ok(errorCodes(result).includes('media_source_missing'))
  })

  test('a document title is held to LinkedIn\'s 200, like any title', () => {
    const result = validateAgainstCapabilities(
      draft({ title: 'a'.repeat(201), media: [pdf()] }),
      'linkedin',
      capabilitiesFor('linkedin'),
    )
    assert.ok(errorCodes(result).includes('title_too_long'))
  })
})

describe('mediaKindForMime', () => {
  test('a PDF is a document', () => {
    assert.equal(mediaKindForMime('application/pdf'), 'document')
  })

  test('case and parameters do not change the answer', () => {
    assert.equal(mediaKindForMime('Application/PDF; charset=binary'), 'document')
    assert.equal(mediaKindForMime(' VIDEO/MP4 '), 'video')
  })

  test('the Word and PowerPoint formats are documents too', () => {
    for (const mime of [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]) {
      assert.equal(mediaKindForMime(mime), 'document', mime)
    }
  })

  test('video is video and images are images, as the worker always mapped them', () => {
    assert.equal(mediaKindForMime('video/mp4'), 'video')
    assert.equal(mediaKindForMime('video/quicktime'), 'video')
    assert.equal(mediaKindForMime('image/png'), 'image')
    assert.equal(mediaKindForMime('image/jpeg'), 'image')
  })

  test('anything unrecognised stays an image, the old fallback', () => {
    assert.equal(mediaKindForMime('application/octet-stream'), 'image')
    assert.equal(mediaKindForMime(''), 'image')
  })
})
