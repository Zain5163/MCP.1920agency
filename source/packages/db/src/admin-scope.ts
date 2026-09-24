import { db } from './client.ts'
import { TenantScope, TenantScopeError } from './tenant-scope.ts'

/**
 * Cross-tenant access for the platform operator.
 *
 * Two rules, and they are the whole point of this file:
 *
 *   1. **You cannot reach this from a TenantScope.** There is no `asAdmin()` or
 *      escalation method. An AdminScope has to be constructed deliberately, from a
 *      user row whose role actually says `owner`. An admin capability reachable by
 *      accident is a confused-deputy bug waiting to happen — and with an AI driving
 *      the system, "reachable by accident" includes "a model called it".
 *
 *   2. **Every cross-tenant read is written to the audit log of the tenant being
 *      read**, not ours. If we look at a customer's data, that fact lives in their
 *      record where they can see it. Support access that leaves no trace is
 *      indistinguishable from a breach.
 */

export class AdminAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminAccessError'
  }
}

export interface AdminActor {
  readonly userId: string
  readonly email: string
}

export class AdminScope {
  readonly actor: AdminActor

  /** Private by convention — use `adminScopeForUser`, which verifies the role. */
  constructor(actor: AdminActor) {
    this.actor = actor
  }

  async tenants() {
    return await db().tenant.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { connections: true, posts: true, users: true } },
      },
    })
  }

  /**
   * Opens a scope onto another tenant, recording that it happened.
   *
   * The reason is required and is not decorative — it is what makes the audit
   * entry useful six months later when someone asks why this account was opened.
   */
  async openTenant(tenantId: string, reason: string): Promise<TenantScope> {
    if (reason.trim().length < 5) {
      throw new AdminAccessError(
        'A reason is required to open another account, and it must be meaningful.',
      )
    }

    const tenant = await db().tenant.findUnique({ where: { id: tenantId } })
    if (tenant === null) throw new AdminAccessError(`No such account: ${tenantId}`)

    await db().auditLog.create({
      data: {
        tenantId,
        actor: `admin:${this.actor.email}`,
        action: 'admin.account_opened',
        detail: { reason, adminUserId: this.actor.userId },
      },
    })

    return new TenantScope(tenant.id)
  }

  /** Operational totals only — no tenant content, so no audit entry needed. */
  async platformStats() {
    const [tenants, users, connections, posts, failedJobs, queuedJobs] = await Promise.all([
      db().tenant.count(),
      db().user.count(),
      db().connection.count(),
      db().post.count(),
      db().job.count({ where: { state: 'failed' } }),
      db().job.count({ where: { state: 'queued' } }),
    ])
    return { tenants, users, connections, posts, failedJobs, queuedJobs }
  }

  /**
   * Connections needing reattention across all accounts.
   *
   * Returns no content and no credentials — just which account is broken and why,
   * which is what an operator needs to prompt a customer to reconnect.
   */
  async connectionsNeedingAttention() {
    return await db().connection.findMany({
      where: { needsReauth: true },
      select: {
        id: true,
        tenantId: true,
        platform: true,
        displayName: true,
        reauthReason: true,
        tenant: { select: { name: true } },
      },
    })
  }
}

/**
 * Builds an AdminScope, but only for a user whose stored role is `owner`.
 *
 * Throws rather than returning null: asking for admin access and not getting it is
 * an exceptional condition worth surfacing loudly, not a quiet empty result.
 */
export async function adminScopeForUser(userId: string): Promise<AdminScope> {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new AdminAccessError('A user id is required.')
  }

  const user = await db().user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  })

  if (user === null) throw new AdminAccessError('No such user.')
  if (user.role !== 'owner') {
    throw new AdminAccessError(
      `User ${user.email} has role "${user.role}" and cannot access other accounts.`,
    )
  }

  return new AdminScope({ userId: user.id, email: user.email })
}

/** The ordinary path: a scope over the user's own tenant, whatever their role. */
export async function scopeForUser(userId: string): Promise<TenantScope> {
  const user = await db().user.findUnique({
    where: { id: userId },
    select: { tenantId: true },
  })
  if (user === null) throw new TenantScopeError('No such user.')
  return new TenantScope(user.tenantId)
}
