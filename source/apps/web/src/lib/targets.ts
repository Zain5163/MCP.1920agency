import { carriesNotice } from '@social-publisher/db'

/**
 * How the dashboard draws one target of a recent post.
 *
 * Decided here, from the row alone, rather than in the page: what a row means
 * has rules (a notice is not a stale error, a published target is never
 * retried) and they are tested here. No platform is named: a notice is
 * recognised by the code it was stored with.
 */

export type TargetTone = 'ok' | 'warn' | 'bad' | 'plain'

export interface TargetView {
  /** The word on the target's tag. */
  readonly label: string
  readonly tone: TargetTone
  /**
   * The row beneath the tags, if any: a notice for something that went out
   * with one, the platform's reason for a failure.
   */
  readonly note?: { readonly kind: 'notice' | 'failure'; readonly text: string | null }
  /**
   * Whether a Retry form is offered. Never for anything that went out: a
   * re-run would post a second copy.
   */
  readonly retry: boolean
}

export function targetView(target: {
  readonly state: string
  readonly errorCode: string | null
  readonly platformMessage: string | null
}): TargetView {
  /**
   * A published target that went out with a notice — a video uploaded private
   * until the API audit passes, for one — is not shown as a green "published":
   * the owner would believe a post was public that nobody else can see.
   */
  if (carriesNotice(target)) {
    return { label: 'uploaded', tone: 'warn', note: { kind: 'notice', text: target.platformMessage }, retry: false }
  }
  switch (target.state) {
    case 'published':
      return { label: 'published', tone: 'ok', retry: false }
    case 'failed':
      return { label: 'failed', tone: 'bad', note: { kind: 'failure', text: target.platformMessage }, retry: true }
    case 'needs_reauth':
      return { label: 'needs_reauth', tone: 'plain', note: { kind: 'failure', text: target.platformMessage }, retry: true }
    case 'scheduled':
      return { label: 'scheduled', tone: 'warn', retry: false }
    default:
      return { label: target.state, tone: 'plain', retry: false }
  }
}

/** The tag classes for a tone. */
export function toneClasses(tone: TargetTone): string {
  if (tone === 'ok') return 'border-ok/35 text-ok'
  if (tone === 'warn') return 'border-warn/35 text-warn'
  if (tone === 'bad') return 'border-bad/35 text-bad'
  return ''
}
