import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

import { PLATFORMS } from '../src/domain/types.ts'

/**
 * The standing design test for this project.
 *
 * **Adding a platform must mean writing one adapter and one capability record —
 * nothing else.** Every `if (platform === 'instagram')` that leaks into the UI,
 * the queue, the publisher or the vault is a place a future platform will need
 * changing, and those places multiply quietly until adding a platform is a
 * refactor rather than a file.
 *
 * This scans the source rather than trusting a convention, because a convention
 * nobody can check is a convention that erodes.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE_ROOT = join(HERE, '..', '..', '..')

/**
 * Where platform names are legitimate:
 *   packages/adapters  — platform knowledge is the entire point
 *   packages/core      — declares the list and the capability table
 *   apps/cli/connect   — OAuth flows are per-provider, see the known gap below
 */
const ALLOWED = [
  join('packages', 'adapters'),
  join('packages', 'core', 'src', 'domain', 'types.ts'),
  join('packages', 'core', 'src', 'adapters', 'capabilities.ts'),
  join('apps', 'cli', 'src', 'connect.ts'),
]

function sourceFiles(dir: string, found: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }

  for (const entry of entries) {
    if (['node_modules', 'dist', '.next', '.git', 'migrations'].includes(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (/\.test\.tsx?$/.test(entry)) continue
    found.push(full)
  }
  return found
}

/** Strips comments and doc blocks — a platform named in prose is not coupling. */
function code(contents: string): string {
  return contents.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('platform knowledge stays inside adapters', () => {
  const files = sourceFiles(join(SOURCE_ROOT, 'packages')).concat(
    sourceFiles(join(SOURCE_ROOT, 'apps')),
  )

  test('finds source files to check (guards against a broken scan)', () => {
    // If the walker breaks, every other test here passes vacuously.
    assert.ok(files.length > 20, `expected to scan many files, found ${files.length}`)
  })

  test('no platform name appears in code outside the places that own it', () => {
    const violations: string[] = []

    for (const file of files) {
      const rel = relative(SOURCE_ROOT, file)
      if (ALLOWED.some((allowed) => rel.startsWith(allowed))) continue

      const body = code(readFileSync(file, 'utf8'))
      for (const platform of PLATFORMS) {
        // Quoted literal only: `platform: string` is fine, `'instagram'` is not.
        if (new RegExp(`['"\`]${platform}['"\`]`).test(body)) {
          violations.push(`${rel} mentions '${platform}'`)
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Platform names leaked outside adapters:\n  ${violations.join('\n  ')}\n\n` +
        'Adding a platform should mean one adapter and one capability record. ' +
        'If this needs a platform name, the capability record probably needs a new field instead.',
    )
  })

  test('the UI never branches on a platform name', () => {
    const uiFiles = sourceFiles(join(SOURCE_ROOT, 'apps', 'web'))
    const violations: string[] = []

    for (const file of uiFiles) {
      const body = code(readFileSync(file, 'utf8'))
      for (const platform of PLATFORMS) {
        if (new RegExp(`(===|!==|includes\\()\\s*['"\`]${platform}`).test(body)) {
          violations.push(`${relative(SOURCE_ROOT, file)} branches on '${platform}'`)
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `The UI must render from Capabilities, not from platform names:\n  ${violations.join('\n  ')}`,
    )
  })

  test('the publisher, queue and vault know nothing about platforms', () => {
    // These are the layers where coupling would be most expensive: every platform
    // would need them changed.
    const violations: string[] = []

    for (const pkg of ['publisher', 'db', 'vault', 'media', 'telemetry']) {
      for (const file of sourceFiles(join(SOURCE_ROOT, 'packages', pkg))) {
        const body = code(readFileSync(file, 'utf8'))
        for (const platform of PLATFORMS) {
          if (new RegExp(`['"\`]${platform}['"\`]`).test(body)) {
            violations.push(`${relative(SOURCE_ROOT, file)} mentions '${platform}'`)
          }
        }
      }
    }

    assert.deepEqual(violations, [], `Core infrastructure must stay platform-agnostic:\n  ${violations.join('\n  ')}`)
  })
})

describe('every platform is fully declared', () => {
  test('each platform in PLATFORMS has a capability record', async () => {
    // A platform that exists in the type but not the table crashes at runtime the
    // first time someone selects it.
    const { CAPABILITIES } = await import('../src/adapters/capabilities.ts')
    for (const platform of PLATFORMS) {
      assert.ok(CAPABILITIES[platform] !== undefined, `${platform} has no capability record`)
    }
  })

  test('no capability record exists for an unknown platform', async () => {
    const { CAPABILITIES } = await import('../src/adapters/capabilities.ts')
    for (const key of Object.keys(CAPABILITIES)) {
      assert.ok(
        (PLATFORMS as readonly string[]).includes(key),
        `${key} has a capability record but is not in PLATFORMS`,
      )
    }
  })
})

describe('preview data', () => {
  test('every platform with a preview declares sensible values', async () => {
    const { CAPABILITIES } = await import('../src/adapters/capabilities.ts')

    for (const [platform, caps] of Object.entries(CAPABILITIES)) {
      const preview = caps.preview
      if (preview === undefined) continue

      assert.ok(preview.label.length > 0, `${platform}: preview needs a label`)
      assert.match(preview.accent, /^#[0-9a-f]{6}$/i, `${platform}: accent must be a hex colour`)
      assert.ok(preview.moreLabel.length > 0, `${platform}: needs a "more" label`)

      // A truncation point beyond the platform's own text limit would never fire,
      // which means the preview would silently stop warning about long captions.
      assert.ok(
        preview.captionTruncateAt > 0 && preview.captionTruncateAt <= caps.maxTextLength,
        `${platform}: captionTruncateAt (${preview.captionTruncateAt}) must be within maxTextLength (${caps.maxTextLength})`,
      )
    }
  })

  test('the platforms that publish today all have previews', async () => {
    // A connected platform with no preview silently shows nothing, which looks
    // like a bug rather than a missing feature.
    const { CAPABILITIES } = await import('../src/adapters/capabilities.ts')
    for (const platform of ['facebook_page', 'instagram'] as const) {
      assert.ok(CAPABILITIES[platform].preview !== undefined, `${platform} has no preview data`)
    }
  })

  test('platforms differ in where they cut the caption', async () => {
    // The whole point of the preview: a caption that reads well on one platform
    // can lose its point on another.
    const { CAPABILITIES } = await import('../src/adapters/capabilities.ts')
    const fb = CAPABILITIES.facebook_page.preview!
    const ig = CAPABILITIES.instagram.preview!
    assert.ok(
      ig.captionTruncateAt < fb.captionTruncateAt,
      'Instagram truncates earlier than Facebook — if this ever inverts, check the sources',
    )
  })
})
