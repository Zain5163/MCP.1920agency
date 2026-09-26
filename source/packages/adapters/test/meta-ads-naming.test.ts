import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  META_DEFAULT_NAMING,
  META_UTM_TEMPLATE,
  adName,
  adSetName,
  campaignName,
  slug,
  urlTags,
} from '../src/meta-ads-naming.ts'

describe('slugs', () => {
  test('lowercases and joins words with hyphens', () => {
    assert.equal(slug('Q4 Sales Push!'), 'q4-sales-push')
  })

  test('never leaves a trailing hyphen after truncation', () => {
    // 'video-editing-' would read as an unfinished name in every report row.
    assert.equal(slug('video editing services', 14), 'video-editing')
  })

  test('collapses runs of punctuation rather than leaving gaps', () => {
    assert.equal(slug('a --- b'), 'a-b')
  })

  test('survives a string with nothing usable in it', () => {
    assert.equal(slug('!!!'), '')
  })
})

describe('campaign names', () => {
  test('drops the OUTCOME_ prefix, which is noise in every row', () => {
    const name = campaignName(
      META_DEFAULT_NAMING.campaign,
      'Q4 Sales Push',
      'OUTCOME_SALES',
      new Date('2026-09-27T00:00:00Z'),
    )
    assert.equal(name, 'SALES|q4-sales-push|2026-09-27')
  })

  test('takes the date as an argument so the name is testable', () => {
    const a = campaignName(META_DEFAULT_NAMING.campaign, 'x', 'OUTCOME_LEADS', new Date('2026-01-01'))
    const b = campaignName(META_DEFAULT_NAMING.campaign, 'x', 'OUTCOME_LEADS', new Date('2026-06-01'))
    assert.notEqual(a, b)
  })
})

describe('ad set names', () => {
  test('distinguishes broad from targeted, which is what you compare', () => {
    const broad = adSetName(META_DEFAULT_NAMING.adSet, {
      countries: ['GB'],
      optimizationGoal: 'OFFSITE_CONVERSIONS',
    })
    const targeted = adSetName(META_DEFAULT_NAMING.adSet, {
      countries: ['GB'],
      interests: ['Marketing'],
      optimizationGoal: 'OFFSITE_CONVERSIONS',
    })

    assert.equal(broad, 'broad|GB|OFFSITE_CONVERSIONS')
    assert.equal(targeted, 'targeted|GB|OFFSITE_CONVERSIONS')
  })

  test('a name someone chose is never overwritten', () => {
    assert.equal(
      adSetName(META_DEFAULT_NAMING.adSet, { given: 'My audience', countries: ['GB'] }),
      'My audience',
    )
  })

  test('says "unset" rather than leaving a blank in the name', () => {
    assert.match(adSetName(META_DEFAULT_NAMING.adSet, { countries: [] }), /unset\|unset/)
  })
})

describe('ad names', () => {
  test('builds a concept from the headline', () => {
    assert.equal(
      adName(META_DEFAULT_NAMING.ad, { headline: 'Stop Losing Leads', kind: 'image', index: 0 }),
      'stop-losing-leads|image|v1',
    )
  })

  test('numbers iterations from one, not zero', () => {
    assert.match(adName(META_DEFAULT_NAMING.ad, { kind: 'video', index: 2 }), /v3$/)
  })
})

describe('UTM tags', () => {
  test("keeps Meta's placeholders literal — they are filled at click time", () => {
    // Interpolating these on our side would freeze the names at creation and
    // break the moment anything is renamed.
    assert.match(META_UTM_TEMPLATE, /\{\{campaign\.name\}\}/)
    assert.match(META_UTM_TEMPLATE, /\{\{adset\.name\}\}/)
    assert.match(META_UTM_TEMPLATE, /\{\{ad\.name\}\}/)
    assert.ok(!META_UTM_TEMPLATE.includes('undefined'))
  })

  test('uses the template when nothing was specified', () => {
    assert.equal(urlTags(undefined), META_UTM_TEMPLATE)
  })

  test('an explicit EMPTY string is honoured, not overridden', () => {
    // Someone deliberately turning attribution off is a decision, not a gap.
    assert.equal(urlTags(''), '')
  })

  test('explicit tags win', () => {
    assert.equal(urlTags('utm_source=newsletter'), 'utm_source=newsletter')
  })
})
