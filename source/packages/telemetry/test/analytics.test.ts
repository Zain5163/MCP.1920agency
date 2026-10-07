import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'

import {
  ALLOWED_PROPERTIES,
  NoopAnalytics,
  PostHogAnalytics,
  createAnalytics,
  safeProperties,
  type AnalyticsEvent,
} from '../src/analytics.ts'

/**
 * The analytics client, against a fake fetch. Nothing here reaches the
 * network: every test passes its own fetch, and a test fails if the real one
 * is ever called.
 */

const KEY = 'phc_testkey000000000000000000000000'
const HOST = 'https://eu.i.posthog.com'
const TENANT = 'cm1a2b3c4d5e6f7g8h9i0j'

interface Sent {
  url: string
  body: { api_key: string; batch: Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }> }
}

function fakeFetch(respond: () => Response | Promise<Response> = () => new Response('{}', { status: 200 })) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
    return await respond()
  }) as typeof globalThis.fetch
  return { fetchImpl, sent }
}

function client(fetchImpl: typeof globalThis.fetch, extra: Partial<ConstructorParameters<typeof PostHogAnalytics>[0]> = {}) {
  const errors: string[] = []
  const analytics = new PostHogAnalytics({
    apiKey: KEY,
    host: HOST,
    fetch: fetchImpl,
    flushIntervalMs: 60_000,
    onError: (m) => errors.push(m),
    ...extra,
  })
  return { analytics, errors }
}

const event = (properties: Record<string, unknown> = {}, tenantId = TENANT): AnalyticsEvent =>
  ({ event: 'mcp_call', tenantId, properties }) as AnalyticsEvent

describe('without a key, analytics is a silent no-op', () => {
  test('no key, a blank key: the no-op client, and nothing reported', async () => {
    const errors: string[] = []
    for (const apiKey of [undefined, '', '   ']) {
      const a = createAnalytics({ apiKey, host: HOST, onError: (m) => errors.push(m) })
      assert.ok(a instanceof NoopAnalytics)
      assert.equal(a.enabled, false)
      a.capture(event({ tool: 'list_posts' }))
      await a.flush()
      await a.shutdown()
    }
    assert.deepEqual(errors, [])
  })

  test('a personal API key (phx_) is refused, and its value is never repeated', () => {
    const errors: string[] = []
    const secret = 'phx_personalsecretvalue123'
    const a = createAnalytics({ apiKey: secret, host: HOST, onError: (m) => errors.push(m) })
    assert.equal(a.enabled, false)
    assert.equal(errors.length, 1)
    assert.doesNotMatch(errors[0]!, /personalsecretvalue/)
  })

  test('a host that is not https is refused', () => {
    for (const host of ['http://eu.i.posthog.com', 'eu.i.posthog.com', 'https://eu.i.posthog.com/path?x=1', '']) {
      assert.equal(createAnalytics({ apiKey: KEY, host }).enabled, false, host)
    }
  })

  test('a project key and an https host give the real client', () => {
    assert.ok(createAnalytics({ apiKey: KEY, host: HOST }) instanceof PostHogAnalytics)
    assert.ok(createAnalytics({ apiKey: KEY, host: `${HOST}/` }) instanceof PostHogAnalytics)
  })
})

