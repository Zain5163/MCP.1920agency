import { SafeHttpError, checkPublicUrl, createSafeFetch, type SafeFetch, type SafeResponse } from './safe-http.ts'

/**
 * WordPress REST API client (and WooCommerce REST v3 on the same site), for a
 * site whose owner gave AdsPilot an Application Password.
 *
 * Research and the decision to use core REST rather than the WordPress MCP
 * Adapter: research/2026-10-08-wordpress-connector.md. All code here is our own;
 * WordPress and WooCommerce are GPL and none of their code is copied.
 *
 * Three rules hold for every call:
 *
 *   - **Every request goes through the SSRF-guarded fetch** (safe-http.ts): https
 *     only, every resolved address public, the socket pinned to the checked
 *     address, no redirect to another host. Re-checked per request, not once.
 *   - **The password never leaves the request it is used in.** It comes from a
 *     provider at the moment of the call (the vault, on the hosted server), is
 *     turned into one Authorization header, and is never stored on this object,
 *     put in an error, or logged.
 *   - **Every failure says why and what to do** (RULES.md R1). WordPress's own
 *     error codes are mapped to the fix, including the ones that are not about
 *     the password at all: a host stripping the Authorization header, a security
 *     plugin disabling application passwords, a firewall answering with HTML.
 */

export type WordPressErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'blocked'
  | 'rest_disabled'
  | 'unsafe'
  | 'network'
  | 'bad_request'
  | 'throttled'
  | 'server'
  | 'bad_response'

export class WordPressError extends Error {
  readonly kind: WordPressErrorKind
  /** WordPress's own error code, when it sent one (e.g. "incorrect_password"). */
  readonly code: string | undefined
  readonly status: number | undefined

  constructor(message: string, kind: WordPressErrorKind, code?: string, status?: number) {
    super(message)
    this.name = 'WordPressError'
    this.kind = kind
    this.code = code
    this.status = status
  }
}

export interface WordPressLogin {
  readonly username: string
  readonly password: string
}
/** Supplies the login for one request. Called per request; the result must not be kept. */
export type WordPressLoginProvider = () => Promise<WordPressLogin>

/** How REST routes are addressed: /wp-json/... (pretty permalinks) or /?rest_route=... (plain permalinks). */
export type RestMode = 'pretty' | 'query'

export type ContentType = 'page' | 'post'
const ROUTE: Record<ContentType, string> = { page: 'pages', post: 'posts' }

export interface SiteIndex {
  readonly name: string
  readonly description: string
  /** The WordPress address (Settings > General). */
  readonly url: string
  /** The site address visitors use. */
  readonly home: string
  readonly namespaces: readonly string[]
  /** True when the site advertises Application Passwords in its REST index. */
  readonly applicationPasswords: boolean
  readonly timezone: string
}

export interface CurrentUser {
  readonly id: number
  readonly username: string
  readonly name: string
  readonly roles: readonly string[]
  readonly capabilities: Readonly<Record<string, boolean>>
}

export interface ContentSummary {
  readonly id: number
  readonly type: ContentType
  readonly title: string
  readonly status: string
  readonly slug: string
  readonly modified: string
  readonly link: string
}

/** Everything AdsPilot changes on a page or post, as raw (editable) values. */
export interface ContentItem extends ContentSummary {
  readonly content: string
  readonly excerpt: string
  readonly parent: number
  readonly template: string
}

export interface ContentChange {
  readonly title?: string
  readonly content?: string
  readonly excerpt?: string
  readonly slug?: string
  readonly status?: 'draft' | 'publish' | 'pending' | 'private'
}

export interface Revision {
  readonly id: number
  readonly date: string
  readonly title: string
  readonly content: string
  readonly excerpt: string
}

export interface MediaItem {
  readonly id: number
  readonly url: string
  readonly mime: string
  readonly altText: string
  readonly title: string
}

export interface PluginInfo {
  readonly plugin: string
  readonly name: string
  readonly status: string
  readonly version: string
}

export interface WooProduct {
  readonly id: number
  readonly name: string
  readonly slug: string
  readonly status: string
  readonly type: string
  readonly permalink: string
  readonly description: string
  readonly shortDescription: string
  readonly regularPrice: string
  readonly salePrice: string
  readonly price: string
  readonly dateOnSaleFrom: string | null
  readonly dateOnSaleTo: string | null
  readonly stockStatus: string
  readonly images: number
  readonly variations: readonly number[]
}

