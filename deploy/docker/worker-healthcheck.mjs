// Docker healthcheck for the worker container (copied into the image as
// apps/worker/healthcheck.mjs, where it resolves @social-publisher/db).
//
// Healthy when a LOOP worker wrote the "worker" heartbeat recently. The server
// worker runs as a loop and beats after every pass (about every 15 seconds when
// idle). The PC's scheduled task runs `--once` and records mode "once", so its
// beats cannot make a dead server worker look healthy.
//
// A single publish that runs longer than WORKER_HEALTH_MAX_AGE_MIN (a long video
// upload) shows as "unhealthy" until it ends. Docker only reports health; it does
// not restart the container for it, so nothing is interrupted.
//
// Prints no configuration and no database detail: only the age and a verdict.

import { db, disconnect } from '@social-publisher/db'

const maxAgeMinutes = Number(process.env.WORKER_HEALTH_MAX_AGE_MIN ?? '10')

let code = 1
try {
  const row = await db().serviceHeartbeat.findUnique({ where: { name: 'worker' } })
  if (row === null) {
    console.log('unhealthy: no worker heartbeat yet')
  } else {
    const ageMinutes = (Date.now() - row.beatAt.getTime()) / 60_000
    const mode = row.detail !== null && typeof row.detail === 'object' ? row.detail.mode : undefined
    if (mode !== 'loop') {
      console.log(`unhealthy: last heartbeat came from a "${String(mode)}" run, not this loop worker`)
    } else if (ageMinutes > maxAgeMinutes) {
      console.log(`unhealthy: heartbeat ${ageMinutes.toFixed(1)} min old (limit ${maxAgeMinutes})`)
    } else {
      console.log(`healthy: heartbeat ${ageMinutes.toFixed(1)} min old`)
      code = 0
    }
  }
} catch (error) {
  console.log(`unhealthy: database check failed (${error instanceof Error ? error.name : 'error'})`)
} finally {
  await disconnect().catch(() => {})
}
process.exit(code)
