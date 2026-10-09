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
      'How to plan, write and launch Facebook and Instagram campaigns with this server, by goal (leads, sales, traffic, awareness, messaging, local): structure, copy, creative shapes, tracking, budget and the learning phase.',
  },
  {
    key: 'meta-performance',
    title: 'Meta performance team playbook',
    description:
      'Running and improving live Meta campaigns as a five-role team (auditor, analyst, creative strategist, media buyer, reporter): targets and break-even ROAS, click quality, placements, fatigue, and when to scale, cut or wait.',
  },
  {
    key: 'google-ads',
    title: 'Google Ads playbook',
    description:
      'Planning Google Ads campaigns by goal (Search, Shopping, Performance Max, local, YouTube/Demand Gen, App) and writing responsive search ads and Performance Max assets to Google’s hard limits. Google cannot be launched from this server yet.',
  },
  {
    key: 'microsoft-ads',
    title: 'Microsoft Advertising playbook',
    description:
      'Planning Microsoft Advertising (Bing Search with LinkedIn profile bid adjustments, Shopping, Performance Max, Audience Network, Copilot placements, Google Ads import) and writing ads to its limits. Microsoft cannot be launched from this server yet.',
  },
  {
    key: 'tiktok-ads',
    title: 'TikTok ads playbook',
    description:
      'TikTok by goal: vertical creative, the safe zone, Spark Ads and creators, Smart+ and shop campaigns, budgets and tracking. TikTok cannot be launched from this server yet.',
  },
  {
    key: 'snapchat-ads',
    title: 'Snapchat ads playbook',
    description:
      'Snapchat by goal: full-screen vertical creative, formats and safe zones, budgets, pixel and Conversions API. Snapchat cannot be launched from this server yet.',
  },
  {
    key: 'pinterest-ads',
    title: 'Pinterest ads playbook',
    description:
      'Pinterest by goal: planning-mindset audiences, Pin creative and specs, shopping and catalog campaigns, tag and Conversions API. Pinterest cannot be launched from this server yet.',
  },
  {
    key: 'linkedin-ads',
    title: 'LinkedIn ads playbook',
    description:
      'B2B campaigns on LinkedIn: objectives, Lead Gen Forms, Thought Leader and Document ads, company and matched-audience targeting, realistic budgets for high CPCs. LinkedIn cannot be launched from this server yet (API access granted, adapter planned).',
  },
  {
    key: 'x-ads',
    title: 'X (Twitter) ads playbook',
    description:
      'Planning X campaigns: conversation-based targeting, posts and cards to X’s limits, the rebuilt Ads Manager and its Leads objective, pixel and Conversion API. X cannot be launched from this server yet.',
  },
  {
    key: 'reddit-ads',
    title: 'Reddit ads playbook',
    description:
      'Reddit campaigns: community, keyword and interest targeting, writing in Reddit’s native tone, handling comments on ads, and lead generation after the 2026 onsite-form sunset. Reddit cannot be launched from this server yet.',
  },
  {
    key: 'amazon-ads',
    title: 'Amazon Ads playbook',
    description:
      'Amazon Sponsored Products, Sponsored Brands, display and DSP basics to a senior ad manager’s standard: listing readiness before spend, keyword harvesting, ACoS/TACoS and break-even, bids and placements, by goal. Amazon cannot be launched from this server yet.',
  },
  {
    key: 'telegram-ads',
    title: 'Telegram Ads playbook',
    description:
      'Whether Telegram Ads fits, and how to plan its Sponsored Messages: channel, topic, bot and search targeting, the short copy limits, TON/Fragment funding, by goal. Telegram cannot be launched or funded from this server yet.',
  },
] as const

export type PlaybookKey = (typeof PLAYBOOKS)[number]['key']

/** For the tool and prompt schemas, so a new playbook is offered everywhere at once. */
const PLAYBOOK_KEYS = PLAYBOOKS.map((p) => p.key) as [PlaybookKey, ...PlaybookKey[]]

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
  `(${PLAYBOOKS.map((p) => p.key).join(', ')}) and follow it: choose the objective from what the business wants to pay for,`,
  'use its section for that goal, and apply its copy, creative, budget and tracking rules without waiting to be asked.',
  'To review or improve campaigns that are already running, read meta-performance and work as its five-role team',
  '(audit_ad_account, analyze_ad_performance, then propose changes for approval).',
  'For an account that is declining or inconsistent, follow get_skill account-turnaround: diagnose_account_trend',
  'explains the decline step by step, and break_even_cost_per_sale sets targets from the business’s real costs.',
  'For someone new to Meta ads, run check_ad_setup first: it says what is missing (Page, business, ad account,',
  'payment, pixel) and who does each step.',
  'For wider marketing work (landing pages, emails, SEO, pricing, launch plans), use list_skills and get_skill.',
  'To build or improve a Shopify store, landing page or website (WordPress too), read get_skill store-builder,',
  'landing-page-builder, shopify-theme-developer, web-ui-design or wordpress-site-builder first, and',
  'shopify-store-kit for a ready, tested premium design on Shopify’s Horizon theme, and',
  'selling-by-country for the buyer’s country (payments, prices and tax, consumer law, consent before tracking).',
  '',
  'Two rules for every campaign, on every platform (get_skill campaign-setup has the full method):',
  '1. Understand the business first, then match the objective to the result they want to pay for: sales means a',
  '   Sales objective optimising for purchases; leads means Leads; WhatsApp or Messenger chats means a messaging',
  '   objective; visits means landing page views, never link clicks. Never let a sales or leads campaign optimise for clicks.',
  '2. Check three times before anything goes live: review the plan (review_ad_plan), read the created campaign back',
  '   from the platform and compare every setting with what the user asked (verify_campaign, also run automatically',
  '   after creation and before activation), and fix every failed check before asking for approval.',
  '',
  'Ask for what is missing rather than inventing a URL, price, offer, testimonial or result.',
  'Nothing spends without the user approving the exact summary the server returns; never supply an approval token',
  'the user did not give, and never call a created campaign live or a submitted ad approved.',
  'When a tool result contains a USAGE NOTICE or says the free calls are used up, tell the user in plain words, with the link.',
  'If check_usage shows no business type, ask the user once which one fits and call set_business_type; never guess it.',
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

