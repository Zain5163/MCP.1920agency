import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  SafeHttpError,
  WordPressClient,
  WordPressError,
  normaliseSiteUrl,
  type ContentChange,
  type ContentItem,
  type ContentType,
  type WooProduct,
  type WooProductChange,
} from '@social-publisher/adapters'
import { productName } from '@social-publisher/config'
import { decide, formatApprovalRequest } from '@social-publisher/core'

import { SEVERITY_ORDER, contentFindings, homepageFindings, pluginFindings, wooFindings, type Finding } from './wordpress-audit.ts'
import type { WordPressAccess, WordPressSite } from './wordpress-access.ts'

/**
 * WordPress and WooCommerce tools, on both transports
 * (research/2026-10-08-wordpress-connector.md).
 *
 * Reads need no approval. Every change follows the same steps as the Shopify
 * connector, in code, whatever the AI asks:
 *   1. read what is there now;
 *   2. show the user an exact summary and wait for the approval token (the
 *      token covers the change AND a fingerprint of what is there now, so if
 *      the site changed in between, the approval no longer matches);
 *   3. save the current version (our own backup file; WordPress revisions may be
 *      turned off on a site, so they are a second source, never the only one);
 *   4. make the change;
 *   5. read it back and say whether the site now holds exactly what was approved.
 *
 * New pages and posts are always created as drafts. Making one public is its
 * own approved step (wordpress_publish_content), so "write it" and "show it to
 * the world" are two decisions, as they are for a person in wp-admin.
 */

type ToolResult = { content: Array<{ type: 'text'; text: string }> }
const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })

const siteArg = z.string().describe('Which site: its address or name, from list_wordpress_sites.')
const typeArg = z.enum(['page', 'post']).describe('page or post.')
const confirmArg = z.string().optional().describe('The approval token from the summary, once the user has said yes. Never invent one.')

const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 16)
const plain = (html: string, max = 280) => {
  const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t || '(empty)'
}
const same = (a: string, b: string) => a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim()
const STATUS_WORDS: Record<string, string> = {
  publish: 'published (public)',
  draft: 'draft (not public)',
  pending: 'pending review (not public)',
  private: 'private (only logged-in editors)',
  future: 'scheduled',
}
const statusWords = (s: string) => STATUS_WORDS[s] ?? s

/** Never lets a raw exception, or anything with a login in it, reach the chat. */
async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await fn())
  } catch (error) {
    if (error instanceof WordPressError || error instanceof SafeHttpError) return text(`FAILED: ${error.message}`)
    return text(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function withSite(
  access: WordPressAccess,
  selector: string,
  fn: (client: WordPressClient, site: WordPressSite) => Promise<string>,
): Promise<ToolResult> {
  return await run(async () => {
    const opened = await access.open(selector)
    if ('error' in opened) return opened.error
    try {
      return `Site: ${opened.site.name} (${opened.site.url})\n\n${await fn(opened.client, opened.site)}`
    } catch (error) {
      if (error instanceof WordPressError) return `Could not complete this on ${opened.site.name}: ${error.message}`
      throw error
    }
  })
}

// ------------------------------------------------------------------ backups

export type BackupKind = 'page' | 'post' | 'product' | 'variation'

export interface Backup {
  readonly kind: BackupKind
  readonly id: number
  readonly productId?: number
  readonly site: string
  readonly savedAt: string
  readonly content: Record<string, unknown>
}

export function saveBackup(dir: string, backup: Omit<Backup, 'savedAt'>): string {
  mkdirSync(dir, { recursive: true })
  const savedAt = new Date().toISOString()
  const file = `${savedAt.replace(/[:.]/g, '-')}-${backup.kind}-${backup.productId !== undefined ? `${backup.productId}-` : ''}${backup.id}.json`
  writeFileSync(join(dir, file), JSON.stringify({ ...backup, savedAt }, null, 2))
  return file
}

const contentBackup = (item: ContentItem) => ({ title: item.title, content: item.content, excerpt: item.excerpt, slug: item.slug, status: item.status, modified: item.modified })
const productBackup = (p: WooProduct) => ({
  name: p.name,
  description: p.description,
  short_description: p.shortDescription,
  regular_price: p.regularPrice,
  sale_price: p.salePrice,
  date_on_sale_from: p.dateOnSaleFrom,
  date_on_sale_to: p.dateOnSaleTo,
})

// ------------------------------------------------------------------ media checks

const IMAGE_TYPES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'image/avif', ext: 'avif', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /^avi[fs]$/.test(b.subarray(8, 12).toString('latin1')) },
]
export const MAX_MEDIA_BYTES = 10 * 1_048_576

/**
 * What an uploaded file really is, from its first bytes, not from its name or
 * the header the other server sent. SVG is refused: it can carry scripts, and
 * WordPress itself refuses it without a plugin.
 */
export function sniffImage(bytes: Buffer): { mime: string; ext: string } | undefined {
  const hit = IMAGE_TYPES.find((t) => t.test(bytes))
  return hit === undefined ? undefined : { mime: hit.mime, ext: hit.ext }
}

// ------------------------------------------------------------------ registration

