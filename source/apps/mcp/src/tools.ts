import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { TokenIdentity } from '@social-publisher/auth'
import { PLATFORMS, formatResolution, overridesForStorage, resolutionFor, type ErrorCode } from '@social-publisher/core'
import { queueStats } from '@social-publisher/db'
import type { Logger } from '@social-publisher/telemetry'

import { loadConnections, postingDeps } from './context.ts'
import {
  buildDraft,
  formatPostList,
  publishPost,
  validationProblems,
  type PostingDeps,
} from './publishing.ts'

/**
 * The MCP tools of the hosted (HTTP) transport, registered against one
 * request's tenant.
 *
 * Publishing is not defined here: publish_post and list_posts call the same
 * code as the stdio server (publishing.ts), so the two can never drift apart in
 * what they publish, store or say.
 *
 * Every tool closes over the TenantScope resolved from the caller's token. There
 * is no code path where a tool runs without a tenant, because the tools do not
 * exist until one has been resolved.
 */

type ToolResult = { content: Array<{ type: 'text'; text: string }> }

const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })

const fail = (code: ErrorCode, detail?: string): ToolResult =>
  text(formatResolution(resolutionFor(code), detail))

/** Maps an unexpected throw onto the catalogue rather than leaking a raw message. */
function diagnose(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error)

  if (/do not belong to this account|no such user|no account is set up/i.test(message)) {
    return fail('NO_CONNECTION', message)
  }
  if (/can't reach database|connection.*closed|ECONNREFUSED/i.test(message)) {
    return fail('DB_UNREACHABLE', message)
  }
  if (/VAULT_MASTER_KEY/i.test(message)) return fail('VAULT_KEY_INVALID', message)
  if (/is missing from|No config file/i.test(message)) return fail('CONFIG_MISSING', message)
  if (/bucket|storage/i.test(message)) return fail('STORAGE_REJECTED', message)
  return fail('UNKNOWN', message)
}

const draftShape = {
  body: z.string().describe('The post text or caption. On YouTube this is the video description.'),
  title: z
    .string()
    .optional()
    .describe(
      'Title, for platforms that keep one separately (YouTube: at most 100 characters, no < or >). ' +
        'Without it YouTube uses the first line of body.',
    ),
  syntheticMedia: z
    .boolean()
    .optional()
    .describe(
      'Set true when the media is realistic AI-generated or altered content: a real person shown saying or ' +
        'doing something they did not, altered footage of a real event or place, or a realistic scene that ' +
        'never happened. YouTube requires this disclosure and is sent it; platforms whose API takes no such ' +
        'declaration are not, and the approval summary names them so the post can be labelled in their app. ' +
        'Not needed for AI help with the script, captions, ' +
        'thumbnail or ideas.',
    ),
  platforms: z
    .array(z.enum(PLATFORMS))
    .optional()
    .describe('Which platforms to target. Without accounts, a platform with several accounts is refused.'),
  accounts: z
    .array(z.string())
    .optional()
    .describe('Which accounts, by name (as list_accounts shows) or id. Required when a platform has more than one connected account.'),
  media: z
    .array(
      z.object({
        kind: z.enum(['image', 'video']),
        publicUrl: z.string().describe('Public https URL of the image or video.'),
        mime: z.string().describe('e.g. image/jpeg, video/mp4'),
        durationSeconds: z.number().optional().describe('Needed to check video length limits.'),
      }),
    )
    .optional()
    .describe('Attachments, as public URLs. Instagram requires these.'),
}

/**
 * The publish tool takes everything a draft does, plus a confirmation token.
 *
 * Deliberately NOT a boolean. A `confirm: true` flag would be set by the same
 * model that composed the post, which is no check at all. The token is an HMAC
 * over this exact payload, handed back only after a person has seen the summary
 * — so it cannot be invented, and it does not survive an edit.
 */
const publishShape = {
  ...draftShape,
  confirm: z
    .string()
    .optional()
    .describe(
      'Approval token from a previous call to this tool. Call without it first: ' +
        'you will get a summary to show the user. Only after they approve, call ' +
        'again with everything identical plus this token.',
    ),
}

/**
 * `deps` is what publishing reaches outside the process; the real ones unless a
 * test passes fakes.
 */
