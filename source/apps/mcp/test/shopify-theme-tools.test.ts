import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { draftChanges, draftHash, editDraftFile, safeThemePath, themeJsonError } from '../src/shopify-theme-tools.ts'

/** A tiny theme draft on disk: live/ (the backup) and draft/ (the editable copy). */
function draftOnDisk(): string {
  const root = mkdtempSync(join(tmpdir(), 'theme-'))
  for (const side of ['live', 'draft']) {
    mkdirSync(join(root, side, 'sections'), { recursive: true })
    mkdirSync(join(root, side, 'layout'), { recursive: true })
    writeFileSync(join(root, side, 'sections', 'header-group.json'), '/* auto */\n{"sections":{"bar":{"settings":{"text":"AZADI SALE IS LIVE"}}}}')
    writeFileSync(join(root, side, 'layout', 'theme.liquid'), '<html><body>{{ content_for_layout }}</body></html>')
  }
  return root
}

describe('theme drafts', () => {
  test('a file path must stay inside the theme folders', () => {
    assert.equal(safeThemePath('sections/header-group.json'), 'sections/header-group.json')
    assert.equal(safeThemePath('\\snippets\\x.liquid'), 'snippets/x.liquid')
    for (const bad of ['../../.env', 'sections/../../x', 'config', '/etc/passwd', 'node_modules/x.js', 'sections//x']) {
      assert.ok(typeof safeThemePath(bad) !== 'string', bad)
    }
  })

  test("Shopify's JSON with a leading comment counts as valid; broken JSON does not", () => {
    assert.equal(themeJsonError('/* auto */\n{"a":1}'), undefined)
    assert.ok(themeJsonError('{"a":') !== undefined)
  })

  test('find-and-replace changes exactly one place, and the live backup stays untouched', () => {
    const root = draftOnDisk()
    const r = editDraftFile(root, 'sections/header-group.json', { find: 'AZADI SALE IS LIVE', replace: 'Free delivery on 2 pairs' })
    assert.ok('ok' in r)
    assert.match(readFileSync(join(root, 'draft', 'sections', 'header-group.json'), 'utf8'), /Free delivery on 2 pairs/)
    assert.match(readFileSync(join(root, 'live', 'sections', 'header-group.json'), 'utf8'), /AZADI SALE IS LIVE/)
    assert.deepEqual(draftChanges(root), { changed: ['sections/header-group.json'], added: [], removed: [] })
  })

  test('an edit that would break a JSON file is refused and nothing is written', () => {
    const root = draftOnDisk()
    const r = editDraftFile(root, 'sections/header-group.json', { find: '"text":"AZADI SALE IS LIVE"', replace: '"text":"oops' })
    assert.ok('error' in r && /valid JSON/.test(r.error))
    assert.deepEqual(draftChanges(root).changed, [])
  })

  test('text that is missing, or appears more than once, is refused', () => {
    const root = draftOnDisk()
    assert.ok('error' in editDraftFile(root, 'layout/theme.liquid', { find: 'not there', replace: 'x' }))
    writeFileSync(join(root, 'draft', 'layout', 'theme.liquid'), 'a a')
    const twice = editDraftFile(root, 'layout/theme.liquid', { find: 'a', replace: 'b' })
    assert.ok('error' in twice && /appears 2 times/.test(twice.error))
  })

  test('a new file can be created, and it is listed as added', () => {
    const root = draftOnDisk()
    assert.ok('ok' in editDraftFile(root, 'snippets/trust-badges.liquid', { content: '<div class="badges">COD · Easy exchange</div>' }))
    assert.deepEqual(draftChanges(root).added, ['snippets/trust-badges.liquid'])
  })

  test('the draft fingerprint changes with any edit, so a publish cannot skip the preview', () => {
    const root = draftOnDisk()
    const before = draftHash(root)
    editDraftFile(root, 'layout/theme.liquid', { find: '<body>', replace: '<body class="x">' })
    assert.notEqual(draftHash(root), before)
  })
})

describe('a draft built from another theme (a redesign)', () => {
  test('changes are counted against that theme, not against the live one', () => {
    const root = draftOnDisk()
    // base/ is the theme the draft was built from; the draft starts as its copy.
    mkdirSync(join(root, 'base', 'sections'), { recursive: true })
    writeFileSync(join(root, 'base', 'sections', 'hero.json'), '{"a":1}')
    writeFileSync(join(root, 'draft', 'sections', 'hero.json'), '{"a":1}')
    writeFileSync(join(root, 'base', 'sections', 'header-group.json'), readFileSync(join(root, 'draft', 'sections', 'header-group.json')))
    mkdirSync(join(root, 'base', 'layout'), { recursive: true })
    writeFileSync(join(root, 'base', 'layout', 'theme.liquid'), readFileSync(join(root, 'draft', 'layout', 'theme.liquid')))
    assert.deepEqual(draftChanges(root), { changed: [], added: [], removed: [] })
    assert.ok('ok' in editDraftFile(root, 'sections/hero.json', { find: '1', replace: '2' }))
    assert.deepEqual(draftChanges(root), { changed: ['sections/hero.json'], added: [], removed: [] })
  })
})

describe('theme changes need the owner’s approval', () => {
  test('publish and rollback have their own high-risk policies', async () => {
    const { policyFor } = await import('@social-publisher/core')
    for (const action of ['shopify_theme_publish', 'shopify_theme_rollback']) {
      assert.equal(policyFor(action).risk, 'high', action)
      assert.doesNotMatch(policyFor(action).rationale, /no policy entry/, action)
    }
  })
})
