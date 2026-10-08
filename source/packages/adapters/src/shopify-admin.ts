import https from 'node:https'

/**
 * Shopify Admin API client: read a store so AdsPilot can judge ads on real sales
 * and audit the store for conversion problems.
 *
 * Phase 1 of architecture/2026-10-08-shopify-connector-plan.md. Read-only by
 * design: nothing here writes to a store. Writes come later, behind approvals.
 *
 * Auth: the client-credentials grant, which Shopify allows for stores owned by
 * the app's own organisation (development stores). A 24-hour token is fetched
 * with the app's id and secret and cached until shortly before it expires.
 * Client stores will connect through the install link and OAuth instead, and
 * hand this class a stored token through the same `credentials` seam.
 *
 * Customer personal data is never requested: no names, emails, phones or
 * addresses appear in any query below.
 */

export const SHOPIFY_API_VERSION = '2026-10'

export interface ShopifyRequest {
  readonly host: string
  readonly path: string
  readonly body: string
  readonly headers: Readonly<Record<string, string>>
}
export type ShopifyTransport = (request: ShopifyRequest) => Promise<{ status: number; body: string }>

/**
 * HTTPS POST via node:https.
 *
 * `connectAddress` is an optional IP to connect to instead of what DNS returns.
 * It exists for one reason, found 2026-10-08: an ISP route to the Shopify edge
 * that every *.myshopify.com name resolves to was dead, while a neighbouring
 * Shopify edge address worked. TLS still verifies the store's own name, so this
 * changes the route, not who is trusted. Leave it unset unless a route is broken.
 */
export function httpsTransport(connectAddress?: string): ShopifyTransport {
  const lookup =
    connectAddress === undefined || connectAddress === ''
      ? undefined
      : (
          _host: string,
          options: { all?: boolean },
          callback: (error: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void,
        ) => (options?.all === true ? callback(null, [{ address: connectAddress, family: 4 }]) : callback(null, connectAddress, 4))

  return (request) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: request.host,
          path: request.path,
          method: 'POST',
          headers: { ...request.headers, 'content-length': Buffer.byteLength(request.body) },
          timeout: 30_000,
          ...(lookup !== undefined ? { lookup: lookup as never } : {}),
        },
        (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => (body += chunk))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
        },
      )
      req.on('timeout', () => req.destroy(new Error(`Timed out connecting to ${request.host}.`)))
      req.on('error', reject)
      req.end(request.body)
    })
}

export type ShopifyErrorKind = 'auth' | 'access' | 'throttled' | 'network' | 'query'

export class ShopifyError extends Error {
  readonly kind: ShopifyErrorKind

  constructor(message: string, kind: ShopifyErrorKind) {
    super(message)
    this.name = 'ShopifyError'
    this.kind = kind
  }
}

export interface ShopifyCredentials {
  readonly clientId: string
  readonly clientSecret: string
}

export interface ShopifyClientOptions {
  /** The store's myshopify domain, e.g. "example.myshopify.com". */
  readonly shop: string
  readonly credentials: ShopifyCredentials
  readonly transport?: ShopifyTransport
  readonly apiVersion?: string
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
}

const money = (v: unknown): number => {
  const n = Number((v as { amount?: string } | undefined)?.amount ?? NaN)
  return Number.isFinite(n) ? n : 0
}

export class ShopifyAdminClient {
  readonly shop: string
  readonly #credentials: ShopifyCredentials
  readonly #transport: ShopifyTransport
  readonly #version: string
  readonly #now: () => number
  readonly #sleep: (ms: number) => Promise<void>
  #token: { value: string; expiresAt: number } | undefined = undefined

