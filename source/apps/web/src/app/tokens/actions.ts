'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { TokenError, issueToken, revokeToken } from '@social-publisher/auth'

import { currentUser } from '@/lib/auth'
import { scope } from '@/lib/engine'

export interface TokenResult {
  readonly ok: boolean
  readonly message: string
  /**
   * The new token, returned exactly once.
   *
   * It is not stored anywhere recoverable, so if the user misses it here it is
   * gone for good and they must create another. The UI says so plainly rather
   * than letting them assume they can come back for it.
   */
  readonly token?: string
}

export async function createToken(_prev: unknown, formData: FormData): Promise<TokenResult> {
  const user = await currentUser()
  if (user === null) redirect('/login')

  const name = String(formData.get('name') ?? '').trim()
  const expiry = String(formData.get('expiry') ?? '').trim()

  try {
    const issued = await issueToken({
      userId: user.id,
      name,
      ...(expiry !== '' && expiry !== 'never' ? { expiresInDays: Number(expiry) } : {}),
    })

    await scope(user.tenantId).record(`user:${user.email}`, 'token.created', {
      tokenId: issued.id,
      name: issued.name,
      // The prefix only — never the token itself, not even in our own audit log.
      prefix: issued.prefix,
    })

    revalidatePath('/tokens')
    return {
      ok: true,
      message: `Created "${issued.name}". Copy it now — it cannot be shown again.`,
      token: issued.token,
    }
  } catch (error) {
    if (error instanceof TokenError) return { ok: false, message: error.message }
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not create the token.',
    }
  }
}

export async function revoke(formData: FormData): Promise<void> {
  const user = await currentUser()
  if (user === null) redirect('/login')

  const tokenId = String(formData.get('tokenId') ?? '')
  // Scoped by user id inside revokeToken, so another account's token is a no-op
  // rather than an error — the caller learns nothing about tokens that are not theirs.
  const revoked = await revokeToken(user.id, tokenId)

  if (revoked) {
    await scope(user.tenantId).record(`user:${user.email}`, 'token.revoked', { tokenId })
  }
  revalidatePath('/tokens')
}
