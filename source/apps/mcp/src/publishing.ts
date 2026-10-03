import {
  decide,
  formatApprovalRequest,
  formatResolution,
  overridesForStorage,
  resolutionFor,
  selectTargets,
  type Connection,
  type ErrorCode,
  type MediaRef,
  type Platform,
  type PostDraft,
} from '@social-publisher/core'
import type { TenantScope } from '@social-publisher/db'
import type { PublishReport, PublishService, TargetOutcome, TargetSpec } from '@social-publisher/publisher'

import { loadConnections } from './context.ts'

/**
 * Publishing, shared by both transports.
 *
 * publish_post was written twice, once for stdio and once for the hosted
 * server, and every fix to what a publish says or stores had to be made in
 * both. Only the hosted copy could even be tested: the stdio server connects
 * to its transport the moment it is loaded. One implementation, with
 * everything that leaves the process passed in (`PostingDeps`), fixes both at
 * once and lets a test drive a whole publish with fakes.
 *
 * What still differs between the transports is passed as data: who the post
 * is recorded as created by, and the hosted server's log line when an approval
 * is requested. Local file paths only ever arrive over stdio, because only its
 * tool schema accepts them.
 */

export type ToolResult = { content: Array<{ type: 'text'; text: string }> }

const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })

const fail = (code: ErrorCode, detail?: string): ToolResult => text(formatResolution(resolutionFor(code), detail))

/** A tool's draft arguments. The hosted schema has no `localPath`; stdio's does. */
export interface DraftArgs {
  body: string
  title?: string | undefined
  syntheticMedia?: boolean | undefined
  platforms?: Platform[] | undefined
  accounts?: string[] | undefined
  media?:
    | Array<{
        kind: 'image' | 'video'
        localPath?: string | undefined
        publicUrl?: string | undefined
        mime: string
        durationSeconds?: number | undefined
      }>
    | undefined
}

export interface PublishArgs extends DraftArgs {
  confirm?: string | undefined
}

/**
 * Everything publishing reaches outside this process.
 *
 * The real ones (`postingDeps` in context.ts) talk to the platforms and the
 * database. Tests pass fakes, so a publish can be exercised from the tool call
 * to the rows it writes without either.
 */
export interface PostingDeps {
  readonly service: () => Pick<PublishService, 'validate' | 'publish'>
  readonly targetFor: (connection: Connection) => TargetSpec
  readonly rows: PostRows
}

/** The rows a publish or a schedule writes besides the post itself. */
export interface PostRows {
  createTarget(row: TargetRow): Promise<{ id: string }>
  createJob(row: { tenantId: string; targetId: string; runAfter: Date }): Promise<void>
}

export interface TargetRow {
  readonly tenantId: string
  readonly postId: string
  readonly connectionId: string
  readonly state: 'scheduled' | 'published' | 'failed'
  readonly idempotencyKey: string
  readonly scheduledFor?: Date
  readonly publishedAt?: Date
  readonly platformPostId?: string
  readonly platformUrl?: string | null
  readonly platformMessage?: string | null
  readonly failureClass?: string
  readonly errorCode?: string | null
}

export interface PostingContext {
  readonly deps: PostingDeps
  /** Recorded as the post's creator and as the actor in the activity log. */
  readonly actor: string
  /** Told when an approval is requested instead of a publish, for the hosted server's log. */
  readonly onApprovalRequested?: (accounts: number) => Promise<void>
}

