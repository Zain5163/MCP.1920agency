import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Configuration loader.
 *
 * The env file lives OUTSIDE the workspace, at `~/.social-publisher/.env`, because
 * `D:\My AI Works\AGENTS.md` forbids storing keys, tokens or private .env files
 * anywhere under the workspace. Nothing here ever writes a secret back to disk, and
 * no loaded value is logged.
 */

export const CONFIG_DIR = join(homedir(), '.social-publisher')
export const ENV_PATH = join(CONFIG_DIR, '.env')

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Minimal dotenv parser. A dependency is not worth it for this, and a hand-rolled
 * one means no third-party code ever touches the file holding our secrets.
 */
export function parseEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    if (key === '') continue

    let value = line.slice(eq + 1).trim()
    // Strip matching surrounding quotes, so a value with spaces or '#' survives.
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    out[key] = value
  }
  return out
}

let cache: Record<string, string> | undefined

/** Loads the env file. Real process env wins, so CI and one-off overrides work. */
export function loadEnv(path: string = ENV_PATH): Record<string, string> {
  if (cache !== undefined) return cache
  const fromFile = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}
  const merged: Record<string, string> = { ...fromFile }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value
  }
  cache = merged
  return merged
}

/** Test seam. */
export function resetEnvCache(): void {
  cache = undefined
}

export function required(key: string, path: string = ENV_PATH): string {
  const value = loadEnv(path)[key]
  if (value === undefined || value.trim() === '') {
    throw new ConfigError(
      existsSync(path)
        ? `${key} is missing from ${path}. Add it and try again.`
        : `No config file at ${path}. Create it — see SETUP.md step 5.`,
    )
  }
  return value
}

export function optional(key: string, fallback?: string, path: string = ENV_PATH): string | undefined {
  const value = loadEnv(path)[key]
  return value === undefined || value.trim() === '' ? fallback : value
}

/**
 * Reports which required keys are missing, without throwing and without ever
 * revealing a value. Used by the MCP server at startup so a misconfiguration shows
 * up as a clear message rather than a confusing failure mid-publish.
 */
export interface ConfigCheck {
  readonly ok: boolean
  readonly envPath: string
  readonly envFileExists: boolean
  readonly missing: readonly string[]
  readonly present: readonly string[]
}

/**
 * Keys needed to run at all: database, Meta app, and the vault key.
 */
export const CORE_KEYS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'META_APP_ID',
  'META_APP_SECRET',
  'VAULT_MASTER_KEY',
] as const

/**
 * Object storage, required ONLY by platforms that fetch media from a public URL
 * (Instagram, TikTok). Facebook uploads bytes directly, so demanding these up front
 * would block a working Facebook setup for no reason.
 *
 * Supabase Storage rather than Cloudflare R2: the account already exists and no
 * payment card is required. R2 remains a drop-in alternative behind MediaStore.
 */
export const MEDIA_HOSTING_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
] as const

export const REQUIRED_KEYS = CORE_KEYS

export interface ConfigCheckOptions {
  /** Also require object storage. Set when a target platform fetches its media. */
  readonly requireMediaHosting?: boolean
}

export function checkConfig(path: string = ENV_PATH, options: ConfigCheckOptions = {}): ConfigCheck {
  const env = loadEnv(path)
  const keys: string[] = [
    ...CORE_KEYS,
    ...(options.requireMediaHosting === true ? MEDIA_HOSTING_KEYS : []),
  ]

  const missing: string[] = []
  const present: string[] = []
  for (const key of keys) {
    const value = env[key]
    if (value === undefined || value.trim() === '') missing.push(key)
    else present.push(key)
  }
  return {
    ok: missing.length === 0,
    envPath: path,
    envFileExists: existsSync(path),
    missing,
    present,
  }
}

/** Reports whether Instagram/TikTok media hosting is configured, without failing. */
export function mediaHostingReady(path: string = ENV_PATH): boolean {
  const env = loadEnv(path)
  return MEDIA_HOSTING_KEYS.every((k) => {
    const v = env[k]
    return v !== undefined && v.trim() !== ''
  })
}
