import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { FacebookPageEngagement, PAGE_PLATFORM, type PageConversation } from '@social-publisher/adapters'
import { optional, required } from '@social-publisher/config'
import { PublishError, decide, formatApprovalRequest, type Connection } from '@social-publisher/core'

import { audit, guarded, type ToolResult } from './ads-tools.ts'
import { currentScope, loadConnections, targetFor } from './context.ts'

/**
 * Facebook Page management: comments, reviews, Messenger, insights
 * (roadmap 5b.7, built 2026-10-02).
 *
 * Risk follows who sees it:
 *   - reading anything: no approval;
 *   - hiding or unhiding a comment: no approval — reversible, and a hidden
 *     comment stays visible to its author, so nobody is misled;
 *   - replying to a comment, deleting one, answering a message: approval,
 *     because a person reads it under the business's name, and a deletion
 *     cannot be undone.
 *
 * Uses the Page connection held in the vault, like posting does; the token is
 * only ever inside a callback.
 */

const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })
const confirmArg = z.string().optional().describe('The token from the approval summary, once the user has said yes.')

function engagement(): FacebookPageEngagement {
  return new FacebookPageEngagement({ apiVersion: optional('META_API_VERSION', 'v25.0')!, appSecret: required('META_APP_SECRET') })
}

async function pageConnection(pageName?: string): Promise<Connection | string> {
  const pages = (await loadConnections(await currentScope())).filter((c) => c.platform === PAGE_PLATFORM)
  if (pages.length === 0) return 'No Facebook Page is connected. Connect one in the dashboard (Accounts → Connect).'
  const page = pageName === undefined ? pages[0]! : pages.find((p) => p.displayName.toLowerCase() === pageName.toLowerCase())
  if (page === undefined) return `No connected Page is called "${pageName}". Connected: ${pages.map((p) => p.displayName).join(', ')}.`
  if (page.needsReauth) return reconnect(page.displayName)
  return page
}

function reconnect(name: string): string {
  return [
    `The connection to "${name}" no longer works: Meta has withdrawn its permissions.`,
    '',
    'To fix it:',
    '  1. Open the dashboard (start-dashboard.cmd) → Accounts → Reconnect Facebook.',
    '  2. In Meta’s window, keep EVERY permission ticked, including the Pages ones.',
    '  3. Do not later re-approve the same Meta app with fewer permissions ticked: that replaces this grant.',
  ].join('\n')
}

/** Turns Meta's "token no longer valid" into the reconnect steps. */
async function withPage<T extends ToolResult>(pageName: string | undefined, fn: (page: Connection, token: string) => Promise<T>): Promise<ToolResult> {
  const page = await pageConnection(pageName)
  if (typeof page === 'string') return text(page)
  try {
    return await targetFor(page).withCredential(async (token) => await fn(page, token))
  } catch (error) {
    if (error instanceof PublishError && (error.platformCode?.startsWith('190') === true || /permission/i.test(error.platformMessage ?? ''))) {
      return text(`${reconnect(page.displayName)}\n\nMeta said: ${error.platformMessage ?? error.message}`)
    }
    throw error
  }
}