  constructor(options: ShopifyClientOptions) {
    const shop = options.shop.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      throw new ShopifyError(`"${options.shop}" is not a store's myshopify.com address.`, 'query')
    }
    this.shop = shop
    this.#credentials = options.credentials
    this.#transport = options.transport ?? httpsTransport()
    this.#version = options.apiVersion ?? SHOPIFY_API_VERSION
    this.#now = options.now ?? Date.now
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  async #send(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
    try {
      return await this.#transport({
        host: this.shop,
        path,
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      })
    } catch (cause) {
      throw new ShopifyError(
        `Could not reach ${this.shop}: ${cause instanceof Error ? cause.message : String(cause)}. ` +
          'If other sites load, the network route to Shopify may be broken; see SHOPIFY_CONNECT_ADDRESS in SETUP.md.',
        'network',
      )
    }
  }

  async #accessToken(): Promise<string> {
    if (this.#token !== undefined && this.#token.expiresAt > this.#now()) return this.#token.value
    const res = await this.#send('/admin/oauth/access_token', {
      grant_type: 'client_credentials',
      client_id: this.#credentials.clientId,
      client_secret: this.#credentials.clientSecret,
    })
    let parsed: { access_token?: string; expires_in?: number; error_description?: string; errors?: unknown } = {}
    try {
      parsed = JSON.parse(res.body) as typeof parsed
    } catch {
      // handled below
    }
    if (res.status !== 200 || parsed.access_token === undefined) {
      throw new ShopifyError(
        `Shopify refused the connector's credentials for ${this.shop} (HTTP ${res.status}). ` +
          'Check that the "1920 Agency Store Connector" app is installed on this store and that ' +
          'SHOPIFY_CONNECTOR_CLIENT_ID / SHOPIFY_CONNECTOR_CLIENT_SECRET in ~/.social-publisher/.env match the app. ' +
          'This sign-in method works only for stores owned by the app\'s organisation (development stores).',
        'auth',
      )
    }
    // Renew a minute early so a query never starts with a token about to lapse.
    this.#token = { value: parsed.access_token, expiresAt: this.#now() + ((parsed.expires_in ?? 86_400) - 60) * 1000 }
    return parsed.access_token
  }

  /** One GraphQL Admin query. Waits and retries once when Shopify asks it to slow down. */
  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.#accessToken()
      const res = await this.#send(`/admin/api/${this.#version}/graphql.json`, { query, variables }, { 'X-Shopify-Access-Token': token })
      if (res.status === 401) {
        this.#token = undefined
        if (attempt === 0) continue
        throw new ShopifyError(`Shopify rejected the access token for ${this.shop}.`, 'auth')
      }
      if (res.status === 402 || res.status === 423) {
        throw new ShopifyError(`The store ${this.shop} is frozen or locked (HTTP ${res.status}).`, 'access')
      }
      let parsed: { data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> } = {}
      try {
        parsed = JSON.parse(res.body) as typeof parsed
      } catch {
        throw new ShopifyError(`Shopify returned HTTP ${res.status} with an unreadable body.`, 'query')
      }
      const errors = parsed.errors ?? []
      if (errors.some((e) => e.extensions?.code === 'THROTTLED') || res.status === 429) {
        if (attempt === 0) {
          await this.#sleep(2_000)
          continue
        }
        throw new ShopifyError('Shopify is limiting requests for this store; try again in a minute.', 'throttled')
      }
      if (errors.some((e) => e.extensions?.code === 'ACCESS_DENIED')) {
        throw new ShopifyError(
          `Access denied on ${this.shop}: ${errors.map((e) => e.message).join('; ')}. The app may be missing a permission (scope).`,
          'access',
        )
      }
      if (errors.length > 0) {
        throw new ShopifyError(`Shopify query failed: ${errors.map((e) => e.message).join('; ')}`, 'query')
      }
      if (parsed.data === undefined) throw new ShopifyError(`Shopify returned no data (HTTP ${res.status}).`, 'query')
      return parsed.data
    }
    throw new ShopifyError('Shopify did not answer after a retry.', 'throttled')
  }

  // ------------------------------------------------------------------ reads

  async overview(): Promise<StoreOverview> {
    const d = await this.graphql<{
      shop: { name: string; myshopifyDomain: string; currencyCode: string; primaryDomain: { url: string }; plan: { displayName?: string } }
      productsCount: { count: number }
      ordersCount: { count: number }
      themes: { nodes: Array<{ name: string; role: string }> }
    }>(`{
      shop { name myshopifyDomain currencyCode primaryDomain { url } plan { displayName } }
      productsCount { count }
      ordersCount { count }
      themes(first: 20) { nodes { name role } }
    }`)
    return {
      name: d.shop.name,
      domain: d.shop.myshopifyDomain,
      url: d.shop.primaryDomain.url,
      currency: d.shop.currencyCode,
      plan: d.shop.plan?.displayName ?? '',
      products: d.productsCount.count,
      orders: d.ordersCount.count,
      liveTheme: d.themes.nodes.find((t) => t.role === 'MAIN')?.name ?? '',
      themes: d.themes.nodes.map((t) => `${t.name} (${t.role.toLowerCase()})`),
    }
  }

  async products(options: { limit?: number; query?: string } = {}): Promise<ProductRow[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 250)
    const rows: ProductRow[] = []
    let after: string | null = null
    while (rows.length < limit) {
      const page: ProductsPage = await this.graphql<ProductsPage>(
        `query($first: Int!, $after: String, $query: String) {
          products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
            pageInfo { hasNextPage endCursor }
            nodes {
              title handle status onlineStoreUrl description isGiftCard
              mediaCount { count }
              variants(first: 50) { nodes {
                title price compareAtPrice inventoryQuantity
                inventoryItem { tracked unitCost { amount } }
              } }
            }
          }
        }`,
        { first: Math.min(50, limit - rows.length), after, query: options.query ?? null },
      )
      for (const p of page.products.nodes) rows.push(toProductRow(p))
      if (!page.products.pageInfo.hasNextPage) break
      after = page.products.pageInfo.endCursor
    }
    return rows
  }

  /**
   * Orders in the last `days` days (Shopify allows 60 without extra approval),
   * summarised. Only order-level money, status, discount codes and where the
   * visit came from: no customer fields.
   */
  async sales(days: number, now: Date = new Date(this.#now())): Promise<SalesSummary> {
    const span = Math.min(Math.max(Math.round(days), 1), 60)
    const since = new Date(now.getTime() - span * 86_400_000).toISOString().slice(0, 10)
    const orders: OrderNode[] = []
    let after: string | null = null
    for (let i = 0; i < 20; i++) {
      const page: OrdersPage = await this.graphql<OrdersPage>(
        `query($after: String, $query: String) {
          orders(first: 100, after: $after, query: $query, sortKey: CREATED_AT) {
            pageInfo { hasNextPage endCursor }
            nodes {
              createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus
              currentTotalPriceSet { shopMoney { amount currencyCode } }
              totalRefundedSet { shopMoney { amount } }
              discountCodes
              currentSubtotalLineItemsQuantity
              customerJourneySummary { ready lastVisit { source utmParameters { source medium campaign } } }
            }
          }
        }`,
        { after, query: `created_at:>=${since}` },
      )
      orders.push(...page.orders.nodes)
      if (!page.orders.pageInfo.hasNextPage) break
      after = page.orders.pageInfo.endCursor
    }
    return summariseSales(orders, span, since)
  }

  /** Facts a conversion audit needs, gathered in one place. Judgement is the AI's, using the cro skill. */
  async auditFacts(): Promise<AuditFacts> {
    const [overview, products, extra] = await Promise.all([
      this.overview(),
      this.products({ limit: 100 }),
      this.graphql<{
        pages: { nodes: Array<{ title: string; handle: string }> }
        codeDiscountNodes: { nodes: Array<{ codeDiscount: { __typename: string; title?: string; status?: string } }> }
      }>(`{
        pages(first: 50) { nodes { title handle } }
        codeDiscountNodes(first: 50) { nodes { codeDiscount { __typename
          ... on DiscountCodeBasic { title status }
          ... on DiscountCodeFreeShipping { title status }
          ... on DiscountCodeBxgy { title status }
        } } }
      }`),
    ])
    // Policies need their own permission (read_legal_policies). A store that has not
    // granted it still gets the rest of the audit, with the gap said plainly.
    let policies: Array<{ type: string; body: string }> | undefined
    try {
      policies = (await this.graphql<{ shop: { shopPolicies: Array<{ type: string; body: string }> } }>(
        '{ shop { shopPolicies { type body } } }',
      )).shop.shopPolicies
    } catch (error) {
      if (!(error instanceof ShopifyError && error.kind === 'access')) throw error
    }
    return buildAuditFacts(overview, products, { ...extra, policies })
  }
  // ------------------------------------------------------------------ writes
  //
  // Phase 2. Every write is preceded, in the MCP tool, by the owner's approval and
  // a saved copy of what it replaces, and followed by a read-back. These methods
  // only talk to Shopify; the safety lives in shopify-tools.ts.

  async #mutate<T>(query: string, variables: Record<string, unknown>, field: string): Promise<T> {
    const data = await this.graphql<Record<string, { userErrors?: Array<{ field?: string[] | null; message: string }> } & Record<string, unknown>>>(query, variables)
    const result = data[field]
    const errors = result?.userErrors ?? []
    if (errors.length > 0) {
      throw new ShopifyError(`Shopify refused the change: ${errors.map((e) => `${(e.field ?? []).join('.') || 'input'}: ${e.message}`).join('; ')}`, 'query')
    }
    return result as unknown as T
  }

  async productContent(handle: string): Promise<ProductContent | undefined> {
    const d = await this.graphql<{ products: { nodes: ProductContent[] } }>(
      `query($q: String) { products(first: 1, query: $q) { nodes { id handle title descriptionHtml seo { title description } } } }`,
      { q: `handle:${JSON.stringify(handle)}` },
    )
    return d.products.nodes.find((p) => p.handle === handle)
  }

  async updateProduct(id: string, changes: ProductChanges): Promise<ProductContent> {
    const product: Record<string, unknown> = { id }
    if (changes.title !== undefined) product.title = changes.title
    if (changes.descriptionHtml !== undefined) product.descriptionHtml = changes.descriptionHtml
    if (changes.seoTitle !== undefined || changes.seoDescription !== undefined) {
      product.seo = {
        ...(changes.seoTitle !== undefined ? { title: changes.seoTitle } : {}),
        ...(changes.seoDescription !== undefined ? { description: changes.seoDescription } : {}),
      }
    }
    const r = await this.#mutate<{ product: ProductContent }>(
      `mutation($product: ProductUpdateInput!) { productUpdate(product: $product) {
        product { id handle title descriptionHtml seo { title description } }
        userErrors { field message } } }`,
      { product },
      'productUpdate',
    )
    return r.product
  }

  async pageContent(handle: string): Promise<PageContent | undefined> {
    const d = await this.graphql<{ pages: { nodes: PageContent[] } }>(
      `query($q: String) { pages(first: 5, query: $q) { nodes { id handle title body isPublished } } }`,
      { q: `handle:${JSON.stringify(handle)}` },
    )
    return d.pages.nodes.find((p) => p.handle === handle)
  }

  async createPage(page: { title: string; handle: string; body: string; isPublished: boolean }): Promise<PageContent> {
    const r = await this.#mutate<{ page: PageContent }>(
      `mutation($page: PageCreateInput!) { pageCreate(page: $page) {
        page { id handle title body isPublished } userErrors { field message } } }`,
      { page },
      'pageCreate',
    )
    return r.page
  }

  async updatePage(id: string, page: { title?: string; body?: string; isPublished?: boolean }): Promise<PageContent> {
    const r = await this.#mutate<{ page: PageContent }>(
      `mutation($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) {
        page { id handle title body isPublished } userErrors { field message } } }`,
      { id, page },
      'pageUpdate',
    )
    return r.page
  }

  /** For test clean-up, and for undoing a page this connector created. */
  async deletePage(id: string): Promise<void> {
    await this.#mutate(`mutation($id: ID!) { pageDelete(id: $id) { deletedPageId userErrors { field message } } }`, { id }, 'pageDelete')
  }

  async createDiscount(spec: DiscountSpec): Promise<CreatedDiscount> {
    const minimum =
      spec.minimumQuantity !== undefined
        ? { quantity: { greaterThanOrEqualToQuantity: String(spec.minimumQuantity) } }
        : spec.minimumSubtotal !== undefined
          ? { subtotal: { greaterThanOrEqualToSubtotal: String(spec.minimumSubtotal) } }
          : undefined
    const common = {
      title: spec.title,
      code: spec.code,
      startsAt: spec.startsAt,
      ...(spec.endsAt !== undefined ? { endsAt: spec.endsAt } : {}),
      context: { all: 'ALL' },
      ...(minimum !== undefined ? { minimumRequirement: minimum } : {}),
      ...(spec.usageLimit !== undefined ? { usageLimit: spec.usageLimit } : {}),
      appliesOncePerCustomer: spec.oncePerCustomer ?? false,
    }
    const read = `codeDiscountNode { id codeDiscount { __typename
      ... on DiscountCodeBasic { title status startsAt endsAt codes(first: 1) { nodes { code } } }
      ... on DiscountCodeFreeShipping { title status startsAt endsAt codes(first: 1) { nodes { code } } } } }`
    if (spec.kind === 'free_shipping') {
      const r = await this.#mutate<{ codeDiscountNode: DiscountNode }>(
        `mutation($d: DiscountCodeFreeShippingInput!) { discountCodeFreeShippingCreate(freeShippingCodeDiscount: $d) { ${read} userErrors { field message } } }`,
        { d: { ...common, destination: { all: true } } },
        'discountCodeFreeShippingCreate',
      )
      return toCreatedDiscount(r.codeDiscountNode)
    }
    const value =
      spec.kind === 'percentage'
        ? { percentage: spec.value / 100 }
        : { discountAmount: { amount: String(spec.value), appliesOnEachItem: false } }
    const r = await this.#mutate<{ codeDiscountNode: DiscountNode }>(
      `mutation($d: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $d) { ${read} userErrors { field message } } }`,
      { d: { ...common, customerGets: { value, items: { all: true } } } },
      'discountCodeBasicCreate',
    )
    return toCreatedDiscount(r.codeDiscountNode)
  }

  /** Ends a discount now. It stays on record, because orders reference it. */
  async deactivateDiscount(id: string): Promise<void> {
    await this.#mutate(
      `mutation($id: ID!) { discountCodeDeactivate(id: $id) { codeDiscountNode { id } userErrors { field message } } }`,
      { id },
      'discountCodeDeactivate',
    )
  }
}

