import { createHmac } from 'node:crypto'

import { PublishError, classifyNetworkError } from '@social-publisher/core'

import { graphError, type GraphErrorBody } from './meta-errors.ts'

/**
 * Managing a Facebook Page after posting: comments, reviews, the Messenger
 * inbox and insights (roadmap 5b.7, built 2026-10-02).
 *
 * Permissions, beyond the posting ones:
 *
 * | What | Permission |
 * |---|---|
 * | Read comments, reviews | `pages_read_user_content`, `pages_read_engagement` |
 * | Reply to, hide, delete comments | `pages_manage_engagement` |
 * | Read and answer Messenger | `pages_messaging` |
 * | Insights | `read_insights` |
 *
 * They work on Pages the owner manages while the Meta app is in development
 * mode; serving customers' Pages needs App Review for each.
 *
 * Every write here is something a person sees under the business's name. This
 * class does not decide whether a write may happen: the MCP layer asks for
 * approval first, except for hiding a comment, which is reversible and visible
 * to nobody new.
 */

const GRAPH = 'https://graph.facebook.com'

/** Meta allows a free reply only within 24 hours of the person's last message. */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000

export interface PageComment {
  readonly id: string
  readonly postId: string
  readonly postText: string
  readonly message: string
  /** Undefined when Meta withholds who wrote it. */
  readonly author?: string
  readonly authorId?: string
  readonly createdAt: Date
  readonly hidden: boolean
  readonly canHide: boolean
  /** Whether the Page has already replied in this comment's thread. */
  readonly answered: boolean
  readonly replies: number
  /** Why it looks like spam, if it does. A hint for a person, never an automatic action. */
  readonly spamSignals: readonly string[]
}

export interface PageReview {
  readonly createdAt: Date
  readonly recommends: boolean
  readonly text: string
  readonly reviewer?: string
}

export interface PageConversation {
  readonly id: string
  readonly customerId?: string
  readonly customer?: string
  readonly updatedAt: Date
  /** Newest first. */
  readonly messages: ReadonlyArray<{ from: 'customer' | 'page'; text: string; at: Date }>
  /** When the customer last wrote. Undefined if they never have in what was read. */
  readonly lastFromCustomer?: Date
  /** Whether a reply is allowed now under Meta's 24-hour rule. */
  readonly canReply: boolean
  /** Whether the customer is waiting: their message is the newest. */
  readonly waiting: boolean
}

export interface InsightValue {
  readonly metric: string
  readonly total: number
}

/**
 * Signs of spam, deliberately simple and shown as reasons.
 *
 * A comment is never hidden because of these on its own. A criticism with a
 * link is still a customer.
 */
export function spamSignals(message: string): string[] {
  const out: string[] = []
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|xyz|top|io|link|info)\b/i.test(message)) out.push('contains a link')
  if (/\b(whats\s*app|telegram|dm me|inbox me|message me)\b/i.test(message)) out.push('asks people to move to private chat')
  if (/\b(crypto|bitcoin|forex|investment plan|earn \$?\d+|giveaway|winner)\b/i.test(message)) out.push('money or prize bait')
  if (/(\+?\d[\d\s-]{9,}\d)/.test(message)) out.push('contains a phone number')
  return out
}

export class FacebookPageEngagement {
  readonly #version: string
  readonly #appSecret: string | undefined
  readonly #fetch: typeof globalThis.fetch
  readonly #now: () => Date

  constructor(options: { apiVersion?: string; appSecret?: string; fetch?: typeof globalThis.fetch; now?: () => Date } = {}) {
    this.#version = options.apiVersion ?? 'v25.0'
    this.#appSecret = options.appSecret
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#now = options.now ?? (() => new Date())
  }

