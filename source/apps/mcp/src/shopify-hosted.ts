import type { ServerResponse } from 'node:http'
import { createHmac } from 'node:crypto'
import { join } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  ShopifyAdminClient,
  ShopifyError,
  authorizeUrl,
  exchangeCode,
  normaliseShop,
  refreshAccessToken,
  signState,
  verifyShopifyHmac,
  verifyState,
  type ShopifyTokenSet,
} from '@social-publisher/adapters'
import { CONFIG_DIR, optional } from '@social-publisher/config'
import { listProviderAuths, markProviderAuthNeedsReauth, providerAuthCredentialStore, saveProviderAuth } from '@social-publisher/db'
import { TokenVault, parseKey, type StoredCredential } from '@social-publisher/vault'

import { audit, guarded, type ToolResult } from './ads-tools.ts'
import { registerShopifyTools, registerShopifyWriteTools, type ShopifyAccess, type ShopifyStoreEntry } from './shopify-tools.ts'

/**
 * Hosted Shopify: each AdsPilot user connects their own store from their AI chat.
 *
 *   1. In the chat, shopify_connect_store returns Shopify's consent link for the
 *      user's store, carrying a signed `state`: this AdsPilot account, this store,
 *      valid 15 minutes.
 *   2. The user approves in Shopify. Shopify sends their browser to
 *      PUBLIC_BASE_URL/shopify/callback, handled on the server (handleShopifyCallback):
 *      Shopify's signature and AdsPilot's state are both checked, the one-time code
 *      is exchanged with the app secret (which only the server holds), and the
 *      expiring token is stored encrypted in the vault under that account only
 *      (provider_auths, provider "shopify", one row per store).
 *   3. Every Shopify tool then works on that user's stores, renewing the hourly
 *      token from the 90-day refresh token through the vault.
 *
 * Theme tools stay local: theme writes need a Shopify exemption or a person's login.
 */

/** Must match integrations/shopify-app/shopify.app.toml. */
export const SHOPIFY_SCOPES =
  'read_products,read_inventory,read_orders,read_returns,read_discounts,read_themes,read_content,' +
  'read_online_store_navigation,read_legal_policies,write_products,write_content,' +
  'write_online_store_navigation,write_themes,write_discounts'

const PROVIDER = 'shopify'
const STATE_TTL_MS = 15 * 60_000

interface HostedConfig {
  clientId: string
  clientSecret: string
  baseUrl: string
  /** Signs `state`. Derived from the app secret so there is no second secret to manage. */
  stateKey: string
}

export function shopifyHostedConfig(): HostedConfig | { error: string } {
  const clientId = optional('SHOPIFY_CONNECTOR_CLIENT_ID')
  const clientSecret = optional('SHOPIFY_CONNECTOR_CLIENT_SECRET')
  if (clientId === undefined || clientSecret === undefined) {
    return { error: 'Shopify is not set up on this AdsPilot server yet (SHOPIFY_CONNECTOR_CLIENT_ID / SECRET missing).' }
  }
  return {
    clientId,
    clientSecret,
    baseUrl: optional('PUBLIC_BASE_URL', 'https://mcp.1920agency.com')!.replace(/\/+$/, ''),
    stateKey: createHmac('sha256', clientSecret).update('adspilot-shopify-state-v1').digest('base64url'),
  }
}

let vaultInstance: TokenVault | undefined
function vault(): TokenVault {
  if (vaultInstance === undefined) {
    const key = optional('VAULT_MASTER_KEY')
    if (key === undefined) throw new Error('VAULT_MASTER_KEY is not set on this server.')
    vaultInstance = new TokenVault({ kek: parseKey(key, 'VAULT_MASTER_KEY'), keyVersion: 1, store: providerAuthCredentialStore() })
  }
  return vaultInstance
}

const toStored = (t: ShopifyTokenSet, previous?: StoredCredential): StoredCredential => ({
  accessToken: t.accessToken,
  ...(t.refreshToken !== undefined ? { refreshToken: t.refreshToken } : previous?.refreshToken !== undefined ? { refreshToken: previous.refreshToken } : {}),
  ...(t.expiresAt !== undefined ? { expiresAt: t.expiresAt } : {}),
  // The column records when the whole authorisation ends: the refresh token's expiry.
  authorisationExpiresAt: t.refreshExpiresAt ?? previous?.authorisationExpiresAt ?? null,
  scopes: t.scopes.length > 0 ? t.scopes : (previous?.scopes ?? []),
})

/** A network blip while renewing must not mark a working store as disconnected. */
function asTransient(error: unknown): unknown {
  if (error instanceof ShopifyError && (error.kind === 'network' || error.kind === 'throttled')) {
    return Object.assign(error, { failureClass: 'transient' })
  }
  return error
}