const pageArg = z.string().optional().describe('The Page’s name, when several are connected. Defaults to the first.')
const ago = (d: Date) => {
  const h = Math.round((Date.now() - d.getTime()) / 3_600_000)
  return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

export function registerPageTools(server: McpServer): void {
  server.tool(
    'list_page_comments',
    'Read comments on the Facebook Page’s recent posts: who wrote what, whether the Page has replied, and which look like spam. Reads only. Use it before replying to or hiding anything.',
    {
      page: pageArg,
      posts: z.number().int().min(1).max(25).default(10).describe('How many recent posts to read.'),
      unansweredOnly: z.boolean().default(true).describe('Only comments the Page has not replied to yet.'),
    },
    async ({ page, posts, unansweredOnly }) =>
      await guarded(async () =>
        await withPage(page, async (p, token) => {
          const all = await engagement().comments(p.platformAccountId, token, { posts })
          const shown = all.filter((c) => !unansweredOnly || (!c.answered && !c.hidden))
          if (shown.length === 0) return text(unansweredOnly ? 'No unanswered comments on the recent posts.' : 'No comments on the recent posts.')
          const lines = shown.map(
            (c) =>
              `• [${c.id}] ${c.author ?? 'someone'} (${ago(c.createdAt)}) on "${c.postText}":\n    "${c.message}"` +
              (c.answered ? '\n    ✓ the Page has replied' : '') +
              (c.hidden ? '\n    (hidden)' : '') +
              (c.spamSignals.length > 0 ? `\n    ⚠ possible spam: ${c.spamSignals.join(', ')}` : ''),
          )
          return text(
            [
              `${shown.length} comment(s)${unansweredOnly ? ' waiting for a reply' : ''} on the last ${posts} post(s) of ${p.displayName}:`,
              '',
              ...lines,
              '',
              'Reply with reply_to_comment (needs approval). Hide spam with hide_comment (no approval; reversible). Spam signs are hints, not proof.',
            ].join('\n'),
          )
        }),
      ),
  )

  server.tool(
    'reply_to_comment',
    'Reply publicly to a comment, as the Facebook Page. PUBLIC under the business’s name: needs the user’s approval of the exact text.',
    { commentId: z.string(), message: z.string().min(1).max(8000), page: pageArg, confirm: confirmArg },
    async ({ commentId, message, page, confirm }) =>
      await guarded(async () =>
        await withPage(page, async (p, token) => {
          const gate = decide({
            action: 'reply_to_comment',
            payload: { commentId, message },
            ...(confirm !== undefined ? { confirmation: confirm } : {}),
            describe: () => `Reply as ${p.displayName} to comment ${commentId}:\n\n  "${message}"`,
          })
          if (!gate.allowed) return text(formatApprovalRequest(gate))
          const id = await engagement().replyToComment(commentId, token, message)
          await audit('page.comment.replied', { commentId, replyId: id })
          return text(`Replied. Meta's id for the reply: ${id}`)
        }),
      ),
  )

  server.tool(
    'hide_comment',
    'Hide (or unhide) a comment on the Facebook Page — for spam or abuse. Reversible, and the author still sees it, so no approval is needed. Say what you hid and why.',
    { commentId: z.string(), hidden: z.boolean().default(true), page: pageArg },
    async ({ commentId, hidden, page }) =>
      await guarded(async () =>
        await withPage(page, async (_p, token) => {
          await engagement().setCommentHidden(commentId, token, hidden)
          await audit(hidden ? 'page.comment.hidden' : 'page.comment.unhidden', { commentId })
          return text(hidden ? `Hidden. Undo with hide_comment and hidden: false.` : 'Visible again.')
        }),
      ),
  )

  server.tool(
    'delete_comment',
    'Delete a comment on the Facebook Page for good. CANNOT be undone: prefer hide_comment. Needs the user’s approval.',
    { commentId: z.string(), page: pageArg, confirm: confirmArg },
    async ({ commentId, page, confirm }) =>
      await guarded(async () =>
        await withPage(page, async (p, token) => {
          const gate = decide({
            action: 'delete_comment',
            payload: { commentId },
            ...(confirm !== undefined ? { confirmation: confirm } : {}),
            describe: () => `Delete comment ${commentId} from ${p.displayName}, permanently.\nHiding it instead would keep it reversible.`,
          })
          if (!gate.allowed) return text(formatApprovalRequest(gate))
          await engagement().deleteComment(commentId, token)
          await audit('page.comment.deleted', { commentId })
          return text('Deleted.')
        }),
      ),
  )

  server.tool(
    'list_page_reviews',
    'Read the recommendations ("reviews") people left on the Facebook Page, newest first. Reads only.',
    { page: pageArg, limit: z.number().int().min(1).max(100).default(25) },
    async ({ page, limit }) =>
      await guarded(async () =>
        await withPage(page, async (p, token) => {
          const reviews = await engagement().reviews(p.platformAccountId, token, limit)
          if (reviews.length === 0) return text(`${p.displayName} has no reviews that Meta returns.`)
          const no = reviews.filter((r) => !r.recommends).length
          return text(
            [
              `${reviews.length} review(s) on ${p.displayName}: ${reviews.length - no} recommend, ${no} do not.`,
              '',
              ...reviews.map((r) => `• ${r.recommends ? '👍' : '👎'} ${r.reviewer ?? 'someone'} (${ago(r.createdAt)}): "${r.text}"`),
            ].join('\n'),
          )
        }),
      ),
  )

  server.tool(
    'list_page_messages',
    'Read the Facebook Page’s Messenger inbox: who is waiting for an answer, what they said, and whether Meta’s 24-hour rule still allows a reply. Reads only.',
    { page: pageArg, limit: z.number().int().min(1).max(50).default(20), waitingOnly: z.boolean().default(true) },
    async ({ page, limit, waitingOnly }) =>
      await guarded(async () =>
        await withPage(page, async (p, token) => {
          const all = await engagement().conversations(p.platformAccountId, token, limit)
          const shown = all.filter((c) => !waitingOnly || c.waiting)
          if (shown.length === 0) return text(waitingOnly ? 'Nobody is waiting for a reply in Messenger.' : 'No Messenger conversations.')
          const fmt = (c: PageConversation) =>
            [
              `• [${c.id}] ${c.customer ?? 'someone'}${c.customerId !== undefined ? ` (id ${c.customerId})` : ''}, last active ${ago(c.updatedAt)}`,
              ...c.messages.slice(0, 3).reverse().map((m) => `    ${m.from === 'page' ? 'Page' : 'Them'}: "${m.text.slice(0, 200)}"`),
              c.canReply ? '    ✓ can reply now' : '    ✗ outside the 24-hour window: they must write again before the Page can reply',
            ].join('\n')
          return text(
            [`${shown.length} conversation(s)${waitingOnly ? ' waiting for the Page' : ''} on ${p.displayName}:`, '', ...shown.map(fmt), '', 'Answer with reply_to_message (needs approval).'].join(
              '\n',
            ),
          )
        }),
      ),
  )

  server.tool(
    'reply_to_message',
    'Answer someone in the Facebook Page’s Messenger inbox. They read it as the business: needs the user’s approval of the exact text. Only allowed within 24 hours of their last message.',
    { conversationId: z.string(), message: z.string().min(1).max(2000), page: pageArg, confirm: confirmArg },
    async ({ conversationId, message, page, confirm }) =>
      await guarded(async () =>
        await withPage(page, async (p, token) => {
          const api = engagement()
          const convo = (await api.conversations(p.platformAccountId, token, 50)).find((c) => c.id === conversationId)
          if (convo === undefined || convo.customerId === undefined) return text('That conversation was not found in the latest 50. Run list_page_messages for current ids.')
          if (!convo.canReply) return text('Not sent. The person last wrote more than 24 hours ago, so Meta does not allow the Page to message them. They need to write again first.')
          const gate = decide({
            action: 'reply_to_message',
            payload: { conversationId, message },
            ...(confirm !== undefined ? { confirmation: confirm } : {}),
            describe: () => `Send as ${p.displayName} to ${convo.customer ?? 'this person'} in Messenger:\n\n  "${message}"`,
          })
          if (!gate.allowed) return text(formatApprovalRequest(gate))
          const id = await api.sendMessage(p.platformAccountId, token, convo.customerId, message, convo.lastFromCustomer)
          await audit('page.message.sent', { conversationId, messageId: id })
          return text('Sent.')
        }),
      ),
  )

  server.tool(
    'get_page_insights',
    'Facebook Page totals over a period: views, engagement, new follows, reach — whichever Meta still serves (it retires Page metrics often; unavailable ones are listed). Reads only.',
    { page: pageArg, days: z.number().int().min(1).max(90).default(28) },
    async ({ page, days }) =>
      await guarded(async () =>
        await withPage(page, async (p, token) => {
          const { values, unavailable } = await engagement().insights(
            p.platformAccountId,
            token,
            ['page_views_total', 'page_post_engagements', 'page_follows', 'page_daily_follows_unique', 'page_impressions_unique', 'page_media_view'],
            days,
          )
          return text(
            [
              `${p.displayName}, last ${days} days:`,
              ...values.map((v) => `  ${v.metric.replace(/^page_/, '').replace(/_/g, ' ')}: ${v.total.toLocaleString('en')}`),
              ...(unavailable.length > 0 ? ['', `Not served by Meta any more (or not for this Page): ${unavailable.join(', ')}`] : []),
            ].join('\n'),
          )
        }),
      ),
  )
}