export interface ProductContent {
  id: string
  handle: string
  title: string
  descriptionHtml: string
  seo: { title: string | null; description: string | null }
}
export interface ProductChanges {
  title?: string
  descriptionHtml?: string
  seoTitle?: string
  seoDescription?: string
}
export interface PageContent {
  id: string
  handle: string
  title: string
  body: string
  isPublished: boolean
}
export interface DiscountSpec {
  kind: 'percentage' | 'fixed_amount' | 'free_shipping'
  /** Percent (10 = 10%) or an amount in the store currency. Ignored for free shipping. */
  value: number
  title: string
  code: string
  startsAt: string
  endsAt?: string
  minimumQuantity?: number
  minimumSubtotal?: number
  usageLimit?: number
  oncePerCustomer?: boolean
}
interface DiscountNode {
  id: string
  codeDiscount: { __typename: string; title?: string; status?: string; startsAt?: string; endsAt?: string | null; codes?: { nodes: Array<{ code: string }> } }
}
export interface CreatedDiscount {
  id: string
  title: string
  code: string
  status: string
  startsAt: string
  endsAt: string | null
}
function toCreatedDiscount(n: DiscountNode): CreatedDiscount {
  return {
    id: n.id,
    title: n.codeDiscount.title ?? '',
    code: n.codeDiscount.codes?.nodes[0]?.code ?? '',
    status: n.codeDiscount.status ?? '',
    startsAt: n.codeDiscount.startsAt ?? '',
    endsAt: n.codeDiscount.endsAt ?? null,
  }
}


