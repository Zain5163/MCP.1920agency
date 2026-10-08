import { lookup as dnsLookup } from 'node:dns/promises'
import https from 'node:https'
import { isIP } from 'node:net'

/**
 * HTTPS requests to addresses a user typed in, without letting the user point
 * this server at itself or its neighbours.
 *
 * Every other adapter talks to a platform's fixed API host. The WordPress
 * connector is different: the host is whatever URL a customer gives, and the
 * hosted server runs next to its own database, the cloud provider's metadata
 * service (169.254.169.254) and whatever else is on the private network. A
 * request to "https://10.0.0.5/" or to a name that resolves there would be made
 * with this server's network position — server-side request forgery (SSRF;
 * OWASP SSRF Prevention Cheat Sheet). So, on every request, not only at connect:
 *
 *   1. https only, on port 443, with no user:password@ in the URL;
 *   2. names like "localhost" or a bare "intranet" are refused before DNS;
 *   3. the name is resolved here and EVERY address it returns must be public
 *      (one private answer among public ones is how DNS rebinding is staged);
 *   4. the connection goes to the address that was checked, by overriding the
 *      socket's lookup, so the name cannot be re-resolved to somewhere else
 *      between the check and the connect. TLS still verifies the site's own name;
 *   5. redirects are never followed blindly: each hop is re-checked from step 1,
 *      and by default a redirect to another host is refused outright, so a
 *      site's login header can never be carried to a host the user did not name.
 *
 * Nothing here knows about WordPress; it is the network rule for any
 * user-supplied URL.
 */

export type SafeHttpErrorKind = 'insecure_url' | 'blocked_address' | 'dns' | 'redirect' | 'network' | 'timeout' | 'too_large'

export class SafeHttpError extends Error {
  readonly kind: SafeHttpErrorKind
  /** Where a refused redirect wanted to go, so the caller can suggest connecting that address instead. */
  readonly location?: string

  constructor(message: string, kind: SafeHttpErrorKind, location?: string) {
    super(message)
    this.name = 'SafeHttpError'
    this.kind = kind
    if (location !== undefined) this.location = location
  }
}

// ------------------------------------------------------------------ addresses

type V4Range = readonly [base: number, prefix: number, label: string]

const v4 = (a: number, b: number, c: number, d: number) => ((a << 24) >>> 0) + (b << 16) + (c << 8) + d

/** Every IPv4 block that is not the public internet (IANA special-purpose registry). */
const V4_BLOCKED: readonly V4Range[] = [
  [v4(0, 0, 0, 0), 8, 'a "this network" address'],
  [v4(10, 0, 0, 0), 8, 'a private network address'],
  [v4(100, 64, 0, 0), 10, 'a carrier-grade NAT address'],
  [v4(127, 0, 0, 0), 8, 'this machine (loopback)'],
  [v4(169, 254, 0, 0), 16, 'a link-local address (where cloud metadata services live)'],
  [v4(172, 16, 0, 0), 12, 'a private network address'],
  [v4(192, 0, 0, 0), 24, 'a reserved protocol address'],
  [v4(192, 0, 2, 0), 24, 'a documentation address'],
  [v4(192, 88, 99, 0), 24, 'a reserved relay address'],
  [v4(192, 168, 0, 0), 16, 'a private network address'],
  [v4(198, 18, 0, 0), 15, 'a benchmarking address'],
  [v4(198, 51, 100, 0), 24, 'a documentation address'],
  [v4(203, 0, 113, 0), 24, 'a documentation address'],
  [v4(224, 0, 0, 0), 4, 'a multicast address'],
  [v4(240, 0, 0, 0), 4, 'a reserved address'],
]

function parseV4(ip: string): number | undefined {
  const parts = ip.split('.')
  if (parts.length !== 4) return undefined
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined
    const octet = Number(p)
    if (octet > 255) return undefined
    n = n * 256 + octet
  }
  return n
}

function v4Blocked(n: number): string | undefined {
  for (const [base, prefix, label] of V4_BLOCKED) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    if (((n & mask) >>> 0) === base) return label
  }
  return undefined
}

