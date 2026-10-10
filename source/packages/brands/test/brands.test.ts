import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { contrastRatio, minimumFor } from '../src/contrast.ts'
import { BRANDS_ROOT, SCHEMA_PATH, displayName, loadBrands, splitGuidelines, wordmarkText } from '../src/load.ts'
import { SECTIONS } from '../src/sections.ts'
import type { Brand } from '../src/types.ts'
import { validateMeaning, validateSchema } from '../src/validate.ts'

/**
 * The four brands in the repository, checked the way the server checks them
 * at start-up, plus the facts that make each one trustworthy: imported values
 * equal their sources, proposed values say so, and no pair used for text fails
 * WCAG.
 */

const brands = loadBrands()
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>
const raw = (slug: string): Record<string, unknown> => JSON.parse(readFileSync(join(BRANDS_ROOT, slug, 'brand.json'), 'utf8'))
const brand = (slug: string): Brand => brands.get(slug)!.brand
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('every brand loads and validates', () => {
  test('finds exactly the four brands', () => {
    assert.deepEqual([...brands.keys()], ['1920-agency', 'muzaree', 'product', 'psx-ascend'])
  })

  for (const slug of ['1920-agency', 'muzaree', 'product', 'psx-ascend']) {
    test(`${slug}: brand.json matches the schema`, () => {
      assert.deepEqual(validateSchema(raw(slug), schema), [])
    })
    test(`${slug}: every source, reference and contrast pair checks out`, () => {
      assert.deepEqual(validateMeaning(brand(slug)), [])
    })
    test(`${slug}: guidelines.md has every section, and only those`, () => {
      const { sections, unknown } = splitGuidelines(brands.get(slug)!.guidelinesText)
      for (const s of SECTIONS) assert.ok((sections[s.id] ?? '').length > 40, `${slug} guidelines: "${s.title}" is missing or empty`)
      assert.deepEqual(unknown, [])
    })
  }
})

describe('the schema validator is not vacuous', () => {
  const base = raw('1920-agency')

  test('refuses an unknown field', () => {
    const b = { ...clone(base), colour: [] }
    assert.ok(validateSchema(b, schema).some((i) => /not a known field/.test(i.message)))
  })
  test('refuses a malformed hex colour', () => {
    const b = clone(base) as { colors: Array<{ hex: string }> }
    b.colors[0]!.hex = '#0d0c10'
    assert.ok(validateSchema(b, schema).some((i) => i.path === '$.colors[0].hex'))
  })
  test('refuses a missing required section', () => {
    const b = clone(base)
    delete b.voice
    assert.ok(validateSchema(b, schema).some((i) => /missing "voice"/.test(i.message)))
  })
  test('refuses a value outside an enum', () => {
    const b = clone(base) as { status: string }
    b.status = 'approved'
    assert.ok(validateSchema(b, schema).some((i) => i.path === '$.status'))
  })
  test('refuses CSS that could break out of a style attribute', () => {
    const b = clone(base) as { gradients: Array<{ css: string }> }
    b.gradients[0]!.css = 'red;} body{display:none'
    assert.ok(validateSchema(b, schema).some((i) => i.path === '$.gradients[0].css'))
  })
  test('refuses an asset path that leaves the brand folder', () => {
    const b = clone(base) as { logo: { files: Array<{ path: string }> } }
    b.logo.files[0]!.path = 'assets/../../secret.png'
    assert.ok(validateSchema(b, schema).some((i) => i.path === '$.logo.files[0].path'))
  })
  test('throws on a schema keyword it does not enforce, rather than ignoring it', () => {
    assert.throws(() => validateSchema('x', { type: 'string', format: 'email' }), /does not enforce/)
  })
})

