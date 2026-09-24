import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { TokenIdentity } from '@social-publisher/auth'
import {
  PLATFORMS,
  formatResolution,
  resolutionFor,
  type Connection,
  type ErrorCode,
  type MediaRef,
  type Platform,
  type PostDraft,
} from '@social-publisher/core'
import { db, queueStats, type TenantScope } from '@social-publisher/db'
import type { Logger } from '@social-publisher/telemetry'

import { publishService, targetFor } from './context.ts'

/**
 * The MCP tools, registered against one request's tenant.
 *
 * Defined once and shared by both transports — stdio for local use, HTTP for
 * hosted customers — so the two can never drift apart in what they allow.
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

function codeForFailure(failureClass: string): ErrorCode {
  if (failureClass === 'credential') return 'TOKEN_EXPIRED'
  if (failureClass === 'transient') return 'RATE_LIMITED'
  return 'PLATFORM_REJECTED'
}

async function connectionsFor(scope: TenantScope): Promise<Connection[]> {
  const rows = await scope.connections()
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    platform: r.platform,
    platformAccountId: r.platformAccountId,
    displayName: r.displayName,
    credentialSource: r.credentialSource,
    scopes: r.scopes,
    needsReauth: r.needsReauth,
    ...(r.expiresAt !== null ? { expiresAt: r.expiresAt } : {}),
  }))
}

const draftShape = {
  body: z.string().describe('The post text or caption.'),
  platforms: z
    .array(z.enum(PLATFORMS))
    .optional()
    .describe('Which platforms to target. Defaults to every connected, ready account.'),
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

export function registerTools(server: McpServer, identity: TokenIdentity, logger: Logger): void {
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
        const connections = await connectionsFor(scope)
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
        const connections = await connectionsFor(scope)
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
        const { draft, platforms } = await buildDraft(scope, args)
        const report = publishService().validate(draft, platforms)

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
    draftShape,
    async (args) =>
      await guard('publish_post', async () => {
        const { draft, platforms, connections } = await buildDraft(scope, args)

        const validation = publishService().validate(draft, platforms)
        if (!validation.ok) {
          const problems = [...validation.byPlatform.entries()]
            .flatMap(([p, issues]) =>
              issues.filter((i) => i.severity === 'error').map((i) => `${p}: ${i.message}`),
            )
            .join('; ')
          // Nothing published: a partial post is worse than none, because the
          // content is already public wherever it succeeded.
          return fail('PLATFORM_REJECTED', `Nothing was published. ${problems}`)
        }

        const chosen = connections.filter((c) => platforms.includes(c.platform) && !c.needsReauth)
        if (chosen.length === 0) return fail('NO_CONNECTION', 'No ready accounts match those platforms.')

        // Proves every connection belongs to this token's tenant.
        await scope.requireConnections(chosen.map((c) => c.id))

        const post = await scope.createPost({ body: draft.body, createdBy: `mcp:${identity.userId}` })

        const report = await publishService().publish(draft, chosen.map(targetFor), {
          idempotencyKeyFor: (connectionId) => `${post.id}:${connectionId}`,
        })

        for (const outcome of [...report.succeeded, ...report.failed]) {
          await db().target.create({
            data: {
              tenantId: scope.tenantId,
              postId: post.id,
              connectionId: outcome.connectionId,
              state: outcome.ok ? 'published' : 'failed',
              idempotencyKey: `${post.id}:${outcome.connectionId}`,
              ...(outcome.ok
                ? {
                    publishedAt: new Date(),
                    platformPostId: outcome.result!.platformPostId,
                    platformUrl: outcome.result!.url ?? null,
                  }
                : {
                    failureClass: outcome.error!.failureClass,
                    platformMessage: outcome.error!.message,
                    errorCode: outcome.error!.platformCode ?? null,
                  }),
            },
          })
        }

        await scope.record(`mcp:${identity.userId}`, 'post.published', {
          postId: post.id,
          succeeded: report.succeeded.length,
          failed: report.failed.length,
        })

        const lines: string[] = []
        for (const ok of report.succeeded) {
          lines.push(`PUBLISHED  ${ok.displayName}  ${ok.result!.url ?? ok.result!.platformPostId}`)
        }
        for (const bad of report.failed) {
          lines.push(`FAILED     ${bad.displayName}`)
          lines.push(formatResolution(resolutionFor(codeForFailure(bad.error!.failureClass)), bad.error!.message))
        }
        return text(lines.join('\n'))
      }),
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

        const { draft, platforms, connections } = await buildDraft(scope, args)

        const validation = publishService().validate({ ...draft, scheduledFor: when }, platforms)
        if (!validation.ok) {
          const problems = [...validation.byPlatform.entries()]
            .flatMap(([p, issues]) =>
              issues.filter((i) => i.severity === 'error').map((i) => `${p}: ${i.message}`),
            )
            .join('; ')
          return fail('PLATFORM_REJECTED', `Nothing was scheduled. ${problems}`)
        }

        const chosen = connections.filter((c) => platforms.includes(c.platform) && !c.needsReauth)
        if (chosen.length === 0) return fail('NO_CONNECTION')
        await scope.requireConnections(chosen.map((c) => c.id))

        const post = await scope.createPost({ body: draft.body, createdBy: `mcp:${identity.userId}` })

        for (const connection of chosen) {
          const target = await db().target.create({
            data: {
              tenantId: scope.tenantId,
              postId: post.id,
              connectionId: connection.id,
              state: 'scheduled',
              scheduledFor: when,
              idempotencyKey: `${post.id}:${connection.id}`,
            },
          })
          await db().job.create({
            data: { tenantId: scope.tenantId, targetId: target.id, runAfter: when },
          })
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
      await guard('list_posts', async () => {
        const posts = await scope.posts(limit ?? 10)
        if (posts.length === 0) return text('No posts yet.')
        return text(
          posts
            .map((p) => {
              const head = `${p.createdAt.toISOString()}  "${p.body.slice(0, 70)}${p.body.length > 70 ? '…' : ''}"`
              const rows = p.targets.map(
                (t) =>
                  `    ${t.state.padEnd(10)} ${t.connection.displayName}` +
                  (t.platformUrl !== null ? `  ${t.platformUrl}` : '') +
                  (t.platformMessage !== null ? `  — ${t.platformMessage}` : ''),
              )
              return [head, ...rows].join('\n')
            })
            .join('\n\n'),
        )
      }),
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

async function buildDraft(
  scope: TenantScope,
  args: {
    body: string
    platforms?: Platform[] | undefined
    media?:
      | Array<{
          kind: 'image' | 'video'
          publicUrl: string
          mime: string
          durationSeconds?: number | undefined
        }>
      | undefined
  },
) {
  const connections = await connectionsFor(scope)

  const media: MediaRef[] = (args.media ?? []).map((m, index) => ({
    id: `m${index}`,
    kind: m.kind,
    mime: m.mime,
    bytes: 0,
    publicUrl: m.publicUrl,
    ...(m.durationSeconds !== undefined ? { durationSeconds: m.durationSeconds } : {}),
  }))

  const draft: PostDraft = { body: args.body, media }
  const platforms =
    args.platforms ?? [...new Set(connections.filter((c) => !c.needsReauth).map((c) => c.platform))]

  return { draft, platforms, connections }
}