export interface WooProductChange {
  readonly name?: string
  readonly description?: string
  readonly short_description?: string
  readonly regular_price?: string
  readonly sale_price?: string
  readonly date_on_sale_from?: string | null
  readonly date_on_sale_to?: string | null
}

export interface WordPressClientOptions {
  /** The site address, e.g. "https://www.example.com" or "https://example.com/blog". */
  readonly siteUrl: string
  /** The login; absent for public reads only (discovery, the home page). */
  readonly login?: WordPressLoginProvider
  readonly restMode?: RestMode
  readonly fetch?: SafeFetch
}

const UA = 'AdsPilot-WordPress-Connector/1.0'

/** "https://Example.com/blog/" -> "https://example.com/blog". Undefined if it cannot be a site address. */
export function normaliseSiteUrl(raw: string): string | { error: string } {
  let s = raw.trim()
  if (s === '') return { error: 'Give the site address, e.g. https://www.example.com.' }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`
  const checked = checkPublicUrl(s)
  if (!(checked instanceof URL)) return checked
  // The admin and REST paths are found from the site root; a pasted admin or REST
  // URL is cut back to it.
  const path = checked.pathname.replace(/\/(wp-admin|wp-json|wp-login\.php)(\/.*)?$/i, '').replace(/\/+$/, '')
  if (checked.search !== '' && !/^\?rest_route=/.test(checked.search)) {
    return { error: 'Give the site address without anything after "?", e.g. https://www.example.com.' }
  }
  return `https://${checked.host.toLowerCase()}${path}`
}

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const rendered = (v: unknown): string => {
  if (typeof v === 'string') return v
  const o = v as { raw?: unknown; rendered?: unknown } | undefined
  if (typeof o?.raw === 'string') return o.raw
  return typeof o?.rendered === 'string' ? o.rendered : ''
}

export class WordPressClient {
  readonly siteUrl: string
  readonly restMode: RestMode
  readonly #login: WordPressLoginProvider | undefined
  readonly #fetch: SafeFetch

  constructor(options: WordPressClientOptions) {
    const site = normaliseSiteUrl(options.siteUrl)
    if (typeof site !== 'string') throw new WordPressError(site.error, 'unsafe')
    this.siteUrl = site
    this.restMode = options.restMode ?? 'pretty'
    this.#login = options.login
    this.#fetch = options.fetch ?? createSafeFetch()
  }