// ------------------------------------------------------------------ shapes

export interface StoreOverview {
  name: string
  domain: string
  url: string
  currency: string
  plan: string
  products: number
  orders: number
  liveTheme: string
  themes: string[]
}

interface ProductNode {
  title: string
  handle: string
  status: string
  onlineStoreUrl: string | null
  description: string
  isGiftCard?: boolean
  mediaCount: { count: number }
  variants: {
    nodes: Array<{
      title: string
      price: string
      compareAtPrice: string | null
      inventoryQuantity: number | null
      inventoryItem: { tracked: boolean; unitCost: { amount: string } | null } | null
    }>
  }
}
interface ProductsPage {
  products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] }
}

export interface ProductRow {
  title: string
  handle: string
  status: string
  url: string | null
  minPrice: number
  maxPrice: number
  compareAt: number | null
  /** Lowest (price − unit cost) ÷ price across variants with a recorded cost. */
  minMargin: number | null
  inventory: number
  soldOut: string[]
  images: number
  descriptionChars: number
  giftCard: boolean
}

export function toProductRow(p: ProductNode): ProductRow {
  const variants = p.variants.nodes
  const prices = variants.map((v) => Number(v.price)).filter(Number.isFinite)
  const compare = variants.map((v) => Number(v.compareAtPrice)).filter((n) => Number.isFinite(n) && n > 0)
  const margins = variants
    .filter((v) => v.inventoryItem?.unitCost != null && Number(v.price) > 0)
    .map((v) => (Number(v.price) - Number(v.inventoryItem!.unitCost!.amount)) / Number(v.price))
  return {
    title: p.title,
    handle: p.handle,
    status: p.status,
    url: p.onlineStoreUrl,
    minPrice: prices.length > 0 ? Math.min(...prices) : 0,
    maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
    compareAt: compare.length > 0 ? Math.max(...compare) : null,
    minMargin: margins.length > 0 ? Math.min(...margins) : null,
    inventory: variants.reduce((n, v) => n + Math.max(0, v.inventoryQuantity ?? 0), 0),
    soldOut: variants.filter((v) => v.inventoryItem?.tracked === true && (v.inventoryQuantity ?? 0) <= 0).map((v) => v.title),
    images: p.mediaCount.count,
    descriptionChars: (p.description ?? '').trim().length,
    giftCard: p.isGiftCard === true,
  }
}

