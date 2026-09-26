import { spawn } from 'node:child_process'

import {
  allProviders,
  createState,
  flattenAccounts,
  providerFor,
  registerLinkedInProvider,
  registerMetaProvider,
  registerPinterestProvider,
  registerThreadsProvider,
  type Provider,
} from '@social-publisher/adapters'
import { optional, required } from '@social-publisher/config'
import {
  db,
  disconnect,
  health,
  providerAuthCredentialStore,
  prismaCredentialStore,
  saveProviderAuth,
} from '@social-publisher/db'
import { TokenVault, parseKey } from '@social-publisher/vault'

import { waitForCallback } from './callback-server.ts'

/**
 * `pnpm connect:provider <name>` — authorise any registered provider.
 *
 * This exists because three platforms ended up with working adapters *and*
 * working providers that nobody could connect. Account discovery went
 * provider-driven early; authorisation never did, so the original connect
 * command could only run Meta's dialog. Adding a fourth adapter would have made
 * that worse rather than better.
 *
 * Nothing here names a platform. Everything specific — the dialog URL, the token
 * exchange, what accounts an authorisation reaches — comes from the Provider, so
 * a new platform needs a provider file and a registration line, and nothing in
 * this file at all.
 *
 * The Meta-only `pnpm connect` is deliberately left in place: it is verified
 * working, and replacing a verified path is a separate decision from adding one.
 */

const TENANT_NAME = '1920 Agency'

/**
 * Bridges the core Platform union to Prisma's generated enum.
 *
 * They are meant to be the same set and are not: core still lists `bluesky`,
 * which was dropped from scope in decisions/0001 but left in place because the
 * validation tests use it as a fixture. Prisma's enum never had it. So a
 * `bluesky` connection would compile and then fail at the database.
 *
 * Nothing can reach that today — there is no Bluesky provider or adapter to
 * discover one — but the mismatch is real and is recorded in PROJECT-LOG rather
 * than hidden behind this cast.
 */
function asPrismaPlatform<T extends string>(value: string): T {
  return value as T
}

/**
 * Registers every provider whose credentials are configured.
 *
 * Missing credentials are not an error. Most installs will configure one or two
 * platforms, and demanding all of them would make connecting the first one
 * impossible.
 */
function registerConfigured(): void {
  const metaId = optional('META_APP_ID')
  const metaSecret = optional('META_APP_SECRET')
  if (metaId !== undefined && metaSecret !== undefined) {
    registerMetaProvider({
      appId: metaId,
      appSecret: metaSecret,
      redirectUri: optional('META_REDIRECT_URI', 'http://localhost:8787/callback')!,
      apiVersion: optional('META_API_VERSION', 'v25.0')!,
    })
  }

  const threadsId = optional('THREADS_APP_ID')
  const threadsSecret = optional('THREADS_APP_SECRET')
  if (threadsId !== undefined && threadsSecret !== undefined) {
    registerThreadsProvider({
      appId: threadsId,
      appSecret: threadsSecret,
      redirectUri: optional('THREADS_REDIRECT_URI', 'http://localhost:8787/threads/callback')!,
    })
  }

  const pinId = optional('PINTEREST_APP_ID')
  const pinSecret = optional('PINTEREST_APP_SECRET')
  if (pinId !== undefined && pinSecret !== undefined) {
    registerPinterestProvider({
      appId: pinId,
      appSecret: pinSecret,
      redirectUri: optional('PINTEREST_REDIRECT_URI', 'http://localhost:8787/pinterest/callback')!,
    })
  }

  const liId = optional('LINKEDIN_APP_ID')
  const liSecret = optional('LINKEDIN_APP_SECRET')
  if (liId !== undefined && liSecret !== undefined) {
    registerLinkedInProvider({
      appId: liId,
      appSecret: liSecret,
      redirectUri: optional('LINKEDIN_REDIRECT_URI', 'http://localhost:8787/linkedin/callback')!,
      apiVersion: optional('LINKEDIN_API_VERSION', '202601')!,
      // Only true once the platform has actually granted organisation access.
      // Asking without it makes the dialog refuse outright.
      organizationAccess: optional('LINKEDIN_ORGANIZATION_ACCESS') === 'true',
    })
  }
}

/**
 * The scopes this authorisation asked for, read back out of the dialog URL.
 *
 * The Provider contract does not expose a scope list, and the URL is where they
 * are already declared — so reading them from there records what was actually
 * requested rather than a second copy that can drift out of step. Providers
 * separate them with either spaces or commas.
 */
function requestedScopes(provider: Provider): string[] {
  try {
    const scope = new URL(provider.authUrl('probe')).searchParams.get('scope')
    return scope === null ? [] : scope.split(/[\s,]+/).filter((s) => s !== '')
  } catch {
    return []
  }
}

function usage(requested: string | undefined): never {
  const available = allProviders()

  if (requested !== undefined) {
    console.error(`\n  No provider named "${requested}" is configured.\n`)
  } else {
    console.error('\n  Which provider should be connected?\n')
  }

  if (available.length === 0) {
    console.error('  None are configured. Each needs an app id and secret in the config file')
    console.error('  at ~/.social-publisher/.env — see .env.example for the key names.\n')
    process.exit(1)
  }

  console.error('  Configured and ready:\n')
  for (const provider of available) {
    console.error(`    ${provider.key.padEnd(10)} ${provider.displayName}`)
  }
  console.error(`\n  Run:  pnpm connect:provider ${available[0]!.key}\n`)
  process.exit(1)
}

