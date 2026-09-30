import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { PublishError } from '@social-publisher/core'

import { MetaAccountSetup } from '../src/meta-account-setup.ts'

interface Call {
  url: string
  method: string
  body: Record<string, string>
}

/** Answers by path, so the order of reads does not matter to the test. */
function mockGraph(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url))
    const path = u.pathname.replace(/^\/v[\d.]+\//, '')
    const body: Record<string, string> = {}
    if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) body[k] = v
    const method = init?.method ?? 'GET'
    calls.push({ url: u.toString(), method, body })
    const reply = routes[`${method} ${path}`]
    if (reply === undefined) return new Response(JSON.stringify({ error: { message: `no route ${method} ${path}` } }), { status: 404 })
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetchImpl, calls }
}

const now = () => new Date('2026-09-30T12:00:00Z')

const readyAccount = {
  'GET me': { body: { id: '1', name: 'Owner' } },
  'GET me/accounts': { body: { data: [{ id: 'p1', name: '1920 Agency', is_published: true }] } },
  'GET me/businesses': { body: { data: [] } },
  'GET me/adaccounts': {
    body: {
      data: [
        {
          account_id: '853',
          name: '1920Agency 10',
          currency: 'PKR',
          account_status: 1,
          timezone_id: 105,
          timezone_name: 'Asia/Karachi',
          funding_source: '285',
          business: { id: 'b1', name: '1920 Agency' },
        },
      ],
    },
  },
  'GET act_853/adspixels': {
    body: { data: [{ id: 'px1', name: '1920agency.com', last_fired_time: '2026-09-27T22:42:30+0000' }] },
  },
}

describe('checking what someone has before they can run ads', () => {
  test('a fully set-up account is ready, and the business is found through its ad account', async () => {
    const { fetchImpl } = mockGraph(readyAccount)
    const state = await new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl, now }).inspect()
    assert.equal(state.ready, true)
    assert.deepEqual(state.businesses, [{ id: 'b1', name: '1920 Agency' }])
    assert.equal(state.focus?.timezoneId, 105)
    assert.deepEqual(
      state.steps.map((s) => s.key),
      ['page', 'business', 'ad_account', 'payment', 'pixel', 'pixel_firing'],
    )
  })

  test('someone with only a login is told the Page comes first, by link, because Meta has no API for it', async () => {
    const { fetchImpl } = mockGraph({
      'GET me': { body: { id: '1', name: 'New' } },
      'GET me/accounts': { body: { data: [] } },
      'GET me/businesses': { body: { data: [] } },
      'GET me/adaccounts': { body: { data: [] } },
    })
    const state = await new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl, now }).inspect()
    assert.equal(state.ready, false)
    const page = state.steps.find((s) => s.key === 'page')!
    assert.match(page.next!, /facebook\.com\/pages\/create/)
    assert.match(state.steps.find((s) => s.key === 'business')!.next!, /Page first/)
    assert.match(state.steps.find((s) => s.key === 'ad_account')!.next!, /business portfolio first/)
    // No ad account, so there is nothing to check payment or a pixel on.
    assert.equal(state.steps.some((s) => s.key === 'payment'), false)
  })

  test('no payment method points to Meta billing for that exact account, never an API', async () => {
    const { fetchImpl } = mockGraph({
      ...readyAccount,
      'GET me/adaccounts': {
        body: { data: [{ ...readyAccount['GET me/adaccounts'].body.data[0], funding_source: undefined }] },
      },
    })
    const state = await new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl, now }).inspect()
    const pay = state.steps.find((s) => s.key === 'payment')!
    assert.equal(pay.done, false)
    assert.match(pay.next!, /billing_hub.*asset_id=853/)
  })

  test('a pixel that has never fired is reported as not on the website', async () => {
    const { fetchImpl } = mockGraph({
      ...readyAccount,
      'GET act_853/adspixels': { body: { data: [{ id: 'px1', name: 'site' }] } },
    })
    const state = await new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl, now }).inspect()
    const firing = state.steps.find((s) => s.key === 'pixel_firing')!
    assert.equal(firing.done, false)
    assert.match(firing.detail, /never received an event/)
  })

  test('a pixel silent for over a week is flagged', async () => {
    const { fetchImpl } = mockGraph({
      ...readyAccount,
      'GET act_853/adspixels': { body: { data: [{ id: 'px1', name: 'site', last_fired_time: '2026-09-01T00:00:00+0000' }] } },
    })
    const state = await new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl, now }).inspect()
    assert.match(state.steps.find((s) => s.key === 'pixel_firing')!.detail, /nothing for 29 days/)
  })

  test('a disabled account is not counted as ready, and says why', async () => {
    const { fetchImpl } = mockGraph({
      ...readyAccount,
      'GET me/adaccounts': { body: { data: [{ ...readyAccount['GET me/adaccounts'].body.data[0], account_status: 2 }] } },
    })
    const state = await new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl, now }).inspect()
    const step = state.steps.find((s) => s.key === 'ad_account')!
    assert.equal(step.done, false)
    assert.match(step.detail, /disabled/)
  })

  test('asking about an account this connection cannot reach says so rather than checking another', async () => {
    const { fetchImpl } = mockGraph(readyAccount)
    const state = await new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl, now }).inspect('act_999')
    assert.match(state.steps.find((s) => s.key === 'ad_account')!.detail, /999 is not reachable/)
    assert.equal(state.focus, undefined)
  })

  test('inspecting only reads', async () => {
    const { fetchImpl, calls } = mockGraph(readyAccount)
    await new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl, now }).inspect()
    assert.equal(calls.every((c) => c.method === 'GET'), true)
  })
})

