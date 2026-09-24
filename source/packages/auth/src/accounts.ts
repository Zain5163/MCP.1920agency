import { db } from '@social-publisher/db'

import { checkPasswordStrength, hashPassword, needsRehash, verifyPassword } from './password.ts'

/**
 * User accounts and sign-in.
 *
 * Every function here is written so that failure reveals as little as possible:
 * a wrong email and a wrong password produce the same result, and both take
 * roughly the same time.
 */

export class AuthError extends Error {
  readonly problems: readonly string[]
  constructor(message: string, problems: readonly string[] = []) {
    super(message)
    this.name = 'AuthError'
    this.problems = problems
  }
}

export type Role = 'owner' | 'admin' | 'member'

export interface AuthenticatedUser {
  readonly id: string
  readonly email: string
  readonly tenantId: string
  readonly role: Role
  readonly displayName: string | null
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  // Deliberately loose. Strict RFC validation rejects real addresses, and the
  // only reliable proof an address works is sending to it.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
}

export async function createUser(options: {
  email: string
  password: string
  tenantId: string
  role?: Role
  displayName?: string
}): Promise<AuthenticatedUser> {
  const email = normaliseEmail(options.email)

  if (!isValidEmail(email)) throw new AuthError('That does not look like an email address.')

  const strength = checkPasswordStrength(options.password)
  if (!strength.ok) throw new AuthError('That password is not strong enough.', strength.problems)

  const existing = await db().user.findUnique({ where: { email } })
  if (existing !== null) throw new AuthError('An account with that email already exists.')

  const user = await db().user.create({
    data: {
      email,
      passwordHash: await hashPassword(options.password),
      tenantId: options.tenantId,
      role: options.role ?? 'member',
      ...(options.displayName !== undefined ? { displayName: options.displayName } : {}),
    },
  })

  return {
    id: user.id,
    email: user.email,
    tenantId: user.tenantId,
    role: user.role as Role,
    displayName: user.displayName,
  }
}

/**
 * Signs a user in, or returns null.
 *
 * Returns null for both "no such user" and "wrong password", and verifies against
 * a dummy hash when the user does not exist. Skipping that work would make a
 * missing account measurably faster to reject, which turns login timing into a
 * way to enumerate who has an account.
 */
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='

export async function authenticate(
  email: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const normalised = normaliseEmail(email)
  const user = await db().user.findUnique({ where: { email: normalised } })

  if (user === null) {
    await verifyPassword(password, DUMMY_HASH)
    return null
  }

  if (!(await verifyPassword(password, user.passwordHash))) return null

  // Transparently upgrade the stored hash when parameters have been raised.
  if (needsRehash(user.passwordHash)) {
    await db()
      .user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
      .catch(() => {
        /* a failed upgrade must never fail a valid login */
      })
  }

  await db()
    .user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => {})

  return {
    id: user.id,
    email: user.email,
    tenantId: user.tenantId,
    role: user.role as Role,
    displayName: user.displayName,
  }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await db().user.findUnique({ where: { id: userId } })
  if (user === null) throw new AuthError('No such account.')

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AuthError('The current password is not correct.')
  }

  const strength = checkPasswordStrength(newPassword)
  if (!strength.ok) throw new AuthError('That password is not strong enough.', strength.problems)

  await db().user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  })
}

export async function findUser(userId: string): Promise<AuthenticatedUser | null> {
  const user = await db().user.findUnique({ where: { id: userId } })
  return user === null
    ? null
    : {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role as Role,
        displayName: user.displayName,
      }
}

/** True when no users exist — the signal to run first-time setup. */
export async function needsFirstUser(): Promise<boolean> {
  return (await db().user.count()) === 0
}
