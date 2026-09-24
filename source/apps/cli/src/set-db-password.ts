import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

/**
 * `pnpm set-password` — puts the Supabase database password into both connection
 * strings, correctly encoded.
 *
 * Exists because this one step has two traps that produce the same unhelpful
 * "authentication failed" message:
 *
 *   1. The `[YOUR-PASSWORD]` placeholder simply not being replaced.
 *   2. A password containing @ : / ? # [ ] & or % breaking the URL unless it is
 *      percent-encoded.
 *
 * The password is read from stdin rather than argv so it does not land in shell
 * history, and it is never printed back.
 */

const ENV_PATH = join(homedir(), '.social-publisher', '.env')

function patch(line: string, encoded: string): string {
  const eq = line.indexOf('=')
  if (eq === -1) return line
  const key = line.slice(0, eq)
  let value = line.slice(eq + 1).trim()

  if (value === '') return line
  if (value.length > 1 && value[0] === value[value.length - 1] && /["']/.test(value[0]!)) {
    value = value.slice(1, -1)
  }

  // Replace the placeholder if present; otherwise swap whatever password is there.
  const replaced = value.includes('[YOUR-PASSWORD]')
    ? value.replace('[YOUR-PASSWORD]', encoded)
    : value.replace(/^(postgres(?:ql)?:\/\/[^:]+:)[^@]*@/, `$1${encoded}@`)

  return `${key}=${replaced}`
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  const password = await new Promise<string>((resolve) => {
    rl.question('Supabase database password (input is not echoed to history): ', (answer) => {
      rl.close()
      resolve(answer)
    })
  })

  if (password.trim() === '') {
    console.error('\n  Nothing entered. No changes made.\n')
    process.exit(1)
  }

  const encoded = encodeURIComponent(password)
  const original = readFileSync(ENV_PATH, 'utf8')
  const lines = original.split(/\r?\n/)

  let touched = 0
  const updated = lines.map((line) => {
    if (!/^\s*(DATABASE_URL|DIRECT_URL)=/.test(line)) return line
    const next = patch(line.trim(), encoded)
    if (next !== line.trim()) touched += 1
    return next
  })

  if (touched === 0) {
    console.error('\n  Could not find DATABASE_URL / DIRECT_URL with a value. No changes made.\n')
    process.exit(1)
  }

  writeFileSync(ENV_PATH, updated.join('\n'), 'utf8')

  console.error(`\n  Updated ${touched} connection string(s) in ${ENV_PATH}`)
  if (encoded !== password) {
    console.error('  Password contained URL-special characters and was percent-encoded.')
  }
  console.error('\n  Now run:  pnpm status\n')
}

main().catch((error: unknown) => {
  console.error(`\n  Failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
