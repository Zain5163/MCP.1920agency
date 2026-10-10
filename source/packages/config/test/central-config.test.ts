import { strict as assert } from 'node:assert'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

import { parseEnv } from '../src/env.ts'
import { DEFAULT_OAUTH_CALLBACK_PORT, PRODUCT_DEFAULTS } from '../src/product.ts'

/**
 * The guard for "change it once, in one place" (owner, 2026-10-10).
 *
 * The product name, the company, the domain and the server are not final. Each
 * has exactly one home:
 *
 *   product name, slug, company      source/packages/config/src/product.ts
 *   domain, server, SSH key, paths   deploy/site.env
 *
 * This test scans what runs and what is served, and fails when one of those
 * values is written out anywhere else, so a rename or a move stays a one-line
 * change. It reads files rather than trusting a convention, like the platform
 * guard in packages/core (architecture.test.ts), and for the same reason.
 *
 * Not scanned, on purpose: tests (they assert today's defaults), documentation
 * and history (*.md outside the served skills: logs, research, decisions keep the
 * names they had), the vendored third-party skills (their text is theirs), and
 * the external registrations checked for agreement below instead (the Shopify
 * app record).
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..', '..')
const SOURCE = join(REPO, 'source')

const SITE = parseEnv(readFileSync(join(REPO, 'deploy', 'site.env'), 'utf8'))

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What may not be written outside its home, and where to get it instead. */
const FORBIDDEN: readonly { what: string; pattern: RegExp; instead: string }[] = [
  {
    what: 'the product name',
    // Whole word only: an identifier such as createAdsPilotServer is code, not text.
    pattern: new RegExp(`(?<![A-Za-z0-9_])${escape(PRODUCT_DEFAULTS.PRODUCT_NAME)}(?![A-Za-z0-9_])`),
    instead: 'productName() from @social-publisher/config, or {{PRODUCT_NAME}} in our own skills',
  },
  {
    what: 'the product name, split for the wordmark',
    pattern: /Ads<span[^>]*>Pilot/,
    instead: '<Wordmark /> (apps/web/src/components/Wordmark.tsx)',
  },
  {
    what: 'the company name or domain',
    pattern: new RegExp(escape(PRODUCT_DEFAULTS.COMPANY_NAME).replace(/\\? /g, '[ -]?'), 'i'),
    instead: 'companyName() / shopifyAppName() from @social-publisher/config, or DOMAIN from deploy/site.env',
  },
  {
    what: 'the domain',
    pattern: new RegExp(escape(SITE.DOMAIN ?? 'site.env has no DOMAIN'), 'i'),
    instead: 'DOMAIN in deploy/site.env (scripts: site.sh; runtime: publicBaseUrl())',
  },
  {
    what: 'the server address',
    pattern: new RegExp(escape(SITE.SERVER_HOST ?? 'site.env has no SERVER_HOST')),
    instead: 'SERVER_HOST in deploy/site.env (scripts: $SSH_TARGET from site.sh)',
  },
  {
    what: 'the SSH key',
    pattern: new RegExp(escape(basename(SITE.SSH_KEY ?? 'site.env has no SSH_KEY'))),
    instead: 'SSH_KEY in deploy/site.env (scripts: $SSH_KEY_FILE from site.sh)',
  },
]

/** The single sources themselves. */
const HOMES = new Set([
  join('source', 'packages', 'config', 'src', 'product.ts'),
  join('deploy', 'site.env'),
])

type Kind = 'code' | 'served' | 'shell' | 'whole'

const stripCode = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const stripHashComments = (text: string) => text.replace(/^\s*#.*$/gm, '')
const stripRem = (text: string) => text.replace(/^\s*(REM|::).*$/gim, '')

/** The text that counts: comments in code and scripts are prose for developers, not values. */
function checked(kind: Kind, text: string, file: string): string {
  if (kind === 'code') return stripCode(text)
  if (kind === 'shell') return file.endsWith('.cmd') ? stripRem(text) : stripHashComments(text)
  return text
}

function walk(dir: string, keep: (file: string) => boolean, found: string[] = []): string[] {
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.next', '.git'].includes(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, keep, found)
    else if (keep(full)) found.push(full)
  }
  return found
}

