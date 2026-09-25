'use client'

import { useActionState, useState } from 'react'

import { createPost, type ActionResult } from '@/app/actions'
import { MediaPicker, type PickedFile } from '@/components/MediaPicker'
import { PostPreview, type PreviewStyle, type PreviewTarget } from '@/components/PostPreview'
import { PerPlatformText, type PlatformTextTarget } from '@/components/PerPlatformText'
import { PlatformBadge, humanisePlatform } from '@/components/PlatformBadge'
import { countGraphemes } from '@/lib/text'

export interface AccountOption {
  readonly id: string
  readonly platform: string
  readonly displayName: string
  readonly needsReauth: boolean
  /** Character limit, so the counter matches whichever selected platform is strictest. */
  readonly maxTextLength: number
  readonly requiresMedia: boolean
  readonly maxMediaCount: number
  /** Absent when the platform has no preview data yet. */
  readonly preview?: PreviewStyle | undefined
}

export function Composer({ accounts }: { accounts: readonly AccountOption[] }) {
  const ready = accounts.filter((a) => !a.needsReauth)
  const [selected, setSelected] = useState<string[]>(() => [...new Set(ready.map((a) => a.platform))])
  const [body, setBody] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [media, setMedia] = useState<readonly PickedFile[]>([])
  const [perPlatform, setPerPlatform] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
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

  /**
   * The strictest limit across the chosen platforms governs, the same way the
   * character counter does. Offering 20 slots when one selected platform allows
   * 10 would just move the failure to publish time.
   */
  const maxMedia = chosen.length > 0 ? Math.min(...chosen.map((a) => a.maxMediaCount)) : 10
  const missingMedia = needsMedia && media.length === 0

  // One preview per selected account that has preview data.
  const previewTargets: PreviewTarget[] = chosen
    .filter((a) => a.preview !== undefined)
    .map((a) => ({
      platform: a.platform,
      accountName: a.displayName,
      style: a.preview!,
      // The preview shows what will actually publish for that platform.
      body: overrides[a.platform]?.trim() !== '' ? overrides[a.platform] : undefined,
    }))

  // One entry per distinct platform, not per account: an override applies to the
  // platform, and two Pages on the same platform share it.
  const textTargets: PlatformTextTarget[] = [...new Map(chosen.map((a) => [a.platform, a])).values()].map(
    (a) => ({
      platform: a.platform,
      label: a.preview?.label ?? a.platform.replace('_', ' '),
      accent: a.preview?.accent ?? '#7c5cff',
      maxTextLength: a.maxTextLength,
      truncateAt: a.preview?.captionTruncateAt,
    }),
  )

  /**
   * An override that is too long blocks publishing, exactly like the shared text.
   * Without this the button would look fine and the server would refuse.
   */
  const overrideTooLong = textTargets.some((t) => {
    const value = overrides[t.platform]
    return value !== undefined && value.trim() !== '' && countGraphemes(value) > t.maxTextLength
  })

  return (
    <div className="grid gap-5">
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

      {textTargets.length > 1 && (
        <div className="mb-4">
          <label className="flex cursor-pointer items-center gap-2 text-[0.88rem]">
            <input
              type="checkbox"
              checked={perPlatform}
              onChange={(e) => setPerPlatform(e.target.checked)}
            />
            Write a different caption per platform
          </label>
          {perPlatform && (
            <div className="mt-3">
              <PerPlatformText
                targets={textTargets}
                sharedBody={body}
                overrides={overrides}
                onChange={(platform, value) =>
                  setOverrides((prev) => ({ ...prev, [platform]: value }))
                }
              />
            </div>
          )}
        </div>
      )}

      <div className="mb-4">
        <MediaPicker maxFiles={maxMedia} required={needsMedia} onChange={setMedia} />
        {missingMedia && (
          <p className="mt-1.5 text-[0.78rem] text-warn">
            One of the selected accounts cannot post text on its own — add an image or video.
          </p>
        )}
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
              <span className="truncate">{account.displayName}</span>
              <PlatformBadge
                label={account.preview?.accountLabel ?? humanisePlatform(account.platform)}
                accent={account.preview?.accent}
              />
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
        <button
          type="submit"
          className="btn"
          disabled={pending || over || overrideTooLong || selected.length === 0 || missingMedia}
        >
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

      <PostPreview targets={previewTargets} body={body} media={media} />
    </div>
  )
}