export async function buildDraft(scope: TenantScope, args: DraftArgs) {
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

/** The validation errors, one line per platform and issue. */
export function validationProblems(report: ReturnType<PublishService['validate']>): string {
  return [...report.byPlatform.entries()]
    .flatMap(([p, issues]) => issues.filter((i) => i.severity === 'error').map((i) => `${p}: ${i.message}`))
    .join('; ')
}

/**
 * Only what is actually published goes into the approval. Including the
 * caller's raw arguments would let an irrelevant field invalidate an approval
 * the user gave.
 */
export function approvalPayload(draft: PostDraft, chosen: readonly Connection[]): Record<string, unknown> {
  return {
    body: draft.body,
    accounts: chosen.map((c) => c.id).sort(),
    media: draft.media.map((m) => m.publicUrl ?? m.localPath ?? m.id),
    // Both change what goes out — a title is public, the disclosure is a
    // statement to the platform — so changing either voids an approval.
    ...(draft.title !== undefined ? { title: draft.title } : {}),
    ...(draft.syntheticMedia !== undefined ? { syntheticMedia: draft.syntheticMedia } : {}),
  }
}

/** What the person approving is shown. */
export function approvalSummary(draft: PostDraft, chosen: readonly Connection[]): string {
  return [
    `Publishing to ${chosen.length} account(s):`,
    ...chosen.map((c) => `  ${c.platform.padEnd(15)} ${c.displayName}`),
    ...(draft.title !== undefined ? ['', `Title: ${draft.title}`] : []),
    '',
    'Text:',
    ...draft.body.split('\n').map((line) => `  ${line}`),
    ...(draft.media.length > 0 ? ['', `Attachments: ${draft.media.length}`] : []),
    ...(draft.syntheticMedia === true ? ['', 'Declared as realistic AI-generated or altered media.'] : []),
  ].join('\n')
}

/**
 * publish_post: validate, ask for approval, then publish and record each target.
 */
export async function publishPost(scope: TenantScope, args: PublishArgs, ctx: PostingContext): Promise<ToolResult> {
  const { draft, platforms, selection } = await buildDraft(scope, args)
  if (!selection.ok) return text(selection.message)

  const service = ctx.deps.service()

  // Refuse anything invalid: a partial post is worse than none, because the
  // content is already public wherever it succeeded.
  const validation = service.validate(draft, platforms)
  if (!validation.ok) return fail('PLATFORM_REJECTED', `Nothing was published. ${validationProblems(validation)}`)

  const chosen = selection.chosen
  if (chosen.length === 0) return fail('NO_CONNECTION', 'No ready accounts match those platforms.')

  // Proves every id belongs to this tenant. Throws rather than silently
  // publishing the valid subset.
  await scope.requireConnections(chosen.map((c) => c.id))

  /**
   * The approval gate.
   *
   * Placed HERE, after validation and account resolution, so the summary
   * describes a post that would actually go out — approving something that
   * would then fail validation teaches people the gate is noise.
   *
   * Placed BEFORE createPost, so a refusal leaves no trace. "Nothing has been
   * sent" has to be literally true or it is worse than no message.
   */
  const gate = decide({
    action: 'publish_post',
    payload: approvalPayload(draft, chosen),
    ...(args.confirm !== undefined ? { confirmation: args.confirm } : {}),
    describe: () => approvalSummary(draft, chosen),
  })
  if (!gate.allowed) {
    await ctx.onApprovalRequested?.(chosen.length)
    return text(formatApprovalRequest(gate))
  }

  // The title and disclosure travel in the overrides (there is no column for
  // them), so retrying a failed target later keeps both.
  const post = await scope.createPost({
    body: draft.body,
    createdBy: ctx.actor,
    overrides: overridesForStorage(draft, platforms),
  })

  const report = await service.publish(draft, chosen.map(ctx.deps.targetFor), {
    idempotencyKeyFor: (connectionId) => `${post.id}:${connectionId}`,
  })

  for (const outcome of [...report.succeeded, ...report.failed]) {
    await ctx.deps.rows.createTarget(targetRow(scope.tenantId, post.id, outcome))
  }
  await scope.record(ctx.actor, 'post.published', {
    postId: post.id,
    succeeded: report.succeeded.length,
    failed: report.failed.length,
  })

  return text(formatPublishReport(report))
}

/** The target row for one finished publish. */
export function targetRow(tenantId: string, postId: string, outcome: TargetOutcome): TargetRow {
  const base = {
    tenantId,
    postId,
    connectionId: outcome.connectionId,
    idempotencyKey: `${postId}:${outcome.connectionId}`,
  }
  if (outcome.ok) {
    return {
      ...base,
      state: 'published',
      publishedAt: new Date(),
      platformPostId: outcome.result!.platformPostId,
      platformUrl: outcome.result!.url ?? null,
      // Kept with the target, so list_posts shows it as well.
      platformMessage: outcome.result!.notice ?? null,
    }
  }
  return {
    ...base,
    state: 'failed',
    failureClass: outcome.error!.failureClass,
    platformMessage: outcome.error!.message,
    errorCode: outcome.error!.platformCode ?? null,
  }
}

/** What publish_post answers once the publish has run. */
export function formatPublishReport(report: PublishReport): string {
  const lines: string[] = []
  for (const ok of report.succeeded) {
    // A notice means it went through but is not what "published" implies — a
    // video uploaded private, for one. It is never reported as PUBLISHED.
    const notice = ok.result!.notice
    lines.push(`${notice === undefined ? 'PUBLISHED' : 'UPLOADED '}  ${ok.displayName}  ${ok.result!.url ?? ok.result!.platformPostId}`)
    if (notice !== undefined) lines.push(`           NOTE: ${notice}`)
  }
  for (const bad of report.failed) {
    lines.push(`FAILED     ${bad.displayName}  ${bad.error!.message}`)
    lines.push(formatResolution(resolutionFor(codeForFailure(bad.error!)), bad.error!.platformCode))
  }
  return lines.join('\n')
}

/**
 * The resolution to show for a failed target.
 *
 * The adapter's own diagnosis comes first: the class alone cannot tell a spent
 * YouTube quota from a revoked token, and guessing from it told the owner to
 * reconnect when he only had to wait. The class is the fallback for adapters
 * that name no code.
 */
export function codeForFailure(error: { failureClass: string; code?: ErrorCode | undefined }): ErrorCode {
  if (error.code !== undefined) return error.code
  if (error.failureClass === 'credential') return 'TOKEN_EXPIRED'
  if (error.failureClass === 'transient') return 'RATE_LIMITED'
  return 'PLATFORM_REJECTED'
}

/** A post as list_posts reads it: the post and each target with its account. */
export interface ListedPost {
  readonly createdAt: Date
  readonly body: string
  readonly targets: ReadonlyArray<{
    readonly state: string
    readonly platformUrl: string | null
    readonly platformMessage: string | null
    readonly errorCode: string | null
    readonly connection: { readonly displayName: string }
  }>
}

/** list_posts: each post, then one line per target. */
export function formatPostList(posts: readonly ListedPost[]): string {
  if (posts.length === 0) return 'No posts yet.'
  return posts
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
    .join('\n\n')
}
