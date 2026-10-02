import { randomUUID } from 'node:crypto'

import { db } from './client.ts'

/**
 * The job queue.
 *
 * Postgres rather than Redis/BullMQ: at this volume a table does the job and it
 * keeps Docker and a second service out of the stack. Everything here is written
 * so that swapping in a real broker later is a contained change.
 *
 * The claim is a single atomic statement using FOR UPDATE SKIP LOCKED, per the
 * supabase-postgres-best-practices guidance. Two workers running side by side take
 * *different* jobs instead of one blocking on the other, and a worker that dies
 * mid-publish does not strand its job forever — see reclaimStale.
 */

export interface ClaimedJob {
  readonly jobId: string
  readonly targetId: string
  readonly tenantId: string
  readonly attempts: number
}

/** Identifies this worker process in locked_by, so stale locks are attributable. */
export const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`

/**
 * Claims one due job, or null when there is nothing to do.
 *
 * Written as raw SQL because Prisma has no way to express FOR UPDATE SKIP LOCKED,
 * and a read-then-write in two statements would let two workers claim the same job.
 */
export async function claimNext(workerId: string = WORKER_ID): Promise<ClaimedJob | null> {
  const rows = await db().$queryRaw<
    Array<{ id: string; target_id: string; tenant_id: string; attempts: number }>
  >`
    UPDATE jobs
       SET state      = 'running',
           locked_at  = now(),
           locked_by  = ${workerId},
           attempts   = attempts + 1,
           updated_at = now()
     WHERE id = (
       SELECT id
         FROM jobs
        WHERE state = 'queued'
          AND run_after <= now()
        ORDER BY run_after
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, target_id, tenant_id, attempts
  `
  const row = rows[0]
  return row === undefined
    ? null
    : { jobId: row.id, targetId: row.target_id, tenantId: row.tenant_id, attempts: row.attempts }
}

/**
 * Returns jobs whose worker died mid-publish to the queue.
 *
 * Without this a crash strands a job in `running` forever and the post silently
 * never goes out — which is exactly the silent failure that makes people abandon
 * self-hosted schedulers.
 */
export async function reclaimStale(olderThanMs = 15 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs)
  const result = await db().job.updateMany({
    where: { state: 'running', lockedAt: { lt: cutoff } },
    data: { state: 'queued', lockedAt: null, lockedBy: null },
  })
  return result.count
}

/**
 * Extends this worker's lock on a job it is still working on.
 *
 * reclaimStale treats a lock older than 15 minutes as a dead worker. A large
 * video upload can take longer than that while being perfectly alive, and
 * reclaiming it then means a second worker starts the same upload — with no
 * idempotency key on the platform side, that is a second copy of the video. So
 * the worker calls this every minute while a job runs, and only a lock that
 * genuinely stopped being touched goes stale.
 *
 * Scoped to this worker's own running lock: if the job was already reclaimed
 * and claimed by someone else, their lock is not ours to extend. Returns
 * whether the lock was still held.
 */
export async function touchJob(jobId: string, workerId: string = WORKER_ID): Promise<boolean> {
  const result = await db().job.updateMany({
    where: { id: jobId, state: 'running', lockedBy: workerId },
    data: { lockedAt: new Date() },
  })
  return result.count > 0
}

export async function completeJob(jobId: string): Promise<void> {
  await db().job.update({
    where: { id: jobId },
    data: { state: 'done', lockedAt: null, lockedBy: null, lastError: null },
  })
}

/** Schedules a retry. The target stays `scheduled` because it has not failed yet. */
export async function retryJob(jobId: string, delayMs: number, error: string): Promise<Date> {
  const runAfter = new Date(Date.now() + delayMs)
  await db().job.update({
    where: { id: jobId },
    data: {
      state: 'queued',
      runAfter,
      lockedAt: null,
      lockedBy: null,
      lastError: error.slice(0, 1000),
    },
  })
  return runAfter
}

export async function failJob(jobId: string, error: string): Promise<void> {
  await db().job.update({
    where: { id: jobId },
    data: { state: 'failed', lockedAt: null, lockedBy: null, lastError: error.slice(0, 1000) },
  })
}

export interface QueueStats {
  readonly queued: number
  readonly running: number
  readonly failed: number
  readonly dueNow: number
  readonly nextRunAt: Date | null
}

export async function queueStats(): Promise<QueueStats> {
  const [queued, running, failed, dueNow, next] = await Promise.all([
    db().job.count({ where: { state: 'queued' } }),
    db().job.count({ where: { state: 'running' } }),
    db().job.count({ where: { state: 'failed' } }),
    db().job.count({ where: { state: 'queued', runAfter: { lte: new Date() } } }),
    db().job.findFirst({
      where: { state: 'queued' },
      orderBy: { runAfter: 'asc' },
      select: { runAfter: true },
    }),
  ])
  return { queued, running, failed, dueNow, nextRunAt: next?.runAfter ?? null }
}

/**
 * How many attempts before a transient failure is treated as permanent.
 *
 * With the jittered backoff in @social-publisher/core this spans several hours,
 * which comfortably outlasts a platform outage or a rate-limit window.
 */
export const MAX_ATTEMPTS = 6