interface OrderNode {
  createdAt: string
  cancelledAt: string | null
  displayFinancialStatus: string | null
  displayFulfillmentStatus: string | null
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
  totalRefundedSet: { shopMoney: { amount: string } } | null
  discountCodes: string[]
  currentSubtotalLineItemsQuantity: number
  customerJourneySummary: {
    ready: boolean
    lastVisit: { source: string | null; utmParameters: { source: string | null; medium: string | null; campaign: string | null } | null } | null
  } | null
}
interface OrdersPage {
  orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] }
}

export interface SalesSummary {
  days: number
  since: string
  currency: string
  orders: number
  cancelled: number
  revenue: number
  refunded: number
  averageOrder: number
  itemsPerOrder: number
  byDay: Array<{ date: string; orders: number; revenue: number }>
  financialStatus: Record<string, number>
  fulfillmentStatus: Record<string, number>
  discountCodes: Record<string, number>
  /** Orders by where the last visit came from: "utm source / medium", or the source Shopify recorded. */
  sources: Record<string, number>
  /** Orders whose visit attribution Shopify had not finished computing. */
  attributionPending: number
}

export function summariseSales(orders: readonly OrderNode[], days: number, since: string): SalesSummary {
  const live = orders.filter((o) => o.cancelledAt === null)
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1)
  const byDay = new Map<string, { orders: number; revenue: number }>()
  const s: SalesSummary = {
    days,
    since,
    currency: orders[0]?.currentTotalPriceSet.shopMoney.currencyCode ?? '',
    orders: live.length,
    cancelled: orders.length - live.length,
    revenue: 0,
    refunded: 0,
    averageOrder: 0,
    itemsPerOrder: 0,
    byDay: [],
    financialStatus: {},
    fulfillmentStatus: {},
    discountCodes: {},
    sources: {},
    attributionPending: 0,
  }
  let items = 0
  for (const o of live) {
    const total = money(o.currentTotalPriceSet.shopMoney)
    s.revenue += total
    s.refunded += money(o.totalRefundedSet?.shopMoney)
    items += o.currentSubtotalLineItemsQuantity ?? 0
    const day = o.createdAt.slice(0, 10)
    const d = byDay.get(day) ?? { orders: 0, revenue: 0 }
    d.orders += 1
    d.revenue += total
    byDay.set(day, d)
    bump(s.financialStatus, (o.displayFinancialStatus ?? 'UNKNOWN').toLowerCase())
    bump(s.fulfillmentStatus, (o.displayFulfillmentStatus ?? 'UNKNOWN').toLowerCase())
    for (const code of o.discountCodes ?? []) bump(s.discountCodes, code)
    const journey = o.customerJourneySummary
    if (journey === null || journey.ready !== true) {
      s.attributionPending += 1
      continue
    }
    const utm = journey.lastVisit?.utmParameters
    const key =
      utm?.source != null && utm.source !== ''
        ? `${utm.source}${utm.medium ? ` / ${utm.medium}` : ''}`
        : (journey.lastVisit?.source ?? 'direct or unknown')
    bump(s.sources, key)
  }
  s.averageOrder = live.length > 0 ? s.revenue / live.length : 0
  s.itemsPerOrder = live.length > 0 ? items / live.length : 0
  s.byDay = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }))
  return s
}

