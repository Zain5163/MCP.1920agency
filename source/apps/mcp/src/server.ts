import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { checkConfig } from '@social-publisher/config'
import {
  PLATFORMS,
  decide,
  formatApprovalRequest,
  formatResolution,
  resolutionFor,
  type ErrorCode,
  type MediaRef,
  type Platform,
  type PostDraft,
} from '@social-publisher/core'
import { disconnect, health, queueStats, type TenantScope } from '@social-publisher/db'

import { currentScope, loadConnections, publishService, targetFor } from './context.ts'

/**
 * AdsPilot MCP server.
 *
 * Every tool takes a TenantScope, never a raw database client, so a tool cannot
 * reach another account's data even by accident.
 *
 * Every failure returns a diagnosis from the error catalogue — what happened, why,
 * and numbered fix steps. That matters more than usual here because the caller is
 * an AI: given a resolution it can act, given a raw platform code it invents a
 * plausible-sounding fix and misleads the user.
 */

const server = new McpServer({ name: 'adspilot', version: '0.2.0' })

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] })

const fail = (code: ErrorCode, detail?: string) => text(formatResolution(resolutionFor(code), detail))

/** Maps an unexpected throw onto the catalogue rather than leaking a raw message. */
function diagnose(error: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const message = error instanceof Error ? error.message : String(error)

  if (/no account is set up|no such user/i.test(message)) return fail('NO_CONNECTION', message)
  if (/do not belong to this account/i.test(message)) return fail('NO_CONNECTION', message)
  if (/tenant id is required/i.test(message)) return fail('UNKNOWN', message)
  if (/can't reach database|connection.*closed|ECONNREFUSED/i.test(message)) {
    return fail('DB_UNREACHABLE', message)
  }
  if (/VAULT_MASTER_KEY/i.test(message)) return fail('VAULT_KEY_INVALID', message)
  if (/is missing from|No config file/i.test(message)) return fail('CONFIG_MISSING', message)
  return fail('UNKNOWN', message)
}

async function guard(
  fn: (scope: TenantScope) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
) {
  try {
    return await fn(await currentScope())
  } catch (error) {
    return diagnose(error)
  }
}

// ---------------------------------------------------------------------------

server.tool(
  'check_status',
  'Check AdsPilot health: configuration, database, keep-alive age, connected accounts and queue. Run this first if anything seems wrong.',
  {},
  async () => {
    try {
      const config = checkConfig()
      const lines: string[] = []

      lines.push(`config: ${config.envFileExists ? 'found' : 'MISSING — see SETUP.md'}`)
      if (config.missing.length > 0) lines.push(`  missing: ${config.missing.join(', ')}`)

      const state = await health()
      if (!state.reachable) {
        return fail('DB_UNREACHABLE', state.error)
      }
      lines.push(`database: reachable (${state.latencyMs}ms)`)
      if (state.pauseRisk) {
        lines.push(`  WARNING: keep-alive is ${state.heartbeatAgeDays}d old — pause risk at 7d`)
      }

      const scope = await currentScope()
      const connections = await loadConnections(scope)
      lines.push(`accounts: ${connections.length} connected`)
      for (const c of connections) {
        lines.push(`  ${c.platform}  ${c.displayName}${c.needsReauth ? '  NEEDS RECONNECT' : ''}`)
      }

      const queue = await queueStats()
      lines.push(`queue: ${queue.queued} scheduled, ${queue.failed} failed`)
      if (queue.nextRunAt !== null) lines.push(`  next: ${queue.nextRunAt.toISOString()}`)

      return text(lines.join('\n'))
    } catch (error) {
      return diagnose(error)
    }
  },
)

server.tool(
  'list_accounts',
  'List connected social accounts that can be posted to, with their platform and whether they need reconnecting.',
  {},
  async () =>
    await guard(async (scope) => {
      const connections = await loadConnections(scope)
      if (connections.length === 0) return fail('NO_CONNECTION')

      return text(
        connections
          .map(
            (c) =>
              `${c.displayName}\n  platform: ${c.platform}\n  id: ${c.id}\n  status: ${
                c.needsReauth ? 'NEEDS RECONNECT' : 'ready'
              }`,
          )
          .join('\n\n'),
      )
    }),
)