  /** Comments on the Page's recent posts, newest first. */
  async comments(pageId: string, token: string, options: { posts?: number; perPost?: number } = {}): Promise<PageComment[]> {
    const data = (await this.#call('GET', `${pageId}/published_posts`, token, {
      fields:
        `id,message,comments.summary(true).filter(toplevel).order(reverse_chronological).limit(${options.perPost ?? 25})` +
        '{id,message,from{id,name},created_time,is_hidden,can_hide,comment_count,comments.limit(10){from{id}}}',
      limit: String(options.posts ?? 10),
    })) as { data?: Array<Record<string, unknown>> }

    const out: PageComment[] = []
    for (const post of data.data ?? []) {
      const comments = (post.comments as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? []
      for (const c of comments) {
        const from = c.from as { id?: string; name?: string } | undefined
        // The Page's own comments are not customer comments.
        if (from?.id === pageId) continue
        const replies = (c.comments as { data?: Array<{ from?: { id?: string } }> } | undefined)?.data ?? []
        const message = String(c.message ?? '')
        out.push({
          id: String(c.id),
          postId: String(post.id),
          postText: String(post.message ?? '').slice(0, 80),
          message,
          ...(from?.name !== undefined ? { author: from.name } : {}),
          ...(from?.id !== undefined ? { authorId: from.id } : {}),
          createdAt: new Date(String(c.created_time)),
          hidden: c.is_hidden === true,
          canHide: c.can_hide === true,
          answered: replies.some((r) => r.from?.id === pageId),
          replies: Number(c.comment_count ?? replies.length),
          spamSignals: spamSignals(message),
        })
      }
    }
    return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  /** Replies publicly under a comment, as the Page. */
  async replyToComment(commentId: string, token: string, message: string): Promise<string> {
    const data = (await this.#call('POST', `${commentId}/comments`, token, { message })) as { id?: string }
    if (data.id === undefined) throw new PublishError('Meta accepted the reply but returned no id.', { failureClass: 'transient' })
    return data.id
  }

  /** Hides or unhides a comment. A hidden comment stays visible to its author and their friends. */
  async setCommentHidden(commentId: string, token: string, hidden: boolean): Promise<void> {
    await this.#call('POST', commentId, token, { is_hidden: hidden ? 'true' : 'false' })
  }

  /** Deletes a comment for good. */
  async deleteComment(commentId: string, token: string): Promise<void> {
    await this.#call('DELETE', commentId, token, {})
  }

  /** Recommendations ("reviews") left on the Page, newest first. */
  async reviews(pageId: string, token: string, limit = 25): Promise<PageReview[]> {
    const data = (await this.#call('GET', `${pageId}/ratings`, token, {
      fields: 'created_time,recommendation_type,review_text,reviewer{name}',
      limit: String(limit),
    })) as { data?: Array<Record<string, unknown>> }
    return (data.data ?? []).map((r) => {
      const reviewer = (r.reviewer as { name?: string } | undefined)?.name
      return {
        createdAt: new Date(String(r.created_time)),
        recommends: r.recommendation_type === 'positive',
        text: String(r.review_text ?? ''),
        ...(reviewer !== undefined ? { reviewer } : {}),
      }
    })
  }

  /** Messenger conversations, most recently active first. */
  async conversations(pageId: string, token: string, limit = 20): Promise<PageConversation[]> {
    const data = (await this.#call('GET', `${pageId}/conversations`, token, {
      platform: 'messenger',
      fields: 'id,updated_time,participants,messages.limit(5){message,from{id},created_time}',
      limit: String(limit),
    })) as { data?: Array<Record<string, unknown>> }

    const now = this.#now().getTime()
    return (data.data ?? []).map((c) => {
      const people = ((c.participants as { data?: Array<{ id: string; name?: string }> } | undefined)?.data ?? []).filter((p) => p.id !== pageId)
      const messages = ((c.messages as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? []).map((m) => ({
        from: ((m.from as { id?: string } | undefined)?.id === pageId ? 'page' : 'customer') as 'page' | 'customer',
        text: String(m.message ?? ''),
        at: new Date(String(m.created_time)),
      }))
      const lastFromCustomer = messages.find((m) => m.from === 'customer')?.at
      return {
        id: String(c.id),
        ...(people[0]?.id !== undefined ? { customerId: people[0].id } : {}),
        ...(people[0]?.name !== undefined ? { customer: people[0].name } : {}),
        updatedAt: new Date(String(c.updated_time)),
        messages,
        ...(lastFromCustomer !== undefined ? { lastFromCustomer } : {}),
        canReply: lastFromCustomer !== undefined && now - lastFromCustomer.getTime() < MESSAGING_WINDOW_MS,
        waiting: messages[0]?.from === 'customer',
      }
    })
  }

  /**
   * Sends a Messenger reply. Meta allows it only within 24 hours of the
   * person's last message; outside that, sending is refused here rather than
   * attempted, because Meta penalises Pages that try.
   */
  async sendMessage(pageId: string, token: string, recipientId: string, text: string, lastFromCustomer: Date | undefined): Promise<string> {
    if (lastFromCustomer === undefined || this.#now().getTime() - lastFromCustomer.getTime() >= MESSAGING_WINDOW_MS) {
      throw new PublishError(
        'Outside Meta’s 24-hour window: the person last wrote more than a day ago (or never), so the Page cannot message them freely. They need to write again first.',
        { failureClass: 'permanent' },
      )
    }
    const data = (await this.#call('POST', `${pageId}/messages`, token, {
      recipient: JSON.stringify({ id: recipientId }),
      messaging_type: 'RESPONSE',
      message: JSON.stringify({ text }),
    })) as { message_id?: string }
    if (data.message_id === undefined) throw new PublishError('Meta accepted the message but returned no id.', { failureClass: 'transient' })
    return data.message_id
  }

  /**
   * Page insights totals over the last `days`.
   *
   * Asked for one metric at a time, because Meta retires Page metrics often and
   * one retired name fails the whole request. Metrics it no longer serves are
   * reported as unavailable instead of failing everything.
   */
  async insights(pageId: string, token: string, metrics: readonly string[], days = 28): Promise<{ values: InsightValue[]; unavailable: string[] }> {
    const until = Math.floor(this.#now().getTime() / 1000)
    const since = until - days * 86_400
    const values: InsightValue[] = []
    const unavailable: string[] = []
    for (const metric of metrics) {
      try {
        const data = (await this.#call('GET', `${pageId}/insights`, token, {
          metric,
          period: 'day',
          since: String(since),
          until: String(until),
        })) as { data?: Array<{ name: string; values?: Array<{ value: unknown }> }> }
        const series = data.data?.[0]?.values ?? []
        if (data.data?.length === 0) {
          unavailable.push(metric)
          continue
        }
        values.push({ metric, total: series.reduce((t, v) => t + (typeof v.value === 'number' ? v.value : 0), 0) })
      } catch (error) {
        if (error instanceof PublishError && error.httpStatus === 400) unavailable.push(metric)
        else throw error
      }
    }
    return { values, unavailable }
  }

  async #call(method: 'GET' | 'POST' | 'DELETE', path: string, token: string, params: Record<string, string>): Promise<unknown> {
    const all: Record<string, string> = { ...params, access_token: token }
    if (this.#appSecret !== undefined) all.appsecret_proof = createHmac('sha256', this.#appSecret).update(token).digest('hex')
    const url = new URL(`${GRAPH}/${this.#version}/${path}`)
    let init: RequestInit = { method }
    if (method === 'POST') {
      init = { method, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(all) }
    } else {
      for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v)
    }
    let response: Response
    try {
      response = await this.#fetch(url, init)
    } catch (cause) {
      throw new PublishError('Could not reach the Facebook Graph API', { failureClass: classifyNetworkError(cause), cause })
    }
    const text = await response.text()
    const parsed = text === '' ? {} : (JSON.parse(text) as unknown)
    if (!response.ok) throw graphError(parsed as GraphErrorBody, response.status)
    return parsed
  }
}

