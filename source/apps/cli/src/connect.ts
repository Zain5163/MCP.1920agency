import { spawn } from 'node:child_process'

import { FacebookOAuth, buildAuthUrl, createState } from '@social-publisher/adapters'
import { checkConfig, optional, required } from '@social-publisher/config'
import { db, disconnect, health, saveProviderAuth } from '@social-publisher/db'
import { TokenVault, parseKey } from '@social-publisher/vault'

import { waitForCallback } from './callback-server.ts'

/**
 * `pnpm connect` — the one-time Facebook authorisation.
 *
 * Opens the Meta dialog in a browser, catches the redirect on localhost, exchanges
 * the code for a long-lived token, and stores one encrypted connection per Page.
 */

const TENANT_NAME = '1920 Agency'

async function main(): Promise<void> {
  // Fail on configuration before opening a browser or touching the network — an
  // error after the user has already approved the dialog is a wasted round trip.
  const config = checkConfig()
  if (!config.ok) {
    console.error(`\n  Configuration incomplete: ${config.envPath}\n`)
    for (const key of config.missing) console.error(`    missing  ${key}`)
    console.error('\n  See SETUP.md. Nothing was changed.\n')
    process.exit(1)
  }

  const state = await health()
  if (!state.reachable) {
    console.error(`\n  Cannot reach the database: ${state.error ?? 'unknown error'}`)
    console.error('  If the Supabase project is paused, resume it from the dashboard.\n')
    process.exit(1)
  }

  const oauthConfig = {
    appId: required('META_APP_ID'),
    appSecret: required('META_APP_SECRET'),
    redirectUri: optional('META_REDIRECT_URI', 'http://localhost:8787/callback')!,
    apiVersion: optional('META_API_VERSION', 'v25.0')!,
  }

  const redirect = new URL(oauthConfig.redirectUri)
  const csrfState = createState()
  const authUrl = buildAuthUrl(oauthConfig, csrfState)

  const listener = waitForCallback({
    port: Number(redirect.port === '' ? 80 : redirect.port),
    path: redirect.pathname,
    expectedState: csrfState,
  })

  console.log('\n  Opening Facebook in your browser…')
  console.log(`  If nothing opens, paste this in yourself:\n\n  ${authUrl}\n`)
  openBrowser(authUrl)

  const { code } = await listener.promise
  console.log('  Authorised. Exchanging tokens…')

  const oauth = new FacebookOAuth(oauthConfig)
  const shortLived = await oauth.exchangeCode(code)

  // Long-lived FIRST: page tokens inherit the lifetime of the user token they are
  // derived from, so fetching pages with the short-lived token yields page tokens
  // that die within the hour.
  const longLived = await oauth.exchangeForLongLived(shortLived.accessToken)

  const info = await oauth.debugToken(longLived.accessToken)
  const missingScopes = ['pages_manage_posts', 'pages_show_list'].filter(
    (s) => !info.scopes.includes(s),
  )
  if (missingScopes.length > 0) {
    console.error(`\n  Missing required permissions: ${missingScopes.join(', ')}`)
    console.error('  Re-run connect and approve every permission. Nothing was stored.\n')
    await disconnect()
    process.exit(1)
  }

  const pages = await oauth.listPages(longLived.accessToken)
  if (pages.length === 0) {
    console.error('\n  You do not administer any Facebook Pages with this account.\n')
    await disconnect()
    process.exit(1)
  }

  const tenant = await ensureTenant()
  const vault = new TokenVault({
    kek: parseKey(required('VAULT_MASTER_KEY'), 'VAULT_MASTER_KEY'),
    keyVersion: 1,
    store: prismaCredentialStore(),
  })

  /**
   * Store the long-lived USER token, not just the page tokens.
   *
   * This is what lets the dashboard list and connect further Pages later without
   * sending anyone back through OAuth. Without it, connecting a second Page means
   * repeating this whole flow.
   */
  const providerAuth = await saveProviderAuth({
    tenantId: tenant.id,
    provider: 'meta',
    externalUserId: info.userId ?? 'unknown',
    secretCiphertext: '',
    keyVersion: 1,
    scopes: info.scopes,
    ...(longLived.expiresAt !== undefined ? { expiresAt: longLived.expiresAt } : {}),
  })
  await vault.store(providerAuth.id, tenant.id, {
    accessToken: longLived.accessToken,
    ...(longLived.expiresAt !== undefined ? { expiresAt: longLived.expiresAt } : {}),
  })
  console.log(`
    authorisation saved — further Pages can be connected from the dashboard`)

  console.log('')
  for (const page of pages) {
    const connection = await db().connection.upsert({
      where: {
        tenantId_platform_platformAccountId: {
          tenantId: tenant.id,
          platform: 'facebook_page',
          platformAccountId: page.id,
        },
      },
      create: {
        tenantId: tenant.id,
        platform: 'facebook_page',
        platformAccountId: page.id,
        displayName: page.name,
        // Placeholder: replaced immediately below by the vault, which owns encryption.
        secretCiphertext: '',
        providerAuthId: providerAuth.id,
        scopes: info.scopes,
        needsReauth: false,
      },
      update: {
        displayName: page.name,
        providerAuthId: providerAuth.id,
        scopes: info.scopes,
        needsReauth: false,
        reauthReason: null,
      },
    })

    await vault.store(connection.id, tenant.id, { accessToken: page.accessToken })
    console.log(`    connected  ${page.name}  (${page.id})`)

    /**
     * Instagram is published using the PAGE token, not a separate Instagram one.
     * The IG Business account hangs off the Page, so the same credential drives
     * both — which is why this stores a second connection rather than sending the
     * user through another authorisation.
     */
    if (page.instagramAccountId !== undefined) {
      const ig = await db().connection.upsert({
        where: {
          tenantId_platform_platformAccountId: {
            tenantId: tenant.id,
            platform: 'instagram',
            platformAccountId: page.instagramAccountId,
          },
        },
        create: {
          tenantId: tenant.id,
          platform: 'instagram',
          platformAccountId: page.instagramAccountId,
          displayName: `${page.name} (Instagram)`,
          secretCiphertext: '',
          scopes: info.scopes,
          needsReauth: false,
        },
        update: {
          displayName: `${page.name} (Instagram)`,
          scopes: info.scopes,
          needsReauth: false,
          reauthReason: null,
        },
      })
      await vault.store(ig.id, tenant.id, { accessToken: page.accessToken })
      console.log(`    connected  ${page.name} (Instagram)  (${page.instagramAccountId})`)
    }
  }

  await db().auditLog.create({
    data: {
      tenantId: tenant.id,
      actor: 'cli:connect',
      action: 'facebook.connected',
      detail: { pageCount: pages.length, scopes: info.scopes },
    },
  })

  console.log(`\n  Done. ${pages.length} page(s) connected.\n`)
  await disconnect()
}

async function ensureTenant() {
  const existing = await db().tenant.findFirst({ orderBy: { createdAt: 'asc' } })
  return existing ?? (await db().tenant.create({ data: { name: TENANT_NAME } }))
}

/** Adapts Prisma to the vault's storage interface. */
function prismaCredentialStore() {
  return {
    async load(connectionId: string, tenantId: string) {
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
    async save(record: {
      connectionId: string
      tenantId: string
      secretCiphertext: string
      keyVersion: number
      expiresAt: Date | null
    }) {
      await db().connection.update({
        where: { id: record.connectionId },
        data: {
          secretCiphertext: record.secretCiphertext,
          keyVersion: record.keyVersion,
          expiresAt: record.expiresAt,
        },
      })
    },
    async markNeedsReauth(connectionId: string, tenantId: string, reason: string) {
      await db().connection.updateMany({
        where: { id: connectionId, tenantId },
        data: { needsReauth: true, reauthReason: reason },
      })
    },
  }
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      // cmd.exe treats & as a command separator, so an unquoted OAuth URL is cut
      // at the first parameter — Facebook then reports "No redirect URI in the
      // params". rundll32 receives the URL as a single argv entry with no shell
      // parsing at all, which sidesteps the quoting problem entirely.
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
