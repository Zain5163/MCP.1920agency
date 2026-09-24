import { db } from './client.ts'

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
