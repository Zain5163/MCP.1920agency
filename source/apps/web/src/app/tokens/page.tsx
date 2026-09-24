import Link from 'next/link'
import { redirect } from 'next/navigation'

import { listTokens } from '@social-publisher/auth'
import { optional } from '@social-publisher/config'

import { logout } from '../actions'
import { currentUser } from '@/lib/auth'
import { TokenManager, type TokenRow } from '@/components/TokenManager'

export const dynamic = 'force-dynamic'

export default async function TokensPage() {
  const user = await currentUser()
  if (user === null) redirect('/login')

  const tokens = await listTokens(user.id)

  // Dates are serialised because this crosses into a client component, where a
  // Date object would not survive the boundary intact.
  const rows: TokenRow[] = tokens.map((t) => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  }))

  const mcpUrl = optional('MCP_PUBLIC_URL', 'http://localhost:8080/mcp')!

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
          <span className="text-[0.85rem] text-ink">API tokens</span>
        </div>
        <form action={logout}>
          <button type="submit" className="btn-ghost">
            Sign out
          </button>
        </form>
      </header>

      <TokenManager tokens={rows} mcpUrl={mcpUrl} />
    </div>
  )
}
