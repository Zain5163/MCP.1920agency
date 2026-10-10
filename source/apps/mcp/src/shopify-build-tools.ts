import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { ShopifyError, type MenuContent, type MenuItemInput, type ShopifyAdminClient } from '@social-publisher/adapters'
import { productName } from '@social-publisher/config'
import { decide, formatApprovalRequest } from '@social-publisher/core'

import {
  confirmArg,
  hash,
  localShopifyAccess,
  plain,
  saveBackup,
  storeArg,
  withStore,
  type BackupKind,
  type ShopifyAccess,
  auditFor,
} from './shopify-tools.ts'

/**
 * Building a store (phase 2c of docs/architecture/2026-10-08-shopify-connector-plan.md):
 * what a new or rebuilt store needs beyond editing what is there. Products,
 * collections, menus and policies, made visible on the Online Store.
 *
 * Same five steps as every other Shopify write (shopify-tools.ts): read what is
 * there, summary + the owner's approval token, backup, change, read back.
 *
 * Note for readers: shopify-tools.ts imports this file (for restores), so the
 * imports above are only used inside functions, never at load time.
 */

// ------------------------------------------------------------------ menu links

const POLICY_PATHS: Record<string, string> = {
  refund: '/policies/refund-policy',
  shipping: '/policies/shipping-policy',
  privacy: '/policies/privacy-policy',
  terms: '/policies/terms-of-service',
  contact: '/policies/contact-information',
}

export interface MenuLinkTargets {
  collections: Map<string, string>
  pages: Map<string, string>
  products: Map<string, string>
}

/**
 * Turns a short link ("collection:boots", "page:faq", "policy:refund", "home",
 * "/pages/x", "https://…") into a Shopify menu item, or says what is wrong.
 */
export function menuLink(link: string, targets: MenuLinkTargets): Omit<MenuItemInput, 'title' | 'items'> | { error: string } {
  const l = link.trim()
  const lower = l.toLowerCase()
  if (lower === 'home' || l === '/') return { type: 'FRONTPAGE', url: '/' }
  if (lower === 'catalog' || lower === 'all' || l === '/collections/all') return { type: 'CATALOG', url: '/collections/all' }
  if (lower === 'search' || l === '/search') return { type: 'SEARCH', url: '/search' }
  const m = /^(collection|page|product|policy):(.+)$/i.exec(l)
  if (m !== null) {
    const kind = m[1]!.toLowerCase()
    const handle = m[2]!.trim().toLowerCase()
    if (kind === 'policy') {
      const path = POLICY_PATHS[handle]
      return path !== undefined ? { type: 'HTTP', url: path } : { error: `"${l}": policies are ${Object.keys(POLICY_PATHS).map((k) => `policy:${k}`).join(', ')}.` }
    }
    const map = kind === 'collection' ? targets.collections : kind === 'page' ? targets.pages : targets.products
    const id = map.get(handle)
    if (id === undefined) return { error: `"${l}": no ${kind} with the handle "${handle}" on this store.` }
    return { type: kind.toUpperCase(), resourceId: id }
  }
  if (/^https:\/\/[^\s]+$/i.test(l) || /^\/[^\s]*$/.test(l)) return { type: 'HTTP', url: l }
  return { error: `"${l}" is not a link ${productName()} understands. Use home, catalog, search, collection:<handle>, page:<handle>, product:<handle>, policy:<refund|shipping|privacy|terms|contact>, a /path or an https:// address.` }
}

/** A menu as indented text, for summaries. */
export function menuOutline(items: ReadonlyArray<{ title: string; items?: ReadonlyArray<{ title: string }> }>): string {
  if (items.length === 0) return '    (empty)'
  return items.map((i) => `    • ${i.title}${(i.items ?? []).length > 0 ? `\n${(i.items ?? []).map((c) => `        – ${c.title}`).join('\n')}` : ''}`).join('\n')
}

/** A menu read from Shopify, in the shape Shopify accepts back (for restores). */
function menuItemsForSave(items: MenuContent['items']): MenuItemInput[] {
  return items.map((i) => ({
    title: i.title,
    type: i.type,
    ...(i.url !== null ? { url: i.url } : {}),
    ...(i.resourceId !== null ? { resourceId: i.resourceId } : {}),
    ...(i.items !== undefined && i.items.length > 0 ? { items: menuItemsForSave(i.items) } : {}),
  }))
}