  #routeUrl(route: string, query: Record<string, string | number | undefined> = {}, mode: RestMode = this.restMode): string {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, String(v))
    const rest = q.toString()
    if (mode === 'query') return `${this.siteUrl}/?rest_route=${encodeURIComponent(route)}${rest ? `&${rest}` : ''}`
    return `${this.siteUrl}/wp-json${route}${rest ? `?${rest}` : ''}`
  }

  async #exchange(
    method: string,
    route: string,
    options: { query?: Record<string, string | number | undefined>; json?: unknown; body?: Uint8Array; headers?: Record<string, string>; auth?: boolean; mode?: RestMode } = {},
  ): Promise<{ res: SafeResponse; authSent: boolean }> {
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': UA, ...options.headers }
    let authSent = false
    if (options.auth !== false && this.#login !== undefined) {
      const login = await this.#login()
      headers.authorization = `Basic ${Buffer.from(`${login.username}:${login.password.replace(/\s+/g, '')}`).toString('base64')}`
      authSent = true
    }
    let body: string | Uint8Array | undefined
    if (options.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(options.json)
    } else if (options.body !== undefined) {
      body = options.body
    }
    try {
      const res = await this.#fetch({
        url: this.#routeUrl(route, options.query, options.mode),
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        maxBytes: 10 * 1_048_576,
      })
      return { res, authSent }
    } catch (error) {
      if (error instanceof SafeHttpError) {
        throw new WordPressError(error.message, error.kind === 'network' || error.kind === 'timeout' || error.kind === 'dns' ? 'network' : 'unsafe')
      }
      throw error
    }
  }

  /** One REST call, parsed, or a WordPressError that says what to do. */
  async request<T>(
    method: string,
    route: string,
    options: { query?: Record<string, string | number | undefined>; json?: unknown; body?: Uint8Array; headers?: Record<string, string>; auth?: boolean; mode?: RestMode } = {},
  ): Promise<{ data: T; headers: Readonly<Record<string, string>> }> {
    const { res, authSent } = await this.#exchange(method, route, options)
    const raw = res.body.toString('utf8')
    let parsed: unknown
    let isJson = false
    try {
      parsed = JSON.parse(raw.replace(/^﻿/, ''))
      isJson = true
    } catch {
      // Classified below.
    }
    if (res.status >= 200 && res.status < 300 && isJson) return { data: parsed as T, headers: res.headers }
    throw explainWordPressError({ status: res.status, json: isJson ? parsed : undefined, body: raw, authSent, site: this.siteUrl, route, headers: res.headers })
  }

  // ---------------------------------------------------------------- discovery

  /**
   * Finds the REST API without logging in: /wp-json/ first, then ?rest_route=/
   * (sites on plain permalinks). Says plainly when neither answers like WordPress.
   */
  async discover(): Promise<SiteIndex & { restMode: RestMode }> {
    let first: unknown
    for (const mode of ['pretty', 'query'] as const) {
      try {
        const { data } = await this.request<Record<string, unknown>>('GET', '/', { auth: false, mode })
        if (typeof data === 'object' && data !== null && Array.isArray(data.namespaces)) return { ...toIndex(data), restMode: mode }
      } catch (error) {
        if (error instanceof WordPressError && (error.kind === 'unsafe' || error.kind === 'network')) throw error
        first ??= error
      }
    }
    if (first instanceof WordPressError && (first.kind === 'blocked' || first.kind === 'throttled' || first.kind === 'server')) throw first
    throw new WordPressError(
      `${this.siteUrl} does not answer like a WordPress site: neither ${this.siteUrl}/wp-json/ nor ${this.siteUrl}/?rest_route=/ returned the WordPress REST API. ` +
        'Check the address is the WordPress site itself (open it and add /wp-json/ — it should show text starting with {"name":). ' +
        'If it shows an error or a login page, the REST API has been turned off by a security plugin or the host; it has to be allowed for logged-in users. ' +
        'Sites hosted on WordPress.com (not self-hosted) are not supported yet.',
      'rest_disabled',
    )
  }

  async index(): Promise<SiteIndex> {
    const { data } = await this.request<Record<string, unknown>>('GET', '/')
    return toIndex(data)
  }

  async me(): Promise<CurrentUser> {
    const { data } = await this.request<Record<string, unknown>>('GET', '/wp/v2/users/me', { query: { context: 'edit' } })
    return {
      id: Number(data.id),
      username: typeof data.username === 'string' ? data.username : '',
      name: typeof data.name === 'string' ? data.name : '',
      roles: Array.isArray(data.roles) ? data.roles.map(String) : [],
      capabilities: (typeof data.capabilities === 'object' && data.capabilities !== null ? data.capabilities : {}) as Record<string, boolean>,
    }
  }

  /** Settings > General and Reading, as the REST API exposes them (needs manage_options). */
  async settings(): Promise<Record<string, unknown>> {
    return (await this.request<Record<string, unknown>>('GET', '/wp/v2/settings')).data
  }

  async activeTheme(): Promise<{ name: string; version: string; stylesheet: string; blockTheme: boolean | undefined } | undefined> {
    const { data } = await this.request<Array<Record<string, unknown>>>('GET', '/wp/v2/themes', { query: { status: 'active' } })
    const t = data[0]
    if (t === undefined) return undefined
    return {
      name: strip(rendered(t.name)),
      version: typeof t.version === 'string' ? t.version : '',
      stylesheet: typeof t.stylesheet === 'string' ? t.stylesheet : '',
      blockTheme: typeof t.is_block_theme === 'boolean' ? t.is_block_theme : undefined,
    }
  }

  /** Installed plugins (needs activate_plugins, so usually administrators only). */
  async plugins(): Promise<PluginInfo[]> {
    const { data } = await this.request<Array<Record<string, unknown>>>('GET', '/wp/v2/plugins')
    return data.map((p) => ({
      plugin: String(p.plugin ?? ''),
      name: strip(rendered(p.name)),
      status: String(p.status ?? ''),
      version: String(p.version ?? ''),
    }))
  }

  /** The public home page HTML, fetched without logging in, for the audit. */
  async homepage(): Promise<{ status: number; html: string; bytes: number; headers: Readonly<Record<string, string>> }> {
    try {
      const res = await this.#fetch({ url: `${this.siteUrl}/`, headers: { accept: 'text/html', 'user-agent': UA }, maxBytes: 5 * 1_048_576 })
      return { status: res.status, html: res.body.toString('utf8'), bytes: res.body.length, headers: res.headers }
    } catch (error) {
      if (error instanceof SafeHttpError) throw new WordPressError(error.message, error.kind === 'network' || error.kind === 'timeout' ? 'network' : 'unsafe')
      throw error
    }
  }

  // ---------------------------------------------------------------- pages and posts

  async list(
    type: ContentType,
    options: { status?: string; search?: string; perPage?: number; page?: number } = {},
  ): Promise<{ items: ContentSummary[]; total: number }> {
    const { data, headers } = await this.request<Array<Record<string, unknown>>>('GET', `/wp/v2/${ROUTE[type]}`, {
      query: {
        context: 'edit',
        status: options.status ?? 'publish,draft,pending,private,future',
        search: options.search,
        per_page: options.perPage ?? 20,
        page: options.page ?? 1,
        orderby: 'modified',
        order: 'desc',
        _fields: 'id,title,status,slug,modified,link',
      },
    })
    return { items: data.map((d) => toSummary(type, d)), total: Number(headers['x-wp-total'] ?? data.length) }
  }

  async get(type: ContentType, id: number): Promise<ContentItem> {
    const { data } = await this.request<Record<string, unknown>>('GET', `/wp/v2/${ROUTE[type]}/${id}`, { query: { context: 'edit' } })
    return toItem(type, data)
  }

  async create(type: ContentType, change: ContentChange): Promise<ContentItem> {
    const { data } = await this.request<Record<string, unknown>>('POST', `/wp/v2/${ROUTE[type]}`, { json: change })
    return toItem(type, data)
  }

  async update(type: ContentType, id: number, change: ContentChange): Promise<ContentItem> {
    const { data } = await this.request<Record<string, unknown>>('POST', `/wp/v2/${ROUTE[type]}/${id}`, { json: change, query: { context: 'edit' } })
    return toItem(type, data)
  }

  /** WordPress's own saved revisions of one page or post, newest first. Empty when revisions are turned off. */
  async revisions(type: ContentType, id: number): Promise<Revision[]> {
    const { data } = await this.request<Array<Record<string, unknown>>>('GET', `/wp/v2/${ROUTE[type]}/${id}/revisions`, {
      query: { context: 'edit', per_page: 20 },
    })
    return data.map((r) => ({
      id: Number(r.id),
      date: String(r.modified ?? r.date ?? ''),
      title: rendered(r.title),
      content: rendered(r.content),
      excerpt: rendered(r.excerpt),
    }))
  }

  /**
   * Revokes the Application Password this client logs in with, on the site
   * itself (introspect, WordPress 5.7+, then delete). Used on disconnect so the
   * password stops working everywhere, not only in AdsPilot.
   */
  async revokeOwnPassword(): Promise<void> {
    const { data } = await this.request<{ uuid?: string }>('GET', '/wp/v2/users/me/application-passwords/introspect')
    if (typeof data.uuid !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.uuid)) throw new WordPressError('WordPress did not say which application password is in use.', 'bad_response')
    await this.request('DELETE', `/wp/v2/users/me/application-passwords/${data.uuid}`)
  }

  // ---------------------------------------------------------------- media

  /** Uploads bytes to the media library (needs upload_files). */
  async uploadMedia(file: { filename: string; mime: string; bytes: Uint8Array; altText?: string; title?: string }): Promise<MediaItem> {
    const safeName = file.filename.replace(/[^\w.-]/g, '_').slice(-120) || 'image'
    const { data } = await this.request<Record<string, unknown>>('POST', '/wp/v2/media', {
      body: file.bytes,
      headers: { 'content-type': file.mime, 'content-disposition': `attachment; filename="${safeName}"` },
    })
    const id = Number(data.id)
    if (file.altText !== undefined || file.title !== undefined) {
      const { data: updated } = await this.request<Record<string, unknown>>('POST', `/wp/v2/media/${id}`, {
        json: { ...(file.altText !== undefined ? { alt_text: file.altText } : {}), ...(file.title !== undefined ? { title: file.title } : {}) },
      })
      return toMedia(updated)
    }
    return toMedia(data)
  }

  async media(id: number): Promise<MediaItem> {
    return toMedia((await this.request<Record<string, unknown>>('GET', `/wp/v2/media/${id}`, { query: { context: 'edit' } })).data)
  }

  // ---------------------------------------------------------------- WooCommerce

  async wooProducts(options: { search?: string; perPage?: number } = {}): Promise<WooProduct[]> {
    const { data } = await this.request<Array<Record<string, unknown>>>('GET', '/wc/v3/products', {
      query: { search: options.search, per_page: options.perPage ?? 20, orderby: 'modified', order: 'desc', status: 'any' },
    })
    return data.map(toWooProduct)
  }

  async wooProduct(id: number): Promise<WooProduct> {
    return toWooProduct((await this.request<Record<string, unknown>>('GET', `/wc/v3/products/${id}`)).data)
  }

  async wooVariation(productId: number, variationId: number): Promise<WooProduct> {
    return toWooProduct((await this.request<Record<string, unknown>>('GET', `/wc/v3/products/${productId}/variations/${variationId}`)).data)
  }

  async updateWooProduct(id: number, change: WooProductChange): Promise<WooProduct> {
    return toWooProduct((await this.request<Record<string, unknown>>('PUT', `/wc/v3/products/${id}`, { json: change })).data)
  }

  async updateWooVariation(productId: number, variationId: number, change: WooProductChange): Promise<WooProduct> {
    return toWooProduct((await this.request<Record<string, unknown>>('PUT', `/wc/v3/products/${productId}/variations/${variationId}`, { json: change })).data)
  }

  /** One WooCommerce setting, e.g. ("general", "woocommerce_currency"). Undefined when the role cannot read it. */
  async wooSetting(group: string, id: string): Promise<string | undefined> {
    try {
      const { data } = await this.request<{ value?: unknown }>('GET', `/wc/v3/settings/${group}/${id}`)
      return data.value === undefined || data.value === null ? undefined : String(data.value)
    } catch (error) {
      if (error instanceof WordPressError && (error.kind === 'forbidden' || error.kind === 'not_found')) return undefined
      throw error
    }
  }
}

