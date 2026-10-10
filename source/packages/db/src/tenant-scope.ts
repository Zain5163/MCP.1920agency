import { db } from './client.ts'
import { attachmentsNotStored } from './target-codes.ts'

/**
 * Tenant-scoped data access.
 *
 * This exists because the worst bug this product can have is one customer's AI
 * publishing to another customer's Page, and that bug is one forgotten `where`
 * clause away. Tests can catch a forgotten clause only if someone writes the test;
 * this makes the unscoped query hard to express in the first place.
 *
 * Rule: **application code outside this file does not call `db()` for tenant-owned
 * tables.** It asks a TenantScope, which injects `tenantId` into every query it
 * builds. The scope cannot be constructed without a tenant id.
 *
 * This is the primary control. Postgres RLS is defence in depth *behind* it, per
 * the security research inherited from Ads-Platform — never the other way round.
 */

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantScopeError'
  }
}

/** Rejects anything that would silently widen a query to every tenant. */
function assertTenantId(tenantId: unknown): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new TenantScopeError(
      'A tenant id is required. Refusing to run an unscoped query over tenant-owned data.',
    )
  }
}

export class TenantScope {
  readonly tenantId: string

  constructor(tenantId: string) {
    assertTenantId(tenantId)
    this.tenantId = tenantId
  }

  // ---- connections ---------------------------------------------------------

  async connections() {
    return await db().connection.findMany({
      where: { tenantId: this.tenantId },
      orderBy: { createdAt: 'asc' },
      // The provider comes along because some platforms can be reached more than
      // one way and the adapter has to know which. See docs/decisions/0004.
      include: { providerAuth: { select: { provider: true } } },
    })
  }

  /**
   * Fetches one connection by id.
   *
   * Returns null rather than throwing for a connection owned by another tenant —
   * indistinguishable from "does not exist", so the caller cannot use this to probe
   * which ids are real.
   */
  async connection(connectionId: string) {
    return await db().connection.findFirst({
      where: { id: connectionId, tenantId: this.tenantId },
    })
  }

  /**
   * Resolves a set of connection ids, and **fails if any of them is not ours**.
   *
   * Deliberately not a silent filter. If a caller asks to publish to five accounts
   * and one belongs to someone else, quietly posting to four hides a serious bug.
   */
  async requireConnections(connectionIds: readonly string[]) {
    if (connectionIds.length === 0) return []

    const rows = await db().connection.findMany({
      where: { id: { in: [...connectionIds] }, tenantId: this.tenantId },
    })

    if (rows.length !== new Set(connectionIds).size) {
      const found = new Set(rows.map((r) => r.id))
      const missing = [...new Set(connectionIds)].filter((id) => !found.has(id))
      throw new TenantScopeError(
        `${missing.length} connection(s) do not belong to this account or do not exist.`,
      )
    }
    return rows
  }

  // ---- posts and targets ---------------------------------------------------

