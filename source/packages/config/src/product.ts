import { optional } from './env.ts'

/**
 * The product's identity and public addresses: every value that changes when the
 * product is renamed, the company changes, or the server moves to another domain.
 *
 * WHY one module: "AdsPilot" is a working name and the domain is temporary
 * (owner, 2026-10-10: "change only one thing, at one place, like in env files").
 * Before this, the name was written out in ~100 messages, tool descriptions and
 * pages, and the domain in code, scripts, Caddy and docs. Every app and package
 * now asks this module; nothing else reads these env names or repeats the
 * literals, and `test/central-config.test.ts` fails if one comes back.
 *
 * How a value is chosen: the environment (process env, then
 * ~/.social-publisher/.env, see env.ts) wins; otherwise the default below.
 *
 *   - Permanent rename: change the default in PRODUCT_DEFAULTS, run the tests,
 *     release. One edit, everywhere (messages, tools, pages, served skills).
 *   - Trying a name on one machine: set PRODUCT_NAME in that machine's env file.
 *
 * Where the product RUNS (domain, server, SSH key, paths) is not here: that is
 * deploy/site.env, the single source for the deployment. The hosted server gets
 * PUBLIC_BASE_URL from it (docker-compose.yml builds it from DOMAIN), so no
 * domain is written in code at all.
 *
 * Read lazily, never at import: a module that read the env file while being
 * imported would freeze the value before tests or one-off overrides could set it.
 */
export const PRODUCT_DEFAULTS = {
  /** Shown to people: messages, tool descriptions, pages, served skills. A working name. */
  PRODUCT_NAME: 'AdsPilot',
  /**
   * The lower-case machine name people see: the MCP server name, the key in the
   * client config snippet, the resource URI scheme (<slug>://skills/...), log prefixes.
   */
  PRODUCT_SLUG: 'adspilot',
  /** The business behind it: the first workspace's name, the Shopify app's name. */
  COMPANY_NAME: '1920 Agency',
  /**
   * The port the PC's one-shot OAuth listener uses, and so the port the hosted
   * server's bounce sends the browser to. deploy/site.env OAUTH_BOUNCE_PORT must
   * be the same number (tested), because the bounce is rendered from that file.
   */
  OAUTH_CALLBACK_PORT: '8787',
  /** The port the MCP's HTTP server listens on inside its container or on the PC. */
  MCP_PORT: '8080',
} as const

export type ProductSettingName = keyof typeof PRODUCT_DEFAULTS

/** The configured value, or the default. Empty means unset, as everywhere in env.ts. */
export function productSetting(name: ProductSettingName): string {
  return optional(name) ?? PRODUCT_DEFAULTS[name]
}

/** The product's display name, e.g. "AdsPilot". */
export function productName(): string {
  return productSetting('PRODUCT_NAME')
}

/** The product's lower-case machine name, e.g. "adspilot". */
export function productSlug(): string {
  return productSetting('PRODUCT_SLUG')
}

/** The company behind the product, e.g. "1920 Agency". */
export function companyName(): string {
  return productSetting('COMPANY_NAME')
}

/**
 * The Shopify app's name as merchants see it when installing. Registered with
 * Shopify (integrations/shopify-app/shopify.app.toml, checked against this by a
 * test), so changing it also needs `shopify app deploy` there.
 */
export function shopifyAppName(): string {
  return optional('SHOPIFY_APP_NAME') ?? `${companyName()} Store Connector`
}

/**
 * The hosted server's public address, without a trailing slash, e.g.
 * "https://mcp.example.com". No default on purpose: the server's comes from
 * deploy/site.env (compose sets PUBLIC_BASE_URL=https://<DOMAIN>), and a PC
 * without one has no public address. Callers that need it say so (RULES R1).
 */
export function publicBaseUrl(): string | undefined {
  const value = optional('PUBLIC_BASE_URL')
  return value === undefined ? undefined : value.trim().replace(/\/+$/, '')
}

/** The port the MCP's HTTP server listens on. */
export function mcpPort(): number {
  return Number(productSetting('MCP_PORT'))
}

/**
 * The MCP address shown to people connecting an AI app (dashboard Tokens page).
 * MCP_PUBLIC_URL when set; else the public address's /mcp; else this machine.
 */
