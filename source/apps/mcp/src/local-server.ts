import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { checkConfig } from '@social-publisher/config'
import { PLATFORMS, type ErrorCode } from '@social-publisher/core'
import { health, queueStats, type TenantScope } from '@social-publisher/db'

import { registerAdsTools } from './ads-tools.ts'
import { registerImageTools } from './image-tools.ts'
import { registerPageTools } from './page-tools.ts'
import { registerPerformanceTools } from './performance-tools.ts'
import { registerTurnaroundTools } from './turnaround-tools.ts'
import { registerSetupTools } from './setup-tools.ts'
import { registerShopifyBuildTools } from './shopify-build-tools.ts'
import { registerShopifyThemeTools } from './shopify-theme-tools.ts'
import { registerShopifyTools, registerShopifyWriteTools } from './shopify-tools.ts'
import { registerPlaybooks } from './playbooks.ts'
import { registerSkillsLibrary } from './skills-library.ts'
import { localWordPressAccess } from './wordpress-access.ts'
import { registerWordPressTools } from './wordpress-tools.ts'
import { currentScope, loadConnections, postingDeps } from './context.ts'
import { buildDraft, callFailure, formatPostList, publishPost } from './publishing.ts'
import { createAdsPilotServer } from './mcp-server.ts'
import type { MeterOptions } from './metering.ts'

/**
 * AdsPilot MCP server, local (stdio) tool set. server.ts connects it to stdio;
 * it is built here, in a function, so a test can build the very same tool set
 * and check every tool is metered.
 *
 * Every tool takes a TenantScope, never a raw database client, so a tool cannot
 * reach another account's data even by accident.
 *
 * Every failure returns a diagnosis from the error catalogue — what happened, why,
 * and numbered fix steps. That matters more than usual here because the caller is
 * an AI: given a resolution it can act, given a raw platform code it invents a
 * plausible-sounding fix and misleads the user.
 */

/** The platforms and the database, for real. Publishing itself lives in publishing.ts, shared with the hosted server. */
const deps = postingDeps()

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] })

// Never "retried automatically": nothing retries a tool call on its own.
const fail = (code: ErrorCode, detail?: string) => text(callFailure(code, detail))

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

/** Every local tool, on a metered server. The caller connects the transport. */
export function buildLocalServer(meter: MeterOptions): McpServer {
  const server = createAdsPilotServer('0.2.0', meter)

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
      .describe('Platforms to target. Without accounts, a platform with several accounts is refused.'),
    accounts: z
      .array(z.string())
      .optional()
      .describe('Which accounts, by name (as list_accounts shows) or id. Required when a platform has more than one connected account.'),
    media: z
      .array(
        z.object({
          kind: z.enum(['image', 'video']),
          localPath: z
            .string()
            .optional()
            .describe(
              'Absolute path to a local file. Works for Facebook, LinkedIn and YouTube, which take uploaded bytes. ' +
                'The way to post a large video: it is read straight from disk.',
            ),
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
        const { draft, platforms, selection } = await buildDraft(scope, args)
        if (!selection.ok) return text(selection.message)
        const report = deps.service().validate(draft, platforms)

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
   * Same approval token as the HTTP transport, and the same publish: both call
   * publishPost in publishing.ts. Only the tool schema is this transport's own,
   * because stdio also accepts local file paths.
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
    // The request's signal fires when the client gives up on the call (its
    // timeout, Esc, an idle limit), so a long upload stops instead of finishing
    // unseen and being sent again.
    async (args, extra) =>
      await guard(async (scope) => await publishPost(scope, args, { deps, actor: 'mcp', signal: extra.signal, analytics: meter.analytics })),
  )

  server.tool(
    'list_posts',
    'Show recent posts and what happened to each target — published, failed, and the platform\'s own reason.',
    { limit: z.number().min(1).max(50).optional().describe('How many to show. Default 10.') },
    async ({ limit }) => await guard(async (scope) => text(formatPostList(await scope.posts(limit ?? 10)))),
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

  // Ads are local-only: the account comes from the owner's environment, which is
  // single-tenant by construction. See ads-tools.ts and decisions/0005.
  registerAdsTools(server)
  registerSetupTools(server)
  registerPerformanceTools(server)
  registerTurnaroundTools(server)
  registerPageTools(server)
  // Local only too: the OpenRouter key and the image budget are the owner's.
  registerImageTools(server)
  // Local only: the Shopify app's secret is the owner's (phase 1, read-only).
  registerShopifyTools(server)
  // Phase 2: store changes, each behind the owner's approval, backed up and read back.
  registerShopifyWriteTools(server)
  registerShopifyBuildTools(server)
  // Phase 2b: theme changes through the Shopify CLI, on a hidden copy, published only on approval.
  registerShopifyThemeTools(server)
  // WordPress and WooCommerce: the same tools as hosted, sites stored in the local vault.
  registerWordPressTools(server, localWordPressAccess())

  // Expertise is served on both transports; it is static text and holds no secrets.
  registerPlaybooks(server)
  registerSkillsLibrary(server)

  return server
}