describe('creating what is missing', () => {
  test('a business is created with its primary Page', async () => {
    const { fetchImpl, calls } = mockGraph({ 'POST me/businesses': { body: { id: 'b9' } } })
    const id = await new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl }).createBusiness({
      name: 'Acme',
      vertical: 'PROFESSIONAL_SERVICES',
      primaryPageId: 'p1',
    })
    assert.equal(id, 'b9')
    assert.equal(calls[0]!.body.primary_page, 'p1')
  })

  test('an ad account is created with the business as its own advertiser, and returned without act_', async () => {
    const { fetchImpl, calls } = mockGraph({ 'POST b1/adaccount': { body: { id: 'act_777', account_id: '777' } } })
    const id = await new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl }).createAdAccount({
      businessId: 'b1',
      name: 'Acme ads',
      currency: 'PKR',
      timezoneId: 105,
    })
    assert.equal(id, '777')
    assert.deepEqual(
      { ...calls[0]!.body, access_token: undefined },
      {
        name: 'Acme ads',
        currency: 'PKR',
        timezone_id: '105',
        end_advertiser: 'b1',
        media_agency: 'NONE',
        partner: 'NONE',
        access_token: undefined,
      },
    )
  })

  test('a pixel is created on the ad account, with or without the act_ prefix', async () => {
    const { fetchImpl, calls } = mockGraph({ 'POST act_777/adspixels': { body: { id: 'px9' } } })
    const id = await new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl }).createPixel({
      adAccountId: 'act_777',
      name: 'acme.com',
    })
    assert.equal(id, 'px9')
    assert.match(calls[0]!.url, /act_777\/adspixels/)
  })

  test("Meta's own reason is passed on when it refuses", async () => {
    const { fetchImpl } = mockGraph({
      'POST act_777/adspixels': {
        status: 400,
        body: { error: { message: 'x', error_user_msg: 'A pixel already exists for this account', code: 6200 } },
      },
    })
    await assert.rejects(
      new MetaAccountSetup({ accessToken: 't', fetch: fetchImpl }).createPixel({ adAccountId: '777', name: 'a' }),
      (e: unknown) => e instanceof PublishError && /already exists/.test(e.message),
    )
  })
})
