import { parseArgs } from 'node:util'

import {
  FacebookPageAdapter,
  InstagramAdapter,
  ThreadsAdapter,
  PinterestAdapter,
  LinkedInAdapter,
  YouTubeAdapter,
  youTubeOptionsFromEnv,
} from '@social-publisher/adapters'
import { optional, required } from '@social-publisher/config'
import { backoffMs, type Connection } from '@social-publisher/core'
import {
  ATTACHMENTS_NOT_STORED_CODE,
  ATTACHMENTS_NOT_STORED_MESSAGE,
  MAX_ATTEMPTS,
  WORKER_ID,
  attachmentsNotStored,
  claimNext,
  completeJob,
  db,
  disconnect,
  failJob,
  publishedColumns,
  queueStats,
  recordHeartbeat,
  reclaimStale,
  retryJob,
  touchJob,
} from '@social-publisher/db'
import { PublishService } from '@social-publisher/publisher'
import { TokenVault, parseKey } from '@social-publisher/vault'

import { credentialFor } from './credential.ts'
import { draftFromStored } from './draft.ts'

/**
 * The scheduler worker.
 *
 * This is what turns the system from "publishes when you run a command" into
 * "publishes on its own". Every automation idea — daily posts, content calendars,
 * AI-generated queues — is this process executing rows from the jobs table.
 *
 * Design rules, all of which exist to avoid silent failure:
 *   - one job claimed at a time, atomically, so two workers never take the same one
 *   - transient failures retry with jittered backoff; permanent ones stop immediately
 *   - a job that has already produced a platform post is never re-attempted
 *   - a crashed worker's jobs are reclaimed rather than stranded
 */

const log = (message: string): void => {
  console.log(`[worker ${new Date().toISOString()}] ${message}`)
}

/**
 * How often a running job's lock is refreshed. Far inside the 15 minutes after
 * which reclaimStale calls a lock abandoned, so a long upload is never handed
 * to a second worker — which, with no idempotency key on a video upload, would
 * be a second copy of the video.
 */
const LOCK_HEARTBEAT_MS = 60_000

function buildService(): PublishService {
  const apiVersion = optional('META_API_VERSION', 'v25.0')!
  const appSecret = required('META_APP_SECRET')
  return new PublishService([
    new FacebookPageAdapter({ apiVersion, appSecret }),
    new InstagramAdapter({ apiVersion, appSecret }),
    new ThreadsAdapter(),
    new PinterestAdapter(),
    // LinkedIn uses its own API, its own token and its own version header.
    new LinkedInAdapter(),
    // Google's token and settings; uploads stay private until the API audit passes.
    new YouTubeAdapter(youTubeOptionsFromEnv((key) => optional(key))),
  ])
}

function buildVault(): TokenVault {
  return new TokenVault({
    kek: parseKey(required('VAULT_MASTER_KEY'), 'VAULT_MASTER_KEY'),
    keyVersion: 1,
    store: {
      async load(connectionId, tenantId) {
        const row = await db().connection.findFirst({
          where: { id: connectionId, tenantId },
          select: { id: true, tenantId: true, secretCiphertext: true, expiresAt: true },
        })
        return row === null
          ? null
          : {
              connectionId: row.id,
              tenantId: row.tenantId,
              secretCiphertext: row.secretCiphertext,
              expiresAt: row.expiresAt,
            }
      },
      async save(record) {
        await db().connection.update({
          where: { id: record.connectionId },
          data: {
            secretCiphertext: record.secretCiphertext,
            keyVersion: record.keyVersion,
            expiresAt: record.expiresAt,
          },
        })
      },
      async markNeedsReauth(connectionId, tenantId, reason) {
        await db().connection.updateMany({
          where: { id: connectionId, tenantId },
          data: { needsReauth: true, reauthReason: reason },
        })
      },
    },
  })
}

