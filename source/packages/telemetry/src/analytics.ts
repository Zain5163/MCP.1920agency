import { randomUUID } from 'node:crypto'

import { PLANS, industryOf } from '@social-publisher/core'

import { redactText } from './redact.ts'

/**
 * Product analytics: server-side events to PostHog Cloud EU (Phase 2 of
 * docs/architecture/2026-10-08-plans-usage-analytics-hosting.md).
 *
 * This answers "which tools are used, where do people get stuck, what makes
 * them upgrade". It is not the record of what happened: every MCP call is
 * already a row in `tool_calls`, and the redacted logger (logger.ts) keeps the
 * operational detail. So analytics is allowed to lose events, and is never
 * allowed to cost a customer anything: it never throws into a caller, never
 * makes a tool wait, and cannot grow without limit.
 *
 * WHY a small fetch client instead of posthog-node (MIT, and the official
 * SDK): we use one endpoint, POST /batch/, with a JSON body. The SDK brings
 * feature flags, a person/group API and its own retry and queue logic, none of
 * which is used, and its behaviour on failure is its own. Here the guarantees
 * the owner needs — fire-and-forget, a hard queue bound, drop-not-retry, flush
 * on exit, nothing ever thrown — are thirty lines this project owns and tests
 * with a fake fetch, and no third-party code is added to a process that holds
 * platform tokens. If feature flags are ever wanted, posthog-node is the
 * drop-in replacement behind the same `Analytics` interface.
 *
 * Privacy, enforced here rather than trusted to each call site:
 *   - distinct_id is the tenant id, and only something shaped like an id is
 *     accepted, so an email or a name cannot become one by mistake;
 *   - properties pass an explicit allow-list of names (ALLOWED_PROPERTIES), and
 *     each value must be a short plain token: no URLs, no query strings, no
 *     emails, no free text, nothing the redactor would touch. Tool arguments,
 *     post and ad text, tokens and personal data have no name on the list, so
 *     they are dropped even if a caller passes them;
 *   - GeoIP is disabled on every event ($geoip_disable): from a server it
 *     would only record the data centre, and we have no need for a location.
 * Written up for the privacy policy in docs/architecture/2026-10-08-plans-usage-
 * analytics-hosting.md, "Privacy notes (analytics)".
 */

/** Every event this product sends. A name not on this list is not sent. */
export const ANALYTICS_EVENTS = [
  'mcp_call',
  'limit_notice_shown',
  'limit_reached',
  'upgrade_clicked',
  'publish_failed',
  // Declared for the connect flows and signup (Phase 4); not emitted yet, see
  // the architecture doc's Phase 2 status for why.
  'connect_completed',
  'connect_failed',
  'signup',
] as const
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number]

/**
 * The only property names that ever leave the process. Adding one is a
 * privacy decision: it belongs in the privacy notes too.
 */
export const ALLOWED_PROPERTIES = [
  'tool',
  'ok',
  'error_code',
  'duration_ms',
  'client_name',
  'client_version',
  'transport',
  'plan',
  'industry',
  'threshold',
  'platform',
  'resolution_code',
  'will_retry',
  'source',
] as const
export type AnalyticsProperty = (typeof ALLOWED_PROPERTIES)[number]
export type AnalyticsValue = string | number | boolean
export type AnalyticsProperties = { readonly [K in AnalyticsProperty]?: AnalyticsValue | undefined }

export interface AnalyticsEvent {
  readonly event: AnalyticsEventName
  /** The tenant id. Never an email, a name or a token: anything not shaped like an id drops the event. */
  readonly tenantId: string
  readonly properties?: AnalyticsProperties
}

export interface Analytics {
  /** False when no key is configured: every method then does nothing. */
  readonly enabled: boolean
  /** Queues the event and returns at once. Never throws, never waits. */
  capture(event: AnalyticsEvent): void
  /** Sends what is queued. Never rejects. */
  flush(): Promise<void>
  /** Stops the timer and sends what is queued, waiting at most `timeoutMs`. Never rejects. */
  shutdown(timeoutMs?: number): Promise<void>
}

const ALLOWED = new Set<string>(ALLOWED_PROPERTIES)
const EVENTS = new Set<string>(ANALYTICS_EVENTS)

/** cuid and uuid shapes. An email has '@' and a name has spaces, so neither passes. */
const DISTINCT_ID = /^[A-Za-z0-9_-]{8,64}$/
/**
 * A property value is a short plain token: a tool name, an error code, a
 * client name and version. No '?', '&', '=', '@', '#' or quotes, so no query
 * string, email or markup fits.
 */
const PLAIN_VALUE = /^[A-Za-z0-9 ._:+/()-]{1,120}$/

/**
 * Keeps only allow-listed names with safe values. Exported so the rule is
 * tested on its own, and so nothing else needs to reimplement it.
 */