describe('the meaning checks are not vacuous', () => {
  const base = brand('1920-agency')

  test('a value from an undeclared source fails', () => {
    const b = clone(base) as { colors: Array<{ source: string }> }
    b.colors[0]!.source = 'somewhere'
    assert.ok(validateMeaning(b as unknown as Brand).some((i) => /not in sources/.test(i.message)))
  })
  test('a pair that names a missing colour fails', () => {
    const b = clone(base) as { contrastPairs: Array<{ fg: string }> }
    b.contrastPairs[0]!.fg = 'nope'
    assert.ok(validateMeaning(b as unknown as Brand).some((i) => /not in colors/.test(i.message)))
  })
  test('a text pair under 4.5:1 fails', () => {
    const b = clone(base) as { contrastPairs: Array<{ fg: string; bg: string; use: string; documentedRatio?: number }> }
    b.contrastPairs.push({ fg: 'violet', bg: 'onyx', use: 'text' } as never)
    assert.ok(validateMeaning(b as unknown as Brand).some((i) => /under the 4.5:1 WCAG minimum/.test(i.message)))
  })
  test('a documented ratio that the colours do not give fails', () => {
    const b = clone(base) as { contrastPairs: Array<{ documentedRatio?: number }> }
    b.contrastPairs[0]!.documentedRatio = 12
    assert.ok(validateMeaning(b as unknown as Brand).some((i) => /documents 12:1/.test(i.message)))
  })
  test('an "avoid" pair that actually passes must be explained', () => {
    const b = clone(base) as { contrastPairs: Array<Record<string, unknown>> }
    b.contrastPairs.push({ fg: 'white', bg: 'onyx', use: 'avoid', source: 'guide' })
    assert.ok(validateMeaning(b as unknown as Brand).some((i) => /marked avoid but passes/.test(i.message)))
  })
  test('a component label that is hard to read fails', () => {
    const b = clone(base) as { components: Array<{ style: { color: string } }> }
    b.components[2]!.style.color = 'surface-alt'
    assert.ok(validateMeaning(b as unknown as Brand).some((i) => /under 4.5:1 for a label/.test(i.message)))
  })
  test('a brand without 1:1, 4:5 and 9:16 placements fails', () => {
    const b = clone(base) as { adCreatives: { placements: unknown[] } }
    b.adCreatives.placements = b.adCreatives.placements.slice(0, 2)
    assert.ok(validateMeaning(b as unknown as Brand).some((i) => /needs a 9:16 placement/.test(i.message)))
  })
  test('a sample that uses a forbidden word fails', () => {
    const b = clone(base) as { adCreatives: { sample: { cta: string } } }
    b.adCreatives.sample.cta = 'Try AdsPilot'
    assert.ok(validateMeaning(b as unknown as Brand).some((i) => /never puts on a creative/.test(i.message)))
  })
})

describe('WCAG contrast', () => {
  test('computes the reference values', () => {
    assert.equal(contrastRatio('#FFFFFF', '#000000').toFixed(2), '21.00')
    assert.equal(contrastRatio('#FFFFFF', '#FFFFFF').toFixed(2), '1.00')
    // Order does not matter.
    assert.equal(contrastRatio('#0D0C10', '#C77DFF'), contrastRatio('#C77DFF', '#0D0C10'))
  })

  for (const [slug, loaded] of brands) {
    test(`${slug}: every pair used for text, large text or controls meets its WCAG minimum`, () => {
      const hex = new Map(loaded.brand.colors.map((c) => [c.id, c.hex]))
      let checked = 0
      for (const pair of loaded.brand.contrastPairs) {
        const min = minimumFor(pair.use)
        const ratio = contrastRatio(hex.get(pair.fg)!, hex.get(pair.bg)!)
        if (min !== undefined) {
          checked++
          assert.ok(ratio >= min, `${slug}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1 < ${min}:1 (${pair.use})`)
        }
        if (pair.use === 'avoid') assert.ok(ratio < 4.5, `${slug}: ${pair.fg} on ${pair.bg} is marked avoid but passes`)
      }
      assert.ok(checked >= 4, `${slug}: only ${checked} pairs are checked`)
    })

    test(`${slug}: the ad's text and accent colours are readable on its canvas`, () => {
      const b = loaded.brand
      const canvas = b.colors.find((c) => c.id === b.adCreatives.style.background)?.hex ??
        // A gradient canvas: check against the solid colour it ends on.
        /#[0-9A-F]{6}\s*$/i.exec(b.gradients.find((g) => g.id === b.adCreatives.style.background)!.css)?.[0]?.trim()
      assert.ok(canvas !== undefined, `${slug}: the ad canvas has no solid base colour`)
      for (const key of ['text', 'accent'] as const) {
        const fg = b.colors.find((c) => c.id === b.adCreatives.style[key])!.hex
        assert.ok(contrastRatio(fg, canvas) >= 4.5, `${slug}: ad ${key} ${fg} on ${canvas} is ${contrastRatio(fg, canvas).toFixed(2)}:1`)
      }
    })
  }
})