/** Eight 16-bit groups, or undefined if it is not an IPv6 address. */
function parseV6(ip: string): number[] | undefined {
  let s = ip.toLowerCase()
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  // A dotted IPv4 tail ("::ffff:10.0.0.1") becomes two hex groups.
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted !== null) {
    const n = parseV4(dotted[2]!)
    if (n === undefined) return undefined
    s = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return undefined
  const head = halves[0] === '' ? [] : halves[0]!.split(':')
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return undefined
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  const out: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return undefined
    out.push(parseInt(g, 16))
  }
  return out.length === 8 ? out : undefined
}

function v6Blocked(g: number[]): string | undefined {
  const embedded = (hi: number, lo: number) => ((hi << 16) >>> 0) + lo
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0)
  if (zeros(8)) return 'an unspecified address'
  if (zeros(7) && g[7] === 1) return 'this machine (loopback)'
  // ::ffff:a.b.c.d is an IPv4 address in IPv6 clothing: judge the IPv4 address.
  if (zeros(5) && g[5] === 0xffff) return v4Blocked(embedded(g[6]!, g[7]!))
  if (zeros(6)) return 'a deprecated IPv4-compatible address'
  // NAT64 (64:ff9b::/96, 64:ff9b:1::/48) and 6to4 (2002::/16) carry an IPv4 address: judge it.
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4Blocked(embedded(g[6]!, g[7]!))
  if (g[0] === 0x2002) return v4Blocked(embedded(g[1]!, g[2]!))
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return 'a discard-only address'
  if (g[0] === 0x2001 && g[1]! < 0x200) return 'a reserved protocol address (Teredo, benchmarking, ORCHID)'
  if (g[0] === 0x2001 && g[1] === 0xdb8) return 'a documentation address'
  if ((g[0]! & 0xfe00) === 0xfc00) return 'a private network address (unique local)'
  if ((g[0]! & 0xffc0) === 0xfe80) return 'a link-local address'
  if ((g[0]! & 0xffc0) === 0xfec0) return 'a deprecated site-local address'
  if ((g[0]! & 0xff00) === 0xff00) return 'a multicast address'
  // Fail closed: only global unicast (2000::/3) is the public IPv6 internet.
  if ((g[0]! & 0xe000) !== 0x2000) return 'a reserved address'
  return undefined
}

/**
 * Why this IP address must not be fetched, or undefined when it is a public
 * internet address. Anything unparseable is refused.
 */
export function blockedAddressReason(ip: string): string | undefined {
  const family = isIP(ip.replace(/%.*$/, ''))
  if (family === 4) {
    const n = parseV4(ip)
    return n === undefined ? 'not a valid address' : v4Blocked(n)
  }
  if (family === 6) {
    const g = parseV6(ip)
    return g === undefined ? 'not a valid address' : v6Blocked(g)
  }
  return 'not an IP address'
}

// ------------------------------------------------------------------ URLs

const INTERNAL_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa)$/i

/**
 * Checks a URL's shape before anything is resolved: https, port 443, no
 * credentials in it, a real public-looking host name. Returns the parsed URL or
 * a sentence saying what to change.
 */
export function checkPublicUrl(raw: string): URL | { error: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { error: `"${raw}" is not a web address. It should look like https://www.example.com.` }
  }
  if (url.protocol === 'http:') {
    return {
      error:
        `${url.host} was given as http://, which is not encrypted. AdsPilot only connects over https://, ` +
        'because the site password would otherwise cross the internet readable by anyone on the way. ' +
        'Use the https:// address. If the site has no certificate yet, turn HTTPS on first (most hosts offer a free Let\'s Encrypt certificate in their control panel).',
    }
  }
  if (url.protocol !== 'https:') return { error: `${raw} is not an https:// address.` }
  if (url.username !== '' || url.password !== '') {
    return { error: 'Do not put a username or password inside the address. Give the address alone, and the login separately.' }
  }
  if (url.port !== '' && url.port !== '443') {
    return { error: `${url.host} uses port ${url.port}. AdsPilot connects only to the standard https port (443). Use the site's public address.` }
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) !== 0) {
    const reason = blockedAddressReason(host)
    if (reason !== undefined) return { error: `${host} is ${reason}, not a public website. AdsPilot only connects to sites on the public internet.` }
    return url
  }
  if (!host.includes('.') || INTERNAL_NAME.test(host)) {
    return { error: `"${host}" is not a public internet name. Use the address people type to visit the site, such as https://www.example.com.` }
  }
  return url
}

