import { PublishError, classifyHttpStatus, classifyNetworkError } from '@social-publisher/core'

import { META_ADS_API_VERSION } from './meta-ads.ts'

/**
 * Getting someone from "a Facebook login" to "able to run ads".
 *
 * The owner's request, 2026-09-30: a customer with no business portfolio, no ad
 * account and no pixel should still be able to run ads through AdsPilot.
 * Checked against Meta's documentation the same day, the six things needed split
 * into two kinds:
 *
 * | Needed | By API? |
 * |---|---|
 * | A Facebook Page | **no** — Meta offers no public API for it |
 * | A business portfolio | yes, `POST /{user-id}/businesses` |
 * | An ad account | yes, `POST /{business-id}/adaccount`, at most 5 per business |
 * | A payment method | **no** — only in Meta's own billing screens |
 * | A pixel | yes, `POST /act_{id}/adspixels`, one per ad account |
 * | The pixel on the website | no — it is the business's site |
 *
 * So `inspect` reports every step and, for the ones Meta will not let us do,
 * exactly where the person does it. Creation is three separate methods, each one
 * behind its own approval in the MCP layer, because none can be undone: Meta does
 * not allow deleting a business, and an ad account can only be closed.
 */

const GRAPH_BASE = 'https://graph.facebook.com'

/** Links for the steps Meta keeps in its own screens. */
export const META_SETUP_LINKS = {
  createPage: 'https://www.facebook.com/pages/create',
  businessHome: 'https://business.facebook.com/overview',
  billing: (adAccountId: string) =>
    `https://business.facebook.com/billing_hub/payment_settings/?asset_id=${adAccountId}`,
  eventsManager: 'https://business.facebook.com/events_manager2',
} as const

/** Meta's `account_status` codes, in words. */
const ACCOUNT_STATUS: Readonly<Record<number, string>> = {
  1: 'active',
  2: 'disabled',
  3: 'unsettled (an unpaid balance)',
  7: 'pending Meta risk review',
  8: 'pending settlement',
  9: 'in a grace period',
  100: 'pending closure',
  101: 'closed',
}

/** A pixel that has not fired for this long is probably not on the site any more. */
const PIXEL_STALE_DAYS = 7

export interface SetupAdAccount {
  /** Without the `act_` prefix. */
  readonly id: string
  readonly name: string
  readonly currency: string
  readonly status: string
  readonly active: boolean
  readonly timezoneId?: number
  readonly timezoneName?: string
  readonly businessId?: string
  readonly hasPaymentMethod: boolean
}

export interface SetupPixel {
  readonly id: string
  readonly name: string
  /** Undefined when it has never fired. */
  readonly lastFired?: Date
}

export type SetupStepKey = 'page' | 'business' | 'ad_account' | 'payment' | 'pixel' | 'pixel_firing'

export interface SetupStep {
  readonly key: SetupStepKey
  readonly done: boolean
  /** What is true now, in plain words. */
  readonly detail: string
  /** What to do when it is not done: a tool to call, or a link for the person. */
  readonly next?: string
}

export interface SetupState {
  readonly who: { readonly id: string; readonly name: string }
  readonly pages: ReadonlyArray<{ readonly id: string; readonly name: string; readonly published: boolean }>
  readonly businesses: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly adAccounts: readonly SetupAdAccount[]
  /** The ad account the pixel and payment steps were checked on. */
  readonly focus?: SetupAdAccount
  readonly pixels: readonly SetupPixel[]
  readonly steps: readonly SetupStep[]
  readonly ready: boolean
}

export interface MetaAccountSetupOptions {
  readonly accessToken: string
  readonly apiVersion?: string
  readonly fetch?: typeof globalThis.fetch
  /** Injectable for tests. */
  readonly now?: () => Date
}

interface Row {
  [key: string]: unknown
}

export class MetaAccountSetup {
  readonly #token: string
  readonly #version: string
  readonly #fetch: typeof globalThis.fetch
  readonly #now: () => Date

  constructor(options: MetaAccountSetupOptions) {
    this.#token = options.accessToken
    this.#version = options.apiVersion ?? META_ADS_API_VERSION
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#now = options.now ?? (() => new Date())
  }

