import { checkConfig, mediaHostingReady } from '@social-publisher/config'
import { db, disconnect, health } from '@social-publisher/db'

/**
 * `pnpm status` — is everything wired up?
 *
 * Exists because the failure modes here are all silent ones: a paused Supabase
 * project, a revoked token, a half-filled env file. Each of those otherwise shows
 * up as a confusing error mid-publish rather than as a clear statement of what is
 * wrong.
 */

async function main(): Promise<void> {
  console.log('\n  Social Publisher — status\n')

  const config = checkConfig()
  console.log(`  config      ${config.envFileExists ? config.envPath : 'NOT FOUND — see SETUP.md'}`)
  if (config.missing.length > 0) {
    console.log(`              missing: ${config.missing.join(', ')}`)
  } else {
    console.log('              all required keys present')
  }
  console.log(
    `  media       ${
      mediaHostingReady()
        ? 'storage configured (Supabase)'
        : 'storage not configured — Facebook works without it; Instagram needs it'
    }`,
  )

  if (!config.envFileExists || config.missing.includes('DATABASE_URL')) {
    console.log('\n  database    skipped (no DATABASE_URL)\n')
    return
  }

  const state = await health()
  if (!state.reachable) {
    console.log(`  database    UNREACHABLE — ${state.error ?? 'unknown'}`)
    console.log('              if the Supabase project is paused, resume it in the dashboard\n')
    await disconnect()
    return
  }

  console.log(`  database    reachable (${state.latencyMs}ms)`)
  if (state.lastHeartbeatAt === undefined) {
    console.log('              no keep-alive recorded yet — run `pnpm keepalive`')
  } else {
    const age = state.heartbeatAgeDays ?? 0
    console.log(
      `              last keep-alive ${age}d ago${state.pauseRisk ? '  ⚠ PAUSE RISK (7d limit)' : ''}`,
    )
  }

  const connections = await db().connection.findMany({
    orderBy: { createdAt: 'asc' },
    select: { platform: true, displayName: true, platformAccountId: true, needsReauth: true, reauthReason: true },
  })

  console.log(`\n  accounts    ${connections.length} connected`)
  for (const c of connections) {
    const flag = c.needsReauth ? `  ⚠ NEEDS RECONNECT (${c.reauthReason ?? 'unknown'})` : ''
    console.log(`              ${c.platform.padEnd(14)} ${c.displayName} (${c.platformAccountId})${flag}`)
  }
  if (connections.length === 0) {
    console.log('              run `pnpm connect` to link a Facebook Page')
  }

  console.log('')
  await disconnect()
}

main().catch(async (error: unknown) => {
  console.error(`\n  status failed: ${error instanceof Error ? error.message : String(error)}\n`)
  await disconnect().catch(() => {})
  process.exit(1)
})