  async posts(limit = 20) {
    return await db().post.findMany({
      where: { tenantId: this.tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { targets: { include: { connection: true } } },
    })
  }

  async post(postId: string) {
    return await db().post.findFirst({
      where: { id: postId, tenantId: this.tenantId },
      include: { targets: { include: { connection: true } } },
    })
  }

  async createPost(data: { body: string; createdBy: string; overrides?: unknown }) {
    return await db().post.create({
      data: {
        tenantId: this.tenantId,
        body: data.body,
        createdBy: data.createdBy,
        ...(data.overrides !== undefined ? { overrides: data.overrides as never } : {}),
      },
    })
  }

  async targets(state?: string) {
    return await db().target.findMany({
      where: { tenantId: this.tenantId, ...(state !== undefined ? { state: state as never } : {}) },
      include: { connection: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  // ---- queue ---------------------------------------------------------------

  async queuedJobs() {
    return await db().job.findMany({
      where: { tenantId: this.tenantId, state: 'queued' },
      orderBy: { runAfter: 'asc' },
    })
  }

  /** Cancels a scheduled post. Silently affects nothing if the target is not ours. */
  async cancelTarget(targetId: string): Promise<boolean> {
    const result = await db().target.updateMany({
      where: { id: targetId, tenantId: this.tenantId, state: { in: ['pending', 'scheduled'] } },
      data: { state: 'cancelled' },
    })
    if (result.count === 0) return false

    await db().job.updateMany({
      where: { targetId, tenantId: this.tenantId, state: 'queued' },
      data: { state: 'failed', lastError: 'cancelled by user' },
    })
    return true
  }

  /**
   * Queues a failed target to be tried again.
   *
   * Only `failed` and `needs_reauth` targets are retryable. A published target is
   * deliberately excluded: re-running it would post a second copy, which is worse
   * than any failure it might be fixing.
   *
   * Attempts are reset so the retry gets a full backoff budget rather than
   * immediately exhausting whatever remained from the original run.
   *
   * A target whose post's attachments were never stored is refused too: the
   * worker rebuilds the post from the database, so it would publish the text
   * without them. See ATTACHMENTS_NOT_STORED_CODE.
   */
  async retryTarget(
    targetId: string,
  ): Promise<'queued' | 'not_found' | 'already_published' | 'attachments_not_stored'> {
    const target = await db().target.findFirst({
      where: { id: targetId, tenantId: this.tenantId },
      select: { id: true, state: true, platformPostId: true, errorCode: true },
    })

    if (target === null) return 'not_found'

    // The idempotency guard, restated here: a recorded platform post id means it
    // went out, whatever the state column says.
    if (target.platformPostId !== null || target.state === 'published') {
      return 'already_published'
    }
    if (target.state !== 'failed' && target.state !== 'needs_reauth') return 'not_found'
    // Left as it is, code included, so it stays refused.
    if (attachmentsNotStored(target)) return 'attachments_not_stored'

    await db().target.update({
      where: { id: target.id },
      data: {
        state: 'scheduled',
        attempts: 0,
        failureClass: null,
        errorCode: null,
        platformMessage: null,
      },
    })

    // Reuse the existing job row if there is one, so a target never accumulates
    // duplicate jobs across repeated retries.
    const existing = await db().job.findFirst({ where: { targetId: target.id } })
    if (existing !== null) {
      await db().job.update({
        where: { id: existing.id },
        data: {
          state: 'queued',
          runAfter: new Date(),
          attempts: 0,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      })
    } else {
      await db().job.create({
        data: { tenantId: this.tenantId, targetId: target.id, runAfter: new Date() },
      })
    }

    return 'queued'
  }

  // ---- media ---------------------------------------------------------------

  async mediaAssets(limit = 50) {
    return await db().mediaAsset.findMany({
      where: { tenantId: this.tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  // ---- audit ---------------------------------------------------------------

  /** The user-facing activity log. Separate from internal telemetry by design. */
  async activity(limit = 50) {
    return await db().auditLog.findMany({
      where: { tenantId: this.tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  /**
   * Money spent on one kind of action since a moment, from the audit log.
   *
   * Summed from what was actually charged and recorded, never estimated, so a
   * spending cap checked against it is checked against real money. Uses the
   * existing (tenant, created_at) index; the rows for one day are few.
   */
  async spentSince(action: string, since: Date, field = 'costUsd'): Promise<number> {
    const rows = await db().auditLog.findMany({
      where: { tenantId: this.tenantId, action, createdAt: { gte: since } },
      select: { detail: true },
    })
    return rows.reduce((sum, row) => {
      const value = (row.detail as Record<string, unknown> | null)?.[field]
      return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0)
    }, 0)
  }

  async record(actor: string, action: string, detail?: Record<string, unknown>) {
    return await db().auditLog.create({
      data: {
        tenantId: this.tenantId,
        actor,
        action,
        ...(detail !== undefined ? { detail: detail as never } : {}),
      },
    })
  }

  // ---- plan and usage ------------------------------------------------------

  /**
   * This account's plan and one month's usage, in one indexed read.
   *
   * Runs before every metered MCP call, so it is a single query: the tenant row
   * and, through the relation, the one usage row for the month.
   */
  async usage(month: string): Promise<UsageSnapshot> {
    const row = await db().tenant.findUnique({
      where: { id: this.tenantId },
      select: {
        plan: true,
        planRenewsAt: true,
        industry: true,
        usageMonths: { where: { month }, select: { calls: true, noticesShown: true } },
      },
    })
    if (row === null) throw new TenantScopeError('This account no longer exists.')
    const used = row.usageMonths[0]
    return {
      plan: row.plan,
      planRenewsAt: row.planRenewsAt,
      month,
      calls: used?.calls ?? 0,
      noticesShown: used?.noticesShown ?? [],
      industry: row.industry,
    }
  }

  /**
   * Records what kind of business this account is: one code from core's
   * INDUSTRIES. The caller passes only a listed code (the set_business_type
   * tool's argument is that enum); the tenants_industry_known CHECK refuses
   * anything else, so free text cannot be stored even by a future caller that
   * forgets. This package does not depend on core, so the list is not repeated
   * here as well.
   *
   * updateMany rather than update, so a tenant that no longer exists is the
   * same plain error usage() gives rather than a Prisma "record not found".
   */
  async setIndustry(code: string): Promise<void> {
    const { count } = await db().tenant.updateMany({ where: { id: this.tenantId }, data: { industry: code } })
    if (count === 0) throw new TenantScopeError('This account no longer exists.')
  }

  /**
   * Records one tool call and, when it counts, adds it to the month — in one
   * transaction, so the log and the counter cannot disagree.
   *
   * The counter is an upsert with an increment, which Postgres runs as a single
   * INSERT ... ON CONFLICT DO UPDATE: two calls at once each get their own
   * count back, so exactly one of them is the call that crosses a threshold.
   *
   * Returns the month after this call, or null for a call that is not counted
   * (the free account tools, and a call refused at the limit).
   */
  async recordToolCall(call: ToolCallInput, options: { month: string; count: boolean }): Promise<CountedMonth | null> {
    // Built lazily by Prisma: nothing is sent until it is awaited or batched.
    const log = db().toolCall.create({
      data: {
        tenantId: this.tenantId,
        tool: call.tool,
        ok: call.ok,
        durationMs: Math.max(0, Math.round(call.durationMs)),
        transport: call.transport,
        ...(call.userId !== undefined ? { userId: call.userId } : {}),
        ...(call.errorCode !== undefined ? { errorCode: call.errorCode } : {}),
        ...(call.clientName !== undefined ? { clientName: call.clientName } : {}),
        ...(call.clientVersion !== undefined ? { clientVersion: call.clientVersion } : {}),
      },
      select: { id: true },
    })
    if (!options.count) {
      await log
      return null
    }

    const [, month] = await db().$transaction([
      log,
      db().usageMonth.upsert({
        where: { tenantId_month: { tenantId: this.tenantId, month: options.month } },
        create: { tenantId: this.tenantId, month: options.month, calls: 1 },
        update: { calls: { increment: 1 } },
        select: { calls: true, noticesShown: true },
      }),
    ])
    return { month: options.month, calls: month.calls, noticesShown: month.noticesShown }
  }

  /**
   * Remembers that this month's notices at these thresholds have been shown.
   *
   * Separate from recordToolCall because which notice to show is decided from
   * the count that call returns. If this write is lost the notice is still not
   * repeated: only the call that crosses a threshold can show it.
   */
  async markNoticesShown(month: string, thresholds: readonly number[]): Promise<void> {
    if (thresholds.length === 0) return
    await db().usageMonth.updateMany({
      where: { tenantId: this.tenantId, month },
      data: { noticesShown: { push: [...thresholds] } },
    })
  }
}

/** An account's plan and one month's counted calls. */
export interface UsageSnapshot {
  readonly plan: 'free' | 'premium'
  readonly planRenewsAt: Date | null
  readonly month: string
  readonly calls: number
  readonly noticesShown: readonly number[]
  /**
   * The tenant's industry (a code from core INDUSTRIES), or null until the
   * user has picked one with set_business_type. Read through core
   * industryOf() before use, so a stored value that is not on the list counts
   * as unknown. Optional so test fakes can leave it out.
   */
  readonly industry?: string | null | undefined
}

/** A month's count straight after a counted call. */
export interface CountedMonth {
  readonly month: string
  readonly calls: number
  /** Thresholds shown before this call. */
  readonly noticesShown: readonly number[]
}

/**
 * What is recorded about one MCP call. Deliberately no arguments, no result and
 * no content: see the ToolCall model.
 */
export interface ToolCallInput {
  readonly tool: string
  readonly ok: boolean
  readonly errorCode?: string | undefined
  readonly durationMs: number
  readonly userId?: string | undefined
  readonly clientName?: string | undefined
  readonly clientVersion?: string | undefined
  readonly transport: 'stdio' | 'http'
}

/** Resolves a tenant, or null. Used where a missing tenant is not an error. */
export async function tenantScopeFor(tenantId: string): Promise<TenantScope | null> {
  const tenant = await db().tenant.findUnique({ where: { id: tenantId } })
  return tenant === null ? null : new TenantScope(tenant.id)
}

/**
 * Deletes a tenant and everything it owns.
 *
 * A plain `tenant.delete()` does NOT work: the cascade reaches connections, but
 * `targets.connection_id` is `onDelete: Restrict` — deliberately, so that deleting
 * one connection cannot silently erase the post history that references it. The
 * result is that the foreign key blocks the cascade partway through and leaves the
 * tenant half-deleted.
 *
 * So deletion is explicit and ordered, innermost first. This is also what a real
 * account-closure or data-deletion request needs, so it belongs in the product
 * rather than only in test teardown.
 *
 * Note this does NOT remove uploaded media from object storage — those files are
 * content-addressed and may be shared. Storage cleanup is a separate concern.
 */
export async function deleteTenantCompletely(tenantId: string): Promise<void> {
  assertTenantId(tenantId)

  await db().$transaction([
    db().job.deleteMany({ where: { tenantId } }),
    db().target.deleteMany({ where: { tenantId } }),
    db().postMedia.deleteMany({ where: { post: { tenantId } } }),
    db().post.deleteMany({ where: { tenantId } }),
    db().mediaAsset.deleteMany({ where: { tenantId } }),
    db().connection.deleteMany({ where: { tenantId } }),
    db().auditLog.deleteMany({ where: { tenantId } }),
    db().tenant.delete({ where: { id: tenantId } }),
  ])
}