export function safeProperties(input: Readonly<Record<string, unknown>> | undefined): Record<string, AnalyticsValue> {
  const out: Record<string, AnalyticsValue> = {}
  if (input === undefined || input === null || typeof input !== 'object') return out
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED.has(key)) continue
    const safe = safeValue(key, value)
    if (safe !== undefined) out[key] = safe
  }
  return out
}

function safeValue(key: string, value: unknown): AnalyticsValue | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined
  if (typeof value !== 'string') return undefined

  // Closed lists are checked against the list, not only the shape.
  if (key === 'industry') return industryOf(value)
  if (key === 'plan') return (PLANS as readonly string[]).includes(value) ? value : undefined

  const trimmed = value.trim()
  if (!PLAIN_VALUE.test(trimmed)) return undefined
  // A URL (scheme or protocol-relative) is never a token, with or without a query.
  if (trimmed.includes('//')) return undefined
  // Anything the log redactor would touch is a credential shape: not sent at all.
  if (redactText(trimmed) !== trimmed) return undefined
  return trimmed
}

/** What PostHog's /batch/ endpoint takes for one event. */
interface WireEvent {
  readonly event: string
  readonly distinct_id: string
  readonly timestamp: string
  readonly uuid: string
  readonly properties: Record<string, unknown>
}

export interface PostHogOptions {
  /** The project's public capture key, phc_… */
  readonly apiKey: string
  /** https only, e.g. https://eu.i.posthog.com */
  readonly host: string
  readonly fetch?: typeof globalThis.fetch
  /** Send once this many are queued. */
  readonly flushAt?: number
  /** And at least this often while events are waiting. */
  readonly flushIntervalMs?: number
  /** Beyond this, new events are dropped: an unreachable PostHog must not grow memory. */
  readonly maxQueueSize?: number
  readonly maxBatchSize?: number
  readonly requestTimeoutMs?: number
  /** Told about failures, once per kind. Must not throw; never given the key. */
  readonly onError?: (message: string) => void
  readonly now?: () => Date
}

export class NoopAnalytics implements Analytics {
  readonly enabled = false
  capture(): void {}
  async flush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

export class PostHogAnalytics implements Analytics {
  readonly enabled = true
  readonly #apiKey: string
  readonly #endpoint: string
  readonly #fetch: typeof globalThis.fetch
  readonly #flushAt: number
  readonly #flushIntervalMs: number
  readonly #maxQueueSize: number
  readonly #maxBatchSize: number
  readonly #requestTimeoutMs: number
  readonly #onError: (message: string) => void
  readonly #now: () => Date

  #queue: WireEvent[] = []
  #timer: ReturnType<typeof setInterval> | undefined
  /** One send at a time, so a second flush waits for the first and nothing is sent twice. */
  #inflight: Promise<void> = Promise.resolve()
  #closed = false
  /** Failure kinds already reported, so an outage is one line, not one per batch. */
  readonly #reported = new Set<string>()

  constructor(options: PostHogOptions) {
    this.#apiKey = options.apiKey
    this.#endpoint = `${options.host.replace(/\/+$/, '')}/batch/`
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.#flushAt = Math.max(1, options.flushAt ?? 20)
    this.#flushIntervalMs = Math.max(100, options.flushIntervalMs ?? 10_000)
    this.#maxQueueSize = Math.max(1, options.maxQueueSize ?? 1_000)
    this.#maxBatchSize = Math.max(1, options.maxBatchSize ?? 100)
    this.#requestTimeoutMs = Math.max(100, options.requestTimeoutMs ?? 5_000)
    this.#onError = options.onError ?? (() => {})
    this.#now = options.now ?? (() => new Date())
  }

  /** Events waiting to be sent. For tests and for check_status, never for logic. */
  get queued(): number {
    return this.#queue.length
  }

  capture(input: AnalyticsEvent): void {
    try {
      if (this.#closed) return
      if (!EVENTS.has(input.event)) return this.#report('event', `unknown analytics event "${String(input.event)}" was not sent`)
      if (typeof input.tenantId !== 'string' || !DISTINCT_ID.test(input.tenantId)) {
        return this.#report('distinct_id', 'an analytics event without a valid tenant id was not sent')
      }
      if (this.#queue.length >= this.#maxQueueSize) {
        return this.#report('queue_full', `analytics queue is full (${this.#maxQueueSize}); new events are dropped until it drains`)
      }

      const properties = safeProperties(input.properties as Record<string, unknown> | undefined)
      // Person properties: only the two that segment customers, never anything
      // that identifies one. Set from the same cleaned values.
      const person: Record<string, AnalyticsValue> = {}
      if (properties.plan !== undefined) person.plan = properties.plan
      if (properties.industry !== undefined) person.industry = properties.industry

      this.#queue.push({
        event: input.event,
        distinct_id: input.tenantId,
        timestamp: this.#now().toISOString(),
        uuid: randomUUID(),
        properties: {
          ...properties,
          $lib: 'adspilot-server',
          // A profile per tenant, so funnels and cohorts work per account. The
          // distinct id is our own opaque tenant id, and the profile holds only
          // plan and industry, so it identifies a customer to nobody but us.
          $process_person_profile: true,
          // From a server, GeoIP would record our data centre, not the customer.
          $geoip_disable: true,
          ...(Object.keys(person).length > 0 ? { $set: person } : {}),
        },
      })

      this.#startTimer()
      if (this.#queue.length >= this.#flushAt) void this.flush()
    } catch (error) {
      this.#report('capture', `analytics capture failed: ${messageOf(error)}`)
    }
  }

