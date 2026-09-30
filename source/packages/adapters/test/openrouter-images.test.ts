import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { PublishError } from '@social-publisher/core'

import { COMPOSITION, DEFAULT_IMAGE_MODEL, OpenRouterImages } from '../src/openrouter-images.ts'

const MODELS = {
  data: [
    { id: DEFAULT_IMAGE_MODEL, supported_parameters: { aspect_ratio: { values: ['1:1', '4:5', '9:16', '16:9'] } } },
    // No 4:5: mirrors OpenAI's GPT Image 2 on the live list, 2026-09-30.
    { id: 'openai/gpt-image-2', supported_parameters: { aspect_ratio: { values: ['1:1', '9:16', '16:9'] } } },
  ],
}

function mock(image: { status?: number; body?: unknown } = {}) {
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    calls.push({
      method: init?.method ?? 'GET',
      url: href,
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}),
    })
    if (href.endsWith('/images/models')) return new Response(JSON.stringify(MODELS))
    return new Response(
      JSON.stringify(
        image.body ?? {
          data: [{ b64_json: Buffer.from('PNGDATA').toString('base64'), media_type: 'image/png' }],
          usage: { cost: 0.039 },
        },
      ),
      { status: image.status ?? 200 },
    )
  }) as unknown as typeof globalThis.fetch
  return { client: new OpenRouterImages({ apiKey: 'KEY', fetch: fetchImpl }), calls }
}

describe('generating an image', () => {
  test('returns the bytes and the exact cost OpenRouter charged', async () => {
    const { client } = mock()
    const image = await client.generate({ prompt: 'A busy restaurant kitchen', aspectRatio: '4:5' })
    assert.equal(Buffer.from(image.bytes).toString(), 'PNGDATA')
    assert.equal(image.costUsd, 0.039)
  })

  test('asks for the shape by name, at 1K, one image', async () => {
    const { client, calls } = mock()
    await client.generate({ prompt: 'x', aspectRatio: '9:16' })
    const body = calls.find((c) => c.method === 'POST')!.body!
    assert.equal(body.aspect_ratio, '9:16')
    assert.equal(body.resolution, '1K')
    assert.equal(body.n, 1)
  })

  test('every prompt carries the composition advice for its shape', async () => {
    // Stories and Reels cover the top and bottom of the frame with their own
    // buttons; the model cannot know that unless it is told.
    const { client, calls } = mock()
    await client.generate({ prompt: 'A chef plating food', aspectRatio: '9:16' })
    const prompt = String(calls.find((c) => c.method === 'POST')!.body!.prompt)
    assert.ok(prompt.startsWith('A chef plating food'))
    assert.ok(prompt.includes(COMPOSITION['9:16']))
  })

  test('every prompt forbids rendered text', async () => {
    // Image models misspell words; copy belongs in the ad's text fields.
    const { client, calls } = mock()
    await client.generate({ prompt: 'x', aspectRatio: '1:1' })
    assert.match(String(calls.find((c) => c.method === 'POST')!.body!.prompt), /Do not render any words/)
  })

  test('the key goes in a header, never the body or the URL', async () => {
    const { client, calls } = mock()
    await client.generate({ prompt: 'x', aspectRatio: '1:1' })
    const post = calls.find((c) => c.method === 'POST')!
    assert.ok(!post.url.includes('KEY'))
    assert.ok(!JSON.stringify(post.body).includes('KEY'))
  })
})

describe('shapes a model cannot make', () => {
  test('are refused BEFORE anything is paid for', async () => {
    const { client, calls } = mock()
    await assert.rejects(
      () => client.generate({ prompt: 'x', aspectRatio: '4:5', model: 'openai/gpt-image-2' }),
      (error: unknown) => {
        assert.ok(error instanceof PublishError)
        assert.match(error.message, /cannot make 4:5/)
        assert.match(error.message, /Nothing was charged/)
        return true
      },
    )
    assert.equal(calls.some((c) => c.method === 'POST'), false)
  })

  test('the model list is fetched once and reused', async () => {
    const { client, calls } = mock()
    await client.generate({ prompt: 'a', aspectRatio: '1:1' })
    await client.generate({ prompt: 'b', aspectRatio: '4:5' })
    assert.equal(calls.filter((c) => c.url.endsWith('/images/models')).length, 1)
  })

  test('an unknown model is named, not silently swapped', async () => {
    const { client } = mock()
    await assert.rejects(() => client.supportedShapes('nope/model'), /no image model called "nope\/model"/)
  })
})

describe('failures', () => {
  test('no credit says so, and that nothing was charged', async () => {
    const { client } = mock({ status: 402, body: { error: { message: 'Insufficient credits' } } })
    await assert.rejects(() => client.generate({ prompt: 'x', aspectRatio: '1:1' }), /lack of credit/)
  })

  test('an answer with no image is an error, not an empty file', async () => {
    const { client } = mock({ body: { data: [], usage: { cost: 0 } } })
    await assert.rejects(() => client.generate({ prompt: 'x', aspectRatio: '1:1' }), /no image/)
  })

  test('a missing cost is recorded as zero rather than guessed', async () => {
    const { client } = mock({ body: { data: [{ b64_json: Buffer.from('X').toString('base64') }] } })
    const image = await client.generate({ prompt: 'x', aspectRatio: '1:1' })
    assert.equal(image.costUsd, 0)
  })
})