export interface AuditFinding {
  readonly area: 'products' | 'stock' | 'pricing' | 'trust' | 'pages' | 'offers'
  readonly severity: 'high' | 'medium' | 'low'
  readonly finding: string
}
export interface AuditFacts {
  overview: StoreOverview
  activeProducts: number
  policies: string[]
  pages: string[]
  activeDiscounts: string[]
  findings: AuditFinding[]
}

export function buildAuditFacts(
  overview: StoreOverview,
  products: readonly ProductRow[],
  extra: {
    /** Undefined when the store has not granted read_legal_policies. */
    policies: Array<{ type: string; body: string }> | undefined
    pages: { nodes: Array<{ title: string; handle: string }> }
    codeDiscountNodes: { nodes: Array<{ codeDiscount: { __typename: string; title?: string; status?: string } }> }
  },
): AuditFacts {
  // Gift cards have no stock, photos or sizes to judge.
  const active = products.filter((p) => p.status === 'ACTIVE' && !p.giftCard)
  const findings: AuditFinding[] = []
  const list = (rows: readonly ProductRow[], n = 5) =>
    rows.slice(0, n).map((p) => `"${p.title}"`).join(', ') + (rows.length > n ? ` and ${rows.length - n} more` : '')

  const fewImages = active.filter((p) => p.images < 3)
  if (fewImages.length > 0)
    findings.push({ area: 'products', severity: fewImages.length > active.length / 3 ? 'high' : 'medium', finding: `${fewImages.length} active product(s) have fewer than 3 images: ${list(fewImages)}. Shoppers judge fit and finish from photos.` })
  const thin = active.filter((p) => p.descriptionChars < 200)
  if (thin.length > 0)
    findings.push({ area: 'products', severity: 'medium', finding: `${thin.length} active product(s) have a description under 200 characters: ${list(thin)}.` })
  const partlySoldOut = active.filter((p) => p.soldOut.length > 0 && p.inventory > 0)
  if (partlySoldOut.length > 0)
    findings.push({ area: 'stock', severity: 'medium', finding: `${partlySoldOut.length} product(s) have some sizes/options sold out: ${partlySoldOut.slice(0, 5).map((p) => `"${p.title}" (${p.soldOut.slice(0, 4).join(', ')})`).join('; ')}. Do not advertise sold-out sizes.` })
  const fullySoldOut = active.filter((p) => p.inventory <= 0 && p.soldOut.length > 0)
  if (fullySoldOut.length > 0)
    findings.push({ area: 'stock', severity: 'high', finding: `${fullySoldOut.length} active product(s) are completely sold out but still listed: ${list(fullySoldOut)}.` })
  const lowMargin = active.filter((p) => p.minMargin !== null && p.minMargin < 0.3)
  if (lowMargin.length > 0)
    findings.push({ area: 'pricing', severity: 'high', finding: `${lowMargin.length} product(s) sell at under 30% gross margin on recorded cost: ${list(lowMargin)}. Check before advertising them.` })
  const noCost = active.filter((p) => p.minMargin === null)
  if (noCost.length > 0 && noCost.length === active.length)
    findings.push({ area: 'pricing', severity: 'low', finding: 'No product has a cost per item recorded, so margins cannot be checked from the store. Add costs in Shopify, or give them to the AI.' })

  const policyTypes = (extra.policies ?? []).filter((p) => (p.body ?? '').trim().length > 0).map((p) => p.type)
  if (extra.policies === undefined) {
    findings.push({ area: 'trust', severity: 'low', finding: 'Policies could not be read: the store has not granted the read_legal_policies permission. Check the refund and shipping policies by hand.' })
  } else {
    for (const need of ['REFUND_POLICY', 'SHIPPING_POLICY']) {
      if (!policyTypes.includes(need))
        findings.push({ area: 'trust', severity: 'high', finding: `No ${need.replace('_', ' ').toLowerCase()} is published. Delivery and returns terms are a top reason shoppers hesitate.` })
    }
  }
  const pageTitles = extra.pages.nodes.map((p) => p.title)
  const has = (re: RegExp) => extra.pages.nodes.some((p) => re.test(p.title) || re.test(p.handle))
  if (!has(/faq|question/i)) findings.push({ area: 'pages', severity: 'medium', finding: 'No FAQ page found. Answer delivery time, cash on delivery, sizes and exchanges in one place.' })
  if (!has(/size/i)) findings.push({ area: 'pages', severity: 'medium', finding: 'No size guide page found. For clothing and footwear, a size guide cuts hesitation and returns.' })
  if (!has(/contact/i)) findings.push({ area: 'pages', severity: 'low', finding: 'No contact page found.' })

  const discounts = extra.codeDiscountNodes.nodes
    .map((n) => n.codeDiscount)
    .filter((d) => (d.status ?? '').toUpperCase() === 'ACTIVE')
    .map((d) => d.title ?? d.__typename)

  return { overview, activeProducts: active.length, policies: policyTypes, pages: pageTitles, activeDiscounts: discounts, findings }
}