  /**
   * Everything that exists, and what is missing. Reads only.
   *
   * @param adAccountId the account to check payment and pixel on. Defaults to the
   *   first active one.
   */
  async inspect(adAccountId?: string): Promise<SetupState> {
    const me = (await this.#get('me', { fields: 'id,name' })) as Row
    const pagesRaw = await this.#list('me/accounts', 'id,name,is_published')
    const accountsRaw = await this.#list(
      'me/adaccounts',
      'account_id,name,currency,account_status,timezone_id,timezone_name,funding_source,business{id,name}',
    )
    // A person's own businesses. Empty for a system user, whose business shows
    // up through its ad accounts instead, so both are merged.
    const businessRaw = await this.#list('me/businesses', 'id,name').catch(() => [] as Row[])

    const pages = pagesRaw.map((p) => ({
      id: String(p.id),
      name: String(p.name ?? ''),
      published: p.is_published !== false,
    }))

    const adAccounts: SetupAdAccount[] = accountsRaw.map((a) => {
      const code = Number(a.account_status)
      const business = a.business as Row | undefined
      return {
        id: String(a.account_id),
        name: String(a.name ?? ''),
        currency: String(a.currency ?? ''),
        status: ACCOUNT_STATUS[code] ?? `status ${code}`,
        active: code === 1,
        ...(a.timezone_id !== undefined ? { timezoneId: Number(a.timezone_id) } : {}),
        ...(a.timezone_name !== undefined ? { timezoneName: String(a.timezone_name) } : {}),
        ...(business?.id !== undefined ? { businessId: String(business.id) } : {}),
        hasPaymentMethod: a.funding_source !== undefined && a.funding_source !== null && a.funding_source !== '',
      }
    })

    const businesses = new Map<string, string>()
    for (const b of businessRaw) businesses.set(String(b.id), String(b.name ?? ''))
    for (const a of accountsRaw) {
      const b = a.business as Row | undefined
      if (b?.id !== undefined) businesses.set(String(b.id), String(b.name ?? ''))
    }

    const wanted = adAccountId?.replace(/^act_/, '')
    const focus =
      wanted !== undefined ? adAccounts.find((a) => a.id === wanted) : (adAccounts.find((a) => a.active) ?? adAccounts[0])

    const pixels: SetupPixel[] =
      focus === undefined
        ? []
        : (await this.#list(`act_${focus.id}/adspixels`, 'id,name,last_fired_time')).map((p) => ({
            id: String(p.id),
            name: String(p.name ?? ''),
            ...(typeof p.last_fired_time === 'string' ? { lastFired: new Date(p.last_fired_time) } : {}),
          }))

    const steps = this.#steps({
      pages,
      businesses: [...businesses].map(([id, name]) => (name === '' ? id : `${name} (${id})`)),
      adAccounts,
      ...(wanted !== undefined && focus === undefined ? { missingAccount: wanted } : {}),
      ...(focus !== undefined ? { focus } : {}),
      pixels,
    })

    return {
      who: { id: String(me.id), name: String(me.name ?? '') },
      pages,
      businesses: [...businesses].map(([id, name]) => ({ id, name })),
      adAccounts,
      ...(focus !== undefined ? { focus } : {}),
      pixels,
      steps,
      ready: steps.every((s) => s.done),
    }
  }

  /**
   * Creates a business portfolio. **Permanent: Meta does not allow deleting one.**
   *
   * Needs a person's token, not a system user's (a system user already belongs to
   * a business), the `business_management` permission, and a published Page.
   */
  async createBusiness(input: { name: string; vertical: string; primaryPageId: string }): Promise<string> {
    const data = await this.#post('me/businesses', {
      name: input.name,
      vertical: input.vertical,
      primary_page: input.primaryPageId,
    })
    return requireId(data, 'business')
  }

  /**
   * Creates an ad account in a business. Meta allows **five** by API per
   * business; beyond that it has to be done in Business Settings.
   *
   * The business is the end advertiser. "Agency" and "partner" are `NONE`: the
   * business is advertising for itself, which is the normal case for a customer.
   *
   * @returns the id without the `act_` prefix, as the rest of this code uses it.
   */
  async createAdAccount(input: {
    businessId: string
    name: string
    currency: string
    timezoneId: number
  }): Promise<string> {
    const data = await this.#post(`${input.businessId}/adaccount`, {
      name: input.name,
      currency: input.currency,
      timezone_id: String(input.timezoneId),
      end_advertiser: input.businessId,
      media_agency: 'NONE',
      partner: 'NONE',
    })
    const row = data as { account_id?: string; id?: string }
    const id = row.account_id ?? row.id?.replace(/^act_/, '')
    if (id === undefined) {
      throw new PublishError('Meta created an ad account but returned no id.', { failureClass: 'transient' })
    }
    return id
  }

  /** Creates the ad account's pixel. Meta allows one per ad account by API. */
  async createPixel(input: { adAccountId: string; name: string }): Promise<string> {
    const data = await this.#post(`act_${input.adAccountId.replace(/^act_/, '')}/adspixels`, { name: input.name })
    return requireId(data, 'pixel')
  }

  #steps(s: {
    pages: SetupState['pages']
    businesses: readonly string[]
    adAccounts: readonly SetupAdAccount[]
    missingAccount?: string
    focus?: SetupAdAccount
    pixels: readonly SetupPixel[]
  }): SetupStep[] {
    const steps: SetupStep[] = []
    const published = s.pages.filter((p) => p.published)

    steps.push(
      published.length > 0
        ? { key: 'page', done: true, detail: `Page: ${published.map((p) => `${p.name} (${p.id})`).join(', ')}` }
        : {
            key: 'page',
            done: false,
            detail: s.pages.length > 0 ? 'The only Page is unpublished; ads need a published Page.' : 'No Facebook Page.',
            next: `The person creates it at ${META_SETUP_LINKS.createPage} (Meta does not allow this by API), then check again.`,
          },
    )

    steps.push(
      s.businesses.length > 0
        ? { key: 'business', done: true, detail: `Business portfolio: ${s.businesses.join(', ')}` }
        : {
            key: 'business',
            done: false,
            detail: 'No business portfolio.',
            next:
              published.length > 0
                ? 'create_business, with the Page as its primary Page.'
                : 'Needs a published Page first.',
          },
    )

    const active = s.adAccounts.filter((a) => a.active)
    steps.push(
      s.missingAccount !== undefined
        ? {
            key: 'ad_account',
            done: false,
            detail: `Ad account ${s.missingAccount} is not reachable with this authorisation.`,
            next: 'Check the id, or give this connection access to it in Business Settings.',
          }
        : active.length > 0
          ? { key: 'ad_account', done: true, detail: `Ad account: ${active.map((a) => `${a.name} (${a.id}, ${a.currency})`).join(', ')}` }
          : {
              key: 'ad_account',
              done: false,
              detail:
                s.adAccounts.length > 0
                  ? `Ad accounts exist but none is active: ${s.adAccounts.map((a) => `${a.name} is ${a.status}`).join('; ')}.`
                  : 'No ad account.',
              next: s.businesses.length > 0 ? 'create_ad_account in the business.' : 'Needs a business portfolio first.',
            },
    )

    if (s.focus !== undefined) {
      steps.push(
        s.focus.hasPaymentMethod
          ? { key: 'payment', done: true, detail: `A payment method is on file for ${s.focus.name}.` }
          : {
              key: 'payment',
              done: false,
              detail: `No payment method on ${s.focus.name}. Ads cannot run without one.`,
              next: `The person adds a card at ${META_SETUP_LINKS.billing(s.focus.id)} (Meta does not allow this by API).`,
            },
      )

      steps.push(
        s.pixels.length > 0
          ? { key: 'pixel', done: true, detail: `Pixel: ${s.pixels.map((p) => `${p.name} (${p.id})`).join(', ')}` }
          : { key: 'pixel', done: false, detail: `No pixel on ${s.focus.name}.`, next: 'create_pixel.' },
      )

      if (s.pixels.length > 0) {
        const latest = s.pixels
          .map((p) => p.lastFired)
          .filter((d): d is Date => d !== undefined)
          .sort((a, b) => b.getTime() - a.getTime())[0]
        const days = latest === undefined ? undefined : Math.floor((this.#now().getTime() - latest.getTime()) / 86_400_000)
        steps.push(
          days !== undefined && days <= PIXEL_STALE_DAYS
            ? { key: 'pixel_firing', done: true, detail: `The pixel is receiving website events (last ${latest!.toISOString().slice(0, 10)}).` }
            : {
                key: 'pixel_firing',
                done: false,
                detail:
                  days === undefined
                    ? 'The pixel has never received an event: it is not on the website yet.'
                    : `The pixel has received nothing for ${days} days: it may have been removed from the website.`,
                next: `Put the pixel code on every page of the site (from ${META_SETUP_LINKS.eventsManager}). Until it fires, sales and website-lead campaigns cannot optimise.`,
              },
        )
      }
    }
    return steps
  }

  async #list(path: string, fields: string): Promise<Row[]> {
    const data = (await this.#get(path, { fields, limit: '100' })) as { data?: Row[] }
    return data.data ?? []
  }

  async #get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${GRAPH_BASE}/${this.#version}/${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    url.searchParams.set('access_token', this.#token)
    return await this.#send(url.toString(), { method: 'GET' })
  }

  async #post(path: string, body: Record<string, string>): Promise<unknown> {
    return await this.#send(`${GRAPH_BASE}/${this.#version}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, access_token: this.#token }),
    })
  }

  async #send(url: string, init: RequestInit): Promise<unknown> {
    let response: Response
    try {
      response = await this.#fetch(url, init)
    } catch (cause) {
      throw new PublishError('Could not reach the Meta Graph API', { failureClass: classifyNetworkError(cause), cause })
    }
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      throw new PublishError(`Meta returned a response that was not JSON (HTTP ${response.status})`, {
        failureClass: response.ok ? 'permanent' : 'transient',
        httpStatus: response.status,
      })
    }
    if (!response.ok) {
      const error = (parsed as { error?: { message?: string; error_user_msg?: string; code?: number } }).error
      const message = error?.error_user_msg ?? error?.message ?? `HTTP ${response.status}`
      throw new PublishError(`Meta rejected the request: ${message}`, {
        failureClass: classifyHttpStatus(response.status),
        platformMessage: message,
        ...(error?.code !== undefined ? { platformCode: String(error.code) } : {}),
        httpStatus: response.status,
      })
    }
    return parsed
  }
}

function requireId(data: unknown, what: string): string {
  const id = (data as { id?: string }).id
  if (id === undefined) throw new PublishError(`Meta created the ${what} but returned no id.`, { failureClass: 'transient' })
  return id
}