export function mcpPublicUrl(): string {
  const explicit = optional('MCP_PUBLIC_URL')
  if (explicit !== undefined) return explicit
  const base = publicBaseUrl()
  return base !== undefined ? `${base}/mcp` : `http://localhost:${mcpPort()}/mcp`
}

/** Where to send someone who wants Premium. Unset until checkout exists. */
export function upgradeUrl(): string | undefined {
  return optional('UPGRADE_URL')
}

/** The default OAuth listener port, as a number (OAUTH_CALLBACK_PORT's default). */
export const DEFAULT_OAUTH_CALLBACK_PORT = Number(PRODUCT_DEFAULTS.OAUTH_CALLBACK_PORT)

/**
 * The callback path of every OAuth redirect address, keyed by its env name.
 *
 * WHY here: the same default addresses were written out in the CLI, the worker,
 * the dashboard and the adapters. The hosted bounce (deploy/caddy template)
 * forwards exactly these paths; a test keeps the two equal.
 */
export const OAUTH_REDIRECT_PATHS = {
  META_REDIRECT_URI: '/callback',
  INSTAGRAM_REDIRECT_URI: '/instagram/callback',
  THREADS_REDIRECT_URI: '/threads/callback',
  PINTEREST_REDIRECT_URI: '/pinterest/callback',
  LINKEDIN_REDIRECT_URI: '/linkedin/callback',
  LINKEDIN_PAGE_REDIRECT_URI: '/linkedin-page/callback',
  GOOGLE_REDIRECT_URI: '/google/callback',
} as const

export type OAuthRedirectName = keyof typeof OAUTH_REDIRECT_PATHS

/**
 * Where redirect addresses point when their own *_REDIRECT_URI is not set.
 * Default: this PC's listener, http://localhost:8787. Set OAUTH_REDIRECT_BASE to
 * the public address (https://<DOMAIN>) to send every provider through the
 * hosted bounce at once, after registering those addresses with the providers.
 */
export function oauthRedirectBase(): string {
  const value = optional('OAUTH_REDIRECT_BASE') ?? `http://localhost:${DEFAULT_OAUTH_CALLBACK_PORT}`
  return value.trim().replace(/\/+$/, '')
}

/** The default redirect address for one provider, ignoring its own *_REDIRECT_URI. */
export function defaultOAuthRedirectUri(name: OAuthRedirectName): string {
  return `${oauthRedirectBase()}${OAUTH_REDIRECT_PATHS[name]}`
}

/**
 * One provider's redirect address: its own *_REDIRECT_URI when set (every
 * existing env file keeps working unchanged), else the derived default.
 */
export function oauthRedirectUri(name: OAuthRedirectName): string {
  return optional(name) ?? defaultOAuthRedirectUri(name)
}

/**
 * Names that already exist outside this code and do NOT change with a rename:
 * renaming them would break something live (a Windows task the monitor checks,
 * on the owner's PC). Kept here so the literal still exists in one place only.
 */
export const FIXED_NAMES = {
  /** Windows Task Scheduler tasks on the owner's PC, created by hand (SETUP.md). */
  PC_WORKER_TASK: 'AdsPilot-Worker',
  PC_MONITOR_TASK: 'AdsPilot-Monitor',
  PC_REFRESH_TASK: 'AdsPilot-Refresh',
} as const

/**
 * Fills the placeholders in text we write and serve (our own skills, served
 * through get_skill): {{PRODUCT_NAME}}, {{PRODUCT_SLUG}}, {{COMPANY_NAME}}.
 * Third-party skills are never passed through this: their text stays theirs.
 */
export function renderProductText(text: string): string {
  return text
    .replaceAll('{{PRODUCT_NAME}}', productName())
    .replaceAll('{{PRODUCT_SLUG}}', productSlug())
    .replaceAll('{{COMPANY_NAME}}', companyName())
}

/**
 * The name split for the two-colour wordmark in the dashboard header: before and
 * from the last inner capital ("AdsPilot" -> "Ads" + "Pilot"). A name without an
 * inner capital is all first part, so any future name still renders.
 */
export function wordmarkParts(name: string = productName()): readonly [string, string] {
  for (let i = name.length - 1; i > 0; i--) {
    const c = name[i]!
    if (c >= 'A' && c <= 'Z') return [name.slice(0, i), name.slice(i)]
  }
  return [name, '']
}