const titlesOf = (items: ReadonlyArray<{ title: string; items?: ReadonlyArray<{ title: string }> }>): string =>
  JSON.stringify(items.map((i) => [i.title, (i.items ?? []).map((c) => c.title)]))

// ------------------------------------------------------------------ products

/** Checks a new product's options and variants fit together. Undefined when fine. */
export function productProblem(spec: {
  options: ReadonlyArray<{ name: string; values: readonly string[] }>
  variants: ReadonlyArray<{ options: Record<string, string>; price: number; compareAtPrice?: number | undefined }>
  images: ReadonlyArray<{ url: string }>
}): string | undefined {
  const names = spec.options.map((o) => o.name)
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return 'Two options have the same name.'
  for (const o of spec.options) {
    if (o.values.length === 0) return `Option "${o.name}" has no values.`
    if (new Set(o.values).size !== o.values.length) return `Option "${o.name}" lists a value twice.`
  }
  if (spec.options.length === 0 && spec.variants.length !== 1) return 'A product without options has exactly one variant (its price).'
  const seen = new Set<string>()
  for (const [i, v] of spec.variants.entries()) {
    const keys = Object.keys(v.options)
    if (spec.options.length > 0) {
      if (keys.length !== names.length || !names.every((n) => keys.includes(n))) return `Variant ${i + 1} must give a value for each option (${names.join(', ')}).`
      for (const o of spec.options) {
        if (!o.values.includes(v.options[o.name]!)) return `Variant ${i + 1}: "${v.options[o.name]}" is not one of the ${o.name} values (${o.values.join(', ')}).`
      }
    } else if (keys.length > 0) {
      return 'Variant options were given, but the product declares no options.'
    }
    const combo = names.map((n) => v.options[n]).join(' / ')
    if (seen.has(combo)) return `Two variants are the same combination (${combo}).`
    seen.add(combo)
    if (!(v.price > 0)) return `Variant ${i + 1} needs a price above zero.`
    if (v.compareAtPrice !== undefined && !(v.compareAtPrice > v.price)) return `Variant ${i + 1}: the "was" price must be higher than the price.`
  }
  for (const img of spec.images) if (!/^https:\/\/[^\s]+$/i.test(img.url)) return `Image "${img.url}" is not a public https address.`
  return undefined
}

// ------------------------------------------------------------------ restores

/** Puts back a saved collection, menu or policy (shopify_restore_backup). The current version is saved first. */
export async function restoreBuildBackup(
  client: ShopifyAdminClient,
  dir: string,
  shop: string,
  saved: { kind: BackupKind; handle: string; content: unknown },
): Promise<string> {
  if (saved.kind === 'policy') {
    const c = saved.content as { type: string; body: string }
    const now = (await client.policies()).find((p) => p.type === c.type)
    const backup = saveBackup(dir, shop, 'policy', saved.handle, now ?? { type: c.type, body: '' })
    await client.savePolicy(c.type, c.body)
    return `Restored the ${c.type.replace(/_/g, ' ').toLowerCase()}. The version it replaced is saved as ${backup}.`
  }
  if (saved.kind === 'menu') {
    const c = saved.content as MenuContent
    const now = await client.menu(c.handle)
    if (now === undefined) return `The menu "${c.handle}" no longer exists.`
    const backup = saveBackup(dir, shop, 'menu', c.handle, now)
    await client.saveMenu({ id: now.id, handle: c.handle, title: c.title, items: menuItemsForSave(c.items) })
    return `Restored the menu "${c.title}". The version it replaced is saved as ${backup}.`
  }
  if (saved.kind === 'collection') {
    const c = saved.content as { handle: string; title: string; descriptionHtml: string; sortOrder: string; ruleSet: unknown; products: string[] }
    const now = await client.collectionContent(c.handle)
    if (now === undefined) return `The collection "${c.handle}" no longer exists.`
    const backup = saveBackup(dir, shop, 'collection', c.handle, now)
    await client.updateCollection(now.id, { title: c.title, descriptionHtml: c.descriptionHtml, sortOrder: c.sortOrder })
    if (now.ruleSet === null) await syncMembers(client, now.id, now.products, c.products)
    return `Restored the collection "${c.title}". The version it replaced is saved as ${backup}.`
  }
  return `Backups of kind "${saved.kind}" are restored by shopify_restore_backup directly.`
}