  flush(): Promise<void> {
    this.#inflight = this.#inflight.then(() => this.#drain())
    return this.#inflight
  }

  async shutdown(timeoutMs = 3_000): Promise<void> {
    this.#closed = true
    if (this.#timer !== undefined) clearInterval(this.#timer)
    this.#timer = undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      this.flush(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs)
      }),
    ])
    if (timeout !== undefined) clearTimeout(timeout)
  }

  #startTimer(): void {
    if (this.#timer !== undefined) return
    this.#timer = setInterval(() => void this.flush(), this.#flushIntervalMs)
    // Never the reason a process stays alive: exit flushes explicitly instead.
    this.#timer.unref()
  }

  /**
   * Sends everything queued, a batch at a time. A failed batch is dropped, not
   * retried: retrying needs a second queue and a backoff, and the events are
   * not the record (tool_calls is), so losing a batch during an outage is the
   * right trade for a client that can never pile up work.
   */
  async #drain(): Promise<void> {
    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, this.#maxBatchSize)
      try {
        const response = await this.#fetch(this.#endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ api_key: this.#apiKey, batch }),
          signal: AbortSignal.timeout(this.#requestTimeoutMs),
        })
        if (!response.ok) this.#report(`http_${response.status}`, `PostHog answered ${response.status}; ${batch.length} analytics event(s) dropped`)
      } catch (error) {
        this.#report('request', `PostHog could not be reached; ${batch.length} analytics event(s) dropped: ${messageOf(error)}`)
      }
    }
  }

  #report(kind: string, message: string): void {
    if (this.#reported.has(kind)) return
    this.#reported.add(kind)
    try {
      // Redacted on the way out too: an error message could in theory echo a request.
      const scrubbed = this.#apiKey === '' ? message : message.split(this.#apiKey).join('[redacted:posthog-key]')
      this.#onError(redactText(scrubbed))
    } catch {
      // The error reporter failing is not the caller's problem either.
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface AnalyticsSettings {
  readonly apiKey?: string | undefined
  readonly host?: string | undefined
  readonly onError?: (message: string) => void
  readonly fetch?: typeof globalThis.fetch
}

/**
 * The analytics client for a process: PostHog when a project key is
 * configured, a silent no-op otherwise.
 *
 * Only a project capture key (phc_…) is used. PostHog's personal API keys
 * (phx_…) can read and change the whole account; one pasted into POSTHOG_KEY by
 * mistake must not be sent with every batch. Only an https host is used, so
 * events never travel in the clear. Neither refusal ever prints the value.
 */
export function createAnalytics(settings: AnalyticsSettings): Analytics {
  const key = settings.apiKey?.trim() ?? ''
  if (key === '') return new NoopAnalytics()

  const report = settings.onError ?? (() => {})
  if (!key.startsWith('phc_')) {
    safely(report, 'POSTHOG_KEY is not a PostHog project key (it should start with phc_); analytics is off')
    return new NoopAnalytics()
  }
  const host = (settings.host ?? '').trim()
  if (!/^https:\/\/[^\s/?#]+\/?$/.test(host)) {
    safely(report, 'POSTHOG_HOST must be an https address with no path, such as https://eu.i.posthog.com; analytics is off')
    return new NoopAnalytics()
  }
  return new PostHogAnalytics({
    apiKey: key,
    host,
    onError: report,
    ...(settings.fetch !== undefined ? { fetch: settings.fetch } : {}),
  })
}

function safely(report: (message: string) => void, message: string): void {
  try {
    report(message)
  } catch {
    // ignored: see PostHogAnalytics#report
  }
}

/**
 * Sends what is queued when the process is about to end on its own (the
 * event loop emptied: a stdio client closed, a worker run drained). Signal
 * and fatal exits call `shutdown()` themselves, since `beforeExit` does not
 * fire on `process.exit()`.
 */
export function flushOnExit(analytics: Analytics): void {
  if (!analytics.enabled) return
  process.once('beforeExit', () => {
    void analytics.shutdown()
  })
}
