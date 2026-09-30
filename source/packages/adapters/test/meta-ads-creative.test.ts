import { strict as assert } from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, describe, before } from 'node:test'

import { money, type AdPlan } from '@social-publisher/core'

import { MetaAdsClient, expandForPlacements, META_CREATIVE_FEATURES } from '../src/meta-ads.ts'

let dir = ''
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'meta-creative-'))
  for (const name of ['sq.png', 'pt.png', 'vt.png', 'thumb.png']) {
    await writeFile(join(dir, name), Buffer.from([1, 2, 3]))
  }
  await writeFile(join(dir, 'clip.mp4'), Buffer.alloc(64, 7))
})

interface Call {
  method: string
  url: string
  body: Record<string, string>
}

/** Answers the endpoints a creative touches, and records what was sent. */
function meta(options: { videoStatus?: string[] } = {}) {
  const calls: Call[] = []
  const statuses = [...(options.videoStatus ?? ['ready'])]
  const chunks: string[] = []
  let images = 0
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    const body: Record<string, string> = {}
    if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) body[k] = v
    calls.push({ method: init?.method ?? 'GET', url: href, body })

    const json = (v: unknown) => new Response(JSON.stringify(v))
    if (href.includes('/adimages')) return json({ images: { f: { hash: `HASH${++images}` } } })
    if (href.includes('/advideos')) {
      // Meta's resumable upload: it names the next byte range after each chunk.
      // The test file is 64 bytes, sent as two 32-byte chunks.
      const form = init?.body instanceof FormData ? init.body : undefined
      const phase = form?.get('upload_phase')
      chunks.push(String(phase))
      if (phase === 'start') return json({ upload_session_id: 'S1', video_id: 'VID1', start_offset: '0', end_offset: '32' })
      if (phase === 'transfer') {
        const from = Number(form?.get('start_offset'))
        return json(from === 0 ? { start_offset: '32', end_offset: '64' } : { start_offset: '64', end_offset: '64' })
      }
      return json({ success: true })
    }
    if (href.includes('/VID1/thumbnails')) return json({ data: [{ uri: 'https://thumb/x.jpg', is_preferred: true }] })
    if (href.includes('/VID1?')) return json({ status: { video_status: statuses.shift() ?? 'ready' } })
    if (href.includes('/adcreatives')) return json({ id: 'CR1' })
    return json({ id: 'OBJ' })
  }) as unknown as typeof globalThis.fetch
  return { fetchImpl, calls, chunks }
}

const client = (fetchImpl: typeof globalThis.fetch) =>
  new MetaAdsClient({
    accessToken: 'T',
    account: { adAccountId: '1', pageId: 'PAGE', currency: 'PKR' },
    fetch: fetchImpl,
    pollIntervalMs: 1,
  })

const sentCreative = (calls: Call[]) => calls.find((c) => c.url.endsWith('/adcreatives'))!.body

const base = { name: 'ad', body: '', landingPageUrl: 'https://1920agency.com', callToAction: 'LEARN_MORE' }
const texts = {
  bodies: ['one', 'two', 'three', 'four', 'five'],
  headlines: ['h1', 'h2', 'h3', 'h4', 'h5'],
  descriptions: ['d1', 'd2', 'd3'],
}

describe('several texts in one ad', () => {
  test('uses the asset feed, carrying every variant', async () => {
    const { fetchImpl, calls } = meta()
    await client(fetchImpl).createCreative({
      ...base,
      ...texts,
      assets: [{ kind: 'image', localPath: join(dir, 'pt.png'), aspectRatio: '4:5' }],
    })

    const feed = JSON.parse(sentCreative(calls).asset_feed_spec!) as Record<string, unknown[]>
    assert.equal(feed.bodies!.length, 5)
    assert.equal(feed.titles!.length, 5)
    assert.equal(feed.descriptions!.length, 3)
    // One shape means no placement rules: Meta crops it everywhere.
    assert.equal((feed as { asset_customization_rules?: unknown }).asset_customization_rules, undefined)
  })

  test('a single text and a single file is an ordinary creative, not an asset feed', async () => {
    const { fetchImpl, calls } = meta()
    await client(fetchImpl).createCreative({
      ...base,
      body: 'Just one',
      headline: 'Just one',
      assets: [{ kind: 'image', localPath: join(dir, 'sq.png'), aspectRatio: '1:1' }],
    })
    const sent = sentCreative(calls)
    assert.equal(sent.asset_feed_spec, undefined)
    assert.match(sent.object_story_spec!, /link_data/)
  })
})

