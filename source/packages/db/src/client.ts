import { PrismaClient } from '@prisma/client'
import { required } from '@social-publisher/config'

/**
 * Prisma client.
 *
 * Kept as a module-level singleton because a new PrismaClient opens its own
 * connection pool, and Supabase's free tier has a small connection ceiling —
 * creating clients per call exhausts it quickly.
 */

let client: PrismaClient | undefined

export function db(): PrismaClient {
  if (client === undefined) {
    client = new PrismaClient({
      datasources: { db: { url: required('DATABASE_URL') } },
      // Never log query parameters: they can contain credential ciphertext.
      log: ['warn', 'error'],
    })
  }
  return client
}

export async function disconnect(): Promise<void> {
  await client?.$disconnect()
  client = undefined
}

export interface DbHealth {
  readonly reachable: boolean
  readonly latencyMs?: number
  readonly lastHeartbeatAt?: Date
  readonly heartbeatAgeDays?: number
  /** True when the project is close to Supabase's 7-day inactivity pause. */
  readonly pauseRisk: boolean
  readonly error?: string
}

/**
 * Checks the database is reachable and reports how stale the keep-alive is.
 *
 * Supabase pauses free projects after 7 days of low activity, so a stale heartbeat
 * is an early warning, not trivia. The owner's objection to a keep-alive was that
 * it is "one more thing that can silently break" — this is what stops it being
 * silent. See docs/decisions/0002.
 */
export async function health(): Promise<DbHealth> {
  const started = Date.now()
  try {
    await db().$queryRaw`SELECT 1`
    const latencyMs = Date.now() - started

    const beat = await db().heartbeat.findUnique({ where: { id: 1 } })
    if (beat === null) {
      return { reachable: true, latencyMs, pauseRisk: false }
    }

    const ageDays = (Date.now() - beat.beatAt.getTime()) / 86_400_000
    return {
      reachable: true,
      latencyMs,
      lastHeartbeatAt: beat.beatAt,
      heartbeatAgeDays: Number(ageDays.toFixed(2)),
      pauseRisk: ageDays >= 5,
    }
  } catch (error) {
    return {
      reachable: false,
      pauseRisk: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Writes the keep-alive row. Run weekly from Windows Task Scheduler, the same
 * mechanism as the existing SEO-Ops 09:00 task.
 */
export async function keepalive(source = 'keepalive'): Promise<Date> {
  const beatAt = new Date()
  await db().heartbeat.upsert({
    where: { id: 1 },
    create: { id: 1, beatAt, source },
    update: { beatAt, source },
  })
  return beatAt
}