/** Makes a hand-picked collection hold exactly `wanted` (product handles). */
async function syncMembers(client: ShopifyAdminClient, collectionId: string, current: readonly string[], wanted: readonly string[]): Promise<void> {
  const add = wanted.filter((h) => !current.includes(h))
  const remove = current.filter((h) => !wanted.includes(h))
  const ids = await client.productIds([...add, ...remove])
  for (const h of add) if (ids.has(h)) await client.setProductCollections(ids.get(h)!, [collectionId], [])
  for (const h of remove) if (ids.has(h)) await client.setProductCollections(ids.get(h)!, [], [collectionId])
}

/** Online Store publishing needs read/write_publications; older installs may not have granted them yet. */
async function publish(client: ShopifyAdminClient, id: string): Promise<string | undefined> {
  try {
    await client.publishToOnlineStore(id)
    return undefined
  } catch (error) {
    if (error instanceof ShopifyError && error.kind === 'access') {
      return 'Not yet on the Online Store: the store has not granted the publications permission. Approve the app update in the store admin, or tick "Online Store" on it in the admin.'
    }
    throw error
  }
}

// ------------------------------------------------------------------ tools

export function registerShopifyBuildTools(server: McpServer, access: ShopifyAccess = localShopifyAccess): void {
  server.tool(
    'shopify_create_product',
    'Create a product: title, description, options such as Size and Colour, one variant per combination with its price (and "was" price), photos from public image URLs, collections. Created hidden (draft) unless visible is true. Stock is not tracked; the owner sets quantities in the admin. Needs the owner’s approval, then reads it back.',
    {
      store: storeArg,
      title: z.string().min(1).max(255),
      descriptionHtml: z.string().min(1),
      handle: z.string().regex(/^[a-z0-9-]+$/).optional().describe('URL handle; default from the title.'),
      productType: z.string().optional(),
      vendor: z.string().optional(),
      tags: z.array(z.string()).max(50).optional(),
      options: z.array(z.object({ name: z.string().min(1), values: z.array(z.string().min(1)).min(1).max(100) })).max(3).default([]),
      variants: z
        .array(
          z.object({
            options: z.record(z.string(), z.string()).default({}).describe('Option name → value, e.g. {"Size": "42"}. Empty when the product has no options.'),
            price: z.number().positive(),
            compareAtPrice: z.number().positive().optional().describe('The "was" price shown crossed out. Only a real earlier price.'),
            sku: z.string().optional(),
            cost: z.number().nonnegative().optional().describe('Cost per item, for margin checks. Never shown to customers.'),
          }),
        )
        .min(1)
        .max(250),
      images: z.array(z.object({ url: z.string(), alt: z.string().optional() })).max(20).default([]),
      collections: z.array(z.string()).optional().describe('Handles of hand-picked collections to add it to.'),
      visible: z.boolean().default(false).describe('true: ACTIVE and on the Online Store at once. Default false: hidden draft.'),
      seoTitle: z.string().max(70).optional(),
      seoDescription: z.string().max(320).optional(),
      confirm: confirmArg,
    },
    async ({ store, confirm, collections, visible, ...spec }) =>
      await withStore(access, store, async (client, entry) => {
        const problem = productProblem(spec)
        if (problem !== undefined) return `Not created: ${problem}`
        if (spec.handle !== undefined && (await client.productContent(spec.handle)) !== undefined) {
          return `A product with the handle "${spec.handle}" already exists. Change it with shopify_update_product, or choose another handle.`
        }
        const collectionIds: string[] = []
        for (const h of collections ?? []) {
          const c = await client.collectionContent(h)
          if (c === undefined) return `No collection "${h}". Create it with shopify_save_collection first.`
          if (c.ruleSet !== null) return `"${h}" is an automated collection: Shopify adds products to it by its rules (tags, type…), not by hand.`
          collectionIds.push(c.id)
        }
        const o = await client.overview()
        const prices = spec.variants.map((v) => v.price)
        const lines = [
          `Create product "${spec.title}" on ${entry.name}${spec.handle !== undefined ? ` (/products/${spec.handle})` : ''}:`,
          `  ${spec.options.length > 0 ? spec.options.map((x) => `${x.name}: ${x.values.join(', ')}`).join(' · ') : 'no options'}`,
          `  ${spec.variants.length} variant(s), price ${o.currency} ${Math.min(...prices)}${Math.max(...prices) !== Math.min(...prices) ? `–${Math.max(...prices)}` : ''}` +
            (spec.variants.some((v) => v.compareAtPrice !== undefined) ? ' (with a crossed-out "was" price)' : ''),
          `  ${spec.images.length} photo(s)${collections !== undefined && collections.length > 0 ? ` · collections: ${collections.join(', ')}` : ''}${spec.tags !== undefined ? ` · tags: ${spec.tags.join(', ')}` : ''}`,
          `  description: ${plain(spec.descriptionHtml)}`,
          `  ${visible ? 'VISIBLE: customers can see and buy it at once' : 'hidden draft: customers do not see it until it is made ACTIVE'}`,
          '',
          'Stock is not tracked (it never shows as sold out); set quantities in the Shopify admin if needed.',
        ]
        const gate = decide({
          action: 'shopify_create_product',
          payload: { shop: entry.shop, spec: hash(spec), collections: collections ?? [], visible },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)

        const created = await client.createProduct({ ...spec, status: visible ? 'ACTIVE' : 'DRAFT', collectionIds })
        await auditFor(access, 'shopify.product.created', { shop: entry.shop, id: created.id, handle: created.handle })
        const notOnline = await publish(client, created.id)
        const back = await client.productContent(created.handle)
        const ok = back !== undefined && back.title === spec.title && back.status === (visible ? 'ACTIVE' : 'DRAFT') && created.variantsCount.count === spec.variants.length
        return [
          ok
            ? `Done, and read back from Shopify: "${created.title}" (/products/${created.handle}) is ${created.status.toLowerCase()} with ${created.variantsCount.count} variant(s).`
            : `Created "${created.title}" (/products/${created.handle}), but the read-back does not match what was approved (status ${back?.status ?? 'unknown'}, ${created.variantsCount.count} variant(s)). Check it in the admin.`,
          spec.images.length > 0 ? `Photos: ${created.mediaCount.count} of ${spec.images.length} attached so far (Shopify downloads them in the background; check again in a minute with shopify_products).` : '',
          notOnline ?? 'Available on the Online Store sales channel.',
          'To undo: shopify_update_product with status ARCHIVED.',
        ]
          .filter((l) => l !== '')
          .join('\n')
      }),
  )

  server.tool(
    'shopify_save_collection',
    'Create or update a hand-picked collection (e.g. "Boots", "Best sellers"): title, description, sort order, and exactly which products it holds (by handle). publish: true puts it on the Online Store. Needs the owner’s approval; the current version is saved first; then read back.',
    {
      store: storeArg,
      handle: z.string().regex(/^[a-z0-9-]+$/).describe('URL handle, e.g. "boots".'),
      title: z.string().min(1),
      descriptionHtml: z.string().default(''),
      products: z.array(z.string()).max(250).optional().describe('Product handles it should hold, exactly. Leave out to keep the current products.'),
      sortOrder: z.enum(['MANUAL', 'BEST_SELLING', 'ALPHA_ASC', 'ALPHA_DESC', 'PRICE_ASC', 'PRICE_DESC', 'CREATED', 'CREATED_DESC']).default('BEST_SELLING'),
      publish: z.boolean().default(false).describe('Put it on the Online Store. false leaves its visibility as it is.'),
      confirm: confirmArg,
    },
    async ({ store, handle, title, descriptionHtml, products, sortOrder, publish: doPublish, confirm }) =>
      await withStore(access, store, async (client, entry) => {
        const before = await client.collectionContent(handle)
        if (before !== undefined && before.ruleSet !== null && products !== undefined) {
          return `"${handle}" is an automated collection: Shopify picks its products by rules. Change its title or description only, or make a hand-picked one.`
        }
        if (products !== undefined) {
          const ids = await client.productIds(products)
          const missing = products.filter((h) => !ids.has(h))
          if (missing.length > 0) return `No product with the handle(s): ${missing.join(', ')}. Use shopify_products to find them.`
        }
        const current = before?.products ?? []
        const wanted = products ?? current
        const adding = wanted.filter((h) => !current.includes(h))
        const removing = current.filter((h) => !wanted.includes(h))
        const lines = [
          before === undefined ? `Create collection "${title}" (/collections/${handle}) on ${entry.name}:` : `Update collection "${before.title}" (/collections/${handle}) on ${entry.name}:`,
          ...(before !== undefined && before.title !== title ? [`  title: "${before.title}" → "${title}"`] : []),
          `  description: ${plain(descriptionHtml)}`,
          `  sort: ${sortOrder} · products: ${wanted.length}${adding.length > 0 ? ` (adding ${adding.join(', ')})` : ''}${removing.length > 0 ? ` (removing ${removing.join(', ')})` : ''}`,
          `  ${doPublish ? 'on the Online Store: customers can browse it' : before === undefined ? 'not on the Online Store yet (hidden)' : 'visibility unchanged'}`,
        ]
        const gate = decide({
          action: 'shopify_save_collection',
          payload: { shop: entry.shop, handle, title, description: hash(descriptionHtml), products: [...wanted].sort(), sortOrder, publish: doPublish, current: before === undefined ? null : hash(before) },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)

        let backup: string | undefined
        let id: string
        if (before !== undefined) {
          backup = saveBackup(access.backupDir(entry), entry.shop, 'collection', handle, before)
          await client.updateCollection(before.id, { title, descriptionHtml, sortOrder })
          id = before.id
        } else {
          id = (await client.createCollection({ title, handle, descriptionHtml, sortOrder })).id
        }
        await syncMembers(client, id, current, wanted)
        const notOnline = doPublish ? await publish(client, id) : undefined
        const after = await client.collectionContent(handle)
        const ok = after !== undefined && after.title === title && [...after.products].sort().join() === [...wanted].sort().join()
        await auditFor(access, 'shopify.collection.saved', { shop: entry.shop, handle, created: before === undefined })
        return [
          ok ? `Done, and read back from Shopify: /collections/${handle} is "${title}" with ${after!.products.length} product(s).` : 'Saved, but the read-back does not match what was approved. Check the collection now.',
          ...(notOnline !== undefined ? [notOnline] : doPublish ? ['On the Online Store.'] : []),
          ...(backup !== undefined ? [`Previous version saved: ${backup}.`] : []),
        ].join('\n')
      }),
  )

  const linkItem = z.object({ title: z.string().min(1), link: z.string().min(1) })
  server.tool(
    'shopify_save_menu',
    'Replace a navigation menu (main-menu for the header, footer for the footer) with the given items, one level of sub-items allowed. Links: home, catalog, search, collection:<handle>, page:<handle>, product:<handle>, policy:<refund|shipping|privacy|terms|contact>, a /path, or an https:// address. Needs the owner’s approval; the current menu is saved first; then read back.',
    {
      store: storeArg,
      handle: z.string().regex(/^[a-z0-9-]+$/).describe('"main-menu", "footer", or a new menu handle.'),
      title: z.string().optional().describe('Menu name in the admin; default keeps the current one.'),
      items: z.array(linkItem.extend({ items: z.array(linkItem).max(30).optional() })).min(1).max(30),
      confirm: confirmArg,
    },
    async ({ store, handle, title, items, confirm }) =>
      await withStore(access, store, async (client, entry) => {
        const before = await client.menu(handle)
        const links = await client.linkTargets()
        const productHandles = [...items, ...items.flatMap((i) => i.items ?? [])]
          .map((i) => /^product:(.+)$/i.exec(i.link.trim())?.[1]?.trim().toLowerCase())
          .filter((h): h is string => h !== undefined)
        const targets: MenuLinkTargets = { ...links, products: await client.productIds(productHandles) }
        const resolve = (i: { title: string; link: string }): MenuItemInput | { error: string } => {
          const r = menuLink(i.link, targets)
          return 'error' in r ? r : { title: i.title, ...r }
        }
        const built: MenuItemInput[] = []
        for (const i of items) {
          const top = resolve(i)
          if ('error' in top) return `Not saved: ${top.error}`
          const children: MenuItemInput[] = []
          for (const c of i.items ?? []) {
            const child = resolve(c)
            if ('error' in child) return `Not saved: ${child.error}`
            children.push(child)
          }
          built.push(children.length > 0 ? { ...top, items: children } : top)
        }
        const name = title ?? before?.title ?? handle
        const lines = [
          before === undefined ? `Create menu "${name}" (${handle}) on ${entry.name}:` : `Replace menu "${before.title}" (${handle}) on ${entry.name}.`,
          ...(before !== undefined ? ['  now:', menuOutline(before.items)] : []),
          '  new:',
          menuOutline(items),
          '',
          'Customers see the new menu at once. The current menu is saved first and can be restored.',
        ]
        const gate = decide({
          action: 'shopify_save_menu',
          payload: { shop: entry.shop, handle, title: name, items: built, current: before === undefined ? null : hash(before) },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)

        const backup = before !== undefined ? saveBackup(access.backupDir(entry), entry.shop, 'menu', handle, before) : undefined
        await client.saveMenu({ ...(before !== undefined ? { id: before.id } : {}), handle, title: name, items: built })
        const after = await client.menu(handle)
        const ok = after !== undefined && titlesOf(after.items) === titlesOf(items)
        await auditFor(access, 'shopify.menu.saved', { shop: entry.shop, handle, created: before === undefined })
        return [
          ok ? `Done, and read back from Shopify: the "${name}" menu holds the approved ${items.length} item(s).` : 'Saved, but the read-back does not match what was approved. Check the menu now.',
          ...(backup !== undefined ? [`Previous version saved: ${backup}.`] : []),
        ].join('\n')
      }),
  )

  const POLICY_TYPES = {
    refund: 'REFUND_POLICY',
    shipping: 'SHIPPING_POLICY',
    privacy: 'PRIVACY_POLICY',
    terms: 'TERMS_OF_SERVICE',
    terms_of_sale: 'TERMS_OF_SALE',
    contact: 'CONTACT_INFORMATION',
    legal_notice: 'LEGAL_NOTICE',
  } as const
  server.tool(
    'shopify_save_policy',
    'Write a store policy shown at checkout and in the footer: refund (returns and exchanges), shipping (delivery times, costs, cash on delivery), privacy, terms, contact. Policies are promises to customers: use only terms the owner has confirmed. Needs the owner’s approval; the current text is saved first; then read back.',
    {
      store: storeArg,
      type: z.enum(['refund', 'shipping', 'privacy', 'terms', 'terms_of_sale', 'contact', 'legal_notice']),
      bodyHtml: z.string().min(1),
      confirm: confirmArg,
    },
    async ({ store, type, bodyHtml, confirm }) =>
      await withStore(access, store, async (client, entry) => {
        const shopifyType = POLICY_TYPES[type]
        const before = (await client.policies()).find((p) => p.type === shopifyType)
        const lines = [
          `${before !== undefined && before.body.trim() !== '' ? 'Replace' : 'Publish'} the ${type.replace(/_/g, ' ')} policy on ${entry.name}:`,
          ...(before !== undefined && before.body.trim() !== '' ? [`  now: ${plain(before.body)}`] : []),
          `  new: ${plain(bodyHtml, 600)}`,
          '',
          'Customers see it at checkout and in the footer at once. Check every term (times, costs, return window) matches how the business really works.',
        ]
        const gate = decide({
          action: 'shopify_save_policy',
          payload: { shop: entry.shop, type: shopifyType, body: hash(bodyHtml), current: before === undefined ? null : hash(before.body) },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)

        const backup = saveBackup(access.backupDir(entry), entry.shop, 'policy', type, before ?? { type: shopifyType, body: '' })
        await client.savePolicy(shopifyType, bodyHtml)
        const after = (await client.policies()).find((p) => p.type === shopifyType)
        const ok = after !== undefined && plain(after.body, 100_000) === plain(bodyHtml, 100_000)
        await auditFor(access, 'shopify.policy.saved', { shop: entry.shop, type: shopifyType })
        return [
          ok ? `Done, and read back from Shopify: the ${type.replace(/_/g, ' ')} policy holds the approved text${after?.url ? ` (${after.url})` : ''}.` : 'Saved, but the read-back does not match what was approved. Check the policy now.',
          `Previous version saved: ${backup}.`,
        ].join('\n')
      }),
  )
}
