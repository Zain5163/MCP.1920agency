import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

import { optional, required } from '@social-publisher/config'

/**
 * Session auth.
 *
 * Deliberately minimal but not fake. The session cookie is an HMAC-signed token,
 * so it cannot be forged without the vault key, and it is httpOnly so client-side
 * script cannot read it.
 *
 * This is single-operator auth for now. When the platform serves multiple clients
 * it needs real user accounts and per-user tenant scoping — but the cookie already
 * carries a tenant id, so that change does not reshape the session model.
 */

const COOKIE = 'adspilot_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function signingKey(): Buffer {
  // Derived from the vault key rather than adding another secret to manage.
  return createHmac('sha256', required('VAULT_MASTER_KEY')).update('web-session-v1').digest()
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url')
}

export function createSessionToken(tenantId: string): string {
  const payload = `${tenantId}.${Date.now()}.${randomBytes(8).toString('base64url')}`
  return `${payload}.${sign(payload)}`
}

export function verifySessionToken(token: string): { tenantId: string } | null {
  const lastDot = token.lastIndexOf('.')
  if (lastDot <= 0) return null

  const payload = token.slice(0, lastDot)
  const provided = Buffer.from(token.slice(lastDot + 1))
  const expected = Buffer.from(sign(payload))

  // Constant-time, and length-checked first because timingSafeEqual throws on a
  // length mismatch — which would itself leak information.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null

  const [tenantId, issuedAt] = payload.split('.')
  if (tenantId === undefined || issuedAt === undefined) return null
  if (Date.now() - Number(issuedAt) > MAX_AGE_SECONDS * 1000) return null

  return { tenantId }
}

/** Compares in constant time so the password cannot be guessed character by character. */
export function passwordMatches(attempt: string): boolean {
  const expected = optional('APP_PASSWORD')
  if (expected === undefined || expected === '') return false

  const a = Buffer.from(attempt)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function startSession(tenantId: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIE, createSessionToken(tenantId), {
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

export async function currentSession(): Promise<{ tenantId: string } | null> {
  const store = await cookies()
  const token = store.get(COOKIE)?.value
  return token === undefined ? null : verifySessionToken(token)
}

export function isAuthConfigured(): boolean {
  const password = optional('APP_PASSWORD')
  return password !== undefined && password.length >= 8
}