export function registerTools(
  server: McpServer,
  identity: TokenIdentity,
  logger: Logger,
  deps: PostingDeps = postingDeps(),
): void {
  const { scope } = identity

  const guard = async (event: string, fn: () => Promise<ToolResult>): Promise<ToolResult> => {
    try {
      const result = await fn()
      await logger.info(`mcp.${event}`, 'tool completed')
      return result
    } catch (error) {
      await logger.error(`mcp.${event}.failed`, 'tool threw', { data: { error } })
      return diagnose(error)
    }
  }

  server.tool(
    'check_status',
    'Check AdsPilot health for this account: connected social accounts, scheduled posts, and any failures.',
    {},
    async () =>
      await guard('check_status', async () => {
        const connections = await loadConnections(scope)
        const queue = await queueStats()

        const lines = [`accounts: ${connections.length} connected`]
        for (const c of connections) {
          lines.push(`  ${c.platform.padEnd(15)} ${c.displayName}${c.needsReauth ? '  NEEDS RECONNECT' : ''}`)
        }
        if (connections.length === 0) lines.push('  none — connect one in the dashboard first')
        lines.push(`scheduled: ${queue.queued}`)
        if (queue.nextRunAt !== null) lines.push(`  next: ${queue.nextRunAt.toISOString()}`)
        return text(lines.join('\n'))
      }),
  )

  server.tool(
    'list_accounts',
    'List the social accounts this user can post to.',
    {},
    async () =>
      await guard('list_accounts', async () => {
        const connections = await loadConnections(scope)
        if (connections.length === 0) return fail('NO_CONNECTION')
        return text(
          connections
            .map((c) => `${c.displayName}\n  platform: ${c.platform}\n  status: ${c.needsReauth ? 'NEEDS RECONNECT' : 'ready'}`)
            .join('\n\n'),
        )
      }),
  )

  server.tool(
    'validate_post',
    "Check a draft against each platform's limits WITHOUT publishing. Always run this before publish_post.",
    draftShape,
    async (args) =>
      await guard('validate_post', async () => {
        const { draft, platforms, selection } = await buildDraft(scope, args)
        if (!selection.ok) return text(selection.message)
        const report = deps.service().validate(draft, platforms)

        const lines = [report.ok ? 'Valid for all targets.' : 'NOT valid — fix these first:']
        for (const [platform, issues] of report.byPlatform) {
          if (issues.length === 0) lines.push(`  ${platform}: ok`)
          else for (const i of issues) lines.push(`  ${platform}: [${i.severity}] ${i.message}`)
        }
        return text(lines.join('\n'))
      }),
  )

  server.tool(
    'publish_post',
    'Publish immediately to this account\'s social platforms. This is PUBLIC and cannot be undone — confirm the exact wording with the user before calling it.',
    publishShape,
    async (args) =>
      await guard('publish_post', async () =>
        await publishPost(scope, args, {
          deps,
          actor: `mcp:${identity.userId}`,
          onApprovalRequested: async (accounts) => {
            await logger.info('mcp.publish_post.awaiting_approval', 'approval requested', {
              tenantId: scope.tenantId,
              data: { accounts },
            })
          },
        }),
      ),
  )

  server.tool(
    'schedule_post',
    'Queue a post to publish later. The worker sends it at the given time.',
    { ...draftShape, at: z.string().describe('When to publish, as an ISO timestamp.') },
    async (args) =>
      await guard('schedule_post', async () => {
        const when = new Date(args.at)
        if (Number.isNaN(when.getTime())) {
          return fail('UNKNOWN', `Could not read "${args.at}" as a date. Use an ISO timestamp.`)
        }
        if (when.getTime() < Date.now()) return fail('SCHEDULED_IN_PAST')

        const { draft, platforms, selection } = await buildDraft(scope, args)
        if (!selection.ok) return text(selection.message)

        const validation = deps.service().validate({ ...draft, scheduledFor: when }, platforms)
        if (!validation.ok) {
          return fail('PLATFORM_REJECTED', `Nothing was scheduled. ${validationProblems(validation)}`)
        }

        const chosen = selection.chosen
        if (chosen.length === 0) return fail('NO_CONNECTION')
        await scope.requireConnections(chosen.map((c) => c.id))

        /**
         * The worker rebuilds the draft from this row alone, and the posts table
         * has no title or disclosure column. Without the overrides a scheduled
         * video would go out under its first line, undisclosed.
         */
        const post = await scope.createPost({
          body: draft.body,
          createdBy: `mcp:${identity.userId}`,
          overrides: overridesForStorage(draft, platforms),
        })

        for (const connection of chosen) {
          const target = await deps.rows.createTarget({
            tenantId: scope.tenantId,
            postId: post.id,
            connectionId: connection.id,
            state: 'scheduled',
            scheduledFor: when,
            idempotencyKey: `${post.id}:${connection.id}`,
          })
          await deps.rows.createJob({ tenantId: scope.tenantId, targetId: target.id, runAfter: when })
        }

        await scope.record(`mcp:${identity.userId}`, 'post.scheduled', {
          postId: post.id,
          at: when.toISOString(),
        })

        return text(
          `Scheduled for ${when.toISOString()} across ${chosen.length} account(s):\n` +
            chosen.map((c) => `  ${c.displayName}`).join('\n'),
        )
      }),
  )

  server.tool(
    'list_posts',
    "Show recent posts and what happened to each target — published, failed, and the platform's own reason.",
    { limit: z.number().min(1).max(50).optional() },
    async ({ limit }) =>
      await guard('list_posts', async () => text(formatPostList(await scope.posts(limit ?? 10)))),
  )

  server.tool(
    'cancel_scheduled_post',
    'Cancel a post that is scheduled but has not gone out yet.',
    { targetId: z.string().describe('The target id, from list_posts.') },
    async ({ targetId }) =>
      await guard('cancel_scheduled_post', async () => {
        const cancelled = await scope.cancelTarget(targetId)
        if (!cancelled) {
          return text('Nothing was cancelled — it may have already published, or it is not yours.')
        }
        await scope.record(`mcp:${identity.userId}`, 'post.cancelled', { targetId })
        return text('Cancelled. It will not be published.')
      }),
  )
}