describe('one file per placement', () => {
  test('9:16 goes to Stories and Reels, 4:5 to Feed, 1:1 to the square placements', async () => {
    const { fetchImpl, calls } = meta()
    await client(fetchImpl).createCreative({
      ...base,
      body: 'One text',
      headline: 'One headline',
      assets: [
        { kind: 'image', localPath: join(dir, 'sq.png'), aspectRatio: '1:1' },
        { kind: 'image', localPath: join(dir, 'pt.png'), aspectRatio: '4:5' },
        { kind: 'image', localPath: join(dir, 'vt.png'), aspectRatio: '9:16' },
      ],
    })

    const feed = JSON.parse(sentCreative(calls).asset_feed_spec!) as {
      optimization_type: string
      asset_customization_rules: Array<{
        customization_spec: { instagram_positions?: string[]; facebook_positions?: string[] }
        image_label: { name: string }
        priority: number
      }>
    }
    assert.equal(feed.optimization_type, 'PLACEMENT')

    const rules = feed.asset_customization_rules
    const labelFor = (position: string) =>
      rules.find(
        (r) =>
          r.customization_spec.instagram_positions?.includes(position) ||
          r.customization_spec.facebook_positions?.includes(position),
      )?.image_label.name

    assert.equal(labelFor('reels'), 'ratio_9x16')
    assert.equal(labelFor('stream'), 'ratio_4x5')
    // Found by reading a live creative back: without this the square was
    // uploaded and never served.
    assert.equal(labelFor('marketplace'), 'ratio_1x1')

    // Priorities are explicit, not an accident of array order.
    assert.deepEqual(rules.map((r) => r.priority), [1, 2, 3])
  })
})

describe('texts and shapes together', () => {
  const plan = (): AdPlan => ({
    campaign: { name: 'c', objective: 'OUTCOME_TRAFFIC' as never },
    adSets: [
      {
        adSet: { name: 's', dailyBudget: money(500_000, 'PKR'), audience: { countries: ['PK'] } },
        ads: [
          {
            ...base,
            ...texts,
            assets: [
              { kind: 'image', localPath: 'a', aspectRatio: '4:5' },
              { kind: 'image', localPath: 'b', aspectRatio: '9:16' },
            ],
          },
        ],
      },
    ],
  })

  test('split into one ad per text, because Meta refuses both in one creative', () => {
    // Live rejection: "Multiple bodies assets cannot be applied to rule no. 1".
    const ads = expandForPlacements(plan()).adSets[0]!.ads
    assert.equal(ads.length, 5)
    ads.forEach((ad, i) => {
      assert.deepEqual(ad.bodies, [texts.bodies[i]])
      assert.deepEqual(ad.headlines, [texts.headlines[i]])
      assert.equal(ad.assets!.length, 2, 'every split ad keeps every shape')
    })
  })

  test('shorter lists repeat rather than leaving an ad without text', () => {
    const ads = expandForPlacements(plan()).adSets[0]!.ads
    // Three descriptions across five ads cycle back to the first.
    assert.deepEqual(ads.map((a) => a.descriptions![0]), ['d1', 'd2', 'd3', 'd1', 'd2'])
  })

  test('an ad that needs no split is left exactly as it was', () => {
    const p = plan()
    const single: AdPlan = {
      ...p,
      adSets: [{ ...p.adSets[0]!, ads: [{ ...base, body: 'x', headline: 'y' }] }],
    }
    assert.deepEqual(expandForPlacements(single), single)
  })

  test('the review counts the ads that will exist, not the ones asked for', () => {
    const { fetchImpl } = meta()
    const review = client(fetchImpl).review(plan())
    // One requested ad became five, so the "fewer than three" warning must not fire.
    assert.equal(review.warnings.some((w) => /not a real creative test/.test(w)), false)
  })
})