// ------------------------------------------------------------------ requests

export type AddressResolver = (host: string) => Promise<ReadonlyArray<{ address: string; family: number }>>

export const systemResolver: AddressResolver = async (host) => await dnsLookup(host, { all: true, verbatim: true })

/** Resolves a host and returns an address to connect to, only if every address it has is public. */
export async function resolvePublic(host: string, resolver: AddressResolver = systemResolver): Promise<{ address: string; family: number }> {
  const bare = host.replace(/^\[|\]$/g, '')
  if (isIP(bare) !== 0) {
    const reason = blockedAddressReason(bare)
    if (reason !== undefined) throw new SafeHttpError(`${bare} is ${reason}. AdsPilot only connects to sites on the public internet.`, 'blocked_address')
    return { address: bare, family: isIP(bare) }
  }
  let answers: ReadonlyArray<{ address: string; family: number }>
  try {
    answers = await resolver(bare)
  } catch (cause) {
    throw new SafeHttpError(
      `The name ${bare} could not be found (${cause instanceof Error ? (cause as { code?: string }).code ?? cause.message : String(cause)}). ` +
        'Check the address is spelt exactly as people type it to visit the site, and that the domain has not expired.',
      'dns',
    )
  }
  if (answers.length === 0) throw new SafeHttpError(`The name ${bare} has no address. Check the domain's DNS settings.`, 'dns')
  for (const a of answers) {
    const reason = blockedAddressReason(a.address)
    if (reason !== undefined) {
      throw new SafeHttpError(
        `${bare} points to ${reason} (${a.address}), not to a public website. AdsPilot only connects to sites on the public internet. ` +
          'If this is a site on your own computer or office network, it has to be published on a public host first.',
        'blocked_address',
      )
    }
  }
  return { address: answers[0]!.address, family: answers[0]!.family }
}

export interface SafeRequest {
  readonly url: string
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string | Uint8Array
  /** The most response bytes accepted. Default 5 MB. */
  readonly maxBytes?: number
  readonly timeoutMs?: number
  /**
   * 'same-host' (default): follow redirects only within the same https host,
   * e.g. a trailing slash; refuse any other. 'public': follow to other public
   * https hosts (for downloading a public image from a CDN), without any
   * Authorization header. Only GET requests follow redirects at all.
   */
  readonly redirects?: 'same-host' | 'public'
}

export interface SafeResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Buffer
  /** The URL that answered, after any followed redirect. */
  readonly url: string
}

/** One HTTPS exchange with an address that has already been checked. Injected in tests. */
export type Connector = (target: {
  readonly url: URL
  readonly address: string
  readonly family: number
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | Uint8Array | undefined
  readonly maxBytes: number
  readonly timeoutMs: number
}) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>

export type SafeFetch = (request: SafeRequest) => Promise<SafeResponse>

const MAX_REDIRECTS = 3

