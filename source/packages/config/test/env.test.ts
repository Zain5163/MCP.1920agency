import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, describe, beforeEach } from 'node:test'

import {
  DEFAULT_POSTHOG_HOST,
  analyticsConfig,
  checkConfig,
  ConfigError,
  mediaHostingReady,
  parseEnv,
  required,
  resetEnvCache,
} from '../src/env.ts'

const tmpEnv = (contents: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-config-'))
  const path = join(dir, '.env')
  writeFileSync(path, contents, 'utf8')
  return path
}

beforeEach(() => {
  resetEnvCache()
})

describe('parseEnv', () => {
  test('parses simple key=value pairs', () => {
    assert.deepEqual(parseEnv('A=1\nB=2'), { A: '1', B: '2' })
  })

  test('ignores comments and blank lines', () => {
    assert.deepEqual(parseEnv('# note\n\nA=1\n   \n# another\nB=2'), { A: '1', B: '2' })
  })

  test('keeps = signs inside values, which matters for base64 keys', () => {
    // A 32-byte base64 key normally ends in '=' padding.
    assert.deepEqual(parseEnv('K=abc123=='), { K: 'abc123==' })
  })

  test('keeps connection strings with special characters intact', () => {
    const url = 'postgresql://user:p%40ss@host:5432/db?sslmode=require'
    assert.deepEqual(parseEnv(`DATABASE_URL=${url}`), { DATABASE_URL: url })
  })

  test('strips matching surrounding quotes', () => {
    assert.deepEqual(parseEnv('A="hello world"'), { A: 'hello world' })
    assert.deepEqual(parseEnv("B='hello world'"), { B: 'hello world' })
  })

  test('does not strip mismatched or internal quotes', () => {
    assert.deepEqual(parseEnv('A="unclosed'), { A: '"unclosed' })
    assert.deepEqual(parseEnv('B=say "hi"'), { B: 'say "hi"' })
  })

  test('trims whitespace around keys and values', () => {
    assert.deepEqual(parseEnv('  A  =  1  '), { A: '1' })
  })

  test('ignores malformed lines rather than throwing', () => {
    assert.deepEqual(parseEnv('NOEQUALS\n=novalue\nA=1'), { A: '1' })
  })

  test('handles CRLF line endings, which is what Windows editors write', () => {
    assert.deepEqual(parseEnv('A=1\r\nB=2\r\n'), { A: '1', B: '2' })
  })

  test('last occurrence wins on a duplicated key', () => {
    assert.deepEqual(parseEnv('A=1\nA=2'), { A: '2' })
  })
})

describe('required', () => {
  test('returns a present value', () => {
    assert.equal(required('A', tmpEnv('A=hello')), 'hello')
  })

  test('throws a message naming the file when the key is missing', () => {
    const path = tmpEnv('B=1')
    assert.throws(() => required('A', path), (err: unknown) => {
      assert.ok(err instanceof ConfigError)
      assert.match(err.message, /A is missing/)
      assert.match(err.message, /\.env/)
      return true
    })
  })

  test('treats an empty value as missing', () => {
    assert.throws(() => required('A', tmpEnv('A=   ')), ConfigError)
  })

  test('points at SETUP.md when the file does not exist at all', () => {
    assert.throws(
      () => required('A', join(tmpdir(), 'definitely-not-here', '.env')),
      /SETUP\.md/,
    )
  })
})

describe('checkConfig', () => {
  test('reports every missing key at once rather than failing on the first', () => {
    const result = checkConfig(tmpEnv('DATABASE_URL=x'))
    assert.equal(result.ok, false)
    assert.ok(result.missing.includes('META_APP_ID'))
    assert.ok(result.missing.includes('VAULT_MASTER_KEY'))
    assert.ok(result.present.includes('DATABASE_URL'))
  })

  const coreOnly = ['DATABASE_URL=x', 'DIRECT_URL=x', 'META_APP_ID=x', 'META_APP_SECRET=x', 'VAULT_MASTER_KEY=x'].join('\n')
  const withStorage = [
    coreOnly,
    'SUPABASE_URL=x',
    'SUPABASE_SERVICE_ROLE_KEY=x',
    'SUPABASE_STORAGE_BUCKET=media',
  ].join('\n')

  test('reports ok on core keys alone — media hosting is not required for Facebook', () => {
    // Facebook uploads bytes directly, so demanding object storage up front would
    // block a perfectly good Facebook-only setup.
    const result = checkConfig(tmpEnv(coreOnly))
    assert.equal(result.ok, true)
    assert.deepEqual(result.missing, [])
  })

  test('requires storage keys only when media hosting is explicitly requested', () => {
    const result = checkConfig(tmpEnv(coreOnly), { requireMediaHosting: true })
    assert.equal(result.ok, false)
    assert.ok(result.missing.includes('SUPABASE_SERVICE_ROLE_KEY'))
  })

  test('reports ok with media hosting once storage is configured', () => {
    const result = checkConfig(tmpEnv(withStorage), { requireMediaHosting: true })
    assert.equal(result.ok, true)
  })

  test('mediaHostingReady reflects whether Instagram could work', () => {
    resetEnvCache()
    assert.equal(mediaHostingReady(tmpEnv(withStorage)), true)
    resetEnvCache()
    assert.equal(mediaHostingReady(tmpEnv(coreOnly)), false)
  })

  test('never exposes a secret value in its result', () => {
    const result = checkConfig(tmpEnv('META_APP_SECRET=super-secret-value'))
    assert.ok(!JSON.stringify(result).includes('super-secret-value'))
  })

  test('says so when the file is absent', () => {
    const result = checkConfig(join(tmpdir(), 'nope-not-here', '.env'))
    assert.equal(result.envFileExists, false)
    assert.equal(result.ok, false)
  })
})

describe('analyticsConfig', () => {
  // Real process env wins over the file; make sure a developer's own shell
  // cannot decide these tests.
  const saved = { key: process.env.POSTHOG_KEY, host: process.env.POSTHOG_HOST }
  beforeEach(() => {
    delete process.env.POSTHOG_KEY
    delete process.env.POSTHOG_HOST
  })
  after(() => {
    if (saved.key !== undefined) process.env.POSTHOG_KEY = saved.key
    if (saved.host !== undefined) process.env.POSTHOG_HOST = saved.host
  })

  test('without a key there is no key, and the EU host is the default', () => {
    const config = analyticsConfig(tmpEnv('DATABASE_URL=x'))
    assert.equal(config.posthogKey, undefined)
    assert.equal(config.posthogHost, DEFAULT_POSTHOG_HOST)
    assert.equal(DEFAULT_POSTHOG_HOST, 'https://eu.i.posthog.com')
  })

  test('a blank key is no key', () => {
    assert.equal(analyticsConfig(tmpEnv('POSTHOG_KEY=   ')).posthogKey, undefined)
  })

  test('reads the key and an explicit host', () => {
    const config = analyticsConfig(tmpEnv('POSTHOG_KEY=phc_test\nPOSTHOG_HOST=https://ph.example'))
    assert.equal(config.posthogKey, 'phc_test')
    assert.equal(config.posthogHost, 'https://ph.example')
  })
})