describe('the allow-list', () => {
  test('disallowed property names are dropped, whatever their value', () => {
    const out = safeProperties({
      tool: 'publish_post',
      body: 'Big launch tomorrow at 9!',
      args: { body: 'secret copy' },
      access_token: 'EAAsupersecret',
      email: 'owner@example.com',
      name: 'Rana',
      url: 'https://example.com/?utm=1',
      adText: 'Buy now',
      $set: { email: 'owner@example.com' },
      distinct_id: 'someone-else',
    })
    assert.deepEqual(out, { tool: 'publish_post' })
  })

  test('allowed names keep only plain token values', () => {
    const out = safeProperties({
      tool: 'list_posts',
      ok: false,
      error_code: 'TOKEN_EXPIRED',
      duration_ms: 12.34567,
      client_name: 'claude-code',
      client_version: '2.1.0',
      transport: 'stdio',
      plan: 'premium',
      threshold: 90,
    })
    assert.deepEqual(out, {
      tool: 'list_posts',
      ok: false,
      error_code: 'TOKEN_EXPIRED',
      duration_ms: 12.346,
      client_name: 'claude-code',
      client_version: '2.1.0',
      transport: 'stdio',
      plan: 'premium',
      threshold: 90,
    })
  })

  test('an allowed name with an unsafe value is dropped', () => {
    const out = safeProperties({
      client_name: 'https://evil.example/?token=abc',
      client_version: 'owner@example.com',
      tool: 'x'.repeat(500),
      error_code: 'a=b&c=d',
      source: '//cdn.example/x',
      platform: 'EAABwzLixnjYBO1ZByourtokenvalue123456',
      duration_ms: Number.NaN,
      threshold: Number.POSITIVE_INFINITY,
      transport: { nested: true },
    })
    assert.deepEqual(out, {})
  })

  test('plan and industry must be on their lists', () => {
    assert.deepEqual(safeProperties({ plan: 'enterprise', industry: 'Dental clinic' }), {})
    assert.deepEqual(safeProperties({ plan: 'free', industry: 'dentist' }), { plan: 'free', industry: 'dentist' })
  })

  test('the list itself names nothing that carries content or identity', () => {
    for (const name of ALLOWED_PROPERTIES) {
      assert.doesNotMatch(name, /body|text|caption|title|arg|token|secret|email|name_of|phone|url|address|message/i, name)
    }
  })

  test('what reaches the wire is only allowed names plus our own $ properties', async () => {
    const { fetchImpl, sent } = fakeFetch()
    const { analytics } = client(fetchImpl)
    analytics.capture(event({ tool: 'publish_post', body: 'secret launch copy', plan: 'free', industry: 'dentist' }))
    await analytics.flush()
    const props = sent[0]!.body.batch[0]!.properties
    assert.deepEqual(Object.keys(props).sort(), ['$geoip_disable', '$lib', '$process_person_profile', '$set', 'industry', 'plan', 'tool'])
    assert.equal(props.$geoip_disable, true)
    assert.equal(props.$process_person_profile, true)
    assert.deepEqual(props.$set, { plan: 'free', industry: 'dentist' })
    assert.doesNotMatch(JSON.stringify(sent), /secret launch copy/)
  })
})

describe('distinct id', () => {
  test('is the tenant id', async () => {
    const { fetchImpl, sent } = fakeFetch()
    const { analytics } = client(fetchImpl)
    analytics.capture(event())
    await analytics.flush()
    assert.equal(sent[0]!.body.batch[0]!.distinct_id, TENANT)
    assert.equal(sent[0]!.body.api_key, KEY)
    assert.equal(sent[0]!.url, `${HOST}/batch/`)
  })

  test('an email, a name or an empty id drops the event', async () => {
    const { fetchImpl, sent } = fakeFetch()
    const { analytics, errors } = client(fetchImpl)
    for (const id of ['owner@example.com', 'Rana Zain', '', 'short']) analytics.capture(event({}, id))
    await analytics.flush()
    assert.equal(sent.length, 0)
    assert.equal(errors.length, 1, 'reported once, not per event')
  })

  test('an unknown event name is not sent', async () => {
    const { fetchImpl, sent } = fakeFetch()
    const { analytics } = client(fetchImpl)
    analytics.capture({ event: 'user_typed_this', tenantId: TENANT } as unknown as AnalyticsEvent)
    await analytics.flush()
    assert.equal(sent.length, 0)
  })
})

