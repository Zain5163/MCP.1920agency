'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { currentUser } from '@/lib/auth'
import { scope } from '@/lib/engine'

/**
 * Retrying a failed target.
 *
 * Scoped by tenant inside `retryTarget`, and it refuses anything already
 * published — re-running a successful publish would post a second copy, which is
 * worse than the failure it might be fixing.
 */
export async function retryTarget(formData: FormData): Promise<void> {
  const user = await currentUser()
  if (user === null) redirect('/login')

  const targetId = String(formData.get('targetId') ?? '')
  if (targetId === '') return

  const outcome = await scope(user.tenantId).retryTarget(targetId)

  if (outcome === 'queued') {
    await scope(user.tenantId).record(`user:${user.email}`, 'post.retried', { targetId })
  }

  revalidatePath('/')
  revalidatePath('/scheduled')
}