/** The stores one AdsPilot account has connected, with tokens from the vault. */
export function hostedShopifyAccess(tenantId: string): ShopifyAccess {
  const entries = async (): Promise<Array<ShopifyStoreEntry & { authId: string }> | { error: string }> => {
    const auths = await listProviderAuths(tenantId)
    return auths
      .filter((a) => a.provider === PROVIDER && !a.needsReauth)
      .map((a) => ({ key: a.externalUserId.replace(/\.myshopify\.com$/, ''), name: a.displayName ?? a.externalUserId, shop: a.externalUserId, authId: a.id }))
  }
  return {
    list: async () => {
      const e = await entries()
      return 'error' in e ? e : e.map(({ authId: _id, ...rest }) => rest)
    },
    open: async (selector) => {
      const config = shopifyHostedConfig()
      if ('error' in config) return config
      const e = await entries()
      if ('error' in e) return e
      const wanted = selector.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      const hit = e.find((s) => s.key === wanted || s.shop === wanted || s.name.toLowerCase() === wanted)
      if (hit === undefined) {
        return {
          error:
            e.length === 0
              ? 'No Shopify store connected to this account yet. Use shopify_connect_store with your store address.'
              : `No connected store called "${selector}". Connected: ${e.map((s) => `${s.name} (${s.shop})`).join(', ')}.`,
        }
      }
      const renew = async (current: StoredCredential): Promise<StoredCredential> => {
        if (current.refreshToken === undefined) throw new ShopifyError('This store has no refresh token; reconnect it.', 'auth')
        try {
          const t = await refreshAccessToken({ shop: hit.shop, clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: current.refreshToken })
          return toStored(t, current)
        } catch (error) {
          throw asTransient(error)
        }
      }
      const client = new ShopifyAdminClient({
        shop: hit.shop,
        tokenProvider: async ({ forceRefresh }) =>
          await vault().withCredential(
            hit.authId,
            tenantId,
            async (cred) => {
              if (!forceRefresh) return cred.accessToken
              // Shopify refused the token although it had not expired: renew once now.
              const renewed = { ...cred, ...(await renew(cred)) }
              await vault().store(hit.authId, tenantId, renewed)
              return renewed.accessToken
            },
            renew,
          ),
      })
      return { client, store: { key: hit.key, name: hit.name, shop: hit.shop } }
    },
    backupDir: (store) => join(optional('SHOPIFY_BACKUP_DIR', join(CONFIG_DIR, 'shopify-backups'))!, 'tenants', tenantId, store.shop),
  }
}

const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })

/** Hosted tool set: connect, disconnect, and every read and change tool on the user's own stores. */
export function registerHostedShopifyTools(server: McpServer, tenantId: string): void {
  server.tool(
    'shopify_connect_store',
    "Connect the user's Shopify store to AdsPilot. Returns a Shopify link: the user opens it, logs in to their store, and approves. Nothing is shared with AdsPilot except an access key for this store, stored encrypted for this account only. The link works for 15 minutes.",
    { shop: z.string().describe('The store address, e.g. "my-store.myshopify.com" or just "my-store".') },
    async ({ shop }) =>
      await guarded(async () => {
        const config = shopifyHostedConfig()
        if ('error' in config) return text(config.error)
        const normalised = normaliseShop(shop)
        if (normalised === undefined) {
          return text(`"${shop}" is not a Shopify store address. It looks like "your-store.myshopify.com" (Shopify admin → Settings → Domains).`)
        }
        const state = signState({ tenantId, shop: normalised, expiresAt: Date.now() + STATE_TTL_MS }, config.stateKey)
        const link = authorizeUrl({ shop: normalised, clientId: config.clientId, scopes: SHOPIFY_SCOPES, redirectUri: `${config.baseUrl}/shopify/callback`, state })
        return text(
          [
            `Open this link, log in to ${normalised} if asked, and approve:`,
            link,
            '',
            'Shopify shows exactly what AdsPilot may read and change. Nothing changes on the store without your approval in this chat.',
            'When it says "Connected", come back here and ask for list_shopify_stores or a store audit.',
          ].join('\n'),
        )
      }),
  )

  server.tool(
    'shopify_disconnect_store',
    'Disconnect a Shopify store from this AdsPilot account. AdsPilot stops using its access key at once. (To remove the app entirely, the store owner can also uninstall it in Shopify admin → Settings → Apps.)',
    { store: z.string() },
    async ({ store }) =>
      await guarded(async () => {
        const auths = (await listProviderAuths(tenantId)).filter((a) => a.provider === PROVIDER)
        const wanted = store.trim().toLowerCase()
        const hit = auths.find((a) => a.externalUserId === wanted || a.externalUserId === `${wanted}.myshopify.com` || (a.displayName ?? '').toLowerCase() === wanted)
        if (hit === undefined) return text(`No connected store called "${store}".`)
        await markProviderAuthNeedsReauth(tenantId, hit.id, 'disconnected by user')
        await audit('shopify.store.disconnected', { shop: hit.externalUserId })
        return text(`${hit.displayName ?? hit.externalUserId} is disconnected. AdsPilot no longer uses its access key.`)
      }),
  )

  const access = hostedShopifyAccess(tenantId)
  registerShopifyTools(server, access)
  registerShopifyWriteTools(server, access)
}

