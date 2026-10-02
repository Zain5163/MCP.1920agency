'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { flattenAccounts, type DiscoveredAccount, type Provider } from '@social-publisher/adapters'
import { db, disconnectAccount, listProviderAuths, reconnectAccount } from '@social-publisher/db'

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
  /** The stored authorisation that reaches it, so connecting uses that one. */
  readonly providerAuthId: string
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

type StoredAuth = Awaited<ReturnType<typeof listProviderAuths>>[number]

/** A stored authorisation and its provider, or an explanation. */
type Resolved =
  | { readonly ok: true; readonly auth: StoredAuth; readonly provider: Provider }
  | { readonly ok: false; readonly error: string }

/**
 * Resolves one stored authorisation and its provider.
 *
 * Provider-aware on purpose. This used to take the first usable authorisation
 * of any provider, which was fine while Meta was the only one: with a Google
 * authorisation stored beside it, asking to connect a YouTube channel would
 * have searched the Facebook login for it. Each account now names the
 * authorisation it came from, and that is the one used.
 */
function resolveAuth(auths: readonly StoredAuth[], providerAuthId: string): Resolved {
  const auth = auths.find((a) => a.id === providerAuthId)
  if (auth === undefined) {
    return { ok: false, error: 'That authorisation is no longer stored. Reload the page and try again.' }
  }
  if (auth.needsReauth) {
    return { ok: false, error: 'This authorisation expired. Run the connect command again to renew it.' }
  }
  const provider = providerFor(auth.provider)
  if (provider === undefined) {
    return { ok: false, error: `No provider is registered for "${auth.provider}".` }
  }
  return { ok: true, auth, provider }
}

/**
 * The provider's refresh function, for the vault.
 *
 * A Google authorisation's stored access token lasts an hour. Without this the
 * vault would find it expired with no way to renew it and mark the whole
 * authorisation dead, so listing channels would stop working an hour after
 * connecting. Undefined for providers that renew nothing, as before.
 */
function refreshFor(provider: Provider) {
  return provider.refreshCredential?.bind(provider)
}

export async function listAvailable(): Promise<{
  accounts: AvailableAccount[]
  error?: string
}> {
  const user = await requireUser()
  const auths = await listProviderAuths(user.tenantId)
  if (auths.length === 0) {
    return {
      accounts: [],
      error: 'No authorisation stored yet. Run the connect command once — after that, accounts can be added here.',
    }
  }
  const usable = auths.filter((a) => !a.needsReauth)
  if (usable.length === 0) {
    return { accounts: [], error: 'The stored authorisation expired. Run the connect command again to renew it.' }
  }

  const existing = await scope(user.tenantId).connections()
  const accounts: AvailableAccount[] = []
  const problems: string[] = []

  // Every authorisation, one after another: one provider being unreachable
  // must not hide the accounts another can reach.
  for (const auth of usable) {
    const resolved = resolveAuth(auths, auth.id)
    if (!resolved.ok) {
      problems.push(resolved.error)
      continue
    }
    try {
      const discovered = await providerAuthVault().withCredential(
        resolved.auth.id,
        user.tenantId,
        async (cred) => await resolved.provider.discover(cred.accessToken),
        refreshFor(resolved.provider),
      )
      if (discovered.length === 0 && resolved.provider.noAccountsHint !== undefined) {
        problems.push(`${resolved.provider.displayName}: ${resolved.provider.noAccountsHint}`)
      }
      for (const account of discovered) {
        const match = existing.find(
          (c) => c.platform === account.platform && c.platformAccountId === account.externalId,
        )
        accounts.push({
          externalId: account.externalId,
          name: account.displayName,
          platform: account.platform,
          connected: match !== undefined && !match.needsReauth,
          linkedNames: (account.linked ?? []).map((l) => l.displayName),
          providerAuthId: resolved.auth.id,
        })
      }
    } catch (error) {
      problems.push(
        `Could not reach ${resolved.provider.displayName}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return { accounts, ...(problems.length > 0 ? { error: problems.join(' ') } : {}) }
}

/** Connects one discovered account, plus anything linked to it. */
export async function connectAccount(
  _prev: unknown,
  formData: FormData,
): Promise<AccountsResult> {
  const user = await requireUser()
  const externalId = String(formData.get('externalId') ?? '')
  if (externalId === '') return { ok: false, message: 'No account selected.' }
  const providerAuthId = String(formData.get('providerAuthId') ?? '')
  if (providerAuthId === '') {
    return { ok: false, message: 'The account list is out of date. Reload the page and try again.' }
  }

  const resolved = resolveAuth(await listProviderAuths(user.tenantId), providerAuthId)
  if (!resolved.ok) return { ok: false, message: resolved.error }

  const authVault = providerAuthVault()
  const vault = tokenVault()

  try {
    /**
     * Discovery and storing happen inside the vault callback, so the
     * authorisation's own credential never leaves it — the account copies need
     * its refresh token, and handing that out of the callback is exactly what
     * the vault exists to prevent.
     */
    const connected = await authVault.withCredential(
      resolved.auth.id,
      user.tenantId,
      async (cred): Promise<string[] | null> => {
        const discovered = await resolved.provider.discover(cred.accessToken)
        const chosen: DiscoveredAccount | undefined = discovered.find((a) => a.externalId === externalId)
        if (chosen === undefined) return null

        const names: string[] = []
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
              scopes: [...resolved.auth.scopes],
            },
            update: {
              displayName: account.displayName,
              needsReauth: false,
              reauthReason: null,
              providerAuthId: resolved.auth.id,
            },
          })

          /**
           * The same rule as the connect command: the refresh token and expiry
           * go only onto an account that publishes with the very token they
           * belong to. A Google channel does, and without them its copy would be
           * dead in an hour. A Meta Page has its own token, which the user's
           * refresh token could never renew, so it gets none, as before.
           */
          const sameToken = account.accessToken === cred.accessToken
          await vault.store(row.id, user.tenantId, {
            accessToken: account.accessToken,
            ...(sameToken && cred.refreshToken !== undefined ? { refreshToken: cred.refreshToken } : {}),
            ...(sameToken && cred.expiresAt !== undefined ? { expiresAt: cred.expiresAt } : {}),
            ...(sameToken && cred.authorisationExpiresAt !== undefined
              ? { authorisationExpiresAt: cred.authorisationExpiresAt }
              : {}),
          })
          names.push(account.displayName)
        }
        return names
      },
      refreshFor(resolved.provider),
    )

    if (connected === null) {
      return { ok: false, message: 'That account is no longer available on this authorisation.' }
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
