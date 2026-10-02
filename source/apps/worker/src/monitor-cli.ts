import { META_REQUIRED_SCOPES, inspectMetaToken } from '@social-publisher/adapters'
import { optional, required } from '@social-publisher/config'
import { db, disconnect, prismaCredentialStore, recordHeartbeat, runHealthChecks, type HealthCheck } from '@social-publisher/db'
import { TokenVault, parseKey } from '@social-publisher/vault'
import { createLogger } from '@social-publisher/telemetry'

/**
 * `monitor` — the thing that notices when nothing is happening.
 *
 * Runs on its own schedule, separately from the worker, because **a worker cannot
 * be trusted to report that it is not running.** If the monitor and the worker
 * shared a process, a crash would take out both and the silence would be complete.
 *
 * Exit codes are meaningful so Task Scheduler's LastTaskResult is informative:
 *   0  everything healthy
 *   1  warnings
 *   2  something critical
 */

const logger = createLogger({
  slackWebhookUrl: optional('SLACK_WEBHOOK_URL'),
  console: false,
  base: { event: 'monitor' },
})

const ICON: Record<HealthCheck['severity'], string> = {
  ok: '  ok      ',
  warning: '  WARNING ',
  critical: '  CRITICAL',
}

/**
 * Asks Meta whether each Facebook and Instagram token still works.
 *
 * Added 2026-10-02. Both Meta connections had been dead for an unknown time —
 * Meta had withdrawn their Page permissions — while every check reported them
 * "ready", because only expiry dates were looked at. A dead connection is now
 * marked needs-reauth, so the dashboard, `list_accounts` and the worker all see
 * it, and the alert says how to fix it.
 */
async function metaTokenChecks(): Promise<HealthCheck[]> {
  const appId = optional('META_APP_ID')
  const appSecret = optional('META_APP_SECRET')
  if (appId === undefined || appSecret === undefined) return []
  const store = prismaCredentialStore()
  const vault = new TokenVault({ kek: parseKey(required('VAULT_MASTER_KEY'), 'VAULT_MASTER_KEY'), keyVersion: 1, store })
  const rows = await db().connection.findMany({
    // Flagged ones too: a reconnect can revive a token without touching its
    // row (Meta judges Page tokens by the login's current permissions), and a
    // flag nobody lifts keeps a working account switched off.
    where: { platform: { in: Object.keys(META_REQUIRED_SCOPES) as never } },
  })
  const checks: HealthCheck[] = []
  for (const row of rows) {
    try {
      const health = await vault.withCredential(row.id, row.tenantId, async (cred) =>
        await inspectMetaToken({
          token: cred.accessToken,
          appId,
          appSecret,
          required: META_REQUIRED_SCOPES[row.platform] ?? [],
          apiVersion: optional('META_API_VERSION', 'v25.0')!,
        }),
      )
      if (health.valid) {
        if (row.needsReauth) {
          await db().connection.updateMany({
            where: { id: row.id, tenantId: row.tenantId },
            data: { needsReauth: false, reauthReason: null },
          })
          checks.push({ name: 'meta_token', severity: 'ok', summary: `"${row.displayName}" works again; its reconnect flag was lifted.` })
        }
        continue
      }
      if (row.needsReauth) continue
      const reason = health.missing.length > 0 ? `permissions withdrawn: ${health.missing.join(', ')}` : (health.reason ?? 'Meta reports the token invalid')
      await store.markNeedsReauth(row.id, row.tenantId, reason)
      checks.push({
        name: 'meta_token',
        severity: 'critical',
        summary: `"${row.displayName}" cannot post: ${reason}.`,
        action: 'Reconnect Facebook in the dashboard (Accounts → Reconnect) and keep every permission ticked.',
        detail: { connectionId: row.id, platform: row.platform },
      })
    } catch (error) {
      checks.push({
        name: 'meta_token',
        severity: 'warning',
        summary: `Could not check "${row.displayName}": ${error instanceof Error ? error.message : String(error)}`,
        action: 'Usually a network blip; the next run checks again.',
      })
    }
  }
  return checks
}

async function main(): Promise<void> {
  const base = await runHealthChecks()
  const tokenChecks = await metaTokenChecks()
  const order = { ok: 0, warning: 1, critical: 2 } as const
  const report = {
    ...base,
    checks: [...base.checks, ...tokenChecks],
    worst: [base.worst, ...tokenChecks.map((c) => c.severity)].reduce((a, b) => (order[b] > order[a] ? b : a)),
  }

  console.log(`\n  AdsPilot health — ${report.checkedAt.toISOString()}\n`)

  for (const check of report.checks) {
    console.log(`${ICON[check.severity]}  ${check.name.padEnd(14)} ${check.summary}`)
    // Never report a problem without saying what to do about it.
    if (check.action !== undefined && check.severity !== 'ok') {
      console.log(`${' '.repeat(12)}→ ${check.action}`)
    }
  }

  const problems = report.checks.filter((c) => c.severity !== 'ok')

  if (problems.length === 0) {
    console.log('\n  All checks passed.\n')
    await recordHeartbeat('monitor', { worst: 'ok' })
    await disconnect()
    return
  }

  /**
   * Alerts go to Slack only for real problems, and carry the remedy.
   *
   * A channel that receives routine "everything is fine" messages gets muted
   * within a week, and a muted channel is worse than no channel at all.
   */
  for (const problem of problems) {
    const extra: Record<string, unknown> = { check: problem.name }
    if (problem.action !== undefined) extra.action = problem.action
    if (problem.detail !== undefined) extra.detail = problem.detail

    await logger.log({
      level: problem.severity === 'critical' ? 'error' : 'warn',
      event: `health.${problem.name}`,
      message: `${problem.summary}${problem.action !== undefined ? ` — ${problem.action}` : ''}`,
      data: extra,
    })
  }

  console.log(`\n  ${problems.length} issue(s) found.\n`)
  await recordHeartbeat('monitor', { worst: report.worst, problems: problems.length })
  await disconnect()

  process.exit(report.worst === 'critical' ? 2 : 1)
}

main().catch(async (error: unknown) => {
  // A monitor that dies silently is worse than no monitor: it looks like health.
  console.error(`\n  MONITOR FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
  await logger
    .error('health.monitor_failed', 'The monitor itself could not run', { data: { error } })
    .catch(() => {})
  await disconnect().catch(() => {})
  process.exit(2)
})