// ------------------------------------------------------------------ callback page

const page = (title: string, message: string, ok: boolean) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}
h1{font-size:1.4rem;color:${ok ? '#0a7a3d' : '#b42318'}}p{line-height:1.5}</style></head>
<body><h1>${title}</h1><p>${message}</p></body></html>`

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function respond(res: ServerResponse, status: number, title: string, message: string): void {
  const body = page(escapeHtml(title), escapeHtml(message), status === 200)
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * GET /shopify/callback. Unauthenticated by design: the browser arriving here
 * carries no AdsPilot token. Trust comes from two signatures instead: Shopify's
 * (the query HMAC, with the app secret) and AdsPilot's own (the state).
 */
export async function handleShopifyCallback(
  url: URL,
  res: ServerResponse,
  deps: {
    exchange?: typeof exchangeCode
    save?: (input: { tenantId: string; shop: string; tokens: ShopifyTokenSet; displayName: string }) => Promise<void>
    shopName?: (shop: string, accessToken: string) => Promise<string>
    log?: (event: string, data: Record<string, unknown>) => void
  } = {},
): Promise<void> {
  const config = shopifyHostedConfig()
  if ('error' in config) return respond(res, 503, 'Not available', 'Shopify connections are not set up on this server yet.')

  if (!verifyShopifyHmac(url.searchParams, config.clientSecret)) {
    deps.log?.('shopify.callback.bad_hmac', {})
    return respond(res, 400, 'Could not connect', 'This link was not signed by Shopify. Start again from your AI chat.')
  }
  const shop = normaliseShop(url.searchParams.get('shop') ?? '')
  const code = url.searchParams.get('code')
  const stateToken = url.searchParams.get('state')
  if (shop === undefined || code === null || stateToken === null) {
    return respond(res, 400, 'Could not connect', 'Shopify did not send everything needed. Start again from your AI chat.')
  }
  const state = verifyState(stateToken, config.stateKey)
  if ('error' in state) return respond(res, 400, 'Could not connect', state.error)
  if (state.shop !== shop) {
    deps.log?.('shopify.callback.shop_mismatch', { asked: state.shop, got: shop })
    return respond(res, 400, 'Could not connect', `This link was made for ${state.shop}, but Shopify returned ${shop}. Ask for a new link for the right store.`)
  }

  let tokens: ShopifyTokenSet
  try {
    tokens = await (deps.exchange ?? exchangeCode)({ shop, clientId: config.clientId, clientSecret: config.clientSecret, code })
  } catch (error) {
    deps.log?.('shopify.callback.exchange_failed', { shop, error: error instanceof Error ? error.message : String(error) })
    return respond(res, 502, 'Could not connect', 'Shopify did not issue an access key. The link may have been used already. Ask for a new one in your AI chat.')
  }

  const displayName = await (deps.shopName ?? defaultShopName)(shop, tokens.accessToken).catch(() => shop)
  await (deps.save ?? saveConnection)({ tenantId: state.tenantId, shop, tokens, displayName })
  deps.log?.('shopify.callback.connected', { shop })
  return respond(res, 200, 'Connected', `${displayName} is connected to AdsPilot. You can close this tab and go back to your AI chat.`)
}

async function defaultShopName(shop: string, accessToken: string): Promise<string> {
  const client = new ShopifyAdminClient({ shop, tokenProvider: async () => accessToken })
  return (await client.graphql<{ shop: { name: string } }>('{ shop { name } }')).shop.name
}

async function saveConnection(input: { tenantId: string; shop: string; tokens: ShopifyTokenSet; displayName: string }): Promise<void> {
  // Row first, then the vault seals the token into it (the same order as the CLI's connect).
  const auth = await saveProviderAuth({
    tenantId: input.tenantId,
    provider: PROVIDER,
    externalUserId: input.shop,
    displayName: input.displayName,
    secretCiphertext: '',
    keyVersion: 1,
    scopes: input.tokens.scopes,
    expiresAt: input.tokens.refreshExpiresAt ?? null,
  })
  await vault().store(auth.id, input.tenantId, toStored(input.tokens))
}
