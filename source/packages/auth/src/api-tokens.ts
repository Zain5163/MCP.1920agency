import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { TenantScope, db } from '@social-publisher/db'

/**
 * API tokens — how a customer's AI client authenticates to the hosted MCP server.
 *
 * **Why SHA-256 here when passwords use scrypt.** A password is low-entropy and
 * guessable, so it needs a deliberately slow hash. A token is 256 bits of
 * randomness — there is nothing to guess, so slow hashing buys nothing and costs a
 * lookup on every single MCP call. It also lets us find a token by indexed hash in
 * one query instead of scrypt-comparing every row.
 *
 * The plaintext token exists exactly once, at creation, and is never recoverable.
 */

const PREFIX = 'adsp_'
const TOKEN_BYTES = 32

export class TokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenError'
  }
}

export interface IssuedToken {
  readonly id: string
  readonly name: string
  /** Shown once. Never stored, never recoverable. */
  readonly token: string
  readonly prefix: string
  readonly expiresAt: Date | null
}

export interface TokenIdentity {
  readonly tokenId: string
  readonly tenantId: string
  readonly userId: string
  readonly scope: TenantScope
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function issueToken(options: {
  userId: string
  name: string
  expiresInDays?: number
}): Promise<IssuedToken> {
  const name = options.name.trim()
  if (name === '') throw new TokenError('Give the token a name so you can recognise it later.')

  const user = await db().user.findUnique({
    where: { id: options.userId },
    select: { id: true, tenantId: true },
  })
  if (user === null) throw new TokenError('No such user.')

  const token = `${PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`
  const expiresAt =
    options.expiresInDays !== undefined
      ? new Date(Date.now() + options.expiresInDays * 86_400_000)
      : null

  const row = await db().apiToken.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      name,
      tokenHash: hashToken(token),
      // Enough to distinguish tokens in a list, far too little to reconstruct one.
      prefix: token.slice(0, PREFIX.length + 6),
      expiresAt,
    },
  })

  return { id: row.id, name: row.name, token, prefix: row.prefix, expiresAt }
}

/**
 * Resolves a bearer token to the account it acts for.
 *
 * Returns null for every failure — unknown, revoked, expired, malformed — so a
 * caller cannot tell which, and cannot use the difference to probe for valid
 * tokens.
 *
 * **This is the single point where a hosted MCP request becomes a tenant.** If it
 * is wrong, one customer's AI reaches another customer's accounts.
 */
export async function identifyToken(raw: string | undefined): Promise<TokenIdentity | null> {
  if (typeof raw !== 'string') return null

  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw.trim()
  if (!token.startsWith(PREFIX) || token.length < PREFIX.length + 20) return null

  const row = await db().apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, tenantId: true, userId: true, revokedAt: true, expiresAt: true, tokenHash: true },
  })
  if (row === null) return null

  // The unique index already matched, so this is belt-and-braces against a
  // future change that makes lookup non-exact.
  const a = Buffer.from(row.tokenHash)
  const b = Buffer.from(hashToken(token))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  if (row.revokedAt !== null) return null
  if (row.expiresAt !== null && row.expiresAt.getTime() < Date.now()) return null

  // Fire-and-forget: a failed timestamp update must never fail the request.
  void db()
    .apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})

  return {
    tokenId: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    scope: new TenantScope(row.tenantId),
  }
}

/** Lists a user's tokens. Never returns anything that could reconstruct one. */
export async function listTokens(userId: string) {
  return await db().apiToken.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  })
}

/**
 * Revokes a token. Scoped by user, so revoking someone else's is a no-op rather
 * than an error — the caller learns nothing about tokens that are not theirs.
 */
export async function revokeToken(userId: string, tokenId: string): Promise<boolean> {
  const result = await db().apiToken.updateMany({
    where: { id: tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return result.count > 0
}