describe("Meta's AI enhancements", () => {
  test('are opted out one by one, never via the deprecated bundle', async () => {
    // Live rejection: "Including standard enhancements field in creative has
    // been deprecated. Please choose to set individual features instead."
    const { fetchImpl, calls } = meta()
    await client(fetchImpl).createCreative({ ...base, body: 'x', headline: 'y' })

    const spec = JSON.parse(sentCreative(calls).degrees_of_freedom_spec!) as {
      creative_features_spec: Record<string, { enroll_status: string }>
    }
    const features = spec.creative_features_spec
    assert.equal(features.standard_enhancements, undefined)
    for (const name of META_CREATIVE_FEATURES) assert.equal(features[name]!.enroll_status, 'OPT_OUT')
  })

  test('can be switched on deliberately', async () => {
    const { fetchImpl, calls } = meta()
    await client(fetchImpl).createCreative({ ...base, body: 'x', headline: 'y', platformEnhancements: true })
    const spec = JSON.parse(sentCreative(calls).degrees_of_freedom_spec!) as {
      creative_features_spec: Record<string, { enroll_status: string }>
    }
    assert.equal(spec.creative_features_spec.image_touchups!.enroll_status, 'OPT_IN')
  })
})

describe('video', () => {
  test('waits until Meta has processed the video before using it', async () => {
    const { fetchImpl, calls } = meta({ videoStatus: ['processing', 'processing', 'ready'] })
    await client(fetchImpl).createCreative({
      ...base,
      body: 'x',
      headline: 'y',
      assets: [{ kind: 'video', localPath: join(dir, 'clip.mp4'), aspectRatio: '9:16' }],
    })

    const polls = calls.filter((c) => c.url.includes('/VID1?'))
    assert.equal(polls.length, 3)
    assert.match(sentCreative(calls).object_story_spec!, /video_data/)
  })

  test("a chosen thumbnail beats Meta's pick", async () => {
    const { fetchImpl, calls } = meta()
    await client(fetchImpl).createCreative({
      ...base,
      body: 'x',
      headline: 'y',
      assets: [
        { kind: 'video', localPath: join(dir, 'clip.mp4'), aspectRatio: '9:16', thumbnailPath: join(dir, 'thumb.png') },
      ],
    })
    assert.equal(calls.some((c) => c.url.includes('/thumbnails')), false)
    assert.match(sentCreative(calls).object_story_spec!, /image_hash/)
  })

  test("without one, Meta's preferred thumbnail is used", async () => {
    const { fetchImpl, calls } = meta()
    await client(fetchImpl).createCreative({
      ...base,
      body: 'x',
      headline: 'y',
      assets: [{ kind: 'video', localPath: join(dir, 'clip.mp4'), aspectRatio: '9:16' }],
    })
    assert.match(sentCreative(calls).object_story_spec!, /thumb\/x\.jpg/)
  })

  test('a failed processing is reported, not waited on forever', async () => {
    const { fetchImpl } = meta({ videoStatus: ['error'] })
    await assert.rejects(
      () =>
        client(fetchImpl).createCreative({
          ...base,
          body: 'x',
          headline: 'y',
          assets: [{ kind: 'video', localPath: join(dir, 'clip.mp4'), aspectRatio: '9:16' }],
        }),
      /could not process the video/i,
    )
  })
})