describe('1920 Agency is imported faithfully', () => {
  const b = brand('1920-agency')
  const hex = (id: string) => b.colors.find((c) => c.id === id)?.hex

  test('the four authoritative colours are exactly the guide’s', () => {
    assert.equal(hex('onyx'), '#0D0C10')
    assert.equal(hex('violet'), '#7B2CBF')
    assert.equal(hex('amethyst'), '#C77DFF')
    assert.equal(hex('white'), '#FFFFFF')
  })
  test('the guide’s documented contrast ratios are reproduced', () => {
    const documented = b.contrastPairs.filter((p) => p.documentedRatio !== undefined)
    assert.equal(documented.length, 4)
  })
  test('the logo files are the untouched originals (checksums from the kit’s sources.json)', () => {
    const fromKit: Record<string, string> = {
      'primary-white': '05d9cfe316b2b027045a4e14c876952f0cc80a6d4a7ca753f47bf6492b31dd07',
      'alternate-purple': 'f4de0247d6e943d6f89c3f87bb18c2f7019326e37f3b24bfd4fb8183b4bf380f',
      'compact-square': '04d46ce6eaf197f0283e002d215adbf17283e4289edff2fc291af20400b7e79c',
    }
    for (const f of b.logo.files) assert.equal(f.sha256, fromKit[f.id], f.id)
  })
  test('Manrope is the one family; Social-Render’s personal-brand palette is not imported', () => {
    assert.deepEqual(b.typography.families.map((f) => f.name), ['Manrope'])
    for (const personal of ['#14D1C8', '#44E0FA', '#081B2D']) assert.ok(!b.colors.some((c) => c.hex === personal), personal)
  })
})

describe('PSX Ascend keeps its logo rule', () => {
  const b = brand('psx-ascend')

  test('only the original logo file, and no placeholder or typeset wordmark', () => {
    assert.deepEqual(b.logo.files.map((f) => f.path), ['assets/psx-ascend-logo.webp'])
    assert.equal(b.logo.placeholder, undefined)
    assert.ok(b.logo.dont.some((d) => /two colours/.test(d)))
  })
  test('v2 colours are exactly the approved baseline', () => {
    const expected: Record<string, string> = { ink: '#0B1710', forest: '#07130D', green: '#62D044', paper: '#FBFCF8', muted: '#607066', line: '#DCE3DB' }
    for (const [id, value] of Object.entries(expected)) assert.equal(b.colors.find((c) => c.id === id)?.hex, value, id)
  })
  test('publishing needs Jeff, Dan and Rick’s review', () => {
    for (const name of ['Jeff', 'Dan', 'Rick']) assert.ok(b.approval.approvers.some((a) => a.startsWith(name)), name)
    assert.match(b.approval.rule, /before it goes live/)
  })
  test('the v3 candidate and social toolkit are marked proposed, not imported', () => {
    for (const id of ['psx-v3', 'psx-handbook', 'psx-social']) assert.equal(b.sources.find((s) => s.id === id)?.kind, 'proposed', id)
  })
})

describe('proposed brands say so', () => {
  test('Muzaree is proposed, every colour is a proposal, and its logos are the real store files', () => {
    const b = brand('muzaree')
    assert.equal(b.status, 'proposed')
    const kinds = new Map(b.sources.map((s) => [s.id, s.kind]))
    for (const c of b.colors) assert.equal(kinds.get(c.source), 'proposed', c.id)
    for (const f of b.logo.files) assert.equal(kinds.get(f.source), 'live', f.id)
  })

  test('the product has no logo, and its placeholder never shows the working name', () => {
    const b = brand('product')
    assert.equal(b.status, 'proposed')
    assert.equal(b.logo.files.length, 0)
    assert.ok(b.logo.placeholder !== undefined)
    assert.equal(wordmarkText(b, {}), 'Product name')
    assert.equal(wordmarkText(b, { productName: 'AdsPilot' }), 'Product name')
    assert.equal(wordmarkText(b, { productName: 'Brightline' }), 'Brightline')
    assert.equal(displayName(b, { productName: 'adspilot pro' }), b.name)
    assert.equal(displayName(b, { productName: 'Brightline' }), 'Brightline')
  })

  test('no brand ever puts the working product name on a creative', () => {
    for (const [slug, l] of brands) assert.ok(l.brand.voice.neverOnCreative.includes('AdsPilot'), slug)
  })
})

describe('fonts and logos are licensed and present', () => {
  for (const [slug, l] of brands) {
    test(`${slug}: every shipped font has its licence text beside it`, () => {
      for (const family of l.brand.typography.families) {
        if (family.files.length === 0) continue
        const licence = readFileSync(join(l.dir, family.licence.file!), 'utf8')
        assert.match(licence, /SIL Open Font License, Version 1\.1/, `${slug}/${family.name}`)
        for (const file of family.files) assert.ok(existsSync(join(l.dir, file.path)), file.path)
      }
    })
    test(`${slug}: logo licence and use are stated`, () => {
      assert.ok(l.brand.logo.licence.length > 10)
    })
  }

  test('Playfair Display, which has a Reserved Font Name, is shipped unmodified (not subset)', () => {
    const l = brands.get('muzaree')!
    const file = l.brand.typography.families.find((f) => f.id === 'playfair')!.files[0]!
    assert.equal(file.format, 'truetype')
    assert.match(readFileSync(join(l.dir, 'fonts', 'OFL-PlayfairDisplay.txt'), 'utf8'), /Reserved Font Name "Playfair Display"/)
  })
})