// ------------------------------------------------------------------ shapes

function toIndex(data: Record<string, unknown>): SiteIndex {
  const auth = (data.authentication ?? {}) as Record<string, unknown>
  return {
    name: typeof data.name === 'string' ? data.name : '',
    description: typeof data.description === 'string' ? data.description : '',
    url: typeof data.url === 'string' ? data.url : '',
    home: typeof data.home === 'string' ? data.home : '',
    namespaces: Array.isArray(data.namespaces) ? data.namespaces.map(String) : [],
    applicationPasswords: typeof auth === 'object' && auth !== null && 'application-passwords' in auth,
    timezone: typeof data.timezone_string === 'string' ? data.timezone_string : '',
  }
}

function toSummary(type: ContentType, d: Record<string, unknown>): ContentSummary {
  return {
    id: Number(d.id),
    type,
    title: rendered(d.title),
    status: String(d.status ?? ''),
    slug: String(d.slug ?? ''),
    modified: String(d.modified ?? ''),
    link: String(d.link ?? ''),
  }
}

function toItem(type: ContentType, d: Record<string, unknown>): ContentItem {
  return {
    ...toSummary(type, d),
    content: rendered(d.content),
    excerpt: rendered(d.excerpt),
    parent: Number(d.parent ?? 0),
    template: String(d.template ?? ''),
  }
}

