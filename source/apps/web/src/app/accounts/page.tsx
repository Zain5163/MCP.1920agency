import Link from 'next/link'
import { redirect } from 'next/navigation'

import { CAPABILITIES } from '@social-publisher/core'

import { logout } from '../actions'
import { listAvailable } from './actions'
import { currentUser } from '@/lib/auth'
import { scope } from '@/lib/engine'
import { AccountManager, type ConnectedRow } from '@/components/AccountManager'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  const user = await currentUser()
  if (user === null) redirect('/login')

  const connections = await scope(user.tenantId).connections()
  const connected: ConnectedRow[] = connections.map((c) => ({
    id: c.id,
    platform: c.platform,
    platformLabel:
      CAPABILITIES[c.platform].preview?.accountLabel ?? c.platform.replace('_', ' '),
    platformAccent: CAPABILITIES[c.platform].preview?.accent,
    displayName: c.displayName,
    needsReauth: c.needsReauth,
    reauthReason: c.reauthReason,
  }))

  // Reaches out to Meta, so it can fail independently of the page rendering.
  const { accounts, error } = await listAvailable()

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
          <span className="text-[0.85rem] text-ink">Accounts</span>
          <Link href="/scheduled" className="text-[0.85rem] text-muted no-underline hover:text-ink">
            Scheduled
          </Link>
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

      <AccountManager
        available={accounts}
        connected={connected}
        {...(error !== undefined ? { loadError: error } : {})}
      />
    </div>
  )
}
