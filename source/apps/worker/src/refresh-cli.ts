import {
  registerMetaProvider,
  registerThreadsProvider,
  providerFor,
} from '@social-publisher/adapters'
import { optional, required } from '@social-publisher/config'
import {
  disconnect,
  expiredProviderAuths,
  expiringProviderAuths,
  markAuthExpired,
  providerAuthCredentialStore,
  recordHeartbeat,
  recordRefreshed,
} from '@social-publisher/db'
import { createLogger } from '@social-publisher/telemetry'
import { TokenVault, parseKey } from '@social-publisher/vault'

/**
 * `refresh` — keeps expiring authorisations alive.
 *
 * Some platforms issue tokens that die on their own. A Threads token lasts 60
 * days and can only be refreshed inside a window; miss it and the customer must
 * reauthorise from scratch. Nothing about that failure is loud — posts simply
 * start failing weeks later with a credential error.
 *
 * So this runs on a schedule, well ahead of expiry, and refreshes anything whose
 * provider supports it. Providers with no `refresh` are declaring their
 * credentials do not expire, which is nothing to do rather than a problem.
 *
 * Exit codes: 0 nothing needed or all refreshed, 1 something needs a human.
 */

const logger = createLogger({
  slackWebhookUrl: optional('SLACK_WEBHOOK_URL'),
  console: false,
  base: { event: 'refresh' },
})

function registerProviders(): void {
  registerMetaProvider({
    appId: required('META_APP_ID'),
    appSecret: required('META_APP_SECRET'),
    redirectUri: optional('META_REDIRECT_URI', 'http://localhost:8787/callback')!,
    apiVersion: optional('META_API_VERSION', 'v25.0')!,
  })

  // Threads is optional: without its own credentials there is nothing to refresh,
  // and demanding them would break refresh for everyone not using Threads.
  const threadsId = optional('THREADS_APP_ID')
  const threadsSecret = optional('THREADS_APP_SECRET')
  if (threadsId !== undefined && threadsSecret !== undefined) {
    registerThreadsProvider({
      appId: threadsId,
      appSecret: threadsSecret,
      redirectUri: optional('THREADS_REDIRECT_URI', 'http://localhost:8787/threads/callback')!,
    })
  }
}

async function main(): Promise<void> {
  registerProviders()

  const vault = new TokenVault({
    kek: parseKey(required('VAULT_MASTER_KEY'), 'VAULT_MASTER_KEY'),
    keyVersion: 1,
    store: providerAuthCredentialStore(),
  })

  console.log(`\n  Credential refresh — ${new Date().toISOString()}\n`)

  // Already dead: refresh cannot help, so say so plainly and mark them.
  const expired = await expiredProviderAuths()
  for (const auth of expired) {
    if (!auth.needsReauth) {
      await markAuthExpired(auth.id, 'the authorisation expired before it could be refreshed')
      await logger.error('refresh.expired', `${auth.provider} authorisation has expired`, {
        tenantId: auth.tenantId,
        data: { provider: auth.provider, expiredDaysAgo: Math.abs(auth.daysLeft) },
      })
    }
    console.log(`  EXPIRED   ${auth.provider.padEnd(10)} ${Math.abs(auth.daysLeft)}d ago — needs reauthorisation`)
  }

  const expiring = await expiringProviderAuths(14)
  if (expiring.length === 0 && expired.length === 0) {
    console.log('  Nothing expiring in the next 14 days.\n')
    await recordHeartbeat('refresh', { refreshed: 0, failed: 0 })
    await disconnect()
    return
  }

  let refreshed = 0
  let failed = 0
  let skipped = 0

  for (const auth of expiring) {
    const provider = providerFor(auth.provider)

    if (provider === undefined) {
      console.log(`  SKIP      ${auth.provider.padEnd(10)} no provider registered`)
      skipped += 1
      continue
    }
    if (provider.refresh === undefined) {
      // Not a failure: this provider's credentials do not expire on their own.
      console.log(`  SKIP      ${auth.provider.padEnd(10)} does not support refresh`)
      skipped += 1
      continue
    }

    try {
      const next = await vault.withCredential(
        auth.id,
        auth.tenantId,
        async (cred) => await provider.refresh!(cred.accessToken),
      )

      // Store the new token first, then the new expiry — if the process dies
      // between them, a stale expiry is recoverable but a lost token is not.
      await vault.store(auth.id, auth.tenantId, {
        accessToken: next.accessToken,
        expiresAt: next.expiresAt,
      })
      await recordRefreshed(auth.id, next.expiresAt)

      refreshed += 1
      console.log(
        `  REFRESHED ${auth.provider.padEnd(10)} now valid until ${next.expiresAt.toISOString().slice(0, 10)}`,
      )
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      console.log(`  FAILED    ${auth.provider.padEnd(10)} ${auth.daysLeft}d left — ${message}`)

      // Deliberately NOT marked needs_reauth yet: there are days left and the
      // next run may succeed. Marking it now would disable working accounts over
      // one transient network error.
      await logger.warn('refresh.failed', `Could not refresh ${auth.provider}: ${message}`, {
        tenantId: auth.tenantId,
        data: { provider: auth.provider, daysLeft: auth.daysLeft },
      })
    }
  }

  console.log(`\n  ${refreshed} refreshed, ${failed} failed, ${skipped} skipped.\n`)
  await recordHeartbeat('refresh', { refreshed, failed, skipped })
  await disconnect()

  if (failed > 0 || expired.length > 0) process.exit(1)
}

main().catch(async (error: unknown) => {
  console.error(`\n  REFRESH FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
  await logger
    .error('refresh.crashed', 'The refresh runner could not complete', { data: { error } })
    .catch(() => {})
  await disconnect().catch(() => {})
  process.exit(1)
})