function toMedia(d: Record<string, unknown>): MediaItem {
  return {
    id: Number(d.id),
    url: String(d.source_url ?? ''),
    mime: String(d.mime_type ?? ''),
    altText: String(d.alt_text ?? ''),
    title: rendered(d.title),
  }
}

function toWooProduct(d: Record<string, unknown>): WooProduct {
  return {
    id: Number(d.id),
    name: String(d.name ?? ''),
    slug: String(d.slug ?? ''),
    status: String(d.status ?? ''),
    type: String(d.type ?? 'variation'),
    permalink: String(d.permalink ?? ''),
    description: String(d.description ?? ''),
    shortDescription: String(d.short_description ?? ''),
    regularPrice: String(d.regular_price ?? ''),
    salePrice: String(d.sale_price ?? ''),
    price: String(d.price ?? ''),
    dateOnSaleFrom: typeof d.date_on_sale_from === 'string' ? d.date_on_sale_from : null,
    dateOnSaleTo: typeof d.date_on_sale_to === 'string' ? d.date_on_sale_to : null,
    stockStatus: String(d.stock_status ?? ''),
    images: Array.isArray(d.images) ? d.images.length : d.image !== undefined && d.image !== null ? 1 : 0,
    variations: Array.isArray(d.variations) ? d.variations.map(Number) : [],
  }
}

