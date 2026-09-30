import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  DEFAULT_IMAGE_MODEL,
  GENERATABLE_SHAPES,
  OpenRouterImages,
  type GeneratableShape,
} from '@social-publisher/adapters'
import { optional } from '@social-publisher/config'

import { currentScope } from './context.ts'

/**
 * Generating ad creative, paid per image through OpenRouter.
 *
 * **Local server only**, like the ads tools: the key and the spending cap come
 * from the owner's environment.
 *
 * The control is a **daily cap in code**, not per-image approval. At a few
 * cents an image, asking a person to approve each one would make the feature
 * unusable, but an AI in a loop generating images unattended is exactly the
 * failure a cap exists for. So:
 *
 *   - No cap configured means nothing is generated. There is no default.
 *   - Today's spend is summed from what OpenRouter actually charged, recorded in
 *     the audit log after each image.
 *   - A run stops as soon as the cap is reached, keeping what was made.
 *   - At most 15 images per call: five variants in three shapes.
 */

const MAX_PER_CALL = 15
const ACTION = 'images.generated'

/** Where generated files go: the project's media folder, by date. */
const MEDIA_ROOT = fileURLToPath(new URL('../../../../media/generated/', import.meta.url))

type ToolResult = { content: Array<{ type: 'text'; text: string }> }
const text = (body: string): ToolResult => ({ content: [{ type: 'text' as const, text: body }] })

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image'
}

export function registerImageTools(server: McpServer): void {
  server.tool(
    'generate_ad_images',
    'Generate ad images with an AI image model, in the shapes ads need (1:1, 4:5 for Feed, 9:16 for Stories and Reels). Costs a few cents per image, within a daily cap. Returns file paths to use as files in create_ad_plan. Images contain no text: put words in the ad copy instead.',
    {
      concepts: z
        .array(
          z.object({
            name: z.string().describe('Short label, e.g. "busy-kitchen".'),
            prompt: z
              .string()
              .describe('What the picture shows: subject, setting, mood. No words to render; they will be refused.'),
          }),
        )
        .min(1)
        .max(5)
        .describe('One to five different visual ideas.'),
      shapes: z
        .array(z.enum(GENERATABLE_SHAPES))
        .min(1)
        .describe('Which shapes to make each concept in. 4:5 and 9:16 cover Feed and Stories.'),
      model: z
        .string()
        .optional()
        .describe(`OpenRouter image model. Default ${DEFAULT_IMAGE_MODEL}, which makes every ad shape.`),
    },
    async ({ concepts, shapes, model }) => {
      const apiKey = optional('OPENROUTER_API_KEY')
      if (apiKey === undefined) {
        return text(
          'Image generation is not configured: OPENROUTER_API_KEY is missing from ~/.social-publisher/.env.\n' +
            'Create a key at openrouter.ai/keys and add it there. Nothing was generated or charged.',
        )
      }

      const capText = optional('OPENROUTER_DAILY_LIMIT_USD')
      const cap = capText === undefined ? NaN : Number(capText)
      if (!Number.isFinite(cap) || cap <= 0) {
        return text(
          'No daily image budget is set, so nothing will be generated.\n' +
            'Add OPENROUTER_DAILY_LIMIT_USD to ~/.social-publisher/.env, in US dollars, e.g. 5.\n' +
            'There is deliberately no default: a spending limit the software picked is not one you chose.',
        )
      }

      const total = concepts.length * shapes.length
      if (total > MAX_PER_CALL) {
        return text(
          `${concepts.length} concepts × ${shapes.length} shapes is ${total} images; the limit is ${MAX_PER_CALL} per request. ` +
            'Ask for fewer. Nothing was generated or charged.',
        )
      }

      const scope = await currentScope()
      let spent = await scope.spentSince(ACTION, startOfToday())
      if (spent >= cap) {
        return text(
          `Today's image budget is used up: $${spent.toFixed(3)} of $${cap.toFixed(2)}. Nothing was generated. ` +
            'It resets at midnight, or the owner can raise OPENROUTER_DAILY_LIMIT_USD.',
        )
      }

      const client = new OpenRouterImages({ apiKey })
      const chosenModel = model ?? optional('OPENROUTER_IMAGE_MODEL') ?? DEFAULT_IMAGE_MODEL

      // Check every shape before spending anything, so a model that cannot
      // make one of them fails the whole request up front rather than after
      // half the images have been paid for.
      const supported = await client.supportedShapes(chosenModel)
      const unsupported = shapes.filter((s) => !supported.includes(s))
      if (unsupported.length > 0) {
        return text(
          `${chosenModel} cannot make ${unsupported.join(', ')}. Nothing was generated or charged.\n` +
            `Use ${DEFAULT_IMAGE_MODEL}, which makes every ad shape.`,
        )
      }

      const day = new Date().toISOString().slice(0, 10)
      const folder = join(MEDIA_ROOT, day)
      mkdirSync(folder, { recursive: true })

      const made: string[] = []
      let stoppedAt: string | undefined
      let costUnknown = false

      outer: for (const concept of concepts) {
        for (const shape of shapes as GeneratableShape[]) {
          if (spent >= cap) {
            stoppedAt = `Stopped at the daily budget ($${spent.toFixed(3)} of $${cap.toFixed(2)}).`
            break outer
          }
          const image = await client.generate({ prompt: concept.prompt, aspectRatio: shape, model: chosenModel })
          if (image.costUsd === 0) costUnknown = true

          const file = join(folder, `${slug(concept.name)}_${shape.replace(':', '-')}_${Date.now()}.png`)
          writeFileSync(file, image.bytes)

          spent += image.costUsd
          await scope.record('mcp', ACTION, {
            model: image.model,
            aspectRatio: shape,
            costUsd: image.costUsd,
            file,
          })
          made.push(`  ${concept.name.padEnd(20)} ${shape.padEnd(5)} $${image.costUsd.toFixed(4)}  ${file}`)
        }
      }

      const lines = [
        `${made.length} image(s) made with ${chosenModel}. Spent today: $${spent.toFixed(3)} of $${cap.toFixed(2)}.`,
        '',
        ...made,
      ]
      if (stoppedAt !== undefined) lines.push('', stoppedAt)
      if (costUnknown) {
        lines.push('', 'OpenRouter did not report the cost of at least one image, so it was counted as $0. Check the OpenRouter dashboard.')
      }
      lines.push(
        '',
        'Look at them before using them. Use the paths as files in create_ad_plan, with the aspect ratio shown.',
      )
      return text(lines.join('\n'))
    },
  )
}
