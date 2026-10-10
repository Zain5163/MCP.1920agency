/**
 * Keep-alive entry point. Registered in Windows Task Scheduler to run weekly,
 * well inside Supabase's 7-day inactivity window. See docs/decisions/0002.
 */
import { disconnect, health, keepalive } from './client.ts'

async function main(): Promise<void> {
  const beatAt = await keepalive()
  const state = await health()
  console.log(
    `[keepalive] ok  beat=${beatAt.toISOString()}  latency=${state.latencyMs ?? '?'}ms`,
  )
  await disconnect()
}

main().catch(async (error: unknown) => {
  // Exit non-zero so Task Scheduler records a failure rather than hiding it.
  console.error('[keepalive] FAILED:', error instanceof Error ? error.message : error)
  await disconnect().catch(() => {})
  process.exit(1)
})
