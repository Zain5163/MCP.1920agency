import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { Resolution } from '@social-publisher/core'

import { redact } from './redact.ts'

/**
 * Structured operational logging.
 *
 * Two rules shape this:
 *
 *   1. **Everything is recorded.** Every tool call, publish attempt and failure is
 *      written so that when something goes wrong we can answer "what actually
 *      happened" from evidence rather than reconstruction.
 *   2. **Logging can never break the thing it observes.** Every sink failure is
 *      swallowed. A Slack outage must not stop a post going out.
 *
 * Operational detail is for the operator, not the end user. Users get the
 * resolution from the error catalogue; the raw event goes here.
 */

export type Level = 'debug' | 'info' | 'warn' | 'error'

export interface LogEvent {
  readonly level: Level
  /** Dotted and stable, e.g. publish.succeeded — these get counted and alerted on. */
  readonly event: string
  readonly message: string
  readonly tenantId?: string
  readonly connectionId?: string
  readonly platform?: string
  readonly durationMs?: number
  readonly resolution?: Resolution
  readonly data?: Record<string, unknown>
}

export interface Sink {
  readonly name: string
  write(event: LogEvent & { timestamp: string }): Promise<void>
}

export const LOG_DIR = join(homedir(), '.social-publisher', 'logs')

/** Always-on local sink. Survives Slack being down or misconfigured. */
export class FileSink implements Sink {
  readonly name = 'file'
  readonly #path: string

  constructor(path: string = join(LOG_DIR, 'events.jsonl')) {
    this.#path = path
  }

  async write(event: LogEvent & { timestamp: string }): Promise<void> {
    // JSON Lines: one object per line, appendable, and greppable without a parser.
    await mkdir(dirname(this.#path), { recursive: true })
    await appendFile(this.#path, `${JSON.stringify(redact(event))}\n`, 'utf8')
  }
}

/**
 * Slack sink. Only warn and error by default — a channel that receives every
 * routine event gets muted within a week, and a muted channel is worse than none.
 */
export class SlackSink implements Sink {
  readonly name = 'slack'
  readonly #webhook: string
  readonly #minLevel: Level
  readonly #fetch: typeof globalThis.fetch

  constructor(options: { webhookUrl: string; minLevel?: Level; fetch?: typeof globalThis.fetch }) {
    this.#webhook = options.webhookUrl
    this.#minLevel = options.minLevel ?? 'warn'
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async write(event: LogEvent & { timestamp: string }): Promise<void> {
    if (RANK[event.level] < RANK[this.#minLevel]) return

    const safe = redact(event) as LogEvent & { timestamp: string }
    const icon = event.level === 'error' ? ':rotating_light:' : ':warning:'

    const lines = [
      `${icon} *${safe.event}* — ${safe.message}`,
      safe.platform !== undefined ? `• platform: ${safe.platform}` : '',
      safe.tenantId !== undefined ? `• tenant: ${safe.tenantId}` : '',
      // The resolution goes to Slack too: whoever is on call should see the fix,
      // not just the symptom.
      safe.resolution !== undefined ? `• diagnosis: [${safe.resolution.code}] ${safe.resolution.why}` : '',
      safe.resolution !== undefined ? `• fix: ${safe.resolution.fix[0] ?? ''}` : '',
    ].filter((line) => line !== '')

    await this.#fetch(this.#webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
    })
  }
}

/** Console sink, for running things by hand. */
export class ConsoleSink implements Sink {
  readonly name = 'console'
  readonly #minLevel: Level

  constructor(minLevel: Level = 'info') {
    this.#minLevel = minLevel
  }

  async write(event: LogEvent & { timestamp: string }): Promise<void> {
    if (RANK[event.level] < RANK[this.#minLevel]) return
    const safe = redact(event) as LogEvent & { timestamp: string }
    const target = event.level === 'error' || event.level === 'warn' ? console.error : console.log
    target(`[${safe.timestamp}] ${safe.level.toUpperCase()} ${safe.event} — ${safe.message}`)
  }
}

const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export class Logger {
  readonly #sinks: Sink[]
  readonly #base: Partial<LogEvent>
  /** Sinks that have already failed, so one broken sink is reported once, not per event. */
  readonly #broken = new Set<string>()

  constructor(sinks: Sink[], base: Partial<LogEvent> = {}) {
    this.#sinks = sinks
    this.#base = base
  }

  /** Returns a logger that stamps every event with the given context. */
  child(context: Partial<LogEvent>): Logger {
    return new Logger(this.#sinks, { ...this.#base, ...context })
  }

  async log(event: LogEvent): Promise<void> {
    const full = { ...this.#base, ...event, timestamp: new Date().toISOString() }

    await Promise.all(
      this.#sinks.map(async (sink) => {
        try {
          await sink.write(full)
        } catch (error) {
          // Never rethrow. A logging failure must not fail the operation being
          // logged — that would turn observability into an outage.
          if (!this.#broken.has(sink.name)) {
            this.#broken.add(sink.name)
            console.error(
              `[telemetry] sink "${sink.name}" failed and will be reported once: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
      }),
    )
  }

  debug(event: string, message: string, data?: Record<string, unknown>): Promise<void> {
    return this.log({ level: 'debug', event, message, ...(data !== undefined ? { data } : {}) })
  }

  info(event: string, message: string, data?: Record<string, unknown>): Promise<void> {
    return this.log({ level: 'info', event, message, ...(data !== undefined ? { data } : {}) })
  }

  warn(event: string, message: string, extra?: Partial<LogEvent>): Promise<void> {
    return this.log({ level: 'warn', event, message, ...extra })
  }

  error(event: string, message: string, extra?: Partial<LogEvent>): Promise<void> {
    return this.log({ level: 'error', event, message, ...extra })
  }

  /** Times an operation and records both outcomes. */
  async track<T>(event: string, message: string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now()
    try {
      const result = await fn()
      await this.log({
        level: 'info',
        event: `${event}.succeeded`,
        message,
        durationMs: Date.now() - started,
      })
      return result
    } catch (error) {
      await this.log({
        level: 'error',
        event: `${event}.failed`,
        message,
        durationMs: Date.now() - started,
        data: { error },
      })
      throw error
    }
  }
}

export function createLogger(options: {
  slackWebhookUrl?: string | undefined
  console?: boolean
  logPath?: string
  base?: Partial<LogEvent>
}): Logger {
  const sinks: Sink[] = [new FileSink(options.logPath)]
  if (options.slackWebhookUrl !== undefined && options.slackWebhookUrl !== '') {
    sinks.push(new SlackSink({ webhookUrl: options.slackWebhookUrl }))
  }
  if (options.console === true) sinks.push(new ConsoleSink())
  return new Logger(sinks, options.base ?? {})
}
