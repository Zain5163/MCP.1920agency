import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'

import { AuthError, createUser, needsFirstUser } from '@social-publisher/auth'
import { db, disconnect } from '@social-publisher/db'

/**
 * `create-user` — makes a login account.
 *
 * The first account created is automatically the owner, because someone has to be,
 * and a system where nobody can administer it is worse than one where the first
 * person can. Every account after that is a member unless --role says otherwise.
 *
 * The password is read from a prompt rather than an argument so it never lands in
 * shell history or a process list.
 */

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      role: { type: 'string' },
      name: { type: 'string' },
      tenant: { type: 'string' },
    },
  })

  const first = await needsFirstUser()
  const email = values.email ?? (await ask('Email: '))
  if (email === '') {
    console.error('\n  An email address is required.\n')
    process.exit(1)
  }

  const password = await ask('Password (not echoed to history, minimum 12 characters): ')
  const confirm = await ask('Confirm password: ')

  if (password !== confirm) {
    console.error('\n  Those two passwords do not match. Nothing was created.\n')
    process.exit(1)
  }

  // Attach to the existing tenant by default, so the owner sees the accounts
  // already connected rather than starting from an empty one.
  let tenantId = values.tenant
  if (tenantId === undefined) {
    const tenant = await db().tenant.findFirst({ orderBy: { createdAt: 'asc' } })
    if (tenant === null) {
      console.error('\n  No account exists yet. Run connect.ts first to link a social account.\n')
      process.exit(1)
    }
    tenantId = tenant.id
  }

  const role = (values.role ?? (first ? 'owner' : 'member')) as 'owner' | 'admin' | 'member'

  try {
    const user = await createUser({
      email,
      password,
      tenantId,
      role,
      ...(values.name !== undefined ? { displayName: values.name } : {}),
    })

    console.error(`\n  Created ${user.email} with role "${user.role}".`)
    if (first) {
      console.error('  This is the first account, so it is the owner.')
    }
    console.error('\n  Sign in at http://localhost:3000\n')
  } catch (error) {
    if (error instanceof AuthError) {
      console.error(`\n  ${error.message}`)
      for (const problem of error.problems) console.error(`    - ${problem}`)
      console.error('\n  Nothing was created.\n')
      process.exit(1)
    }
    throw error
  }

  await disconnect()
}

main().catch(async (error: unknown) => {
  console.error(`\n  Failed: ${error instanceof Error ? error.message : String(error)}\n`)
  await disconnect().catch(() => {})
  process.exit(1)
})
