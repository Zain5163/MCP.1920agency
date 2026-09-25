'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { flattenAccounts, type DiscoveredAccount } from '@social-publisher/adapters'
import {
  db,
  disconnectAccount,
  findProviderAuth,
  listProviderAuths,
  reconnectAccount,
} from '@social-publisher/db'

import { currentUser } from '@/lib/auth'
import { providerAuthVault, providerFor, scope, tokenVault } from '@/lib/engine'

/**
 * Account management.
 *
 * Deliberately contains **no platform names**. Discovery goes through a Provider,
 * so adding LinkedIn or TikTok means writing a provider, not editing this file.
 * The architecture test in packages/core enforces that — it caught an earlier
 * version of this file hardcoding Facebook and Instagram.
 */

export interface AccountsResult {
  readonly ok: boolean
  readonly message: string
  readonly details?: readonly string[]
}

export interface AvailableAccount {
  readonly externalId: string
  readonly name: string
  readonly platform: string
  readonly connected: boolean
  readonly linkedNames: readonly string[]
}

/**
 * The provider's Platform and Prisma's generated enum are the same string union,
 * but TypeScript treats them as distinct declarations across package boundaries.
 * One narrow cast here beats loosening either type.
 */
function asPlatform<T extends string>(value: string): T {
  return value as T
}

async function requireUser() {
  const user = await currentUser()
  if (user === null) redirect('/login')
  return user
}

/** Resolves the stored authorisation and its provider, or an explanation. */
type Resolved =
  | { readonly ok: true; readonly auth: Awaited<ReturnType<typeof listProviderAuths>>[number]; readonly provider: NonNullable<ReturnType<typeof providerFor>> }
  | { readonly ok: false; readonly error: string }

async function resolveAuth(tenantId: string): Promise<Resolved> {
  const auths = await listProviderAuths(tenantId)
  const usable = auths.find((a) => !a.needsReauth)

  if (usable === undefined) {
    return {
      ok: false,
      error:
        auths.length > 0
          ? 'The stored authorisation expired. Run the connect command again to renew it.'
          : 'No authorisation stored yet. Run the connect command once — after that, accounts can be added here.',
    }
  }

  const provider = providerFor(usable.provider)
  if (provider === undefined) {
    return { ok: false, error: `No provider is registered for "${usable.provider}".` }
  }

  const auth = await findProviderAuth(tenantId, usable.id)
  if (auth === null) return { ok: false, error: 'Authorisation not found.' }

  return { ok: true, auth: usable, provider }
}

export async function listAvailable(): Promise<{
  accounts: AvailableAccount[]
  error?: string
}> {
  const user = await requireUser()
  const resolved = await resolveAuth(user.tenantId)
  if (!resolved.ok) return { accounts: [], error: resolved.error }

  const existing = await scope(user.tenantId).connections()

  try {
    const discovered = await providerAuthVault().withCredential(
      resolved.auth.id,
      user.tenantId,
      async (cred) => await resolved.provider.discover(cred.accessToken),
    )

    return {
      accounts: discovered.map((account) => {
        const match = existing.find(
          (c) => c.platform === account.platform && c.platformAccountId === account.externalId,
        )
        return {
          externalId: account.externalId,
          name: account.displayName,
          platform: account.platform,
          connected: match !== undefined && !match.needsReauth,
          linkedNames: (account.linked ?? []).map((l) => l.displayName),
        }
      }),
    }
  } catch (error) {
    return {
      accounts: [],
      error: `Could not reach the provider: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** Connects one discovered account, plus anything linked to it. */
export async function connectAccount(
  _prev: unknown,
  formData: FormData,
): Promise<AccountsResult> {
  const user = await requireUser()
  const externalId = String(formData.get('externalId') ?? '')
  if (externalId === '') return { ok: false, message: 'No account selected.' }

  const resolved = await resolveAuth(user.tenantId)
  if (!resolved.ok) return { ok: false, message: resolved.error }

  const authVault = providerAuthVault()
  const vault = tokenVault()

  try {
    const chosen = await authVault.withCredential(
      resolved.auth.id,
      user.tenantId,
      async (cred): Promise<DiscoveredAccount | null> => {
        const discovered = await resolved.provider.discover(cred.accessToken)
        return discovered.find((a) => a.externalId === externalId) ?? null
      },
    )

    if (chosen === null) {
      return { ok: false, message: 'That account is no longer available on this authorisation.' }
    }

    const connected: string[] = []

    // The account and anything linked to it are stored together, because they
    // share one credential and connecting them separately would be misleading.
    for (const account of flattenAccounts([chosen])) {
      const row = await db().connection.upsert({
        where: {
          tenantId_platform_platformAccountId: {
            tenantId: user.tenantId,
            platform: asPlatform(account.platform),
            platformAccountId: account.externalId,
          },
        },
        create: {
          tenantId: user.tenantId,
          platform: asPlatform(account.platform),
          platformAccountId: account.externalId,
          displayName: account.displayName,
          secretCiphertext: '',
          providerAuthId: resolved.auth.id,
          scopes: resolved.auth.scopes as string[],
        },
        update: {
          displayName: account.displayName,
          needsReauth: false,
          reauthReason: null,
          providerAuthId: resolved.auth.id,
        },
      })
      await vault.store(row.id, user.tenantId, { accessToken: account.accessToken })
      connected.push(account.displayName)
    }

    await scope(user.tenantId).record(`user:${user.email}`, 'account.connected', {
      externalId,
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