const isTest = (f: string) => f.split(sep).includes('test') || /\.test\.tsx?$/.test(f)

/** Every file the guard reads, with how to read it. */
function scanned(): { file: string; kind: Kind }[] {
  const out: { file: string; kind: Kind }[] = []
  // Code that runs: every package and app's src (and the web app's CSS).
  for (const group of ['packages', 'apps']) {
    for (const pkg of readdirSync(join(SOURCE, group))) {
      for (const file of walk(join(SOURCE, group, pkg, 'src'), (f) => /\.(ts|tsx|mts|mjs|js|css)$/.test(f) && !isTest(f))) {
        out.push({ file, kind: 'code' })
      }
    }
  }
  // Text served to AI clients that we wrote: our own skills and the playbooks.
  for (const dir of [join(SOURCE, 'apps', 'mcp', 'skills-library', 'adspilot'), join(SOURCE, 'apps', 'mcp', 'playbooks')]) {
    for (const file of walk(dir, () => true)) out.push({ file, kind: 'served' })
  }
  // The deployment kit, except its README (a runbook with history in it).
  for (const file of walk(join(REPO, 'deploy'), (f) => basename(f) !== 'README.md')) {
    const kind: Kind = /\.(m?js|ts)$/.test(file) ? 'code' : /\.(template|env|example)$/.test(file) ? 'whole' : 'shell'
    out.push({ file, kind })
  }
  // Launchers and the env template at the root.
  for (const entry of readdirSync(REPO)) {
    if (entry.endsWith('.cmd')) out.push({ file: join(REPO, entry), kind: 'shell' })
  }
  out.push({ file: join(REPO, '.env.example'), kind: 'whole' })
  return out.filter(({ file }) => !HOMES.has(relative(REPO, file)))
}

/** The violations in one piece of text: "what (line n): instead". */
export function violationsIn(text: string): string[] {
  const found: string[] = []
  const lines = text.split(/\r?\n/)
  for (const rule of FORBIDDEN) {
    lines.forEach((line, i) => {
      if (rule.pattern.test(line)) found.push(`line ${i + 1}: ${rule.what}; use ${rule.instead}`)
    })
  }
  return found
}

describe('values that change live in one place', () => {
  const files = scanned()

  test('the scan finds what it should (guards against a broken walk)', () => {
    const rel = files.map(({ file }) => relative(REPO, file).split(sep).join('/'))
    assert.ok(rel.length > 150, `expected to scan many files, found ${rel.length}`)
    for (const expected of [
      'source/apps/mcp/src/playbooks.ts',
      'source/apps/web/src/app/layout.tsx',
      'source/apps/mcp/skills-library/adspilot/skills/wordpress-site-builder/SKILL.md',
      'deploy/scripts/release.sh',
      'deploy/docker-compose.yml',
      'deploy/caddy/site.caddy.template',
      'start-dashboard.cmd',
    ]) {
      assert.ok(rel.includes(expected), `${expected} is not scanned`)
    }
    assert.ok(!rel.includes('source/packages/config/src/product.ts'))
    assert.ok(!rel.includes('deploy/site.env'))
  })

  test('the rules catch what they are for', () => {
    const name = PRODUCT_DEFAULTS.PRODUCT_NAME
    assert.equal(violationsIn(`'${name} runs'`).length, 1)
    assert.equal(violationsIn('createAdsPilotServer(version)').length, 0)
    assert.equal(violationsIn(`curl https://${SITE.DOMAIN}/health`).length, 2) // the domain, and the company in it
    assert.equal(violationsIn(`ssh root@${SITE.SERVER_HOST}`).length, 1)
    assert.equal(violationsIn(`name = "${PRODUCT_DEFAULTS.COMPANY_NAME} Store Connector"`).length, 1)
    assert.equal(violationsIn('Ads<span className="text-brand">Pilot</span>').length, 1)
    assert.equal(violationsIn('{{PRODUCT_NAME}} on $DOMAIN').length, 0)
  })

  test('nothing scanned repeats the product name, company, domain or server', () => {
    const problems: string[] = []
    for (const { file, kind } of files) {
      const text = checked(kind, readFileSync(file, 'utf8'), file)
      for (const v of violationsIn(text)) problems.push(`${relative(REPO, file).split(sep).join('/')} ${v}`)
    }
    assert.deepEqual(
      problems,
      [],
      'A value that has one home was written out again:\n  ' +
        problems.join('\n  ') +
        '\n\nWhere settings live: START-HERE.md and architecture/2026-10-10-central-config.md.',
    )
  })
})