const draftShape = {
  body: z.string().describe('The post text or caption.'),
  platforms: z
    .array(z.enum(PLATFORMS))
    .optional()
    .describe('Platforms to target. Defaults to every connected, ready account.'),
  media: z
    .array(
      z.object({
        kind: z.enum(['image', 'video']),
        localPath: z.string().optional().describe('Absolute path to a local file. Facebook only.'),
        publicUrl: z.string().optional().describe('Public https URL. Required for Instagram.'),
        mime: z.string().describe('e.g. image/jpeg, video/mp4'),
        durationSeconds: z.number().optional().describe('Needed to check video length limits.'),
      }),
    )
    .optional(),
}

server.tool(
  'validate_post',
  'Check a draft against each platform\'s limits WITHOUT publishing. Always run this before publish_post.',
  draftShape,
  async (args) =>
    await guard(async (scope) => {
      const { draft, platforms } = await buildDraft(scope, args)
      const report = publishService().validate(draft, platforms)

      const lines = [report.ok ? 'Valid for all targets.' : 'NOT valid — fix these first:']
      for (const [platform, issues] of report.byPlatform) {
        if (issues.length === 0) {
          lines.push(`  ${platform}: ok`)
          continue
        }
        for (const issue of issues) lines.push(`  ${platform}: [${issue.severity}] ${issue.message}`)
      }
      return text(lines.join('\n'))
    }),
)