// --------------------------------------------------------------- token check

/** What each Meta connection cannot work without. */
export const META_REQUIRED_SCOPES: Readonly<Record<string, readonly string[]>> = {
  facebook_page: ['pages_show_list', 'pages_manage_posts'],
  instagram: ['instagram_basic', 'instagram_content_publish'],
}

export interface TokenHealth {
  readonly valid: boolean
  readonly scopes: readonly string[]
  readonly missing: readonly string[]
  readonly reason?: string
}

/**
 * Asks Meta whether a stored token still works and still carries the
 * permissions its connection needs.
 *
 * Added 2026-10-02, after both Meta connections were found dead: the tokens
 * had been stripped down to ads permissions (most likely the same Meta app was
 * re-approved later with only ads ticked, which replaces the earlier grant),
 * and every check said "ready" because only expiry dates were looked at.
 */
export async function inspectMetaToken(options: {
  token: string
  appId: string
  appSecret: string
  required: readonly string[]
  apiVersion?: string
  fetch?: typeof globalThis.fetch
}): Promise<TokenHealth> {
  const f = options.fetch ?? globalThis.fetch
  const url = new URL(`${GRAPH}/${options.apiVersion ?? 'v25.0'}/debug_token`)
  url.searchParams.set('input_token', options.token)
  url.searchParams.set('access_token', `${options.appId}|${options.appSecret}`)
  const body = (await (await f(url)).json()) as {
    data?: { is_valid?: boolean; scopes?: string[]; error?: { message?: string } }
    error?: { message?: string }
  }
  if (body.error !== undefined) throw new PublishError(`Could not check the token: ${body.error.message ?? 'unknown error'}`, { failureClass: 'transient' })
  const scopes = body.data?.scopes ?? []
  const missing = options.required.filter((s) => !scopes.includes(s))
  const reason = body.data?.error?.message
  return {
    valid: body.data?.is_valid === true && missing.length === 0,
    scopes,
    missing,
    ...(reason !== undefined ? { reason: reason.replace(/\s+/g, ' ').trim() } : {}),
  }
}

/** The connection platform these tools act on, so apps never spell it out. */
export const PAGE_PLATFORM = 'facebook_page'
