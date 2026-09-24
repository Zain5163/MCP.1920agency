import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

import { findUser, type AuthenticatedUser } from '@social-publisher/auth'
import { required } from '@social-publisher/config'

/**
 * Sessions.
 *
 * The cookie is an HMAC-signed token, so it cannot be forged without the vault
 * key, and it is httpOnly so page script cannot read it. It carries the user id
 * only — role and tenant are re-read from the database on every request.
 *
 * That last part is deliberate. Putting the role in the cookie would mean a user
 * demoted from owner keeps owner access until their session expires, and a stolen
 * cookie stays powerful after the account is downgraded. A database lookup per
 * request costs a few milliseconds and removes both problems.
 */

const COOKIE = 'adspilot_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14

function signingKey(): Buffer {
  // Derived from the vault key rather than adding another secret to manage.
  return createHmac('sha256', required('VAULT_MASTER_KEY')).update('web-session-v2').digest()
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url')
}

export function createSessionToken(userId: string): string {
  const payload = `${userId}.${Date.now()}.${randomBytes(8).toString('base64url')}`
  return `${payload}.${sign(payload)}`
}

export function verifySessionToken(token: string): { userId: string } | null {
  const lastDot = token.lastIndexOf('.')
  if (lastDot <= 0) return null

  const payload = token.slice(0, lastDot)
  const provided = Buffer.from(token.slice(lastDot + 1))
  const expected = Buffer.from(sign(payload))

  // Length-checked first because timingSafeEqual throws on a mismatch, which
  // would itself leak information.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null

  const [userId, issuedAt] = payload.split('.')
  if (userId === undefined || issuedAt === undefined) return null
  if (Date.now() - Number(issuedAt) > MAX_AGE_SECONDS * 1000) return null

  return { userId }
}

export async function startSession(userId: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function endSession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE)
}

/**
 * The signed-in user, re-read from the database.
 *
 * Returns null if the account has since been deleted, so a valid-looking cookie
 * for a removed user grants nothing.
 */
export async function currentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies()
  const token = store.get(COOKIE)?.value
  if (token === undefined) return null

  const claim = verifySessionToken(token)
  if (claim === null) return null

  return await findUser(claim.userId)
}
