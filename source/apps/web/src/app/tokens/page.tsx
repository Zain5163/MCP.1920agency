import Link from 'next/link'
import { redirect } from 'next/navigation'

import { listTokens } from '@social-publisher/auth'
import { mcpPublicUrl, productSlug } from '@social-publisher/config'

import { logout } from '../actions'
import { currentUser } from '@/lib/auth'
import { TokenManager, type TokenRow } from '@/components/TokenManager'
import { Wordmark } from '@/components/Wordmark'

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

  // MCP_PUBLIC_URL, else PUBLIC_BASE_URL/mcp, else this machine (packages/config product.ts).
  const mcpUrl = mcpPublicUrl()

  return (
    <div className="mx-auto max-w-[800px] px-4 pb-16 pt-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <div className="flex items-center gap-5">
          <Link href="/" className="text-lg font-bold tracking-tight text-ink no-underline">
            <Wordmark />
          </Link>
          <Link href="/" className="text-[0.85rem] text-muted no-underline hover:text-ink">
            Dashboard
          </Link>
          <Link href="/accounts" className="text-[0.85rem] text-muted no-underline hover:text-ink">
            Accounts
          </Link>
          <Link href="/scheduled" className="text-[0.85rem] text-muted no-underline hover:text-ink">
            Scheduled
          </Link>
          <span className="text-[0.85rem] text-ink">API tokens</span>
        </div>
        <form action={logout}>
          <button type="submit" className="btn-ghost">
            Sign out
          </button>
        </form>
      </header>

      <TokenManager tokens={rows} mcpUrl={mcpUrl} serverKey={productSlug()} />
    </div>
  )
}
