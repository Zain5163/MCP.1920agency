import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { ShopifyAdminClient, ShopifyError, httpsTransport, type AuditFinding } from '@social-publisher/adapters'
import { CONFIG_DIR, optional } from '@social-publisher/config'
import { decide, formatApprovalRequest } from '@social-publisher/core'

import { audit, guarded, type ToolResult } from './ads-tools.ts'

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

/**
 * Where the tools get their stores from.
 *
 * Local (the owner's PC): the store list file and the app's own credentials.
 * Hosted (each AdsPilot user): the stores that user connected, with their own
 * encrypted tokens (shopify-hosted.ts). The tools are the same; only this differs.
 */
export interface ShopifyAccess {
  list(): Promise<ShopifyStoreEntry[] | { error: string }>
  open(selector: string): Promise<{ client: ShopifyAdminClient; store: ShopifyStoreEntry } | { error: string }>
  /** Where earlier versions of this store's products and pages are saved. */
  backupDir(store: ShopifyStoreEntry): string
}

export const localShopifyAccess: ShopifyAccess = {
  list: async () => readShopifyStores(),
  open: async (selector) => loadShopify(selector),
  backupDir: (store) => join(BACKUP_DIR, store.shop),
}

const storeArg = z.string().describe('Which store: a name, key or myshopify.com address from list_shopify_stores.')
const fmt = (n: number, currency = '') => `${currency ? `${currency} ` : ''}${Math.round(n).toLocaleString('en-US')}`
const pct = (n: number) => `${Math.round(n * 100)}%`
const counts = (m: Record<string, number>) =>
  Object.entries(m)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || 'none'

async function withStore(
  access: ShopifyAccess,
  selector: string,
  fn: (client: ShopifyAdminClient, store: ShopifyStoreEntry) => Promise<string>,
): Promise<ToolResult> {
  return await guarded(async () => {
    const loaded = await access.open(selector)
    if ('error' in loaded) return text(loaded.error)
    try {
      return text(`Store: ${loaded.store.name} (${loaded.store.shop})\n\n${await fn(loaded.client, loaded.store)}`)
    } catch (error) {
      if (error instanceof ShopifyError) return text(`Could not read ${loaded.store.name}: ${error.message}`)
      throw error
    }
  })
}