/** Returns true if a job was processed, false when the queue was empty. */
async function processOne(service: PublishService, vault: TokenVault): Promise<boolean> {
  const job = await claimNext()
  if (job === null) return false

  const target = await db().target.findUnique({
    where: { id: job.targetId },
    include: { post: { include: { media: { include: { media: true }, orderBy: { position: 'asc' } } } }, connection: true },
  })

  if (target === null) {
    await failJob(job.jobId, 'Target row no longer exists')
    log(`job ${job.jobId}: target missing, failed`)
    return true
  }

  /**
   * Idempotency guard. If a platform post id is already recorded, the publish
   * succeeded even if the worker died before marking the job done. Re-running
   * would double-post, which is worse than any error.
   */
  if (target.platformPostId !== null) {
    await completeJob(job.jobId)
    log(`job ${job.jobId}: already published as ${target.platformPostId}, skipping`)
    return true
  }

  /**
   * A post published now from a local file never had its attachments stored.
   * Rebuilt from the rows below it would go out as text alone, and a platform
   * that allows a bare post would publish it so. retryTarget refuses to queue
   * such a target; this refuses it again, should anything else ever queue it.
   */
  if (attachmentsNotStored(target)) {
    await db().target.update({
      where: { id: target.id },
      data: {
        state: 'failed',
        failureClass: 'permanent',
        platformMessage: ATTACHMENTS_NOT_STORED_MESSAGE,
        errorCode: ATTACHMENTS_NOT_STORED_CODE,
      },
    })
    await failJob(job.jobId, ATTACHMENTS_NOT_STORED_MESSAGE)
    log(`job ${job.jobId}: REFUSED, nothing published — ${ATTACHMENTS_NOT_STORED_MESSAGE}`)
    return true
  }

  const connection: Connection = {
    id: target.connection.id,
    tenantId: target.connection.tenantId,
    platform: target.connection.platform,
    platformAccountId: target.connection.platformAccountId,
    displayName: target.connection.displayName,
    credentialSource: target.connection.credentialSource,
    scopes: target.connection.scopes,
    needsReauth: target.connection.needsReauth,
    ...(target.connection.expiresAt !== null ? { expiresAt: target.connection.expiresAt } : {}),
  }

  const draft = draftFromStored(target.post)

  await db().target.update({ where: { id: target.id }, data: { state: 'publishing' } })

  // Keep the lock fresh for as long as the publish runs. Unref'd, so a stuck
  // timer can never keep the process alive on its own.
  const heartbeat = setInterval(() => {
    touchJob(job.jobId).catch((error: unknown) => {
      log(`job ${job.jobId}: could not refresh its lock — ${error instanceof Error ? error.message : String(error)}`)
    })
  }, LOCK_HEARTBEAT_MS)
  heartbeat.unref()

  const adapter = service.adapterFor(connection.platform)
  let report: Awaited<ReturnType<PublishService['publish']>>
  try {
    report = await service.publish(
      draft,
      [
        {
          connection,
          // Renews an hour-long token on the way in, and again mid-upload when
          // the adapter asks. Undefined for every adapter whose tokens do not
          // renew, which changes nothing for them.
          withCredential: credentialFor(
            vault,
            connection,
            adapter?.refreshCredential?.bind(adapter),
            (message) => log(`job ${job.jobId}: ${message}`),
          ),
        },
      ],
      { idempotencyKeyFor: () => target.idempotencyKey },
    )
  } finally {
    clearInterval(heartbeat)
  }

  const outcome = report.succeeded[0] ?? report.failed[0]!

  if (outcome.ok) {
    // A notice means it went through but not as "published" implies — a video
    // uploaded private, for one. It is kept with the target, with the code that
    // makes the dashboard show it as "uploaded", and logged as such.
    const notice = outcome.result!.notice
    await db().target.update({
      where: { id: target.id },
      data: { ...publishedColumns(outcome.result!), attempts: { increment: 1 } },
    })
    await completeJob(job.jobId)
    log(
      `job ${job.jobId}: ${notice === undefined ? 'PUBLISHED' : 'UPLOADED'} to ${connection.displayName} — ` +
        `${outcome.result!.url ?? outcome.result!.platformPostId}${notice === undefined ? '' : ` — ${notice}`}`,
    )
    return true
  }

  const error = outcome.error!
  const shouldRetry = error.retryable && job.attempts < MAX_ATTEMPTS

  if (shouldRetry) {
    const delay = error.retryAfterMs ?? backoffMs(job.attempts)
    const at = await retryJob(job.jobId, delay, error.message)
    await db().target.update({
      where: { id: target.id },
      data: { state: 'scheduled', attempts: { increment: 1 }, platformMessage: error.message },
    })
    log(
      `job ${job.jobId}: transient failure (attempt ${job.attempts}/${MAX_ATTEMPTS}), retrying at ${at.toISOString()} — ${error.message}`,
    )
    return true
  }

  await db().target.update({
    where: { id: target.id },
    data: {
      state: error.failureClass === 'credential' ? 'needs_reauth' : 'failed',
      attempts: { increment: 1 },
      failureClass: error.failureClass,
      platformMessage: error.message,
      errorCode: error.platformCode ?? null,
    },
  })
  await failJob(job.jobId, error.message)
  log(
    `job ${job.jobId}: FAILED (${error.failureClass}${error.retryable ? ', retries exhausted' : ''}) — ${error.message}`,
  )
  return true
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      once: { type: 'boolean', default: false },
      interval: { type: 'string' },
    },
  })

  const intervalMs = Number(values.interval ?? 15_000)
  const service = buildService()
  const vault = buildVault()

  const reclaimed = await reclaimStale()
  if (reclaimed > 0) log(`reclaimed ${reclaimed} stale job(s) from a previous run`)

  // Proof of life, written before any work. A worker that cannot even do this is
  // not going to publish anything either, and the monitor should say so.
  await recordHeartbeat('worker', { workerId: WORKER_ID, mode: values.once === true ? 'once' : 'loop' })

  const stats = await queueStats()
  log(
    `id=${WORKER_ID} queued=${stats.queued} due=${stats.dueNow} running=${stats.running} failed=${stats.failed}` +
      (stats.nextRunAt !== null ? ` next=${stats.nextRunAt.toISOString()}` : ''),
  )

  if (values.once === true) {
    let processed = 0
    while (await processOne(service, vault)) processed += 1
    await recordHeartbeat('worker', { workerId: WORKER_ID, mode: 'once', processed })
    log(`drained queue, processed ${processed} job(s)`)
    await disconnect()
    return
  }

  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      // Finish the job in flight rather than abandoning a half-done publish.
      log('shutting down after the current job…')
      stopping = true
    })
  }

  log(`polling every ${intervalMs}ms — Ctrl+C to stop`)
  while (!stopping) {
    try {
      let worked = false
      while (!stopping && (await processOne(service, vault))) worked = true
      if (!worked) await reclaimStale()
    } catch (error) {
      // A loop that dies on one bad job stops every future post, so keep going.
      log(`loop error (continuing): ${error instanceof Error ? error.message : String(error)}`)
    }
    // Refresh proof-of-life each pass, not just at startup — a loop that has
    // wedged mid-cycle must not keep looking healthy.
    await recordHeartbeat('worker', { workerId: WORKER_ID, mode: 'loop' }).catch(() => {})
    if (!stopping) await new Promise((r) => setTimeout(r, intervalMs))
  }

  await disconnect()
  log('stopped')
}

main().catch(async (error: unknown) => {
  log(`fatal: ${error instanceof Error ? error.message : String(error)}`)
  await disconnect().catch(() => {})
  process.exit(1)
})
