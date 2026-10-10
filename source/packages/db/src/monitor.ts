import { FIXED_NAMES } from '@social-publisher/config'

import { db } from './client.ts'
import { expiredProviderAuths, expiringProviderAuths } from './credential-refresh.ts'

/**
 * Self-checks.
 *
 * The problem this solves: **a stopped worker and an empty queue look identical.**
 * No posts go out, nothing errors, and the first sign of trouble is a customer
 * asking why nothing published. Silence is not evidence that things are fine.
 *
 * So every background component reports proof-of-life, and something separate
 * reads those and complains. Deliberately separate — a worker cannot be trusted to
 * report that it is not running.
 */

export type Severity = 'ok' | 'warning' | 'critical'

export interface HealthCheck {
  readonly name: string
  readonly severity: Severity
  readonly summary: string
  /** What to do about it. Never report a problem without one. */
  readonly action?: string
  readonly detail?: Record<string, unknown>
}

export interface HealthReport {
  readonly worst: Severity
  readonly checks: readonly HealthCheck[]
  readonly checkedAt: Date
}

/** Components write this on every run. */
export async function recordHeartbeat(
  name: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await db().serviceHeartbeat.upsert({
    where: { name },
    create: { name, ...(detail !== undefined ? { detail: detail as never } : {}) },
    update: { beatAt: new Date(), ...(detail !== undefined ? { detail: detail as never } : {}) },
  })
}

export async function heartbeatAgeMinutes(name: string): Promise<number | null> {
  const row = await db().serviceHeartbeat.findUnique({ where: { name } })
  return row === null ? null : (Date.now() - row.beatAt.getTime()) / 60_000
}

/**
 * Is the scheduler alive?
 *
 * It is registered to run every 5 minutes, so anything past ~20 means several
 * consecutive runs were missed — not one slow tick.
 */
export async function checkWorker(options: {
  warnAfterMinutes?: number
  criticalAfterMinutes?: number
} = {}): Promise<HealthCheck> {
  const warnAfter = options.warnAfterMinutes ?? 20
  const criticalAfter = options.criticalAfterMinutes ?? 60

  const age = await heartbeatAgeMinutes('worker')

  if (age === null) {
    return {
      name: 'worker',
      severity: 'warning',
      summary: 'The scheduler has never reported running.',
      action:
        `Run it once by hand (run-worker-now.cmd). If that works, check the ${FIXED_NAMES.PC_WORKER_TASK} task exists in Task Scheduler and is enabled.`,
    }
  }

  if (age > criticalAfter) {
    return {
      name: 'worker',
      severity: 'critical',
      summary: `The scheduler has not run for ${Math.round(age)} minutes. Scheduled posts are not going out.`,
      action:
        `Check the ${FIXED_NAMES.PC_WORKER_TASK} task in Task Scheduler: enabled, and what LastTaskResult says. Run run-worker-now.cmd to publish anything already due.`,
      detail: { ageMinutes: Math.round(age) },
    }
  }

  if (age > warnAfter) {
    return {
      name: 'worker',
      severity: 'warning',
      summary: `The scheduler last ran ${Math.round(age)} minutes ago. It should run every 5.`,
      action: 'Usually a missed tick. If it keeps growing, check Task Scheduler.',
      detail: { ageMinutes: Math.round(age) },
    }
  }

  return {
    name: 'worker',
    severity: 'ok',
    summary: `Scheduler ran ${Math.round(age)} minute(s) ago.`,
  }
}

/**
 * Posts that were due and have not gone out.
 *
 * Catches the case the heartbeat cannot: the worker is running fine, but jobs are
 * stuck behind something — a bad row, a lock that never clears.
 */
export async function checkOverdueJobs(toleranceMinutes = 15): Promise<HealthCheck> {
  const cutoff = new Date(Date.now() - toleranceMinutes * 60_000)
  const overdue = await db().job.count({ where: { state: 'queued', runAfter: { lt: cutoff } } })

  if (overdue === 0) {
    return { name: 'queue', severity: 'ok', summary: 'No overdue posts.' }
  }

  return {
    name: 'queue',
    severity: overdue > 5 ? 'critical' : 'warning',
    summary: `${overdue} post(s) were due over ${toleranceMinutes} minutes ago and have not published.`,
    action:
      'Run run-worker-now.cmd. If they stay queued, look at last_error on the jobs table — the reason is recorded there.',
    detail: { overdue },
  }
}

/** Jobs a worker claimed and never finished, i.e. it died mid-publish. */
export async function checkStuckJobs(staleMinutes = 30): Promise<HealthCheck> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000)
  const stuck = await db().job.count({ where: { state: 'running', lockedAt: { lt: cutoff } } })

  if (stuck === 0) return { name: 'stuck-jobs', severity: 'ok', summary: 'No stalled jobs.' }

  return {
    name: 'stuck-jobs',
    severity: 'warning',
    summary: `${stuck} job(s) have been running for over ${staleMinutes} minutes.`,
    action:
      'The worker reclaims stale locks automatically on its next run, so this usually clears itself. If it persists, a publish is hanging.',
    detail: { stuck },
  }
}