// ------------------------------------------------------------------ errors

/**
 * Turns a failed REST response into a WordPressError that tells the user what
 * to fix. Exported for tests. WordPress's message is quoted only where it is
 * safe and useful; the password is never in anything this returns.
 */
export function explainWordPressError(input: {
  status: number
  json: unknown
  body: string
  authSent: boolean
  site: string
  route: string
  headers?: Readonly<Record<string, string>>
}): WordPressError {
  const { status, authSent, site, route } = input
  const j = (input.json ?? {}) as { code?: unknown; message?: unknown }
  const code = typeof j.code === 'string' ? j.code : undefined
  const wpSays = typeof j.message === 'string' ? ` (WordPress says: "${strip(j.message).slice(0, 200)}")` : ''
  const fail = (message: string, kind: WordPressErrorKind) => new WordPressError(message, kind, code, status)
  const PROFILE = 'In WordPress go to Users > Profile, scroll to "Application Passwords", type a name such as "AdsPilot" and click "Add New Application Password"'

  if (/challenge/i.test(input.headers?.['cf-mitigated'] ?? '')) {
    return fail(
      `Cloudflare in front of ${site} answered with an "are you human?" challenge instead of letting the request through. ` +
        `In the site's Cloudflare dashboard (Security > WAF), add a rule that skips the challenge for ${site.replace(/^https:\/\/[^/]+/, '')}/wp-json/* (or for the user agent "${UA}"), then try again.`,
      'blocked',
    )
  }
  if (input.json === undefined) {
    // Not JSON at all: something in front of WordPress answered.
    if (status === 401 || status === 403) {
      return fail(
        `${site} refused the request before WordPress saw it (HTTP ${status}, a web page instead of a REST answer). ` +
          'A firewall or security service in front of the site (for example Cloudflare, Sucuri, Wordfence or the host\'s own firewall) is blocking API requests. ' +
          `Ask whoever runs the site to allow requests to ${site}/wp-json/ from AdsPilot (user agent "${UA}"), then try again.`,
        'blocked',
      )
    }
    if (status === 429) return fail(`${site} is limiting requests (HTTP 429). Wait a few minutes and try again; if it keeps happening, the host's rate limit needs to allow the REST API.`, 'throttled')
    if (status >= 500) return fail(`${site} had an error of its own (HTTP ${status}). Check the site opens in a browser; if it does, try again in a few minutes, and if it keeps failing ask the host to check the PHP error log.`, 'server')
    if (status === 404) return fail(`${site} has no REST API at ${route} (HTTP 404, a web page instead). The REST API may be turned off by a plugin, or the address is not the WordPress site itself.`, 'rest_disabled')
    if (status >= 200 && status < 300) {
      return fail(`${site} answered ${route} with a web page instead of REST data. A plugin or the host may be rewriting API requests (or the address is not a WordPress site). Open ${site}/wp-json/ in a browser: it should show text starting with {"name":.`, 'bad_response')
    }
    return fail(`${site} answered HTTP ${status} with a web page instead of REST data. Open ${site}/wp-json/ in a browser to see what it shows.`, 'bad_response')
  }

  switch (code) {
    case 'incorrect_password':
      return fail(
        'WordPress refused the application password. Check it was copied in full (24 letters and numbers; the spaces do not matter) and that it has not been revoked. ' +
          `It must be an Application Password, not the password you log in with: ${PROFILE}, then copy the new password.`,
        'auth',
      )
    case 'invalid_username':
    case 'invalid_email':
      return fail(
        'WordPress does not know that username. Use the login name shown at the top of Users > Profile (the "Username" field, which cannot be changed), or the account\'s email address.',
        'auth',
      )
    case 'application_passwords_disabled':
      return fail(
        'Application passwords are turned off on this site, so no app can log in. They are usually turned off by a security plugin ' +
          '(Wordfence turns them off by default: Wordfence > All Options > Brute Force Protection > untick "Disable WordPress application passwords"; Solid Security, All-In-One Security and others have similar switches) or by the host. ' +
          'Turn them back on, or ask the host, then create one in Users > Profile > Application Passwords.',
        'auth',
      )
    case 'application_passwords_disabled_for_user':
      return fail('Application passwords are turned off for this user (a plugin or the site\'s code limits them to certain users). Use an account that is allowed them, or ask whoever runs the site to allow this one.', 'auth')
    case 'rest_not_logged_in':
    case 'rest_forbidden_context':
      if (authSent) {
        return fail(
          'WordPress did not receive the login, although AdsPilot sent it. On many hosts the server removes the "Authorization" header before WordPress sees it ' +
            '(common on Apache with CGI/FastCGI). The fix, for the host or developer: in the site\'s .htaccess, above the WordPress rules, add ' +
            '"SetEnvIf Authorization (.*) HTTP_AUTHORIZATION=$1" (or the equivalent for the server). ' +
            'It also happens when the site does not see itself as HTTPS (behind some proxies), which hides application passwords: check Users > Profile shows an "Application Passwords" section.',
          'auth',
        )
      }
      return fail('This needs a login. Connect the site with wordpress_connect_site first.', 'auth')
    case 'rest_cookie_invalid_nonce':
      return fail('WordPress expected a browser login instead of an application password. A plugin may be forcing cookie logins for the REST API; ask whoever runs the site to allow application passwords for the REST API.', 'auth')
    case 'rest_no_route':
      if (route.startsWith('/wc/')) {
        return fail('WooCommerce\'s REST API is not available on this site: WooCommerce is not active, or a plugin hides its API. Check Plugins shows WooCommerce as active.', 'not_found')
      }
      return fail(`This WordPress site has no ${route} route${wpSays}. A plugin may have removed it, or WordPress is older than 5.6 and should be updated.`, 'not_found')
    case 'rest_post_invalid_id':
    case 'rest_term_invalid':
    case 'woocommerce_rest_product_invalid_id':
    case 'woocommerce_rest_invalid_id':
      return fail(`Nothing with that id exists on the site${wpSays}. List the content first to get the right id.`, 'not_found')
    case 'rest_upload_file_too_big':
    case 'rest_upload_limited_space':
      return fail(`The site refused the file as too big${wpSays}. Use a smaller image (under 2 MB is best for page speed anyway), or raise the upload limit in the hosting control panel.`, 'bad_request')
    case 'rest_upload_sideload_error':
    case 'rest_upload_unknown_error':
      return fail(`WordPress could not save the upload${wpSays}. Common causes: the file type is not allowed on this site, or the uploads folder is not writable (the host can fix that).`, 'server')
    case 'rest_invalid_param':
    case 'rest_missing_callback_param':
    case 'woocommerce_rest_invalid_product_type':
      return fail(`WordPress rejected a value${wpSays}. Check the values and try again.`, 'bad_request')
  }

  if (status === 401 || status === 403) {
    if (code !== undefined && /^(rest|woocommerce_rest)_cannot_|^rest_forbidden|^woocommerce_rest_authentication|_cannot_(view|edit|create|publish|delete|read)/.test(code)) {
      return fail(
        `The WordPress user AdsPilot logs in as is not allowed to do this${wpSays}. ` +
          'Its role decides what it can do: Editors can change all pages and posts; changing plugins, settings or WooCommerce products needs an Administrator or Shop Manager. ' +
          'Either do this step yourself in WordPress, or connect with an Application Password from a user whose role allows it.',
        'forbidden',
      )
    }
    if (authSent && status === 401) {
      return fail(`WordPress refused the login${wpSays}. Check the username and Application Password, or create a new one (Users > Profile > Application Passwords) and reconnect.`, 'auth')
    }
    return fail(`WordPress refused the request (HTTP ${status})${wpSays}. A security plugin may be limiting the REST API; it must allow logged-in requests.`, 'forbidden')
  }
  if (status === 404) return fail(`Not found on the site (HTTP 404)${wpSays}.`, 'not_found')
  if (status === 429) return fail(`The site is limiting requests (HTTP 429)${wpSays}. Wait a few minutes and try again.`, 'throttled')
  if (status >= 500) return fail(`The site had an error of its own (HTTP ${status})${wpSays}. Try again in a few minutes; if it keeps failing, the host can check the PHP error log.`, 'server')
  if (status >= 400) return fail(`WordPress refused the request (HTTP ${status})${wpSays}.`, 'bad_request')
  return fail(`Unexpected answer from the site (HTTP ${status}).`, 'bad_response')
}