/** Past this, a playbook says so when read. Platforms change too often to trust older advice. */
export const PLAYBOOK_STALE_DAYS = 90

/** The date in a playbook's "**Updated YYYY-MM-DD.**" line. */
export function playbookDate(markdown: string): Date | undefined {
  const m = /\*\*Updated (\d{4}-\d{2}-\d{2})\.?\*\*/.exec(markdown)
  return m === null ? undefined : new Date(`${m[1]}T00:00:00Z`)
}

/**
 * The playbook as served: with a warning on top once it is old, so the AI checks
 * the platform's current facts instead of repeating last year's.
 */
export function withFreshness(markdown: string, now: Date = new Date()): string {
  const updated = playbookDate(markdown)
  if (updated === undefined) return markdown
  const days = Math.floor((now.getTime() - updated.getTime()) / 86_400_000)
  if (days <= PLAYBOOK_STALE_DAYS) return markdown
  return (
    `> **This playbook is ${days} days old.** Limits, objective names and features may have changed. ` +
    'Check anything that matters against the platform’s current documentation before relying on it, and tell the user you did.\n\n' +
    markdown
  )
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
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: withFreshness(text[playbook.key]) }] }),
    )
  }

  server.tool(
    'get_playbook',
    'Read the built-in expert playbook for an ad platform BEFORE planning, writing or launching anything on it. Covers structure, copy, creative specs, budgets and what this server can and cannot do on that platform.',
    { platform: z.enum(PLAYBOOK_KEYS) },
    async ({ platform }) => ({ content: [{ type: 'text' as const, text: withFreshness(text[platform]) }] }),
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
          withFreshness(text['meta-ads']),
        ].join('\n'),
      ),
  )

  server.registerPrompt(
    'review_meta_account',
    {
      title: 'Review and improve Meta campaigns',
      description:
        'Run the five-role performance team over a Meta ad account or campaign: audit, analyse, plan creative, propose budget and delivery changes for approval, and report.',
      argsSchema: {
        campaignId: z.string().optional().describe('Omit to review the whole ad account.'),
        target: z
          .string()
          .optional()
          .describe('What a result is worth, e.g. "PKR 800 per lead" or "ROAS 3" or "40% margin".'),
      },
    },
    async (args) =>
      promptText(
        [
          'You are a senior Meta performance team working for this business through the AdsPilot tools.',
          'Work through the five roles in the playbook below, in order, and follow its rules exactly.',
          '',
          `Scope: ${args.campaignId !== undefined ? `campaign ${args.campaignId}` : 'the whole ad account'}`,
          `Target: ${args.target ?? 'not given — ask for it first; without it, say that judgements are relative to the account average'}`,
          '',
          '1. Auditor: call audit_ad_account (30 days). If it reports missing results, call check_ad_setup.',
          '2. Analyst: call analyze_ad_performance (7 days; 14–30 if spend is small) with the target.',
          '   If your app supports sub-agents, steps 1 and 2 may run in parallel.',
          '3. Creative strategist: from the analysis, name the winning angle, tired ads, and 2–4 new ad ideas.',
          '4. Media buyer: propose each change with its tool (change_budget, set_ad_delivery, exclude_placements).',
          '   Call each WITHOUT a token, show the user the approval summary exactly, and only call again with',
          '   the token after they say yes. Switching something off needs no approval: do it when money is',
          '   clearly being wasted, and say so.',
          '5. Reporter: finish with the five-part summary from the playbook.',
          '',
          'Never invent a number or a cause. If the data does not show it, say you do not know.',
          '',
          '---',
          '',
          withFreshness(text['meta-performance']),
        ].join('\n'),
      ),
  )

  server.registerPrompt(
    'write_ad_copy',
    {
      title: 'Write ad copy for a platform',
      description: 'Write ad copy variants that follow a platform’s limits and current best practice.',
      argsSchema: {
        platform: z.enum(PLAYBOOK_KEYS),
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
          withFreshness(text[args.platform]),
        ].join('\n'),
      ),
  )
}
