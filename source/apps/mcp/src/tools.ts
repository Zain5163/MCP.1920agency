import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { TokenIdentity } from '@social-publisher/auth'
import {
  PLATFORMS,
  decide,
  formatApprovalRequest,
  formatResolution,
  overridesForStorage,
  resolutionFor,
  type Connection,
  type ErrorCode,
  type MediaRef,
  type Platform,
  type PostDraft,
  selectTargets,
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

/**
 * The resolution to show for a failed target: the adapter's own diagnosis
 * first, the failure class only as a fallback. The class alone cannot tell a
 * spent quota from a revoked token. Kept in step with server.ts.
 */
function codeForFailure(error: { failureClass: string; code?: ErrorCode | undefined }): ErrorCode {
  if (error.code !== undefined) return error.code
  if (error.failureClass === 'credential') return 'TOKEN_EXPIRED'
  if (error.failureClass === 'transient') return 'RATE_LIMITED'
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
    ...('providerAuth' in r && r.providerAuth !== null && r.providerAuth !== undefined
      ? { providerKey: (r.providerAuth as { provider: string }).provider }
      : {}),
    ...(r.expiresAt !== null ? { expiresAt: r.expiresAt } : {}),
  }))
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
        'never happened. YouTube requires this disclosure. Not needed for AI help with the script, captions, ' +
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
        const { draft, platforms, selection } = await buildDraft(scope, args)
        if (!selection.ok) return text(selection.message)
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
    publishShape,
    async (args) =>
      await guard('publish_post', async () => {
        const { draft, platforms, selection } = await buildDraft(scope, args)
        if (!selection.ok) return text(selection.message)

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

        const chosen = selection.chosen
        if (chosen.length === 0) return fail('NO_CONNECTION', 'No ready accounts match those platforms.')

        // Proves every connection belongs to this token's tenant.
        await scope.requireConnections(chosen.map((c) => c.id))

        /**
         * The approval gate.
         *
         * Placed HERE, after validation and account resolution, so the summary
         * describes a post that would actually go out — approving something that
         * would then fail validation teaches people the gate is noise.
         *
         * Placed BEFORE createPost, so a refusal leaves no trace. "Nothing has
         * been sent" has to be literally true or it is worse than no message.
         */
        const gate = decide({
          action: 'publish_post',
          // Only what is actually published. Including the caller's raw arguments
          // would let an irrelevant field invalidate an approval the user gave.
          payload: {
            body: draft.body,
            accounts: chosen.map((c) => c.id).sort(),
            media: draft.media.map((m) => m.publicUrl ?? m.id),
            // Both change what goes out — a title is public, the disclosure is a
            // statement to the platform — so changing either voids an approval.
            ...(draft.title !== undefined ? { title: draft.title } : {}),
            ...(draft.syntheticMedia !== undefined ? { syntheticMedia: draft.syntheticMedia } : {}),
          },
          ...(args.confirm !== undefined ? { confirmation: args.confirm } : {}),
          describe: () =>
            [
              `Publishing to ${chosen.length} account(s):`,
              ...chosen.map((c) => `  ${c.platform.padEnd(15)} ${c.displayName}`),
              ...(draft.title !== undefined ? ['', `Title: ${draft.title}`] : []),
              '',
              'Text:',
              ...draft.body.split('\n').map((line) => `  ${line}`),
              ...(draft.media.length > 0 ? ['', `Attachments: ${draft.media.length}`] : []),
              ...(draft.syntheticMedia === true ? ['', 'Declared as realistic AI-generated or altered media.'] : []),
            ].join('\n'),
        })

        if (!gate.allowed) {
          await logger.info('mcp.publish_post.awaiting_approval', 'approval requested', {
            tenantId: scope.tenantId,
            data: { accounts: chosen.length },
          })
          return text(formatApprovalRequest(gate))
        }

        // The title and disclosure travel in the overrides (there is no column
        // for them), so retrying a failed target later keeps both.
        const post = await scope.createPost({
          body: draft.body,
          createdBy: `mcp:${identity.userId}`,
          overrides: overridesForStorage(draft, platforms),
        })

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
                    // Kept with the target, so list_posts shows it as well.
                    platformMessage: outcome.result!.notice ?? null,
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
          // A notice means it went through but is not what "published" implies —
          // a video uploaded private, for one. It is never reported as PUBLISHED.
          const notice = ok.result!.notice
          lines.push(
            `${notice === undefined ? 'PUBLISHED' : 'UPLOADED '}  ${ok.displayName}  ${ok.result!.url ?? ok.result!.platformPostId}`,
          )
          if (notice !== undefined) lines.push(`           NOTE: ${notice}`)
        }
        for (const bad of report.failed) {
          lines.push(`FAILED     ${bad.displayName}`)
          lines.push(formatResolution(resolutionFor(codeForFailure(bad.error!)), bad.error!.message))
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

        const { draft, platforms, selection } = await buildDraft(scope, args)
        if (!selection.ok) return text(selection.message)

        const validation = publishService().validate({ ...draft, scheduledFor: when }, platforms)
        if (!validation.ok) {
          const problems = [...validation.byPlatform.entries()]
            .flatMap(([p, issues]) =>
              issues.filter((i) => i.severity === 'error').map((i) => `${p}: ${i.message}`),
            )
            .join('; ')
          return fail('PLATFORM_REJECTED', `Nothing was scheduled. ${problems}`)
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
    title?: string | undefined
    syntheticMedia?: boolean | undefined
    platforms?: Platform[] | undefined
    accounts?: string[] | undefined
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

  const title = args.title?.trim()
  const draft: PostDraft = {
    body: args.body,
    media,
    ...(title !== undefined && title !== '' ? { title } : {}),
    ...(args.syntheticMedia !== undefined ? { syntheticMedia: args.syntheticMedia } : {}),
  }
  // Which accounts, decided once for validate, publish and schedule alike.
  const selection = selectTargets(connections, { platforms: args.platforms, accounts: args.accounts })
  const platforms = selection.ok ? [...selection.platforms] : (args.platforms ?? [])

  return { draft, platforms, connections, selection }
}
