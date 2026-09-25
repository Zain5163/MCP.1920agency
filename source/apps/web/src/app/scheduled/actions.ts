'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { currentUser } from '@/lib/auth'
import { scope } from '@/lib/engine'

/**
 * Cancelling a scheduled post.
 *
 * `cancelTarget` only affects rows belonging to this tenant AND still in a
 * cancellable state, so cancelling something already published, already cancelled,
 * or owned by someone else all fail the same way — as `false`, with no clue about
 * which. The caller learns nothing about posts that are not theirs.
 */

export interface CancelResult {
  readonly ok: boolean
  readonly message: string
}

export async function cancelScheduled(
  _prev: unknown,
  formData: FormData,
): Promise<CancelResult> {
  const user = await currentUser()
  if (user === null) redirect('/login')

  const targetId = String(formData.get('targetId') ?? '')
  if (targetId === '') return { ok: false, message: 'Nothing selected.' }

  const tenant = scope(user.tenantId)
  const cancelled = await tenant.cancelTarget(targetId)

  if (!cancelled) {
    return {
      ok: false,
      // Deliberately covers every reason without naming which.
      message: 'Could not cancel that — it may have already published, or already been cancelled.',
    }
  }

  await tenant.record(`user:${user.email}`, 'post.cancelled', { targetId })
  revalidatePath('/scheduled')
  revalidatePath('/')

  return { ok: true, message: 'Cancelled. It will not be published.' }
}