describe('deploy/site.env and the files that must agree with it', () => {
  test('site.env has every name, as plain values', () => {
    for (const name of ['DOMAIN', 'SERVER_HOST', 'SERVER_USER', 'SSH_KEY', 'GATE_DIR', 'ADSPILOT_HOME', 'COMPOSE_PROJECT', 'EDGE_NETWORK', 'OAUTH_BOUNCE_PORT']) {
      const value = SITE[name]
      assert.ok(value !== undefined && value !== '', `${name} is missing from deploy/site.env`)
      // site.sh reads values literally: quotes or $VARS would end up in paths and hosts.
      assert.doesNotMatch(value, /["'$`\s]/, `${name} in deploy/site.env must be a plain value`)
    }
    assert.match(SITE.DOMAIN!, /^[a-z0-9.-]+$/)
  })

  test('the OAuth bounce port is the one the PC listener uses', () => {
    assert.equal(Number(SITE.OAUTH_BOUNCE_PORT), DEFAULT_OAUTH_CALLBACK_PORT)
  })

  test('the Caddy template renders completely from site.env', () => {
    const template = readFileSync(join(REPO, 'deploy', 'caddy', 'site.caddy.template'), 'utf8')
    // The same substitution as deploy/scripts/caddy-site.sh.
    const rendered = template.replaceAll('{{DOMAIN}}', SITE.DOMAIN!).replaceAll('{{OAUTH_BOUNCE_PORT}}', SITE.OAUTH_BOUNCE_PORT!)
    assert.doesNotMatch(rendered, /\{\{/, 'a placeholder site.env does not fill')
    assert.match(rendered, new RegExp(`^${escape(SITE.DOMAIN!)} \\{$`, 'm'))
  })

  test('compose takes the domain, project, network and folder from site.env', () => {
    const compose = readFileSync(join(REPO, 'deploy', 'docker-compose.yml'), 'utf8')
    assert.match(compose, /PUBLIC_BASE_URL: "https:\/\/\$\{DOMAIN:\?/)
    // The fallbacks a bare `docker compose` would use are the same values.
    assert.match(compose, new RegExp(`^name: ${escape(SITE.COMPOSE_PROJECT!)}$`, 'm'))
    assert.match(compose, new RegExp(`\\$\\{EDGE_NETWORK:-${escape(SITE.EDGE_NETWORK!)}\\}`))
    for (const m of compose.matchAll(/\$\{ADSPILOT_HOME:-([^}]+)\}/g)) assert.equal(m[1], SITE.ADSPILOT_HOME)
  })

  test('the Shopify app record points at the domain and carries the company name', () => {
    // An external registration: Shopify reads this file on `shopify app deploy`,
    // so it cannot read site.env. A move or rename that forgets it fails here.
    const toml = readFileSync(join(REPO, 'integrations', 'shopify-app', 'shopify.app.toml'), 'utf8')
    assert.match(toml, new RegExp(`^name = "${escape(PRODUCT_DEFAULTS.COMPANY_NAME)} Store Connector"$`, 'm'))
    const settings = toml.replace(/^\s*#.*$/gm, '') // comments link to Shopify's docs
    const urls = [...settings.matchAll(/https:\/\/[^"\s]+/g)].map((m) => new URL(m[0]))
    assert.ok(urls.length >= 2, 'expected application_url and redirect_urls')
    for (const url of urls) assert.equal(url.host, SITE.DOMAIN, `${url.href} is not on DOMAIN (deploy/site.env)`)
  })
})