/** node:https with the socket pinned to the checked address. */
export const httpsConnector: Connector = (t) =>
  new Promise((resolve, reject) => {
    // The pinned lookup: whatever name the socket asks about, it gets the address
    // that was checked, so a second DNS answer can never change the destination.
    const lookup = (_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) =>
      options?.all === true ? callback(null, [{ address: t.address, family: t.family }]) : callback(null, t.address, t.family)
    const req = https.request(
      {
        host: t.url.hostname.replace(/^\[|\]$/g, ''),
        servername: isIP(t.url.hostname.replace(/^\[|\]$/g, '')) === 0 ? t.url.hostname : undefined,
        port: 443,
        path: `${t.url.pathname}${t.url.search}`,
        method: t.method,
        headers: { ...t.headers, ...(t.body !== undefined ? { 'content-length': String(Buffer.byteLength(t.body)) } : {}) },
        lookup: lookup as never,
        timeout: t.timeoutMs,
        agent: false,
      },
      (res) => {
        const declared = Number(res.headers['content-length'] ?? NaN)
        if (Number.isFinite(declared) && declared > t.maxBytes) {
          res.destroy()
          reject(new SafeHttpError(`${t.url.host} sent ${Math.round(declared / 1_048_576)} MB, more than the ${Math.round(t.maxBytes / 1_048_576)} MB allowed.`, 'too_large'))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > t.maxBytes) {
            res.destroy()
            reject(new SafeHttpError(`${t.url.host} sent more than the ${Math.round(t.maxBytes / 1_048_576)} MB allowed.`, 'too_large'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          const headers: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks) })
        })
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new SafeHttpError(`${t.url.host} did not answer within ${Math.round(t.timeoutMs / 1000)} seconds. The site may be down or very slow; try again in a few minutes.`, 'timeout')))
    req.on('error', (error) => {
      if (error instanceof SafeHttpError) return reject(error)
      reject(
        new SafeHttpError(
          `Could not reach ${t.url.host}: ${(error as { code?: string }).code ?? error.message}. ` +
            'Check the site opens in a browser. A certificate error means the site\'s HTTPS certificate is missing, expired or for another name; the host can renew it.',
          'network',
        ),
      )
    })
    req.end(t.body)
  })

/**
 * Builds the guarded fetch. Tests pass a resolver and a connector; production
 * uses the system resolver and node:https.
 */
export function createSafeFetch(options: { resolver?: AddressResolver; connect?: Connector } = {}): SafeFetch {
  const resolver = options.resolver ?? systemResolver
  const connect = options.connect ?? httpsConnector

  return async (request) => {
    const method = (request.method ?? 'GET').toUpperCase()
    const policy = request.redirects ?? 'same-host'
    let headers: Record<string, string> = { ...request.headers }
    let current = request.url
    for (let hop = 0; ; hop++) {
      const url = checkPublicUrl(current)
      if (!(url instanceof URL)) throw new SafeHttpError(url.error, 'insecure_url')
      const target = await resolvePublic(url.hostname, resolver)
      const res = await connect({
        url,
        address: target.address,
        family: target.family,
        method,
        headers,
        body: request.body,
        maxBytes: request.maxBytes ?? 5 * 1_048_576,
        timeoutMs: request.timeoutMs ?? 30_000,
      })
      const location = res.headers.location
      if (![301, 302, 303, 307, 308].includes(res.status) || location === undefined) {
        return { status: res.status, headers: res.headers, body: res.body, url: url.toString() }
      }
      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        throw new SafeHttpError(`${url.host} redirected to an address that is not valid ("${location.slice(0, 120)}").`, 'redirect')
      }
      const sameHost = next.protocol === 'https:' && next.hostname === url.hostname && (next.port === '' || next.port === '443')
      if (method !== 'GET') {
        // A change sent again to wherever a redirect points could land twice, or
        // somewhere else entirely. Report it instead.
        throw new SafeHttpError(
          `${url.host} answered a change with a redirect to ${next.origin}${next.pathname}, so nothing was sent there. ` +
            (sameHost ? 'The site address may need "www." or a trailing path; reconnect the site with the address it redirects to.' : `If your site really lives at ${next.origin}, connect that address instead.`),
          'redirect',
          next.toString(),
        )
      }
      if (!sameHost && policy === 'same-host') {
        throw new SafeHttpError(
          `${url.host} redirected to ${next.protocol}//${next.host}, a different address, so AdsPilot stopped there (it never sends your login to an address you did not give). ` +
            `If your site really lives at ${next.protocol === 'https:' ? next.origin : `https://${next.host}`}, connect that address instead.`,
          'redirect',
          next.toString(),
        )
      }
      if (hop + 1 > MAX_REDIRECTS) throw new SafeHttpError(`${request.url} redirected more than ${MAX_REDIRECTS} times. Open it in a browser to see where it ends up, and use that address.`, 'redirect')
      if (!sameHost) {
        // Never carry a login to another host.
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'authorization' && k.toLowerCase() !== 'cookie'))
      }
      current = next.toString()
    }
  }
}
