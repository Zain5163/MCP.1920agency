import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { checkConfig } from '@social-publisher/config'
import { PLATFORMS, type MediaRef, type Platform, type PostDraft } from '@social-publisher/core'
import { db, disconnect, health } from '@social-publisher/db'

import { currentTenant, loadConnections, publishService, targetFor } from './context.ts'

/**
 * Social Publisher MCP server.
 *
 * The whole justification for building this rather than buying Mixpost: publishing
 * driven from chat. Every tool here is a thin shell over @social-publisher/publisher
 * so there is exactly one publishing implementation.
 */

const server = new McpServer({ name: 'social-publisher', version: '0.1.0' })

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] })

/** Tools must report failure as readable text, not by throwing an opaque error. */
async function guard(fn: () => Promise<{ content: Array<{ type: 'text'; text: string }> }>) {
  try {
    return await fn()
  } catch (error) {
    return text(`Failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------------------

server.tool(
  'check_status',
  'Check Social Publisher health: configuration, database reachability, keep-alive age, and connected accounts. Run this first if anything seems wrong.',
  {},
  async () =>
    await guard(async () => {
      const config = checkConfig()
      const lines: string[] = []

      lines.push(`config: ${config.envFileExists ? config.envPath : 'MISSING — see SETUP.md'}`)
      if (config.missing.length > 0) lines.push(`  missing keys: ${config.missing.join(', ')}`)

      const state = await health()
      if (!state.reachable) {
        lines.push(`database: UNREACHABLE — ${state.error ?? 'unknown'}`)
        lines.push('  if the Supabase project is paused, resume it from the dashboard')
        return text(lines.join('\n'))
      }
      lines.push(`database: reachable (${state.latencyMs}ms)`)
      if (state.heartbeatAgeDays !== undefined) {
        lines.push(
          `  keep-alive ${state.heartbeatAgeDays}d old${state.pauseRisk ? '  ⚠ PAUSE RISK (7d limit)' : ''}`,
        )
      }

      const tenant = await db().tenant.findFirst({ orderBy: { createdAt: 'asc' } })
      if (tenant === null) {
        lines.push('accounts: none — run `pnpm connect` in source/apps/cli')
        return text(lines.join('\n'))
      }

      const connections = await loadConnections(tenant.id)
      lines.push(`accounts: ${connections.length} connected`)
      for (const c of connections) {
        lines.push(
          `  ${c.platform}  ${c.displayName} (${c.platformAccountId})${c.needsReauth ? '  ⚠ NEEDS RECONNECT' : ''}`,
        )
      }
      return text(lines.join('\n'))
    }),
)

server.tool(
  'list_accounts',
  'List the connected social media accounts that can be posted to, with their ids and whether they need reconnecting.',
  {},
  async () =>
    await guard(async () => {
      const tenant = await currentTenant()
      const connections = await loadConnections(tenant.id)
      if (connections.length === 0) return text('No accounts connected. Run `pnpm connect` first.')

      return text(
        connections
          .map(
            (c) =>
              `${c.id}\n  platform: ${c.platform}\n  name: ${c.displayName}\n  status: ${c.needsReauth ? 'NEEDS RECONNECT' : 'ready'}`,
          )
          .join('\n\n'),
      )
    }),
)

const draftShape = {
  body: z.string().describe('The post text / caption.'),
  platforms: z
    .array(z.enum(PLATFORMS))
    .optional()
    .describe('Platforms to target. Defaults to every connected, ready account.'),
  media: z
    .array(
      z.object({
        kind: z.enum(['image', 'video']),
        localPath: z.string().optional().describe('Absolute path to a local file to upload.'),
        publicUrl: z.string().optional().describe('Public https URL. Required for Instagram/TikTok.'),
        mime: z.string().describe('e.g. image/jpeg, video/mp4'),
        durationSeconds: z.number().optional().describe('Required to check video length limits.'),
      }),
    )
    .optional()
    .describe('Attachments. Facebook can upload local files; Instagram needs a public URL.'),
}

server.tool(
  'validate_post',
  'Check a draft against each platform\'s limits WITHOUT publishing. Use this before publish_post so length or media problems are caught first.',
  draftShape,
  async (args) =>
    await guard(async () => {
      const { draft, platforms } = await buildDraft(args)
      const report = publishService().validate(draft, platforms)

      const lines: string[] = [report.ok ? 'Valid for all targets.' : 'NOT valid — fix these first:']
      for (const [platform, issues] of report.byPlatform) {
        if (issues.length === 0) {
          lines.push(`  ${platform}: ok`)
          continue
        }
        for (const issue of issues) {
          lines.push(`  ${platform}: [${issue.severity}] ${issue.message}`)
        }
      }
      return text(lines.join('\n'))
    }),
)

server.tool(
  'publish_post',
  'Publish a post immediately to the connected social accounts. This is PUBLIC and cannot be undone from here — confirm the wording with the user before calling it.',
  draftShape,
  async (args) =>
    await guard(async () => {
      const { draft, platforms, connections } = await buildDraft(args)

      // Refuse to publish anything invalid: a partial post is worse than none,
      // because the content is already public on whichever platforms accepted it.
      const validation = publishService().validate(draft, platforms)
      if (!validation.ok) {
        const problems = [...validation.byPlatform.entries()]
          .flatMap(([p, issues]) =>
            issues.filter((i) => i.severity === 'error').map((i) => `  ${p}: ${i.message}`),
          )
          .join('\n')
        return text(`Nothing was published — the draft is not valid:\n${problems}`)
      }

      const targets = connections.filter((c) => platforms.includes(c.platform)).map(targetFor)
      if (targets.length === 0) return text('No matching connected accounts. Nothing was published.')

      const post = await db().post.create({
        data: { tenantId: connections[0]!.tenantId, body: draft.body, createdBy: 'mcp' },
      })

      const report = await publishService().publish(draft, targets, {
        idempotencyKeyFor: (connectionId) => `${post.id}:${connectionId}`,
      })

      for (const outcome of [...report.succeeded, ...report.failed]) {
        await db().target.create({
          data: {
            tenantId: post.tenantId,
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

      const lines: string[] = []
      for (const ok of report.succeeded) {
        lines.push(`PUBLISHED  ${ok.displayName} (${ok.platform})  ${ok.result!.url ?? ok.result!.platformPostId}`)
      }
      for (const bad of report.failed) {
        lines.push(
          `FAILED     ${bad.displayName} (${bad.platform})  ${bad.error!.message}` +
            (bad.error!.retryable ? '  [retryable]' : ''),
        )
      }
      lines.push('', report.allSucceeded ? 'All targets published.' : 'Some targets failed — see above.')
      return text(lines.join('\n'))
    }),
)

server.tool(
  'list_posts',
  'Show recent posts and what happened to each target (published, failed, and why).',
  { limit: z.number().min(1).max(50).optional().describe('How many posts to show. Default 10.') },
  async ({ limit }) =>
    await guard(async () => {
      const tenant = await currentTenant()
      const posts = await db().post.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: 'desc' },
        take: limit ?? 10,
        include: { targets: { include: { connection: true } } },
      })
      if (posts.length === 0) return text('No posts yet.')

      return text(
        posts
          .map((p) => {
            const head = `${p.createdAt.toISOString()}  "${p.body.slice(0, 60)}${p.body.length > 60 ? '…' : ''}"`
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

// ---------------------------------------------------------------------------

// Optionals are written as `| undefined` rather than `?` because zod's inferred
// output type includes undefined explicitly, and exactOptionalPropertyTypes treats
// those as different types.
async function buildDraft(args: {
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
}) {
  const tenant = await currentTenant()
  const connections = await loadConnections(tenant.id)

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

  // Default to every ready account, so "post this" means what a person expects.
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
