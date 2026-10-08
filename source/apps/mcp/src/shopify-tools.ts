import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { ShopifyAdminClient, ShopifyError, httpsTransport, type AuditFinding } from '@social-publisher/adapters'
import { CONFIG_DIR, optional } from '@social-publisher/config'

import { guarded, type ToolResult } from './ads-tools.ts'

/**
 * Shopify tools, read-only (phase 1 of architecture/2026-10-08-shopify-connector-plan.md).
 *
 * Stores are listed in ~/.social-publisher/shopify-stores.json, beside the ad
 * account list, read on every call:
 *
 *   { "stores": [ { "key": "practice", "name": "Practice store",
 *                   "shop": "1920-agency-test-store.myshopify.com" } ] }
 *
 * The app's id and secret come from SHOPIFY_CONNECTOR_CLIENT_ID and
 * SHOPIFY_CONNECTOR_CLIENT_SECRET in .env. SHOPIFY_CONNECT_ADDRESS is optional and
 * only for a broken network route (see httpsTransport).
 *
 * Nothing here changes a store. Writes come in phase 2, behind approvals.
 */

export const STORES_PATH = join(CONFIG_DIR, 'shopify-stores.json')

export interface ShopifyStoreEntry {
  readonly key: string
  readonly name: string
  readonly shop: string
}

const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })

export function readShopifyStores(path: string = STORES_PATH): ShopifyStoreEntry[] | { error: string } {
  if (!existsSync(path)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    return { error: `${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
  const list = (parsed as { stores?: unknown }).stores
  if (!Array.isArray(list)) return { error: `${path} needs a "stores" list.` }
  const out: ShopifyStoreEntry[] = []
  const seen = new Set<string>()
  for (const [i, raw] of list.entries()) {
    const e = raw as Record<string, unknown>
    const key = typeof e.key === 'string' ? e.key.trim().toLowerCase() : ''
    const name = typeof e.name === 'string' ? e.name.trim() : ''
    const shop = typeof e.shop === 'string' ? e.shop.trim().toLowerCase() : ''
    if (key === '' || name === '') return { error: `${path}, store ${i + 1}: "key" and "name" are required.` }
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      return { error: `${path}, store ${i + 1} (${name}): "shop" must be the store's myshopify.com address.` }
    }
    for (const id of new Set([key, name.toLowerCase(), shop])) {
      if (seen.has(id)) return { error: `${path}: "${id}" is used by two stores.` }
      seen.add(id)
    }
    out.push({ key, name, shop })
  }
  return out
}

export function findShopifyStore(selector: string, stores: readonly ShopifyStoreEntry[]): ShopifyStoreEntry | { error: string } {
  const wanted = selector.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const hit = stores.find((s) => s.key === wanted || s.name.toLowerCase() === wanted || s.shop === wanted)
  if (hit !== undefined) return hit
  return {
    error:
      `No Shopify store called "${selector}". ` +
      (stores.length > 0 ? `Known: ${stores.map((s) => `${s.name} ("${s.key}")`).join(', ')}.` : `None are listed yet: add them to ${STORES_PATH}.`),
  }
}

/** Builds a client for a listed store, or explains what is missing. */
export function loadShopify(selector: string): { client: ShopifyAdminClient; store: ShopifyStoreEntry } | { error: string } {
  const stores = readShopifyStores()
  if ('error' in stores) return stores
  const store = findShopifyStore(selector, stores)
  if ('error' in store) return store
  const clientId = optional('SHOPIFY_CONNECTOR_CLIENT_ID')
  const clientSecret = optional('SHOPIFY_CONNECTOR_CLIENT_SECRET')
  if (clientId === undefined || clientSecret === undefined) {
    return {
      error:
        'The Shopify connector is not configured: SHOPIFY_CONNECTOR_CLIENT_ID and SHOPIFY_CONNECTOR_CLIENT_SECRET are missing from ~/.social-publisher/.env. ' +
        'Run `shopify app env show` in integrations/shopify-app to see them.',
    }
  }
  return {
    client: new ShopifyAdminClient({
      shop: store.shop,
      credentials: { clientId, clientSecret },
      transport: httpsTransport(optional('SHOPIFY_CONNECT_ADDRESS')),
    }),
    store,
  }
}

const storeArg = z.string().describe('Which store: a name, key or myshopify.com address from list_shopify_stores.')
const fmt = (n: number, currency = '') => `${currency ? `${currency} ` : ''}${Math.round(n).toLocaleString('en-US')}`
const pct = (n: number) => `${Math.round(n * 100)}%`
const counts = (m: Record<string, number>) =>
  Object.entries(m)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || 'none'

async function withStore(selector: string, fn: (client: ShopifyAdminClient, store: ShopifyStoreEntry) => Promise<string>): Promise<ToolResult> {
  return await guarded(async () => {
    const loaded = loadShopify(selector)
    if ('error' in loaded) return text(loaded.error)
    try {
      return text(`Store: ${loaded.store.name} (${loaded.store.shop})\n\n${await fn(loaded.client, loaded.store)}`)
    } catch (error) {
      if (error instanceof ShopifyError) return text(`Could not read ${loaded.store.name}: ${error.message}`)
      throw error
    }
  })
}

