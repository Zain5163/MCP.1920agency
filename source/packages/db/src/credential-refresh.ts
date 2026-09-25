import { db } from './client.ts'

/**
 * Finding credentials that are about to die.
 *
 * Some platforms issue tokens that expire on their own. Threads is the first here:
 * 60 days, refreshable only between 24 hours and 60 days after issue. Miss that
 * window and the connection is gone entirely, needing a full reauthorisation from
 * the customer — which is exactly the kind of silent failure this project keeps
 * designing against.
 *
 * A Facebook Page token, by contrast, lives as long as the app stays installed
 * and has nothing to refresh. So "no expiry recorded" means nothing to do, not a
 * problem.
 */

export interface ExpiringCredential {
  readonly id: string
  readonly tenantId: string
  readonly provider: string
  readonly displayName: string | null
  readonly expiresAt: Date
  readonly daysLeft: number
  readonly needsReauth: boolean
}

/**
 * Authorisations expiring within the window.
 *
 * Default 14 days: comfortably inside a 60-day Threads window, and far enough
 * ahead that several refresh attempts can fail before anything is lost.
 */
export async function expiringProviderAuths(withinDays = 14): Promise<ExpiringCredential[]> {
  const cutoff = new Date(Date.now() + withinDays * 86_400_000)

  const rows = await db().providerAuth.findMany({
    where: {
      expiresAt: { not: null, lte: cutoff },
      needsReauth: false,
    },
    select: {
      id: true,
      tenantId: true,
      provider: true,
      displayName: true,
      expiresAt: true,
      needsReauth: true,
    },
    orderBy: { expiresAt: 'asc' },
  })

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    provider: r.provider,
    displayName: r.displayName,
    expiresAt: r.expiresAt!,
    daysLeft: Math.round(((r.expiresAt!.getTime() - Date.now()) / 86_400_000) * 10) / 10,
    needsReauth: r.needsReauth,
  }))
}

/**
 * Authorisations that have already expired.
 *
 * Reported separately because these are unrecoverable by refresh — the customer
 * has to reauthorise, and telling them that is the only useful action left.
 */
export async function expiredProviderAuths(): Promise<ExpiringCredential[]> {
  const rows = await db().providerAuth.findMany({
    where: { expiresAt: { not: null, lt: new Date() } },
    select: {
      id: true,
      tenantId: true,
      provider: true,
      displayName: true,
      expiresAt: true,
      needsReauth: true,
    },
  })

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    provider: r.provider,
    displayName: r.displayName,
    expiresAt: r.expiresAt!,
    daysLeft: Math.round(((r.expiresAt!.getTime() - Date.now()) / 86_400_000) * 10) / 10,
    needsReauth: r.needsReauth,
  }))
}

/**
 * Marks an authorisation dead, and every connection that depends on it.
 *
 * Both halves matter. Without the connection update, publishing would keep being
 * attempted with a token known to be broken, failing once per post instead of
 * once, and burying the real cause under platform errors.
 */
export async function markAuthExpired(providerAuthId: string, reason: string): Promise<void> {
  await db().$transaction([
    db().providerAuth.update({
      where: { id: providerAuthId },
      data: { needsReauth: true, reauthReason: reason },
    }),
    db().connection.updateMany({
      where: { providerAuthId },
      data: { needsReauth: true, reauthReason: reason },
    }),
  ])
}

/** Records a successful refresh, clearing any previous failure. */
export async function recordRefreshed(providerAuthId: string, expiresAt: Date): Promise<void> {
  await db().providerAuth.update({
    where: { id: providerAuthId },
    data: { expiresAt, needsReauth: false, reauthReason: null },
  })
}
