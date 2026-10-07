import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CONFIG_DIR } from '@social-publisher/config'

/**
 * The ad accounts this server may run ads on, beyond the default one.
 *
 * The owner manages client accounts (Muzaree, GradCollective and others) with
 * the same system-user token, and switching the one account in `.env` before
 * each piece of work was a manual step nobody should have to repeat
 * (owner, 2026-10-07). So every ads tool takes an optional `account`, resolved
 * against this list.
 *
 * Lives beside `.env` in `~/.social-publisher/`, outside the repository, because
 * it names client businesses. It holds no secrets: the token stays in `.env`.
 * Read on every call, so adding an account needs no restart.
 *
 * {
 *   "accounts": [
 *     { "key": "muzaree", "name": "Muzaree", "adAccountId": "144042365972084",
 *       "pageId": "778648892002721", "instagramId": "17841476929259542",
 *       "pixelId": "1407317194096683", "currency": "PKR",
 *       "dailyLimit": 10000, "monthlyLimit": 300000 }
 *   ]
 * }
 *
 * `dailyLimit` and `monthlyLimit` are optional and in whole currency units. Without
 * them the account uses the ceiling in `.env`. Each account's ceiling is checked
 * against that account's own active spend.
 */
export const ACCOUNTS_PATH = join(CONFIG_DIR, 'ad-accounts.json')

export interface RegisteredAdAccount {
  readonly key: string
  readonly name: string
  readonly adAccountId: string
  readonly pageId: string
  readonly instagramId?: string
  readonly pixelId?: string
  readonly currency: string
  readonly dailyLimit?: number
  readonly monthlyLimit?: number
}

const digits = (value: unknown): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const s = String(value).trim().replace(/^act_/, '')
  return /^\d+$/.test(s) ? s : undefined
}

const wholeUnits = (value: unknown): number | undefined | 'bad' => {
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 'bad'
}

/**
 * Reads and checks the list. A malformed entry is an error, not skipped: an
 * account that silently vanished would send work to the default account instead.
 */
export function readAdAccounts(path: string = ACCOUNTS_PATH): RegisteredAdAccount[] | { error: string } {
  if (!existsSync(path)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    return { error: `${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
  const list = (parsed as { accounts?: unknown }).accounts
  if (!Array.isArray(list)) return { error: `${path} needs an "accounts" list.` }

  const out: RegisteredAdAccount[] = []
  const seen = new Set<string>()
  for (const [i, raw] of list.entries()) {
    const e = raw as Record<string, unknown>
    const where = `${path}, account ${i + 1}`
    const key = typeof e.key === 'string' ? e.key.trim().toLowerCase() : ''
    const name = typeof e.name === 'string' ? e.name.trim() : ''
    const adAccountId = digits(e.adAccountId)
    const pageId = digits(e.pageId)
    const currency = typeof e.currency === 'string' ? e.currency.trim().toUpperCase() : ''
    if (key === '' || name === '') return { error: `${where}: "key" and "name" are required.` }
    if (adAccountId === undefined) return { error: `${where} (${name}): "adAccountId" must be the account's number.` }
    if (pageId === undefined) return { error: `${where} (${name}): "pageId" must be the Page's number.` }
    if (!/^[A-Z]{3}$/.test(currency)) return { error: `${where} (${name}): "currency" must be a code like PKR.` }
    const instagramId = e.instagramId === undefined ? undefined : digits(e.instagramId)
    const pixelId = e.pixelId === undefined ? undefined : digits(e.pixelId)
    if (e.instagramId !== undefined && instagramId === undefined) return { error: `${where} (${name}): "instagramId" must be a number.` }
    if (e.pixelId !== undefined && pixelId === undefined) return { error: `${where} (${name}): "pixelId" must be a number.` }
    const dailyLimit = wholeUnits(e.dailyLimit)
    const monthlyLimit = wholeUnits(e.monthlyLimit)
    if (dailyLimit === 'bad' || monthlyLimit === 'bad') {
      return { error: `${where} (${name}): limits must be whole numbers above zero.` }
    }
    if ((dailyLimit === undefined) !== (monthlyLimit === undefined)) {
      return { error: `${where} (${name}): set both "dailyLimit" and "monthlyLimit", or neither.` }
    }
    // A key and a name may be the same word ("muzaree"); only clashes between accounts count.
    for (const id of new Set([key, name.toLowerCase(), adAccountId])) {
      if (seen.has(id)) return { error: `${where}: "${id}" is used by two accounts. Each name, key and id must be unique.` }
      seen.add(id)
    }
    out.push({
      key,
      name,
      adAccountId,
      pageId,
      currency,
      ...(instagramId !== undefined ? { instagramId } : {}),
      ...(pixelId !== undefined ? { pixelId } : {}),
      ...(dailyLimit !== undefined ? { dailyLimit } : {}),
      ...(monthlyLimit !== undefined ? { monthlyLimit } : {}),
    })
  }
  return out
}

/** Finds an account by key, name or id (with or without "act_"), ignoring case. */
export function findAdAccount(
  selector: string,
  accounts: readonly RegisteredAdAccount[],
): RegisteredAdAccount | { error: string } {
  const wanted = selector.trim().toLowerCase().replace(/^act_/, '')
  const hit = accounts.find((a) => a.key === wanted || a.name.toLowerCase() === wanted || a.adAccountId === wanted)
  if (hit !== undefined) return hit
  return {
    error:
      `No ad account called "${selector}". ` +
      (accounts.length > 0
        ? `Known: ${accounts.map((a) => `${a.name} (${a.key})`).join(', ')}. Run list_ad_accounts.`
        : `None are listed yet: add them to ${ACCOUNTS_PATH}.`) +
      ' Nothing was done.',
  }
}