describe('instant-form leads', () => {
  test('the call to action opens the form', async () => {
    const { fetchImpl, calls } = meta()
    await client(fetchImpl).createCreative({ ...base, body: 'x', headline: 'y', leadFormId: 'FORM9' })
    assert.match(sentCreative(calls).object_story_spec!, /"lead_gen_form_id":"FORM9"/)
  })

  test('the ad set promotes the Page and delivers on the ad, with no pixel', async () => {
    const { fetchImpl, calls } = meta()
    await client(fetchImpl).create({
      campaign: { name: 'c', objective: 'OUTCOME_LEADS' as never },
      adSets: [
        {
          adSet: {
            name: 's',
            dailyBudget: money(500_000, 'PKR'),
            audience: { countries: ['PK'] },
            leadDestination: 'instant_form',
          },
          ads: [1, 2, 3].map((n) => ({ name: `a${n}`, body: 'x', headline: 'y', leadFormId: 'FORM9' })),
        },
      ],
    })

    const adset = calls.find((c) => c.url.endsWith('/adsets'))!.body
    assert.equal(adset.optimization_goal, 'LEAD_GENERATION')
    assert.equal(adset.destination_type, 'ON_AD')
    assert.deepEqual(JSON.parse(adset.promoted_object!), { page_id: 'PAGE' })
  })
})

describe('chunked video upload', () => {
  test('starts, sends each range Meta asks for, then finishes', async () => {
    const { fetchImpl, chunks } = meta()
    await client(fetchImpl).createCreative({
      ...base,
      body: 'x',
      headline: 'y',
      assets: [{ kind: 'video', localPath: join(dir, 'clip.mp4'), aspectRatio: '9:16' }],
    })
    // Two 32-byte chunks for a 64-byte file, in the order Meta named them.
    assert.deepEqual(chunks, ['start', 'transfer', 'transfer', 'finish'])
  })
})

describe('dynamic creative, which the real account enforces', () => {
  const planWith = (ads: AdPlan['adSets'][number]['ads']): AdPlan => ({
    campaign: { name: 'c', objective: 'OUTCOME_TRAFFIC' as never },
    adSets: [{ adSet: { name: 's', dailyBudget: money(50_000, 'PKR'), audience: { countries: ['PK'] } }, ads }],
  })
  // A function, because `dir` is only set once the before() hook has run.
  const multiText = () => ({ ...base, ...texts, assets: [{ kind: 'image' as const, localPath: join(dir, 'sq.png'), aspectRatio: '1:1' as const }] })

  test('an ad set holding a multi-text ad is marked for dynamic creative', async () => {
    // Real account, 2026-09-30: "Dynamic creative ads can only be created under
    // dynamic creative ad sets." The sandbox never showed it.
    const { fetchImpl, calls } = meta()
    await client(fetchImpl).create(planWith([multiText()]))
    const adset = calls.find((c) => c.url.endsWith('/adsets'))!.body
    assert.equal(adset.is_dynamic_creative, 'true')
  })

  test('an ordinary ad set is not', async () => {
    const { fetchImpl, calls } = meta()
    const plain = [1, 2, 3].map((n) => ({ ...base, name: `a${n}`, body: 'one', headline: 'one' }))
    await client(fetchImpl).create(planWith(plain))
    assert.equal(calls.find((c) => c.url.endsWith('/adsets'))!.body.is_dynamic_creative, undefined)
  })

  test('a second ad beside a dynamic creative is refused before anything is created', async () => {
    const { fetchImpl, calls } = meta()
    await assert.rejects(
      () => client(fetchImpl).create(planWith([multiText(), { ...base, name: 'b', body: 'x', headline: 'y' }])),
      /only ONE such ad per ad set/,
    )
    assert.equal(calls.length, 0)
  })

  test('one multi-text ad is judged by its variants, not by the ad count', () => {
    const { fetchImpl } = meta()
    const review = client(fetchImpl).review(planWith([multiText()]))
    assert.equal(review.warnings.some((w) => /Only 1 ad/.test(w)), false)
  })

  test('a single description is an ordinary field, not a reason for dynamic creative', async () => {
    const { fetchImpl, calls } = meta()
    await client(fetchImpl).createCreative({ ...base, body: 'one', headline: 'one', descriptions: ['only one'] })
    const sent = sentCreative(calls)
    assert.equal(sent.asset_feed_spec, undefined)
    assert.match(sent.object_story_spec!, /"description":"only one"/)
  })
})
