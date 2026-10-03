import { confirmationToken } from '@social-publisher/core'

/**
 * Which publish approvals have been used, so that each one publishes once.
 *
 * An approval token is an HMAC over the payload and is valid for the life of
 * the process. It used to work any number of times. An MCP client that gives
 * up on a long upload (its timeout, the user pressing Esc, an idle limit) never
 * sees the result; the model calls again with the same token, and a second
 * copy of the video went up. Now a token is spent the moment it is accepted,
 * and a repeat is told where the first use went.
 *
 * Sending the same content again stays possible, on purpose: a post can fail
 * and be worth sending later. But an approval for content already sent in this
 * process is a different approval (its payload counts the earlier sends), so
 * it needs a fresh yes from the person, and the summary they are shown says
 * it is a repeat.
 *
 * In memory: a token only ever works in the process that issued it, because
 * the secret behind it is made per process (policy.ts), so a record kept as
 * long as the process is kept as long as the token.
 */

export interface ApprovalUse {
  /** The post this approval was used for, once it exists. */
  readonly postId: string | undefined
  /** Whether the publish it started has finished. */
  readonly finished: boolean
}

/** Earlier sends of the same content in this process. */
export interface EarlierSends {
  readonly count: number
  readonly lastPostId: string | undefined
}

/** The approval to ask for, and how to record its use. */
export interface Approval {
  /** The payload to approve: the content's own, plus how often it was sent before. */
  readonly payload: Record<string, unknown>
  /** Earlier sends of this content, for the summary; undefined for a first send. */
  readonly earlier: EarlierSends | undefined
  readonly contentKey: string
}

export interface ClaimedApproval {
  /** Records the post the approval was used for. */
  attach(postId: string): void
  /** Records that the publish has finished, whatever its outcome. */
  finish(): void
  /** Gives the approval back: nothing was sent, so it may be used again. */
  release(): void
}

export class ApprovalLedger {
  readonly #used = new Map<string, { postId: string | undefined; finished: boolean }>()
  readonly #sends = new Map<string, { count: number; lastPostId: string | undefined }>()

  /** How a token was used, if it was. */
  useOf(token: string): ApprovalUse | undefined {
    const use = this.#used.get(token)
    return use === undefined ? undefined : { ...use }
  }

  /** The approval to ask for, for this action and content. */
  approvalFor(action: string, content: Record<string, unknown>): Approval {
    const contentKey = confirmationToken(action, content)
    const sends = this.#sends.get(contentKey)
    if (sends === undefined || sends.count === 0) return { payload: content, earlier: undefined, contentKey }
    return { payload: { ...content, sentBefore: sends.count }, earlier: { ...sends }, contentKey }
  }

  /**
   * Marks a token used. Synchronous, so a repeat already on its way in finds
   * it spent; the caller claims before its first await after the approval.
   */
  claim(token: string, approval: Approval): ClaimedApproval {
    const before = this.#sends.get(approval.contentKey)
    const count = (before?.count ?? 0) + 1
    this.#used.set(token, { postId: undefined, finished: false })
    this.#sends.set(approval.contentKey, { count, lastPostId: before?.lastPostId })

    return {
      attach: (postId) => {
        const use = this.#used.get(token)
        if (use !== undefined) use.postId = postId
        const sends = this.#sends.get(approval.contentKey)
        if (sends !== undefined) sends.lastPostId = postId
      },
      finish: () => {
        const use = this.#used.get(token)
        if (use !== undefined) use.finished = true
      },
      release: () => {
        this.#used.delete(token)
        // Only undone if nothing else was sent since, which would have moved it on.
        if (this.#sends.get(approval.contentKey)?.count === count) {
          if (before === undefined) this.#sends.delete(approval.contentKey)
          else this.#sends.set(approval.contentKey, before)
        }
      },
    }
  }
}

/** This process's approvals, shared by every request on either transport. */
export const APPROVALS = new ApprovalLedger()

/** What a call with an already used approval is told, instead of a second publish. */
export function alreadyUsedText(use: ApprovalUse): string {
  if (!use.finished) {
    return [
      `This approval is being used right now${use.postId !== undefined ? `: post ${use.postId} is still being sent` : ''}.`,
      'A large video can take a while. Do not call publish_post again: check list_posts in a few minutes to see how it went.',
    ].join('\n')
  }
  return [
    `This approval was already used${use.postId !== undefined ? `, for post ${use.postId}` : ''}. An approval publishes once.`,
    'Check list_posts to see how each account went. To send the same content again, call publish_post without',
    'confirm: the user is shown a new summary, which says it was sent before, and must approve that one.',
  ].join('\n')
}

/** The line a summary of content already sent in this process starts with. */
export function repeatLine(earlier: EarlierSends): string {
  return (
    `ALREADY SENT ${earlier.count === 1 ? 'once' : `${earlier.count} times`} in this session` +
    `${earlier.lastPostId !== undefined ? `, last as post ${earlier.lastPostId}` : ''}: approving sends it again. ` +
    'Check list_posts first.'
  )
}