export function registerWordPressTools(server: McpServer, access: WordPressAccess): void {
  // ---------------------------------------------------------------- connect

  server.tool(
    'wordpress_connect_site',
    `Connect a self-hosted WordPress site (with or without WooCommerce) so ${productName()} can read it and, with the user's approval for each change, improve it. ` +
      'Needs the site address, the WordPress username and an APPLICATION PASSWORD — never the password the user logs in with. ' +
      `Before calling, tell the user how to make one: in WordPress go to Users > Profile (as the user ${productName()} should act as; an Editor can change pages and posts, ` +
      `an Administrator or Shop Manager is needed for plugins, settings and products), scroll to "Application Passwords", type "${productName()}", click ` +
      '"Add New Application Password" and copy the password shown (it is shown once). It can be revoked there at any time. The site must use https://. ' +
      'The password is stored encrypted for this account only and is never shown again. WordPress.com-hosted sites are not supported yet.',
    {
      siteUrl: z.string().describe('The site address, e.g. "https://www.example.com".'),
      username: z.string().min(1).describe('The WordPress login name (Users > Profile > Username) or the account email.'),
      applicationPassword: z.string().min(16).describe('The Application Password from Users > Profile (24 characters, spaces optional).'),
    },
    async ({ siteUrl, username, applicationPassword }) =>
      await run(async () => {
        const url = normaliseSiteUrl(siteUrl)
        if (typeof url !== 'string') return `Not connected. ${url.error}`
        const password = applicationPassword.replace(/\s+/g, '')
        if (!/^[A-Za-z0-9]{24}$/.test(password)) {
          return (
            'Not connected. That does not look like a WordPress Application Password (24 letters and numbers, shown in groups of four). ' +
            `Do not use the password you log in with. In WordPress: Users > Profile > Application Passwords > type "${productName()}" > Add New Application Password, then copy what it shows.`
          )
        }
        const anonymous = new WordPressClient({ siteUrl: url, fetch: access.fetch })
        const index = await anonymous.discover()
        const client = new WordPressClient({ siteUrl: url, restMode: index.restMode, fetch: access.fetch, login: async () => ({ username: username.trim(), password }) })
        let me
        try {
          me = await client.me()
        } catch (error) {
          if (error instanceof WordPressError && error.kind === 'auth' && !index.applicationPasswords) {
            return (
              `Not connected. ${url} does not offer Application Passwords, so no app can log in to it. Usual causes: a security plugin turned them off ` +
              '(Wordfence does this by default: Wordfence > All Options > Brute Force Protection > untick "Disable WordPress application passwords"; other security plugins have similar switches), ' +
              'the site does not see itself as HTTPS (behind some proxies or CDNs), or WordPress is older than 5.6. ' +
              'When they are available, Users > Profile shows an "Application Passwords" section.'
            )
          }
          if (error instanceof WordPressError && error.code === 'rest_not_logged_in') {
            // Confirm a stripped Authorization header: with a deliberately wrong password,
            // a site that receives the header answers "incorrect_password"; one that
            // strips it still answers "not logged in".
            const probe = new WordPressClient({ siteUrl: url, restMode: index.restMode, fetch: access.fetch, login: async () => ({ username: username.trim(), password: 'adspilotheadercheck00000' }) })
            const stripped = await probe.me().then(
              () => false,
              (e: unknown) => e instanceof WordPressError && e.code === 'rest_not_logged_in',
            )
            if (stripped) return `Not connected. ${error.message}`
          }
          throw error
        }
        const can = (cap: string) => me.capabilities[cap] === true
        if (!can('edit_posts') && !can('edit_pages')) {
          return `Not connected. The user "${me.username}" (${me.roles.join(', ') || 'no role'}) cannot edit pages or posts, so ${productName()} could do nothing useful with it. Create the Application Password as an Editor or Administrator instead.`
        }
        const woo = index.namespaces.includes('wc/v3')
        const name = index.name.trim() || url.replace(/^https:\/\//, '')
        await access.save({ name, url, roles: me.roles, restMode: index.restMode, woo }, { username: username.trim(), password })
        await access.record('wordpress.site.connected', { site: url, roles: me.roles, woo })
        const abilities = [
          `pages: ${can('edit_pages') ? (can('publish_pages') ? 'read, change and publish' : 'read and change (not publish)') : 'no'}`,
          `posts: ${can('edit_posts') ? (can('publish_posts') ? 'read, change and publish' : 'read and change (not publish)') : 'no'}`,
          `media uploads: ${can('upload_files') ? 'yes' : 'no'}`,
          `plugins and settings (for the audit): ${can('activate_plugins') && can('manage_options') ? 'readable' : 'not readable with this role'}`,
          ...(woo ? [`WooCommerce products: ${can('edit_products') || can('manage_woocommerce') ? 'read and change' : 'not with this role (needs Shop Manager or Administrator)'}`] : []),
        ]
        return [
          `Connected ${name} (${url}) as a WordPress ${me.roles.join(', ') || 'user'}.`,
          ...abilities.map((a) => `  ${a}`),
          index.restMode === 'query' ? `  (The site uses plain permalinks; ${productName()} reaches the API through ?rest_route=.)` : '',
          '',
          'Nothing changes on the site without the user\'s approval in this chat. The Application Password is stored encrypted for this account only.',
          'To revoke access at any time: WordPress > Users > Profile > Application Passwords > Revoke, or wordpress_disconnect_site.',
          'Next: wordpress_site_overview or wordpress_site_audit.',
        ]
          .filter((l) => l !== '')
          .join('\n')
      }),
  )

  server.tool(
    'wordpress_disconnect_site',
    `Disconnect a WordPress site: ${productName()} revokes its Application Password on the site (when the site allows it) and deletes the stored copy at once. If revoking on the site fails, the result says so and how to revoke it in WordPress.`,
    { site: siteArg },
    async ({ site }) =>
      await run(async () => {
        // Revoke the password on the site itself first (best effort), while AdsPilot still holds it.
        let revoked = false
        const opened = await access.open(site)
        if (!('error' in opened)) revoked = await opened.client.revokeOwnPassword().then(() => true, () => false)
        const gone = await access.disconnect(site)
        if ('error' in gone) return gone.error
        await access.record('wordpress.site.disconnected', { site: gone.url, revokedOnSite: revoked })
        return revoked
          ? `${gone.name} (${gone.url}) is disconnected: the Application Password was revoked on the site and deleted from ${productName()}.`
          : `${gone.name} (${gone.url}) is disconnected and its stored password deleted from ${productName()}. ${productName()} could not revoke it on the site, so do that too: WordPress > Users > Profile > Application Passwords > Revoke "${productName()}".`
      }),
  )

  server.tool(
    'list_wordpress_sites',
    `List the WordPress sites connected to this account, with the role ${productName()} acts as and whether WooCommerce is active. Pass one as \`site\` to the other wordpress_ and woocommerce_ tools. Reads only.`,
    {},
    async () =>
      await run(async () => {
        const sites = await access.list()
        if (sites.length === 0) return 'No WordPress site connected yet. Use wordpress_connect_site with the site address, username and an Application Password.'
        return ['Connected WordPress sites:', ...sites.map((s) => `  ${s.name}  (site: "${s.key}")  ${s.url}  as ${s.roles.join(', ') || 'unknown role'}${s.woo ? '  WooCommerce' : ''}`)].join('\n')
      }),
  )

  // ---------------------------------------------------------------- reads

  server.tool(
    'wordpress_site_overview',
    'A WordPress site at a glance: name, tagline, addresses, WordPress version (when the site shows it), active theme, plugins (administrators only), permalinks, counts of pages and posts, and WooCommerce currency and tax display when active. Reads only.',
    { site: siteArg },
    async ({ site }) =>
      await withSite(access, site, async (client, entry) => {
        const index = await client.index()
        const optionalRead = async <T>(fn: () => Promise<T>): Promise<T | string> => {
          try {
            return await fn()
          } catch (error) {
            if (error instanceof WordPressError && (error.kind === 'forbidden' || error.kind === 'not_found' || error.kind === 'auth')) return 'not readable with this role'
            throw error
          }
        }
        const theme = await optionalRead(() => client.activeTheme())
        const plugins = await optionalRead(() => client.plugins())
        const pages = await client.list('page', { perPage: 1 })
        const posts = await client.list('post', { perPage: 1 })
        const home = await optionalRead(() => client.homepage())
        const generator = typeof home === 'string' ? undefined : homepageFindings(home).facts.generator
        const woo = index.namespaces.includes('wc/v3')
        const lines = [
          `${index.name || '(no title)'} — "${index.description || 'no tagline'}"`,
          `Site address: ${index.home || entry.url}. WordPress address: ${index.url || entry.url}.`,
          `WordPress version: ${generator?.match(/WordPress\s+([\d.]+)/i)?.[1] ?? 'not shown (many sites hide it; check Dashboard > Updates)'}.`,
          `Theme: ${typeof theme === 'string' ? theme : theme === undefined ? 'unknown' : `${theme.name} ${theme.version}${theme.blockTheme === true ? ' (block theme)' : theme.blockTheme === false ? ' (classic theme)' : ''}`}.`,
          `Permalinks: ${entry.restMode === 'query' ? 'plain (?p=123) — change to "Post name" in Settings > Permalinks' : 'pretty (readable addresses)'}.`,
          `Pages: ${pages.total}. Posts: ${posts.total}.`,
          `${productName()} acts as: ${entry.roles.join(', ') || 'unknown role'}.`,
        ]
        if (typeof plugins === 'string') lines.push(`Plugins: ${plugins} (needs an Administrator).`)
        else {
          const active = plugins.filter((p) => p.status.startsWith('active') || p.status === 'network-active')
          lines.push(`Plugins: ${active.length} active, ${plugins.length - active.length} inactive. Active: ${active.map((p) => `${p.name} ${p.version}`).join(', ') || 'none'}.`)
        }
        if (woo) {
          const currency = await client.wooSetting('general', 'woocommerce_currency')
          const incl = await client.wooSetting('tax', 'woocommerce_prices_include_tax')
          const calc = await client.wooSetting('general', 'woocommerce_calc_taxes')
          lines.push(
            `WooCommerce: active. Currency: ${currency ?? 'not readable with this role'}. Taxes: ${calc === undefined ? 'not readable' : calc === 'yes' ? 'on' : 'off'}; prices entered ${incl === undefined ? '(not readable)' : incl === 'yes' ? 'including tax' : 'excluding tax'}.`,
          )
        } else lines.push('WooCommerce: not active.')
        return lines.join('\n')
      }),
  )

  server.tool(
    'wordpress_list_content',
    'List pages or posts on a WordPress site, most recently changed first: id, title, status (published, draft, private, scheduled), address. Use the id with wordpress_read_content or the change tools. Reads only.',
    {
      site: siteArg,
      type: typeArg,
      status: z.enum(['any', 'publish', 'draft', 'pending', 'private', 'future']).default('any'),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(30),
    },
    async ({ site, type, status, search, limit }) =>
      await withSite(access, site, async (client) => {
        const { items, total } = await client.list(type, { ...(status !== 'any' ? { status } : {}), ...(search !== undefined ? { search } : {}), perPage: limit })
        if (items.length === 0) return `No ${type}s match.`
        return [
          `${items.length} of ${total} ${type}(s):`,
          ...items.map((p) => `• [${p.id}] ${p.title || '(no title)'} — ${statusWords(p.status)} — /${p.slug} — changed ${p.modified.slice(0, 10)}${p.status === 'publish' ? `\n  ${p.link}` : ''}`),
        ].join('\n')
      }),
  )

  server.tool(
    'wordpress_read_content',
    'Read one page or post in full: title, status, address, excerpt and the content as stored (block editor HTML). Use before proposing a change. Reads only.',
    { site: siteArg, type: typeArg, id: z.number().int().positive(), maxChars: z.number().int().min(500).max(100_000).default(20_000) },
    async ({ site, type, id, maxChars }) =>
      await withSite(access, site, async (client) => {
        const item = await client.get(type, id)
        const body = item.content.length > maxChars ? `${item.content.slice(0, maxChars)}\n… (${item.content.length - maxChars} more characters; raise maxChars to see them)` : item.content
        return [
          `${type} ${item.id}: "${item.title}" — ${statusWords(item.status)} — /${item.slug}`,
          `Address: ${item.link}. Last changed: ${item.modified}.${item.template ? ` Template: ${item.template}.` : ''}`,
          `Excerpt: ${item.excerpt.trim() || '(none)'}`,
          '',
          'Content:',
          body || '(empty)',
        ].join('\n')
      }),
  )

  server.tool(
    'wordpress_site_audit',
    'Audit a WordPress site for conversion, speed, SEO and trust basics from what the site really returns: home page title, description, headings, mobile viewport, images without alt text, scripts and caching signs; tagline, permalinks, missing contact/privacy/returns/FAQ pages; inactive or duplicate plugins (administrators); WooCommerce products without photos or descriptions. Facts and findings only, no invented score. Then read get_skill wordpress-site-builder, cro, seo-audit and core-web-vitals to turn them into fixes. Reads only.',
    { site: siteArg },
    async ({ site }) =>
      await withSite(access, site, async (client, entry) => {
        const index = await client.index()
        const woo = index.namespaces.includes('wc/v3')
        const findings: Finding[] = []
        const notes: string[] = []
        const pages = (await client.list('page', { perPage: 100, status: 'publish,draft,private' })).items
        const posts = (await client.list('post', { perPage: 20 })).items
        findings.push(...contentFindings({ index, restMode: entry.restMode, pages, posts, woo }))
        let home: ReturnType<typeof homepageFindings> | undefined
        try {
          home = homepageFindings(await client.homepage())
          findings.push(...home.findings)
        } catch (error) {
          if (!(error instanceof WordPressError)) throw error
          notes.push(`Home page not checked: ${error.message}`)
        }
        try {
          findings.push(...pluginFindings(await client.plugins()))
        } catch (error) {
          if (!(error instanceof WordPressError)) throw error
          notes.push('Plugins not checked: the plugin list needs an Administrator.')
        }
        let wooLine = ''
        if (woo) {
          try {
            const products = await client.wooProducts({ perPage: 100 })
            findings.push(...wooFindings(products))
            const incl = await client.wooSetting('tax', 'woocommerce_prices_include_tax')
            const currency = await client.wooSetting('general', 'woocommerce_currency')
            wooLine = `WooCommerce: ${products.length} product(s) checked (first 100). Currency ${currency ?? 'unknown'}; prices entered ${incl === undefined ? '(tax setting not readable)' : incl === 'yes' ? 'including tax' : 'excluding tax'}. Whether that is right depends on the market: get_skill selling-by-country.`
          } catch (error) {
            if (!(error instanceof WordPressError)) throw error
            notes.push(`WooCommerce not checked: ${error.message}`)
          }
        }
        findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
        return [
          `${index.name || entry.url}: ${pages.filter((p) => p.status === 'publish').length} published page(s), ${pages.filter((p) => p.status !== 'publish').length} draft or private.`,
          home !== undefined ? `Home page: title "${home.facts.title ?? ''}"; ${home.facts.scripts} scripts, ${home.facts.styles} stylesheets.` : '',
          wooLine,
          '',
          findings.length > 0 ? `${findings.length} finding(s):` : `No problems found in what ${productName()} can read.`,
          ...findings.map((f) => `  [${f.severity}] ${f.area}: ${f.finding}`),
          ...(notes.length > 0 ? ['', ...notes] : []),
          '',
          'Not checked by this audit: real page speed (run PageSpeed Insights on the live page, mobile), the checkout flow, forms, the pixel and consent banner (check_ad_setup and the market rules in selling-by-country), and the content\'s quality. ' +
            'Read get_skill wordpress-site-builder, cro, copywriting and seo-audit before proposing fixes. Every change to the site needs the user\'s approval.',
        ]
          .filter((l, i, all) => l !== '' || (all[i - 1] ?? '') !== '')
          .join('\n')
      }),
  )

  // ---------------------------------------------------------------- writes: pages and posts

  server.tool(
    'wordpress_save_content',
    'Create or change a WordPress page or post: title, content (block editor HTML), excerpt (the summary many themes and SEO plugins use as the description), address slug. New ones are always saved as DRAFTS; publishing is a separate approved step (wordpress_publish_content). Changing a page that is already published changes it for visitors at once. Shows the exact change for the user\'s approval, saves the current version first, then reads it back.',
    {
      site: siteArg,
      type: typeArg,
      id: z.number().int().positive().optional().describe('The page or post to change. Omit to create a new draft.'),
      title: z.string().min(1).max(300).optional(),
      content: z.string().optional().describe('The full new content (replaces the old). Block editor HTML, e.g. <!-- wp:paragraph --><p>…</p><!-- /wp:paragraph -->.'),
      excerpt: z.string().max(1000).optional(),
      slug: z.string().regex(/^[a-z0-9-]+$/).max(200).optional().describe('Address part, e.g. "delivery-and-returns".'),
      confirm: confirmArg,
    },
    async ({ site, type, id, confirm, ...fields }) =>
      await withSite(access, site, async (client, entry) => {
        const wanted: ContentChange = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
        if (Object.keys(wanted).length === 0) return 'Nothing to change: give a title, content, excerpt or slug.'
        const before = id !== undefined ? await client.get(type, id) : undefined
        if (before === undefined && (fields.title === undefined || fields.content === undefined)) return `A new ${type} needs a title and content.`
        const lines =
          before === undefined
            ? [`Create a new ${type} "${fields.title}" on ${entry.name}${fields.slug !== undefined ? ` at /${fields.slug}` : ''}:`, `  content: ${plain(fields.content!)}`]
            : [`Change ${type} ${before.id} "${before.title}" (/${before.slug}, ${statusWords(before.status)}) on ${entry.name}:`]
        if (before !== undefined) {
          if (fields.title !== undefined) lines.push(`  title: "${before.title}" → "${fields.title}"`)
          if (fields.slug !== undefined) lines.push(`  address: /${before.slug} → /${fields.slug}${before.status === 'publish' ? ' (the old address stops working unless a redirect is added; links and ads pointing to it break)' : ''}`)
          if (fields.content !== undefined) lines.push(`  content now: ${plain(before.content)}`, `  content new: ${plain(fields.content)}`)
        }
        if (fields.excerpt !== undefined) lines.push(`  excerpt: "${plain(before?.excerpt ?? '', 160)}" → "${plain(fields.excerpt, 160)}"`)
        lines.push(
          '',
          before === undefined
            ? `Saved as a DRAFT: visitors cannot see it until it is published with wordpress_publish_content (another approval).`
            : before.status === 'publish'
              ? `This ${type} is LIVE: visitors see the change as soon as it is saved. The current version is saved first and can be restored.`
              : `This ${type} is not public (${statusWords(before.status)}); it stays that way. The current version is saved first and can be restored.`,
        )
        const gate = decide({
          action: 'wordpress_save_content',
          payload: {
            site: entry.url,
            type,
            id: id ?? null,
            title: fields.title,
            content: fields.content === undefined ? undefined : hash(fields.content),
            excerpt: fields.excerpt === undefined ? undefined : hash(fields.excerpt),
            slug: fields.slug,
            current: before === undefined ? null : hash(contentBackup(before)),
          },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)

        let backup: string | undefined
        let savedId: number
        if (before !== undefined) {
          backup = saveBackup(access.backupDir(entry), { kind: type, id: before.id, site: entry.url, content: contentBackup(before) })
          savedId = (await client.update(type, before.id, wanted)).id
        } else {
          savedId = (await client.create(type, { ...wanted, status: 'draft' })).id
        }
        const after = await client.get(type, savedId)
        const problems = readBackProblems(after, wanted)
        if (before === undefined && after.status !== 'draft') problems.push(`status is "${after.status}", not draft`)
        await access.record(before === undefined ? 'wordpress.content.created' : 'wordpress.content.updated', { site: entry.url, type, id: savedId, ...(backup !== undefined ? { backup } : {}) })
        return [
          problems.length === 0
            ? `Done, and read back from WordPress: ${type} ${savedId} "${after.title}" holds the approved text (${statusWords(after.status)}).`
            : `Saved, but the read-back differs from what was approved: ${problems.join('; ')}. Check it in WordPress now (wordpress_read_content ${type} ${savedId}).`,
          `Preview or edit: ${entry.url}/wp-admin/post.php?post=${savedId}&action=edit`,
          ...(backup !== undefined ? [`Previous version saved: ${backup} (restore with wordpress_restore_backup).`] : []),
        ].join('\n')
      }),
  )

  server.tool(
    'wordpress_publish_content',
    'Make a draft page or post public (or, with unpublish: true, take a public one back to draft). Needs the user\'s approval; the current version is saved first and the status is read back. Pages that ads link to: check the page on a phone first.',
    { site: siteArg, type: typeArg, id: z.number().int().positive(), unpublish: z.boolean().default(false), confirm: confirmArg },
    async ({ site, type, id, unpublish, confirm }) =>
      await withSite(access, site, async (client, entry) => {
        const before = await client.get(type, id)
        const target = unpublish ? 'draft' : 'publish'
        if (before.status === target) return `${type} ${id} "${before.title}" is already ${statusWords(target)}. Nothing to do.`
        const lines = [
          `${unpublish ? 'Unpublish' : 'Publish'} ${type} ${id} "${before.title}" on ${entry.name}: ${statusWords(before.status)} → ${statusWords(target)}.`,
          `  content: ${plain(before.content)}`,
          '',
          unpublish
            ? `Visitors, search engines and any ads linking to ${before.link} get "not found" from the moment it is saved.`
            : `Everyone can see it at ${entry.url}/${before.slug}/ (or the address WordPress gives it) from the moment it is saved.`,
        ]
        const gate = decide({
          action: 'wordpress_publish_content',
          payload: { site: entry.url, type, id, target, current: hash(contentBackup(before)) },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)
        const backup = saveBackup(access.backupDir(entry), { kind: type, id, site: entry.url, content: contentBackup(before) })
        await client.update(type, id, { status: target })
        const after = await client.get(type, id)
        await access.record(unpublish ? 'wordpress.content.unpublished' : 'wordpress.content.published', { site: entry.url, type, id, backup })
        return [
          after.status === target
            ? `Done, and read back from WordPress: "${after.title}" is ${statusWords(after.status)}${target === 'publish' ? ` at ${after.link}` : ''}.`
            : `WordPress reports the status as "${after.status}", not "${target}". The user's role may not allow publishing; check it in WordPress.`,
          `Previous version saved: ${backup}.`,
        ].join('\n')
      }),
  )

  // ---------------------------------------------------------------- writes: media

  server.tool(
    'wordpress_upload_media',
    'Add an image to the site\'s Media Library from a public https address (JPEG, PNG, GIF, WebP or AVIF, up to 10 MB), with alt text. The file is checked by its content, not its name. Needs the user\'s approval; returns the image\'s id and address to use in a page.',
    {
      site: siteArg,
      url: z.string().describe('Public https address of the image.'),
      altText: z.string().min(1).max(300).describe('What the image shows, for screen readers and search engines.'),
      title: z.string().max(200).optional(),
      confirm: confirmArg,
    },
    async ({ site, url, altText, title, confirm }) =>
      await withSite(access, site, async (client, entry) => {
        let res
        try {
          res = await access.fetch({ url, headers: { accept: 'image/*' }, redirects: 'public', maxBytes: MAX_MEDIA_BYTES, timeoutMs: 30_000 })
        } catch (error) {
          if (error instanceof SafeHttpError) return `The image could not be fetched: ${error.message}`
          throw error
        }
        if (res.status !== 200) return `The image address answered HTTP ${res.status}, not the image. Check it opens in a browser without logging in.`
        const kind = sniffImage(res.body)
        if (kind === undefined) {
          return 'That address does not return a JPEG, PNG, GIF, WebP or AVIF image (checked by the file\'s content). SVG and other files are not uploaded. Use a direct link to the image file.'
        }
        const base = (new URL(res.url).pathname.split('/').pop() ?? 'image').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w-]/g, '-').slice(0, 80) || 'image'
        const filename = `${base}.${kind.ext}`
        const fingerprint = createHash('sha256').update(res.body).digest('hex')
        const lines = [
          `Upload an image to the Media Library of ${entry.name}:`,
          `  from: ${url}`,
          `  file: ${filename} (${kind.mime}, ${Math.round(res.body.length / 1024)} KB)`,
          `  alt text: "${altText}"${title !== undefined ? `\n  title: "${title}"` : ''}`,
          ...(res.body.length > 1_048_576 ? ['  Note: over 1 MB slows pages; a compressed WebP version would load faster.'] : []),
          '',
          'The file gets a public address on the site at once, but appears on a page only when a page uses it. It can be deleted from Media Library.',
        ]
        const gate = decide({
          action: 'wordpress_upload_media',
          payload: { site: entry.url, url, sha256: fingerprint, altText, title },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)
        const uploaded = await client.uploadMedia({ filename, mime: kind.mime, bytes: res.body, altText, ...(title !== undefined ? { title } : {}) })
        const after = await client.media(uploaded.id)
        await access.record('wordpress.media.uploaded', { site: entry.url, id: after.id })
        const ok = after.mime === kind.mime && after.altText === altText
        return [
          ok ? `Done, and read back from WordPress: image ${after.id} is in the Media Library with the approved alt text.` : `Uploaded as image ${after.id}, but WordPress reports type "${after.mime}" and alt text "${after.altText}". Check it in Media Library.`,
          `Address: ${after.url}`,
          `Use it in a page with: <!-- wp:image {"id":${after.id}} --><figure class="wp-block-image"><img src="${after.url}" alt="${altText.replace(/"/g, '&quot;')}" class="wp-image-${after.id}"/></figure><!-- /wp:image -->`,
        ].join('\n')
      }),
  )

  // ---------------------------------------------------------------- backups and rollback

  server.tool(
    'wordpress_list_backups',
    `List the earlier versions ${productName()} saved before changing this site, newest first. Give type and id to also see WordPress's own revisions of that page or post. Reads only.`,
    { site: siteArg, type: typeArg.optional(), id: z.number().int().positive().optional() },
    async ({ site, type, id }) =>
      await withSite(access, site, async (client, entry) => {
        const dir = access.backupDir(entry)
        const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse() : []
        const mine = type !== undefined && id !== undefined ? files.filter((f) => f.endsWith(`-${type}-${id}.json`)) : files
        const lines = [mine.length === 0 ? `No ${productName()} backups yet for this.` : `${productName()} backups (newest first; restore with wordpress_restore_backup file):`, ...mine.slice(0, 50).map((f) => `  ${f}`)]
        if (type !== undefined && id !== undefined) {
          try {
            const revisions = await client.revisions(type, id)
            lines.push(
              '',
              revisions.length === 0 ? 'WordPress has no revisions of it (revisions may be turned off on this site).' : `WordPress revisions (restore with wordpress_restore_backup revisionId):`,
              ...revisions.slice(0, 20).map((r) => `  revision ${r.id} — ${r.date} — "${r.title}" — ${plain(r.content, 100)}`),
            )
          } catch (error) {
            if (!(error instanceof WordPressError)) throw error
            lines.push('', `WordPress revisions not readable: ${error.message}`)
          }
        }
        return lines.join('\n')
      }),
  )

  server.tool(
    'wordpress_restore_backup',
    `Put an earlier version back: an ${productName()} backup file (pages, posts and WooCommerce products, from wordpress_list_backups) or a WordPress revision of a page or post (type, id and revisionId). Shows what will be restored for the user's approval, saves the current version first, then reads it back.`,
    {
      site: siteArg,
      file: z.string().regex(/^[\w.-]+\.json$/).optional(),
      type: typeArg.optional(),
      id: z.number().int().positive().optional(),
      revisionId: z.number().int().positive().optional(),
      confirm: confirmArg,
    },
    async ({ site, file, type, id, revisionId, confirm }) =>
      await withSite(access, site, async (client, entry) => {
        const dir = access.backupDir(entry)
        if (file === undefined && (revisionId === undefined || type === undefined || id === undefined)) {
          return 'Give either file (from wordpress_list_backups) or type, id and revisionId (a WordPress revision).'
        }
        if (file !== undefined) {
          const path = join(dir, file)
          if (!existsSync(path)) return `No backup "${file}" for this site. Use wordpress_list_backups.`
          const saved = JSON.parse(readFileSync(path, 'utf8')) as Backup
          if (saved.site !== entry.url) return `The backup "${file}" belongs to ${saved.site}, not ${entry.url}.`
          if (saved.kind === 'page' || saved.kind === 'post') {
            const now = await client.get(saved.kind, saved.id)
            const old = saved.content as ReturnType<typeof contentBackup>
            const lines = [
              `Restore ${saved.kind} ${saved.id} on ${entry.name} to the version saved ${saved.savedAt}:`,
              `  title: "${now.title}" → "${old.title}"`,
              `  content: ${plain(old.content)}`,
              ...(old.slug !== now.slug ? [`  address: /${now.slug} → /${old.slug}`] : []),
              ...(old.status !== now.status ? [`  status: ${statusWords(now.status)} → ${statusWords(old.status)}`] : []),
              '',
              now.status === 'publish' || old.status === 'publish' ? 'Visitors see the restored version at once.' : 'It is not public before or after.',
              'The current version is saved first, so this restore can be undone too.',
            ]
            const gate = decide({
              action: 'wordpress_restore_backup',
              payload: { site: entry.url, file, current: hash(contentBackup(now)) },
              ...(confirm !== undefined ? { confirmation: confirm } : {}),
              describe: () => lines.join('\n'),
            })
            if (!gate.allowed) return formatApprovalRequest(gate)
            const backup = saveBackup(dir, { kind: saved.kind, id: saved.id, site: entry.url, content: contentBackup(now) })
            const change: ContentChange = { title: old.title, content: old.content, excerpt: old.excerpt, slug: old.slug, ...(isStatus(old.status) ? { status: old.status } : {}) }
            await client.update(saved.kind, saved.id, change)
            const after = await client.get(saved.kind, saved.id)
            const problems = readBackProblems(after, change)
            await access.record('wordpress.content.restored', { site: entry.url, type: saved.kind, id: saved.id, from: file, backup })
            return [
              problems.length === 0 ? `Restored, and read back from WordPress: "${after.title}" (${statusWords(after.status)}).` : `Restored, but the read-back differs: ${problems.join('; ')}. Check it in WordPress.`,
              `The version it replaced is saved as ${backup}.`,
            ].join('\n')
          }
          // A WooCommerce product or variation.
          const productId = saved.kind === 'variation' ? saved.productId! : saved.id
          const now = saved.kind === 'variation' ? await client.wooVariation(productId, saved.id) : await client.wooProduct(saved.id)
          const old = saved.content as ReturnType<typeof productBackup>
          const lines = [
            `Restore WooCommerce ${saved.kind} ${saved.id} on ${entry.name} to the version saved ${saved.savedAt}:`,
            ...productDiff(now, old),
            '',
            'Buyers see the restored name, text and prices at once. The current version is saved first.',
          ]
          const gate = decide({
            action: 'wordpress_restore_backup',
            payload: { site: entry.url, file, current: hash(productBackup(now)) },
            ...(confirm !== undefined ? { confirmation: confirm } : {}),
            describe: () => lines.join('\n'),
          })
          if (!gate.allowed) return formatApprovalRequest(gate)
          const backup = saveBackup(dir, { kind: saved.kind, id: saved.id, ...(saved.kind === 'variation' ? { productId } : {}), site: entry.url, content: productBackup(now) })
          const change: WooProductChange = saved.kind === 'variation' ? withoutNames(old) : old
          const after = saved.kind === 'variation' ? await client.updateWooVariation(productId, saved.id, change) : await client.updateWooProduct(saved.id, change)
          const reread = saved.kind === 'variation' ? await client.wooVariation(productId, saved.id) : await client.wooProduct(after.id)
          const problems = wooReadBackProblems(reread, change)
          await access.record('woocommerce.product.restored', { site: entry.url, id: saved.id, from: file, backup })
          return [
            problems.length === 0 ? `Restored, and read back from WooCommerce: "${reread.name}".` : `Restored, but the read-back differs: ${problems.join('; ')}. Check it in WooCommerce.`,
            `The version it replaced is saved as ${backup}.`,
          ].join('\n')
        }

        // A WordPress revision.
        const revisions = await client.revisions(type!, id!)
        const revision = revisions.find((r) => r.id === revisionId)
        if (revision === undefined) return `${type} ${id} has no revision ${revisionId}. Use wordpress_list_backups with type and id to see them.`
        const now = await client.get(type!, id!)
        const lines = [
          `Restore ${type} ${id} "${now.title}" on ${entry.name} to WordPress revision ${revisionId} (${revision.date}):`,
          `  title: "${now.title}" → "${revision.title}"`,
          `  content: ${plain(revision.content)}`,
          '',
          now.status === 'publish' ? 'It is published: visitors see the restored version at once.' : `It stays ${statusWords(now.status)}.`,
          'The current version is saved first, so this can be undone too.',
        ]
        const gate = decide({
          action: 'wordpress_restore_backup',
          payload: { site: entry.url, type, id, revisionId, current: hash(contentBackup(now)) },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)
        const backup = saveBackup(dir, { kind: type!, id: id!, site: entry.url, content: contentBackup(now) })
        const change: ContentChange = { title: revision.title, content: revision.content, excerpt: revision.excerpt }
        await client.update(type!, id!, change)
        const after = await client.get(type!, id!)
        const problems = readBackProblems(after, change)
        await access.record('wordpress.content.restored', { site: entry.url, type, id, revisionId, backup })
        return [
          problems.length === 0 ? `Restored revision ${revisionId}, and read back from WordPress: "${after.title}".` : `Restored, but the read-back differs: ${problems.join('; ')}. Check it in WordPress.`,
          `The version it replaced is saved as ${backup}.`,
        ].join('\n')
      }),
  )

  // ---------------------------------------------------------------- WooCommerce

  server.tool(
    'woocommerce_products',
    'WooCommerce products with their prices (regular and sale), stock status, photo count and type (simple or variable, with variation ids). Use before writing any ad or page that names a price. Reads only.',
    { site: siteArg, search: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) },
    async ({ site, search, limit }) =>
      await withSite(access, site, async (client) => {
        const products = await client.wooProducts({ ...(search !== undefined ? { search } : {}), perPage: limit })
        if (products.length === 0) return 'No products match.'
        const currency = (await client.wooSetting('general', 'woocommerce_currency')) ?? ''
        return [
          `${products.length} product(s), most recently changed first${currency ? ` (prices in ${currency})` : ''}:`,
          ...products.map(
            (p) =>
              `• [${p.id}] ${p.name} — ${p.status} — ${p.type}` +
              (p.type === 'variable' ? ` (variations: ${p.variations.slice(0, 20).join(', ')}; prices are per variation)` : ` — ${p.salePrice ? `${p.salePrice} (regular ${p.regularPrice})` : p.regularPrice || p.price || 'no price'}`) +
              ` — ${p.stockStatus} — ${p.images} photo(s)\n  ${p.permalink}`,
          ),
        ].join('\n')
      }),
  )

  server.tool(
    'woocommerce_update_product',
    'Change a WooCommerce product: name, description, short description, regular price, sale price and sale dates. For a variable product, prices are set per variation (give variationId). Shows the exact change with the store\'s currency and whether its prices include tax, for the user\'s approval; saves the current version first, then reads it back. Buyers see it at once.',
    {
      site: siteArg,
      productId: z.number().int().positive(),
      variationId: z.number().int().positive().optional().describe('For a variable product\'s price: which variation (from woocommerce_products).'),
      name: z.string().min(1).max(300).optional(),
      description: z.string().optional(),
      shortDescription: z.string().optional(),
      regularPrice: z.string().regex(/^\d+(\.\d{1,4})?$/).optional().describe('e.g. "4999" or "49.99", in the store currency.'),
      salePrice: z.string().regex(/^(\d+(\.\d{1,4})?)?$/).optional().describe('Lower than the regular price. "" removes the sale.'),
      saleFrom: z.string().optional().describe('ISO date the sale starts (store time).'),
      saleTo: z.string().optional().describe('ISO date the sale ends. Recommended: an open-ended sale makes the "was" price misleading over time.'),
      confirm: confirmArg,
    },
    async ({ site, productId, variationId, confirm, ...f }) =>
      await withSite(access, site, async (client, entry) => {
        const product = await client.wooProduct(productId)
        const priceChange = f.regularPrice !== undefined || f.salePrice !== undefined || f.saleFrom !== undefined || f.saleTo !== undefined
        if (variationId !== undefined && (f.name !== undefined || f.description !== undefined || f.shortDescription !== undefined)) {
          return 'Name and descriptions belong to the product, not a variation: change them without variationId, and prices with it.'
        }
        if (product.type === 'variable' && priceChange && variationId === undefined) {
          return `"${product.name}" is a variable product: each variation has its own price. Give variationId (one of ${product.variations.join(', ') || 'none'}).`
        }
        const before = variationId !== undefined ? await client.wooVariation(productId, variationId) : product
        const change: WooProductChange = {
          ...(f.name !== undefined ? { name: f.name } : {}),
          ...(f.description !== undefined ? { description: f.description } : {}),
          ...(f.shortDescription !== undefined ? { short_description: f.shortDescription } : {}),
          ...(f.regularPrice !== undefined ? { regular_price: f.regularPrice } : {}),
          ...(f.salePrice !== undefined ? { sale_price: f.salePrice } : {}),
          ...(f.saleFrom !== undefined ? { date_on_sale_from: f.saleFrom } : {}),
          ...(f.saleTo !== undefined ? { date_on_sale_to: f.saleTo } : {}),
        }
        if (Object.keys(change).length === 0) return 'Nothing to change: give a name, description, shortDescription, regularPrice, salePrice or sale dates.'
        const regular = Number(change.regular_price ?? before.regularPrice)
        const sale = change.sale_price ?? before.salePrice
        if (sale !== '' && sale !== undefined && !(Number(sale) < regular)) return `The sale price (${sale}) must be lower than the regular price (${regular}).`
        if (change.date_on_sale_from && change.date_on_sale_to && !(new Date(change.date_on_sale_to) > new Date(change.date_on_sale_from))) return 'saleTo must be after saleFrom.'

        const currency = (await client.wooSetting('general', 'woocommerce_currency')) ?? '(currency not readable)'
        const lines = [
          `Change WooCommerce product ${productId}${variationId !== undefined ? ` (variation ${variationId})` : ''} "${product.name}" on ${entry.name} (${product.status}):`,
          ...productDiff(before, { ...productBackup(before), ...change }),
        ]
        if (priceChange) {
          const incl = await client.wooSetting('tax', 'woocommerce_prices_include_tax')
          const calc = await client.wooSetting('general', 'woocommerce_calc_taxes')
          lines.push(
            '',
            `Prices are in ${currency}. ` +
              (calc === 'no'
                ? 'Taxes are turned off in WooCommerce, so buyers pay exactly the price shown.'
                : incl === 'yes'
                  ? 'This store enters prices INCLUDING tax: the price above is what buyers pay.'
                  : incl === 'no'
                    ? 'This store enters prices EXCLUDING tax: tax is added on top at checkout. In the UK, EU, Australia, New Zealand and the Gulf buyers expect the shown price to include VAT/GST (get_skill selling-by-country).'
                    : `${productName()} could not read whether this store's prices include tax (needs a Shop Manager or Administrator): check WooCommerce > Settings > Tax before approving.`),
          )
          if (sale !== '' && sale !== undefined) {
            lines.push(
              `On sale, the regular price shows as the "was" price. It must be a price really charged (in the EU, the lowest price of the last 30 days)${change.date_on_sale_to === undefined && before.dateOnSaleTo === null ? '; this sale has no end date' : ''}.`,
            )
          }
        }
        lines.push('', `Buyers see this as soon as it is saved${product.status !== 'publish' ? ' (the product is not published, so only once it is)' : ''}. The current version is saved first and can be restored.`)
        const gate = decide({
          action: 'woocommerce_update_product',
          payload: { site: entry.url, productId, variationId: variationId ?? null, change: hash(change), current: hash(productBackup(before)) },
          ...(confirm !== undefined ? { confirmation: confirm } : {}),
          describe: () => lines.join('\n'),
        })
        if (!gate.allowed) return formatApprovalRequest(gate)

        const backup = saveBackup(access.backupDir(entry), {
          kind: variationId !== undefined ? 'variation' : 'product',
          id: variationId ?? productId,
          ...(variationId !== undefined ? { productId } : {}),
          site: entry.url,
          content: productBackup(before),
        })
        if (variationId !== undefined) await client.updateWooVariation(productId, variationId, change)
        else await client.updateWooProduct(productId, change)
        const after = variationId !== undefined ? await client.wooVariation(productId, variationId) : await client.wooProduct(productId)
        const problems = wooReadBackProblems(after, change)
        await access.record('woocommerce.product.updated', { site: entry.url, productId, ...(variationId !== undefined ? { variationId } : {}), backup })
        return [
          problems.length === 0 ? `Done, and read back from WooCommerce: "${product.name}" holds the approved values${after.price ? ` (price now ${after.price} ${currency})` : ''}.` : `Saved, but the read-back differs from what was approved: ${problems.join('; ')}. Check the product in WooCommerce now.`,
          `Previous version saved: ${backup} (restore with wordpress_restore_backup).`,
        ].join('\n')
      }),
  )
}

// ------------------------------------------------------------------ helpers

const isStatus = (s: string): s is 'draft' | 'publish' | 'pending' | 'private' => ['draft', 'publish', 'pending', 'private'].includes(s)

/** What differs between what was saved and what was approved. Empty when they match. */
export function readBackProblems(after: ContentItem, wanted: ContentChange): string[] {
  const problems: string[] = []
  if (wanted.title !== undefined && !same(after.title, wanted.title)) problems.push(`title is "${after.title}"`)
  if (wanted.slug !== undefined && after.slug !== wanted.slug) problems.push(`address is /${after.slug} (WordPress changes it when /${wanted.slug} is already used)`)
  if (wanted.content !== undefined && !same(after.content, wanted.content)) {
    problems.push('content differs (WordPress removes code such as <script>, <iframe> or some attributes for users without the "unfiltered_html" permission)')
  }
  if (wanted.excerpt !== undefined && !same(after.excerpt, wanted.excerpt)) problems.push('excerpt differs')
  if (wanted.status !== undefined && after.status !== wanted.status) problems.push(`status is "${after.status}"`)
  return problems
}

function wooReadBackProblems(after: WooProduct, change: WooProductChange): string[] {
  const problems: string[] = []
  const num = (s: string | undefined) => (s === undefined || s === '' ? '' : String(Number(s)))
  if (change.name !== undefined && !same(after.name, change.name)) problems.push(`name is "${after.name}"`)
  if (change.description !== undefined && !same(after.description, change.description)) problems.push('description differs')
  if (change.short_description !== undefined && !same(after.shortDescription, change.short_description)) problems.push('short description differs')
  if (change.regular_price !== undefined && num(after.regularPrice) !== num(change.regular_price)) problems.push(`regular price is "${after.regularPrice}"`)
  if (change.sale_price !== undefined && num(after.salePrice) !== num(change.sale_price)) problems.push(`sale price is "${after.salePrice}"`)
  return problems
}

function productDiff(before: WooProduct, wanted: ReturnType<typeof productBackup> | Record<string, unknown>): string[] {
  const w = wanted as Record<string, string | null | undefined>
  const out: string[] = []
  const row = (label: string, now: string | null, next: string | null | undefined, html = false) => {
    if (next === undefined || (next ?? '') === (now ?? '')) return
    out.push(html ? `  ${label} now: ${plain(now ?? '')}\n  ${label} new: ${plain(next ?? '')}` : `  ${label}: "${now ?? ''}" → "${next ?? ''}"`)
  }
  row('name', before.name, w.name)
  row('description', before.description, w.description, true)
  row('short description', before.shortDescription, w.short_description, true)
  row('regular price', before.regularPrice, w.regular_price)
  row('sale price', before.salePrice, w.sale_price === '' ? '(no sale)' : w.sale_price)
  row('sale starts', before.dateOnSaleFrom, w.date_on_sale_from)
  row('sale ends', before.dateOnSaleTo, w.date_on_sale_to)
  return out.length > 0 ? out : ['  (no visible difference)']
}

const withoutNames = (old: ReturnType<typeof productBackup>): WooProductChange => ({
  regular_price: old.regular_price,
  sale_price: old.sale_price,
  date_on_sale_from: old.date_on_sale_from,
  date_on_sale_to: old.date_on_sale_to,
})
