import Link from 'next/link'
import { redirect } from 'next/navigation'

import { CAPABILITIES } from '@social-publisher/core'
import { db } from '@social-publisher/db'

import { logout } from '../actions'
import { currentUser } from '@/lib/auth'
import { ScheduledList, type ScheduledItem } from '@/components/ScheduledList'

export const dynamic = 'force-dynamic'

export default async function ScheduledPage() {
  const user = await currentUser()
  if (user === null) redirect('/login')

  /**
   * Scoped by tenant in the query itself.
   *
   * Only `scheduled` and `pending` are listed — anything already publishing or
   * published cannot be stopped, and offering a cancel button for it would be a
   * lie.
   */
  const targets = await db().target.findMany({
    where: { tenantId: user.tenantId, state: { in: ['scheduled', 'pending'] } },
    orderBy: { scheduledFor: 'asc' },
    include: {
      connection: true,
      post: { include: { _count: { select: { media: true } } } },
    },
  })

  const items: ScheduledItem[] = targets.map((t) => ({
    targetId: t.id,
    postId: t.postId,
    body: t.post.body,
    accountName: t.connection.displayName,
    platform: t.connection.platform,
    platformLabel:
      CAPABILITIES[t.connection.platform].preview?.accountLabel ??
      t.connection.platform.replace('_', ' '),
    platformAccent: CAPABILITIES[t.connection.platform].preview?.accent,
    scheduledFor: (t.scheduledFor ?? t.createdAt).toISOString(),
    state: t.state,
    mediaCount: t.post._count.media,
  }))

  return (
    <div className="mx-auto max-w-[800px] px-4 pb-16 pt-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <div className="flex items-center gap-5">
          <Link href="/" className="text-lg font-bold tracking-tight text-ink no-underline">
            Ads<span className="text-brand">Pilot</span>
          </Link>
          <Link href="/" className="text-[0.85rem] text-muted no-underline hover:text-ink">
            Dashboard
          </Link>
          <Link href="/accounts" className="text-[0.85rem] text-muted no-underline hover:text-ink">
            Accounts
          </Link>
          <span className="text-[0.85rem] text-ink">Scheduled</span>
          <Link href="/tokens" className="text-[0.85rem] text-muted no-underline hover:text-ink">
            API tokens
          </Link>
        </div>
        <form action={logout}>
          <button type="submit" className="btn-ghost">
            Sign out
          </button>
        </form>
      </header>

      <ScheduledList items={items} />
    </div>
  )
}
