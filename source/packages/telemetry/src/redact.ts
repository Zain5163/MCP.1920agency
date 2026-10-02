/**
 * Redaction.
 *
 * Runs on everything before it is logged, without exception. Logs get forwarded to
 * Slack, sit in files, and are read during debugging — all places a credential must
 * never reach. The whole point of encrypting tokens at rest is undone by one
 * console.log of a request body.
 *
 * Deliberately over-eager: a redacted value that did not need redacting costs
 * nothing, while one leaked token is a breach.
 */

/** Field names whose values are always replaced, however they are nested. */
const SECRET_KEYS = [
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'token',
  'password',
  'secret',
  'appsecret_proof',
  'app_secret',
  'appSecret',
  'client_secret',
  'clientSecret',
  'secretCiphertext',
  'authorization',
  'apikey',
  'api_key',
  'apiKey',
  'service_role',
  'serviceRoleKey',
  'VAULT_MASTER_KEY',
  'DATABASE_URL',
  'DIRECT_URL',
  'cookie',
  'session',
]

const SECRET_KEY_SET = new Set(SECRET_KEYS.map((k) => k.toLowerCase()))

/** Shapes that look like credentials wherever they appear in free text. */
const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Meta tokens
  [/\bEAA[A-Za-z0-9]{20,}\b/g, '[redacted:meta-token]'],
  // Google access tokens (an hour long), refresh tokens (live until revoked) and
  // OAuth client secrets. A refresh token is the one that matters most: unlike
  // the access token it does not expire, so a leaked one is a standing key to
  // the channel. The length floors keep ordinary text such as "1//" in a path
  // from matching.
  [/\bya29\.[A-Za-z0-9._-]{20,}/g, '[redacted:google-access-token]'],
  [/\b1\/\/[A-Za-z0-9._-]{20,}/g, '[redacted:google-refresh-token]'],
  [/\bGOCSPX-[A-Za-z0-9_-]{10,}/g, '[redacted:google-client-secret]'],
  // JWTs, which is what Supabase keys are
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted:jwt]'],
  // Postgres URLs with inline credentials
  [/\bpostgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted:database-url]'],
  // Bearer headers
  [/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, 'Bearer [redacted]'],
  // Generic long hex, which catches appsecret_proof
  [/\b[a-f0-9]{40,}\b/gi, '[redacted:hex]'],
]

export function redactText(input: string): string {
  let output = input
  for (const [pattern, replacement] of PATTERNS) output = output.replace(pattern, replacement)
  return output
}

/**
 * Deep-redacts a value. Keys are matched case-insensitively, values are pattern
 * scanned, and unknown shapes degrade to a safe string rather than being emitted raw.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[redacted:too-deep]'
  if (value === null || value === undefined) return value

  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function') return '[function]'

  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      ...(value.stack !== undefined ? { stack: redactText(value.stack) } : {}),
    }
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))

  if (value instanceof Map) return redact(Object.fromEntries(value), depth + 1)
  if (value instanceof Set) return redact([...value], depth + 1)
  if (ArrayBuffer.isView(value)) return `[binary:${value.byteLength} bytes]`

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_SET.has(key.toLowerCase()) ? '[redacted]' : redact(item, depth + 1)
    }
    return out
  }

  return '[unserialisable]'
}
