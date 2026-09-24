import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>

/**
 * Password hashing.
 *
 * scrypt from Node's own crypto rather than bcrypt or argon2 from npm. Two
 * reasons: it is memory-hard (so GPU cracking is expensive, which is the whole
 * point), and it means no third-party package sits in the path that handles raw
 * passwords. Fewer dependencies in the auth path is fewer supply-chain risks in
 * the place where a compromise is worst.
 *
 * Stored format: scrypt$N$r$p$salt$hash — self-describing, so parameters can be
 * raised later without invalidating existing passwords. Old hashes keep verifying
 * with their own recorded cost.
 */

/** ~100ms per hash on typical hardware in 2026. Raise as machines get faster. */
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 } as const
const SALT_BYTES = 16

export class PasswordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordError'
  }
}

export interface PasswordPolicy {
  readonly ok: boolean
  readonly problems: readonly string[]
}

/**
 * Length over character classes, deliberately.
 *
 * Forced symbols and digits push people toward "Password1!" — predictable, and
 * weaker than a longer passphrase. Length is what actually costs an attacker.
 */
export function checkPasswordStrength(password: string): PasswordPolicy {
  const problems: string[] = []

  if (password.length < 12) problems.push('Use at least 12 characters — length matters more than symbols.')
  if (password.length > 200) problems.push('That is longer than 200 characters.')
  if (/^\s|\s$/.test(password)) problems.push('Remove the leading or trailing space — it is easy to lose.')

  const common = ['password', '12345678', 'qwerty', 'letmein', 'admin', 'welcome', 'iloveyou']
  if (common.some((c) => password.toLowerCase().includes(c))) {
    problems.push('That contains a very common password — pick something less guessable.')
  }
  if (/^(.)\1+$/.test(password)) problems.push('That is a single repeated character.')

  return { ok: problems.length === 0, problems }
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password === '') {
    throw new PasswordError('A password is required.')
  }
  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(password, salt, PARAMS.keylen)
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

/**
 * Verifies a password. Returns false rather than throwing on a malformed hash, so
 * a corrupt row is a failed login rather than a crash — and so the caller cannot
 * distinguish "bad password" from "bad record" by watching for exceptions.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof stored !== 'string') return false

  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts
  const N = Number(nRaw)
  const keylenFromHash = Buffer.from(hashRaw!, 'base64').length

  if (!Number.isInteger(N) || N < 1024 || keylenFromHash === 0) return false

  try {
    const salt = Buffer.from(saltRaw!, 'base64')
    const expected = Buffer.from(hashRaw!, 'base64')
    const derived = await scrypt(password, salt, keylenFromHash)
    // Constant time: a byte-by-byte compare leaks how much of the hash matched.
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/** True when a stored hash uses weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true
  return Number(parts[1]) < PARAMS.N
}