describe('never throws, never blocks', () => {
  test('the endpoint failing: capture and flush still return normally', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('fetch failed')
    })
    const { analytics, errors } = client(fetchImpl, { flushAt: 1 })
    analytics.capture(event())
    analytics.capture(event())
    await analytics.flush()
    await analytics.shutdown()
    assert.equal(errors.length, 1, 'an outage is reported once')
    assert.match(errors[0]!, /could not be reached/)
    assert.equal(analytics.queued, 0, 'failed batches are dropped, not kept')
  })

  test('a 5xx answer is reported once and the batch dropped', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('no', { status: 503 }))
    const { analytics, errors } = client(fetchImpl)
    analytics.capture(event())
    await analytics.flush()
    analytics.capture(event())
    await analytics.flush()
    assert.deepEqual(errors.length, 1)
    assert.match(errors[0]!, /503/)
  })

  test('an error reporter that throws does not reach the caller', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new Error('down')
    })
    const analytics = new PostHogAnalytics({
      apiKey: KEY,
      host: HOST,
      fetch: fetchImpl,
      onError: () => {
        throw new Error('reporter broke')
      },
    })
    analytics.capture(event())
    await analytics.flush()
    await analytics.shutdown()
  })

  test('capture returns before anything is sent', () => {
    let called = 0
    const fetchImpl = (async () => {
      called += 1
      return new Response('{}')
    }) as unknown as typeof globalThis.fetch
    const { analytics } = client(fetchImpl, { flushAt: 100 })
    analytics.capture(event())
    assert.equal(called, 0)
    assert.equal(analytics.queued, 1)
    return analytics.shutdown()
  })

  test('a hanging endpoint cannot hold shutdown past its timeout', async () => {
    const fetchImpl = (() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch
    const { analytics } = client(fetchImpl)
    analytics.capture(event())
    const started = Date.now()
    await analytics.shutdown(50)
    assert.ok(Date.now() - started < 2_000)
  })

  test('the error message never contains the key', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new Error(`rejected key ${KEY}`)
    })
    const { analytics, errors } = client(fetchImpl)
    analytics.capture(event())
    await analytics.flush()
    assert.doesNotMatch(errors.join('\n'), new RegExp(KEY))
  })
})

describe('batching, bounds and flushing', () => {
  test('events are sent together once flushAt is reached', async () => {
    const { fetchImpl, sent } = fakeFetch()
    const { analytics } = client(fetchImpl, { flushAt: 3 })
    analytics.capture(event())
    analytics.capture(event())
    assert.equal(sent.length, 0)
    analytics.capture(event())
    await analytics.flush()
    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.body.batch.length, 3)
  })

  test('a long queue goes out in batches of maxBatchSize', async () => {
    const { fetchImpl, sent } = fakeFetch()
    const { analytics } = client(fetchImpl, { flushAt: 1000, maxBatchSize: 2 })
    for (let i = 0; i < 5; i += 1) analytics.capture(event())
    await analytics.flush()
    assert.deepEqual(sent.map((s) => s.body.batch.length), [2, 2, 1])
  })

  test('the queue is bounded: beyond maxQueueSize events are dropped and it is said once', async () => {
    const { fetchImpl, sent } = fakeFetch()
    const { analytics, errors } = client(fetchImpl, { flushAt: 1000, maxQueueSize: 3 })
    for (let i = 0; i < 10; i += 1) analytics.capture(event())
    assert.equal(analytics.queued, 3)
    assert.equal(errors.filter((e) => /queue is full/.test(e)).length, 1)
    await analytics.flush()
    assert.equal(sent[0]!.body.batch.length, 3)
  })

  test('concurrent flushes send each event once', async () => {
    const { fetchImpl, sent } = fakeFetch(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return new Response('{}')
    })
    const { analytics } = client(fetchImpl, { flushAt: 1000 })
    for (let i = 0; i < 4; i += 1) analytics.capture(event())
    await Promise.all([analytics.flush(), analytics.flush(), analytics.flush()])
    assert.equal(sent.reduce((n, s) => n + s.body.batch.length, 0), 4)
  })

  test('the interval timer sends waiting events without a flush call', async () => {
    const { fetchImpl, sent } = fakeFetch()
    const { analytics } = client(fetchImpl, { flushAt: 1000, flushIntervalMs: 100 })
    analytics.capture(event())
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(sent.length, 1)
    await analytics.shutdown()
  })

  test('shutdown sends what is queued, and later captures are ignored', async () => {
    const { fetchImpl, sent } = fakeFetch()
    const { analytics } = client(fetchImpl, { flushAt: 1000 })
    analytics.capture(event())
    await analytics.shutdown()
    assert.equal(sent.length, 1)
    analytics.capture(event())
    await analytics.flush()
    assert.equal(sent.length, 1)
  })
})
