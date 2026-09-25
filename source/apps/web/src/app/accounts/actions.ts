'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { FacebookOAuth } from '@social-publisher/adapters'
import { optional, required } from '@social-publisher/config'
import {
  db,
  disconnectAccount,
  findProviderAuth,
  listProviderAuths,
  reconnectAccount,
} from '@social-publisher/db'
import { TokenVault, parseKey } from '@social-publisher/vault'

import { currentUser } from '@/lib/auth'
import { scope, tokenVault } from '@/lib/engine'

export interface AccountsResult {
  readonly ok: boolean
  readonly message: string
  readonly details?: readonly string[]
}

export interface AvailableAccount {
  readonly platformAccountId: string
  readonly name: string
  readonly platform: string
  readonly connected: boolean
  readonly needsReauth: boolean
  readonly connectionId: string | null
  readonly hasInstagram: boolean
}

async function requireUser() {
  const user = await currentUser()
  if (user === null) redirect('/login')
  return user
}

/**
 * Lists every Page the stored authorisation can reach, marking which are already
 * connected.
 *
 * Uses the saved long-lived user token rather than sending anyone back through
 * OAuth — that is the whole point of storing it.
 */
export async function listAvailable(): Promise<{
  accounts: AvailableAccount[]
  error?: string
}> {
  const user = await requireUser()
  const auths = await listProviderAuths(user.tenantId)
  const meta = auths.find((a) => a.provider === 'meta')

  if (meta === undefined) {
    return {
      accounts: [],
      error: 'No Meta authorisation stored yet. Run the connect command once to authorise.',
    }
  }
  if (meta.needsReauth) {
    return { accounts: [], error: 'The Meta authorisation expired. Run the connect command again.' }
  }

  const auth = await findProviderAuth(user.tenantId, meta.id)
  if (auth === null) return { accounts: [], error: 'Authorisation not found.' }

  const existing = await scope(user.tenantId).connections()

  try {
    const pages = await tokenVault().withCredential(
      // The provider auth's credential lives under its own id in the vault.
      auth.id,
      user.tenantId,
      async (cred) => {
        const oauth = new FacebookOAuth({
          appId: required('META_APP_ID'),
          appSecret: required('META_APP_SECRET'),
          redirectUri: optional('META_REDIRECT_URI', 'http://localhost:8787/callback')!,
          apiVersion: optional('META_API_VERSION', 'v25.0')!,
        })
        return await oauth.listPages(cred.accessToken)
      },
    )

    const accounts: AvailableAccount[] = []
    for (const page of pages) {
      const match = existing.find(
        (c) => c.platform === 'facebook_page' && c.platformAccountId === page.id,
      )
      accounts.push({
        platformAccountId: page.id,
        name: page.name,
        platform: 'facebook_page',
        connected: match !== undefined && !match.needsReauth,
        needsReauth: match?.needsReauth ?? false,
        connectionId: match?.id ?? null,
        hasInstagram: page.instagramAccountId !== undefined,
      })
    }
    return { accounts }
  } catch (error) {
    return {
      accounts: [],
      error: `Could not reach Meta: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** Connects one Page (and its Instagram account, if it has one). */
export async function connectAccount(
  _prev: unknown,
  formData: FormData,
): Promise<AccountsResult> {
  const user = await requireUser()
  const pageId = String(formData.get('pageId') ?? '')
  if (pageId === '') return { ok: false, message: 'No account selected.' }

  const auths = await listProviderAuths(user.tenantId)
  const meta = auths.find((a) => a.provider === 'meta')
  if (meta === undefined) return { ok: false, message: 'No Meta authorisation stored.' }

  const auth = await findProviderAuth(user.tenantId, meta.id)
  if (auth === null) return { ok: false, message: 'Authorisation not found.' }

  const vault = tokenVault()

  try {
    const page = await vault.withCredential(auth.id, user.tenantId, async (cred) => {
      const oauth = new FacebookOAuth({
        appId: required('META_APP_ID'),
        appSecret: required('META_APP_SECRET'),
        redirectUri: optional('META_REDIRECT_URI', 'http://localhost:8787/callback')!,
        apiVersion: optional('META_API_VERSION', 'v25.0')!,
      })
      const pages = await oauth.listPages(cred.accessToken)
      return pages.find((p) => p.id === pageId) ?? null
    })

    if (page === null) {
      return { ok: false, message: 'That account is no longer available on this authorisation.' }
    }

    const connected: string[] = []

    const fb = await db().connection.upsert({
      where: {
        tenantId_platform_platformAccountId: {
          tenantId: user.tenantId,
          platform: 'facebook_page',
          platformAccountId: page.id,
        },
      },
      create: {
        tenantId: user.tenantId,
        platform: 'facebook_page',
        platformAccountId: page.id,
        displayName: page.name,
        secretCiphertext: '',
        providerAuthId: meta.id,
        scopes: meta.scopes as string[],
      },
      update: { displayName: page.name, needsReauth: false, reauthReason: null, providerAuthId: meta.id },
    })
    await vault.store(fb.id, user.tenantId, { accessToken: page.accessToken })
    connected.push(page.name)

    // Instagram publishes with the PAGE token, so it needs no separate approval.
    if (page.instagramAccountId !== undefined) {
      const ig = await db().connection.upsert({
        where: {
          tenantId_platform_platformAccountId: {
            tenantId: user.tenantId,
            platform: 'instagram',
            platformAccountId: page.instagramAccountId,
          },
        },
        create: {
          tenantId: user.tenantId,
          platform: 'instagram',
          platformAccountId: page.instagramAccountId,
          displayName: `${page.name} (Instagram)`,
          secretCiphertext: '',
          providerAuthId: meta.id,
          scopes: meta.scopes as string[],
        },
        update: {
          displayName: `${page.name} (Instagram)`,
          needsReauth: false,
          reauthReason: null,
          providerAuthId: meta.id,
        },
      })
      await vault.store(ig.id, user.tenantId, { accessToken: page.accessToken })
      connected.push(`${page.name} (Instagram)`)
    }

    await scope(user.tenantId).record(`user:${user.email}`, 'account.connected', {
      pageId: page.id,
      connected,
    })

    revalidatePath('/accounts')
    revalidatePath('/')
    return { ok: true, message: `Connected ${connected.length} account(s).`, details: connected }
  } catch (error) {
    return {
      ok: false,
      message: `Could not connect: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export async function disconnect(formData: FormData): Promise<void> {
  const user = await requireUser()
  const connectionId = String(formData.get('connectionId') ?? '')
  if (connectionId === '') return

  if (await disconnectAccount(user.tenantId, connectionId)) {
    await scope(user.tenantId).record(`user:${user.email}`, 'account.disconnected', { connectionId })
  }
  revalidatePath('/accounts')
  revalidatePath('/')
}

export async function reconnect(formData: FormData): Promise<void> {
  const user = await requireUser()
  const connectionId = String(formData.get('connectionId') ?? '')
  if (connectionId === '') return

  if (await reconnectAccount(user.tenantId, connectionId)) {
    await scope(user.tenantId).record(`user:${user.email}`, 'account.reconnected', { connectionId })
  }
  revalidatePath('/accounts')
  revalidatePath('/')
}
