import { optional } from '@social-publisher/config'
import { disconnect, recordHeartbeat, runHealthChecks, type HealthCheck } from '@social-publisher/db'
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

async function main(): Promise<void> {
  const report = await runHealthChecks()

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
