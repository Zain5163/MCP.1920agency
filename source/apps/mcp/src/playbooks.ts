import { readFileSync } from 'node:fs'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

/**
 * Built-in advertising expertise, served to any MCP client.
 *
 * The same playbooks are exposed three ways, because clients differ in what they
 * support:
 *
 *   - **Resources** — documents a client can list and read.
 *   - **Prompts** — ready-made workflows a user can pick ("launch a Meta lead
 *     campaign"), carrying the playbook with them.
 *   - **A `get_playbook` tool** — because tools are the one thing every client
 *     supports. A client that ignores resources and prompts still gets the
 *     expertise this way.
 *
 * A playbook is **advice to the AI, never a control.** Everything that must hold
 * — the spend ceiling, paused creation, the approval token, the variant limits —
 * is enforced in code regardless of what a playbook says. See decisions/0006.
 *
 * Safe on the hosted server: playbooks are static text and carry no credentials.
 */

export const PLAYBOOKS = [
  {
    key: 'meta-ads',
    title: 'Meta ads playbook',
    description:
      'How to plan, write and launch Facebook and Instagram campaigns with this server: structure, copy, creative shapes, leads, budget and the learning phase.',
  },
  {
    key: 'google-ads',
    title: 'Google Ads playbook',
    description:
      'Planning Google Search campaigns and writing responsive search ads to Google’s hard limits. Google cannot be launched from this server yet.',
  },
  {
    key: 'tiktok-ads',
    title: 'TikTok ads playbook',
    description:
      'Vertical creative, the safe zone, budgets and tracking for TikTok. TikTok cannot be launched from this server yet.',
  },
] as const

export type PlaybookKey = (typeof PLAYBOOKS)[number]['key']

/**
 * Sent to every client when it connects, as the MCP `instructions` field.
 *
 * Without it the playbooks exist but an AI only finds them if it goes looking,
 * and the user gets an ordinary assistant guessing at ads. The owner's aim is
 * that any AI connected here works like a senior media buyer from the first
 * message, without being told how (2026-09-30).
 */
export const SERVER_INSTRUCTIONS = [
  'AdsPilot runs social posting and paid advertising for a business.',
  '',
  'Before planning, writing or changing any ad campaign, read the playbook for that platform with get_playbook',
  '(meta-ads, google-ads, tiktok-ads) and follow it: choose the objective from what the business wants to pay for,',
  'use its section for that goal, and apply its copy, creative, budget and tracking rules without waiting to be asked.',
  'For wider marketing work (landing pages, emails, SEO, pricing, launch plans), use list_skills and get_skill.',
  '',
  'Ask for what is missing rather than inventing a URL, price, offer, testimonial or result.',
  'Nothing spends without the user approving the exact summary the server returns; never supply an approval token',
  'the user did not give, and never call a created campaign live or a submitted ad approved.',
].join('\n')

/**
 * Loaded once, at start-up, and fail loudly if one is missing.
 *
 * A server that started without its playbooks would answer every request with
 * less expertise than it claims, and nothing would say so.
 */
function load(): Record<PlaybookKey, string> {
  const out = {} as Record<PlaybookKey, string>
  for (const { key } of PLAYBOOKS) {
    const url = new URL(`../playbooks/${key}.md`, import.meta.url)
    try {
      out[key] = readFileSync(url, 'utf8')
    } catch (cause) {
      throw new Error(`Playbook "${key}" is missing at ${url.pathname}. The server cannot start without it.`, {
        cause,
      })
    }
  }
  return out
}

const promptText = (text: string) => ({
  messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
})

export function registerPlaybooks(server: McpServer): void {
  const text = load()

  for (const playbook of PLAYBOOKS) {
    server.registerResource(
      `playbook-${playbook.key}`,
      `adspilot://playbooks/${playbook.key}`,
      { title: playbook.title, description: playbook.description, mimeType: 'text/markdown' },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: text[playbook.key] }] }),
    )
  }

  server.tool(
    'get_playbook',
    'Read the built-in expert playbook for an ad platform BEFORE planning, writing or launching anything on it. Covers structure, copy, creative specs, budgets and what this server can and cannot do on that platform.',
    { platform: z.enum(['meta-ads', 'google-ads', 'tiktok-ads']) },
    async ({ platform }) => ({ content: [{ type: 'text' as const, text: text[platform] }] }),
  )

  server.registerPrompt(
    'launch_meta_campaign',
    {
      title: 'Launch a Meta ad campaign',
      description:
        'Plan, write and launch a Facebook and Instagram campaign from a short brief, with the user approving the cost before anything is created or spends.',
      argsSchema: {
        goal: z.string().describe('What the business wants: leads, sales, website visits or reach.'),
        offer: z.string().describe('What is being advertised, and why someone should care.'),
        dailyBudget: z.string().describe('Per day, in the ad account currency, e.g. "5000".'),
        countries: z.string().describe('Two-letter country codes, comma separated, e.g. "PK".'),
        destination: z
          .string()
          .optional()
          .describe('A landing page URL, or "instant form <form id>".'),
        creativeFiles: z
          .string()
          .optional()
          .describe('Image or video file paths with their shape, e.g. "C:/ad/feed.png 4:5, C:/ad/story.png 9:16".'),
      },
    },
    async (args) =>
      promptText(
        [
          'You are running a Meta ad campaign for this business through the AdsPilot tools.',
          'Follow the playbook below. It is the standard this campaign is held to.',
          '',
          'The brief:',
          `- Goal: ${args.goal}`,
          `- Offer: ${args.offer}`,
          `- Daily budget: ${args.dailyBudget}`,
          `- Countries: ${args.countries}`,
          `- Destination: ${args.destination ?? 'not given — ask'}`,
          `- Creative files: ${args.creativeFiles ?? 'not given — ask'}`,
          '',
          'Do this, in order:',
          '1. Ask for anything the playbook needs that the brief does not give. Invent nothing.',
          '2. Write 5 primary texts, 5 headlines and up to 5 descriptions as genuinely different angles.',
          '3. Call review_ad_plan and show the user the full result, warnings included.',
          '4. Call create_ad_plan without a token, show the approval summary exactly, and wait for a yes.',
          '5. Only then call it again with the token. Everything is created paused.',
          '6. Tell the user Meta is reviewing the ads, and that nothing spends until they choose to activate.',
          'Do not call activate_campaign unless the user separately asks to start spending.',
          '',
          'If the review_ad_plan tool does not exist on this server, stop: this server cannot launch ads.',
          '',
          '---',
          '',
          text['meta-ads'],
        ].join('\n'),
      ),
  )

  server.registerPrompt(
    'write_ad_copy',
    {
      title: 'Write ad copy for a platform',
      description: 'Write ad copy variants that follow a platform’s limits and current best practice.',
      argsSchema: {
        platform: z.enum(['meta-ads', 'google-ads', 'tiktok-ads']),
        offer: z.string().describe('What is being advertised.'),
        audience: z.string().optional().describe('Who buys it, in their own words if possible.'),
      },
    },
    async (args) =>
      promptText(
        [
          `Write ad copy for ${args.platform.replace('-ads', '')} following the playbook below exactly,`,
          'including its hard character and count limits. Show the character count beside each line.',
          '',
          `Offer: ${args.offer}`,
          `Audience: ${args.audience ?? 'not given — ask before writing'}`,
          '',
          'Make every variant a different angle rather than a rewording. Use no statistic, testimonial,',
          'price or guarantee the user has not given you.',
          '',
          '---',
          '',
          text[args.platform],
        ].join('\n'),
      ),
  )
}
