import Link from 'next/link'
import { redirect } from 'next/navigation'

import { CAPABILITIES } from '@social-publisher/core'
import { health, queueStats } from '@social-publisher/db'

import { logout } from './actions'
import { retryTarget } from './retry-actions'
import { currentUser } from '@/lib/auth'
import { listConnections, scope } from '@/lib/engine'
import { formatDateTime } from '@/lib/format'
import { targetView, toneClasses } from '@/lib/targets'
import { Composer, type AccountOption } from '@/components/Composer'
import { PlatformBadge, humanisePlatform } from '@/components/PlatformBadge'
import { Wordmark } from '@/components/Wordmark'

export const dynamic = 'force-dynamic'

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const colour = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-muted'
  return (
    <div className="flex justify-between border-b border-line py-2 text-[0.88rem] last:border-b-0">
      <span>{label}</span>
      <span className={colour}>{value}</span>
    </div>
  )
}

export default async function Dashboard() {
  const user = await currentUser()
  if (user === null) redirect('/login')

  const [connections, dbState, queue, posts] = await Promise.all([
    listConnections(user.tenantId),
    health(),
    queueStats(),
    scope(user.tenantId).posts(12),
  ])

  const accounts: AccountOption[] = connections.map((c) => ({
    id: c.id,
    platform: c.platform,
    displayName: c.displayName,
    needsReauth: c.needsReauth,
    maxTextLength: CAPABILITIES[c.platform].maxTextLength,
    requiresMedia: CAPABILITIES[c.platform].minMediaCount > 0,
    maxMediaCount: CAPABILITIES[c.platform].maxMediaCount,
    preview: CAPABILITIES[c.platform].preview,
  }))

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <div className="flex items-center gap-5">
          <span className="text-lg font-bold tracking-tight">
            <Wordmark />
          </span>
          <Link href="/accounts" className="text-[0.85rem] text-muted no-underline hover:text-ink">
            Accounts
          </Link>
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

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Composer accounts={accounts} />

        <div className="grid gap-5">
          <section className="card">
            <h2 className="mb-1 text-base font-semibold">System</h2>
            <p className="mb-3 text-[0.85rem] text-muted">Live state, not a cached summary.</p>
            <Stat
              label="Database"
              value={dbState.reachable ? `reachable · ${dbState.latencyMs}ms` : 'unreachable'}
              tone={dbState.reachable ? 'ok' : 'bad'}
            />
            <Stat
              label="Keep-alive"
              value={
                dbState.heartbeatAgeDays === undefined
                  ? 'never run'
                  : `${dbState.heartbeatAgeDays}d ago${dbState.pauseRisk ? ' · pause risk' : ''}`
              }
              {...(dbState.pauseRisk ? { tone: 'warn' as const } : {})}
            />
            <Stat label="Scheduled" value={`${queue.queued} queued`} />
            <Stat
              label="Failed jobs"
              value={String(queue.failed)}
              {...(queue.failed > 0 ? { tone: 'bad' as const } : {})}
            />
            <Stat
              label="Next run"
              value={queue.nextRunAt === null ? 'nothing queued' : formatDateTime(queue.nextRunAt)}
            />
          </section>

          <section className="card">
            <h2 className="mb-1 text-base font-semibold">Accounts</h2>
            <p className="mb-3 text-[0.85rem] text-muted">Connected via the Meta app.</p>
            {accounts.length === 0 && <p className="py-2 text-[0.88rem] text-muted">Nothing connected yet.</p>}
            {accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 border-b border-line py-2 text-[0.88rem] last:border-b-0"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate">{a.displayName}</span>
                  <PlatformBadge
                    label={a.preview?.accountLabel ?? humanisePlatform(a.platform)}
                    accent={a.preview?.accent}
                  />
                </span>
                <span className={a.needsReauth ? 'text-bad' : 'text-ok'}>
                  {a.needsReauth ? 'needs reconnect' : 'ready'}
                </span>
              </div>
            ))}
          </section>
        </div>
      </div>

      <section className="card mt-5">
        <h2 className="mb-1 text-base font-semibold">Recent posts</h2>
        <p className="mb-3 text-[0.85rem] text-muted">
          Every target tracked separately — partial success is normal.
        </p>
        {posts.length === 0 && <p className="py-2 text-[0.88rem] text-muted">Nothing posted yet.</p>}
        {posts.map((post) => (
          <article key={post.id} className="border-b border-line py-3.5 last:border-b-0">
            <div className="text-[0.76rem] text-muted">{formatDateTime(post.createdAt)}</div>
            <p className="my-1.5 whitespace-pre-wrap text-[0.88rem]">
              {post.body.length > 180 ? `${post.body.slice(0, 180)}…` : post.body}
            </p>
            <div>
              {post.targets.map((target) => (
                <span key={target.id} className={`tag ${toneClasses(targetView(target).tone)}`}>
                  {target.connection.displayName}
                  {' · '}
                  {CAPABILITIES[target.connection.platform].preview?.accountLabel ??
                    humanisePlatform(target.connection.platform)}
                  {' · '}
                  {targetView(target).label}
                  {target.platformUrl !== null && (
                    <>
                      {' '}
                      <a
                        href={target.platformUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        view
                      </a>
                    </>
                  )}
                </span>
              ))}
            </div>
            {post.targets.map((t) => {
              const view = targetView(t)
              if (view.note === undefined) return null
              // A notice is shown in the warn colour and never with a Retry:
              // the target went out, and re-running it would post twice.
              const notice = view.note.kind === 'notice'
              return (
                <div
                  key={`${t.id}-note`}
                  className={`mt-2 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ${
                    notice ? 'border-warn/25 bg-warn/5' : 'border-bad/25 bg-bad/5'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className={`flex flex-wrap items-center gap-2 text-[0.82rem] ${notice ? 'text-warn' : 'text-bad'}`}
                    >
                      <span>{t.connection.displayName}</span>
                      <PlatformBadge
                        label={
                          CAPABILITIES[t.connection.platform].preview?.accountLabel ??
                          humanisePlatform(t.connection.platform)
                        }
                        accent={CAPABILITIES[t.connection.platform].preview?.accent}
                      />
                      {view.note.text !== null && <span>{view.note.text}</span>}
                    </div>
                    {t.state === 'needs_reauth' && view.retry && (
                      <div className="text-[0.76rem] text-muted">
                        Reconnect this account first, then retry.
                      </div>
                    )}
                    {view.noRetry !== undefined && <div className="text-[0.76rem] text-muted">{view.noRetry}</div>}
                  </div>
                  {/* Only failures get a retry button — a published target must
                      never be re-run, or it posts twice. */}
                  {view.retry && (
                    <form action={retryTarget}>
                      <input type="hidden" name="targetId" value={t.id} />
                      <button type="submit" className="btn-ghost text-[0.8rem]">
                        Retry
                      </button>
                    </form>
                  )}
                </div>
              )
            })}
          </article>
        ))}
      </section>
    </div>
  )
}