export function registerShopifyTools(server: McpServer): void {
  server.tool(
    'list_shopify_stores',
    'List the Shopify stores AdsPilot can read. Pass one as `store` to the other shopify_ tools. Reads only.',
    {},
    async () =>
      await guarded(async () => {
        const stores = readShopifyStores()
        if ('error' in stores) return text(stores.error)
        if (stores.length === 0) return text(`No Shopify stores connected yet. Add them to ${STORES_PATH}.`)
        return text(['Connected Shopify stores:', ...stores.map((s) => `  ${s.name}  (store: "${s.key}")  ${s.shop}`)].join('\n'))
      }),
  )

  server.tool(
    'shopify_store_overview',
    'A Shopify store at a glance: name, currency, plan, product and order counts, live theme. Reads only.',
    { store: storeArg },
    async ({ store }) =>
      await withStore(store, async (client) => {
        const o = await client.overview()
        return [
          `${o.name} — ${o.url} (${o.currency}, plan: ${o.plan || 'unknown'})`,
          `Products: ${o.products}. Orders (all time): ${o.orders}.`,
          `Live theme: ${o.liveTheme || 'unknown'}. All themes: ${o.themes.join(', ')}.`,
        ].join('\n')
      }),
  )

  server.tool(
    'shopify_products',
    'Products with live prices, compare-at (sale) prices, stock, sold-out sizes, photo count and gross margin where a cost per item is recorded. Use before writing any ad that names a price or size. Reads only.',
    {
      store: storeArg,
      limit: z.number().int().min(1).max(250).default(50),
      search: z.string().optional().describe('Shopify product search, e.g. "chelsea" or "status:active".'),
    },
    async ({ store, limit, search }) =>
      await withStore(store, async (client) => {
        const rows = await client.products({ limit, ...(search !== undefined ? { query: search } : {}) })
        if (rows.length === 0) return 'No products match.'
        return [
          `${rows.length} product(s), most recently updated first:`,
          ...rows.map(
            (p) =>
              `• ${p.title} [${p.status.toLowerCase()}] ${p.minPrice === p.maxPrice ? p.minPrice : `${p.minPrice}–${p.maxPrice}`}` +
              (p.compareAt !== null ? ` (was ${p.compareAt})` : '') +
              ` · stock ${p.inventory}` +
              (p.soldOut.length > 0 ? ` · sold out: ${p.soldOut.slice(0, 8).join(', ')}` : '') +
              ` · ${p.images} image(s)` +
              (p.minMargin !== null ? ` · margin ${pct(p.minMargin)}` : '') +
              (p.url !== null ? `\n  ${p.url}` : ''),
          ),
        ].join('\n')
      }),
  )

  server.tool(
    'shopify_sales',
    "Real sales from the store for the last N days (up to 60): orders, revenue, average order, items per order, cancellations, refunds, discount codes used, and where each order's visit came from (UTM source/medium). Compare it with the ad platform's purchases to see true cost per order. Reads only; no customer personal data.",
    { store: storeArg, days: z.number().int().min(1).max(60).default(30) },
    async ({ store, days }) =>
      await withStore(store, async (client) => {
        const s = await client.sales(days)
        if (s.orders === 0 && s.cancelled === 0) return `No orders in the last ${s.days} days (since ${s.since}).`
        const fb = Object.entries(s.sources)
          .filter(([k]) => /facebook|instagram|meta|fb|ig/i.test(k))
          .reduce((n, [, v]) => n + v, 0)
        return [
          `Last ${s.days} days (since ${s.since}):`,
          `  Orders ${s.orders} (+${s.cancelled} cancelled) · revenue ${fmt(s.revenue, s.currency)} · average order ${fmt(s.averageOrder, s.currency)} · ${s.itemsPerOrder.toFixed(2)} items per order`,
          `  Refunded ${fmt(s.refunded, s.currency)}`,
          `  Payment: ${counts(s.financialStatus)}`,
          `  Fulfilment: ${counts(s.fulfillmentStatus)}`,
          `  Discount codes: ${counts(s.discountCodes)}`,
          `  Where the last visit came from: ${counts(s.sources)}${s.attributionPending > 0 ? ` (${s.attributionPending} not yet attributed)` : ''}`,
          `  Orders whose last visit was Facebook/Instagram: ${fb}`,
          '',
          'By day: ' + s.byDay.map((d) => `${d.date.slice(5)} ${d.orders}`).join(' · '),
          '',
          'Cash-on-delivery stores: Shopify does not know which parcels were refused; true cost per delivered order needs the courier report.',
        ].join('\n')
      }),
  )

  server.tool(
    'shopify_store_audit',
    'Conversion audit facts for a Shopify store: thin product pages (few photos, short descriptions), sold-out items still listed, low margins, missing refund/shipping policies, missing FAQ/size guide/contact pages, active discount codes. Then read get_skill cro and copywriting to turn the findings into fixes. Reads only.',
    { store: storeArg },
    async ({ store }) =>
      await withStore(store, async (client) => {
        const a = await client.auditFacts()
        const order: Record<AuditFinding['severity'], number> = { high: 0, medium: 1, low: 2 }
        const findings = [...a.findings].sort((x, y) => order[x.severity] - order[y.severity])
        return [
          `${a.overview.name}: ${a.activeProducts} active product(s), live theme "${a.overview.liveTheme}".`,
          `Pages: ${a.pages.join(', ') || 'none'}. Policies published: ${a.policies.join(', ') || 'none readable'}.`,
          `Active discount codes: ${a.activeDiscounts.join(', ') || 'none'}.`,
          '',
          findings.length > 0 ? `${findings.length} finding(s):` : 'No problems found in the data AdsPilot can read.',
          ...findings.map((f) => `  [${f.severity}] ${f.area}: ${f.finding}`),
          '',
          'Not checked by this audit (look at the live pages): banners and their dates, page speed, the size selector, trust badges, delivery messaging on the product page. Read get_skill cro and copywriting before proposing fixes; changes to a store need the owner’s approval.',
        ].join('\n')
      }),
  )
}