export function registerShopifyTools(server: McpServer, access: ShopifyAccess = localShopifyAccess): void {
  server.tool(
    'list_shopify_stores',
    'List the Shopify stores AdsPilot can read. Pass one as `store` to the other shopify_ tools. Reads only.',
    {},
    async () =>
      await guarded(async () => {
        const stores = await access.list()
        if ('error' in stores) return text(stores.error)
        if (stores.length === 0) return text(access === localShopifyAccess ? `No Shopify stores connected yet. Add them to ${STORES_PATH}.` : 'No Shopify store connected yet. Use shopify_connect_store with your store address.')
        return text(['Connected Shopify stores:', ...stores.map((s) => `  ${s.name}  (store: "${s.key}")  ${s.shop}`)].join('\n'))
      }),
  )

  server.tool(
    'shopify_store_overview',
    'A Shopify store at a glance: name, currency, plan, product and order counts, live theme. Reads only.',
    { store: storeArg },
    async ({ store }) =>
      await withStore(access, store, async (client) => {
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
      await withStore(access, store, async (client) => {
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
      await withStore(access, store, async (client) => {
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
      await withStore(access, store, async (client) => {
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

// ---------------------------------------------------------------- phase 2: writes
//
// Every change follows the same five steps, in code, whatever the AI asks:
//   1. read what is there now;
//   2. show the owner a before/after summary and wait for the approval token
//      (the token covers the exact change AND what was there, so if the store
//      changed in between, the approval no longer matches);
//   3. save the current version to ~/.social-publisher/shopify-backups/;
//   4. make the change;
//   5. read it back and report whether the store now holds exactly what was approved.

export const BACKUP_DIR = join(CONFIG_DIR, 'shopify-backups')

const plain = (html: string, max = 280) => {
  const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t || '(empty)'
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)

function saveBackup(dir: string, shop: string, kind: 'product' | 'page', handle: string, content: unknown): string {
  mkdirSync(dir, { recursive: true })
  const file = `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}-${handle.replace(/[^a-z0-9-]/gi, '_')}.json`
  writeFileSync(join(dir, file), JSON.stringify({ kind, handle, shop, savedAt: new Date().toISOString(), content }, null, 2))
  return file
}

const confirmArg = z.string().optional().describe('The approval token from the summary, once the owner has said yes.')

export function registerShopifyWriteTools(server: McpServer, access: ShopifyAccess = localShopifyAccess): void {
  server.tool(
    'shopify_update_product',
    'Change a product page: title, description (HTML) or SEO title/description. Shows a before/after summary for the owner’s approval, saves the current version first, then reads the change back. Visible to customers immediately.',
    {
      store: storeArg,
      handle: z.string().describe('The product handle, from shopify_products.'),
      title: z.string().optional(),
      descriptionHtml: z.string().optional(),
      seoTitle: z.string().max(70).optional(),
      seoDescription: z.string().max(320).optional(),
      confirm: confirmArg,
    },
    async ({ store, handle, confirm, ...changes }) =>
      await withStore(access, store, async (client, entry) => {
        const wanted = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined))
        if (Object.keys(wanted).length === 0) return 'Nothing to change: give a title, descriptionHtml, seoTitle or seoDescription.'
        const before = await client.productContent(handle)
        if (before === undefined) return `No product with the handle "${handle}". Use shopify_products to find it.`
        const lines = [`Change product "${before.title}" (${handle}) on ${entry.name}:`]
        if (changes.title !== undefined) lines.push(`  title: "${before.title}" → "${changes.title}"`)
        if (changes.descriptionHtml !== undefined) lines.push(`  description now: ${plain(before.descriptionHtml)}`, `  description new: ${plain(changes.descriptionHtml)}`)
        if (changes.seoTitle !== undefined) lines.push(`  SEO title: "${before.seo.title ?? ''}" → "${changes.seoTitle}"`)
        if (changes.seoDescription !== undefined) lines.push(`  SEO description: "${before.seo.description ?? ''}" → "${changes.seoDescription}"`)
        lines.push('', 'Customers see this as soon as it is saved. The current version is saved first and can be restored.')
        const gate = decide({
          action: 'shopify_update_product',
          payload: { shop: entry.shop, handle, wanted, current: hash(before) },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)

        const backup = saveBackup(access.backupDir(entry), entry.shop, 'product', handle, before)
        await client.updateProduct(before.id, wanted)
        const after = await client.productContent(handle)
        const ok =
          after !== undefined &&
          (changes.title === undefined || after.title === changes.title) &&
          (changes.seoTitle === undefined || after.seo.title === changes.seoTitle) &&
          (changes.seoDescription === undefined || after.seo.description === changes.seoDescription) &&
          (changes.descriptionHtml === undefined || plain(after.descriptionHtml, 10_000) === plain(changes.descriptionHtml, 10_000))
        await audit('shopify.product.updated', { shop: entry.shop, handle, backup })
        return [
          ok ? `Done, and read back from Shopify: "${after!.title}" now holds the approved text.` : 'Saved, but the read-back does not match what was approved. Check the product page now.',
          `Previous version saved: ${backup} (restore with shopify_restore_backup).`,
        ].join('\n')
      }),
  )

  server.tool(
    'shopify_save_page',
    'Create or update a store page (FAQ, size guide, delivery and returns, about). Saved as a hidden draft unless publish is true. Shows a summary for the owner’s approval, saves the current version first, then reads it back.',
    {
      store: storeArg,
      handle: z.string().regex(/^[a-z0-9-]+$/).describe('URL handle, e.g. "faq" or "size-guide".'),
      title: z.string().min(1),
      bodyHtml: z.string().min(1),
      publish: z.boolean().default(false).describe('Visible to customers. Default false: saved as a hidden draft.'),
      confirm: confirmArg,
    },
    async ({ store, handle, title, bodyHtml, publish, confirm }) =>
      await withStore(access, store, async (client, entry) => {
        const before = await client.pageContent(handle)
        const lines = [
          before === undefined ? `Create page "${title}" (/pages/${handle}) on ${entry.name}` : `Update page "${before.title}" (/pages/${handle}) on ${entry.name}`,
          ...(before !== undefined ? [`  content now: ${plain(before.body)}`] : []),
          `  content new: ${plain(bodyHtml)}`,
          `  ${publish ? 'PUBLISHED: visible to customers at once' : 'hidden draft: not visible to customers until published'}`,
          ...(before !== undefined ? ['', 'The current version is saved first and can be restored.'] : []),
        ]
        const gate = decide({
          action: 'shopify_save_page',
          payload: { shop: entry.shop, handle, title, body: hash(bodyHtml), publish, current: before === undefined ? null : hash(before) },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)

        let backup: string | undefined
        if (before !== undefined) {
          backup = saveBackup(access.backupDir(entry), entry.shop, 'page', handle, before)
          await client.updatePage(before.id, { title, body: bodyHtml, isPublished: publish })
        } else {
          await client.createPage({ title, handle, body: bodyHtml, isPublished: publish })
        }
        const after = await client.pageContent(handle)
        const ok = after !== undefined && after.title === title && after.isPublished === publish && plain(after.body, 10_000) === plain(bodyHtml, 10_000)
        await audit('shopify.page.saved', { shop: entry.shop, handle, created: before === undefined, publish })
        return [
          ok ? `Done, and read back from Shopify: /pages/${handle} holds the approved content (${publish ? 'published' : 'hidden draft'}).` : 'Saved, but the read-back does not match what was approved. Check the page now.',
          ...(backup !== undefined ? [`Previous version saved: ${backup}.`] : []),
        ].join('\n')
      }),
  )

  server.tool(
    'shopify_create_discount',
    'Create a discount code: a percentage or fixed amount off (optionally only when buying N items, e.g. a two-pair bundle, or above a minimum order), or free shipping above a minimum. Always with an end date. Needs the owner’s approval: every order that uses it earns less.',
    {
      store: storeArg,
      kind: z.enum(['percentage', 'fixed_amount', 'free_shipping']),
      value: z.number().min(0).describe('Percent (10 = 10% off) or an amount in the store currency. Ignored for free_shipping.'),
      code: z.string().regex(/^[A-Z0-9_-]{3,40}$/).describe('Upper-case code customers type, e.g. "PAIR2".'),
      title: z.string().optional().describe('Internal name; defaults to the code.'),
      startsAt: z.string().optional().describe('ISO date-time; default now.'),
      endsAt: z.string().describe('ISO date-time. Required: an open-ended discount is how codes leak for months.'),
      minimumQuantity: z.number().int().min(2).optional().describe('Items in the cart, e.g. 2 for a two-pair offer.'),
      minimumSubtotal: z.number().positive().optional().describe('Minimum order value in the store currency.'),
      usageLimit: z.number().int().positive().optional(),
      oncePerCustomer: z.boolean().optional(),
      confirm: confirmArg,
    },
    async ({ store, confirm, ...spec }) =>
      await withStore(access, store, async (client, entry) => {
        if (spec.kind === 'percentage' && (spec.value <= 0 || spec.value > 90)) return 'A percentage must be between 1 and 90.'
        if (spec.kind === 'fixed_amount' && spec.value <= 0) return 'A fixed amount must be above zero.'
        if (spec.minimumQuantity !== undefined && spec.minimumSubtotal !== undefined) return 'Use a minimum quantity or a minimum order value, not both.'
        const startsAt = spec.startsAt ?? new Date().toISOString()
        if (!(new Date(spec.endsAt).getTime() > new Date(startsAt).getTime())) return 'endsAt must be after startsAt.'
        const o = await client.overview()
        const what =
          spec.kind === 'free_shipping' ? 'free shipping' : spec.kind === 'percentage' ? `${spec.value}% off` : `${o.currency} ${spec.value} off the order`
        const when =
          spec.minimumQuantity !== undefined
            ? ` when buying ${spec.minimumQuantity} or more items`
            : spec.minimumSubtotal !== undefined
              ? ` on orders of ${o.currency} ${spec.minimumSubtotal} or more`
              : ' on any order'
        const lines = [
          `Create discount code ${spec.code} on ${entry.name}: ${what}${when}.`,
          `  from ${startsAt} to ${spec.endsAt}${spec.usageLimit !== undefined ? `, at most ${spec.usageLimit} uses` : ''}${spec.oncePerCustomer ? ', once per customer' : ''}`,
          '',
          'Every order that uses it earns less. It can be ended early with shopify_end_discount, but not taken back from orders already placed.',
        ]
        const gate = decide({
          action: 'shopify_create_discount',
          // "Start now" is approved as "now", not as a timestamp: a timestamp taken on each
          // call changed between the summary and the approval, so the token never matched
          // (found in the live test, 2026-10-08).
          payload: { shop: entry.shop, ...spec, startsAt: spec.startsAt ?? 'now' },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)

        const created = await client.createDiscount({ ...spec, startsAt, title: spec.title ?? spec.code })
        await audit('shopify.discount.created', { shop: entry.shop, code: created.code, id: created.id })
        const ok = created.code === spec.code && ['ACTIVE', 'SCHEDULED'].includes(created.status.toUpperCase())
        return ok
          ? `Done, and read back from Shopify: code ${created.code} is ${created.status.toLowerCase()} until ${created.endsAt ?? 'no end date'}.`
          : `Created, but Shopify reports code "${created.code}" with status "${created.status}". Check it in the store admin.`
      }),
  )

  server.tool(
    'shopify_end_discount',
    'End a discount code now. Like pausing an ad, stopping an offer never waits for approval. The discount stays on record because orders reference it.',
    { store: storeArg, code: z.string() },
    async ({ store, code }) =>
      await withStore(access, store, async (client, entry) => {
        const found = await client.graphql<{ codeDiscountNodeByCode: { id: string } | null }>(
          'query($code: String!) { codeDiscountNodeByCode(code: $code) { id } }',
          { code },
        )
        if (found.codeDiscountNodeByCode === null) return `No discount with the code "${code}".`
        await client.deactivateDiscount(found.codeDiscountNodeByCode.id)
        await audit('shopify.discount.ended', { shop: entry.shop, code })
        return `Code ${code} is ended on ${entry.name}. Orders already placed with it are unaffected.`
      }),
  )

  server.tool(
    'shopify_list_backups',
    'List the saved earlier versions of products and pages that AdsPilot changed on a store, newest first. Reads only.',
    { store: storeArg },
    async ({ store }) =>
      await withStore(access, store, async (_client, entry) => {
        const dir = access.backupDir(entry)
        if (!existsSync(dir)) return 'No backups yet: AdsPilot has not changed this store.'
        const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse()
        return files.length === 0 ? 'No backups yet.' : ['Backups (newest first):', ...files.slice(0, 50).map((f) => `  ${f}`)].join('\n')
      }),
  )

  server.tool(
    'shopify_restore_backup',
    'Put a saved earlier version of a product or page back (from shopify_list_backups). Shows what will be restored for the owner’s approval, saves the current version first, then reads it back.',
    { store: storeArg, file: z.string().regex(/^[\w.-]+\.json$/), confirm: confirmArg },
    async ({ store, file, confirm }) =>
      await withStore(access, store, async (client, entry) => {
        const path = join(access.backupDir(entry), file)
        if (!existsSync(path)) return `No backup "${file}" for this store. Use shopify_list_backups.`
        const saved = JSON.parse(readFileSync(path, 'utf8')) as {
          kind: 'product' | 'page'
          handle: string
          content: { title: string; descriptionHtml?: string; seo?: { title: string | null; description: string | null }; body?: string; isPublished?: boolean }
        }
        const gate = decide({
          action: 'shopify_restore_backup',
          payload: { shop: entry.shop, file },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () =>
            [
              `Restore the ${saved.kind} "${saved.content.title}" (${saved.handle}) on ${entry.name} to the version saved in ${file}:`,
              `  ${plain(saved.content.descriptionHtml ?? saved.content.body ?? '')}`,
              '',
              'The current version is saved first, so this restore can be undone too.',
            ].join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)
        if (saved.kind === 'product') {
          const now = await client.productContent(saved.handle)
          if (now === undefined) return `The product "${saved.handle}" no longer exists.`
          const backup = saveBackup(access.backupDir(entry), entry.shop, 'product', saved.handle, now)
          await client.updateProduct(now.id, {
            title: saved.content.title,
            descriptionHtml: saved.content.descriptionHtml ?? '',
            seoTitle: saved.content.seo?.title ?? '',
            seoDescription: saved.content.seo?.description ?? '',
          })
          await audit('shopify.product.restored', { shop: entry.shop, handle: saved.handle, from: file })
          return `Restored "${saved.content.title}". The version it replaced is saved as ${backup}.`
        }
        const now = await client.pageContent(saved.handle)
        if (now === undefined) return `The page "${saved.handle}" no longer exists.`
        const backup = saveBackup(access.backupDir(entry), entry.shop, 'page', saved.handle, now)
        await client.updatePage(now.id, { title: saved.content.title, body: saved.content.body ?? '', isPublished: saved.content.isPublished ?? false })
        await audit('shopify.page.restored', { shop: entry.shop, handle: saved.handle, from: file })
        return `Restored page "${saved.content.title}". The version it replaced is saved as ${backup}.`
      }),
  )
}