/** Connections whose tokens died. Nothing publishes to these until reconnected. */
export async function checkConnections(): Promise<HealthCheck> {
  const broken = await db().connection.findMany({
    where: { needsReauth: true },
    select: { displayName: true, platform: true, reauthReason: true },
  })

  if (broken.length === 0) {
    return { name: 'connections', severity: 'ok', summary: 'All connected accounts are usable.' }
  }

  return {
    name: 'connections',
    severity: 'critical',
    summary: `${broken.length} account(s) need reconnecting: ${broken.map((c) => c.displayName).join(', ')}`,
    action: 'Run the connect command and approve access again. Nothing will publish to these until you do.',
    detail: { accounts: broken },
  }
}

/** Targets that failed permanently. Someone has to look at these. */
export async function checkFailures(withinHours = 24): Promise<HealthCheck> {
  const since = new Date(Date.now() - withinHours * 3_600_000)
  const failed = await db().target.count({ where: { state: 'failed', updatedAt: { gte: since } } })

  if (failed === 0) {
    return { name: 'failures', severity: 'ok', summary: `No failed posts in the last ${withinHours}h.` }
  }

  return {
    name: 'failures',
    severity: 'warning',
    summary: `${failed} post(s) failed in the last ${withinHours}h.`,
    action: 'Open the dashboard — each failure shows the platform’s own reason and what to do about it.',
    detail: { failed },
  }
}

/** Supabase pauses free projects after 7 days without activity. */
export async function checkDatabaseKeepAlive(): Promise<HealthCheck> {
  const beat = await db().heartbeat.findUnique({ where: { id: 1 } })

  if (beat === null) {
    return {
      name: 'keep-alive',
      severity: 'warning',
      summary: 'The database keep-alive has never run.',
      action: 'Run the keepalive command once, and check the Social-Publisher-Keepalive task exists.',
    }
  }

  const days = (Date.now() - beat.beatAt.getTime()) / 86_400_000

  if (days >= 6) {
    return {
      name: 'keep-alive',
      severity: 'critical',
      summary: `Keep-alive is ${days.toFixed(1)} days old. Supabase pauses free projects at 7.`,
      action: 'Run the keepalive command now, then check the scheduled task is enabled.',
      detail: { ageDays: Number(days.toFixed(1)) },
    }
  }

  if (days >= 4) {
    return {
      name: 'keep-alive',
      severity: 'warning',
      summary: `Keep-alive is ${days.toFixed(1)} days old.`,
      action: 'No action yet. It becomes urgent at 6 days.',
      detail: { ageDays: Number(days.toFixed(1)) },
    }
  }

  return { name: 'keep-alive', severity: 'ok', summary: `Keep-alive ran ${days.toFixed(1)} days ago.` }
}

/**
 * Authorisations about to expire.
 *
 * Separate from checkConnections, which catches credentials already known to be
 * broken. This catches the ones that are working today and will stop on their
 * own — the failure that gives no warning unless something looks for it.
 */
export async function checkCredentialExpiry(): Promise<HealthCheck> {
  const [expired, expiring] = await Promise.all([
    expiredProviderAuths(),
    expiringProviderAuths(7),
  ])

  if (expired.length > 0) {
    return {
      name: 'credential-expiry',
      severity: 'critical',
      summary: `${expired.length} authorisation(s) have expired: ${expired.map((e) => e.provider).join(', ')}`,
      action:
        'Refresh cannot recover these — run the connect command for that platform to authorise again.',
      detail: { providers: expired.map((e) => e.provider) },
    }
  }

  if (expiring.length > 0) {
    const soonest = expiring[0]!
    return {
      name: 'credential-expiry',
      severity: 'warning',
      summary: `${soonest.provider} authorisation expires in ${soonest.daysLeft} day(s).`,
      action:
        `The refresh task should renew this automatically. If it keeps counting down, check that ${FIXED_NAMES.PC_REFRESH_TASK} is enabled and what its last run reported.`,
      detail: { provider: soonest.provider, daysLeft: soonest.daysLeft },
    }
  }

  return { name: 'credential-expiry', severity: 'ok', summary: 'No authorisations expiring soon.' }
}

const RANK: Record<Severity, number> = { ok: 0, warning: 1, critical: 2 }

/**
 * Runs every check.
 *
 * Each runs independently and a failure inside one is reported rather than
 * thrown — a monitor that dies on its first problem tells you nothing about the
 * rest, which is the opposite of its job.
 */
export async function runHealthChecks(): Promise<HealthReport> {
  const checks = await Promise.all(
    [
      checkWorker,
      checkOverdueJobs,
      checkStuckJobs,
      checkConnections,
      checkCredentialExpiry,
      checkFailures,
      checkDatabaseKeepAlive,
    ].map(
      async (check): Promise<HealthCheck> => {
        try {
          return await check()
        } catch (error) {
          return {
            name: check.name,
            severity: 'warning',
            summary: `Could not run this check: ${error instanceof Error ? error.message : String(error)}`,
            action: 'Usually the database being briefly unreachable. Retry.',
          }
        }
      },
    ),
  )

  const worst = checks.reduce<Severity>(
    (acc, c) => (RANK[c.severity] > RANK[acc] ? c.severity : acc),
    'ok',
  )

  return { worst, checks, checkedAt: new Date() }
}
