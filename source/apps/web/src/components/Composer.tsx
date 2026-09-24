'use client'

import { useActionState, useState } from 'react'

import { createPost, type ActionResult } from '@/app/actions'

export interface AccountOption {
  readonly id: string
  readonly platform: string
  readonly displayName: string
  readonly needsReauth: boolean
  /** Character limit, so the counter matches whichever selected platform is strictest. */
  readonly maxTextLength: number
  readonly requiresMedia: boolean
}

export function Composer({ accounts }: { accounts: readonly AccountOption[] }) {
  const ready = accounts.filter((a) => !a.needsReauth)
  const [selected, setSelected] = useState<string[]>(() => [...new Set(ready.map((a) => a.platform))])
  const [body, setBody] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createPost, null)

  const toggle = (platform: string): void => {
    setSelected((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    )
  }

  /**
   * Counts graphemes, not code units — the same reason the engine does. An emoji is
   * one character to every platform but up to 11 to String.length, so a naive
   * counter tells the user something false.
   */
  const length = countGraphemes(body)
  const chosen = accounts.filter((a) => selected.includes(a.platform))
  const limit = chosen.length > 0 ? Math.min(...chosen.map((a) => a.maxTextLength)) : Infinity
  const over = length > limit
  const needsMedia = chosen.some((a) => a.requiresMedia)

  return (
    <form action={action} className="card">
      <h2 className="mb-1 text-base font-semibold">New post</h2>
      <p className="mb-5 text-[0.85rem] text-muted">
        Publish now, or pick a time and the worker sends it.
      </p>

      <div className="mb-4">
        <label htmlFor="body" className="field-label">
          Text
        </label>
        <textarea
          id="body"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What do you want to say?"
          className="min-h-[170px] resize-y leading-relaxed"
        />
        <div className={`mt-1.5 text-[0.78rem] ${over ? 'text-bad' : 'text-muted'}`}>
          {length}
          {Number.isFinite(limit) ? ` / ${limit}` : ''} characters
          {over ? ` — ${length - limit} over the limit` : ''}
        </div>
      </div>

      <div className="mb-4">
        <label htmlFor="media" className="field-label">
          Image or video{needsMedia ? ' (required for Instagram)' : ''}
        </label>
        <input
          id="media"
          name="media"
          type="file"
          accept="image/*,video/*"
          multiple
          className="file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-[0.85rem] file:text-ink"
        />
      </div>

      <div className="mb-4">
        <span className="field-label">Post to</span>
        <div className="flex flex-col gap-2">
          {accounts.length === 0 && (
            <p className="py-2 text-[0.88rem] text-muted">
              No accounts connected yet. Run the connect command.
            </p>
          )}
          {accounts.map((account) => (
            <label
              key={account.id}
              className={`flex items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[0.9rem] ${
                account.needsReauth ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:border-brand/50'
              }`}
            >
              <input
                type="checkbox"
                name="platforms"
                value={account.platform}
                checked={selected.includes(account.platform)}
                disabled={account.needsReauth}
                onChange={() => toggle(account.platform)}
              />
              <span>{account.displayName}</span>
              <span className="text-[0.72rem] uppercase tracking-wide text-muted">
                {account.platform.replace('_', ' ')}
              </span>
              {account.needsReauth && (
                <span className="ml-auto rounded-full border border-bad/40 px-2 py-0.5 text-[0.7rem] text-bad">
                  reconnect
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <label className="flex cursor-pointer items-center gap-2 text-[0.88rem]">
          <input
            type="checkbox"
            checked={scheduling}
            onChange={(e) => setScheduling(e.target.checked)}
          />
          Schedule for later
        </label>
        {scheduling && (
          <input type="datetime-local" name="scheduleAt" required className="mt-2.5" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn" disabled={pending || over || selected.length === 0}>
          {pending ? 'Working…' : scheduling ? 'Schedule post' : 'Publish now'}
        </button>
        {!scheduling && (
          <span className="text-[0.78rem] text-muted">
            This posts publicly and cannot be undone here.
          </span>
        )}
      </div>

      {state !== null && (
        <div
          className={`mt-4 rounded-lg border p-3.5 text-[0.88rem] ${
            state.ok ? 'border-ok/30 bg-ok/10' : 'border-bad/30 bg-bad/10'
          }`}
        >
          {state.message}
          {state.details !== undefined && state.details.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {state.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  )
}

function countGraphemes(text: string): number {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (Segmenter === undefined) return [...text].length
  let count = 0
  for (const _ of new Segmenter('en', { granularity: 'grapheme' }).segment(text)) count += 1
  return count
}