/**
 * Same approval token as the HTTP transport.
 *
 * Duplicated rather than shared because these two tool sets have genuinely
 * diverged — stdio also accepts local file paths. The duplication is a defect in
 * its own right and is recorded as such; leaving the STDIO transport ungated
 * while claiming R11 was closed would have been the worse of the two problems.
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

server.tool(
  'publish_post',
  'Publish a post immediately to connected social accounts. This is PUBLIC and cannot be undone. Call it once WITHOUT a confirm token to get a summary, show that to the user, and only call again with the token once they have approved.',
  publishShape,
  async (args) =>
    await guard(async (scope) => {
      const { draft, platforms, connections } = await buildDraft(scope, args)

      // Refuse anything invalid: a partial post is worse than none, because the
      // content is already public wherever it succeeded.
      const validation = publishService().validate(draft, platforms)
      if (!validation.ok) {
        const problems = [...validation.byPlatform.entries()]
          .flatMap(([p, issues]) =>
            issues.filter((i) => i.severity === 'error').map((i) => `${p}: ${i.message}`),
          )
          .join('; ')
        return fail('PLATFORM_REJECTED', `Nothing was published. ${problems}`)
      }

      const chosen = connections.filter((c) => platforms.includes(c.platform) && !c.needsReauth)
      if (chosen.length === 0) return fail('NO_CONNECTION', 'No ready accounts match those platforms.')

      // Proves every id belongs to this tenant. Throws rather than silently
      // publishing the valid subset.
      await scope.requireConnections(chosen.map((c) => c.id))

      // After validation, so the summary describes a post that would really go
      // out. Before createPost, so a refusal leaves no trace and "nothing has
      // been sent" is literally true.
      const gate = decide({
        action: 'publish_post',
        payload: {
          body: draft.body,
          accounts: chosen.map((c) => c.id).sort(),
          media: draft.media.map((m) => m.publicUrl ?? m.localPath ?? m.id),
        },
        ...(args.confirm !== undefined ? { confirmation: args.confirm } : {}),
        describe: () =>
          [
            `Publishing to ${chosen.length} account(s):`,
            ...chosen.map((c) => `  ${c.platform.padEnd(15)} ${c.displayName}`),
            '',
            'Text:',
            ...draft.body.split('\n').map((line) => `  ${line}`),
            ...(draft.media.length > 0 ? ['', `Attachments: ${draft.media.length}`] : []),
          ].join('\n'),
      })
      if (!gate.allowed) return text(formatApprovalRequest(gate))

      const post = await scope.createPost({ body: draft.body, createdBy: 'mcp' })

      const report = await publishService().publish(draft, chosen.map(targetFor), {
        idempotencyKeyFor: (connectionId) => `${post.id}:${connectionId}`,
      })

      for (const outcome of [...report.succeeded, ...report.failed]) {
        await recordTarget(scope, post.id, outcome)
      }
      await scope.record('mcp', 'post.published', {
        postId: post.id,
        succeeded: report.succeeded.length,
        failed: report.failed.length,
      })

      const lines: string[] = []
      for (const ok of report.succeeded) {
        lines.push(`PUBLISHED  ${ok.displayName}  ${ok.result!.url ?? ok.result!.platformPostId}`)
      }
      for (const bad of report.failed) {
        lines.push(`FAILED     ${bad.displayName}  ${bad.error!.message}`)
        lines.push(
          formatResolution(
            resolutionFor(codeForFailure(bad.error!.failureClass)),
            bad.error!.platformCode,
          ),
        )
      }
      return text(lines.join('\n'))
    }),
)

server.tool(
  'list_posts',
  'Show recent posts and what happened to each target — published, failed, and the platform\'s own reason.',
  { limit: z.number().min(1).max(50).optional().describe('How many to show. Default 10.') },
  async ({ limit }) =>
    await guard(async (scope) => {
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
  'list_activity',
  'Show this account\'s own activity log — what was done and when.',
  { limit: z.number().min(1).max(100).optional() },
  async ({ limit }) =>
    await guard(async (scope) => {
      const entries = await scope.activity(limit ?? 25)
      if (entries.length === 0) return text('No activity recorded yet.')
      return text(
        entries
          .map((e) => `${e.createdAt.toISOString()}  ${e.actor.padEnd(16)} ${e.action}`)
          .join('\n'),
      )
    }),
)

// ---------------------------------------------------------------------------

function codeForFailure(failureClass: string): ErrorCode {
  if (failureClass === 'credential') return 'TOKEN_EXPIRED'
  if (failureClass === 'transient') return 'RATE_LIMITED'
  return 'PLATFORM_REJECTED'
}

async function recordTarget(
  scope: TenantScope,
  postId: string,
  outcome: {
    connectionId: string
    ok: boolean
    result?: { platformPostId: string; url?: string }
    error?: { failureClass: string; message: string; platformCode?: string }
  },
): Promise<void> {
  const { db } = await import('@social-publisher/db')
  await db().target.create({
    data: {
      tenantId: scope.tenantId,
      postId,
      connectionId: outcome.connectionId,
      state: outcome.ok ? 'published' : 'failed',
      idempotencyKey: `${postId}:${outcome.connectionId}`,
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

async function buildDraft(
  scope: TenantScope,
  args: {
    body: string
    platforms?: Platform[] | undefined
    media?:
      | Array<{
          kind: 'image' | 'video'
          localPath?: string | undefined
          publicUrl?: string | undefined
          mime: string
          durationSeconds?: number | undefined
        }>
      | undefined
  },
) {
  const connections = await loadConnections(scope)

  const media: MediaRef[] = (args.media ?? []).map((m, index) => ({
    id: `m${index}`,
    kind: m.kind,
    mime: m.mime,
    bytes: 0,
    ...(m.localPath !== undefined ? { localPath: m.localPath } : {}),
    ...(m.publicUrl !== undefined ? { publicUrl: m.publicUrl } : {}),
    ...(m.durationSeconds !== undefined ? { durationSeconds: m.durationSeconds } : {}),
  }))

  const draft: PostDraft = { body: args.body, media }
  const platforms =
    args.platforms ?? [...new Set(connections.filter((c) => !c.needsReauth).map((c) => c.platform))]

  return { draft, platforms, connections }
}

const transport = new StdioServerTransport()
await server.connect(transport)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void disconnect().finally(() => process.exit(0))
  })
}
