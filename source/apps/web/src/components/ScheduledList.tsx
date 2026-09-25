'use client'

import { useActionState, useState } from 'react'

import { cancelScheduled, type CancelResult } from '@/app/scheduled/actions'
import { formatDateTime } from '@/lib/format'
import { PlatformBadge, humanisePlatform } from '@/components/PlatformBadge'

export interface ScheduledItem {
  readonly targetId: string
  readonly postId: string
  readonly body: string
  readonly accountName: string
  readonly platform: string
  readonly platformLabel: string
  readonly platformAccent?: string | undefined
  readonly scheduledFor: string
  readonly state: string
  readonly mediaCount: number
}

export function ScheduledList({ items }: { items: readonly ScheduledItem[] }) {
  const [state, action] = useActionState<CancelResult | null, FormData>(cancelScheduled, null)
  const [confirming, setConfirming] = useState<string | null>(null)

  if (items.length === 0) {
    return (
      <section className="card">
        <h2 className="mb-1 text-base font-semibold">Scheduled</h2>
        <p className="py-2 text-[0.88rem] text-muted">
          Nothing scheduled. Posts queued from the dashboard or by your AI appear here, and can
          be cancelled up until they publish.
        </p>
      </section>
    )
  }

  // Group by post: one post to three accounts is three targets, and cancelling
  // one should not imply cancelling the others.
  const byPost = new Map<string, ScheduledItem[]>()
  for (const item of items) {
    const existing = byPost.get(item.postId) ?? []
    existing.push(item)
    byPost.set(item.postId, existing)
  }

  return (
    <section className="card">
      <h2 className="mb-1 text-base font-semibold">Scheduled</h2>
      <p className="mb-4 text-[0.85rem] text-muted">
        Cancel any time before it publishes. Each account is cancelled separately.
      </p>

      {state !== null && (
        <div
          className={`mb-4 rounded-lg border p-3 text-[0.88rem] ${
            state.ok ? 'border-ok/30 bg-ok/10' : 'border-bad/30 bg-bad/10'
          }`}
        >
          {state.message}
        </div>
      )}

      {[...byPost.entries()].map(([postId, targets]) => (
        <article key={postId} className="border-b border-line py-4 last:border-b-0">
          <p className="mb-2 whitespace-pre-wrap text-[0.88rem]">
            {targets[0]!.body.length > 200
              ? `${targets[0]!.body.slice(0, 200)}…`
              : targets[0]!.body || '(no text)'}
          </p>

          {targets[0]!.mediaCount > 0 && (
            <p className="mb-2 text-[0.78rem] text-muted">
              {targets[0]!.mediaCount} attachment{targets[0]!.mediaCount === 1 ? '' : 's'}
            </p>
          )}

          <div className="flex flex-col gap-2">
            {targets.map((target) => (
              <div
                key={target.targetId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[0.88rem]">{target.accountName}</span>
                    <PlatformBadge label={target.platformLabel} accent={target.platformAccent} />
                  </div>
                  <div className="text-[0.76rem] text-muted">
                    {formatDateTime(target.scheduledFor)}
                  </div>
                </div>

                {confirming === target.targetId ? (
                  <form action={action} className="flex items-center gap-2">
                    <input type="hidden" name="targetId" value={target.targetId} />
                    <span className="text-[0.8rem] text-warn">Cancel this?</span>
                    <button type="submit" className="btn-ghost text-bad">
                      Yes, cancel
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setConfirming(null)}
                    >
                      Keep it
                    </button>
                  </form>
                ) : (
                  // Two-step on purpose: an accidental click here means a post
                  // that never goes out, and there is no undo.
                  <button
                    type="button"
                    className="btn-ghost text-bad"
                    onClick={() => setConfirming(target.targetId)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  )
}
