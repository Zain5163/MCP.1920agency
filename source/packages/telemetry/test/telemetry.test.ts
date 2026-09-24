import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, describe } from 'node:test'

import { resolutionFor } from '@social-publisher/core'

import { FileSink, Logger, SlackSink, type LogEvent, type Sink } from '../src/logger.ts'
import { redact, redactText } from '../src/redact.ts'

const tmpLog = (): string => join(mkdtempSync(join(tmpdir(), 'sp-log-')), 'events.jsonl')

class CollectingSink implements Sink {
  readonly name = 'collect'
  events: Array<LogEvent & { timestamp: string }> = []
  async write(event: LogEvent & { timestamp: string }): Promise<void> {
    this.events.push(event)
  }
}

describe('redaction — the property that matters most', () => {
  test('replaces secret-named fields however deeply nested', () => {
    const out = redact({
      ok: true,
      credential: { accessToken: 'EAAsecret', nested: { app_secret: 'hunter2' } },
    }) as Record<string, any>
    assert.equal(out.credential.accessToken, '[redacted]')
    assert.equal(out.credential.nested.app_secret, '[redacted]')
    assert.equal(out.ok, true)
  })

  test('matches secret field names case-insensitively', () => {
    const out = redact({ AccessToken: 'x', APIKEY: 'y' }) as Record<string, string>
    assert.equal(out.AccessToken, '[redacted]')
    assert.equal(out.APIKEY, '[redacted]')
  })

  test('catches Meta tokens in free text', () => {
    assert.match(redactText('failed with EAABwzLixnjYBO1ZByourtokenvalue123456'), /\[redacted:meta-token\]/)
  })

  test('catches JWTs, which is what Supabase keys are', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    assert.ok(!redactText(`key=${jwt}`).includes(jwt))
  })

  test('catches database URLs with inline passwords', () => {
    const url = 'postgresql://postgres.abc:SuperSecret@host.supabase.com:6543/postgres'
    const out = redactText(`connecting to ${url}`)
    assert.ok(!out.includes('SuperSecret'))
    assert.match(out, /\[redacted:database-url\]/)
  })

  test('catches bearer headers and appsecret_proof hashes', () => {
    assert.match(redactText('Authorization: Bearer abcdef1234567890xyz'), /Bearer \[redacted\]/)
    assert.match(redactText(`proof=${'a1b2c3d4e5'.repeat(6)}`), /\[redacted:hex\]/)
  })

  test('redacts error messages and stacks, not just fields', () => {
    const err = new Error('failed for postgresql://u:pw@h:5432/db')
    const out = redact(err) as { message: string }
    assert.ok(!out.message.includes('pw@h'))
  })

  test('never emits raw binary', () => {
    assert.match(String(redact(new Uint8Array([1, 2, 3]))), /\[binary:3 bytes\]/)
  })

  test('survives circular-ish deep nesting without hanging', () => {
    let deep: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < 30; i += 1) deep = { nested: deep }
    assert.ok(JSON.stringify(redact(deep)).includes('[redacted:too-deep]'))
  })

  test('leaves ordinary values untouched', () => {
    const out = redact({ postId: '123_456', count: 7, live: true }) as Record<string, unknown>
    assert.deepEqual(out, { postId: '123_456', count: 7, live: true })
  })
})

describe('Logger', () => {
  test('writes JSON lines to disk', async () => {
    const path = tmpLog()
    await new Logger([new FileSink(path)]).info('publish.succeeded', 'posted to Facebook')

    const line = JSON.parse(readFileSync(path, 'utf8').trim())
    assert.equal(line.event, 'publish.succeeded')
    assert.ok(typeof line.timestamp === 'string')
  })

  test('redacts before anything reaches disk', async () => {
    const path = tmpLog()
    await new Logger([new FileSink(path)]).error('publish.failed', 'boom', {
      data: { credential: { accessToken: 'EAAsupersecrettokenvalue123456' } },
    })
    assert.ok(!readFileSync(path, 'utf8').includes('EAAsupersecrettokenvalue'))
  })

  test('child loggers carry context onto every event', async () => {
    const sink = new CollectingSink()
    await new Logger([sink]).child({ tenantId: 't1', platform: 'instagram' }).info('x', 'y')
    assert.equal(sink.events[0]!.tenantId, 't1')
    assert.equal(sink.events[0]!.platform, 'instagram')
  })

  test('a failing sink never breaks the caller', async () => {
    // Logging must not be able to cause an outage in the thing it observes.
    const exploding: Sink = {
      name: 'boom',
      async write() {
        throw new Error('slack is down')
      },
    }
    const good = new CollectingSink()
    await new Logger([exploding, good]).info('publish.succeeded', 'still fine')
    assert.equal(good.events.length, 1, 'healthy sink must still receive the event')
  })

  test('track records duration on success and rethrows on failure', async () => {
    const sink = new CollectingSink()
    const logger = new Logger([sink])

    assert.equal(await logger.track('publish', 'ok', async () => 42), 42)
    assert.equal(sink.events[0]!.event, 'publish.succeeded')
    assert.ok(typeof sink.events[0]!.durationMs === 'number')

    await assert.rejects(() =>
      logger.track('publish', 'bad', async () => {
        throw new Error('nope')
      }),
    )
    assert.equal(sink.events[1]!.event, 'publish.failed')
  })
})

describe('SlackSink', () => {
  const capture = () => {
    const bodies: string[] = []
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
      return new Response('ok')
    }) as unknown as typeof globalThis.fetch
    return { fetchImpl, bodies }
  }

  test('stays quiet for routine events', async () => {
    // A channel that receives everything gets muted, and a muted channel is
    // worse than no channel.
    const { fetchImpl, bodies } = capture()
    await new Logger([new SlackSink({ webhookUrl: 'https://hook', fetch: fetchImpl })]).info('x', 'routine')
    assert.equal(bodies.length, 0)
  })

  test('posts errors, including the diagnosis and first fix step', async () => {
    const { fetchImpl, bodies } = capture()
    await new Logger([new SlackSink({ webhookUrl: 'https://hook', fetch: fetchImpl })]).error(
      'publish.failed',
      'could not post',
      { resolution: resolutionFor('TOKEN_EXPIRED'), platform: 'facebook_page' },
    )
    assert.equal(bodies.length, 1)
    assert.match(bodies[0]!, /TOKEN_EXPIRED/)
    assert.match(bodies[0]!, /fix:/)
    assert.match(bodies[0]!, /facebook_page/)
  })

  test('redacts before posting to Slack', async () => {
    const { fetchImpl, bodies } = capture()
    await new Logger([new SlackSink({ webhookUrl: 'https://hook', fetch: fetchImpl })]).error(
      'publish.failed',
      'token EAAsupersecrettokenvalue123456 rejected',
    )
    assert.ok(!bodies[0]!.includes('EAAsupersecrettokenvalue'))
  })
})

describe('FileSink', () => {
  test('creates the log directory if it does not exist', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'sp-log-')), 'nested', 'deeper', 'events.jsonl')
    await new FileSink(path).write({ level: 'info', event: 'e', message: 'm', timestamp: 'now' })
    assert.ok(existsSync(path))
  })

  test('appends rather than overwriting', async () => {
    const path = tmpLog()
    const sink = new FileSink(path)
    await sink.write({ level: 'info', event: 'a', message: '1', timestamp: 't' })
    await sink.write({ level: 'info', event: 'b', message: '2', timestamp: 't' })
    assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, 2)
  })
})
