import { strict as assert } from 'node:assert'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

import { INDUSTRIES, INDUSTRY_LABELS, businessTypeLine, industryOf } from '../src/domain/industries.ts'
import { codeForFailure } from '../src/domain/resolutions.ts'

describe('industries', () => {
  test('the owner\'s list, in the owner\'s order', () => {
    assert.deepEqual([...INDUSTRIES], ['dentist', 'education', 'real_estate', 'ecommerce', 'tool_website', 'agency', 'other'])
  })

  test('a listed value is read as itself', () => {
    for (const industry of INDUSTRIES) assert.equal(industryOf(industry), industry)
  })

  test('anything else is no industry, not "other"', () => {
    // Free text must never reach analytics, and an unknown value must not inflate 'other'.
    for (const value of ['Dental clinic', 'DENTIST', '', null, undefined, 7, { industry: 'dentist' }]) {
      assert.equal(industryOf(value), undefined)
    }
  })
})

describe('what check_usage says', () => {
  test('every industry has a label', () => {
    assert.deepEqual(Object.keys(INDUSTRY_LABELS).sort(), [...INDUSTRIES].sort())
  })

  test('a set industry by its label, an unset one as "not set"', () => {
    assert.equal(businessTypeLine('real_estate'), 'Business type: Real estate')
    assert.equal(businessTypeLine(undefined), 'Business type: not set')
  })
})

/**
 * The database's CHECK constraint and INDUSTRIES must be the same list.
 *
 * Prisma does not model CHECK constraints, so nothing else ties the SQL to the
 * TypeScript: a code added here but not there would make set_business_type
 * fail in production for that one industry, and a code added there but not
 * here would be stored but read back as unknown. The constraint's latest
 * definition is the one in force, so the last migration that defines it wins.
 */
describe('tenants_industry_known matches INDUSTRIES', () => {
  const migrations = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'prisma', 'migrations')
  const CONSTRAINT = /ADD CONSTRAINT "tenants_industry_known"\s+CHECK\s*\(([\s\S]*?)\);/g

  function latestDefinition(): string | undefined {
    let found: string | undefined
    // Migration folders start with a timestamp, so name order is apply order.
    for (const name of readdirSync(migrations).sort()) {
      const file = join(migrations, name, 'migration.sql')
      if (!existsSync(file)) continue
      for (const match of readFileSync(file, 'utf8').matchAll(CONSTRAINT)) found = match[1]
    }
    return found
  }

  test('the constraint exists in a migration (guards against a vacuous pass)', () => {
    assert.ok(latestDefinition() !== undefined, `no migration in ${migrations} defines tenants_industry_known`)
  })

  test('its IN list is exactly INDUSTRIES, in the same order', () => {
    const definition = latestDefinition() ?? ''
    assert.match(definition, /"industry" IS NULL OR/, 'the column must stay nullable: unset is a valid state')
    const list = /"industry"\s+IN\s*\(([^)]*)\)/.exec(definition)?.[1]
    assert.ok(list !== undefined, `no IN list in: ${definition}`)
    const codes = list.split(',').map((item) => item.trim().replace(/^'(.*)'$/, '$1'))
    assert.deepEqual(codes, [...INDUSTRIES])
  })
})

describe('codeForFailure', () => {
  test('the adapter\'s own code wins over the class', () => {
    assert.equal(codeForFailure({ failureClass: 'credential', code: 'QUOTA_EXHAUSTED' }), 'QUOTA_EXHAUSTED')
  })

  test('the class is the fallback', () => {
    assert.equal(codeForFailure({ failureClass: 'credential' }), 'TOKEN_EXPIRED')
    assert.equal(codeForFailure({ failureClass: 'transient' }), 'RATE_LIMITED')
    assert.equal(codeForFailure({ failureClass: 'permanent' }), 'PLATFORM_REJECTED')
  })
})