async function main(): Promise<void> {
  registerConfigured()

  const requested = process.argv[2]
  if (requested === undefined) usage(undefined)

  const provider = providerFor(requested)
  if (provider === undefined) usage(requested)

  const state = await health()
  if (!state.reachable) {
    console.error(`\n  Cannot reach the database: ${state.error ?? 'unknown error'}`)
    console.error('  If the Supabase project is paused, resume it from the dashboard.\n')
    process.exit(1)
  }

  const csrfState = createState()
  const authUrl = provider.authUrl(csrfState)
  const redirect = new URL(provider.redirectUri)

  // Start listening BEFORE opening the browser. A fast authorisation against a
  // server that is not yet up fails with nothing to retry.
  const listener = waitForCallback({
    port: Number(redirect.port === '' ? 80 : redirect.port),
    path: redirect.pathname,
    expectedState: csrfState,
  })

  console.log(`\n  Opening ${provider.displayName} in your browser…`)
  console.log(`  If nothing opens, paste this in yourself:\n\n  ${authUrl}\n`)
  openBrowser(authUrl)

  const { code } = await listener.promise
  console.log('  Authorised. Exchanging tokens…')

  const credential = await provider.exchangeCode(code)

  console.log('  Looking up which accounts this reaches…')
  const discovered = await provider.discover(credential.accessToken)
  const accounts = flattenAccounts(discovered)

  if (accounts.length === 0) {
    // Not a crash, and worth distinguishing from a failure: the authorisation
    // worked, it just does not reach anything postable.
    console.error(`\n  ${provider.displayName} authorised, but it reaches no postable accounts.`)
    console.error('  Check that this login administers the page or account you expected.')
    console.error('  Nothing was stored.\n')
    await disconnect()
    process.exit(1)
  }

  const tenant = await ensureTenant()
  const scopes = requestedScopes(provider)
  const kek = parseKey(required('VAULT_MASTER_KEY'), 'VAULT_MASTER_KEY')

  /**
   * Store the authorisation itself, not only the per-account credentials.
   *
   * This is what lets further accounts be connected later from the dashboard
   * without sending anyone back through the dialog.
   */
  const auth = await saveProviderAuth({
    tenantId: tenant.id,
    provider: provider.key,
    externalUserId: discovered[0]!.externalId,
    displayName: provider.displayName,
    secretCiphertext: '',
    keyVersion: 1,
    scopes,
    ...(credential.expiresAt !== undefined ? { expiresAt: credential.expiresAt } : {}),
  })

  // Provider authorisations live in their own table, so they need their own
  // store. Using the connection store here silently saved nothing.
  const authVault = new TokenVault({ kek, keyVersion: 1, store: providerAuthCredentialStore() })
  await authVault.store(auth.id, tenant.id, {
    accessToken: credential.accessToken,
    ...(credential.refreshToken !== undefined ? { refreshToken: credential.refreshToken } : {}),
    ...(credential.expiresAt !== undefined ? { expiresAt: credential.expiresAt } : {}),
  })

  const vault = new TokenVault({ kek, keyVersion: 1, store: prismaCredentialStore() })

  console.log('')
  for (const account of accounts) {
    const connection = await db().connection.upsert({
      where: {
        tenantId_platform_platformAccountId: {
          tenantId: tenant.id,
          platform: asPrismaPlatform(account.platform),
          platformAccountId: account.externalId,
        },
      },
      create: {
        tenantId: tenant.id,
        platform: asPrismaPlatform(account.platform),
        platformAccountId: account.externalId,
        displayName: account.displayName,
        // Placeholder, replaced immediately below: the vault owns encryption.
        secretCiphertext: '',
        providerAuthId: auth.id,
        scopes,
        needsReauth: false,
      },
      update: {
        displayName: account.displayName,
        providerAuthId: auth.id,
        scopes,
        needsReauth: false,
        reauthReason: null,
      },
    })

    await vault.store(connection.id, tenant.id, {
      accessToken: account.accessToken,
      ...(credential.expiresAt !== undefined ? { expiresAt: credential.expiresAt } : {}),
    })
    console.log(`    connected  ${account.platform.padEnd(14)} ${account.displayName}`)
  }

  await db().auditLog.create({
    data: {
      tenantId: tenant.id,
      actor: 'cli:connect-provider',
      action: 'provider.connected',
      detail: { provider: provider.key, accountCount: accounts.length, scopes },
    },
  })

  console.log(`\n  Done. ${accounts.length} account(s) connected via ${provider.displayName}.`)
  if (credential.expiresAt !== undefined) {
    // Some platforms issue credentials that simply die, and a silent expiry
    // weeks later is indistinguishable from a broken integration.
    console.log(`  This authorisation expires ${credential.expiresAt.toISOString().slice(0, 10)}.`)
  }
  console.log('')
  await disconnect()
}

async function ensureTenant() {
  const existing = await db().tenant.findFirst({ orderBy: { createdAt: 'asc' } })
  return existing ?? (await db().tenant.create({ data: { name: TENANT_NAME } }))
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      // cmd.exe treats & as a command separator, so an unquoted OAuth URL is cut
      // at the first parameter and the platform reports a missing redirect URI.
      // rundll32 receives the URL as one argv entry with no shell parsing.
      spawn('rundll32', ['url.dll,FileProtocolHandler', url], {
        detached: true,
        stdio: 'ignore',
      }).unref()
      return
    }
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    // Non-fatal: the URL is printed above for manual use.
  }
}

main().catch(async (error: unknown) => {
  console.error(`\n  Connect failed: ${error instanceof Error ? error.message : String(error)}\n`)
  await disconnect().catch(() => {})
  process.exit(1)
})
